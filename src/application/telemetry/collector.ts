'use client'

export { beginCollectorObservation, collectorFeature, collectorStatus, cancelCollectorRequests, isCollectorSite } from '@/src/infrastructure/telemetry/collector'
export type { CollectorContext, CollectorOperation, CollectorAbortReason } from '@/src/infrastructure/telemetry/collector'
import type { GatewayFailure } from '@/src/infrastructure/telemetry/collector'
import { gatewayErrorCodeSchema } from '@/src/shared/contracts/collector-event'
import { INTRANET_LUNA_ID } from '@/src/infrastructure/ai/interceptors/intranet-fetch'
import { classifyAiOutcome } from './ai-outcome'
import { setCollectorCustomModelNameResolver } from '@/src/infrastructure/telemetry/collector'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { resolveOpenAiCompatibleProfile } from '@/src/shared/utils/openai-compatible.utils'

// D089: the collector reports a user-defined endpoint by the model name its profile sets.
// The collector checks the format; a name outside it is sent as 'custom'.
setCollectorCustomModelNameResolver((modelId) =>
  resolveOpenAiCompatibleProfile(modelId, useAiConfigStore.getState().openAiCompatibleProfiles)?.modelId)

/** HTTP status the AI service answered with: `statusCode` on the SDK's APICallError (also when wrapped
 *  in RetryError or a cause), or `context.status` on the AiError our own query services throw.
 *  Undefined when no HTTP response was received. Never the body or message. */
export function collectorHttpStatus(error: unknown): number | undefined {
  try {
    const seen = new Set<object>()
    const visit = (value: unknown, depth: number): number | undefined => {
      if (typeof value !== 'object' || value === null || depth > 4 || seen.has(value)) return undefined
      seen.add(value)
      const item = value as { statusCode?: unknown; context?: { status?: unknown } | null; lastError?: unknown; cause?: unknown; error?: unknown; errors?: unknown }
      for (const status of [item.statusCode, item.context?.status])
        if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return status
      for (const nested of [item.lastError, item.cause, item.error, ...(Array.isArray(item.errors) ? item.errors : [])]) {
        const found = visit(nested, depth + 1)
        if (found !== undefined) return found
      }
      return undefined
    }
    return visit(error, 0)
  } catch { return undefined }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** What the hospital AI gateway said when it refused or failed a request to the intranet model: its fixed
 *  error code (anything unlisted becomes 'other'), whether it reached the upstream model, and its random
 *  request ID. Read from the SDK's APICallError (streaming) or from the `context.gateway` our own query
 *  service keeps on its AiError; other models and failures without an HTTP response report nothing.
 *  Never the message or the rest of the body. */
export function collectorGatewayFailure(error: unknown, modelId: string): GatewayFailure | undefined {
  try {
    if (modelId !== INTRANET_LUNA_ID) return undefined
    const seen = new Set<object>()
    type Call = { statusCode?: unknown; responseHeaders?: unknown; responseBody?: unknown; context?: { gateway?: unknown } | null
      lastError?: unknown; cause?: unknown; error?: unknown; errors?: unknown }
    const find = (value: unknown, depth: number): Call | undefined => {
      if (typeof value !== 'object' || value === null || depth > 4 || seen.has(value)) return undefined
      seen.add(value)
      const item = value as Call
      if (typeof item.statusCode === 'number' || (item.context?.gateway && typeof item.context.gateway === 'object')) return item
      for (const nested of [item.lastError, item.cause, item.error, ...(Array.isArray(item.errors) ? item.errors : [])]) {
        const found = find(nested, depth + 1)
        if (found) return found
      }
      return undefined
    }
    const call = find(error, 0)
    if (!call) return undefined
    const text = (value: unknown) => typeof value === 'string' ? value : undefined
    let code: unknown, attempted: string | undefined, requestId: string | undefined
    if (typeof call.statusCode === 'number') {
      const headers = call.responseHeaders && typeof call.responseHeaders === 'object' ? call.responseHeaders as Record<string, unknown> : {}
      try { code = typeof call.responseBody === 'string' ? JSON.parse(call.responseBody)?.error?.code : undefined } catch { /* not the gateway's JSON */ }
      attempted = text(headers['x-upstream-attempted']); requestId = text(headers['x-request-id'])
    } else {
      const kept = call.context!.gateway as { code?: unknown; upstreamAttempted?: unknown; requestId?: unknown }
      code = kept.code; attempted = text(kept.upstreamAttempted); requestId = text(kept.requestId)
    }
    const listed = gatewayErrorCodeSchema.safeParse(code)
    const failure: GatewayFailure = {
      ...(typeof code === 'string' ? { gateway_error_code: listed.success ? listed.data : 'other' } : {}),
      ...(attempted === 'true' || attempted === 'false' ? { upstream_attempted: attempted === 'true' } : {}),
      ...(requestId && UUID.test(requestId) ? { gateway_request_id: requestId.toLowerCase() } : {}),
    }
    return Object.keys(failure).length ? failure : undefined
  } catch { return undefined }
}

/** The AI SDK's finish reason in the usage record's closed set; a value it does not know is 'unreported'.
 *  Nothing is reported when the service gave no reason at all. */
export function collectorFinishReason(reason: string | undefined) {
  if (reason === undefined) return undefined
  const known = { stop: 'stop', length: 'length', 'content-filter': 'content_filter', 'tool-calls': 'tool_calls', error: 'error', other: 'other' } as const
  return Object.hasOwn(known, reason) ? known[reason as keyof typeof known] : 'unreported' as const
}

export function collectorError(error: unknown) {
  try { return classifyAiOutcome(error) }
  catch { return 'error' as const }
}
