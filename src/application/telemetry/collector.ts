'use client'

export { beginCollectorObservation, collectorFeature, collectorStatus, cancelCollectorRequests, isCollectorSite } from '@/src/infrastructure/telemetry/collector'
export type { CollectorContext, CollectorOperation } from '@/src/infrastructure/telemetry/collector'
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

export function collectorError(error: unknown) {
  try { return classifyAiOutcome(error) }
  catch { return 'error' as const }
}
