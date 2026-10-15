'use client'

import { collectorEventV5Schema, collectorEventV6Schema, MAX_COLLECTOR_REQUEST_DETAILS, collectorModelSchema, featureSchema, type CollectorEventV6 as CollectorEvent, type CollectorRequest, type SummaryCardCounts } from '@/src/shared/contracts/collector-event'
import { getModelDefinition, isCustomOpenAiModelId } from '@/src/shared/constants/ai-models.constants'
import { captureCollectorAuth } from './collector-auth'
const nowMs = () => typeof performance !== 'undefined' ? performance.now() : Date.now()

type Diagnostics = CollectorEvent['diagnostics']
type ResourceCounts = Partial<Record<'resource_count' | 'encounter_count' | 'med_count' | 'obs_count' | 'report_count' | 'doc_count', number>>
type PreparedCounts = Partial<Record<'fed_resource_count' | 'fed_encounter_count' | 'fed_med_count' | 'fed_obs_count' | 'fed_report_count' | 'fed_doc_count', number>>
export interface CollectorContext {
  /** Per-run capability; never serialized or inferred from patient/slot/time. */
  operation?: CollectorOperation
  counts?: ResourceCounts
  fedCounts?: PreparedCounts
  contextTokens?: number
  contextTrimmed?: boolean
}
type Start = CollectorContext & {
  feature: CollectorEvent['feature']
  modelId: string
  provider?: CollectorEvent['provider']
  sampleKind: CollectorEvent['sample_kind']
  mode: Diagnostics['mode']
}
type Finish = {
  outcome: 'ok' | NonNullable<CollectorEvent['error_class']>
  phase?: Diagnostics['phase']
  responseComplete?: boolean | null
  modelId?: string
  modelSource?: CollectorEvent['model_source']
  httpStatus?: number
  summaryCards?: SummaryCardCounts
}
export interface CollectorOperation { observeRequest: (input: Start) => Observation }
interface Observation { finish: (result: Finish) => void; firstChunk: () => void; operation?: CollectorOperation }
const NOOP: Observation = Object.freeze({ finish: () => {}, firstChunk: () => {} })
const REQUEST_TIMEOUT_MS = 5_000
const MAX_IN_FLIGHT = 2
let generation = 0
const active = new Set<AbortController>()
let failures = 0
let cooldownUntil = 0
let sent = 0
let dropped = 0
let pageBrowserId: string | undefined
const BROWSER_ID_KEY = 'mediprisma.collector.browser-id.v1'

/** Exactly one site parameter, exact value. No remembered site from another route. */
export function isCollectorSite(): boolean {
  try {
    const sites = new URL(window.location.href).searchParams.getAll('site')
    return sites.length === 1 && sites[0] === 'vghtpe'
  } catch { return false }
}

function configuredEndpoint(): string | null {
  try {
    // Public deployment setting contains a URL only, never a token.
    const url = new URL(process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN || 'http://127.0.0.1:8787')
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return null
    return `${url.origin}/collector/v1/events`
  } catch { return null }
}

/** Cancel old-page observations, not an opt-in switch. Next operation is automatic. */
export function cancelCollectorRequests(): void {
  generation++
  failures = 0
  cooldownUntil = 0
  for (const controller of active) controller.abort()
}

function browserIdentity() {
  try {
    const stored = localStorage.getItem(BROWSER_ID_KEY)
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
      return { browser_id: stored, browser_id_scope: 'persistent' as const }
    }
    const id = crypto.randomUUID()
    localStorage.setItem(BROWSER_ID_KEY, id)
    return { browser_id: id, browser_id_scope: 'persistent' as const }
  } catch {
    pageBrowserId ??= crypto.randomUUID()
    return { browser_id: pageBrowserId, browser_id_scope: 'page' as const }
  }
}

export function collectorStatus() {
  return { enabled: Boolean(isCollectorSite() && configuredEndpoint()),
    in_flight: active.size, sent, dropped, cooling_down: Date.now() < cooldownUntil }
}

const countKeys = { total: 'resource_count', encounters: 'encounter_count', medications: 'med_count',
  observations: 'obs_count', reports: 'report_count', documents: 'doc_count' } as const
function counts(input: ResourceCounts | PreparedCounts | undefined, prepared = false): Diagnostics['loaded'] {
  if (!input) return undefined
  const result: NonNullable<Diagnostics['loaded']> = {}
  for (const [name, key] of Object.entries(countKeys)) {
    const n = (input as Record<string, unknown>)[prepared ? `fed_${key}` : key]
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) result[name as keyof typeof result] = n
  }
  return Object.keys(result).length ? result : undefined
}
function tokenBucket(n: number | undefined): Diagnostics['context_tokens_bucket'] {
  if (n === undefined || !Number.isFinite(n) || n < 0) return undefined
  return n === 0 ? '0' : n <= 2000 ? '1-2000' : n <= 8000 ? '2001-8000' : n <= 32000 ? '8001-32000' : n <= 128000 ? '32001-128000' : '128000+'
}
function modelInfo(id: string, provider?: Start['provider']) {
  if (isCustomOpenAiModelId(id) || id === 'custom') return { model: 'custom' as const, provider: 'custom' as const }
  const model = collectorModelSchema.safeParse(id)
  const definition = getModelDefinition(id)
  return { model: model.success ? model.data : 'unknown' as const,
    provider: provider ?? (definition?.provider === 'claude' ? 'anthropic' : definition?.provider ?? 'unknown') }
}

/** Read existing browser consent only. Never probe the network to request it. */
async function collectorNetworkPermission(endpoint: string): Promise<PermissionStatus | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
    const host = new URL(endpoint).hostname
    const name = ['localhost', '127.0.0.1', '[::1]'].includes(host) ? 'loopback-network' : 'local-network'
    try {
      // Chromium 145+ splits local and loopback permissions; lib.dom may lag it.
      return await navigator.permissions.query({ name: name as PermissionName })
    } catch (error) {
      // Older Chromium only knows the combined descriptor. Never override a
      // returned prompt/denied state with a different permission's grant.
      if (!(error instanceof TypeError)) return null
      return await navigator.permissions.query({ name: 'local-network-access' as PermissionName })
    }
  } catch { return null }
}

/** Map only source-code labels; arbitrary panel titles and operation keys never pass through. */
export function collectorFeature(label?: string): Start['feature'] {
  const aliases: Record<string, Start['feature']> = {
    'medical-summary': 'summary', 'report-interpretation': 'report_interp',
    'clinical-insights': 'insights', 'nhi-lipid-ai-assist': 'nhi_lipid',
    'ips-problem-inference': 'ips_inference', 'chat-followup-suggestions': 'chat_followup',
    'prompt-gallery-example': 'prompt_example',
  }
  const parsed = featureSchema.safeParse(label)
  return parsed.success ? parsed.data : (label && Object.hasOwn(aliases, label) ? aliases[label] : 'ai_other')
}

function dispatch(event: CollectorEvent, owner: number, endpoint: string, auth: ReturnType<typeof captureCollectorAuth>) {
  if (generation !== owner || !isCollectorSite() || Date.now() < cooldownUntil || active.size >= MAX_IN_FLIGHT) {
    dropped++
    return
  }
  const controller = new AbortController()
  active.add(controller)
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('collector_cancelled'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  // Defer even the fetch invocation. The clinical caller never awaits this promise.
  const send = Promise.resolve().then(async () => {
    if (generation !== owner || !isCollectorSite() || controller.signal.aborted) return
    const permission = await collectorNetworkPermission(endpoint)
    if (generation !== owner || !isCollectorSite() || controller.signal.aborted) return
    if (permission?.state !== 'granted') {
      dropped++ // A permission skip is not a transport failure/cooldown.
      return
    }
    const credential = await auth
    if (generation !== owner || !isCollectorSite() || controller.signal.aborted) return
    const token = await credential?.getToken()
    if (!token) throw new Error('collector_auth_unavailable')
    if (generation !== owner || !isCollectorSite() || controller.signal.aborted) return
    // PermissionStatus is live: do not send if consent changed while awaiting auth.
    if (permission.state !== 'granted') { dropped++; return }
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event), signal: controller.signal, credentials: 'omit',
      referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    })
    // Ignore bodies: neither error echo nor clinical content enters local logs.
    void response.body?.cancel().catch(() => {})
    if (generation !== owner) return
    if (response.status !== 200 && response.status !== 201) {
      throw new Error('collector_rejected')
    }
    sent++
    failures = 0
  })
  void Promise.race([send, aborted]).catch(() => {
    dropped++
    if (generation === owner && ++failures >= 3) cooldownUntil = Date.now() + 60_000
  }).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); active.delete(controller) })
}

/** Captures exact resource counts and a token estimate bucket at START; rechecks site at END/send. */
export function beginCollectorObservation(input: Start): Observation {
  try {
    if (input.sampleKind === 'request' && input.operation) return input.operation.observeRequest(input)
    return observe(input)
  } catch { return NOOP }
}

function observe(input: Start, collect?: (event: CollectorEvent) => void): Observation {
  try {
    if (!isCollectorSite()) return NOOP
    const endpoint = configuredEndpoint()
    if (!endpoint) return NOOP
    const owner = generation
    const browser = browserIdentity()
    const auth = collect ? null : captureCollectorAuth().catch(() => null)
    const started = nowMs()
    const id = crypto.randomUUID()
    const loaded = counts(input.counts)
    const prepared = counts(input.fedCounts, true)
    const tokens = tokenBucket(input.contextTokens)
    const feature = collectorFeature(input.feature)
    const mode = input.mode
    const kind = input.sampleKind
    const configured = modelInfo(input.modelId, input.provider)
    const provider = input.provider
    const trimmed = input.contextTrimmed
    let ended = false
    let firstChunk: number | undefined
    const requests: CollectorRequest[] = []
    let requestCount = 0
    const operation: CollectorOperation | undefined = kind === 'feature' ? {
      observeRequest: (child) => {
        if (ended || generation !== owner || !isCollectorSite()) return NOOP
        requestCount++
        if (requests.length >= MAX_COLLECTOR_REQUEST_DETAILS) return NOOP
        const index = requests.length
        const model = modelInfo(child.modelId, child.provider)
        const childStarted = nowMs()
        requests.push({ ...model, model_source: 'configured', latency_ms: 0,
          status: 'incomplete', error_class: null, response_complete: null, phase: 'unknown', mode: child.mode })
        const observation = observe({ ...child, operation: undefined }, (event) => {
          if (ended) return
          const d = event.diagnostics
          requests[index] = { provider: event.provider, model: event.model, model_source: event.model_source,
            latency_ms: event.latency_ms, status: event.status, error_class: event.error_class,
            response_complete: event.response_complete, phase: d.phase, mode: d.mode,
            ...(d.first_chunk_ms !== undefined ? { first_chunk_ms: d.first_chunk_ms } : {}),
            ...(d.http_status !== undefined ? { http_status: d.http_status } : {}) }
        })
        // A parent may end while a cancelled transport has not produced its terminal callback.
        // Leave an explicit incomplete observation, not a fabricated success/abort.
        const snapshot = () => {
          if (requests[index].status === 'incomplete')
            requests[index].latency_ms = Math.min(86_400_000, Math.max(0, Math.round(nowMs() - childStarted)))
        }
        requestSnapshots.push(snapshot)
        return observation
      },
    } : undefined
    const requestSnapshots: Array<() => void> = []
    return {
      operation,
      firstChunk: () => { try { firstChunk ??= Math.max(0, Math.round(nowMs() - started)) } catch {} },
      finish: (result) => {
        try {
          if (ended) return
          ended = true
          if (generation !== owner || !isCollectorSite()) return
          for (const snapshot of requestSnapshots) snapshot()
          const measured = configured.provider === 'custom' ? configured : result.modelId ? modelInfo(result.modelId, provider) : configured
          const parsed = (kind === 'feature' ? collectorEventV6Schema : collectorEventV5Schema).safeParse({
            schema_version: kind === 'feature' ? 6 : 5, ...browser, event_id: id, occurred_at: new Date().toISOString(), site: 'vghtpe',
            feature, ...measured, model_source: result.modelSource ?? 'configured', sample_kind: kind,
            latency_ms: Math.max(0, Math.round(nowMs() - started)),
            status: result.outcome === 'ok' ? 'completed' : result.outcome === 'aborted' ? 'aborted' : 'error',
            error_class: result.outcome === 'ok' ? null : result.outcome,
            response_complete: result.responseComplete ?? null,
            app_version: process.env.NEXT_PUBLIC_COLLECTOR_APP_VERSION || '0.0.0',
            build_revision: process.env.NEXT_PUBLIC_COLLECTOR_BUILD_REVISION || 'unknown',
            diagnostics: { phase: result.phase ?? 'unknown', mode,
              ...(loaded ? { loaded } : {}), ...(prepared ? { prepared, prepared_count_basis: 'structured_input_upper_bound' } : {}),
              ...(tokens ? { context_tokens_bucket: tokens } : {}),
              ...(firstChunk !== undefined ? { first_chunk_ms: firstChunk } : {}),
              ...(result.httpStatus !== undefined ? { http_status: result.httpStatus } : {}),
              ...(result.summaryCards ? { summary_cards: result.summaryCards } : {}),
              ...(typeof trimmed === 'boolean' ? { context_trimmed: trimmed } : {}),
              ...(kind === 'feature' && requestCount > 0 ? { requests: { count: requestCount, omitted: requestCount - requests.length, details: requests } } : {}),
            },
          })
          if (parsed.success) {
            if (collect) collect(parsed.data as CollectorEvent)
            else if (auth) dispatch(parsed.data as CollectorEvent, owner, endpoint, auth)
          }
          else dropped++
        } catch { /* Telemetry must not affect clinical outcomes, even synchronously. */ }
      },
    }
  } catch { return NOOP }
}

declare global {
  interface Window {
    mediprismaCollector?: { status: typeof collectorStatus }
  }
}
// Read-only diagnostics. No manual enablement, credentials in storage, or health probes.
if (typeof window !== 'undefined') {
  window.mediprismaCollector = Object.freeze({ status: collectorStatus })
  window.addEventListener('pagehide', cancelCollectorRequests)
}
