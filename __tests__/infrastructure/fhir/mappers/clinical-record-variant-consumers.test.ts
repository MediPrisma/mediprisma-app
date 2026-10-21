import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { scopeClinicalDataForAi, stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { buildSourceCatalog, formatSourceList, buildLongitudinalInvestigationContext } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { mapResults, mapVitalSigns, CLINICAL_RECORD_VARIANT_EXTENSION } from '@/features/ips-export/utils/ips-fhir-mappers'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'

const obs = (value: number, version?: string) => ({ resourceType: 'Observation', id: 'potassium', status: 'final', code: { text: 'Potassium', coding: [{ system: 'http://loinc.org', code: '2823-3' }] }, category: [{ coding: [{ code: 'laboratory' }] }], effectiveDateTime: '2026-10-01', valueQuantity: { value, unit: 'mmol/L' }, ...(version ? { meta: { versionId: version } } : {}) })
function collection(revision: boolean) {
  const source = reconcileClinicalSources([7, 9].map((value, index) => ({ sourceId: 'synthetic-source', patientScope: 'patient', generation: String(index), resources: [obs(value, revision ? String(index + 1) : undefined), { resourceType: 'DiagnosticReport', id: 'report', status: 'final', code: { text: 'Lab' }, category: [{ coding: [{ code: 'LAB' }] }], effectiveDateTime: '2026-10-01', result: [{ reference: 'Observation/potassium' }] }] })))
  const ids = createClinicalSourceProjectionIds(source)
  const reports = source.graph.nodes.filter(node => node.resource.resourceType === 'DiagnosticReport').map(node => ({ ...FhirMapper.toDiagnosticReport(node.resource, []), id: ids.get(node.key)!, clinicalSourceNodeKey: node.key }))
  return projectClinicalAggregate({ observations: [], diagnosticReports: reports } as any, source)
}

it.each([true, false])('uses one selected revision=%s consistently in serial evidence, AI and CDSS', revision => {
  const data = collection(revision)
  expect(data.observations).toHaveLength(1)
  expect(data.observations[0].clinicalRecordVariant).toBeUndefined()
  expect([7,9]).toContain(data.observations[0].valueQuantity.value)
  const scoped: any = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  const catalog = buildSourceCatalog(scoped)
  expect(scoped.observations).toHaveLength(1)
  expect(scoped.diagnosticReports).toHaveLength(1)
  expect(catalog.length).toBeGreaterThan(0)
  expect(scoped.clinicalRecordVariantExclusions).toBeUndefined()
  expect(JSON.stringify(scoped)).not.toContain('clinicalSourceNodeKey')
  const auditCatalog = buildSourceCatalog(stripClinicalCaptureMetadata(data))
  expect(formatSourceList(auditCatalog)).not.toContain('chronology unresolved')
  expect(buildLongitudinalInvestigationContext(scoped, catalog)).toBe('')
  expect(stripClinicalCaptureMetadata(data).observations[0].clinicalRecordVariant).toBeUndefined()
  const input = { patient: { id: 'synthetic', age: 70 }, conditions: [], encounters: [], observations: data.observations, medications: [], allergies: [], carePlans: [], diagnosticReports: data.diagnosticReports, now: new Date('2026-10-02') }
  const selected = selectCdssClinicalInputs(input)
  expect(selected.input.observations).toHaveLength(1)
  expect(selected.input.diagnosticReports.every((report: any) => report._observations?.length === 1)).toBe(true)
  expect(selected.excluded).toEqual([])
  const profile = createHospitalAwareCdssPatientProfile(input)
  expect(profile.excludedClinicalRecordVariants).toBeUndefined()
  const results = mapResults(data.diagnosticReports, data.observations, 'Patient/synthetic')
  const resources = [...results.entries, ...results.referencedOnly].map(entry => entry.resource)
  for (const resource of resources) {
    expect(resource).not.toHaveProperty('clinicalRecordVariant')
    expect(resource.modifierExtension ?? []).not.toContainEqual(expect.objectContaining({ url: CLINICAL_RECORD_VARIANT_EXTENSION }))
  }
  expect(mapVitalSigns([data.observations[0]], 'Patient/synthetic').entries[0].resource.modifierExtension ?? []).not.toContainEqual(expect.objectContaining({ url: CLINICAL_RECORD_VARIANT_EXTENSION }))
})

it('keeps unrelated decision inputs and clears obsolete annotations after authoritative refresh', () => {
  const data = collection(true)
  const raw = { ...obs(140), id: 'unrelated', code: { coding: [{ system: 'http://loinc.org', code: '2951-2' }], text: 'Sodium' } }
  const source = reconcileClinicalSources([{ sourceId: 'synthetic-source', patientScope: 'patient', generation: 'next', resources: [raw] }])
  const normal = projectClinicalAggregate({ observations: [] as import('@/src/core/entities/clinical-data.entity').ObservationEntity[] }, source).observations![0]
  const selected = selectCdssClinicalInputs({ observations: [...data.observations, normal] })
  expect(selected.input.observations).toEqual([...data.observations,normal])
  const stale = { ...normal, clinicalRecordVariant: {groupId:'old',classification:'revision' as const,variantCount:2,reason:'Old source snapshot'} }
  expect(projectClinicalAggregate({ observations: [stale] }, source).observations![0].clinicalRecordVariant).toBeUndefined()
})

it('quarantines unresolved narrative-only report revisions while retaining unrelated reports', () => {
  const annotation = { groupId: 'report-group', classification: 'revision' as const, variantCount: 2, reason: 'Chronology unresolved' }
  const reports = [
    { id: 'echo-1', code: { text: 'Echocardiography' }, effectiveDateTime: '2026-10-01', conclusion: 'LVEF 30%', clinicalRecordVariant: annotation },
    { id: 'echo-2', code: { text: 'Echocardiography' }, effectiveDateTime: '2026-10-02', conclusion: 'LVEF 60%', clinicalRecordVariant: annotation },
    { id: 'unrelated', conclusion: 'Unrelated report' },
  ]
  const selected = selectCdssClinicalInputs({ observations: [], diagnosticReports: reports })
  expect(selected.input.diagnosticReports).toEqual([reports[2]])
  expect(selected.excluded).toEqual(reports.slice(0, 2).map(report => ({ ...annotation, resourceType: 'DiagnosticReport', resourceId: report.id, code: report.code, effectiveDate: report.effectiveDateTime })))
  const profile = createHospitalAwareCdssPatientProfile({ patient: { id: 'synthetic', age: 70 }, conditions: [], encounters: [], observations: [], medications: [], allergies: [], carePlans: [], diagnosticReports: reports })
  expect(profile.excludedClinicalRecordVariants).toEqual(selected.excluded)
  expect(JSON.stringify(profile.facts)).not.toMatch(/echo-1|echo-2/)
  expect(profile.facts.LVEF?.numericValue).toBeUndefined()
  expect(reports).toHaveLength(3)
})
