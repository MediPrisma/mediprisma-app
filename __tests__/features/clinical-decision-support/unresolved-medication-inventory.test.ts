import { CARE_PACKS } from '@voho0000/personalized-care'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { buildHospitalAwareCdssResult } from '@/features/clinical-decision-support/utils/hospital-medication-review'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

it('does not turn an entirely quarantined medication inventory into absent classes or negative actual rule output', () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }, ...['I50.2', 'I48.91'].map(code => ({ resourceType: 'Condition', id: code, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] } }))]
  for (const version of ['1', '2']) resources.push({ resourceType: 'MedicationRequest', id: 'med', meta: { versionId: version }, status: 'active', medicationCodeableConcept: { text: 'Apixaban (Eliquis) FC tab 5 mg' }, dosageInstruction: [{ text: version + ' tablets' }] })
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'synthetic', age: 70 }, now: new Date('2026-10-01') })
  expect(profile.excludedClinicalRecordVariants).toBeUndefined()
  expect(profile.facts.currentDoac).toBeDefined()
  expect(profile.facts.medicationInventoryUnresolved).toBeUndefined()
  for (const id of ['heart-failure-cdss', 'atrial-fibrillation-cdss']) {
    const result = buildHospitalAwareCdssResult(CARE_PACKS.find(pack => pack.id === id)!, profile, 'en')
    const recommendation = result.recommendations.find(row => row.id === (id === 'heart-failure-cdss' ? 'heart-failure-medication-safety' : 'af-anticoagulation-concordance'))!
    const baseline=CARE_PACKS.find(pack=>pack.id===id)!.build({profile,locale:'en'}).recommendations.find(row=>row.id===recommendation.id)!
    expect(recommendation.status).toBe(baseline.status)
    expect(recommendation.title).not.toMatch(/not taking|not on anticoagulation/i)
    expect(recommendation.missingData?.some(text=>/source record|reconcil/i.test(text)) ?? false).toBe(false)
  }
})

it('records uncertain diagnosis existence without restoring a variant as a confirmed applicability fact', () => {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) resources.push({ resourceType: 'Condition', id: 'hf', meta: { versionId: version }, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.2' }] } })
  const data = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
  const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'synthetic', age: 70 } })
  expect(profile.facts.unresolvedDiagnosisRecords).toBeUndefined()
  expect(profile.excludedClinicalRecordVariants).toBeUndefined()
  expect(data.conditions).toHaveLength(1)
})
