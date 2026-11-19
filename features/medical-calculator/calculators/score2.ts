import type { CalculatorDef, CalcValues, CalcInput, L } from '../types'

/**
 * SCORE2 Asia-Pacific (SCORE2 Asia-Pacific Writing Group, Eur Heart J
 * 2025;46:702–715, doi:10.1093/eurheartj/ehae609): the 2021 SCORE2 equations
 * recalibrated to four Asia-Pacific risk regions. Taiwan is not in the paper's
 * country list; the owner chose the low-risk region (2026-11-19), the group its
 * WHO age-standardised CVD mortality falls in (<100 per 100,000), beside Japan,
 * Korea, Hong Kong and Singapore. Ages 40–69 without CVD or diabetes only: the
 * paper has no older-person (SCORE2-OP) recalibration for the region.
 */
export const SCORE2_AP_VERSION = 'asia-pacific-low-v1'
const l = (zh: string, en: string): L => ({ zh, en })

/** SCORE2 coefficients (SCORE2 working group, Eur Heart J 2021;42:2439), as RiskScorescvd (CRAN) codes them. */
const MODEL = {
  male: { baseline: 0.9605, age: 0.3742, smoking: 0.6012, sbp: 0.2777, dm: 0.6457, tc: 0.1458, hdl: -0.2698, ageSmoking: -0.0755, ageSbp: -0.0255, ageDm: -0.0983, ageTc: -0.0281, ageHdl: 0.0426 },
  female: { baseline: 0.9776, age: 0.4648, smoking: 0.7744, sbp: 0.3131, dm: 0.8096, tc: 0.1002, hdl: -0.2606, ageSmoking: -0.1088, ageSbp: -0.0277, ageDm: -0.1272, ageTc: -0.0226, ageHdl: 0.0613 },
} as const
/** Low-risk Asia-Pacific region recalibration (scale1, scale2), as RiskScorescvd codes the paper's supplement. */
const LOW_REGION = { male: [-0.375229965, 0.62020875], female: [-0.986572446, 0.536743779] } as const

const yesNo = (key: string, label: L, record: string): CalcInput => ({
  key, type: 'select', label, defaultValue: '', presumed: 'no',
  source: { kind: 'hfpefClinical', key: record } as CalcInput['source'],
  options: [{ value: '', label: l('未確認', 'Unconfirmed') }, { value: 'no', label: l('否', 'No') }, { value: 'yes', label: l('是', 'Yes') }],
} as CalcInput)

export const SCORE2_INPUTS: CalcInput[] = [
  { key: 'sex', type: 'select', label: l('性別', 'Sex'), source: { kind: 'sex' }, defaultValue: '', options: [{ value: '', label: l('未確認', 'Unconfirmed') }, { value: 'female', label: l('女', 'Female') }, { value: 'male', label: l('男', 'Male') }] },
  { key: 'age', type: 'number', label: l('年齡（40–69）', 'Age (40–69)'), source: { kind: 'age' }, unit: 'y' },
  { key: 'sbp', type: 'number', label: l('收縮壓', 'Systolic BP'), source: { kind: 'vital', loinc: ['8480-6'], vital: 'sbp' }, unit: 'mmHg' },
  { key: 'tc', type: 'number', label: l('總膽固醇', 'Total cholesterol'), source: { kind: 'lab', keys: ['CHOL'] }, unit: 'mg/dL', dimension: 'cholesterol' },
  { key: 'hdl', type: 'number', label: l('HDL-C', 'HDL-C'), source: { kind: 'lab', keys: ['HDL'] }, unit: 'mg/dL', dimension: 'cholesterol' },
  yesNo('smoking', l('目前吸菸', 'Current smoking'), 'smoker'),
  yesNo('dm', l('糖尿病', 'Diabetes'), 'diabetes'),
  yesNo('cvd', l('已有心血管疾病（冠心病、腦中風、PAD、心衰竭）', 'Known CVD (coronary disease, stroke, PAD, HF)'), 'ascvdOrHf'),
]

export function calculateScore2AsiaPacific(v: CalcValues): { status: 'ready' | 'ineligible' | 'needs-data'; issues: string[]; risk10?: number } {
  const age = Number(v.age)
  const excluded = (['cvd', 'dm'] as const).filter((key) => v[key] === 'yes') as string[]
  if (v.age?.trim() && Number.isFinite(age) && (age < 40 || age > 69)) excluded.push('age')
  if (excluded.length) return { status: 'ineligible', issues: excluded }
  const missing = ['sex', 'age', 'sbp', 'tc', 'hdl', 'smoking', 'dm', 'cvd'].filter((key) => key === 'sex'
    ? v.sex !== 'male' && v.sex !== 'female'
    : ['smoking', 'dm', 'cvd'].includes(key) ? v[key] !== 'yes' && v[key] !== 'no' : !v[key]?.trim() || !Number.isFinite(Number(v[key])))
  if (missing.length) return { status: 'needs-data', issues: missing }
  const sex = v.sex as 'male' | 'female'
  const m = MODEL[sex]
  const a = (age - 60) / 5
  const s = v.smoking === 'yes' ? 1 : 0
  const bp = (Number(v.sbp) - 120) / 20
  const tc = Number(v.tc) / 38.67 - 6
  const hdl = (Number(v.hdl) / 38.67 - 1.3) / 0.5
  const lp = m.age * a + m.smoking * s + m.sbp * bp + m.tc * tc + m.hdl * hdl
    + m.ageSmoking * a * s + m.ageSbp * a * bp + m.ageTc * a * tc + m.ageHdl * a * hdl
  const uncalibrated = 1 - m.baseline ** Math.exp(lp)
  const [scale1, scale2] = LOW_REGION[sex]
  const risk = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - uncalibrated))))
  return { status: 'ready', issues: [], risk10: risk * 100 }
}

/** ESC 2021 prevention guideline's age-specific SCORE2 categories (apparently healthy people). */
function category(age: number, risk: number): { label: L; severity: 'normal' | 'moderate' | 'high' } {
  const [high, veryHigh] = age < 50 ? [2.5, 7.5] : [5, 10]
  if (risk >= veryHigh) return { label: l(`極高風險（≥${veryHigh}%）`, `Very high risk (≥${veryHigh}%)`), severity: 'high' }
  if (risk >= high) return { label: l(`高風險（${high}–<${veryHigh}%）`, `High risk (${high}–<${veryHigh}%)`), severity: 'moderate' }
  return { label: l(`低至中風險（<${high}%）`, `Low-to-moderate risk (<${high}%)`), severity: 'normal' }
}

export const SCORE2_ASIA_PACIFIC: CalculatorDef = {
  id: 'score2-asia-pacific',
  version: SCORE2_AP_VERSION,
  category: 'cardiac',
  name: l('SCORE2 亞太版｜10 年心血管風險（低風險區）', 'SCORE2 Asia-Pacific | 10-year CVD risk (low-risk region)'),
  blurb: l('ESC SCORE2 依亞太地區校正；台灣採低風險區，40–69 歲、無心血管疾病及糖尿病者。', 'ESC SCORE2 recalibrated for the Asia-Pacific; Taiwan read in the low-risk region, age 40–69 without CVD or diabetes.'),
  inputs: SCORE2_INPUTS,
  coherence: { keys: ['tc', 'hdl'], windowDays: 0 },
  compute: (v) => {
    const r = calculateScore2AsiaPacific(v)
    if (r.status === 'ineligible') {
      const why = r.issues.includes('dm') ? l('糖尿病請改用 SCORE2-Diabetes', 'Diabetes: use SCORE2-Diabetes')
        : r.issues.includes('cvd') ? l('已有心血管疾病，屬極高風險，不適用', 'Known CVD is very high risk; not applicable')
          : Number(v.age) >= 70 ? l('70 歲以上：亞太版沒有 SCORE2-OP 校正，不適用', 'Age 70+: no Asia-Pacific SCORE2-OP recalibration; not applicable')
            : l('40 歲以下不適用', 'Not applicable under 40')
      return { value: '—', interpretation: l('不適用', 'Not applicable'), notes: why }
    }
    if (r.status !== 'ready') return null
    const band = category(Number(v.age), r.risk10!)
    return {
      value: r.risk10!.toFixed(1),
      unit: '%',
      numericValue: r.risk10,
      interpretation: band.label,
      severity: band.severity,
      notes: l(
        '致死與非致死心肌梗塞、中風之 10 年風險。分層門檻借用 ESC 2021（<50 歲 2.5／7.5%，50–69 歲 5／10%），亞太版論文未訂治療門檻。台灣不在論文國家表內，依 WHO 標準化 CVD 死亡率歸低風險區；新加坡華人世代報告此區仍有高估。',
        '10-year fatal and non-fatal MI and stroke. Bands borrow ESC 2021 thresholds (<50: 2.5/7.5%; 50–69: 5/10%); the Asia-Pacific paper sets none. Taiwan is not in the paper’s country table and is read in the low-risk region by WHO age-standardised CVD mortality; a Singapore Chinese cohort found this region still overestimates.',
      ),
    }
  },
  reference: 'SCORE2 Asia-Pacific Writing Group. Eur Heart J 2025;46:702–715, doi:10.1093/eurheartj/ehae609 (low-risk region scales as coded in RiskScorescvd, CRAN). SCORE2: Eur Heart J 2021;42:2439–2454. Categories: 2021 ESC CVD Prevention Guidelines.',
}
