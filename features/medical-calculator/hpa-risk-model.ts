import type { CalcValues } from './types'

/**
 * Local, offline approximation of the HPA open-service V4 (five V3 risk
 * models). HPA has not released these five model coefficients as a complete
 * public specification. The compact covariate forms and coefficients below
 * were inferred from synthetic public-calculator responses on 2026-09-16;
 * they are NOT official coefficients. Never call the endpoint at runtime.
 *
 * See docs/HPA-RISK-RECONSTRUCTION.md for sampling, holdout and limitations.
 */
export type HpaOutcome = 'chd' | 'diabetes' | 'hypertension' | 'stroke' | 'mace'
export type HpaStatus = 'estimated' | 'missing' | 'outside' | 'existing' | 'review'
export type HpaLevel = 'low' | 'moderate' | 'high'

export interface HpaRiskResult {
  outcome: HpaOutcome
  status: HpaStatus
  /** Two-decimal local estimate; truncate for display. Never an official score. */
  risk?: number
  level?: HpaLevel
  /** Risk grade is especially uncertain close to the official cut points. */
  nearBoundary?: boolean
  reason?: 'known' | 'threshold' | 'prior-cvd'
  missing?: string[]
  outside?: string[]
}

export const HPA_OUTCOMES: HpaOutcome[] = ['chd', 'diabetes', 'hypertension', 'stroke', 'mace']
/** The frozen coefficient set (scripts/hpa/artifacts/frozen-candidate-v1-2026-09-16.json), named on every result handed to a pack. */
export const HPA_RECONSTRUCTION_VERSION = 'reconstruction-v1-2026-09-16'

/** Sampling limits, NOT normal ranges or diagnostic thresholds. */
export const HPA_VALIDATED_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  age: [35, 70], height: [150, 190], weight: [45, 115], waist: [60, 125],
  sbp: [90, 139], glu: [70, 125], chol: [120, 300], tg: [45, 400],
  ldlc: [45, 220], hdlc: [25, 95],
}

interface Model { keys: string[]; beta: number[] }
type Sex = 'female' | 'male'

// Feature order: intercept, then one term for each key, except height is
// absorbed into BMI and female CHD/MACE use total-cholesterol/HDL as a single
// ratio at the cholesterol position. Age is log transformed; remaining
// continuous predictors are linear. Binary history fields contribute 0/1.
const MODELS: Record<Sex, Record<HpaOutcome, Model>> = {
  female: {
    chd: { keys: ['age', 'hdlc', 'waist', 'sbp', 'chol', 'tg'], beta: [-2.3237947282105287, 0.8155284114698946, 0.425000616159082, 0.03000037457079843, 0.3581011912333329, 0.010000332890466937] },
    diabetes: { keys: ['age', 'height', 'weight', 'tg', 'glu', 'hdlc', 'waist'], beta: [-1.2458996744571351, 0.2512645621841811, 0.3615015778617301, 0.15999649363180646, 0.667999727943408, -0.18000028734839998, 0.19499812430109334] },
    hypertension: { keys: ['age', 'height', 'weight', 'sbp', 'glu', 'tg', 'smoke'], beta: [-0.49301916572607296, 0.3581976284027122, 0.3234999175041094, 0.625999435227669, 0.06000006704711663, 0.24000015748672135, 0.38659928228850216] },
    stroke: { keys: ['age', 'sbp', 'waist', 'hbp', 'diabetes', 'smoke'], beta: [-2.51239049281855, 0.4445878613981042, 0.27799279266246973, 0.22999041205289056, 0.49080213432673797, 0.5809763222479167, 0.7793865561707118] },
    mace: { keys: ['age', 'sbp', 'hdlc', 'waist', 'chol', 'smoke'], beta: [-2.040205473224065, 0.5978801093092264, 0.2560015341468226, 0.2570025039051994, 0.3054015093317822, 0.1923012441536049] },
  },
  male: {
    chd: { keys: ['age', 'hdlc', 'waist', 'hbp'], beta: [-2.4013711919117364, 0.7215985012807594, -0.1619979028413207, 0.1629998437836418, 0.6715011525278097] },
    diabetes: { keys: ['age', 'height', 'weight', 'tg', 'glu', 'chol'], beta: [-1.6953638233501518, 0.37926327956914113, 0.6405015085966346, 0.23999694282766038, 0.6640029478273555, 0.09999844354639414] },
    hypertension: { keys: ['age', 'height', 'weight', 'sbp', 'hdlc', 'ldlc'], beta: [-0.7124424962034156, 0.5793313530369251, 0.18400003128764228, 0.44799997665344926, -0.2260000016520315, 0.04000002505729486] },
    stroke: { keys: ['age', 'sbp', 'glu', 'tg'], beta: [-2.3653033924765463, 0.7792447909070157, 0.4759995916241755, 0.09200129427509184, 0.17000038811055312] },
    mace: { keys: ['age', 'sbp', 'hdlc', 'waist'], beta: [-1.8082103870229984, 0.6353392701386423, 0.54000180452084, -0.0899997626935683, 0.11400207489839692] },
  },
}

// Public V4 age-cohort reference values, independently queried at each age
// for the official hypertension risk category (35 through 70 inclusive).
const HYPERTENSION_AVG: Record<Sex, number[]> = {
  female: [18.17, 21.11, 21.93, 25.2, 26.75, 26.18, 30.35, 31.22, 27.79, 28.7, 33.4, 36.75, 39.65, 42.97, 42.91, 48.03, 53.81, 47.48, 49.45, 60.95, 47.66, 51.02, 57.53, 55.64, 59.36, 56.57, 63.17, 68.72, 64.75, 63.38, 73.11, 74.33, 74.63, 72.81, 74.71, 77.9],
  male: [13.85, 16.2, 16.91, 18.84, 17.62, 20.25, 22.24, 19.94, 23.92, 24.34, 26.76, 31.94, 29.98, 32.23, 35.48, 33.71, 36.49, 41.7, 40.74, 38.57, 40.87, 50.92, 47.54, 51.23, 48.64, 55.86, 55.05, 63.5, 60.87, 62.27, 60.28, 66.1, 70.67, 67.85, 64.12, 75.35],
}

const CENTERS: Record<string, [number, number]> = {
  age: [50, 10], bmi: [24.22, 5], waist: [85, 10], sbp: [120, 20],
  glu: [90, 20], chol: [180, 50], tg: [100, 100], ldlc: [100, 50], hdlc: [50, 20],
}
const BINARY = new Set(['diabetes', 'hbp', 'smoke'])

function valueOf(values: CalcValues, key: string): number | null {
  const raw = values[key]
  if (raw === undefined || raw.trim() === '') return null
  if (BINARY.has(key)) return raw === 'yes' ? 1 : raw === 'no' ? 0 : null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function featureVector(values: CalcValues, keys: string[], sex: Sex, outcome: HpaOutcome): number[] {
  const f = [1]
  for (const key of keys) {
    if (key === 'height') continue
    // One-factor and cross-factor probes identify this ratio, rather than
    // separate HDL and total-cholesterol effects, for these two models.
    const cholesterolRatio = sex === 'female' && (outcome === 'chd' || outcome === 'mace')
    if (cholesterolRatio && key === 'hdlc') continue
    if (cholesterolRatio && key === 'chol') {
      f.push(valueOf(values, 'chol')! / valueOf(values, 'hdlc')! - 3.6)
      continue
    }
    const name = key === 'weight' && keys.includes('height') ? 'bmi' : key
    const rawValue = name === 'bmi'
      ? valueOf(values, 'weight')! / (valueOf(values, 'height')! / 100) ** 2
      : valueOf(values, key)!
    // High-resolution official probes distinguish four-decimal BMI rounding
    // from continuous BMI, other decimal precisions, and Float32 arithmetic.
    const v = name === 'bmi' ? Math.round(rawValue * 10000) / 10000 : rawValue
    let x = v
    if (CENTERS[name]) {
      const [center, scale] = CENTERS[name]
      x = name === 'age' ? Math.log(v / center) * center / scale : (v - center) / scale
    }
    f.push(x)
  }
  return f
}

export function calculateHpaRisks(values: CalcValues): HpaRiskResult[] {
  const sex = values.gender === 'female' || values.gender === 'male' ? values.gender : null
  const age = valueOf(values, 'age')

  return HPA_OUTCOMES.map((outcome) => {
    if (outcome === 'diabetes' && values.diabetes === 'yes') return { outcome, status: 'existing', reason: 'known' }
    if (outcome === 'diabetes' && (valueOf(values, 'glu') ?? 0) >= 126) return { outcome, status: 'review', reason: 'threshold' }
    if (outcome === 'hypertension' && values.hbp === 'yes') return { outcome, status: 'existing', reason: 'known' }
    // The official v4/hra-allmodel.jsp also withholds these two incident-risk
    // percentages at these values. A single measurement is NOT known disease.
    if (outcome === 'hypertension' && (valueOf(values, 'sbp') ?? 0) >= 140) return { outcome, status: 'review', reason: 'threshold' }
    if (['chd', 'stroke', 'mace'].includes(outcome) && values.prior_cvd === 'yes') return { outcome, status: 'existing', reason: 'prior-cvd' }

    const keys = sex ? MODELS[sex][outcome].keys : []
    const needed = ['gender', ...keys]
    if (outcome === 'diabetes') needed.push('diabetes')
    if (outcome === 'hypertension') needed.push('hbp')
    if (['chd', 'stroke', 'mace'].includes(outcome)) needed.push('prior_cvd')
    const missing = needed.filter((key) => key === 'gender' ? !sex : key === 'prior_cvd' ? !['yes', 'no'].includes(values[key]) : valueOf(values, key) === null)
    if (missing.length) return { outcome, status: 'missing', missing }

    const outside = keys.filter((key) => {
      const n = valueOf(values, key)!
      const range = HPA_VALIDATED_RANGES[key]
      return range && (n < range[0] || n > range[1])
    })
    if (age !== null && !Number.isInteger(age)) outside.push('age')
    // The public backend accepts fractional measurements except that age and
    // SBP are integer DTO fields. Do not silently round a supplied SBP.
    if (keys.includes('sbp') && !Number.isInteger(valueOf(values, 'sbp')) && !outside.includes('sbp')) outside.push('sbp')
    if (outside.length) return { outcome, status: 'outside', outside }

    const model = MODELS[sex!][outcome]
    const features = featureVector(values, model.keys, sex!, outcome)
    if (features.length !== model.beta.length) throw new Error(`Invalid HPA feature specification: ${sex}/${outcome}`)
    const linear = features.reduce((sum, feature, index) => sum + feature * model.beta[index], 0)
    const rawRisk = -100 * Math.expm1(-Math.exp(linear))
    if (!Number.isFinite(rawRisk)) return { outcome, status: 'outside' }
    // Boundary probes identify two-decimal quantization BEFORE the official
    // final integer truncation. This also reproduces the observed 100% bin.
    const risk = Math.round(rawRisk * 100) / 100

    if (outcome === 'hypertension') {
      const ratio = risk / HYPERTENSION_AVG[sex!][age! - 35]
      // The ratio uses the two-decimal numerator before integer truncation;
      // risk-util.js grades from the resulting two-decimal multipleDiff.
      const displayedRatio = Math.round(ratio * 100) / 100
      const level = displayedRatio < .75 ? 'low' : displayedRatio > 1.25 ? 'high' : 'moderate'
      return { outcome, status: 'estimated', risk, level, nearBoundary: Math.min(Math.abs(ratio - .75), Math.abs(ratio - 1.25)) < .12 }
    }
    const level = risk >= 20 ? 'high' : risk >= 10 ? 'moderate' : 'low'
    return { outcome, status: 'estimated', risk, level, nearBoundary: Math.min(Math.abs(risk - 10), Math.abs(risk - 20)) < 5 }
  })
}
