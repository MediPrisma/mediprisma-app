import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { LocalBundleService, canonicalizeBundleResources } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileOutpatientEncounters } from '@/src/infrastructure/fhir/services/outpatient-encounter-reconciliation'
import { extractEncounterIcds, buildIcdDictionary, localizedIcdDescription } from '@/src/shared/utils/icd-lookup'
import { renderHook } from '@testing-library/react'
import { useVisitHistory, needsSourceComparison } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'
import { projectEncounterComparisons } from '@/src/shared/utils/source-record-comparison'

it('keeps two hospital visits separate when the cloud member of a three-source comparison is outside the view', () => {
  const comparison = { status: 'ambiguous', references: ['Encounter/h1', 'Encounter/h2', 'Encounter/c1'] }
  const visits = ['h1', 'h2'].map(id => ({ id, _sourceRecordComparison: comparison }))
  const projected = projectEncounterComparisons(visits)
  expect(projected).toHaveLength(2)
  expect(projected.map(visit => (visit as any)._comparisonEncounterIds)).toEqual([['h1'], ['h2']])
})

it('uses an exact Chinese MediCloud Condition label without borrowing hospital narrative', () => {
  const condition = { meta: { source: 'https://medcloud2.nhi.gov.tw/' }, code: {
    text: 'I10 原發性高血壓', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', display: 'Essential hypertension' }],
  } }
  const dict = buildIcdDictionary([condition], 'zh-TW')
  expect(localizedIcdDescription('I10', undefined, undefined, dict, 'zh-TW', 'http://hl7.org/fhir/sid/icd-10-cm')).toBe('原發性高血壓')
  expect(extractEncounterIcds({ reasonCode: [{ text: 'I10' }] }, undefined, 'zh-TW')[0].description).toBeTruthy()
})

it('retains both navigation aliases for a confirmed encounter whose source was reconciled away', () => {
  const [visit] = projectEncounterComparisons([{ id: 'cloud', _sourceRecordComparison: {
    status: 'confirmed', references: ['Encounter/hospital', 'Encounter/cloud'],
  } }])
  expect((visit as any)._comparisonEncounterIds).toEqual(['hospital', 'cloud'])
})

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'

it('never promotes an added hospital SOAP diagnosis narrative into a cloud terminology label after a confirmed visit merge', () => {
  const { resources, hospital } = fixture()
  const text = '疑似左乳癌，待病理確認'
  const secondary = { text, coding: [{ system: ICD, code: 'C50.912', display: text }] }
  ;(hospital as any).reasonCode = [secondary]
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect(visits).toHaveLength(1)
  expect(visits[0].reasonCode.some((concept: any) => concept.text === text)).toBe(true)
  const dict = buildIcdDictionary([], 'zh-TW', visits)
  expect(localizedIcdDescription('C50.912', 'Confirmed prior malignancy', undefined, dict, 'zh-TW', ICD)).toBe('Confirmed prior malignancy')
})

it('does not confirm two visits from a shared patient or untyped case identifier', () => {
  const { resources, hospital, cloud } = fixture()
  const identifier = [{ system: 'urn:oid:vgh.case', value: 'synthetic-shared-case' }]
  ;(hospital as any).identifier = identifier; (cloud as any).identifier = identifier
  const graph = reconcileOutpatientEncounters(resources)
  expect(graph.filter(resource => resource.resourceType === 'Encounter')).toHaveLength(2)
  expect((hospital as any)._sourceRecordComparison.status).toBe('candidate')
  expect(graph.find(resource => resource.id === 'med')?.encounter.reference).toBe('Encounter/hospital-visit')
})

it('marks ambiguous same-day visit sources without mixing their individual detail links', () => {
  const { resources, hospital } = fixture()
  resources.push({ ...hospital, id: 'hospital-second-visit' })
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect(visits).toHaveLength(3)
  expect(visits.every(visit => visit._sourceRecordComparison?.status === 'ambiguous')).toBe(true)
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current).toHaveLength(3)
  expect(result.current.every(visit => visit.sourceIds?.length === 1 && visit.sourceIds[0] === visit.id)).toBe(true)
})

it('shows a unique hospital/cloud pair as one visit without asking the clinician to compare it', () => {
  // Cloud and North VGH never share a visit identifier, so a real pair is a candidate.
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect(visits.every(visit => visit._sourceRecordComparison?.status === 'candidate')).toBe(true)
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current).toHaveLength(1)
  expect(result.current[0].sourceIds).toEqual(['hospital-visit', 'cloud-visit'])
  expect(needsSourceComparison(result.current[0])).toBe(false)
})

it('still asks for comparison when same-day candidates stay split', () => {
  const { resources, hospital } = fixture()
  resources.push({ ...hospital, id: 'hospital-second-visit' })
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current.every(needsSourceComparison)).toBe(true)
})

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
const hospitalOrder = (id: string, visit: string, name: string) => ({ resourceType: 'MedicationRequest', id, status: 'active',
  meta: { source: 'https://web9.vghtpe.gov.tw/emr/qemr/', tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
  subject: { reference: 'Patient/synthetic' }, encounter: { reference: `Encounter/${visit}` },
  medicationCodeableConcept: { text: name, coding: [{ system: 'urn:oid:vgh.medication.name', code: name }] } })
const cloudOrder = (id: string, visit: string, code: string, display: string) => ({ resourceType: 'MedicationRequest', id, status: 'active',
  meta: { source: 'https://medcloud2.nhi.gov.tw/' }, subject: { reference: 'Patient/synthetic' }, encounter: { reference: `Encounter/${visit}` },
  medicationCodeableConcept: { text: display, coding: [{ system: NHI, code, display }] } })
const AROMASIN = ['Aromasin SC tab 25 mg', 'BC23097100', 'AROMASIN SUGAR COATED TABLETS 25MG'] as const
const FEMARA = ['Femara FC tab 2.5 mg', 'BC22462100', 'FEMARA FILM-COATED TABLETS 2.5MG'] as const

function twoClinicDay(secondHospitalDrug: typeof AROMASIN | typeof FEMARA) {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  const secondHospital = { ...hospital, id: 'hospital-second-visit' }
  const secondCloud = { ...cloud, id: 'cloud-second-visit' }
  resources.push(secondHospital, secondCloud,
    hospitalOrder('h-order-1', 'hospital-visit', AROMASIN[0]), cloudOrder('c-order-1', 'cloud-visit', AROMASIN[1], AROMASIN[2]),
    hospitalOrder('h-order-2', 'hospital-second-visit', secondHospitalDrug[0]), cloudOrder('c-order-2', 'cloud-second-visit', FEMARA[1], FEMARA[2]))
  return { resources, hospital, cloud, secondHospital, secondCloud }
}

it('pairs two same-day, same-code clinics by the prescriptions each one wrote', () => {
  const { resources, hospital, cloud, secondHospital, secondCloud } = twoClinicDay(FEMARA)
  reconcileOutpatientEncounters(resources)
  expect((hospital as any)._sourceRecordComparison).toMatchObject({ status: 'candidate', references: ['Encounter/hospital-visit', 'Encounter/cloud-visit'], warnings: ['paired-by-prescriptions'] })
  expect((secondHospital as any)._sourceRecordComparison.references).toEqual(['Encounter/hospital-second-visit', 'Encounter/cloud-second-visit'])
  const visits = resources.filter(resource => resource.resourceType === 'Encounter')
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current).toHaveLength(2)
  expect(result.current.some(needsSourceComparison)).toBe(false)
  expect(cloud).not.toBe(secondCloud)
})

it('keeps same-day clinics with indistinguishable prescriptions for comparison', () => {
  const { resources, hospital, secondHospital } = twoClinicDay(AROMASIN)
  // Both clinics wrote Aromasin and both cloud claims carry it: nothing separates them.
  resources.push(cloudOrder('c-order-3', 'cloud-second-visit', AROMASIN[1], AROMASIN[2]))
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect((hospital as any)._sourceRecordComparison.status).toBe('ambiguous')
  expect((secondHospital as any)._sourceRecordComparison.status).toBe('ambiguous')
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current.every(needsSourceComparison)).toBe(true)
})

it('pairs the clinic whose prescriptions match the only cloud claim and leaves the other clinic alone', () => {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  const secondHospital = { ...hospital, id: 'hospital-second-visit' }
  resources.push(secondHospital,
    hospitalOrder('h-order-1', 'hospital-second-visit', AROMASIN[0]), cloudOrder('c-order-1', 'cloud-visit', AROMASIN[1], AROMASIN[2]))
  reconcileOutpatientEncounters(resources)
  expect((secondHospital as any)._sourceRecordComparison.references).toEqual(['Encounter/hospital-second-visit', 'Encounter/cloud-visit'])
  expect((hospital as any)._sourceRecordComparison).toBeUndefined()
})

it('pairs clinics by recorded product names with hyphenated brands and volume-qualified strengths', () => {
  const { resources, hospital, secondHospital } = twoClinicDay(FEMARA)
  for (const resource of resources) if (resource.resourceType === 'MedicationRequest' && resource.id.startsWith('h-order')) {
    resource.medicationCodeableConcept.coding[0].code = resource.id === 'h-order-1' ? 'Bao-gan * cap 150 mg' : 'Methasone inj 5 mg/1 ml @'
  }
  for (const resource of resources) if (resource.resourceType === 'MedicationRequest' && resource.id.startsWith('c-order')) {
    resource.medicationCodeableConcept.coding[0].display = resource.id === 'c-order-1' ? 'BAO-GAN CAPSULES 150MG' : 'METHASONE INJECTION 5MG/ML'
  }
  reconcileOutpatientEncounters(resources)
  expect((hospital as any)._sourceRecordComparison.references).toEqual(['Encounter/hospital-visit', 'Encounter/cloud-visit'])
  expect((secondHospital as any)._sourceRecordComparison.references).toEqual(['Encounter/hospital-second-visit', 'Encounter/cloud-second-visit'])
})

it('does not pair clinics on the same brand at a different strength', () => {
  const { resources, hospital } = twoClinicDay(FEMARA)
  resources.find(resource => resource.id === 'h-order-1').medicationCodeableConcept.coding[0].code = 'Aromasin SC tab 10 mg'
  reconcileOutpatientEncounters(resources)
  // Clinic two still pairs on Femara; clinic one is the only one left for cloud one.
  expect((hospital as any)._sourceRecordComparison.warnings).toContain('paired-by-prescriptions')
  const { resources: tied, hospital: tiedHospital } = twoClinicDay(AROMASIN)
  tied.find(resource => resource.id === 'h-order-1').medicationCodeableConcept.coding[0].code = 'Aromasin SC tab 10 mg'
  tied.find(resource => resource.id === 'h-order-2').medicationCodeableConcept.coding[0].code = 'Aromasin SC tab 10 mg'
  reconcileOutpatientEncounters(tied)
  expect((tiedHospital as any)._sourceRecordComparison.status).toBe('ambiguous')
})

it.each([
  ['a different concentration denominator', 'Methasone inj 5 mg/2 ml', 'METHASONE INJECTION 5MG/ML'],
  ['a different unit', 'Synthbrand tab 5 mcg', 'SYNTHBRAND TABLETS 5MG'],
  ['a missing concentration', 'Methasone inj 5 mg', 'METHASONE INJECTION 5MG/ML'],
])('does not pair a clinic on the same brand with %s', (_, hospitalName, cloudName) => {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  const secondHospital = { ...hospital, id: 'hospital-second-visit' }
  resources.push(secondHospital,
    hospitalOrder('h-order-1', 'hospital-visit', hospitalName), cloudOrder('c-order-1', 'cloud-visit', 'AC00000100', cloudName))
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect((hospital as any)._sourceRecordComparison.status).toBe('ambiguous')
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current).toHaveLength(3)
  expect(result.current.every(needsSourceComparison)).toBe(true)
})

function oneCloudTwoClinics(hospitalName: string, cloudName: string, ingredient?: string, doseForm?: string) {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  const secondHospital = { ...hospital, id: 'hospital-second-visit' }
  const order: any = cloudOrder('c-order-1', 'cloud-visit', 'AC00000100', cloudName)
  resources.push(secondHospital, hospitalOrder('h-order-1', 'hospital-visit', hospitalName), order)
  if (ingredient) {
    order.supportingInformation = [{ reference: 'MedicationKnowledge/official' }]
    resources.push({ resourceType: 'MedicationKnowledge', id: 'official', code: { coding: [{ system: NHI, code: 'AC00000100', display: cloudName }] },
      ingredient: [{ itemCodeableConcept: { text: ingredient } }], ...(doseForm ? { doseForm: { text: doseForm } } : {}) })
  }
  reconcileOutpatientEncounters(resources)
  return (hospital as any)._sourceRecordComparison
}

it('reads the strength from the official ingredient text when the NHI product name omits it', () => {
  expect(oneCloudTwoClinics('Cordarone tab 200 mg', 'CORDARONE TABLETS', 'AMIODARONE HCL 200 MG'))
    .toMatchObject({ status: 'candidate', warnings: ['paired-by-prescriptions'] })
  expect(oneCloudTwoClinics('Cordarone tab 100 mg', 'CORDARONE TABLETS', 'AMIODARONE HCL 200 MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Cordarone tab 200 mg', 'CORDARONE TABLETS').status).toBe('ambiguous')
})

it('reads combination strengths in order and UG as mcg', () => {
  expect(oneCloudTwoClinics('Glyxambi FC # tab 25/5 mg', 'Glyxambi Film-Coated Tablets 25/5 mg').status).toBe('candidate')
  expect(oneCloudTwoClinics('Glyxambi FC # tab 25/5 mg', 'Glyxambi Film-Coated Tablets 10/5 mg').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Methycobal * cap 500 mcg', 'METHYCOBAL CAPSULES 500UG "EISAI" (MECOBALAMIN)').status).toBe('candidate')
})

it('does not pair different products that only share a first word and strength', () => {
  expect(oneCloudTwoClinics('Vitamin B1 tab 50 mg', 'VITAMIN B6 TABLETS 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Vitamin B1 tab 50 mg', 'VITAMIN B1 TABLETS 50MG').status).toBe('candidate')
})

it('still asks for comparison on a pair whose sources declare different ICD coding systems', () => {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  ;(cloud as any).reasonCode = [{ text: 'B02.9', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'B02.9' }] }]
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect((hospital as any)._sourceRecordComparison).toMatchObject({ status: 'ambiguous', warnings: ['diagnosis-coding-systems-differ'] })
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current).toHaveLength(1)
  expect(result.current[0].sourceIds).toHaveLength(2)
  expect(needsSourceComparison(result.current[0])).toBe(true)
})

it('does not pair a different release or dosage form of the same name and strength', () => {
  expect(oneCloudTwoClinics('Syntheticbrand SR tab 50 mg', 'SYNTHETICBRAND TABLETS 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand tab 50 mg', 'SYNTHETICBRAND INJECTION 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand SR tab 50 mg', 'SYNTHETICBRAND PROLONGED-RELEASE TABLETS 50MG').status).toBe('candidate')
  expect(oneCloudTwoClinics('Syntheticbrand for inj 1.34 mg/ml 3 ml', 'SYNTHETICBRAND SOLUTION FOR INJECTION 1.34MG/ML').status).toBe('candidate')
})

it('reads dotted release abbreviations and one official dosage form', () => {
  expect(oneCloudTwoClinics('Syntheticbrand S.R. tab 50 mg', 'SYNTHETICBRAND TABLETS 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand F.C. tab 50 mg', 'SYNTHETICBRAND TABLETS 50MG').status).toBe('candidate')
  expect(oneCloudTwoClinics('Syntheticbrand tab 50 mg', 'SYNTHETICBRAND 50MG', 'SYNTHETIC 50 MG', '咀嚼錠').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand chewable tab 50 mg', 'SYNTHETICBRAND 50MG', 'SYNTHETIC 50 MG', '咀嚼錠').status).toBe('candidate')
})

it('reads a release form written in brackets on either side', () => {
  expect(oneCloudTwoClinics('Syntheticbrand (SR) tab 50 mg', 'SYNTHETICBRAND TABLETS 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand tab 50 mg', 'SYNTHETICBRAND (EXTENDED RELEASE) TABLETS 50MG').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand SR tab 50 mg', 'SYNTHETICBRAND (EXTENDED RELEASE) TABLETS 50MG').status).toBe('candidate')
  expect(oneCloudTwoClinics('Syntheticbrand tab 50 mg (Synthetic)', 'SYNTHETICBRAND TABLETS 50MG "MAKER"').status).toBe('candidate')
})

it('lets no product shortcut skip an official chewable or modified-release form', () => {
  // Official master metadata, so the reconciler's product-match helpers would accept the pair.
  const official = (doseForm: string) => {
    const { resources, hospital, cloud } = fixture()
    delete (hospital as any).identifier; delete (cloud as any).identifier
    const order: any = cloudOrder('c-order-1', 'cloud-visit', 'AC00000100', 'SYNTHETICBRAND TABLETS 50MG')
    order.supportingInformation = [{ reference: 'MedicationKnowledge/official' }]
    resources.push({ ...hospital, id: 'hospital-second-visit' }, hospitalOrder('h-order-1', 'hospital-visit', 'Syntheticbrand tab 50 mg'), order, {
      resourceType: 'MedicationKnowledge', id: 'official', doseForm: { text: doseForm },
      meta: { source: 'https://data.gov.tw/dataset/23715', tag: [{ system: 'https://nhi-fhir-bridge.github.io/CodeSystem/drug-terminology-snapshot', code: '20260728' }] },
      identifier: [{ system: 'https://nhi-fhir-bridge.github.io/IdentifierSystem/nhi-drug-official-url', value: 'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=00000000' }],
      code: { coding: [{ system: NHI, code: 'AC00000100', display: 'SYNTHETICBRAND TABLETS 50MG' }] },
    })
    reconcileOutpatientEncounters(resources)
    return (hospital as any)._sourceRecordComparison.status
  }
  expect(official('咀嚼錠')).toBe('ambiguous')
  expect(official('持續性藥效錠')).toBe('ambiguous')
  expect(official('錠劑')).toBe('candidate')
})

it('reads thousands separators as one number and rejects an unknown denominator', () => {
  expect(oneCloudTwoClinics('Costim inj 1,000,000 IU', 'COSTIM POWDER FOR INJECTION 2,000,000 IU').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Costim inj 1,000,000 IU', 'COSTIM INJECTION 1000000 IU').status).toBe('candidate')
  expect(oneCloudTwoClinics('Syntheticbrand inhalation 50 mcg/2 dose', 'SYNTHETICBRAND INHALATION 50MCG/DOSE').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand inhalation 50 mcg/puff', 'SYNTHETICBRAND INHALATION 50MCG/DOSE').status).toBe('candidate')
  expect(oneCloudTwoClinics('Syntheticbrand tab 50 mg/tab', 'SYNTHETICBRAND TABLETS 50MG/TAB').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand tab 5 mg/20 mg', 'SYNTHETICBRAND 5MG/20MG TABLET').status).toBe('candidate')
})

it('never lets the ingredient text stand in for a concentration the product name states', () => {
  expect(oneCloudTwoClinics('Syntheticbrand inj 5 mg', 'SYNTHETICBRAND INJECTION 5MG/ML', 'EACH ML CONTAINS SYNTHETIC 5 MG', '注射劑').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand inj 5 mg', 'SYNTHETICBRAND INJECTION', 'EACH ML CONTAINS SYNTHETIC 5 MG', '注射劑').status).toBe('ambiguous')
  expect(oneCloudTwoClinics('Syntheticbrand inj 5 mg/1 ml', 'SYNTHETICBRAND INJECTION', 'SYNTHETIC 5 MG/ML', '注射劑').status).toBe('candidate')
})

it('keeps a subset of visit comparison sources usable and marks the missing partner', () => {
  const { resources, hospital, cloud } = fixture()
  delete (hospital as any).identifier; delete (cloud as any).identifier
  reconcileOutpatientEncounters(resources)
  const { result } = renderHook(() => useVisitHistory([hospital]))
  expect(result.current[0].sourceRecords).toHaveLength(1)
  expect(result.current[0].sourceRecords?.[0].origin).toBe('hospital')
  expect(result.current[0].sourceComparisonWarnings).toContain('source-partners-not-in-view')
})

it('recognises the same Taiwan visit date when one source serializes midnight in UTC', () => {
  const { resources, cloud } = fixture()
  cloud.period.start = '2026-09-16T16:00:00Z'
  const visits = reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')
  expect(visits).toHaveLength(1)
  const { result } = renderHook(() => useVisitHistory(visits))
  expect(result.current[0].sourceRecords?.every(source => source.date === '2026-09-17')).toBe(true)
})

it('never treats two unparseable source dates as evidence of the same visit', () => {
  const { resources, hospital, cloud } = fixture()
  hospital.period.start = '2026-13-01'; cloud.period.start = '2026-14-01'
  expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(2)
  expect((hospital as any)._sourceRecordComparison).toBeUndefined()
})
function fixture() {
  const cloud = {
    resourceType: 'Encounter', id: 'cloud-visit', status: 'finished', class: { code: 'AMB' },
    identifier: [{ system: 'https://synthetic.example/visit-id', value: 'confirmed-visit', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'VN' }] } }],
    meta: { source: 'https://medcloud2.nhi.gov.tw/' },
    subject: { reference: 'Patient/synthetic' }, period: { start: '2026-09-17' },
    serviceProvider: { display: '臺北榮總;門診;0601160016' },
    reasonCode: [{ text: 'B02.9 帶狀疱疹未伴有併發症', coding: [{ system: ICD, code: 'B02.9' }] }],
  }
  const hospital = {
    resourceType: 'Encounter', id: 'hospital-visit', status: 'finished', class: { code: 'AMB' },
    identifier: [{ system: 'https://synthetic.example/visit-id', value: 'confirmed-visit', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'VN' }] } }],
    meta: { source: 'https://web9.vghtpe.gov.tw/emr/qemr/',
      tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] },
    subject: { reference: 'Patient/synthetic' }, period: { start: '2026-09-17T00:00:00+08:00' },
    participant: [{ individual: { display: 'Synthetic physician' } }], serviceType: { text: '皮膚科' },
    diagnosis: [{ rank: 1, condition: { reference: 'Condition/hospital-dx' } }],
  }
  const condition = {
    resourceType: 'Condition', id: 'hospital-dx', subject: { reference: 'Patient/synthetic' },
    encounter: { reference: 'Encounter/hospital-visit' },
    code: { text: 'Zoster without complications', coding: [{ system: ICD, code: 'B02.9', display: 'Zoster without complications' }] },
  }
  const resources: any[] = [
    { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic Patient' }] },
    cloud, hospital, condition,
    { resourceType: 'MedicationRequest', id: 'med', status: 'active', subject: { reference: 'Patient/synthetic' },
      encounter: { reference: 'Encounter/hospital-visit' }, medicationCodeableConcept: { text: 'Synthetic medication' } },
    { resourceType: 'Observation', id: 'lab', status: 'final', code: { text: 'Synthetic test' },
      encounter: { reference: 'Encounter/cloud-visit' }, valueString: 'synthetic result' },
    { resourceType: 'DocumentReference', id: 'soap', status: 'current', type: { text: '門診 SOAP 與醫囑' },
      context: { encounter: [{ reference: 'Encounter/hospital-visit' }] },
      content: [{ attachment: { contentType: 'text/plain', data: Buffer.from('Synthetic SOAP').toString('base64') } }] },
    { resourceType: 'Provenance', id: 'import', target: [{ reference: 'Encounter/hospital-visit' }], recorded: '2026-10-19T00:00:00Z' },
  ]
  return { resources, cloud, hospital, condition }
}

it('imports one visit despite Chinese/English labels, with cloud facility and all SOAP-linked data', () => {
  const { resources } = fixture()
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: resources.map(resource => ({ resource })) }
  const original = JSON.stringify(bundle)
  const result = LocalBundleService.parse(bundle)!.collection
  expect(result.encounters).toHaveLength(1)
  expect(result.encounters[0]).toMatchObject({ id: 'cloud-visit',
    serviceProvider: { display: '臺北榮總;門診;0601160016' }, serviceType: { text: '皮膚科' } })
  expect(extractEncounterIcds(result.encounters[0], undefined, 'zh-TW')).toEqual([
    { code: 'B02.9', description: '帶狀疱疹未伴有併發症' },
  ])
  expect(extractEncounterIcds(result.encounters[0], undefined, 'en')[0].description).toBe('Zoster without complications')
  for (const resource of [...result.conditions, ...result.medications, ...result.observations]) {
    expect(resource.encounter?.reference).toBe('Encounter/cloud-visit')
  }
  expect(result.documentReferences[0].context?.encounter?.[0].reference).toBe('Encounter/cloud-visit')
  const { result: history } = renderHook(() => useVisitHistory(result.encounters))
  expect(history.current).toHaveLength(1)
  expect(history.current[0]).toMatchObject({ institution: '臺北榮總',
    icdCodes: [{ code: 'B02.9', description: '帶狀疱疹未伴有併發症' }] })
  expect(JSON.stringify(bundle)).toBe(original)
})

it('rewrites provenance and nested order references, retaining secondary SOAP diagnoses', () => {
  const { resources, hospital } = fixture()
  hospital.diagnosis.push({ rank: 2, condition: { reference: 'Condition/secondary' } })
  resources.push({ resourceType: 'Condition', id: 'secondary', code: { coding: [{ system: ICD, code: 'I10' }] } },
    { resourceType: 'ServiceRequest', id: 'order', encounter: { reference: 'Encounter/hospital-visit' } })
  const graph = reconcileOutpatientEncounters(canonicalizeBundleResources({ entry: resources.map(resource => ({ resource })) }))
  expect(graph.find(resource => resource.id === 'import')?.target[0].reference).toBe('Encounter/hospital-visit')
  expect(graph.find(resource => resource.id === 'order')?.encounter.reference).toBe('Encounter/cloud-visit')
  expect(graph.find(resource => resource.id === 'cloud-visit')?.reasonCode).toHaveLength(2)
})

it('matches dotted and undotted codes without comparing the diagnosis wording', () => {
  const { resources, cloud } = fixture()
  cloud.reasonCode[0].coding[0].code = 'B029'
  expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(1)
})

it('does not equate WHO ICD-10 and CM merely from the legacy versionId=1 exporter hint', () => {
  const { resources, hospital, condition } = fixture()
  ;(hospital as any).meta = { source: 'ehr-fhir-bridge/scraper', versionId: '1' }
  condition.code.coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
  expect(reconcileOutpatientEncounters(resources).filter(r => r.resourceType === 'Encounter')).toHaveLength(2)
  expect((hospital as any)._sourceRecordComparison).toMatchObject({ status: 'ambiguous', warnings: ['diagnosis-coding-systems-differ'] })
  expect(condition.code.coding[0].system).toBe('http://hl7.org/fhir/sid/icd-10')
})

it.each(['supplement', 'standalone', 'qemr'])('labels an unmatched %s outpatient encounter as North VGH', (sourceKind) => {
  const { resources, hospital } = fixture()
  if (sourceKind === 'standalone') (hospital as any).meta = { source: 'ehr-fhir-bridge/scraper' }
  if (sourceKind === 'qemr') (hospital as any).meta = { source: 'https://web9.vghtpe.gov.tw/emr/qemr/' }
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: resources
    .filter(resource => resource.id !== 'cloud-visit').map(resource => ({ resource })) }
  const collection = LocalBundleService.parse(bundle)!.collection
  const { result } = renderHook(() => useVisitHistory(collection.encounters))
  expect(result.current[0].institution).toBe('臺北榮總')
  expect((hospital as any).serviceProvider).toBeUndefined()
})

it('does not replace supplied institutions or label unrelated sources as North VGH', () => {
  const { hospital } = fixture()
  const explicit = { ...hospital, serviceProvider: { display: '來源原有院所' } }
  const unrelated = { ...hospital, id: 'unrelated', meta: { source: 'https://other.example/' } }
  const [first, second] = reconcileOutpatientEncounters([explicit, unrelated])
  expect(first.serviceProvider.display).toBe('來源原有院所')
  expect(second.serviceProvider).toBeUndefined()
})

it.each(['date', 'facility', 'patient', 'diagnosis', 'non-ICD', 'ICD-system', 'physician', 'department', 'identifier', 'two-hospital-visits', 'two-cloud-visits', 'cancelled'])(
  'preserves separate encounters when %s makes the match unsafe', (caseName) => {
    const { resources, cloud, hospital, condition } = fixture()
    if (caseName === 'date') cloud.period.start = '2026-09-16'
    if (caseName === 'facility') cloud.serviceProvider.display = '其他醫院'
    if (caseName === 'patient') cloud.subject.reference = 'Patient/other'
    if (caseName === 'diagnosis') cloud.reasonCode[0].coding[0].code = 'B02.8'
    if (caseName === 'non-ICD') condition.code.coding[0].system = 'http://snomed.info/sct'
    if (caseName === 'ICD-system') condition.code.coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
    if (caseName === 'physician') (cloud as any).participant = [{ individual: { display: 'Other physician' } }]
    if (caseName === 'department') (cloud as any).serviceType = { text: '泌尿科' }
    if (caseName === 'identifier') cloud.identifier[0].value = 'different-visit'
    if (caseName === 'two-hospital-visits') resources.push({ ...hospital, id: 'another-hospital-visit' })
    if (caseName === 'two-cloud-visits') resources.push({ ...cloud, id: 'another-cloud-visit' })
    if (caseName === 'cancelled') hospital.status = 'cancelled'
    const count = resources.filter(resource => resource.resourceType === 'Encounter').length
    expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(count)
  },
)

it('keeps confirmed local encounter aliases usable through shared aggregate and tools', async () => {
  const { resources } = fixture()
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) })!
  const collection = projectClinicalAggregate(parsed.collection)
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection }))
  const result = await (tools.getEncounterDetails as any).execute({ encounterId: collection.encounters[0].id })
  expect(collection.encounters).toHaveLength(1)
  expect(result.data.medications).toHaveLength(1)
  expect(result.data.observations).toHaveLength(1)
  expect(result.encounterLinkUncertainty).toBeUndefined()
})

it('does not trust imported encounter comparison metadata as a policy alias', async () => {
  const { resources, cloud, hospital } = fixture()
  delete (cloud as any).identifier; delete (hospital as any).identifier
  ;(cloud as any)._sourceRecordComparison = { status: 'confirmed', references: ['Encounter/cloud-visit', 'Encounter/hospital-visit'] }
  ;(cloud as any)._sourceEncounterRecords = [{ ...hospital }]
  const parsed = LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) })!
  const collection = projectClinicalAggregate(parsed.collection)
  expect(collection.encounters).toHaveLength(2)
  const tools = createFhirTools(() => ({ patient: parsed.patient, collection }))
  const cloudDetails = await (tools.getEncounterDetails as any).execute({ encounterId: 'cloud-visit' })
  const hospitalDetails = await (tools.getEncounterDetails as any).execute({ encounterId: 'hospital-visit' })
  expect(cloudDetails.data.medications).toHaveLength(0)
  expect(hospitalDetails.data.medications).toHaveLength(1)
})
