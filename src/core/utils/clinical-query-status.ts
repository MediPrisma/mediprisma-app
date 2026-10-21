import type { ClinicalDataQueryStatus } from '@/src/core/entities/clinical-data.entity'

export const MEDICATION_CONTENT_UNAVAILABLE_MESSAGE = 'Medication prescriptions exist; referenced drug content is unavailable. Current drug classes and medication absence cannot be concluded.'

/** A drug-content gap is usable missing input, never ownership loss, an
 * invalid modifier, or a failed query. Stale ownership flags cannot hide them. */
export function medicationContentOwnsIncompleteStatus(status: ClinicalDataQueryStatus | undefined): boolean {
  return status?.state === 'incomplete' && status.medicationContentOnlyIncomplete === true
    && !status.exclusionReason && !(status.excludedCount && status.excludedCount > 0)
    && !Object.values(status.exclusionCounts ?? {}).some(count => (count ?? 0) > 0)
}

/** Modifier completeness is projected after content. Its count must block
 * consumers without destroying content's recovery metadata between stages. */
export function isMedicationContentOnlyIncomplete(status: ClinicalDataQueryStatus | undefined): boolean {
  return medicationContentOwnsIncompleteStatus(status)
    && !((status?.invalidModifierCount ?? 0) > 0)
}
