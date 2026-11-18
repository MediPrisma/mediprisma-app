/**
 * PREVENT total CVD (owner request 2026-11-19: the score HTN DP-08's AHA/ACC
 * threshold reads). Reference values are the preventr package's own base-model
 * tests (martingmayer/preventr, tests/testthat/test-estimate_risk.R): age 50,
 * SBP 160 on treatment, total cholesterol 200, HDL 45, diabetes, no smoking,
 * no statin, eGFR 90 — rounded there to 0.1 percentage point.
 */
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { calculatePrevent, PREVENT_CVD } from '@/features/medical-calculator/calculators/prevent'
import type { CalcValues } from '@/features/medical-calculator/types'

const patient = (sex: 'female' | 'male'): CalcValues => ({
  sex, age: '50', tc: '200', hdl: '45', sbp: '160', bmi: '35', egfr: '90',
  dm: 'yes', smoking: 'no', statin: 'no', bptreat: 'yes',
  cvd: 'no', subclinical: 'no', genetic: 'no', eskd: 'no', limitedLife: 'no',
})

const round3 = (percent: number | undefined) => Math.round((percent ?? NaN) * 10) / 1000

describe('PREVENT-CVD', () => {
  it.each([
    ['female', 0.147, 0.53, 0.092, 0.354],
    ['male', 0.163, 0.514, 0.102, 0.349],
  ] as const)('matches preventr for a %s patient', (sex, cvd10, cvd30, ascvd10, ascvd30) => {
    const cvd = calculatePrevent(patient(sex), 'cvd')
    expect(cvd.status).toBe('ready')
    expect(round3(cvd.risk10)).toBe(cvd10)
    expect(round3(cvd.risk30)).toBe(cvd30)
    // The ASCVD model the app already had, against the same tests: the two sets come from one table.
    const ascvd = calculatePrevent(patient(sex))
    expect(round3(ascvd.risk10)).toBe(ascvd10)
    expect(round3(ascvd.risk30)).toBe(ascvd30)
  })

  it('is a different endpoint from PREVENT-ASCVD, and higher', () => {
    const cvd = calculatePrevent(patient('female'), 'cvd').risk10!
    const ascvd = calculatePrevent(patient('female'), 'ascvd').risk10!
    expect(cvd).toBeGreaterThan(ascvd)
  })

  it('reads the AHA/ACC 7.5% threshold in its result', () => {
    const high = PREVENT_CVD.compute(patient('male'))
    expect(high?.value).toBe('16.32')
    expect(high?.interpretation?.zh).toBe('10 年 ≥7.5%')
    const low = PREVENT_CVD.compute({ ...patient('female'), age: '40', sbp: '132', dm: 'no', bptreat: 'no' })
    expect(Number(low?.value)).toBeLessThan(7.5)
    expect(low?.interpretation?.zh).toBe('10 年 <7.5%')
  })

  it('shares the ASCVD eligibility: known CVD or age 80 gives no result', () => {
    expect(calculatePrevent({ ...patient('male'), cvd: 'yes' }, 'cvd').status).toBe('ineligible')
    expect(calculatePrevent({ ...patient('male'), age: '80' }, 'cvd').status).toBe('ineligible')
    expect(PREVENT_CVD.compute({ ...patient('male'), smoking: '' })).toBeNull()
  })

  it('omits the 30-year risk past 59', () => {
    expect(calculatePrevent({ ...patient('male'), age: '65' }, 'cvd').risk30).toBeUndefined()
  })

  it('is in the calculator list', () => {
    expect(CALCULATORS.some((calc) => calc.id === 'prevent-cvd')).toBe(true)
  })
})
