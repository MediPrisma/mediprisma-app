import type { ClinicalReconciliationResult } from './clinical-reconciliation'

const encounterAliases = new WeakMap<ClinicalReconciliationResult, ReadonlyMap<string, string>>()

/** Only a confirmed local encounter policy may register source-node aliases. */
export function recordClinicalEncounterAliases(source: ClinicalReconciliationResult, aliases: ReadonlyMap<string, string>): void {
  encounterAliases.set(source, new Map(aliases))
}

export function clinicalEncounterAlias(source: ClinicalReconciliationResult, key: string): string | undefined {
  return encounterAliases.get(source)?.get(key)
}
