/**
 * HTN DP-08's calculators (plan 05 §19, owner decisions 2026-11-03): the host
 * runs PREVENT and the HPA reconstruction and hands the pack two facts shaped
 * for `readHypertensionRiskResult` — a completed calculator result with its
 * id, version, ten-year horizon, endpoint and inputs, evaluated at the
 * profile's instant. R1 (c): the PREVENT result is the ASCVD endpoint, shown
 * only. R2 (a): the HPA MACE estimate carries its level, never a threshold.
 */
import { buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import { applyHtnRiskReadings, buildHpaReading, htnCalculatorValues } from '@/features/clinical-decision-support/utils/htn-risk-readings'
import { HF_VISIT_CALCULATORS } from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'

type AutofillSource = Parameters<Autofill['resolve']>[0]

const AT = '2026-11-03T09:00:00+08:00'
const profile = (facts: Record<string, { zh: string; en: string; date?: string }> = {}) => ({ id: 'synthetic-htn', evaluatedAt: AT, facts })

// A 50-year-old woman's chart: lipids, waist and a clinic SBP, nothing else.
const record: Autofill = {
  sex: 'female',
  resolve: (source?: AutofillSource) => {
    if (!source) return undefined
    if (source.kind === 'age') return { value: 50, unit: 'y', date: '' }
    if (source.kind === 'lab' && source.keys.includes('CHOL')) return { value: 200, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'lab' && source.keys.includes('HDL')) return { value: 50, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'waist') return { value: 85, unit: 'cm', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'sbp') return { value: 128, unit: 'mmHg', date: '2026-10-20' }
    return undefined
  },
}
// What the clinician confirmed in the PREVENT form: no exclusion, no smoking.
const answers: CalcValues = { bmi: '24', egfr: '90', dm: 'no', smoking: 'no', statin: 'no', bptreat: 'yes', cvd: 'no', subclinical: 'no', genetic: 'no', eskd: 'no', limitedLife: 'no' }

describe('HTN baseline-risk facts for the pack', () => {
  it('writes PREVENT as the ASCVD endpoint and the HPA MACE estimate with its level, both evaluated at the profile instant', () => {
    const p = profile()
    const prevent = buildPreventReading(p, record, answers)
    expect(prevent.result.status).toBe('ready')
    const hpa = buildHpaReading(p, record, prevent)
    expect(hpa.mace?.status).toBe('estimated')
    const facts = applyHtnRiskReadings(p, prevent, hpa).facts

    const ascvd = facts.preventAscvdRisk10y!
    expect(ascvd.unit).toBe('%')
    expect(ascvd.numericValue).toBeCloseTo(prevent.result.risk10!, 6)
    expect(ascvd.calculator).toMatchObject({ id: 'prevent-ascvd', status: 'complete', evaluatedAt: AT, horizonYears: 10, endpoint: 'ascvd' })
    expect(ascvd.calculator!.version).toBeTruthy()
    expect(ascvd.calculator!.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'age', value: '50' })]))
    expect(ascvd.textEvidence?.direction).toBe('unknown')

    const mace = facts.hpaMaceRisk10y!
    expect(mace.unit).toBe('%')
    expect(mace.numericValue).toBeGreaterThan(0)
    expect(mace.numericValue).toBeLessThan(100)
    expect(mace.calculator).toMatchObject({ id: 'hpa-mace-reconstructed', status: 'complete', evaluatedAt: AT, horizonYears: 10, endpoint: 'mace' })
    expect(mace.calculator!.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'age', value: '50' }), expect.objectContaining({ key: 'prior_cvd', value: 'no' })]))
    expect(mace.textEvidence?.matchedTerms.some((term) => /^level:(low|moderate|high)$/.test(term))).toBe(true)
    expect(mace.textEvidence?.direction).toBe('unknown')
  })

  it('reads the HPA history fields off the PREVENT form, so a known CVD withholds both and clears the old facts', () => {
    const p = profile()
    const before = applyHtnRiskReadings(p, buildPreventReading(p, record, answers), buildHpaReading(p, record, buildPreventReading(p, record, answers)))
    expect(before.facts.preventAscvdRisk10y).toBeDefined()
    const prevent = buildPreventReading(before, record, { ...answers, cvd: 'yes' })
    expect(prevent.result.status).toBe('ineligible')
    const hpa = buildHpaReading(before, record, prevent)
    expect(hpa.values.prior_cvd).toBe('yes')
    expect(hpa.mace?.status).toBe('existing')
    const after = applyHtnRiskReadings(before, prevent, hpa).facts
    expect(after.preventAscvdRisk10y).toBeUndefined()
    expect(after.hpaMaceRisk10y).toBeUndefined()
  })

  it('uses the PREVENT form\'s systolic pressure and smoking answer for HPA, and today\'s clinic height and weight', () => {
    const p = profile()
    const prevent = buildPreventReading(p, record, { ...answers, sbp: '126', smoking: 'yes' })
    const hpa = buildHpaReading(p, record, prevent, { entries: { bodyHeight: { value: 160, measuredOn: '2026-11-03', modifiedAt: AT }, bodyWeight: { value: 58, measuredOn: '2026-11-03', modifiedAt: AT } } } as never)
    expect(hpa.values).toMatchObject({ sbp: '126', smoke: 'yes', height: '160', weight: '58', gender: 'female', age: '50' })
    expect(hpa.fields.find((field) => field.key === 'sbp')?.source).toBe('physician')
  })

  it('writes nothing outside the HPA validated range and nothing without a profile instant', () => {
    const p = profile()
    const prevent = buildPreventReading(p, record, { ...answers, sbp: '150' })
    const hpa = buildHpaReading(p, record, prevent)
    expect(hpa.mace?.status).toBe('outside')
    expect(applyHtnRiskReadings(p, prevent, hpa).facts.hpaMaceRisk10y).toBeUndefined()
    expect(applyHtnRiskReadings({ id: 'no-instant', facts: {} }, prevent, hpa).facts.preventAscvdRisk10y).toBeUndefined()
  })

  it('prefills PREVENT\'s smoking from the DP-08 answer, and the clinician\'s own entry still wins', () => {
    const p = profile()
    const field = (inputs: CalcValues, smokingCurrent?: 'yes' | 'no') => buildPreventReading(p, record, inputs, undefined, smokingCurrent ? { smokingCurrent } : {}).fields.find((item) => item.input.key === 'smoking')!
    expect(field({}, 'yes')).toMatchObject({ value: 'yes', source: 'record' })
    expect(field({ smoking: 'no' }, 'yes')).toMatchObject({ value: 'no', source: 'physician' })
    expect(field({})).toMatchObject({ value: '', source: 'none' })
  })

  it('offers the value column of the 計算機 list for the HTN page', () => {
    const p = profile()
    const prevent = buildPreventReading(p, record, answers)
    const facts = applyHtnRiskReadings(p, prevent, buildHpaReading(p, record, prevent)).facts
    const values = htnCalculatorValues(facts, false)!
    expect(values['prevent-ascvd']).toEqual({ status: 'computed', value: expect.stringMatching(/^\d+\.\d%$/) })
    expect(values['hpa-mace']).toEqual({ status: 'computed', value: expect.stringMatching(/^\d+(\.\d+)?%（[低中高]）$/) })
    expect(htnCalculatorValues({}, false)).toBeUndefined()
    // Not applicable and inputs-to-fill are said, and the rows stay open.
    const excluded = buildPreventReading(p, record, { ...answers, cvd: 'yes' })
    const excludedFacts = applyHtnRiskReadings(p, excluded, buildHpaReading(p, record, excluded)).facts
    expect(htnCalculatorValues({ ...excludedFacts, preventAssessment: { zh: 'ineligible', en: 'ineligible', textEvidence: { direction: 'supports', matchedTerms: ['ineligible', 'cvd'] } } }, false)).toEqual({ 'prevent-ascvd': { status: 'inapplicable' }, 'hpa-mace': { status: 'inapplicable' } })
    const blank = buildPreventReading(p, record, {})
    const blankFacts = applyHtnRiskReadings(p, blank, buildHpaReading(p, record, blank)).facts
    expect(htnCalculatorValues({ ...blankFacts, preventAssessment: { zh: 'needs-data', en: 'needs-data', textEvidence: { direction: 'supports', matchedTerms: ['needs-data', ...blank.result.issues] } } }, false)).toEqual({
      'prevent-ascvd': { status: 'to-fill', value: String(blank.result.issues.length) },
      // Female MACE waits for the PREVENT form's prior-CVD and smoking answers.
      'hpa-mace': { status: 'to-fill', value: '2' },
    })
    // The list's HTN entries open at DP-08 and only where the HTN page has it.
    const entries = HF_VISIT_CALCULATORS.filter((entry) => entry.source === 'htn')
    expect(entries.map((entry) => [entry.id, entry.dp, entry.needsPoint])).toEqual([['prevent-ascvd', 'DP-08', true], ['hpa-mace', 'DP-08', true]])
    expect(entries[0]!.names.test('PREVENT-ASCVD 9.2%｜國健署心血管風險預測 8.1%（低）')).toBe(true)
    expect(entries[1]!.names.test('PREVENT-ASCVD 9.2%｜國健署心血管風險預測 8.1%（低）')).toBe(true)
    expect(entries[1]!.names.test('HPA cardiovascular risk prediction 8.1% (low)')).toBe(true)
    expect(entries.every((entry) => entry.note)).toBe(true)
  })
})
