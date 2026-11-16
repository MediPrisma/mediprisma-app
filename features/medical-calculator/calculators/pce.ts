import type { CalculatorDef, CalcValues, CalcInput } from '../types'

/** Raise when the coefficients or the eligibility rules change. */
export const PCE_VERSION = 'goff2013-v1'
const l = (zh: string, en: string) => ({ zh, en })
const yesNo = (key: string, zh: string, en: string): CalcInput => ({ key, type: 'select', label: l(zh, en), defaultValue: '', options: [
  { value: '', label: l('未確認', 'Unconfirmed') }, { value: 'no', label: l('否', 'No') }, { value: 'yes', label: l('是', 'Yes') },
] })

/**
 * The 2013 ACC/AHA Pooled Cohort Equations (Goff DC et al., Circulation
 * 2014;129(suppl 2):S49–S73, Appendix 7 Table A): 10-year risk of a first hard
 * ASCVD event (nonfatal MI, CHD death, fatal or nonfatal stroke), 40–79 years,
 * primary prevention. The equations are published for non-Hispanic White and
 * African American adults; the guideline says to use the White equations for
 * other race/ethnic groups, noting they may over- or under-estimate (East
 * Asian cohorts: overestimation reported). Taiwanese patients therefore read
 * the 「其他族裔」 option, which uses the White coefficients, and the result is a
 * reference beside PREVENT, never a gate.
 */
export const PCE_INPUTS: CalcInput[] = [
  { key: 'sex', type: 'select', label: l('模型性別', 'Model sex'), source: { kind: 'sex' }, defaultValue: '', options: [{ value: '', label: l('未確認', 'Unconfirmed') }, { value: 'female', label: l('女', 'Female') }, { value: 'male', label: l('男', 'Male') }] },
  { key: 'age', type: 'number', label: l('年齡（40–79）', 'Age (40–79)'), source: { kind: 'age' }, unit: 'y' },
  { key: 'race', type: 'select', label: l('係數族群', 'Equation group'), defaultValue: '', options: [
    { value: '', label: l('未確認', 'Unconfirmed') },
    { value: 'other', label: l('其他族裔（含亞裔；以白人係數估算）', 'Other (incl. Asian; White equations)') },
    { value: 'white', label: l('非西語裔白人', 'Non-Hispanic White') },
    { value: 'aa', label: l('非裔美國人', 'African American') },
  ] },
  { key: 'tc', type: 'number', label: l('總膽固醇（130–320）', 'Total cholesterol (130–320)'), source: { kind: 'lab', keys: ['CHOL'] }, unit: 'mg/dL', dimension: 'cholesterol' },
  { key: 'hdl', type: 'number', label: l('HDL-C（20–100）', 'HDL-C (20–100)'), source: { kind: 'lab', keys: ['HDL'] }, unit: 'mg/dL', dimension: 'cholesterol' },
  { key: 'sbp', type: 'number', label: l('收縮壓（90–200）', 'Systolic BP (90–200)'), source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' }, unit: 'mmHg' },
  yesNo('bptreat', '目前使用降血壓藥', 'Current antihypertensive use'),
  yesNo('dm', '糖尿病病史', 'Diabetes history'),
  yesNo('smoking', '目前吸菸', 'Current smoking'),
  yesNo('cvd', '既有 ASCVD（冠心病、腦中風、PAD）', 'Known ASCVD (coronary disease, stroke, PAD)'),
]

// Appendix 7 Table A, as reproduced by two independent implementations
// (CRAN CVrisk `ascvd_pooled_coef`; bcjaeger/PooledCohort `pcr.R`, copied from
// the Cerner ASCVD risk calculator). Order: ln age, (ln age)², ln TC,
// ln age × ln TC, ln HDL, ln age × ln HDL, ln treated SBP, ln age × ln treated
// SBP, ln untreated SBP, ln age × ln untreated SBP, smoker, ln age × smoker,
// diabetes; then the group mean of Σ(coefficient × value) and S₀(10 years).
const COEFFICIENTS = {
  'white-female': { beta: [-29.799, 4.884, 13.540, -3.114, -13.578, 3.149, 2.019, 0, 1.957, 0, 7.574, -1.665, 0.661], mean: -29.18, s0: 0.9665 },
  'aa-female': { beta: [17.114, 0, 0.940, 0, -18.920, 4.475, 29.291, -6.432, 27.820, -6.087, 0.691, 0, 0.874], mean: 86.61, s0: 0.9533 },
  'white-male': { beta: [12.344, 0, 11.853, -2.664, -7.990, 1.769, 1.797, 0, 1.764, 0, 7.837, -1.795, 0.658], mean: 61.18, s0: 0.9144 },
  'aa-male': { beta: [2.469, 0, 0.302, 0, -0.307, 0, 1.916, 0, 1.809, 0, 0.549, 0, 0.645], mean: 19.54, s0: 0.8954 },
} as const

export interface PceResult {
  status: 'ready' | 'ineligible' | 'needs-data'
  issues: string[]
  risk10?: number
  /** Which equations were used; 'white' also for 「其他族裔」. */
  equations?: 'white' | 'aa'
}

export function calculatePce(v: CalcValues): PceResult {
  const excluded: string[] = []
  if (v.cvd === 'yes') excluded.push('cvd')
  if (v.age?.trim() && Number.isFinite(Number(v.age)) && (Number(v.age) < 40 || Number(v.age) > 79)) excluded.push('age')
  if (excluded.length) return { status: 'ineligible', issues: excluded }
  const issues = PCE_INPUTS.filter((input) => input.type === 'select'
    ? !input.options.some((o) => o.value !== '' && o.value === v[input.key])
    : !v[input.key]?.trim() || !Number.isFinite(Number(v[input.key]))).map((i) => i.key)
  const ranges: Record<string, [number, number]> = { age: [40, 79], tc: [130, 320], hdl: [20, 100], sbp: [90, 200] }
  for (const [key, [min, max]] of Object.entries(ranges)) if (v[key]?.trim() && (Number(v[key]) < min || Number(v[key]) > max)) issues.push(key)
  if (issues.length) return { status: 'needs-data', issues: [...new Set(issues)] }
  const equations = v.race === 'aa' ? 'aa' : 'white'
  const group = COEFFICIENTS[`${equations}-${v.sex as 'female' | 'male'}`]
  const lnAge = Math.log(Number(v.age)), lnTc = Math.log(Number(v.tc)), lnHdl = Math.log(Number(v.hdl)), lnSbp = Math.log(Number(v.sbp))
  const treated = v.bptreat === 'yes', smoker = Number(v.smoking === 'yes'), dm = Number(v.dm === 'yes')
  const terms = [
    lnAge, lnAge * lnAge, lnTc, lnAge * lnTc, lnHdl, lnAge * lnHdl,
    treated ? lnSbp : 0, treated ? lnAge * lnSbp : 0, treated ? 0 : lnSbp, treated ? 0 : lnAge * lnSbp,
    smoker, lnAge * smoker, dm,
  ]
  const sum = group.beta.reduce<number>((acc, beta, i) => acc + beta * terms[i]!, 0)
  const risk10 = 100 * (1 - Math.pow(group.s0, Math.exp(sum - group.mean)))
  return { status: 'ready', issues: [], risk10, equations }
}

export const PCE: CalculatorDef = {
  id: 'pce-ascvd', version: PCE_VERSION,
  name: l('ACC/AHA Pooled Cohort（PCE）｜10 年 ASCVD', 'ACC/AHA Pooled Cohort Equations | 10-year ASCVD'), category: 'cardiac', inputs: PCE_INPUTS,
  blurb: l('2013 ACC/AHA 多世代方程式；40–79 歲初級預防，台灣族群以白人係數估算。', '2013 ACC/AHA multi-cohort equations; primary prevention at 40–79, White equations for Taiwanese patients.'),
  coherence: { keys: ['tc', 'hdl'], windowDays: 0 },
  reference: 'Goff DC Jr, et al. 2013 ACC/AHA Guideline on the Assessment of Cardiovascular Risk. Circulation 2014;129(suppl 2):S49–S73, Appendix 7 Table A. Hard ASCVD: nonfatal MI, CHD death, fatal or nonfatal stroke.',
  compute: (values) => {
    const r = calculatePce(values)
    if (r.status !== 'ready' || r.risk10 === undefined) return null
    const band = r.risk10 < 5 ? l('低風險（<5%）', 'Low (<5%)') : r.risk10 < 7.5 ? l('邊緣風險（5–<7.5%）', 'Borderline (5–<7.5%)') : r.risk10 < 20 ? l('中等風險（7.5–<20%）', 'Intermediate (7.5–<20%)') : l('高風險（≥20%）', 'High (≥20%)')
    return {
      numericValue: r.risk10, value: r.risk10.toFixed(1), unit: '%',
      interpretation: band,
      severity: r.risk10 < 5 ? 'low' : r.risk10 < 20 ? 'moderate' : 'high',
      extra: [{ label: l('使用係數', 'Equations used'), value: r.equations === 'aa' ? 'African American' : 'White' }],
      notes: l('2018 ACC/AHA 血脂指引的四個風險帶（<5、5–7.5、7.5–20、≥20%）。方程式由美國世代建立，亞裔族群報告有高估；台灣無校正版，僅供與 PREVENT、國健署公式並列參考。', 'The four 2018 ACC/AHA cholesterol-guideline bands (<5, 5–7.5, 7.5–20, ≥20%). Derived in US cohorts; overestimation has been reported in Asian groups and there is no Taiwanese recalibration, so this is a reference beside PREVENT and the HPA equation.'),
    }
  },
}
