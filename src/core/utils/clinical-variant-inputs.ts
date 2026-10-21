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
    const filtered = rows.filter(row => {
      if (!row.clinicalRecordVariant) return true
      if (selection && !(selection as any)[selectedByArray[key] ?? key]) return false
      const item: ClinicalRecordVariantExclusion = { ...row.clinicalRecordVariant,
        resourceType: row._sourceResourceType ?? resourceType, sourceId: row.sourceId ?? row.id,
        ...(row.sourceVersionId ? { versionId: row.sourceVersionId } : {}) }
      excluded.set(JSON.stringify(item), item)
      return false
    })
    next[key] = filtered.length === rows.length ? rows : filtered
  }
  if (excluded.size) {
    const previous = (input as any).clinicalRecordVariantExclusions
    const items = [...excluded.values()]
    next.clinicalRecordVariantExclusions = previous?.length === items.length && items.every((item, index) => item === previous[index]) ? previous : items
  }
  return Object.keys(next).length === Object.keys(input).length && Object.entries(next).every(([key, value]) => value === (input as any)[key]) ? input : next
}
export function formatClinicalVariantExclusions(input: { clinicalRecordVariantExclusions?: readonly ClinicalRecordVariantExclusion[] }): string {
  const items = input.clinicalRecordVariantExclusions
  if (!items?.length) return ''
  return 'Unresolved source-record variants (excluded from decision facts):\n'
    + 'These records exist but their versions or conflicts are unresolved. Do not infer absent disease, negative history, no medication, or a preferred/latest version from these exclusions. Other records remain available.\n'
    + items.map((item, index) => `${item.resourceType} record ${index + 1}${item.versionId ? ' version=' + item.versionId : ''}; group=${item.groupId}; ${item.classification}; variants=${item.variantCount}; ${item.reason}`).join('\n')
}

/** Shared numeric/fact boundary; summary's annotated citation catalog remains separate. */
export function excludeUnresolvedDecisionVariants<T extends object>(input: T, selection?: object): T & { clinicalRecordVariantExclusions?: readonly ClinicalRecordVariantExclusion[] } {
  const generic = excludeUnresolvedGenericVariants(input, selection)
  const next: any = { ...generic }
  const excluded = new Map<string, ClinicalRecordVariantExclusion>((generic.clinicalRecordVariantExclusions ?? []).map(item => [JSON.stringify(item), item]))
  const keep = (row: any, resourceType: string) => {
    if (!row.clinicalRecordVariant) return true
    const item = { ...row.clinicalRecordVariant, resourceType, sourceId: row.sourceId ?? row.id, ...(row.sourceVersionId || row.meta?.versionId ? { versionId: row.sourceVersionId ?? row.meta.versionId } : {}) }
    excluded.set(JSON.stringify(item), item)
    return false
  }
  for (const [key, type] of [['observations', 'Observation'], ['vitalSigns', 'Observation'], ['diagnosticReports', 'DiagnosticReport']]) {
    const rows = (generic as any)[key]
    if (!Array.isArray(rows)) continue
    const filtered = rows.filter(row => keep(row, type)).map(row => {
      if (!row._observations) return row
      const members = row._observations.filter((member: any) => keep(member, 'Observation'))
      return members.length === row._observations.length ? row : { ...row, _observations: members }
    })
    next[key] = filtered.length === rows.length && filtered.every((row, index) => row === rows[index]) ? rows : filtered
  }
  if (excluded.size !== (generic.clinicalRecordVariantExclusions?.length ?? 0)) next.clinicalRecordVariantExclusions = [...excluded.values()]
  return Object.entries(next).every(([key, value]) => value === (generic as any)[key]) ? generic : next
}

/** Outbound traces use only opaque groups and ordinals; original IDs stay in UI/IPS audit. */
export function outboundClinicalVariantExclusions(items: readonly ClinicalRecordVariantExclusion[]) {
  return items.map(({ sourceId: _sourceId, ...item }, index) => ({ ...item, recordOrdinal: index + 1 }))
}
