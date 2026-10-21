import type { ClinicalDataQueryStatus } from '@/src/core/entities/clinical-data.entity'

/** A drug-content gap is usable missing input, never ownership loss, an
 * invalid modifier, or a failed query. Stale ownership flags cannot hide them. */
export function isMedicationContentOnlyIncomplete(status: ClinicalDataQueryStatus | undefined): boolean {
  return status?.state === 'incomplete' && status.medicationContentOnlyIncomplete === true
    && !status.exclusionReason && !(status.excludedCount && status.excludedCount > 0)
    && !Object.values(status.exclusionCounts ?? {}).some(count => (count ?? 0) > 0)
    && !(status.invalidModifierCount && status.invalidModifierCount > 0)
}
