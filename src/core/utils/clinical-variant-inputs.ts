import type { ClinicalRecordVariantExclusion } from '@/src/core/entities/clinical-data.entity'

/** Generic record types have no revision-selection policy. Keep them in the UI
 * and source graph, while representing their unresolved existence explicitly in
 * AI inputs instead of presenting competing versions as independent facts. */
export const GENERIC_CLINICAL_VARIANT_ARRAYS: Readonly<Record<string, string>> = {
  medications: 'MedicationRequest', medicationRemainingSummaries: 'Basic', conditions: 'Condition',
  encounters: 'Encounter', allergies: 'AllergyIntolerance', procedures: 'Procedure',
  carePlans: 'CarePlan', immunizations: 'Immunization', documentReferences: 'DocumentReference',
  compositions: 'Composition', imagingStudies: 'ImagingStudy', consents: 'Consent', devices: 'Device',
}
export function excludeUnresolvedGenericVariants<T extends object>(input: T, selection?: object): T & { clinicalRecordVariantExclusions?: readonly ClinicalRecordVariantExclusion[] } {
  const selectedByArray: Record<string, string> = { conditions: 'problemList', medicationRemainingSummaries: 'medications', compositions: 'documents', documentReferences: 'documents', imagingStudies: 'imagingReports', devices: 'medicalDevices', consents: 'advanceDirectives' }
  const next: any = { ...input }
  const excluded = new Map<string, ClinicalRecordVariantExclusion>()
  for (const item of (input as any).clinicalRecordVariantExclusions ?? []) excluded.set(JSON.stringify(item), item)
  for (const [key, resourceType] of Object.entries(GENERIC_CLINICAL_VARIANT_ARRAYS)) {
    const rows = (input as any)[key]
    if (!Array.isArray(rows)) continue
    next[key] = rows.filter(row => {
      if (!row.clinicalRecordVariant) return true
      if (selection && !(selection as any)[selectedByArray[key] ?? key]) return false
      const item: ClinicalRecordVariantExclusion = { ...row.clinicalRecordVariant,
        resourceType: row._sourceResourceType ?? resourceType, sourceId: row.sourceId ?? row.id,
        ...(row.sourceVersionId ? { versionId: row.sourceVersionId } : {}) }
      excluded.set(JSON.stringify(item), item)
      return false
    })
  }
  if (excluded.size) next.clinicalRecordVariantExclusions = [...excluded.values()]
  return next
}
export function formatClinicalVariantExclusions(input: { clinicalRecordVariantExclusions?: readonly ClinicalRecordVariantExclusion[] }): string {
  const items = input.clinicalRecordVariantExclusions
  if (!items?.length) return ''
  return 'Unresolved source-record variants (excluded from decision facts):\n'
    + 'These records exist but their versions or conflicts are unresolved. Do not infer absent disease, negative history, no medication, or a preferred/latest version from these exclusions. Other records remain available.\n'
    + items.map(item => `${item.resourceType}/${item.sourceId ?? '(no source id)'}${item.versionId ? ' version=' + item.versionId : ''}; group=${item.groupId}; ${item.classification}; variants=${item.variantCount}; ${item.reason}`).join('\n')
}
