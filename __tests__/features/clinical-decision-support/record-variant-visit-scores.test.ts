import { CARE_PACKS } from '@voho0000/personalized-care'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'
import { buildVisitModel } from '@/features/clinical-decision-support/renderers/visit/visit-model.source'

it('keeps the native AF score pending when source diagnoses are unresolved', () => {
  const packId = 'atrial-fibrillation-cdss'
  const resources = [
    { resourceType: 'Patient', id: 'patient' },
    ...['I48.91', 'I50.2'].map(code => ({ resourceType: 'Condition', id: code, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] } })),
    ...['1', '2'].map(version => ({ resourceType: 'Condition', id: 'diabetes', meta: { versionId: version }, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' }] } })),
  ]
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'patient', age: 60, gender: 'female' }, now: new Date('2026-10-02') })
  const resultFor = (id: string) => buildHospitalAwareCdssResult(CARE_PACKS.find(pack => pack.id === id)!, profile, 'en')
  const result = resultFor(packId)
  const model = buildVisitModel({ packId, result, profile, locale: 'en', companions: { 'atrial-fibrillation-cdss': resultFor('atrial-fibrillation-cdss') } })!
  expect(profile.excludedClinicalRecordVariants?.filter(row => row.resourceType === 'Condition')).toHaveLength(2)
  const scorePoints = model.points.filter(point => point.scoreTable)
  expect(scorePoints.length).toBeGreaterThan(0)
  for (const point of scorePoints) {
    expect(point.scoreTable?.pending).toBe(true)
    expect(point.state).not.toBe('done')
    expect(point.actions).toEqual([])
    expect(point.needsData?.join(' ')).toMatch(/source record|reconcil/i)
  }
})

it('does not describe unresolved AF diagnoses as absent on the heart-failure map', () => {
  const resources = [
    { resourceType: 'Patient', id: 'patient' },
    { resourceType: 'Condition', id: 'hf', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.2' }] } },
    ...['1', '2'].map(version => ({ resourceType: 'Condition', id: 'af', meta: { versionId: version }, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I48.91' }] } })),
  ]
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'patient', age: 60, gender: 'female' }, now: new Date('2026-10-02') })
  const packId = 'heart-failure-cdss'
  const result = buildHospitalAwareCdssResult(CARE_PACKS.find(pack => pack.id === packId)!, profile, 'en')
  const model = buildVisitModel({ packId, result, profile, locale: 'en' })!
  expect(profile.excludedClinicalRecordVariants?.filter(row => row.resourceType === 'Condition')).toHaveLength(2)
  expect(model.points.some(point => /no AF diagnosis/i.test(point.headline ?? ''))).toBe(false)
  expect(model.points.some(point => point.needsData?.some(text => /source record|reconcil/i.test(text)))).toBe(true)
  const withoutUnresolvedRecords = buildVisitModel({ packId, result, profile: { ...profile, excludedClinicalRecordVariants: [] }, locale: 'en' })!
  expect(withoutUnresolvedRecords.points.some(point => /no AF diagnosis/i.test(point.headline ?? ''))).toBe(true)
})
