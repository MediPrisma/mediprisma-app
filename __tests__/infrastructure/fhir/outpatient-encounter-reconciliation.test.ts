import { LocalBundleService, canonicalizeBundleResources } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileOutpatientEncounters } from '@/src/infrastructure/fhir/services/outpatient-encounter-reconciliation'
import { extractEncounterIcds, buildIcdDictionary, localizedIcdDescription } from '@/src/shared/utils/icd-lookup'
import { renderHook } from '@testing-library/react'
import { useVisitHistory } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'
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
