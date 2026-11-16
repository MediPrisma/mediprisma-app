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

export function collectorError(error: unknown) {
  try { return classifyAiOutcome(error) }
  catch { return 'error' as const }
}
