import { excludeUnresolvedDecisionVariants, clinicalVariantMeasurement, clinicalVariantEvidenceIdentity } from '@/src/core/utils/clinical-variant-inputs'
import type { ClinicalRecordVariant, ClinicalRecordVariantExclusion } from '@/src/core/entities/clinical-data.entity'

type RecordRow = { clinicalSourceNodeKey?: string; id?: string; sourceId?: string; sourceVersionId?: string; _sourceResourceType?: string; clinicalRecordVariant?: ClinicalRecordVariant }
export interface ExcludedClinicalRecordVariant extends ClinicalRecordVariantExclusion { resourceType: string; resourceId?: string; evidenceIdentity?: string; sourceId?: string; versionId?: string }

/** Decision inputs are copies. Unordered record variants remain visible in the
 * chart and export, but none may silently become the preferred numeric fact. */
export function selectCdssClinicalInputs<T extends {
  conditions?: RecordRow[]; encounters?: RecordRow[]; medications?: RecordRow[]; allergies?: RecordRow[];
  carePlans?: RecordRow[]; procedures?: RecordRow[]; immunizations?: RecordRow[]; documentReferences?: RecordRow[];
  observations: RecordRow[]
  diagnosticReports?: (RecordRow & { _observations?: RecordRow[] })[]
}>(input: T): { input: T; excluded: readonly ExcludedClinicalRecordVariant[] } {
  const decisionInput = excludeUnresolvedDecisionVariants(input)
  const excluded = new Map<string, ExcludedClinicalRecordVariant>()
  const accept = (row: RecordRow, resourceType: ExcludedClinicalRecordVariant['resourceType']): boolean => {
    if (!row.clinicalRecordVariant) return true
    const annotation = row.clinicalRecordVariant
    excluded.set(JSON.stringify([resourceType, annotation.groupId, row.clinicalSourceNodeKey ?? [row.id, row.sourceVersionId]]), { ...annotation, ...(clinicalVariantEvidenceIdentity(row) ? { evidenceIdentity: clinicalVariantEvidenceIdentity(row) } : {}), resourceType: row._sourceResourceType ?? resourceType, resourceId: row.id, ...clinicalVariantMeasurement(row), ...(row.sourceId ? { sourceId: row.sourceId } : {}), ...(row.sourceVersionId ? { versionId: row.sourceVersionId } : {}) })
    return false
  }
  input.observations.forEach(row => accept(row, 'Observation'))
  input.diagnosticReports?.forEach(row => { accept(row, 'DiagnosticReport'); row._observations?.forEach(member => accept(member, 'Observation')) })
  for (const [key, type] of Object.entries({ conditions: 'Condition', encounters: 'Encounter', medications: 'MedicationRequest', allergies: 'AllergyIntolerance', carePlans: 'CarePlan', procedures: 'Procedure', immunizations: 'Immunization', documentReferences: 'DocumentReference' })) {
    const rows = (input as any)[key]
    if (Array.isArray(rows)) rows.forEach(row => accept(row, type))
  }
  input = decisionInput
  const observations = input.observations.filter(row => accept(row, 'Observation'))
  const diagnosticReports = input.diagnosticReports?.map(report => report._observations
    ? { ...report, _observations: report._observations.filter(row => accept(row, 'Observation')) } : report).filter(report => accept(report, 'DiagnosticReport'))
  const next: any = { ...input, observations }
  for (const [key, type] of Object.entries({ conditions: 'Condition', encounters: 'Encounter', medications: 'MedicationRequest', allergies: 'AllergyIntolerance', carePlans: 'CarePlan', procedures: 'Procedure', immunizations: 'Immunization', documentReferences: 'DocumentReference' })) {
    const rows = (input as any)[key]
    if (Array.isArray(rows)) next[key] = rows.filter(row => accept(row, type))
  }
  return { input: { ...next, ...(diagnosticReports ? { diagnosticReports } : {}) } as T, excluded: [...excluded.values()] }
}
