import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'

it('carries top-level Condition versions with versioned REST fullUrls into CDSS variant exclusions', () => {
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
    { fullUrl: 'urn:uuid:patient-a', resource: { resourceType: 'Patient', id: 'a' } },
    { fullUrl: 'https://ehr.example/fhir/Condition/heart-failure/_history/1', resource: {
      resourceType: 'Condition', id: 'heart-failure', meta: { versionId: '1' }, clinicalStatus: { coding:[{code:'active'}] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.2' }] },
    } },
    { fullUrl: 'https://ehr.example/fhir/Condition/heart-failure/_history/2', resource: {
      resourceType: 'Condition', id: 'heart-failure', meta: { versionId: '2' }, clinicalStatus: { coding:[{code:'resolved'}] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.2' }] },
    } },
    { fullUrl: 'https://ehr.example/fhir/MedicationRequest/medication/_history/1', resource: {
      resourceType: 'MedicationRequest', id: 'medication', meta: { versionId: '1' }, status: 'active', intent: 'order',
      medicationCodeableConcept: { text: 'Synthetic medicine' }, dosageInstruction: [{ text: 'one tablet' }],
    } },
    { fullUrl: 'https://ehr.example/fhir/MedicationRequest/medication/_history/2', resource: {
      resourceType: 'MedicationRequest', id: 'medication', meta: { versionId: '2' }, status: 'active', intent: 'order',
      medicationCodeableConcept: { text: 'Synthetic medicine' }, dosageInstruction: [{ text: 'two tablets' }],
    } },
  ] } as any)!
  const profile = createHospitalAwareCdssPatientProfile({
    ...parsed.collection,
    patient: { id: 'a', age: 70, gender: 'unknown' },
    now: new Date('2026-10-21T00:00:00Z'),
  })

  expect(profile.excludedClinicalRecordVariants).toBeUndefined()
  expect(parsed.collection.conditions).toHaveLength(1)
  expect(parsed.collection.conditions[0].clinicalStatus).toBe('resolved')
  expect(parsed.collection.medications).toHaveLength(1)
  expect(parsed.collection.clinicalSource?.graph.nodes.map(node => node.fullUrl)).toContain('https://ehr.example/fhir/MedicationRequest/medication/_history/1')
  expect(parsed.collection.clinicalSource?.graph.nodes.map(node => node.fullUrl)).toContain('https://ehr.example/fhir/MedicationRequest/medication/_history/2')
})
