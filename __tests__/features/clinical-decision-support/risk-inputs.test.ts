/**
 * The shared risk inputs (owner 2026-11-03: 「提供一個 common 的輸入面板，或是自動由
 * ICD 抓取，這樣就能夠套用多項公式…盡量由已知資料抓取，包括 ICD，AI 或是 RULE 判斷的
 * 結果再讓使用者確認」): one field per input, filled from the best source and
 * labelled with its origin, read by PREVENT, the Pooled Cohort Equations and
 * the HPA reconstruction alike.
 */
import { buildRiskInputs, RISK_FIELD_GROUPS, RISK_INPUTS } from '@/features/clinical-decision-support/utils/risk-inputs'
import { buildPreventReading } from '@/features/clinical-decision-support/utils/prevent-reading'
import { applyHtnRiskReadings, buildHpaReading, buildPceReading, htnCalculatorValues } from '@/features/clinical-decision-support/utils/htn-risk-readings'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'

type AutofillSource = Parameters<Autofill['resolve']>[0]

const AT = '2026-11-03T09:00:00+08:00'
const fact = (zh: string, date?: string) => ({ zh, en: zh, ...(date ? { date } : {}) })

// A 58-year-old man: lipids, glucose and a clinic SBP in the chart; an E11
// code and an I10 code; antihypertensives currently supplied (the host's rule).
const record: Autofill = {
  sex: 'male',
  clinicalSelects: {
    antihypertensives: { value: 'yes', date: '2026-10-28', testName: '降血壓藥處方供藥中（amlodipine）' },
  },
  resolve: (source?: AutofillSource) => {
    if (!source) return undefined
    if (source.kind === 'age') return { value: 58, unit: 'y', date: '' }
    if (source.kind === 'lab' && source.keys.includes('CHOL')) return { value: 213, unit: 'mg/dL', date: '2026-10-20', testName: 'Cholesterol total' }
    if (source.kind === 'lab' && source.keys.includes('HDL')) return { value: 50, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'lab' && source.keys.includes('LDL')) return { value: 130, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'lab' && source.keys.includes('TG')) return { value: 160, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'labLoinc' && source.loinc.includes('1558-6')) return { value: 102, unit: 'mg/dL', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'sbp') return { value: 138, unit: 'mmHg', date: '2026-10-20' }
    if (source.kind === 'vital' && source.vital === 'waist') return { value: 92, unit: 'cm', date: '2026-10-20' }
    return undefined
  },
}
const profile = (facts: Record<string, { zh: string; en: string; date?: string; numericValue?: number }> = {}) => ({ id: 'synthetic-htn-shared', evaluatedAt: AT, facts })

describe('shared risk inputs', () => {
  it('lists every input once, in groups, and says which calculators read it', () => {
    const keys = RISK_INPUTS.map((item) => item.input.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(RISK_FIELD_GROUPS.flatMap((group) => group.keys).sort()).toEqual([...keys].sort())
    const usedBy = Object.fromEntries(RISK_INPUTS.map((item) => [item.input.key, item.usedBy]))
    expect(usedBy.sbp).toEqual(['prevent', 'pce', 'hpa'])
    expect(usedBy.race).toEqual(['pce'])
    expect(usedBy.waist).toEqual(['hpa'])
    expect(usedBy.egfr).toEqual(['prevent'])
  })

  it('reads ICD codes as locked answers, rules and today\'s answer as proposals, and names each origin', () => {
    const p = profile({
      type2DiabetesDiagnosis: fact('第二型糖尿病 E11.9', '2026-01-10'),
      hypertensionDiagnosis: fact('原發性高血壓 I10', '2024-05-02'),
    })
    const shared = buildRiskInputs(p, record, {}, undefined, { smokingCurrent: 'no' })
    const field = (key: string) => shared.fields.find((item) => item.input.key === key)!
    expect(field('dm')).toMatchObject({ value: 'yes', origin: 'icd', locked: true, source: 'record', detail: { zh: 'ICD：第二型糖尿病 E11.9' }, date: '2026-01-10' })
    expect(field('hbp')).toMatchObject({ value: 'yes', origin: 'icd', detail: { zh: 'ICD：原發性高血壓 I10' } })
    expect(field('bptreat')).toMatchObject({ value: 'yes', origin: 'rule', locked: false, detail: { zh: '規則：降血壓藥處方供藥中（amlodipine）' }, date: '2026-10-28' })
    expect(field('smoking')).toMatchObject({ value: 'no', origin: 'visit', detail: { zh: '問診：DP-08 目前吸菸' } })
    expect(field('race')).toMatchObject({ value: 'other', origin: 'rule' })
    expect(field('tc')).toMatchObject({ value: '213', origin: 'record', detail: { zh: '病歷：Cholesterol total' }, date: '2026-10-20' })
    expect(field('sex')).toMatchObject({ value: 'male', origin: 'record' })
    expect(field('age')).toMatchObject({ value: '58', origin: 'record' })
    expect(field('cvd')).toMatchObject({ value: '', origin: 'none', locked: false })
    expect(field('waist')).toMatchObject({ value: '92', origin: 'record' })
  })

  it('the clinician\'s own entry outranks every source except a positive code, and today\'s clinic measurement outranks the chart', () => {
    const p = profile({ type2DiabetesDiagnosis: fact('第二型糖尿病 E11.9', '2026-01-10') })
    const vitals = { entries: { systolic: { value: 126, measuredOn: '2026-11-03', modifiedAt: AT }, bodyHeight: { value: 172, measuredOn: '2026-11-03', modifiedAt: AT }, bodyWeight: { value: 80, measuredOn: '2026-11-03', modifiedAt: AT } } } as never
    const shared = buildRiskInputs(p, record, { bptreat: 'no', dm: 'no', tc: '190' }, vitals, { smokingCurrent: 'yes' })
    const field = (key: string) => shared.fields.find((item) => item.input.key === key)!
    expect(field('bptreat')).toMatchObject({ value: 'no', origin: 'physician', source: 'physician', date: '2026-11-03' })
    expect(field('tc')).toMatchObject({ value: '190', origin: 'physician' })
    // A positive code stays whatever was typed.
    expect(field('dm')).toMatchObject({ value: 'yes', origin: 'icd', locked: true })
    expect(field('sbp')).toMatchObject({ value: '126', origin: 'clinic', detail: { zh: '門診今日量測' } })
    expect(field('height')).toMatchObject({ value: '172', origin: 'clinic' })
    expect(field('weight')).toMatchObject({ value: '80', origin: 'clinic' })
  })

  it('feeds the three calculators from the one reading, so a shared input changes all three', () => {
    const p = profile({ hypertensionDiagnosis: fact('原發性高血壓 I10', '2024-05-02') })
    const answers = { bmi: '27', egfr: '88', dm: 'no', smoking: 'no', statin: 'no', cvd: 'no', subclinical: 'no', genetic: 'no', eskd: 'no', limitedLife: 'no' }
    const prevent = buildPreventReading(p, record, answers)
    const pce = buildPceReading(prevent)!
    const hpa = buildHpaReading(p, record, prevent)
    expect(prevent.result.status).toBe('ready')
    expect(pce.result).toMatchObject({ status: 'ready', equations: 'white' })
    expect(pce.values).toMatchObject({ sex: 'male', age: '58', race: 'other', tc: '213', hdl: '50', sbp: '138', bptreat: 'yes', dm: 'no', smoking: 'no', cvd: 'no' })
    expect(hpa.values).toMatchObject({ gender: 'male', age: '58', chol: '213', hdlc: '50', ldlc: '130', tg: '160', glu: '102', sbp: '138', waist: '92', hbp: 'yes', diabetes: 'no', smoke: 'no', prior_cvd: 'no' })
    expect(hpa.mace?.status).toBe('estimated')
    // Smoking answered 「yes」 once moves every result.
    const smoker = buildPreventReading(p, record, { ...answers, smoking: 'yes' })
    expect(smoker.result.risk10!).toBeGreaterThan(prevent.result.risk10!)
    expect(buildPceReading(smoker)!.result.risk10!).toBeGreaterThan(pce.result.risk10!)
    expect(buildHpaReading(p, record, smoker).values.smoke).toBe('yes')
    // All three reach the pack as facts, and the list's value column.
    const facts = applyHtnRiskReadings(p, prevent, hpa, pce).facts
    expect(facts.pceAscvdRisk10y).toMatchObject({ unit: '%', calculator: { id: 'pce-ascvd', version: 'goff2013-v1', endpoint: 'ascvd', horizonYears: 10, evaluatedAt: AT } })
    expect(facts.pceAscvdRisk10y!.numericValue).toBeCloseTo(pce.result.risk10!, 6)
    expect(facts.pceAscvdRisk10y!.textEvidence?.matchedTerms).toContain('equations:white')
    expect(facts.pceAscvdRisk10y!.calculator!.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'race', value: 'other', source: 'record' }), expect.objectContaining({ key: 'bptreat', value: 'yes', source: 'record' })]))
    expect(htnCalculatorValues(facts, false)!['pce-ascvd']).toEqual({ status: 'computed', value: `${pce.result.risk10!.toFixed(1)}%` })
  })

  it('says what PCE still needs or why it does not apply, and clears a stale result', () => {
    const p = profile()
    const blank = buildPreventReading(p, record, {})
    const pce = buildPceReading(blank)!
    expect(pce.result.status).toBe('needs-data')
    expect(pce.result.issues).toEqual(['dm', 'smoking', 'cvd'])
    const facts = applyHtnRiskReadings(p, blank, buildHpaReading(p, record, blank), pce).facts
    expect(facts.pceAscvdRisk10y).toBeUndefined()
    expect(htnCalculatorValues(facts, false)!['pce-ascvd']).toEqual({ status: 'to-fill', value: '3' })
    const excluded = buildPreventReading(p, record, { dm: 'no', smoking: 'no', cvd: 'yes' })
    expect(buildPceReading(excluded)!.result).toMatchObject({ status: 'ineligible', issues: ['cvd'] })
    expect(htnCalculatorValues(applyHtnRiskReadings(p, excluded, buildHpaReading(p, record, excluded), buildPceReading(excluded)).facts, false)!['pce-ascvd']).toEqual({ status: 'inapplicable' })
    // Outside 40–79 the equations do not apply even with every input.
    const young = buildPreventReading(p, { ...record, resolve: (source) => (source?.kind === 'age' ? { value: 36, unit: 'y', date: '' } : record.resolve(source)) }, { dm: 'no', smoking: 'no', cvd: 'no' })
    expect(buildPceReading(young)!.result).toMatchObject({ status: 'ineligible', issues: ['age'] })
  })
})
