import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import type { ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { clinicalSourceResourcesEqual } from '@/src/core/services/clinical-source-graph'
import { isClinicalSourceNodePatientEligible } from '@/src/core/services/clinical-patient-scope'
import { mutableClinicalProjection } from '../services/clinical-source-session'

/** Re-evaluate the choice element against the final graph, including Medication
 * resources obtained by another query. No reference-tail or identifier guesses. */
export function projectClinicalMedicationContents(rows: MedicationEntity[], source: ClinicalReconciliationResult): MedicationEntity[] {
  const nodes = new Map(source.graph.nodes.map(node => [node.key, node]))
  const edges = new Map(source.graph.references.filter(edge => edge.path === 'medicationReference').map(edge => [edge.origin.key, edge]))
  let changed = false
  const projected = rows.map(row => {
    const origin = row.clinicalSourceNodeKey ? nodes.get(row.clinicalSourceNodeKey) : undefined
    if (!origin || !['MedicationRequest', 'MedicationStatement'].includes(origin.resource.resourceType)) return row
    const raw = origin.resource
    if (!raw.medicationReference && !raw.medicationCodeableConcept) return row
    let code = raw.medicationCodeableConcept as MedicationEntity['medicationCodeableConcept']
    if (!code) {
      const edge = edges.get(origin.key)
      const targets = edge?.status === 'resolved' ? edge.targetKeys.map(key => nodes.get(key)) : []
      const first = targets[0]
      if (first && targets.every(target => target && target.resource.resourceType === 'Medication' && !target.embeddedIn
        && isClinicalSourceNodePatientEligible(target, source.graph.nodes)
        && clinicalSourceResourcesEqual(target.resource, first.resource))) {
        code = first.resource.code as MedicationEntity['medicationCodeableConcept']
      }
    }
    if (clinicalSourceResourcesEqual(row.medicationCodeableConcept, code) || row.medicationCodeableConcept === code) return row
    changed = true
    const { medicationCodeableConcept: _previous, ...rest } = row
    return code ? { ...rest, medicationCodeableConcept: mutableClinicalProjection(code) } : rest
  })
  return changed ? projected : rows
}
