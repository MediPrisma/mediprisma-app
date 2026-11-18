import { historySelects } from '@/features/medical-calculator/history-autofill'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-11-19')
const condition = (code: string, recordedDate = '2026-06-01'): ConditionEntity =>
  ({ id: `c-${code}`, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] }, recordedDate }) as ConditionEntity
const encounter = (text: string): EncounterEntity =>
  ({ id: `e-${text}`, status: 'finished', period: { start: '2026-09-01' }, reasonCode: [{ text }] }) as EncounterEntity
const keys = (codes: string[]) => Object.keys(historySelects(codes.map((code) => condition(code)), [], now)).sort()

it.each([
  ['I10', ['htn']],
  ['I50.32', ['chf']],
  ['I63.9', ['cadOrStroke', 'stroke', 'strokeTiaEmbolism']],
  ['G45.9', ['strokeTiaEmbolism']],
  ['G45.4', []], // transient global amnesia is not a TIA
  ['I25.2', ['cadOrStroke', 'ihd', 'vascular']],
  ['I70.21', ['vascular']],
  ['K74.60', ['chronicLiverDisease', 'liverDisease']],
  ['B15.9', ['liverDisease']], // acute hepatitis A is not chronic liver disease
  ['Z86.71', ['priorVte']],
  ['I82.40', ['priorDvt', 'priorVte']],
  ['C34.90', ['activeCancer']],
  ['C44.91', []], // non-melanoma skin cancer
  ['F17.210', ['smoker']],
  ['F17.211', []], // nicotine dependence in remission
  ['J44.9', []],
])('reads %s', (code, expected) => {
  expect(keys([code])).toEqual([...expected].sort())
})

it('counts cancer treated within six months only', () => {
  expect(historySelects([condition('C18.9', '2026-01-01')], [], now).activeCancer).toBeUndefined()
})

it('reads an ICD-9 code from an encounter diagnosis', () => {
  expect(historySelects([], [encounter('401.9 Essential hypertension')], now).htn?.value).toBe('yes')
})

const field = (calcId: string, key: string) => CALCULATORS.find((c) => c.id === calcId)!.inputs.find((i) => i.key === key)!

it('fills CHA2DS2-VASc histories from codes and the rest 無', () => {
  const autofill = buildAutofill([], { age: 72, gender: 'female' }, [], [], now, [condition('I11.0'), condition('I10')], [])
  const read = (key: string) => resolveInput(field('cha2ds2-vasc', key), autofill)
  expect(read('chf')).toMatchObject({ value: 'yes', filled: true })
  expect(read('htn')).toMatchObject({ value: 'yes', filled: true })
  expect(read('stroke')).toMatchObject({ value: 'no', source: { testName: '紀錄未見，預設「無」（請核對）' } })
})

it("maps the record's 是 onto Wells' option values", () => {
  const autofill = buildAutofill([], { age: 60, gender: 'male' }, [], [], now, [condition('I26.99')], [])
  expect(resolveInput(field('wells-pe', 'prior'), autofill).value).toBe('1')
  expect(resolveInput(field('wells-pe', 'cancer'), autofill).value).toBe('0')
})

it('keeps a resolved stroke as history but not a resolved smoking code', () => {
  const resolved = (code: string) => ({ ...condition(code), clinicalStatus: 'resolved' }) as ConditionEntity
  const found = historySelects([resolved('I63.9'), resolved('F17.210')], [], now)
  expect(found.strokeTiaEmbolism?.value).toBe('yes')
  expect(found.smoker).toBeUndefined()
})

it('answers Wells DVT 「曾確診 DVT」 否 for a PE-only history', () => {
  const autofill = buildAutofill([], { age: 60, gender: 'male' }, [], [], now, [condition('I26.99')], [])
  expect(resolveInput(field('wells-dvt', 'priordvt'), autofill).value).toBe('0')
})
