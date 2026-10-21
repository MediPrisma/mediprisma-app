'use client'

export { beginCollectorObservation, collectorFeature, collectorStatus, cancelCollectorRequests, isCollectorSite } from '@/src/infrastructure/telemetry/collector'
export type { CollectorContext, CollectorOperation } from '@/src/infrastructure/telemetry/collector'
import { classifyAiOutcome } from './ai-outcome'

export function collectorError(error: unknown) {
  try { return classifyAiOutcome(error) }
  catch { return 'error' as const }
}
