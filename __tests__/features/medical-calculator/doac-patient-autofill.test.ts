import { doacPatientSelects, type LabObservation } from '@/features/medical-calculator/doac-patient-autofill'
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
