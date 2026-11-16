/**
 * The two calculators the HTN page's list gained on 2026-11-03 (owner: 「套用多項
 * 公式，包括 ACC/AHA 的 Multicohort CV risk calculators」; 「Stop-bang 應該也要列入
 * 計算機」): the 2013 ACC/AHA Pooled Cohort Equations and STOP-Bang.
 */
import { calculatePce, PCE } from '@/features/medical-calculator/calculators/pce'
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
  it('reads its four history and drug questions from the record', () => {
    const sources = Object.fromEntries(PCE.inputs.map((input) => [input.key, input.source]))
    expect(sources).toMatchObject({ bptreat: { kind: 'hfpefClinical', key: 'pceBpTreat' }, dm: { kind: 'hfpefClinical', key: 'pceDiabetes' }, smoking: { kind: 'hfpefClinical', key: 'pceSmoking' }, cvd: { kind: 'hfpefClinical', key: 'pceAscvd' } })
  })
  it('the catalog entry bands the result as the 2018 cholesterol guideline does', () => {
    expect(CALCULATORS.filter((c) => c.id === 'pce-ascvd')).toHaveLength(1)
    expect(PCE.compute({ ...example, race: 'white', sex: 'male' })).toMatchObject({ value: '5.4', unit: '%', interpretation: { zh: '邊緣風險（5–<7.5%）' }, severity: 'moderate' })
    expect(PCE.compute({ ...example, race: 'white', sex: 'male', smoking: 'yes', dm: 'yes' })?.interpretation?.zh).toMatch(/高風險|中等風險/)
    expect(PCE.compute({ ...example, race: 'white', sex: 'male', sbp: '' })).toBeNull()
  })
})

