import type { CalculatorDef, CalcValues, CalcInput } from '../types'

const l = (zh: string, en: string) => ({ zh, en })
const yesNo = (key: string, zh: string, en: string, extra: Partial<CalcInput> = {}): CalcInput => ({
  key, type: 'select', label: l(zh, en), defaultValue: '',
  options: [{ value: '', label: l('未確認', 'Unconfirmed') }, { value: 'yes', label: l('是', 'Yes') }, { value: 'no', label: l('否', 'No') }],
  ...extra,
} as CalcInput)

/** Chung F et al. Chest 2016;149:631–638: the eight items and the bands. */
export const STOP_BANG_AGE_OVER = 50
export const STOP_BANG_BMI_OVER = 35
export const STOP_BANG_NECK_OVER_CM = 40

export const STOP_BANG_INPUTS: CalcInput[] = [
  yesNo('snoring', 'S 大聲打鼾（隔著門聽得到）', 'S Loud snoring (heard through a closed door)'),
  yesNo('tired', 'T 白天常疲倦、嗜睡', 'T Often tired or sleepy in the daytime'),
  yesNo('observed', 'O 有人目擊睡眠中呼吸停止', 'O Breathing pauses observed during sleep'),
  // P reads the antihypertensive prescriptions (the host's rule), so a treated
  // patient is prefilled; untreated hypertension is the clinician's answer.
  yesNo('pressure', 'P 高血壓（有或治療中）', 'P High blood pressure (present or treated)', { source: { kind: 'hfpefClinical', key: 'antihypertensives' } }),
  { key: 'bmi', type: 'number', label: l(`B BMI（>${STOP_BANG_BMI_OVER} 計 1 分）`, `B BMI (>${STOP_BANG_BMI_OVER} scores)`), source: { kind: 'bmi' }, unit: 'kg/m²' },
  { key: 'age', type: 'number', label: l(`A 年齡（>${STOP_BANG_AGE_OVER} 計 1 分）`, `A Age (>${STOP_BANG_AGE_OVER} scores)`), source: { kind: 'age' }, unit: 'y' },
  { key: 'neck', type: 'number', label: l(`N 頸圍（>${STOP_BANG_NECK_OVER_CM} cm 計 1 分）`, `N Neck circumference (>${STOP_BANG_NECK_OVER_CM} cm scores)`), unit: 'cm' },
  { key: 'sex', type: 'select', label: l('G 性別（男計 1 分）', 'G Sex (male scores)'), source: { kind: 'sex' }, defaultValue: '', options: [{ value: '', label: l('未確認', 'Unconfirmed') }, { value: 'female', label: l('女', 'Female') }, { value: 'male', label: l('男', 'Male') }] },
]

export interface StopBangScore {
  score: number
  upperBound: number
  complete: boolean
  missingInputs: string[]
  /** Chung 2016: 0–2 low, 3–4 intermediate, 5–8 high; or STOP ≥2 plus male, BMI >35 or neck >40 → high. */
  band?: 'low' | 'intermediate' | 'high'
  alternativeHigh: boolean
}

function known(v: CalcValues, key: string): boolean | undefined {
  const value = v[key]
  if (key === 'bmi' || key === 'age' || key === 'neck') {
    if (!value?.trim() || !Number.isFinite(Number(value))) return undefined
    const limit = key === 'bmi' ? STOP_BANG_BMI_OVER : key === 'age' ? STOP_BANG_AGE_OVER : STOP_BANG_NECK_OVER_CM
    return Number(value) > limit
  }
  if (key === 'sex') return value === 'male' ? true : value === 'female' ? false : undefined
  return value === 'yes' ? true : value === 'no' ? false : undefined
}

export function calculateStopBang(v: CalcValues): StopBangScore {
  const keys = ['snoring', 'tired', 'observed', 'pressure', 'bmi', 'age', 'neck', 'sex']
  const items = Object.fromEntries(keys.map((key) => [key, known(v, key)])) as Record<string, boolean | undefined>
  const score = Object.values(items).filter((item) => item === true).length
  const missingInputs = keys.filter((key) => items[key] === undefined)
  const stopKnown = ['snoring', 'tired', 'observed', 'pressure'].filter((key) => items[key] === true).length
  const alternativeHigh = stopKnown >= 2 && (items.sex === true || items.bmi === true || items.neck === true)
  const upperBound = score + missingInputs.length
  // A band the known items already reach stands whatever is still unknown;
  // 「low」 only once the score can no longer reach 3.
  const band: StopBangScore['band'] = score >= 5 || alternativeHigh ? 'high' : score >= 3 ? 'intermediate' : upperBound < 3 ? 'low' : undefined
  return { score, upperBound, complete: !missingInputs.length, missingInputs, ...(band ? { band } : {}), alternativeHigh }
}

export const STOP_BANG: CalculatorDef = {
  id: 'stop-bang', version: '1.0.0',
  name: l('STOP-Bang 阻塞型睡眠呼吸中止風險', 'STOP-Bang Score for OSA'), category: 'pulmonary', inputs: STOP_BANG_INPUTS,
  blurb: l('八題問卷；P、A、G、B 由病歷帶入，S、T、O、N 問診。', 'Eight items; P, A, G and B from the record, S, T, O and N asked.'),
  compute: (v) => {
    const r = calculateStopBang(v)
    const bandWords = r.band === 'high' ? l(r.alternativeHigh && r.score < 5 ? '高風險（STOP ≥2 加男性／BMI >35／頸圍 >40）' : '高風險（5–8）', r.alternativeHigh && r.score < 5 ? 'High (STOP ≥2 plus male, BMI >35 or neck >40)' : 'High (5–8)')
      : r.band === 'intermediate' ? l('中度風險（3–4）', 'Intermediate (3–4)')
        : r.band === 'low' ? l('低風險（0–2）', 'Low (0–2)')
          : l('資料未齊 — 可能分數範圍', 'Incomplete — possible score range')
    return {
      value: r.complete ? `${r.score} / 8` : `${r.score}–${r.upperBound}`,
      numericValue: r.score,
      completeness: { complete: r.complete, upperBound: r.upperBound, missingKeys: r.missingInputs },
      interpretation: bandWords,
      severity: r.band === 'high' ? 'high' : r.band === 'intermediate' ? 'moderate' : r.band === 'low' ? 'low' : 'moderate',
      notes: l('高血壓合併 STOP-Bang 中、高風險，或抗藥性高血壓不論分數，建議安排睡眠檢查（AHA 2025 3.2.3、ESC 2024 7.6.4）。亞洲人 BMI ≥30 已屬肥胖，但官方計分仍以 >35 為準。', 'Hypertension with an intermediate or high STOP-Bang, or resistant hypertension at any score, warrants a sleep study (AHA 2025 3.2.3, ESC 2024 7.6.4). BMI ≥30 is obesity in Asian adults, but the official item still scores >35.'),
    }
  },
  reference: 'Chung F, Abdullah HR, Liao P. STOP-Bang questionnaire: a practical approach to screen for obstructive sleep apnea. Chest 2016;149:631–638.',
}
