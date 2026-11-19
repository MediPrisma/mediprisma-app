import { historySelects } from '@/features/medical-calculator/history-autofill'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { ConditionEntity, EncounterEntity, MedicationEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-11-19')
const condition = (code: string, recordedDate = '2026-06-01'): ConditionEntity =>
  ({ id: `c-${code}`, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] }, recordedDate }) as ConditionEntity
const encounter = (text: string): EncounterEntity =>
  ({ id: `e-${text}`, status: 'finished', period: { start: '2026-09-01' }, reasonCode: [{ text }] }) as EncounterEntity
// TIMI's risk-factor count always answers (否 below three), so it is read on its own below.
const keys = (codes: string[]) => Object.keys(historySelects(codes.map((code) => condition(code)), [], now)).filter((key) => key !== 'timiRiskFactors').sort()

it.each([
  ['I10', ['htn']],
  ['I50.32', ['ascvdOrHf', 'chf', 'hfOver18Months']],
  ['I63.9', ['ascvdOrHf', 'cadOrStroke', 'stroke', 'strokeTiaEmbolism']],
  ['G45.9', ['strokeTiaEmbolism']],
  ['G45.4', []], // transient global amnesia is not a TIA
  ['I25.2', ['ascvdOrHf', 'cadOrStroke', 'ihd', 'vascular']],
  ['I70.21', ['ascvdOrHf', 'pad', 'vascular']],
  ['I73.9', ['ascvdOrHf', 'pad', 'vascular']],
  ['Z95.1', ['priorCabg']],
  ['I25.810', ['ascvdOrHf', 'cadOrStroke', 'ihd', 'priorCabg']],
  ['K74.60', ['chronicLiverDisease', 'liverDisease']],
  ['B15.9', ['liverDisease']], // acute hepatitis A is not chronic liver disease
  ['Z86.71', ['priorVte']],
  ['I82.40', ['priorDvt', 'priorVte']],
  ['I82.501', ['priorDvt', 'priorVte']], // chronic DVT
  ['401.9', []], // ICD-9 is not read
  ['434.11', []],
  ['C34.90', ['activeCancer']],
  ['C44.91', []], // non-melanoma skin cancer
  ['F17.210', ['smoker']],
  ['F17.211', ['smoker']], // remission: answered 否 (below)
  ['J44.9', []],
])('reads %s', (code, expected) => {
  expect(keys([code])).toEqual([...expected].sort())
})

it('answers 否 for current smoking when the only code is remission', () => {
  expect(historySelects([condition('F17.211')], [], now).smoker?.value).toBe('no')
})

it('reads a code from an encounter diagnosis', () => {
  expect(historySelects([], [encounter('I10 Essential hypertension')], now).htn?.value).toBe('yes')
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

const visit = (code: string, start: string): EncounterEntity =>
  ({ id: `v-${code}-${start}`, status: 'finished', period: { start }, reasonCode: [{ coding: [{ code }] }] }) as EncounterEntity

it('reads Wells active cancer from a visit in six months, else 無 naming the older code', () => {
  expect(historySelects([], [visit('C18.9', '2026-10-01')], now).activeCancer?.value).toBe('yes')
  const backfilled = { ...condition('C18.9', '2026-11-01'), onsetDateTime: '2020-01-01', clinicalStatus: 'resolved' } as ConditionEntity
  expect(historySelects([backfilled], [], now).activeCancer?.value).toBe('no')
  const autofill = buildAutofill([], { age: 60, gender: 'male' }, [], [], now, [backfilled], [])
  expect(resolveInput(field('wells-pe', 'cancer'), autofill)).toMatchObject({ value: '0', filled: true })
})

it('lets a newer smoking remission code outrank an older smoking code', () => {
  const found = historySelects([condition('F17.211', '2026-11-01')], [visit('F17.210', '2026-04-01')], now)
  expect(found.smoker?.value).toBe('no')
  expect(historySelects([condition('F17.211', '2026-01-01')], [visit('F17.210', '2026-04-01')], now).smoker?.value).toBe('yes')
})

it('reads the heart-failure course for MAGGIC and LIFE-Preserved', () => {
  const stay = { ...visit('I50.9', '2026-09-01'), class: { code: 'IMP' } } as EncounterEntity
  const found = historySelects([condition('I50.9', '2024-12-01')], [stay], now)
  expect(found.hfOver18Months?.value).toBe('yes')
  expect(found.hfHospitalization?.value).toBe('recent')
  expect(historySelects([condition('I50.9', '2026-03-01')], [visit('I50.9', '2026-03-01')], now)).toMatchObject({ hfOver18Months: { value: 'no' } })
  expect(historySelects([condition('I50.9', '2026-03-01')], [], now).hfHospitalization).toBeUndefined()
})

it('reads impaired fasting glucose for the NAFLD score', () => {
  expect(historySelects([condition('R73.01')], [], now).ifgOrDiabetes?.value).toBe('yes')
})

it('leaves no CHA2DS2-VASc, HAS-BLED or LIFE-Preserved choice blank once the record has loaded', () => {
  const autofill = buildAutofill([], { age: 72, gender: 'female' }, [], [], now, [], [])
  for (const id of ['cha2ds2-va', 'cha2ds2-vasc', 'has-bled', 'h2fpef', 'prevent-ascvd']) {
    const calc = CALCULATORS.find((c) => c.id === id)!
    for (const item of calc.inputs) if (item.type === 'select') expect([id, item.key, resolveInput(item, autofill).value]).not.toEqual([id, item.key, ''])
  }
  const life = CALCULATORS.find((c) => c.id === 'life-preserved')!
  for (const item of life.inputs) if (item.type === 'select') expect([item.key, resolveInput(item, autofill).value]).not.toEqual([item.key, ''])
})

it('answers PREVENT end-stage kidney disease from N18.6 without a dialysis code', () => {
  const autofill = buildAutofill([], { age: 60, gender: 'male' }, [], [], now, [condition('N18.6')], [])
  expect(resolveInput(field('prevent-ascvd', 'eskd'), autofill).value).toBe('yes')
})

it('does not count eye drops as a blood-pressure drug', () => {
  const med = (name: string, extra: object = {}) => ({ id: name, status: 'active', authoredOn: '2026-11-01', medicationCodeableConcept: { text: name }, drugTerminology: { ingredientText: name }, ...extra }) as unknown as MedicationEntity
  const bptreat = (meds: MedicationEntity[]) => resolveInput(field('prevent-ascvd', 'bptreat'), buildAutofill([], { age: 60, gender: 'male' }, [], meds, now, [], [])).value
  expect(bptreat([med('Betaxolol 0.5% eye drops')])).toBe('no')
  expect(bptreat([med('Betaxolol 0.5% eye drops'), med('Amlodipine 5 mg')])).toBe('yes')
})

it('reads a stroke history coded only as Z86.73 as known CVD for PREVENT', () => {
  const autofill = buildAutofill([], { age: 60, gender: 'male' }, [], [], now, [condition('Z86.73')], [])
  expect(resolveInput(field('prevent-ascvd', 'cvd'), autofill).value).toBe('yes')
})

it('reads an HF hospitalization whose diagnosis references a Condition', () => {
  const stay = { id: 'adm', status: 'finished', class: { code: 'IMP' }, period: { start: '2026-09-01' }, diagnosis: [{ condition: { reference: 'Condition/c-I50.9' } }] } as EncounterEntity
  expect(historySelects([condition('I50.9', '2026-09-01')], [stay], now).hfHospitalization?.value).toBe('recent')
})

it('counts TIMI risk factors from codes: three or more is 是, fewer names what was found', () => {
  const three = historySelects([condition('I10'), condition('E78.5'), condition('E11.9')], [], now).timiRiskFactors
  expect(three).toMatchObject({ value: 'yes', testName: '危險因子 3 項：高血壓、高血脂、糖尿病（請核對）' })
  const two = historySelects([condition('I10'), condition('F17.210')], [], now).timiRiskFactors
  expect(two).toMatchObject({ value: 'no', testName: '病歷診斷碼見危險因子 2 項（高血壓、吸菸），未含家族史，預設無（請核對）' })
  // A smoker in remission is not counted.
  expect(historySelects([condition('I10'), condition('E78.0'), condition('F17.211')], [], now).timiRiskFactors?.value).toBe('no')
})
