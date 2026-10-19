import { LocalBundleService, canonicalizeBundleResources } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileOutpatientEncounters } from '@/src/infrastructure/fhir/services/outpatient-encounter-reconciliation'
import { extractEncounterIcds } from '@/src/shared/utils/icd-lookup'
import { renderHook } from '@testing-library/react'
import { useVisitHistory } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'
function fixture() {
  const cloud = {
    resourceType: 'Encounter', id: 'cloud-visit', status: 'finished', class: { code: 'AMB' },
    meta: { source: 'https://medcloud2.nhi.gov.tw/' },
    subject: { reference: 'Patient/synthetic' }, period: { start: '2026-09-17' },
    serviceProvider: { display: '臺北榮總;門診;0601160016' },
    reasonCode: [{ text: 'B02.9 帶狀疱疹未伴有併發症', coding: [{ system: ICD, code: 'B02.9' }] }],
  }
  const hospital = {
    resourceType: 'Encounter', id: 'hospital-visit', status: 'finished', class: { code: 'AMB' },
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
  expect(graph.find(resource => resource.id === 'import')?.target[0].reference).toBe('Encounter/cloud-visit')
  expect(graph.find(resource => resource.id === 'order')?.encounter.reference).toBe('Encounter/cloud-visit')
  expect(graph.find(resource => resource.id === 'cloud-visit')?.reasonCode).toHaveLength(2)
})

it('matches dotted and undotted codes without comparing the diagnosis wording', () => {
  const { resources, cloud } = fixture()
  cloud.reasonCode[0].coding[0].code = 'B029'
  expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(1)
})

it('recognizes the documented legacy VGH exporter CM hint without equating unrelated ICD systems', () => {
  const { resources, hospital, condition } = fixture()
  ;(hospital as any).meta = { source: 'ehr-fhir-bridge/scraper', versionId: '1' }
  condition.code.coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
  expect(reconcileOutpatientEncounters(resources).filter(r => r.resourceType === 'Encounter')).toHaveLength(1)
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

it.each(['date', 'facility', 'patient', 'diagnosis', 'non-ICD', 'ICD-system', 'physician', 'two-hospital-visits', 'two-cloud-visits', 'cancelled'])(
  'preserves separate encounters when %s makes the match unsafe', (caseName) => {
    const { resources, cloud, hospital, condition } = fixture()
    if (caseName === 'date') cloud.period.start = '2026-09-16'
    if (caseName === 'facility') cloud.serviceProvider.display = '其他醫院'
    if (caseName === 'patient') cloud.subject.reference = 'Patient/other'
    if (caseName === 'diagnosis') cloud.reasonCode[0].coding[0].code = 'B02.8'
    if (caseName === 'non-ICD') condition.code.coding[0].system = 'http://snomed.info/sct'
    if (caseName === 'ICD-system') condition.code.coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
    if (caseName === 'physician') (cloud as any).participant = [{ individual: { display: 'Other physician' } }]
    if (caseName === 'two-hospital-visits') resources.push({ ...hospital, id: 'another-hospital-visit' })
    if (caseName === 'two-cloud-visits') resources.push({ ...cloud, id: 'another-cloud-visit' })
    if (caseName === 'cancelled') hospital.status = 'cancelled'
    const count = resources.filter(resource => resource.resourceType === 'Encounter').length
    expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(count)
  },
)
