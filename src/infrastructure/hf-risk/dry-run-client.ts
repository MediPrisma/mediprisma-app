import { HF_MAX_BYTES, HF_DRY_RUN_CLAIMS, parseHfDryRunResponse, type HfInput, type HfDryRunResult } from '@/src/core/hf-risk/contract'
import { parseHfPredictionResult, type HfPredictionResult } from '@/src/core/hf-risk/prediction-result'
import { isHfSyntheticPreview } from '@/src/core/hf-risk/synthetic-preview'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'

export function hfGatewayUrl(origin: string): string {
  const url = new URL(origin)
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
}
export async function requestHfDryRun(input: HfInput, options: HfRequestOptions): Promise<HfDryRunResult> {
  return requestHf(input, options, 'dry-run') as Promise<HfDryRunResult>
}
export async function requestHfPrediction(input: HfInput, options: HfRequestOptions): Promise<HfPredictionResult> {
  return requestHf(input, options, 'predict') as Promise<HfPredictionResult>
}
/** Explicit operations and fixed HTTPS destination. Never pass a model service token from the browser. */
async function requestHf(input: HfInput, options: HfRequestOptions, operation: 'dry-run' | 'predict'): Promise<HfDryRunResult | HfPredictionResult> {
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
  const sentRequestId = options.requestId ?? crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sentRequestId)) throw new Error('input-invalid')
  const body = JSON.stringify(input.bundle)
  if (new Blob([body]).size > HF_MAX_BYTES) throw new Error('input-too-large')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal.aborted) controller.abort()
  options.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 15000)
  try {
    if (controller.signal.aborted) throw new Error('request-aborted')
    const response = await (options.fetch ?? fetch)(requestTarget, {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/fhir+json', Accept: operation === 'dry-run' ? 'application/fhir+json' : 'application/json',
        ...(policy === 'firebase' ? { Authorization: 'Bearer ' + options.token } : {}), 'X-Request-ID': sentRequestId },
      body,
    })
    if ([401, 403].includes(response.status)) throw new Error('gateway-unauthorized')
    if (![200, 422].includes(response.status) && !(operation === 'predict' && response.status === 502)) throw new Error('gateway-unavailable')
    if (!response.body) throw new Error('gateway-unavailable')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > HF_MAX_BYTES) { await reader.cancel(); throw new Error('response-too-large') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const content = new TextDecoder().decode(bytes)
    if (response.status === 502) {
      const failure = JSON.parse(content)
      if (failure?.resourceType === 'OperationOutcome' && Array.isArray(failure.issue) && failure.issue.length === 1 && failure.issue[0]?.code === 'invalid') throw new Error('invalid-prediction-response')
      throw new Error('gateway-unavailable')
    }
    const value = operation === 'dry-run' ? parseHfDryRunResponse(response.status, JSON.parse(content)) : parseHfPredictionResult(response.status, JSON.parse(content), input)
    const requestId = response.headers.get('x-request-id')
    const adapterVersion = response.headers.get('x-samd-adapter-version')
    return { ...value, checkedAt: new Date().toISOString(),
      ...(requestId === sentRequestId ? { requestId } : {}),
      ...(adapterVersion && /^[0-9a-z.-]{1,40}$/i.test(adapterVersion) ? { adapterVersion } : {}) }

  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', abort)
  }
}
