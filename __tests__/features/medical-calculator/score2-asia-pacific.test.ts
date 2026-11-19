/**
 * SCORE2 Asia-Pacific, low-risk region (owner choice 2026-11-20). Reference
 * values come from the RiskScorescvd (CRAN) SCORE2_Asia_Pacific function's
 * formula, recomputed independently; lipids in mg/dL are converted at 38.67.
 */
import { CALCULATORS, getCalcInfo, getCalcScoring, getCalcTags } from '@/features/medical-calculator/calculators'
import { calculateScore2AsiaPacific } from '@/features/medical-calculator/calculators/score2'

const calc = CALCULATORS.find((item) => item.id === 'score2-asia-pacific')!
const base = { smoking: 'no', dm: 'no', cvd: 'no' }

it.each([
  [{ sex: 'male', age: '60', smoking: 'yes', sbp: '140', tc: '213', hdl: '50' }, 14.3631],
  [{ sex: 'female', age: '55', smoking: 'no', sbp: '130', tc: '200', hdl: '60' }, 3.5543],
  [{ sex: 'male', age: '45', smoking: 'no', sbp: '120', tc: '180', hdl: '45' }, 4.0417],
  [{ sex: 'female', age: '69', smoking: 'yes', sbp: '160', tc: '240', hdl: '40' }, 13.5381],
])('%o → %f%% (low-risk region)', (values, expected) => {
  expect(calculateScore2AsiaPacific({ ...base, ...values }).risk10).toBeCloseTo(expected, 3)
})

it('bands by ESC 2021 age-specific thresholds', () => {
  expect(calc.compute({ ...base, sex: 'male', age: '60', smoking: 'yes', sbp: '140', tc: '213', hdl: '50' }))
    .toMatchObject({ value: '14.4', unit: '%', interpretation: { zh: '極高風險（≥10%）' }, severity: 'high' })
  expect(calc.compute({ ...base, sex: 'male', age: '45', sbp: '120', tc: '180', hdl: '45' }))
    .toMatchObject({ value: '4.0', interpretation: { zh: '高風險（2.5–<7.5%）' } })
  expect(calc.compute({ ...base, sex: 'female', age: '55', sbp: '130', tc: '200', hdl: '60' }))
    .toMatchObject({ value: '3.6', interpretation: { zh: '低至中風險（<5%）' }, severity: 'normal' })
})

it('does not apply to diabetes, known CVD or ages outside 40–69, and says why', () => {
  const v = { ...base, sex: 'male', age: '60', sbp: '140', tc: '213', hdl: '50' }
  expect(calc.compute({ ...v, dm: 'yes' })).toMatchObject({ interpretation: { zh: '不適用' }, notes: { zh: '糖尿病請改用 SCORE2-Diabetes' } })
  expect(calc.compute({ ...v, cvd: 'yes' })?.notes?.zh).toContain('已有心血管疾病')
  expect(calc.compute({ ...v, age: '72' })?.notes?.zh).toContain('SCORE2-OP')
  expect(calc.compute({ ...v, age: '38' })?.notes?.zh).toBe('40 歲以下不適用')
})

it('waits for every input, and reads histories from the record presuming 否', () => {
  expect(calc.compute({ ...base, sex: 'male', age: '60', sbp: '140', tc: '213' })).toBeNull()
  const selects = calc.inputs.filter((input) => input.type === 'select' && input.key !== 'sex')
  expect(selects.map((input) => [input.key, input.type === 'select' ? input.source : undefined, input.type === 'select' ? input.presumed : undefined])).toEqual([
    ['smoking', { kind: 'hfpefClinical', key: 'smoker' }, 'no'],
    ['dm', { kind: 'hfpefClinical', key: 'diabetes' }, 'no'],
    ['cvd', { kind: 'hfpefClinical', key: 'ascvdOrHf' }, 'no'],
  ])
})

it('is described in the calculator list', () => {
  expect(getCalcInfo('score2-asia-pacific')?.useWhen?.zh).toContain('低風險區')
  expect(getCalcScoring('score2-asia-pacific')?.formula?.zh).toBeTruthy()
  expect(getCalcTags('score2-asia-pacific')?.purpose).toContain('risk')
})
