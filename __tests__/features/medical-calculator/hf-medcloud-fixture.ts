import { MEDCLOUD_PROVIDER_SYSTEM, type FhirRecord } from '@/src/core/hf-risk/contract'
/** Entirely synthetic identifiers, dates and clinical values. */
export function hfMedcloudFixture(): FhirRecord {
  const resources = [
    { resourceType: 'Patient', id: 'synthetic-patient', name: [{ text: 'Synthetic identity must not leave' }], identifier: [{ value: 'FAKE-ID' }], gender: 'male', birthDate: '1960-03-02' },
    { resourceType: 'Organization', id: 'synthetic-hospital', identifier: [{ system: MEDCLOUD_PROVIDER_SYSTEM, value: 'SYNTHETIC-HOSPITAL' }], name: 'Synthetic Hospital' },
    { resourceType: 'Organization', id: 'other-hospital', identifier: [{ system: MEDCLOUD_PROVIDER_SYSTEM, value: 'OTHER' }] },
    { resourceType: 'Encounter', id: 'synthetic-visit', status: 'finished', subject: { reference: 'Patient/synthetic-patient' },
      serviceProvider: { reference: 'Organization/synthetic-hospital' }, class: { code: 'AMB' }, period: { start: '2026-10-01' },
      reasonCode: [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.9' }] }] },
    { resourceType: 'Observation', id: 'synthetic-lab', status: 'final', subject: { reference: 'Patient/synthetic-patient' },
      performer: [{ reference: 'Organization/synthetic-hospital' }], effectiveDateTime: '2026-09-30',
      code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] }, valueQuantity: { value: 88.42, unit: 'µmol/L' },
      note: [{ text: 'PRIVATE NOTE' }], text: { div: '<div>PRIVATE NARRATIVE</div>' } },
  ]
  return { resourceType: 'Bundle', type: 'collection', meta: { source: 'https://medcloud2.nhi.gov.tw/', tag: [
    { system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/module-completeness', code: 'imue0060-complete' },
    { system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/module-completeness', code: 'imue0008-failed' },
  ] }, entry: resources.map(resource => ({ fullUrl: resource.resourceType + '/' + resource.id, resource })) }
}
