// Owner rule 2026-11-19: prefill everything the FHIR record holds; what it lacks is presumed 「無」.
import { computeAutofilledResult, resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { ConditionEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-11-19')
const field = (calcId: string, key: string) => CALCULATORS.find((c) => c.id === calcId)!.inputs.find((i) => i.key === key)!
const obs = (loinc: string, value: number, unit: string, date = '2026-11-01') =>
  ({ id: `o-${loinc}-${value}`, status: 'final', effectiveDateTime: date, code: { coding: [{ system: 'http://loinc.org', code: loinc }] }, valueQuantity: { value, unit } })
const condition = (code: string, clinicalStatus = 'active') =>
  ({ id: code, clinicalStatus, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] }, recordedDate: '2025-06-01' }) as ConditionEntity
const autofill = (opts: { age?: number; observations?: object[]; conditions?: ConditionEntity[] } = {}) =>
  buildAutofill((opts.observations ?? []) as never, { age: opts.age ?? 75, gender: 'male' }, [], [], now, opts.conditions ?? [], [])
const value = (calcId: string, key: string, data: ReturnType<typeof autofill>) => resolveInput(field(calcId, key), data).value

it('answers Rockall age from the patient age', () => {
  expect(value('rockall', 'age', autofill({ age: 45 }))).toBe('0')
  expect(value('rockall', 'age', autofill({ age: 60 }))).toBe('1')
  expect(value('rockall', 'age', autofill({ age: 85 }))).toBe('2')
})

it('answers Rockall comorbidity from diagnosis codes, else 無', () => {
  expect(value('rockall', 'comorbid', autofill({ conditions: [condition('C78.7')] }))).toBe('2')
  expect(value('rockall', 'comorbid', autofill({ conditions: [condition('N18.5')] }))).toBe('2')
  expect(value('rockall', 'comorbid', autofill({ conditions: [condition('I25.10')] }))).toBe('1')
  expect(value('rockall', 'comorbid', autofill({ conditions: [condition('N17.9', 'resolved')] }))).toBe('0')
  expect(resolveInput(field('rockall', 'comorbid'), autofill())).toMatchObject({ value: '0', source: { testName: '紀錄未見，預設「無 (0)」（請核對）' } })
})

it('answers ABCD² age and blood pressure from the record', () => {
  expect(value('abcd2', 'age', autofill({ age: 59 }))).toBe('0')
  expect(value('abcd2', 'age', autofill({ age: 60 }))).toBe('1')
  expect(value('abcd2', 'bp', autofill({ observations: [obs('8480-6', 128, 'mm[Hg]'), obs('8462-4', 92, 'mm[Hg]')] }))).toBe('1')
  expect(value('abcd2', 'bp', autofill({ observations: [obs('8480-6', 128, 'mm[Hg]'), obs('8462-4', 78, 'mm[Hg]')] }))).toBe('0')
  expect(value('abcd2', 'bp', autofill({ observations: [obs('8480-6', 19, 'kPa')] }))).toBe('1')
  expect(value('abcd2', 'bp', autofill())).toBe('0')
})

it('leaves ABCD² blood pressure blank when a reading has an unreadable unit', () => {
  expect(value('abcd2', 'bp', autofill({ observations: [obs('8480-6', 128, 'bar?')] }))).toBe('')
})

it('fills blood pressure, heart rate, temperature, respiratory rate and QT from FHIR vitals', () => {
  const data = autofill({ observations: [obs('8480-6', 130, 'mm[Hg]'), obs('8462-4', 80, 'mm[Hg]'), obs('8867-4', 96, '/min'), obs('8310-5', 38.4, 'Cel'), obs('9279-1', 22, '/min'), obs('8634-8', 400, 'ms')] })
  expect(value('map', 'sbp', data)).toBe('130')
  expect(value('map', 'dbp', data)).toBe('80')
  expect(value('glasgow-blatchford', 'sbp', data)).toBe('130')
  expect(value('aims65', 'sbp', data)).toBe('130')
  expect(value('sirs', 'temp', data)).toBe('38.4')
  expect(value('sirs', 'hr', data)).toBe('96')
  expect(value('sirs', 'rr', data)).toBe('22')
  expect(value('qtc', 'qt', data)).toBe('400')
  expect(value('qtc', 'hr', data)).toBe('96')
  // UCUM 「Cel」 and 「/min」 are the inputs' own units, not a mismatch.
  expect(resolveInput(field('sirs', 'temp'), data).unconvertible).toBe(false)
  expect(resolveInput(field('sirs', 'hr'), data).unconvertible).toBe(false)
  expect(resolveInput(field('map', 'sbp'), data).unconvertible).toBe(false)
})

it('fills segmented neutrophils as a percentage only', () => {
  const pct = { id: 'n1', status: 'final', effectiveDateTime: '2026-11-01', code: { text: 'Neutrophil segmented' }, valueQuantity: { value: 62, unit: '%' } }
  const count = { ...pct, id: 'n2', valueQuantity: { value: 3100, unit: '/uL' } }
  expect(value('anc', 'neut', autofill({ observations: [pct] }))).toBe('62')
  expect(value('anc', 'neut', autofill({ observations: [count] }))).toBe('')
})

it('converts kPa blood pressure before MAP and the bleeding scores use it', () => {
  const data = autofill({ observations: [obs('8480-6', 16, 'kPa'), obs('8462-4', 10, 'kPa')] })
  expect(value('map', 'sbp', data)).toBe('120.01')
  expect(value('map', 'dbp', data)).toBe('75.01')
  expect(value('glasgow-blatchford', 'sbp', data)).toBe('120.01')
  expect(value('aims65', 'sbp', data)).toBe('120.01')
})

it('keeps an FiO2 fraction converted to a percentage', () => {
  const data = autofill({ observations: [obs('3150-0', 0.4, '1')] })
  const fio2 = CALCULATORS.flatMap((c) => c.inputs).find((i) => i.key === 'fio2' && i.type === 'number')!
  expect(resolveInput(fio2, data).value).toBe('40')
})

it('does not count a resolved kidney injury again from an old visit', () => {
  const visit = { id: 'e1', status: 'finished', class: { code: 'AMB' }, period: { start: '2025-03-01' }, reasonCode: [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'N17.9' }] }] }
  const data = buildAutofill([], { age: 75, gender: 'male' }, [], [], now, [condition('N17.9', 'resolved')], [visit] as never)
  expect(value('rockall', 'comorbid', data)).toBe('0')
})

it('still counts a different current failure seen only on a visit', () => {
  const visit = (id: string, code: string) => ({ id, status: 'finished', class: { code: 'AMB' }, period: { start: '2026-03-01' }, reasonCode: [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] }] })
  const data = buildAutofill([], { age: 75, gender: 'male' }, [], [], now, [condition('N17.9', 'resolved')], [visit('e1', 'N17.9'), visit('e2', 'C78.7')] as never)
  expect(value('rockall', 'comorbid', data)).toBe('2')
})

it('counts a kidney injury that recurs on a visit after the resolved one', () => {
  const visit = { id: 'e1', status: 'finished', class: { code: 'AMB' }, period: { start: '2026-11-18' }, reasonCode: [{ coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'N17.9' }] }] }
  const data = buildAutofill([], { age: 75, gender: 'male' }, [], [], now, [condition('N17.9', 'resolved')], [visit] as never)
  expect(value('rockall', 'comorbid', data)).toBe('2')
})

it('converts a QT in seconds to milliseconds, so QTc matches the same reading in ms', () => {
  const qtc = CALCULATORS.find((c) => c.id === 'qtc')!
  const result = (qt: object) => computeAutofilledResult(qtc, autofill({ observations: [qt, obs('8867-4', 60, '/min')] }))?.result
  const inSeconds = result(obs('8634-8', 0.52, 's'))
  expect(value('qtc', 'qt', autofill({ observations: [obs('8634-8', 0.52, 's')] }))).toBe('520')
  expect(inSeconds).toEqual(result(obs('8634-8', 520, 'ms')))
  expect(result(obs('8634-8', 0.52, 'furlong'))).toBeUndefined()
})
