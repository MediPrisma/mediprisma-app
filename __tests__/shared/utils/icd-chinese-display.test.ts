import { renderHook } from '@testing-library/react'
import { buildIcdDictionary, extractEncounterIcds, localizedIcdDescription } from '@/src/shared/utils/icd-lookup'
import { useDiagnosisRows } from '@/features/clinical-summary/diagnosis/hooks/useDiagnosisRows'

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'
const hospital = { id: 'synthetic-soap', code: { text: 'Zoster without complications',
  coding: [{ system: ICD, code: 'B02.9', display: 'Zoster without complications' }] } }
const cloud = { reasonCode: [{ text: 'B029 帶狀疱疹未伴有併發症',
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
  const chinese = { code: { text: '帶狀疱疹未伴有併發症', coding: [{ system: ICD, code: 'B02.9' }] } }
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
