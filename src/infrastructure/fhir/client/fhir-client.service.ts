import { purgeClinicalSourceSession } from '@/src/infrastructure/fhir/services/clinical-source-session'
// FHIR Client Service
import type FHIR from 'fhirclient'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

export type FHIRClient = Awaited<ReturnType<typeof FHIR.oauth2.ready>>

/**
 * Thrown by FhirClientService.getClient() when the app is running with a
 * locally-imported FHIR Bundle (no SMART OAuth state in the URL). Callers
 * should catch this specifically and silently treat the FHIR client as
 * "unavailable" — printing the error would be noise, not a bug.
 */
export class LocalBundleModeError extends Error {
  constructor() {
    super('App is running in local-bundle mode; SMART client is not initialised.')
    this.name = 'LocalBundleModeError'
  }
}

// SMART launch / callback URL params (fhirclient consumes these on entry).
// `state` + `code` are present on the OAuth callback URL.
// `launch` + `iss` are present on the initial launch URL from the EHR.
const SMART_URL_PARAMS = ['state', 'code', 'launch', 'iss']

/** fhirclient's sessionStorage pointer to the active SMART state entry. */
const SMART_STATE_POINTER_KEY = 'SMART_KEY'

/**
 * Returns true when the app appears to be running inside a SMART OAuth
 * context — either a fresh launch / callback (params in the URL) or an
 * already-established session (token state cached in sessionStorage by
 * fhirclient).
 *
 * When this returns true, SMART takes precedence over any locally-imported
 * bundle. Reasoning: an EHR-initiated launch (or an ongoing SMART session)
 * is an *explicit* clinical context, while a leftover local bundle is just
 * residue from earlier testing. The clinical context should always win.
 *
 * SSR-safe: returns false when window is not defined.
 */
export function hasSmartContext(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (SMART_URL_PARAMS.some(k => params.has(k))) return true
  } catch {
    // Malformed URL — fall through to sessionStorage check.
  }
  try {
    // fhirclient stores SMART_KEY as a JSON-stringified pointer to another
    // sessionStorage entry containing the actual token state. The pointer
    // alone is set very early in the OAuth flow and persists across same-tab
    // navigations even after the user is no longer logged in (or never
    // completed the flow). We must also confirm the pointed-to state
    // contains a real `tokenResponse.access_token` before treating the
    // session as live — otherwise stale pointers send us into
    // `oauth2.ready()` which throws "No 'state' parameter found."
    const rawPointer = window.sessionStorage.getItem(SMART_STATE_POINTER_KEY)
    if (!rawPointer) return false
    const stateKey = rawPointer.replace(/^"|"$/g, '')
    if (!stateKey) return false
    const stateJson = window.sessionStorage.getItem(stateKey)
    if (!stateJson) return false
    const parsed = JSON.parse(stateJson)
    return !!parsed?.tokenResponse?.access_token
  } catch {
    // sessionStorage unavailable or state JSON malformed — treat as no context.
  }
  return false
}

/**
 * Convenience helper: should we use the locally-imported bundle as the data
 * source for this request? True only when there's NO SMART context AND a
 * local bundle exists.
 */
export function shouldUseLocalBundle(): boolean {
  return !hasSmartContext() && LocalBundleService.hasData()
}

/**
 * True when any data source is available — either a SMART launch context or
 * a locally-imported bundle. When false, the UI should show an onboarding
 * screen instead of attempting FHIR queries that will fail with confusing
 * "Failed to initialize FHIR client" errors.
 */
export function hasAnyDataSource(): boolean {
  return hasSmartContext() || LocalBundleService.hasData()
}

/**
 * Drop the live SMART session: fhirclient's cached token state (the
 * `SMART_KEY` pointer *and* the entry it points at, which holds the access
 * token) plus the in-memory client instance.
 *
 * Logout has to do this, not just clear the doctor's API keys. On a shared
 * workstation the access token stays valid for its full lifetime, so a tab
 * left open after "logout" would otherwise keep rendering — and keep making
 * authenticated requests for — the previous patient's chart.
 *
 * Safe to call in local-bundle mode and when sessionStorage is unavailable.
 */
export function clearSmartSession(): void {
  FhirClientService.getInstance().clearClient()
  if (typeof window === 'undefined') return
  try {
    const rawPointer = window.sessionStorage.getItem(SMART_STATE_POINTER_KEY)
    if (rawPointer) {
      const stateKey = rawPointer.replace(/^"|"$/g, '')
      if (stateKey) window.sessionStorage.removeItem(stateKey)
    }
    window.sessionStorage.removeItem(SMART_STATE_POINTER_KEY)
  } catch {
    // sessionStorage unavailable — the in-memory client is already dropped.
  }
}

export class FhirClientService {
  private static instance: FhirClientService
  private client: FHIRClient | null = null
  private sessionGeneration = 0

  private constructor() {}

  static getInstance(): FhirClientService {
    if (!FhirClientService.instance) {
      FhirClientService.instance = new FhirClientService()
    }
    return FhirClientService.instance
  }

  async getClient(): Promise<FHIRClient> {
    if (this.client) {
      return this.client
    }

    // Local-bundle mode: SMART takes precedence whenever there's any sign of
    // an OAuth flow (URL params or sessionStorage state). Fall back to the
    // local bundle only when no SMART context is present.
    if (shouldUseLocalBundle()) {
      throw new LocalBundleModeError()
    }

    // Defense in depth: never call oauth2.ready() unless we're confident
    // a SMART session is actually live. Calling it without a `state` URL
    // param OR a valid cached token throws "No 'state' parameter found"
    // and noisily logs it to the console. By bailing here we let upstream
    // callers (queryFns, useFhirContext) handle the "no data source" state
    // gracefully — same error type as local-bundle mode so existing catch
    // handlers cover it.
    if (!hasSmartContext()) {
      throw new LocalBundleModeError()
    }

    try {
      const generation = this.sessionGeneration
      const FHIR = (await import('fhirclient')).default
      const client = await FHIR.oauth2.ready()
      if (generation !== this.sessionGeneration) throw new LocalBundleModeError()
      this.client = client
      return client
    } catch (error) {
      if (error instanceof LocalBundleModeError) throw error
      console.error('Failed to initialize FHIR client:', error)
      throw new Error('Failed to initialize FHIR client')
    }
  }

  async request<T = any>(query: string): Promise<T> {
    const client = await this.getClient()
    return await requestWithTimeout<T>(client, query)
  }

  /**
   * Like `request`, but follows `Bundle.link[relation="next"]` and merges every
   * page's entries into a single Bundle. A plain `request()` only returns the
   * FIRST page, so on a real FHIR server that paginates (most do beyond
   * `_count`), long-running patients would silently lose the older data past
   * page 1. The returned object keeps the first page's shape with a combined
   * `entry[]`, so callers that do `response.entry?.map(...)` need no change.
   *
   * `maxPages` is a safety cap against a server returning an endless / cyclic
   * next-link. Hitting it is an explicit query failure: returning the partial
   * entries as a successful Bundle made "all data" silently incomplete.
   */
  async requestAllPages<T = any>(query: string, maxPages = 50): Promise<T> {
    const client = await this.getClient()
    const first = await requestWithTimeout<any>(client, query)
    const entries: any[] = Array.isArray(first?.entry) ? [...first.entry] : []

    let next = nextPageUrl(first)
    let pages = 1
    while (next && pages < maxPages) {
      const page = await requestWithTimeout<any>(client, next)
      if (Array.isArray(page?.entry)) entries.push(...page.entry)
      next = nextPageUrl(page)
      pages += 1
    }
    if (next) {
      throw new FhirPaginationLimitError(query, maxPages, entries.length)
    }
    return { ...(first as object), entry: entries } as T
  }

  clearClient(): void {
    this.sessionGeneration++
    purgeClinicalSourceSession(this)
    this.client = null
  }
}

/**
 * Per-request ceiling. A stalled hospital Wi-Fi connection used to leave the
 * whole chart on "載入中" forever — no timeout, no cancel, no error — because
 * nothing ever rejected. Generous enough for a slow FHIR server returning a
 * large page, short enough that a clinician learns something went wrong.
 */
export const FHIR_REQUEST_TIMEOUT_MS = 30_000

export class FhirRequestTimeoutError extends Error {
  constructor(public readonly query: string, public readonly timeoutMs: number) {
    super(`FHIR request timed out after ${timeoutMs}ms: ${query.split('?')[0]}`)
    this.name = 'FhirRequestTimeoutError'
  }
}

/**
 * Run one fhirclient request under an abort timeout. fhirclient forwards the
 * RequestInit (including `signal`) to fetch, so the socket is actually torn
 * down rather than merely ignored.
 */
async function requestWithTimeout<T>(
  client: { request: (options: any) => Promise<any> },
  url: string,
  timeoutMs = FHIR_REQUEST_TIMEOUT_MS,
): Promise<T> {
  // AbortController rather than AbortSignal.timeout(): older hospital
  // Chrome/Edge builds are a target and predate the static helper.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await client.request({ url, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new FhirRequestTimeoutError(url, timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export class FhirPaginationLimitError extends Error {
  constructor(
    public readonly query: string,
    public readonly maxPages: number,
    public readonly loadedEntries: number,
  ) {
    super(`FHIR pagination limit reached for ${query.split('?')[0]} after ${maxPages} pages (${loadedEntries} entries); refusing to return partial data.`)
    this.name = 'FhirPaginationLimitError'
  }
}

/**
 * Pull the `next` page URL out of a FHIR searchset Bundle's `link` array.
 * Returns undefined when there's no further page. Pure + exported so the
 * pagination contract is unit-testable without a live SMART client.
 */
export function nextPageUrl(bundle: unknown): string | undefined {
  const links = (bundle as { link?: Array<{ relation?: string; url?: string }> })?.link
  if (!Array.isArray(links)) return undefined
  const next = links.find((l) => l?.relation === 'next' && typeof l.url === 'string')
  return next?.url
}

export const fhirClient = FhirClientService.getInstance()
