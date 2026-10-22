import { doacPatientSelects, upperLimitFromText, type LabObservation } from '@/features/medical-calculator/doac-patient-autofill'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { ConditionEntity, EncounterEntity } from '@/src/core/entities/clinical-data.entity'

const now = new Date('2026-10-22T08:00:00+08:00')

function lab(name: string, loinc: string, value: number, high: number | undefined, date: string, unit = 'U/L', id = `${name}-${date}`): LabObservation {
  return {
    id, status: 'final', effectiveDateTime: date,
    code: { text: name, coding: [{ system: 'http://loinc.org', code: loinc, display: name }] },
    valueQuantity: { value, unit }, specimen: { display: 'Serum' },
    ...(high !== undefined ? { referenceRange: [{ high: { value: high, unit } }] } : {}),
  }
}
const alt = (value: number, high: number | undefined, date = '2026-09-01') => lab('ALT', '1742-6', value, high, date)
const ast = (value: number, high: number | undefined, date = '2026-09-01') => lab('AST', '1920-8', value, high, date)
const bili = (value: number, high: number | undefined, date = '2026-09-01') => lab('Total bilirubin', '1975-2', value, high, date, 'mg/dL')

const condition = (code: string, date = '2026-05-01'): ConditionEntity => ({ id: `c-${code}`, clinicalStatus: 'active', recordedDate: date, code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }] } } as ConditionEntity)
const hypertension = condition('I10')

function selects(over: Partial<Parameters<typeof doacPatientSelects>[0]> = {}) {
  return doacPatientSelects({ observations: [], conditions: [], encounters: [] as EncounterEntity[], demographics: {}, now, ...over })
}

describe('DOAC calculator: liver tests against the report’s own ULN', () => {
  it('either ALT or AST above 2×ULN is 「yes」, named with its value and limit', () => {
    const out = selects({ observations: [alt(130, 40), ast(30, 35)] })
    expect(out.doac_liver_enzymes).toMatchObject({ value: 'yes', testName: 'ALT 130（ULN 40），>2×ULN（請核對）', resourceType: 'Observation' })
  })
  it('「no」 only when both are known and neither is above 2×ULN', () => {
    expect(selects({ observations: [alt(70, 40), ast(30, 35)] }).doac_liver_enzymes).toMatchObject({ value: 'no', testName: 'ALT 70（ULN 40）、AST 30（ULN 35），均 ≤2×ULN' })
    expect(selects({ observations: [alt(30, 40)] }).doac_liver_enzymes).toBeUndefined()
  })
  it('the newest result without a limit leaves it unknown; an older one with a limit is not used instead', () => {
    expect(selects({ observations: [alt(30, 40, '2026-01-01'), alt(35, undefined, '2026-09-01'), ast(20, 35)] }).doac_liver_enzymes).toBeUndefined()
  })
  it('a limit in another unit is not a limit', () => {
    const odd = { ...alt(30, 40), referenceRange: [{ high: { value: 0.7, unit: 'ukat/L' } }] }
    expect(selects({ observations: [odd, ast(20, 35)] }).doac_liver_enzymes).toBeUndefined()
  })
  it('the older of the two dates is the one shown, so the age is never understated', () => {
    expect(selects({ observations: [alt(30, 40, '2026-09-01'), ast(20, 35, '2025-11-01')] }).doac_liver_enzymes?.date).toBe('2025-11-01')
  })
  it('total bilirubin at 1.5×ULN is 「yes」, below it 「no」', () => {
    expect(selects({ observations: [bili(1.8, 1.2)] }).doac_bilirubin_high).toMatchObject({ value: 'yes' })
    expect(selects({ observations: [bili(1.0, 1.2)] }).doac_bilirubin_high).toMatchObject({ value: 'no', testName: '總膽紅素 1（ULN 1.2），<1.5×ULN' })
  })
})

describe('DOAC calculator: diagnoses and demographics', () => {
  it('dialysis 「yes」 by its code; a missing code, or ESRD alone, is not 「no」 (#355 review)', () => {
    expect(selects({ conditions: [condition('Z99.2')] }).doac_dialysis).toMatchObject({ value: 'yes' })
    expect(selects({ conditions: [hypertension] }).doac_dialysis).toBeUndefined()
    expect(selects({ conditions: [condition('N18.6')] }).doac_dialysis).toBeUndefined()
    expect(selects().doac_dialysis).toBeUndefined()
  })
  it('the liver class is never filled from the record: no code is not 「no liver disease」 (#355 review)', () => {
    const out = selects({ conditions: [hypertension], observations: [alt(30, 40), ast(20, 35), bili(0.8, 1.2)] }) as Record<string, unknown>
    expect(out.doac_liver).toBeUndefined()
  })
  it('a GI lesion within a year is dabigatran’s 「yes」; an older one or none says nothing', () => {
    expect(selects({ conditions: [condition('K21.9', '2026-03-01')] }).doac_gi_risk).toMatchObject({ value: 'yes' })
    expect(selects({ conditions: [condition('K21.9', '2024-03-01')] }).doac_gi_risk).toBeUndefined()
    expect(selects({ conditions: [hypertension] }).doac_gi_risk).toBeUndefined()
  })
  it('pregnancy: 「no」 for a man; a woman of any age is asked (#355 review)', () => {
    expect(selects({ demographics: { gender: 'male', age: 40 } }).doac_pregnancy).toMatchObject({ value: 'no', testName: '男性' })
    expect(selects({ demographics: { gender: 'female', age: 72 } }).doac_pregnancy).toBeUndefined()
    expect(selects({ demographics: { gender: 'female', age: 38 } }).doac_pregnancy).toBeUndefined()
  })
})

describe('DOAC calculator: the record fills its fields', () => {
  it('through buildAutofill into the dose calculator’s selects', () => {
    const autofill = buildAutofill([alt(30, 40), ast(20, 35), bili(0.8, 1.2)], { age: 76, gender: 'male' }, [], [], now, [hypertension])
    const calc = CALCULATORS.find((c) => c.id === 'doac-dose-nvaf')!
    const value = (key: string) => resolveInput(calc.inputs.find((input) => input.key === key)!, autofill).value
    expect([value('liver'), value('liver_enzymes'), value('bilirubin_high'), value('pregnancy'), value('dialysis'), value('gi_risk')])
      .toEqual(['', 'no', 'no', 'no', '', ''])
  })
})

// Every range shape the converted real reports carry for ALT, AST and total
// bilirubin (counted 2026-10-22 across the golden and medcloud bundles; values
// here are invented). The bridge keeps ranges as text only.
describe('the upper limit read off the report’s range text', () => {
  it.each([
    ['[0][40]', 'U/L', 'male', 40],
    ['0~40', 'U/L', 'male', 40],
    ['5-35', 'U/L', 'female', 35],
    ['M:＜41; F:＜33', 'U/L', 'male', 41],
    ['M:＜41; F:＜33', 'U/L', 'female', 33],
    ['M:＜41; F:＜33 U/L', 'U/L', 'female', 33],
    ['Men:＜41, Women:＜33', 'U/L', 'male', 41],
    ['Men:＜40, Women＜32', 'U/L', 'female', 32],
    ['Men:9-50, Women:7-35', 'IU/L', 'female', 35],
    ['＜=1.2', 'mg/dL', 'male', 1.2],
    ['＜1.2 mg/dL', 'mg/dL', 'male', 1.2],
    ['≦1.3', 'mg/dL', 'female', 1.3],
    ['[＜41 U/L][]', 'U/L', 'male', 41],
    ['[5-34 U/L][]', 'U/L', 'male', 34],
    ['[0 - 40][]', 'U/L', 'male', 40],
    ['[][＜40]', 'U/L', 'male', 40],
    ['Male:＜41, Female:＜33', 'U/L', 'female', 33],
    ['M:＜41; Female:＜33', 'U/L', 'female', 33],
    ['M:＜21; F:＜18 umol/L', 'umol/L', 'male', 21],
  ])('%s (%s, %s) → %s', (text, unit, sex, expected) => {
    expect(upperLimitFromText(text, unit, sex)).toBe(expected)
  })
  it.each([
    ['M:＜41; F:＜33', 'U/L', undefined],
    ['無', 'U/L', 'male'],
    ['.', 'U/L', 'male'],
    ['＜1.2 umol/L', 'mg/dL', 'male'],
    ['[＞7 days:0.2-1.2][]', 'mg/dL', 'male'],
    ['', 'U/L', 'male'],
    // One unit written for both sexes, not the result's (#360 review).
    ['M:＜21; F:＜18 umol/L', 'mg/dL', 'male'],
    ['M:＜21; F:＜18 umol/L', 'mg/dL', 'female'],
    ['M:＜1.2 mg/dL; F:＜18 umol/L', 'mg/dL', 'male'],
  ])('%s (%s, %s) → no limit', (text, unit, sex) => {
    expect(upperLimitFromText(text, unit, sex)).toBeUndefined()
  })
  it('a text-only range fills the liver tests, as real reports send them', () => {
    const textOnly = (o: LabObservation, text: string): LabObservation => ({ ...o, referenceRange: [{ text }] })
    const out = selects({
      demographics: { gender: 'female', age: 78 },
      observations: [textOnly(alt(30, undefined), 'M:＜41; F:＜33 U/L'), textOnly(ast(90, undefined), 'Men:＜40, Women＜32'), textOnly(bili(0.9, undefined, '2026-09-01'), '＜1.2 mg/dL')],
    })
    expect(out.doac_liver_enzymes).toMatchObject({ value: 'yes', testName: 'AST 90（ULN 32），>2×ULN（請核對）' })
    expect(out.doac_bilirubin_high).toMatchObject({ value: 'no' })
  })
  it('a bilirubin range in another unit for both sexes leaves the field blank, not 「no」 (#360 review)', () => {
    const textOnly: LabObservation = { ...bili(3, undefined), referenceRange: [{ text: 'M:＜21; F:＜18 umol/L' }] }
    expect(selects({ demographics: { gender: 'male' }, observations: [textOnly] }).doac_bilirubin_high).toBeUndefined()
  })
  it('a structured limit in another unit is not replaced by its text (#360 review)', () => {
    const mixed: LabObservation = { ...alt(1.5, undefined), valueQuantity: { value: 1.5, unit: 'ukat/L' }, referenceRange: [{ high: { value: 40, unit: 'U/L' }, text: '0-40' }] }
    expect(selects({ demographics: { gender: 'male' }, observations: [mixed, ast(20, 35)] }).doac_liver_enzymes).toBeUndefined()
  })
  it('several ranges are bands, not one limit', () => {
    const multi: LabObservation = { ...alt(30, undefined), referenceRange: [{ text: '0~40' }, { text: '0~35' }] }
    expect(selects({ demographics: { gender: 'male' }, observations: [multi, ast(20, 35)] }).doac_liver_enzymes).toBeUndefined()
  })
})
