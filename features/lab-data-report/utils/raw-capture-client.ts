// Reads the 雲端病歷 extension's same-run raw capture (medcloud2-FHIR-bridge
// docs/MEDIPRISMA_RAW_CAPTURE_HANDOFF.md, extension ≥ 0.12.19). Only ever
// called from the lab-data report after the clinician presses 送出 — never on
// launch, never on its own, and never with a prompt.
//
// The reply carries the whole capture, NOT de-identified. Callers hand the
// JSON straight to extractRawLabRows and drop it; it is never logged, stored
// or sent as is. The extension keeps the capture for one hour from the run
// and a read does not extend that.

export const RAW_CAPTURE_REQUEST = 'MEDIPRISMA_RAW_CAPTURE_REQUEST'
export const RAW_CAPTURE_RESULT = 'MEDIPRISMA_RAW_CAPTURE_RESULT'
/** The extension answers only this origin, under /app and /app-hmc. */
export const RAW_CAPTURE_ORIGIN = 'https://mediprisma.tw'
/** The extension gives up after 60 s; a typical capture arrives in a second
 *  or two, so the report waits a bounded time and then sends without it. */
export const RAW_CAPTURE_TIMEOUT_MS = 30_000

export type RawCaptureErrorCode =
  | 'NOT_AVAILABLE'
  | 'EXPIRED'
  | 'BUNDLE_MISMATCH'
  | 'PATIENT_MISMATCH'
  | 'PATIENT_UNVERIFIED'
  | 'CONTEXT_CHANGED'
  | 'REQUEST_IN_PROGRESS'
  | 'INVALID_REQUEST'
  | 'READ_FAILED'
  | 'EXTENSION_UNAVAILABLE'
  | 'ABORTED'

const EXTENSION_CODES = new Set<string>([
  'INVALID_REQUEST',
  'REQUEST_IN_PROGRESS',
  'NOT_AVAILABLE',
  'EXPIRED',
  'BUNDLE_MISMATCH',
  'PATIENT_MISMATCH',
  'PATIENT_UNVERIFIED',
  'CONTEXT_CHANGED',
  'READ_FAILED',
])

export interface RawCaptureMetadata {
  bundleId: string
  runId: string
  filename: string
  /** Unix ms; after it the capture must not be used. */
  expiresAt: number
  producerVersion?: string
  byteLength: number
  totalCharacters: number
}

export type RawCaptureResult =
  | { ok: true; json: string; metadata: RawCaptureMetadata }
  | { ok: false; code: RawCaptureErrorCode }

export const isRawCaptureBundleId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(value)

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * The origin the extension would answer on this page, or null when it never
 * will. Local development gets its own origin so a stand-in responder can
 * answer (the real extension only serves mediprisma.tw); production builds
 * never do.
 */
export function rawCaptureOrigin(location: Pick<Location, 'origin' | 'pathname'> | undefined =
  typeof window === 'undefined' ? undefined : window.location): string | null {
  if (!location) return null
  if (location.origin === RAW_CAPTURE_ORIGIN) {
    return /^\/app(?:-hmc)?(?:\/|$)/.test(location.pathname) ? RAW_CAPTURE_ORIGIN : null
  }
  if (process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(location.origin)) return location.origin
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function isMetadata(value: unknown, bundleId: string): value is RawCaptureMetadata {
  return isRecord(value)
    && value.bundleId === bundleId
    && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
    && typeof value.totalCharacters === 'number'
}

export function requestRawCapture(
  bundleId: string,
  { signal, timeoutMs = RAW_CAPTURE_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RawCaptureResult> {
  const origin = rawCaptureOrigin()
  if (!origin || !isRawCaptureBundleId(bundleId)) return Promise.resolve({ ok: false, code: 'INVALID_REQUEST' })
  if (signal?.aborted) return Promise.resolve({ ok: false, code: 'ABORTED' })
  const requestId = globalThis.crypto.randomUUID()

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: RawCaptureResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
      resolve(result)
    }
    const abort = () => finish({ ok: false, code: 'ABORTED' })
    const receive = (event: MessageEvent) => {
      const data = event.data
      if (event.source !== window || event.origin !== origin || !isRecord(data)
        || data.source !== 'medcloud2-extension' || data.type !== RAW_CAPTURE_RESULT
        || data.version !== 1 || data.requestId !== requestId) return
      if (data.ok !== true) {
        finish({ ok: false, code: typeof data.code === 'string' && EXTENSION_CODES.has(data.code) ? data.code as RawCaptureErrorCode : 'READ_FAILED' })
        return
      }
      if (!isMetadata(data.metadata, bundleId) || Date.now() >= data.metadata.expiresAt
        || typeof data.json !== 'string' || data.json.length !== data.metadata.totalCharacters) {
        finish({ ok: false, code: 'READ_FAILED' })
        return
      }
      finish({ ok: true, json: data.json, metadata: data.metadata })
    }
    const timer = setTimeout(() => finish({ ok: false, code: 'EXTENSION_UNAVAILABLE' }), timeoutMs)
    window.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    window.postMessage({ source: 'mediprisma', type: RAW_CAPTURE_REQUEST, version: 1, requestId, bundleId }, origin)
  })
}
