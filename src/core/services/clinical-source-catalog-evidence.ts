import type { ClinicalReconciliationResult } from './clinical-reconciliation'
import { clinicalEncounterAlias } from './clinical-encounter-alias'
import type { EncounterEntity } from '@/src/core/entities/clinical-data.entity'

export type ScopedEncounterReference = { encounterId: string; organization?: string }
type EncounterReferenceEvidence = Map<string, ScopedEncounterReference | null>
const scopedEvidence = new WeakMap<object, EncounterReferenceEvidence>()

/**
 * Carry only graph-validated encounter organizations across the AI scope
 * boundary. The WeakMap keeps graph keys and source resources out of AI data.
 */
export function registerScopedEncounterReferenceEvidence(
  _scoped: object,
  documents: readonly object[],
  values: readonly EncounterReferenceEvidence[],
): void {
  documents.forEach((document, index) => scopedEvidence.set(document, values[index] ?? new Map()))
}

/** undefined means no graph-backed scope registration; null means a registered
 * document/path whose edge was not safely resolved. */
export function scopedEncounterReferenceOrganization(
  document: object,
  path: string,
): ScopedEncounterReference | null | undefined {
  const paths = scopedEvidence.get(document)
  if (!paths) return undefined
  if (!paths.has(path)) return null
  return paths.get(path) ?? null
}

/** Resolve an encounter edge only when graph, alias, and visible row agree. */
export function graphEncounterReferenceOrganization(
  source: ClinicalReconciliationResult,
  originNodeKey: string | undefined,
  path: string,
  reference: string | undefined,
  encounters: readonly EncounterEntity[],
): ScopedEncounterReference | undefined {
  if (!reference || !originNodeKey) return undefined
  const targets = new Map<string, EncounterEntity>()
  for (const edge of source.graph.references) {
    if (edge.origin.key !== originNodeKey || edge.path !== path || edge.status !== 'resolved') continue
    for (const targetKey of edge.targetKeys) {
      const visibleKey = clinicalEncounterAlias(source, targetKey) ?? targetKey
      for (const encounter of encounters) {
        if (encounter.clinicalSourceNodeKey === visibleKey) targets.set(encounter.id, encounter)
      }
    }
  }
  if (targets.size !== 1) return undefined
  const [encounter] = targets.values()
  const currentReferenceMatches = source.graph.references.some(edge =>
    edge.origin.key === originNodeKey && edge.path === path && edge.status === 'resolved'
      && edge.targetKeys.some(targetKey => {
        const visibleKey = clinicalEncounterAlias(source, targetKey) ?? targetKey
        return encounters.some(row => row.clinicalSourceNodeKey === visibleKey && row.id === encounter.id)
      })
      && (edge.reference === reference || reference === `Encounter/${encounter.id}`),
  )
  return currentReferenceMatches ? {
    encounterId: encounter.id,
    ...(encounter.serviceProvider?.display?.trim() ? { organization: encounter.serviceProvider.display.trim() } : {}),
  } : undefined
}
