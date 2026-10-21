import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
import type { ClinicalRecordVariantExclusion } from '@/src/core/entities/clinical-data.entity'

/** Generic record types have no revision-selection policy. Keep them in the UI
 * and source graph, while representing their unresolved existence explicitly in
 * AI inputs instead of presenting competing versions as independent facts. */
export const clinicalVariantEvidenceIdentity = (row: { clinicalSourceNodeKey?: string }): string | undefined => row.clinicalSourceNodeKey
const exclusionKey = (item: ClinicalRecordVariantExclusion): string => item.evidenceIdentity ?? JSON.stringify(item)

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
  for (const item of (input as any).clinicalRecordVariantExclusions ?? []) excluded.set(exclusionKey(item), item)
  for (const [key, resourceType] of Object.entries(GENERIC_CLINICAL_VARIANT_ARRAYS)) {
    const rows = (input as any)[key]
    if (!Array.isArray(rows)) continue
    const filtered = rows.filter(row => {
      if (!row.clinicalRecordVariant) return true
      if (selection && !(selection as any)[selectedByArray[key] ?? key]) return false
      const item: ClinicalRecordVariantExclusion = { ...row.clinicalRecordVariant,
        ...(clinicalVariantEvidenceIdentity(row) ? { evidenceIdentity: clinicalVariantEvidenceIdentity(row) } : {}),
        resourceType: row._sourceResourceType ?? resourceType, sourceId: row.sourceId ?? row.id,
        ...(row.sourceVersionId ? { versionId: row.sourceVersionId } : {}) }
      excluded.set(exclusionKey(item), item)
      return false
    })
    const decisionRows = key === 'medications' ? filtered.map(row => {
      if (!row.clinicalMedicationContentUncertainty) return row
      if (!row.medicationCodeableConcept && !row.medicationReference?.display && !row.drugTerminology && !row.atcClassification) return row
      const { medicationCodeableConcept: _code, drugTerminology: _terminology, atcClassification: _atc, ...rest } = row
      return { ...rest, ...(row.medicationReference ? { medicationReference: { reference: row.medicationReference.reference } } : {}) }
    }) : filtered
    next[key] = decisionRows.length === rows.length && decisionRows.every((row, index) => row === rows[index]) ? rows : decisionRows
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
    + 'These records exist but their versions or conflicts are unresolved. Do not infer absent disease, negative history, no medication, or a preferred/latest version from these exclusions. Older same-analyte results must not be substituted for these pending measurements. Other records remain available.\n'
    + items.map((item, index) => `${item.resourceType} record ${index + 1}${item.versionId ? ' version=' + item.versionId : ''}; code=${item.code?.coding?.map(coding => [coding.system, coding.code].filter(Boolean).join('|')).join(',') || item.code?.text || 'unknown'}; date=${item.effectiveDate || 'unknown'}; group=${item.groupId}; ${item.classification}; variants=${item.variantCount}; ${item.reason}`).join('\n')
}

/** Value-free evidence that a newer measurement is unresolved. */
export function clinicalVariantMeasurement(row: any): { code?: { coding?: { system?: string; code?: string }[]; text?: string }; effectiveDate?: string; analyteKeys?: string[] } {
  const analyteKeys = [row, ...(row.component ?? [])].map(holder => getAnalyteCanonicalKey(holder)).filter((key): key is string => !!key)
  const coding = row.code?.coding?.filter((item: any) => item.code).map((item: any) => ({ system: item.system, code: item.code }))
  return { ...(analyteKeys.length ? { analyteKeys: [...new Set(analyteKeys)] } : {}), ...(coding?.length || row.code?.text ? { code: { ...(coding?.length ? { coding } : {}), ...(row.code?.text ? { text: row.code.text } : {}) } } : {}), ...(row.effectiveDateTime || row.effectivePeriod?.start || row.issued ? { effectiveDate: row.effectiveDateTime ?? row.effectivePeriod?.start ?? row.issued } : {}) }
}
function sameAnalyte(row: any, item: ClinicalRecordVariantExclusion): boolean {
  const keys = clinicalVariantMeasurement(row).analyteKeys
  if (keys?.some(key => item.analyteKeys?.includes(key))) return true
  const left = row.code?.coding ?? [], right = item.code?.coding ?? []
  if (left.length && right.length) return left.some((a: any) => right.some(b => a.code && a.code === b.code && a.system === b.system))
  return !!row.code?.text && row.code.text === item.code?.text
}

/** Shared numeric/fact boundary; summary's annotated citation catalog remains separate. */
export function excludeUnresolvedDecisionVariants<T extends object>(input: T, selection?: object): T & { clinicalRecordVariantExclusions?: readonly ClinicalRecordVariantExclusion[] } {
  const generic = excludeUnresolvedGenericVariants(input, selection)
  const next: any = { ...generic }
  const excluded = new Map<string, ClinicalRecordVariantExclusion>((generic.clinicalRecordVariantExclusions ?? []).map(item => [exclusionKey(item), item]))
  const keep = (row: any, resourceType: string) => {
    if (!row.clinicalRecordVariant) return true
    const item = { ...row.clinicalRecordVariant, ...(clinicalVariantEvidenceIdentity(row) ? { evidenceIdentity: clinicalVariantEvidenceIdentity(row) } : {}), resourceType, sourceId: row.sourceId ?? row.id, ...clinicalVariantMeasurement(row), ...(row.sourceVersionId || row.meta?.versionId ? { versionId: row.sourceVersionId ?? row.meta.versionId } : {}) }
    excluded.set(exclusionKey(item), item)
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
  // Missing dates cannot establish that a retained value supersedes a pending result.
  const pending = [...excluded.values()].filter(item => item.resourceType === 'Observation' || item.resourceType === 'DiagnosticReport')
  const unblocked = (row: any) => {
    const date = clinicalVariantMeasurement(row).effectiveDate
    return !pending.some(item => sameAnalyte(row, item) && (!item.effectiveDate || !date || !(Date.parse(date) > Date.parse(item.effectiveDate))))
  }
  for (const key of ['observations', 'vitalSigns', 'diagnosticReports']) {
    const rows = next[key]
    if (!Array.isArray(rows)) continue
    const filtered = rows.filter(unblocked).map(row => {
      if (!row._observations) return row
      const members = row._observations.filter(unblocked)
      return members.length === row._observations.length ? row : { ...row, _observations: members }
    })
    if (filtered.length !== rows.length || filtered.some((row, index) => row !== rows[index])) next[key] = filtered
  }
  if (excluded.size !== (generic.clinicalRecordVariantExclusions?.length ?? 0)) next.clinicalRecordVariantExclusions = [...excluded.values()]
  return Object.entries(next).every(([key, value]) => value === (generic as any)[key]) ? generic : next
}

/** Outbound traces use only opaque groups and ordinals; original IDs stay in UI/IPS audit. */
export function outboundClinicalVariantExclusions(items: readonly ClinicalRecordVariantExclusion[]) {
  return items.map(({ sourceId: _sourceId, evidenceIdentity: _evidenceIdentity, ...item }, index) => ({ ...item, recordOrdinal: index + 1 }))
}
