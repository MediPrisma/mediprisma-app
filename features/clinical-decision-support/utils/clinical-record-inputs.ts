import type { ClinicalRecordVariant } from '@/src/core/entities/clinical-data.entity'

type RecordRow = { id?: string; clinicalRecordVariant?: ClinicalRecordVariant }
export interface ExcludedClinicalRecordVariant extends ClinicalRecordVariant { resourceType: 'Observation' | 'DiagnosticReport'; resourceId?: string }

/** Decision inputs are copies. Unordered record variants remain visible in the
 * chart and export, but none may silently become the preferred numeric fact. */
export function selectCdssClinicalInputs<T extends {
  observations: RecordRow[]
  diagnosticReports?: (RecordRow & { _observations?: RecordRow[] })[]
}>(input: T): { input: T; excluded: readonly ExcludedClinicalRecordVariant[] } {
  const excluded = new Map<string, ExcludedClinicalRecordVariant>()
  const accept = (row: RecordRow, resourceType: ExcludedClinicalRecordVariant['resourceType']): boolean => {
    if (!row.clinicalRecordVariant) return true
    const annotation = row.clinicalRecordVariant
    excluded.set(JSON.stringify([resourceType, annotation.groupId, row.id]), { ...annotation, resourceType, resourceId: row.id })
    return false
  }
  const observations = input.observations.filter(row => accept(row, 'Observation'))
  const diagnosticReports = input.diagnosticReports?.map(report => report._observations
    ? { ...report, _observations: report._observations.filter(row => accept(row, 'Observation')) } : report).filter(report => accept(report, 'DiagnosticReport'))
  return { input: { ...input, observations, ...(diagnosticReports ? { diagnosticReports } : {}) } as T, excluded: [...excluded.values()] }
}
