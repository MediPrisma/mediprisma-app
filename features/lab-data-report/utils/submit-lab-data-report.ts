// Sends a lab-data report to the `submitLabDataReport` Function. Uses the
// same header set as the feedback Function (Firebase ID token + App Check +
// Content-Type), all of which the Functions CORS allowlist already carries —
// this feature adds no request header. On `?site=vghtpe` the same report can
// also (or only) go to the hospital's Gateway, once one is configured.
import { getFeedbackRequestHeaders, getIdTokenRequestHeaders } from '@/src/application/feedback/feedback-request-headers'
import type { LabDataReportPayload, LabDataReportResponse } from '../types'

// The Function's own timeout (60 s). Giving up earlier told a clinician
// "failed" for a report that was in fact stored — seen on a cold start.
const SUBMIT_TIMEOUT_MS = 60_000
// A connection test stores nothing, but a cold Function still takes its time.
const CONNECTION_TEST_TIMEOUT_MS = 30_000
// Shared institution receiver/nginx contract: UTF-8 bytes of the final wire JSON.
export const INSTITUTION_LAB_REPORT_MAX_BODY_BYTES = 64 * 1024 * 1024

/**
 * SHA-256 of the exact payload. The Function stores one report per key and
 * uid, so pressing 送出 again after a timeout returns the first report id
 * instead of storing a duplicate. Changed content → a new key → a new report.
 */
export async function labDataReportSubmissionKey(body: string): Promise<string | undefined> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined // No SubtleCrypto (insecure context): send without a key.
  }
}

/**
 * The Function's URL. An explicit NEXT_PUBLIC_LAB_DATA_REPORT_URL wins;
 * otherwise it is derived from the feedback Function's URL, which every build
 * already receives: v2 Functions in one project and region share a host
 * suffix and differ only in the lower-cased function name, and the dev-*
 * group keeps its prefix (dev-sendfeedback-… → dev-submitlabdatareport-…).
 */
export function resolveLabDataReportUrl(
  env: { explicit?: string; feedback?: string } = {
    explicit: process.env.NEXT_PUBLIC_LAB_DATA_REPORT_URL,
    feedback: process.env.NEXT_PUBLIC_FEEDBACK_URL,
  },
): string | null {
  const explicit = env.explicit?.trim()
  if (explicit) return explicit
  const feedback = env.feedback?.trim()
  if (!feedback) return null
  try {
    const url = new URL(feedback)
    // Cloud Run style: https://[dev-]sendfeedback-<hash>-<region>.a.run.app
    const runHost = url.hostname.match(/^(dev-)?sendfeedback-(.+\.run\.app)$/)
    if (runHost) {
      url.hostname = `${runHost[1] ?? ''}submitlabdatareport-${runHost[2]}`
      return url.toString().replace(/\/$/, '')
    }
    // cloudfunctions.net / emulator style: …/[dev-]sendFeedback
    const path = url.pathname.match(/^(.*\/)(dev-)?sendFeedback\/?$/)
    if (path) {
      url.pathname = `${path[1]}${path[2] ?? ''}submitLabDataReport`
      return url.toString()
    }
  } catch {
    // Not a URL (e.g. the relative /api/feedback dev fallback).
  }
  return null
}

/**
 * The hospital Gateway's receiving endpoint for 團隊和機構 / 僅機構, set per
 * build in NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL. Unset — the default until
 * the Gateway route exists — means the institution is never contacted, not
 * even probed. HTTPS only (plain HTTP on loopback for a local Gateway), and
 * no credentials, query or fragment: the URL is public in the bundle.
 */
export function resolveInstitutionReportUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_LAB_REPORT_INSTITUTION_URL,
): string | null {
  const configured = value?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (url.username || url.password || url.search || url.hash) return null
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Where a report goes: the development team's Function, or the hospital's
 *  own Gateway (北榮, offered on `?site=vghtpe`). */
export type LabDataReportDestination = 'team' | 'institution'

export type LabDataReportSubmitResult =
  | { ok: true; reportId: string }
  | { ok: false; status: number | 'timeout' | 'network' | 'unconfigured'; reason?: string }

export type LabDataReportConnectionResult =
  | { ok: true }
  | Extract<LabDataReportSubmitResult, { ok: false }>

/** The team's Function takes the feedback header set; the Gateway only the
 *  Firebase ID token it verifies — the App Check token and the proxy key are
 *  for Firebase and stay there. */
async function destinationHeaders(destination: LabDataReportDestination): Promise<Record<string, string>> {
  return destination === 'team' ? getFeedbackRequestHeaders() : getIdTokenRequestHeaders()
}

function destinationUrl(destination: LabDataReportDestination): string | null {
  return destination === 'team' ? resolveLabDataReportUrl() : resolveInstitutionReportUrl()
}

type Posted =
  | { response: Response; result: LabDataReportResponse }
  | { ok: false; status: 'timeout' | 'network' }
  | { ok: false; status: 413; reason: 'payload_too_large' }

/**
 * The answer as far as it has the expected shape. Another receiver (the
 * Gateway) may answer anything — `null`, an array, a number for a reason —
 * and that must come back as a failed send, never as a throw that leaves
 * the toast or the connection test spinning.
 */
function readAnswer(value: unknown): LabDataReportResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { success: false }
  const answer = value as Record<string, unknown>
  return {
    success: answer.success === true,
    ...(typeof answer.reportId === 'string' && answer.reportId && { reportId: answer.reportId }),
    ...(answer.connectionTest === true && { connectionTest: true }),
    ...(typeof answer.reason === 'string' && { reason: answer.reason }),
  }
}

async function post(
  destination: LabDataReportDestination,
  url: string,
  body: () => Promise<string>,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number },
): Promise<Posted> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const [headers, text] = await Promise.all([destinationHeaders(destination), body()])
    // Measure the exact fetch body, including submissionKey and JSON escaping.
    // Blob.size counts UTF-8 bytes, not UTF-16 string length. Never trim or reroute.
    if (destination === 'institution' && new Blob([text]).size > INSTITUTION_LAB_REPORT_MAX_BODY_BYTES) {
      return { ok: false, status: 413, reason: 'payload_too_large' }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: text,
      signal: controller.signal,
      // The Gateway is another site: no cookies, no referrer (the page URL
      // carries the launch parameters), no redirect elsewhere.
      ...(destination === 'institution' && {
        credentials: 'omit' as const,
        referrerPolicy: 'no-referrer' as const,
        redirect: 'error' as const,
        cache: 'no-store' as const,
      }),
    })
    const result = readAnswer(await response.json().catch(() => null))
    return { response, result }
  } catch {
    return { ok: false, status: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/**
 * Sends the report to one destination. Both take the same body and answer
 * `{ success, reportId }`; both get the submission key, so a 重試 after a
 * timeout returns the first report instead of storing a second one.
 */
export async function submitLabDataReport(
  payload: LabDataReportPayload,
  {
    signal,
    destination = 'team',
    url = destinationUrl(destination),
  }: { signal?: AbortSignal; destination?: LabDataReportDestination; url?: string | null } = {},
): Promise<LabDataReportSubmitResult> {
  if (!url) return { ok: false, status: 'unconfigured' }
  const report = JSON.stringify(payload)
  const sent = await post(destination, url, async () => {
    const submissionKey = await labDataReportSubmissionKey(report)
    return submissionKey ? JSON.stringify({ ...payload, submissionKey }) : report
  }, { signal, timeoutMs: SUBMIT_TIMEOUT_MS })
  if (!('response' in sent)) return sent
  const { response, result } = sent
  if (!response.ok || result.success !== true || !result.reportId) {
    return { ok: false, status: response.status, reason: result.reason }
  }
  return { ok: true, reportId: result.reportId }
}

/**
 * 僅連線測試: `{"connectionTest": true}` and nothing else — no row, no note,
 * nothing about the patient. A destination that is not set up is not
 * contacted (`unconfigured`). The team's Function answers once the request
 * has passed CORS, App Check and sign-in, and stores nothing.
 */
export async function testLabDataReportConnection(
  destination: LabDataReportDestination,
  { signal, url = destinationUrl(destination) }: { signal?: AbortSignal; url?: string | null } = {},
): Promise<LabDataReportConnectionResult> {
  if (!url) return { ok: false, status: 'unconfigured' }
  const sent = await post(destination, url, async () => JSON.stringify({ connectionTest: true }), {
    signal,
    timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
  })
  if (!('response' in sent)) return sent
  const { response, result } = sent
  if (!response.ok || result.success !== true || result.connectionTest !== true) {
    return { ok: false, status: response.status, reason: result.reason }
  }
  return { ok: true }
}
