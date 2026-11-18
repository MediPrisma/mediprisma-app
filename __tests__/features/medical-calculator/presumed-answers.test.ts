// Owner decision 2026-11-19: what the record does not show is presumed absent
// and filled, marked 預設（請核對）, for the clinician to change.
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill, type Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { SelectInput } from '@/features/medical-calculator/types'

const input = (calcId: string, key: string) => {
  const found = CALCULATORS.find((calc) => calc.id === calcId)?.inputs.find((item) => item.key === key)
  if (found?.type !== 'select') throw new Error(`${calcId}.${key}`)
  return found as SelectInput
}
const loaded = (clinicalSelects: Autofill['clinicalSelects']): Autofill => ({ resolve: () => undefined, clinicalSelects, recordLoaded: true })
const loading: Autofill = { resolve: () => undefined, recordLoaded: false }

it('fills a bedside question with its presumed answer and says so', () => {
  const hit = resolveInput(input('curb-65', 'confusion'), loading)
  expect(hit).toMatchObject({ value: 'no', filled: true, source: { testName: '預設「否」（請核對）' } })
})

it('presumes a record question absent only once the record has loaded', () => {
  const diabetes = input('cha2ds2-vasc', 'dm')
  expect(resolveInput(diabetes, loading)).toMatchObject({ value: '', filled: false })
  expect(resolveInput(diabetes, loaded({}))).toMatchObject({ value: 'no', filled: true, source: { testName: '紀錄未見，預設「無」（請核對）' } })
})

it('keeps what the record shows over the presumed answer', () => {
  const autofill = loaded({ diabetes: { value: 'yes', date: '2026-10-01', testName: '糖尿病診斷碼：E11.9（請核對）' } })
  expect(resolveInput(input('who-cvd-2019', 'dm'), autofill)).toMatchObject({ value: 'yes', source: { testName: '糖尿病診斷碼：E11.9（請核對）' } })
})

it('presumes Wells items 「否」 by their option index', () => {
  expect(resolveInput(input('wells-pe', 'hemoptysis'), loaded({})).value).toBe('0')
})

it('answers HAS-BLED age >65 from the patient age', () => {
  const elderly = input('has-bled', 'elderly')
  const at = (age: number) => resolveInput(elderly, buildAutofill([], { age, gender: 'female' }, [], [], new Date('2026-11-19')))
  expect(at(66)).toMatchObject({ value: 'yes', source: { testName: '年齡 66 歲' } })
  expect(at(65).value).toBe('no')
})

it('fills every presumed answer with one of its own options', () => {
  for (const calc of CALCULATORS) for (const item of calc.inputs) {
    if (item.type === 'select' && item.presumed !== undefined) expect(item.options.map((o) => o.value)).toContain(item.presumed)
  }
})

it('presumes nothing while the chart reloads, even with a CDSS NYHA answer', () => {
  const nyhaOnly: Autofill = { resolve: () => undefined, recordLoaded: false, clinicalSelects: { nyha: { value: '2', date: '2026-11-19', testName: 'CDSS 門診評估：NYHA II' } } }
  expect(resolveInput(input('maggic-hf', 'diabetes'), nyhaOnly)).toMatchObject({ value: '', filled: false })
})

it('leaves questions it cannot read from the record unanswered', () => {
  for (const [calc, key] of [['glasgow-blatchford', 'hepatic'], ['nafld-fibrosis', 'dm'], ['meld-na', 'dialysis'], ['meld-3', 'dialysis'],
    ['wells-dvt', 'cancer'], ['wells-dvt', 'priordvt'], ['wells-pe', 'prior'], ['wells-pe', 'cancer']]) {
    expect(resolveInput(input(calc, key), loaded({})).value).toBe('')
  }
})
