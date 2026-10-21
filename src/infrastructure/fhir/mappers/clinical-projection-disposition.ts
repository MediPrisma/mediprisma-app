import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
// Local domain policies can represent a source measurement on another entity
// (Roche staging on Condition). Keep raw evidence without reviving an orphan row.
const dispositions = new WeakMap<ClinicalReconciliationResult, ReadonlySet<string>>()
export function recordClinicalProjectionDisposition(source: ClinicalReconciliationResult, representedKeys: readonly string[]): void {
  dispositions.set(source, new Set(representedKeys))
}
export function isClinicalSourceRepresentedElsewhere(source: ClinicalReconciliationResult, key: string): boolean {
  return dispositions.get(source)?.has(key) ?? false
}

const encounterAliases = new WeakMap<ClinicalReconciliationResult, ReadonlyMap<string, string>>()
/** Only the local confirmed encounter policy may register these node aliases. */
export function recordClinicalEncounterAliases(source: ClinicalReconciliationResult, aliases: ReadonlyMap<string, string>): void {
  encounterAliases.set(source, new Map(aliases))
}
export function clinicalEncounterAlias(source: ClinicalReconciliationResult, key: string): string | undefined {
  return encounterAliases.get(source)?.get(key)
}
