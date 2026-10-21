import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
export { clinicalEncounterAlias, recordClinicalEncounterAliases } from '@/src/core/services/clinical-encounter-alias'
// Local domain policies can represent a source measurement on another entity
// (Roche staging on Condition). Keep raw evidence without reviving an orphan row.
const dispositions = new WeakMap<ClinicalReconciliationResult, ReadonlySet<string>>()
export function recordClinicalProjectionDisposition(source: ClinicalReconciliationResult, representedKeys: readonly string[]): void {
  dispositions.set(source, new Set(representedKeys))
}
export function isClinicalSourceRepresentedElsewhere(source: ClinicalReconciliationResult, key: string): boolean {
  return dispositions.get(source)?.has(key) ?? false
}
