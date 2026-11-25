import { AF_STROKE } from '@/features/medical-calculator/calculators/af-stroke'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { RENAL } from '@/features/medical-calculator/calculators/renal'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import {
  ATRIAL_FIBRILLATION_GUIDELINE_PACK as PACK,
  assessAfStrokeRisk,
  collectAfCalculatorInputs,
  type CdssPatientProfile,
} from '@voho0000/personalized-care'
const va = AF_STROKE.find((c) => c.id === 'cha2ds2-va')!,
  vasc = AF_STROKE.find((c) => c.id === 'cha2ds2-vasc')!,
  cg = RENAL.find((c) => c.id === 'crcl-cockcroft-gault')!
const negatives = { chf: 'no', htn: 'no', dm: 'no', stroke: 'no', vascular: 'no' }
const p: CdssPatientProfile = {
  id: 'synthetic-af-calculator',
  evaluatedAt: '2026-09-12',
  demographics: { sex: 'female' },
  facts: {
    age: { numericValue: 78, zh: '78', en: '78' },
    atrialFibrillationDiagnosis: { zh: 'I48.0', en: 'I48.0' },
    hypertensionDiagnosis: { zh: 'I10', en: 'I10' },
    // Dated within 90 days: the dose rules take no older or undated weight (personalized-care 2.31.0).
    bodyWeight: { numericValue: 60, unit: 'kg', zh: '60 kg', en: '60 kg', date: '2026-09-01' },
    serumCreatinine: { numericValue: 1, unit: 'mg/dL', zh: '1 mg/dL', en: '1 mg/dL' },
  },
}
describe('AF medical calculators and CDSS handoff', () => {
  it('registers each calculator exactly once in the medical-calculator list', () => {
    for (const id of ['cha2ds2-va', 'cha2ds2-vasc', 'crcl-cockcroft-gault'])
      expect(CALCULATORS.filter((c) => c.id === id)).toHaveLength(1)
  })
  it.each([
    [64, 0],
    [65, 1],
    [74, 1],
    [75, 2],
  ])('uses non-overlapping age bands at %s', (age, points) => {
    expect(va.compute({ ...negatives, age: String(age) })?.numericValue).toBe(points)
    expect(vasc.compute({ ...negatives, age: String(age), sex: 'female' })?.numericValue).toBe(points + 1)
  })
  it('shows unknown histories as a range and withholds low-risk classification', () => {
    expect(va.compute({ age: '40' })).toMatchObject({
      numericValue: 0,
      value: '0–6',
      completeness: {
        complete: false,
        upperBound: 6,
        missingKeys: ['chf', 'htn', 'dm', 'stroke', 'vascular'],
      },
    })
    expect(va.compute({ ...negatives, age: '40' })).toMatchObject({
      numericValue: 0,
      completeness: { complete: true },
    })
    expect(va.compute({ age: '40' })?.interpretation?.en).not.toContain('Low')
  })
  it('adds stroke twice, all other histories once and sex only in VASc', () => {
    const values = {
      age: '75',
      sex: 'female',
      chf: 'yes',
      htn: 'yes',
      dm: 'yes',
      stroke: 'yes',
      vascular: 'yes',
    }
    expect(va.compute(values)?.numericValue).toBe(8)
    expect(vasc.compute(values)?.numericValue).toBe(9)
    expect(va.compute({ ...values, sex: '' })?.numericValue).toBe(8)
    expect(vasc.compute({ ...values, sex: '' })).toBeNull()
  })
  it('rejects invalid ages, values, and unconfirmed sex', () => {
    for (const age of ['', 'NaN', '17', '121', 'Infinity'])
      expect(va.compute({ ...negatives, age })).toBeNull()
    expect(va.compute({ ...negatives, age: '40', htn: 'maybe' })).toBeNull()
    expect(cg.compute({ age: '140', weight: '60', scr: '1', sex: 'male' })).toBeNull()
  })
  it('hands the calculator result unchanged to the pack and keeps provenance', () => {
    const out = applyAfCalculatorResults(p),
      values = collectAfCalculatorInputs(p, 'en').values
    for (const calc of [va, vasc, cg]) {
      const direct = calc.compute(values[calc.id as keyof typeof values])!
      expect(out.medicalCalculatorResults?.[calc.id]?.numericValue).toBe(direct.numericValue)
      expect(out.medicalCalculatorResults?.[calc.id]?.version).toBe(calc.version)
    }
    expect(assessAfStrokeRisk(out, 'zh-TW')).toMatchObject({ va: 3, vasc: 4, complete: false })
    const changed = applyAfCalculatorResults({ ...out, afClinicalAnswers: { stroke: true } })
    expect(assessAfStrokeRisk(changed, 'zh-TW').va).toBe(5)
    const excluded = applyAfCalculatorResults({
      ...changed,
      evidenceOverrides: { 'af-stroke:stroke': false },
    })
    expect(assessAfStrokeRisk(excluded, 'zh-TW').va).toBe(3)
  })
  it('uses LVEF ≤40 and type 1 diabetes evidence as calculator inputs', () => {
    const out = applyAfCalculatorResults({
      ...p,
      facts: {
        ...p.facts,
        LVEF: { numericValue: 40, zh: '40%', en: '40%' },
        type1DiabetesDiagnosis: { zh: 'E10', en: 'E10' },
      },
    })
    expect(assessAfStrokeRisk(out, 'en').va).toBe(5)
  })
  it('passes unrounded CrCl and deletes results after missing/disabled inputs', () => {
    const direct = cg.compute({ age: '82', weight: '55', scr: '1', sex: 'female' })!
    expect(direct.numericValue).toBeCloseTo(37.65972222, 7)
    expect(direct.numericValue).not.toBe(Number(direct.value))
    const out = applyAfCalculatorResults(p)
    expect(out.medicalCalculatorResults?.[cg.id]).toBeDefined()
    const removed = applyAfCalculatorResults({
      ...out,
      evidenceOverrides: { 'af-measure:bodyWeight': false },
    })
    expect(removed.medicalCalculatorResults?.[cg.id]).toBeUndefined()
    const noSex = applyAfCalculatorResults({ ...out, demographics: { sex: 'unknown' } })
    expect(noSex.medicalCalculatorResults?.[cg.id]).toBeUndefined()
    expect(noSex.medicalCalculatorResults?.[vasc.id]).toBeUndefined()
    expect(noSex.medicalCalculatorResults?.[va.id]).toBeDefined()
  })
  it('does not substitute eGFR, assume a creatinine unit, or reuse a previous patient score', () => {
    const out = applyAfCalculatorResults({
      ...p,
      facts: { ...p.facts, serumCreatinine: { numericValue: 88, unit: 'umol/L', zh: '88', en: '88' } },
    })
    expect(out.medicalCalculatorResults?.[cg.id]).toBeUndefined()
    const changed = applyAfCalculatorResults({ ...out, id: 'next-patient', demographics: {}, facts: {} })
    expect(Object.keys(changed.medicalCalculatorResults ?? {})).toEqual(['has-bled'])
    expect(changed.medicalCalculatorResults?.['has-bled']).toMatchObject({numericValue:0,complete:false})
    expect(changed.medicalCalculatorResults?.['has-bled'].missingInputs).toContain('elderly')
  })
  it('recomputes the clinical recommendation from a calculator result', () => {
    const profile = applyAfCalculatorResults(p)
    const anticoag = PACK.build({ profile, locale: 'en' }).recommendations.find(
      (r) => r.id === 'af-anticoagulation-concordance',
    )!
    expect(anticoag.status).toBe('actionable')
  })
})
