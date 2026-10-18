import { getVghtpeSource, mergeHospitalSources } from '@/features/clinical-summary/reports/adapters/vghtpe-source-display'
import { formatSourceInstitution, sourceInstitutionDisplay } from '@/features/clinical-summary/reports/utils/source-institution-display'
import { buildReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { groupLabReportsByDay } from '@/features/clinical-summary/reports/utils/lab-day-grouping'

const internal = { meta: { tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }] } }
const cloud = { meta: { source: 'https://medcloud2.nhi.gov.tw/' } }

it('aggregates provenance independently of member arrival order', () => {
  expect(mergeHospitalSources([undefined, 'cloud'])).toBe('cloud')
  expect(mergeHospitalSources(['cloud', undefined])).toBe('cloud')
  expect(mergeHospitalSources(['in-house', 'cloud'])).toBe('cloud-and-in-house')
  expect(mergeHospitalSources(['cloud', 'in-house'])).toBe('cloud-and-in-house')
  expect(getVghtpeSource([{meta:{source:'https://medcloud2.nhi.gov.tw'}}])).toBe('cloud')
})

it('returns explicit name and suffix parts without parsing institution text', () => {
  expect(sourceInstitutionDisplay('臺北榮總', 'in-house', 'en')).toEqual({
    name:'臺北榮總', suffix:'(In-house)', label:'臺北榮總 (In-house)',
  })
  expect(sourceInstitutionDisplay('Test Hospital(院內)', undefined, 'zh-TW')).toEqual({
    name:'Test Hospital(院內)', suffix:'', label:'Test Hospital(院內)',
  })
})

it('preserves raw institution identity through report mapping and aggregates source labels', () => {
  const report = (id: string, source: object) => ({
    id, status: 'final', category: [{ coding: [{ code: 'LAB' }] }], code: { text: id },
    effectiveDateTime: '2026-01-01', performer: [{ display: '臺北榮民總醫院' }], ...source,
    _observations: [{ id: `obs-${id}`, code: { coding: [{ system: 'http://loinc.org', code: '2571-8' }] }, valueQuantity: {value:100,unit:'mg/dL'} }],
  })
  const raw = [report('inside', internal), report('cloud', cloud)]
  const before = JSON.stringify(raw)
  const rows = buildReportsData(raw).reportRows
  expect(rows.map(row => row.institution)).toEqual(['臺北榮民總醫院', '臺北榮民總醫院'])
  expect(rows.map(row => row.hospitalSource).sort()).toEqual(['cloud', 'in-house'])
  expect(groupLabReportsByDay(rows)[0].hospitalSource).toBe('cloud-and-in-house')
  expect(JSON.stringify(raw)).toBe(before)
})

it('preserves each source spelling and infers no in-house provenance from the name', () => {
  for (const name of ['臺北榮總', '台北榮總', '臺北榮民總醫院', '台北榮民總醫院']) {
    expect(formatSourceInstitution(name, undefined, 'zh-TW')).toBe(name)
    expect(formatSourceInstitution(name, 'in-house', 'zh-TW')).toBe('臺北榮總(院內)')
    expect(formatSourceInstitution(name, 'cloud-and-in-house', 'zh-TW')).toBe('臺北榮總(院內+雲端)')
    expect(formatSourceInstitution(name, undefined, 'en')).toBe(name)
  }
  expect(formatSourceInstitution('高雄榮民總醫院', 'in-house', 'zh-TW')).toBe('高雄榮民總醫院')
  expect(getVghtpeSource([{}])).toBeUndefined()
})

it('labels recorded in-house and merged sources without changing the source', () => {
  const before = JSON.stringify(internal)
  expect(formatSourceInstitution('臺北榮民總醫院', getVghtpeSource([internal]), 'zh-TW')).toBe('臺北榮總(院內)')
  const merged = { ...internal, extension: [{ url: 'urn:wildcatch:dedup-method' }] }
  expect(formatSourceInstitution('臺北榮總', getVghtpeSource([merged]), 'zh-TW')).toBe('臺北榮總(院內+雲端)')
  expect(getVghtpeSource([internal, cloud])).toBe('cloud-and-in-house')
  expect(formatSourceInstitution('臺北榮總', getVghtpeSource([cloud]), 'zh-TW')).toBe('臺北榮總')
  expect(formatSourceInstitution('臺北榮總', 'in-house', 'en')).toBe('臺北榮總 (In-house)')
  expect(JSON.stringify(internal)).toBe(before)
})
