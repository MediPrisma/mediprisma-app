/**
 * The two calculators the HTN page's list gained on 2026-11-03 (owner: 「套用多項
 * 公式，包括 ACC/AHA 的 Multicohort CV risk calculators」; 「Stop-bang 應該也要列入
 * 計算機」): the 2013 ACC/AHA Pooled Cohort Equations and STOP-Bang.
 */
import { calculatePce, PCE } from '@/features/medical-calculator/calculators/pce'
import { calculateStopBang, STOP_BANG } from '@/features/medical-calculator/calculators/stop-bang'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import type { CalcValues } from '@/features/medical-calculator/types'

// The guideline's worked example: 55 years, TC 213, HDL 50, untreated SBP 120,
// nonsmoker, no diabetes (reproduced by bcjaeger/PooledCohort and CVrisk).
const example: CalcValues = { age: '55', tc: '213', hdl: '50', sbp: '120', bptreat: 'no', dm: 'no', smoking: 'no', cvd: 'no' }

describe('Pooled Cohort Equations (Goff 2013)', () => {
  test.each([
    ['white', 'male', 5.4], ['white', 'female', 2.1], ['aa', 'male', 6.1], ['aa', 'female', 3.0],
  ])('%s %s worked example', (race, sex, expected) => {
    const r = calculatePce({ ...example, race, sex })
    expect(r.status).toBe('ready')
    expect(Number(r.risk10!.toFixed(1))).toBe(expected)
  })
  it('reads 「其他族裔」 with the White equations', () => {
    expect(calculatePce({ ...example, race: 'other', sex: 'male' }).risk10).toBeCloseTo(calculatePce({ ...example, race: 'white', sex: 'male' }).risk10!, 10)
    expect(calculatePce({ ...example, race: 'other', sex: 'male' }).equations).toBe('white')
  })
  it('treated SBP uses the treated coefficients (a higher risk at the same pressure)', () => {
    const untreated = calculatePce({ ...example, race: 'white', sex: 'female' }).risk10!
    const treated = calculatePce({ ...example, race: 'white', sex: 'female', bptreat: 'yes' }).risk10!
    expect(treated).toBeGreaterThan(untreated)
  })
  test.each(['sex', 'race', 'tc', 'hdl', 'sbp', 'bptreat', 'dm', 'smoking'])('unknown %s never means no', (key) => {
    const r = calculatePce({ ...example, race: 'white', sex: 'male', [key]: '' })
    expect(r.status).toBe('needs-data')
    expect(r.issues).toContain(key)
  })
  test.each([39, 80])('age %s is outside the equations', (age) => {
    expect(calculatePce({ ...example, race: 'white', sex: 'male', age: String(age) }).status).toBe('ineligible')
  })
  it('known ASCVD is not a primary-prevention case', () => {
    expect(calculatePce({ ...example, race: 'white', sex: 'male', cvd: 'yes' })).toMatchObject({ status: 'ineligible', issues: ['cvd'] })
  })
  it('the catalog entry bands the result as the 2018 cholesterol guideline does', () => {
    expect(CALCULATORS.filter((c) => c.id === 'pce-ascvd')).toHaveLength(1)
    expect(PCE.compute({ ...example, race: 'white', sex: 'male' })).toMatchObject({ value: '5.4', unit: '%', interpretation: { zh: '邊緣風險（5–<7.5%）' }, severity: 'moderate' })
    expect(PCE.compute({ ...example, race: 'white', sex: 'male', smoking: 'yes', dm: 'yes' })?.interpretation?.zh).toMatch(/高風險|中等風險/)
    expect(PCE.compute({ ...example, race: 'white', sex: 'male', sbp: '' })).toBeNull()
  })
})

describe('STOP-Bang (Chung 2016)', () => {
  const all: CalcValues = { snoring: 'yes', tired: 'yes', observed: 'yes', pressure: 'yes', bmi: '36', age: '51', neck: '41', sex: 'male' }
  it('scores one point per item that is met and bands 0–2 / 3–4 / 5–8', () => {
    expect(calculateStopBang(all)).toMatchObject({ score: 8, complete: true, band: 'high' })
    expect(calculateStopBang({ ...all, snoring: 'no', tired: 'no', observed: 'no', pressure: 'no', bmi: '24' })).toMatchObject({ score: 3, band: 'intermediate' })
    expect(calculateStopBang({ snoring: 'no', tired: 'no', observed: 'no', pressure: 'no', bmi: '24', age: '45', neck: '38', sex: 'female' })).toMatchObject({ score: 0, band: 'low' })
    // The thresholds are strict: 50 years, BMI 35 and 40 cm do not score.
    expect(calculateStopBang({ ...all, age: '50', bmi: '35', neck: '40' }).score).toBe(5)
  })
  it('STOP ≥2 plus male, BMI >35 or neck >40 is high at a score of 3 or 4', () => {
    const r = calculateStopBang({ snoring: 'yes', tired: 'yes', observed: 'no', pressure: 'no', bmi: '24', age: '45', neck: '38', sex: 'male' })
    expect(r).toMatchObject({ score: 3, band: 'high', alternativeHigh: true })
  })
  it('an unanswered item is unknown, never no: the band waits where it could still change', () => {
    const r = calculateStopBang({ snoring: 'yes', tired: '', observed: 'no', pressure: 'no', bmi: '', age: '45', neck: '', sex: 'female' })
    expect(r).toMatchObject({ score: 1, upperBound: 4, complete: false, missingInputs: ['tired', 'bmi', 'neck'] })
    expect(r.band).toBeUndefined()
    // A band already reached stands whatever is unknown.
    expect(calculateStopBang({ snoring: 'yes', tired: 'yes', observed: 'yes', pressure: 'yes', bmi: '', age: '60', neck: '', sex: 'male' })).toMatchObject({ score: 6, band: 'high', complete: false })
    expect(STOP_BANG.compute({ snoring: 'yes', tired: '', observed: 'no', pressure: 'no', bmi: '', age: '45', neck: '', sex: 'female' })).toMatchObject({ value: '1–4', interpretation: { zh: '資料未齊 — 可能分數範圍' } })
  })
  it('is in the catalog with P prefilled from the antihypertensive rule and A, G, B from the record', () => {
    expect(CALCULATORS.filter((c) => c.id === 'stop-bang')).toHaveLength(1)
    const sources = Object.fromEntries(STOP_BANG.inputs.map((input) => [input.key, input.source?.kind]))
    expect(sources).toMatchObject({ pressure: 'hfpefClinical', age: 'age', sex: 'sex', bmi: 'bmi', neck: undefined, snoring: undefined })
  })
})
