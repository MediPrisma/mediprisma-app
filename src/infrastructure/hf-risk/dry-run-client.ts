import { HF_MAX_BYTES, HF_DRY_RUN_CLAIMS, parseHfDryRunResponse, type HfInput, type HfDryRunResult } from '@/src/core/hf-risk/contract'
import { parseHfPredictionResult, type HfPredictionResult } from '@/src/core/hf-risk/prediction-result'
import { isHfSyntheticPreview } from '@/src/core/hf-risk/synthetic-preview'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'
import { isHfErrorCode, type HfDiagnosticRecord, type HfRequestDiagnostic, type HfErrorCode } from '@/src/core/hf-risk/diagnostics'

export function hfGatewayUrl(origin: string): string {
  let url: URL
  try { url = new URL(origin) } catch { throw new Error('gateway-config') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('gateway-config')
  return new URL('/hf/v1/dry-run', url).href
}
export type HfAuthPolicy = 'firebase' | 'intranet'
export function hfAuthPolicy(value: string | undefined): HfAuthPolicy {
  if (!value || value === 'firebase') return 'firebase'
  if (value === 'intranet') return 'intranet'
  throw new Error('gateway-config')
}
export interface HfRequestOptions {
  origin: string; token?: string; authPolicy?: HfAuthPolicy; signal: AbortSignal; requestId?: string; fetch?: typeof fetch
  onDiagnostic?: (record: HfDiagnosticRecord) => void
}
export async function requestHfDryRun(input: HfInput, options: HfRequestOptions): Promise<HfDryRunResult> {
  return requestHf(input, options, 'dry-run') as Promise<HfDryRunResult>
}
export async function requestHfPrediction(input: HfInput, options: HfRequestOptions): Promise<HfPredictionResult> {
  return requestHf(input, options, 'predict') as Promise<HfPredictionResult>
}
/** Explicit operations and fixed HTTPS destination. Never pass a model service token from the browser. */
async function requestHf(input: HfInput, options: HfRequestOptions, operation: 'dry-run' | 'predict'): Promise<HfDryRunResult | HfPredictionResult> {
  const started = Date.now()
  const sentRequestId = options.requestId ?? crypto.randomUUID()
  const diagnostic: HfRequestDiagnostic = { requestId: sentRequestId, operation, claim: input.claim, indexDate: input.indexDate,
    startedAt: new Date(started).toISOString(), elapsedMs: 0, stage: 'prepare', httpStatus: null, errorCode: null,
    verdict: null, requestBytes: 0, responseBytes: 0, responseType: 'missing', responseIdMatched: null }
  let inputJson: string | null = null
  let timedOut = false
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const policy = hfAuthPolicy(options.authPolicy)
    if ((policy === 'firebase' && !options.token) || !HF_DRY_RUN_CLAIMS.includes(input.claim) || !validateHfTransportBundle(input.bundle, input.indexDate)) throw new Error('input-invalid')
    const url = new URL(hfGatewayUrl(options.origin))
    url.pathname = '/hf/v1/' + operation
    url.searchParams.set('claim', input.claim)
    url.searchParams.set('indexDate', input.indexDate)
    url.searchParams.set('dryRun', operation === 'dry-run' ? 'true' : 'false')
    let requestTarget = url.href
    const localPreview = process.env.NEXT_PUBLIC_HF_LOCAL_PREVIEW_RELAY
    if (localPreview) {
      if (process.env.NODE_ENV !== 'development' || localPreview !== 'synthetic' || options.origin !== 'https://samd.mediprisma.tw' || policy !== 'intranet') throw new Error('gateway-config')
      if (!await isHfSyntheticPreview(input.bundle)) throw new Error('preview-fixture-required')
      requestTarget = '/__hf-local-preview' + url.pathname + url.search
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sentRequestId)) throw new Error('input-invalid')
    const body = JSON.stringify(input.bundle)
    diagnostic.requestBytes = new Blob([body]).size
    if (diagnostic.requestBytes > HF_MAX_BYTES) throw new Error('input-too-large')
    inputJson = body
    if (options.signal.aborted) controller.abort()
    timer = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    if (controller.signal.aborted) throw new Error('request-aborted')
    diagnostic.stage = 'connect'
    const response = await (options.fetch ?? fetch)(requestTarget, {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/fhir+json', Accept: operation === 'dry-run' ? 'application/fhir+json' : 'application/json',
        ...(policy === 'firebase' ? { Authorization: 'Bearer ' + options.token } : {}), 'X-Request-ID': sentRequestId },
      body,
    })
    diagnostic.stage = 'response'
    diagnostic.httpStatus = response.status
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    diagnostic.responseType = !contentType ? 'missing' : contentType === 'application/json' ? 'json' : contentType === 'application/fhir+json' ? 'fhir+json' : 'other'
    const echoedRequestId = response.headers.get('x-request-id')
    diagnostic.responseIdMatched = echoedRequestId ? echoedRequestId === sentRequestId : null
    const adapter = response.headers.get('x-samd-adapter-version')
    if (adapter && /^[0-9a-z.-]{1,40}$/i.test(adapter)) diagnostic.adapterVersion = adapter
    if (![200, 422].includes(response.status) && !(operation === 'predict' && response.status === 502)) {
      void response.body?.cancel().catch(() => {})
      const code = ({ 400: 'gateway-input-rejected', 401: 'gateway-unauthorized', 403: 'gateway-unauthorized', 404: 'gateway-not-found', 413: 'gateway-payload-too-large', 415: 'gateway-content-type', 429: 'gateway-rate-limited', 504: 'gateway-upstream-timeout' } as Record<number, HfErrorCode>)[response.status] ?? 'gateway-unavailable'
      throw new Error(code)
    }
    if (!response.body) throw new Error(response.status === 502 ? 'gateway-unavailable' : 'response-empty')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        diagnostic.responseBytes = size
        if (size > HF_MAX_BYTES) { await reader.cancel(); throw new Error('response-too-large') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    if (size === 0) throw new Error(response.status === 502 ? 'gateway-unavailable' : 'response-empty')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const content = new TextDecoder().decode(bytes)
    if (response.status === 502) {
      let failure: { resourceType?: string; issue?: { code?: string }[] } | null = null
      try { failure = JSON.parse(content) } catch { /* An ingress error page is an upstream failure. */ }
      if (failure?.resourceType === 'OperationOutcome' && Array.isArray(failure.issue) && failure.issue.length === 1 && failure.issue[0]?.code === 'invalid') {
        diagnostic.stage = 'parse'
        throw new Error('invalid-prediction-response')
      }
      throw new Error('gateway-unavailable')
    }
    diagnostic.stage = 'parse'
    let parsed: unknown
    try { parsed = JSON.parse(content) } catch { throw new Error('invalid-json-response') }
    const value = operation === 'dry-run' ? parseHfDryRunResponse(response.status, parsed) : parseHfPredictionResult(response.status, parsed, input)
    diagnostic.verdict = value.verdict
    const requestId = response.headers.get('x-request-id')
    const adapterVersion = response.headers.get('x-samd-adapter-version')
    return { ...value, checkedAt: new Date().toISOString(),
      ...(requestId === sentRequestId ? { requestId } : {}),
      ...(adapterVersion && /^[0-9a-z.-]{1,40}$/i.test(adapterVersion) ? { adapterVersion } : {}) }

  } catch (error) {
    // Never show/store arbitrary exception text: fetch and parser errors can contain URLs or content.
    const code: HfErrorCode = timedOut ? 'request-timeout' : options.signal.aborted ? 'request-aborted'
      : error instanceof Error && isHfErrorCode(error.message) ? error.message
      : diagnostic.stage === 'connect' ? 'gateway-network' : diagnostic.stage === 'response' ? 'response-interrupted'
      : diagnostic.stage === 'parse' ? operation === 'predict' ? 'invalid-prediction-response' : 'invalid-dry-run-response' : 'input-invalid'
    diagnostic.errorCode = code
    throw new Error(code)
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', abort)
    diagnostic.elapsedMs = Math.min(86_400_000, Math.max(0, Date.now() - started))
    try { options.onDiagnostic?.({ diagnostic, inputJson }) } catch { /* Reporting must never change the clinical request outcome. */ }
  }
}
