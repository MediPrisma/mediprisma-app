import { readClinicalMedicationContentModifier, hasMalformedClinicalModifier } from '@/src/core/services/clinical-record-variant-modifier'
import { createClinicalRecordResolution } from '@/src/core/services/clinical-record-resolution'
import type { MedicationEntity, ClinicalDataQueryKey, ClinicalDataQueryStatus } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { clinicalSourceResourcesEqual } from '@/src/core/services/clinical-source-graph'
import { isClinicalSourceNodePatientEligible } from '@/src/core/services/clinical-patient-scope'
import { mutableClinicalProjection } from '../services/clinical-source-session'

/** Re-evaluate the choice element against the final graph, including Medication
 * resources obtained by another query. No reference-tail or identifier guesses. */
export function projectClinicalMedicationContents(rows: MedicationEntity[], source: ClinicalReconciliationResult): MedicationEntity[] {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const resolution = createClinicalRecordResolution(source)
  const edges = new Map(source.graph.references.filter(edge => edge.path === 'medicationReference').map(rawEdge => { const edge = resolution.reference(rawEdge); return [edge.origin.key, edge] }))
  let changed = false
  const projected = rows.map(row => {
    const origin = row.clinicalSourceNodeKey ? nodes.get(row.clinicalSourceNodeKey) : undefined
    if (!origin || !['MedicationRequest', 'MedicationStatement'].includes(origin.resource.resourceType)) return row
    const raw = origin.resource
    const importedUncertainty = readClinicalMedicationContentModifier(raw)
    if (!raw.medicationReference && !raw.medicationCodeableConcept && !importedUncertainty) return row
    let uncertainty: MedicationEntity['clinicalMedicationContentUncertainty']
    const mapped = !importedUncertainty && (row.clinicalMedicationCodeProvenance === 'mapped-policy' || !!raw.medicationCodeableConcept)
    let code = (mapped ? row.medicationCodeableConcept ?? raw.medicationCodeableConcept : undefined) as MedicationEntity['medicationCodeableConcept']
    let provenance: MedicationEntity['clinicalMedicationCodeProvenance'] = code ? 'mapped-policy' : undefined
    if (!code && !importedUncertainty) {
      const edge = edges.get(origin.key)
      uncertainty = { reason: edge?.status === 'ambiguous' ? 'ambiguous-reference' : edge?.status === 'resolved' ? 'missing-medication-code' : 'unresolved-reference' }
      const targets = edge?.status === 'resolved' ? edge.targetKeys.map(key => nodes.get(key)) : []
      const first = targets[0]
      if (first && targets.every(target => target && target.resource.resourceType === 'Medication' && !target.embeddedIn
        && isClinicalSourceNodePatientEligible(target, source.graph.nodes) && !hasMalformedClinicalModifier(target.resource)
        && !readClinicalMedicationContentModifier(target.resource)
        && clinicalSourceResourcesEqual(target.resource, first.resource))) {
        code = first.resource.code as MedicationEntity['medicationCodeableConcept']
      }
    }
    if (importedUncertainty) uncertainty = importedUncertainty
    if (code) { uncertainty = undefined; provenance ??= 'graph-reference' }
    // A code without provenance is unverified, not proof of a drug identity.
    // Only a known graph promotion may be revoked when its edge disappears.
    if (!importedUncertainty && !code && row.medicationCodeableConcept && !row.clinicalMedicationCodeProvenance) code = row.medicationCodeableConcept
    if ((clinicalSourceResourcesEqual(row.medicationCodeableConcept, code) || row.medicationCodeableConcept === code)
      && row.clinicalMedicationContentUncertainty?.reason === uncertainty?.reason
      && row.clinicalMedicationCodeProvenance === provenance) return row
    changed = true
    const { medicationCodeableConcept: _previous, clinicalMedicationContentUncertainty: _oldUncertainty, clinicalMedicationCodeProvenance: _oldProvenance, ...rest } = row
    return { ...rest, ...(code ? { medicationCodeableConcept: mutableClinicalProjection(code) } : {}), ...(uncertainty ? { clinicalMedicationContentUncertainty: uncertainty } : {}), ...(provenance ? { clinicalMedicationCodeProvenance: provenance } : {}) }
  })
  return changed ? projected : rows
}

const CONTENT_UNCERTAINTY_MESSAGE = 'Medication prescriptions exist; referenced drug content is unavailable. Current drug classes and medication absence cannot be concluded.'

/** Content uncertainty is distinct from an absent medication history. */
export function projectClinicalMedicationQueryStatus(rows: MedicationEntity[], input: Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> = {}): Partial<Record<ClinicalDataQueryKey, ClinicalDataQueryStatus>> {
  let result = input
  for (const type of ['MedicationRequest', 'MedicationStatement'] as const) {
    const count = rows.filter(row => (row._sourceResourceType ?? 'MedicationRequest') === type && row.clinicalMedicationContentUncertainty).length
    const previous = input[type]
    if (!count) {
      if (!previous?.medicationContentUncertaintyCount) continue
      const { medicationContentUncertaintyCount: _previousCount, medicationContentOnlyIncomplete: _previousOwnership, ...rest } = previous
      const rowCount = rows.filter(row => (row._sourceResourceType ?? 'MedicationRequest') === type).length
      const recovered: ClinicalDataQueryStatus = previous.state === 'incomplete' && previous.medicationContentOnlyIncomplete === true
        ? { ...rest, count: rowCount, state: rowCount ? 'ok' : 'empty', message: undefined } : rest
      if (result === input) result = { ...input }
      result[type] = recovered
      continue
    }
    // Content completeness is independent of transport success. Preserve a
    // real failure or refresh state, including authorization diagnostics.
    const ownsContentState = previous?.state === 'incomplete' && previous.medicationContentOnlyIncomplete === true
    const preserveQueryState = previous && previous.state !== 'ok' && previous.state !== 'empty' && !ownsContentState
    const status: ClinicalDataQueryStatus = { ...previous, resourceType: type,
      state: preserveQueryState ? previous.state : 'incomplete', medicationContentUncertaintyCount: count,
      ...(!preserveQueryState ? { medicationContentOnlyIncomplete: true } : {}),
      message: preserveQueryState ? previous.message : CONTENT_UNCERTAINTY_MESSAGE }
    if (preserveQueryState) delete status.medicationContentOnlyIncomplete
    if (JSON.stringify(previous) === JSON.stringify(status)) continue
    if (result === input) result = { ...input }
    result[type] = status
  }
  return result
}
