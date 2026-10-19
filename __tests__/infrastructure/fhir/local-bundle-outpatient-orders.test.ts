import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { buildSourceCatalog, formatSourceList } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { buildOverviewSnapshot } from '@/src/core/use-cases/medical-summary/overview-snapshot'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'

it.each(['relative', 'absolute', 'uuid'])('imports %s references with orders and source for clinical consumers', style => {
  const meta = { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] }
  const orderRef = style === 'absolute' ? 'https://cloud-wildcatch.invalid/fhir/ServiceRequest/order' : style === 'uuid' ? 'urn:uuid:order' : 'ServiceRequest/order'
  const basedOn = [{ reference: orderRef }]
  const resources = [
    { resourceType: 'Patient', id: 'patient', gender: 'female' },
    { resourceType: 'ServiceRequest', id: 'order', status: 'unknown', intent: 'order', code: { text: 'Synthetic creatinine order' }, subject: { reference: 'Patient/patient' } },
    { resourceType: 'Observation', id: 'result', status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], effectiveDateTime: '2026-09-01T09:12:00+08:00', code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] }, valueQuantity: { value: 1.2, unit: 'mg/dL' }, basedOn, meta, subject: { reference: 'Patient/patient' } },
    { resourceType: 'DiagnosticReport', id: 'report', status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB' }] }], code: { text: 'Synthetic lab' }, result: [{ reference: 'Observation/result' }], basedOn, meta, subject: { reference: 'Patient/patient' } },
  ]
  const data = LocalBundleService.parse({ resourceType: 'Bundle', type: 'collection', entry: resources.map(resource => ({ resource, ...(resource.resourceType === 'ServiceRequest' ? { fullUrl: orderRef } : {}) })) } as any)!
  expect(data.collection.observations).toHaveLength(1)
  expect(data.collection.diagnosticReports).toHaveLength(1)
  for (const result of [...data.collection.observations, ...data.collection.diagnosticReports]) {
    expect(result.basedOn).toEqual([{ reference: 'ServiceRequest/order', display: 'Synthetic creatinine order' }])
    expect(result.meta).toEqual(meta)
  }
  const catalog = buildSourceCatalog(data.collection)
  expect(catalog.some(entry => entry.resourceType === 'Observation' && entry.resourceId === 'result')).toBe(true)
  expect(catalog.find(entry => entry.resourceId === 'result')?.getContentText?.()).toContain('1.2')
  expect(formatSourceList(catalog)).toContain('ordered tests: Synthetic creatinine order')
  const snapshot = buildOverviewSnapshot({ clinicalData: data.collection, catalog }, { nowMs: Date.parse('2026-10-01T00:00:00Z'), locale: 'en' })
  expect(snapshot.clinicalContext).toContain('1.2')
  expect(formatSourceList(snapshot.catalog)).toContain('ordered tests: Synthetic creatinine order')
  const profile = createHospitalAwareCdssPatientProfile({
    now: new Date('2026-10-01T00:00:00Z'), patient: { id: 'patient', age: 60, gender: 'female' },
    conditions: [], encounters: [], medications: [], allergies: [], carePlans: [],
    observations: data.collection.observations, diagnosticReports: data.collection.diagnosticReports,
  })
  expect(profile.facts.serumCreatinine?.numericValue).toBe(1.2)
  expect(profile.facts.serumCreatinine?.sources?.some(source => source.resourceId === 'result')).toBe(true)
})
