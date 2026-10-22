import { renderHook } from '@testing-library/react'
import { buildIcdDictionary, extractEncounterIcds, localizedIcdDescription } from '@/src/shared/utils/icd-lookup'
import { useDiagnosisRows } from '@/features/clinical-summary/diagnosis/hooks/useDiagnosisRows'

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'

it('does not present a broad ICD category as the exact wording of a more specific recorded code', () => {
  expect(extractEncounterIcds({ reasonCode: [{ coding: [{ system: ICD, code: 'C50.912' }] }] }, new Map(), 'zh-TW'))
    .toEqual([{ code: 'C50.912', description: undefined }])
  expect(extractEncounterIcds({ reasonCode: [{ text: 'C50.912,N95.1' }] }, new Map(), 'zh-TW'))
    .toEqual([{ code: 'C50.912', description: undefined }, { code: 'N95.1', description: undefined }])
})
const hospital = { id: 'synthetic-soap', code: { text: 'Zoster without complications',
  coding: [{ system: ICD, code: 'B02.9', display: 'Zoster without complications' }] } }
const cloud = { meta: { source: 'https://medcloud2.nhi.gov.tw/' }, reasonCode: [{ text: 'B029 帶狀疱疹未伴有併發症',
  coding: [{ system: ICD, code: 'B029', display: 'Zoster without complications' }] }] }

it('uses an exact cloud Chinese label for the English SOAP diagnosis in the recorded-condition UI', () => {
  const before = JSON.stringify(hospital)
  const dict = buildIcdDictionary([hospital], 'zh-TW', [cloud])
  const { result } = renderHook(() => useDiagnosisRows([hospital], 'zh-TW', dict))
  expect(result.current[0]).toMatchObject({ title: '帶狀疱疹未伴有併發症', icdCodes: ['B02.9'] })
  expect(JSON.stringify(hospital)).toBe(before)
})

it('prefers exact Chinese wording in visit rows even when their source text is English', () => {
  const dict = buildIcdDictionary([hospital], 'zh-TW', [cloud])
  const visit = { reasonCode: [hospital.code] }
  expect(extractEncounterIcds(visit, dict, 'zh-TW')).toEqual([
    { code: 'B02.9', description: '帶狀疱疹未伴有併發症' },
  ])
  expect(extractEncounterIcds(visit, dict, 'en')[0].description).toBe('Zoster without complications')
})

it('does not let a later English-only condition overwrite Chinese from the same code', () => {
  const chinese = { code: { text: '帶狀疱疹未伴有併發症', coding: [{ system: ICD, code: 'B02.9', display: '帶狀疱疹未伴有併發症' }] } }
  for (const conditions of [[chinese, hospital], [hospital, chinese]]) {
    const dict = buildIcdDictionary(conditions, 'zh-TW')
    expect(localizedIcdDescription('B029', hospital.code.text, undefined, dict)).toBe('帶狀疱疹未伴有併發症')
  }
})

it('retains the specific source wording when only a broader Chinese category is available', () => {
  const dict = buildIcdDictionary([{ code: { text: '乳房惡性腫瘤', coding: [{ system: ICD, code: 'C50' }] } }], 'zh-TW')
  expect(localizedIcdDescription('C50.912', 'Specific source diagnosis', undefined, dict)).toBe('Specific source diagnosis')
})

it('does not borrow Chinese from a different complete ICD code', () => {
  const dict = buildIcdDictionary([hospital], 'zh-TW', [cloud])
  expect(localizedIcdDescription('B02.8', 'Different diagnosis', undefined, dict)).toBe('Different diagnosis')
})

it('keeps ICD-10-CM, WHO ICD-10 and non-ICD code namespaces separate', () => {
  const conditions = [
    { code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'B02.9', display: 'WHO 原始標籤' }] } },
    { code: { text: '院內非 ICD 代碼', coding: [{ system: 'https://synthetic.example/local', code: 'B02.9' }] } },
    { code: { coding: [{ system: ICD, code: 'B02.9', display: 'CM 中文標籤' }] } },
  ]
  const dict = buildIcdDictionary(conditions, 'zh-TW')
  expect(localizedIcdDescription('B02.9', 'English source', undefined, dict, 'zh-TW', ICD)).toBe('CM 中文標籤')
  expect(localizedIcdDescription('B02.9', 'English source', undefined, dict, 'zh-TW', 'http://hl7.org/fhir/sid/icd-10')).toBe('WHO 原始標籤')
  expect(localizedIcdDescription('B02.9', 'English source', undefined, dict, 'zh-TW', 'https://synthetic.example/local')).toBe('English source')
})

it('keeps clinically richer original SOAP text available behind the Chinese terminology label', () => {
  const originalText = 'Zoster without complications; clinical note: left thoracic dermatomes'
  const source = { ...hospital, code: { ...hospital.code, text: originalText } }
  const dict = buildIcdDictionary([source], 'zh-TW', [cloud])
  const { result } = renderHook(() => useDiagnosisRows([source], 'zh-TW', dict))
  expect(result.current[0].title).toBe('帶狀疱疹未伴有併發症')
  expect(result.current[0].records?.[0].originalText).toBe(originalText)
})

it('never borrows patient-specific Chinese narrative as another diagnosis record’s translation', () => {
  const clinicalText = { code: { text: '帶狀疱疹，左胸皮節，仍有水泡', coding: [{ system: ICD, code: 'B02.9', display: 'Zoster without complications' }] } }
  const dict = buildIcdDictionary([clinicalText], 'zh-TW')
  expect(localizedIcdDescription('B02.9', 'Zoster; right lumbar dermatomes', undefined, dict, 'zh-TW', ICD))
    .toBe('Zoster; right lumbar dermatomes')
})

it('does not borrow the North VGH SOAP narrative even when its mapper placed it in coding.display', () => {
  const text = '疑似左乳癌，待病理確認'
  const soap = { meta: { source: 'ehr-fhir-bridge/scraper' }, code: { text, coding: [{ system: ICD, code: 'C50.912', display: text }] } }
  const dict = buildIcdDictionary([soap], 'zh-TW')
  expect(localizedIcdDescription('C50.912', 'Confirmed prior malignancy', undefined, dict, 'zh-TW', ICD)).toBe('Confirmed prior malignancy')
})
