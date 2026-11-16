/**
 * One set of inputs for the HTN page's baseline-risk calculators (owner
 * 2026-11-03: 「提供一個 common 的輸入面板，或是自動由 ICD 抓取，這樣就能夠套用多項
 * 公式」). PREVENT, the ACC/AHA Pooled Cohort Equations and the HPA (國健署)
 * reconstruction all read the same fields, each filled once from the best
 * source the host has and labelled with where it came from, so the clinician
 * confirms a value once for every formula:
 *
 *   physician — typed or confirmed here (the per-patient store `usePreventStore`)
 *   icd       — a diagnosis code the FHIR adapter read (E11 diabetes, I10
 *               hypertension, ASCVD codes); a positive code is locked
 *   rule      — the host's own inference from prescriptions or codes (an
 *               antihypertensive or statin currently supplied, a glucose-
 *               lowering drug, the 「其他族裔」 default for PCE)
 *   visit     — an answer given today on the page (DP-08's 目前吸菸)
 *   clinic    — a measurement entered in the room today
 *   record    — a lab, vital or demographic from the chart
 *   none      — nothing to read; the clinician answers
 *
 * Every formula stays in medical-calculator; this file only resolves inputs.
 */
import { PREVENT_INPUTS } from '@/features/medical-calculator/calculators/prevent'
import { HPA_RISK } from '@/features/medical-calculator/calculators/hpa-risk'
import { PCE_INPUTS } from '@/features/medical-calculator/calculators/pce'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcInput, CalcValues } from '@/features/medical-calculator/types'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitals } from '../stores/clinic-vitals.store'
import { convertToBase } from '@/features/medical-calculator/units'

export type RiskCalculatorId = 'prevent' | 'pce' | 'hpa'
export type RiskFieldOrigin = 'physician' | 'icd' | 'rule' | 'visit' | 'clinic' | 'record' | 'none'
/** The three-way source the pack's calculator inputs and the older PREVENT form read. */
export type RiskFieldSource = 'physician' | 'record' | 'none'

export interface RiskField {
  input: CalcInput
  value: string
  date?: string
  source: RiskFieldSource
  origin: RiskFieldOrigin
  /** What the origin was, for the panel (「ICD：第二型糖尿病 E11.9」, 「規則：降血壓藥供藥中」). */
  detail?: { zh: string; en: string }
  /** A positive diagnosis code cannot be cleared in the form. */
  locked: boolean
  unitError: boolean
  ageDays?: number
  /** Which calculators read this field. */
  usedBy: readonly RiskCalculatorId[]
}

export interface RiskInputs {
  values: CalcValues
  fields: RiskField[]
}

/** Today's every-visit answers the calculators can read: HTN DP-08's 目前吸菸. */
export interface RiskVisitAnswers { smokingCurrent?: 'yes' | 'no' }

// A diabetes diagnosis code locks the 糖尿病 input, as E11 always did.
const DIABETES_CODE_FACT_KEYS = ['type1DiabetesDiagnosis', 'type2DiabetesDiagnosis', 'otherDiabetesDiagnosis'] as const

const HPA_INPUTS = HPA_RISK[0]!.inputs
/** The HPA form's keys for the shared fields; its other inputs keep their own keys. */
export const HPA_KEY_FROM_SHARED: Readonly<Record<string, string>> = { sex: 'gender', tc: 'chol', hdl: 'hdlc', dm: 'diabetes', smoking: 'smoke', cvd: 'prior_cvd' }
const SHARED_KEY_FROM_HPA: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(HPA_KEY_FROM_SHARED).map(([shared, hpa]) => [hpa, shared]))

function hpaOnly(key: string): CalcInput {
  const input = HPA_INPUTS.find((item) => item.key === key)
  if (!input) throw new Error(`HPA input ${key} missing`)
  return input
}

/**
 * The shared fields in the order the panel shows them: who the patient is,
 * what was measured, the labs, the history, the drugs. PREVENT's inputs keep
 * their keys; PCE adds the equation group; HPA adds its anthropometrics and
 * labs under its own keys and reads the rest through `HPA_KEY_FROM_SHARED`.
 */
const prevent = (key: string): CalcInput => PREVENT_INPUTS.find((item) => item.key === key)!
const pce = (key: string): CalcInput => PCE_INPUTS.find((item) => item.key === key)!
export const RISK_INPUTS: readonly { input: CalcInput; usedBy: readonly RiskCalculatorId[] }[] = [
  { input: prevent('sex'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: prevent('age'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: pce('race'), usedBy: ['pce'] },
  { input: prevent('sbp'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: prevent('bmi'), usedBy: ['prevent'] },
  { input: hpaOnly('height'), usedBy: ['hpa'] },
  { input: hpaOnly('weight'), usedBy: ['hpa'] },
  { input: hpaOnly('waist'), usedBy: ['hpa'] },
  { input: prevent('tc'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: prevent('hdl'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: hpaOnly('ldlc'), usedBy: ['hpa'] },
  { input: hpaOnly('tg'), usedBy: ['hpa'] },
  { input: hpaOnly('glu'), usedBy: ['hpa'] },
  { input: prevent('egfr'), usedBy: ['prevent'] },
  { input: prevent('dm'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: hpaOnly('hbp'), usedBy: ['hpa'] },
  { input: prevent('smoking'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: prevent('cvd'), usedBy: ['prevent', 'pce', 'hpa'] },
  { input: prevent('subclinical'), usedBy: ['prevent'] },
  { input: prevent('genetic'), usedBy: ['prevent'] },
  { input: prevent('eskd'), usedBy: ['prevent'] },
  { input: prevent('limitedLife'), usedBy: ['prevent'] },
  { input: prevent('bptreat'), usedBy: ['prevent', 'pce'] },
  { input: prevent('statin'), usedBy: ['prevent'] },
]

export const RISK_FIELD_GROUPS: readonly { id: string; title: { zh: string; en: string }; keys: readonly string[] }[] = [
  { id: 'who', title: { zh: '基本', en: 'Patient' }, keys: ['sex', 'age', 'race'] },
  { id: 'measured', title: { zh: '量測', en: 'Measurements' }, keys: ['sbp', 'bmi', 'height', 'weight', 'waist'] },
  { id: 'labs', title: { zh: '檢驗', en: 'Labs' }, keys: ['tc', 'hdl', 'ldlc', 'tg', 'glu', 'egfr'] },
  { id: 'history', title: { zh: '病史', en: 'History' }, keys: ['dm', 'hbp', 'smoking', 'cvd', 'subclinical', 'genetic', 'eskd', 'limitedLife'] },
  { id: 'drugs', title: { zh: '用藥', en: 'Medication' }, keys: ['bptreat', 'statin'] },
]

const text = (zh: string, en: string) => ({ zh, en })

export function buildRiskInputs(profile: CdssPatientProfile, autofill: Autofill, manual: CalcValues, vitals?: ClinicVitals, visit: RiskVisitAnswers = {}): RiskInputs {
  const values: CalcValues = {}
  const today = profile.evaluatedAt?.slice(0, 10)
  const fields = RISK_INPUTS.map(({ input, usedBy }): RiskField => {
    const key = input.key
    const resolved = resolveInput(input, autofill)
    const isManual = Object.hasOwn(manual, key)
    let value = isManual ? manual[key]! : resolved.unconvertible ? '' : resolved.value
    let unitError = resolved.unconvertible && !isManual
    let date: string | undefined = isManual ? today : resolved.date || undefined
    let origin: RiskFieldOrigin = isManual ? 'physician' : resolved.filled ? 'record' : 'none'
    let detail: RiskField['detail'] = !isManual && resolved.filled && resolved.source?.testName ? text(`病歷：${resolved.source.testName}`, `Record: ${resolved.source.testName}`) : undefined
    const facts = profile.facts

    // Positive diagnosis codes, read by the FHIR adapter, lock the answer.
    const codeFact = key === 'cvd' ? (facts.ascvdDiagnosis ?? facts.heartFailureDiagnosis)
      : key === 'dm' ? DIABETES_CODE_FACT_KEYS.map((factKey) => facts[factKey]).find(Boolean)
      : undefined
    const positive = Boolean(codeFact)
      || (key === 'eskd' && profile.kidneyReplacementTherapy?.state === 'confirmed')
      || (key === 'subclinical' && (facts.LVEF?.numericValue ?? 100) < 40)
    if (positive) {
      value = 'yes'
      origin = codeFact ? 'icd' : 'record'
      detail = codeFact ? text(`ICD：${codeFact.zh}`, `ICD: ${codeFact.en}`)
        : key === 'eskd' ? text('病歷：腎臟替代治療', 'Record: kidney replacement therapy')
        : text(`病歷：LVEF ${facts.LVEF?.numericValue}%`, `Record: LVEF ${facts.LVEF?.numericValue}%`)
      date = codeFact?.date ?? facts.LVEF?.date ?? date
    }
    // The host's rules: inferences from prescriptions and codes, prefilled but
    // the clinician's to confirm (owner: 「RULE 判斷的結果再讓使用者確認」).
    if (!isManual && !positive && key === 'dm') {
      const therapy = facts.diabetesGlucoseLoweringTherapy
      const select = autofill.clinicalSelects?.diabetes
      if (therapy) { value = 'yes'; origin = 'rule'; date = therapy.date; detail = text(`規則：${therapy.zh}`, `Rule: ${therapy.en}`) }
      else if (select?.value === 'yes') { value = 'yes'; origin = 'rule'; date = select.date; detail = text(`規則：${select.testName}`, `Rule: ${select.testName}`) }
    }
    if (!isManual && key === 'statin' && profile.medicationClassContexts?.statin) {
      const statin = profile.medicationClassContexts.statin
      value = statin.state === 'confirmed-current' ? 'yes' : statin.state === 'not-found' ? 'no' : ''
      origin = value ? 'rule' : 'none'
      date = statin.lastPrescriptionDate
      detail = value ? text(value === 'yes' ? '規則：statin 處方供藥中' : '規則：近期無 statin 處方', value === 'yes' ? 'Rule: a statin is currently supplied' : 'Rule: no recent statin prescription') : undefined
    }
    if (!isManual && key === 'bptreat' && autofill.clinicalSelects?.antihypertensives?.value === 'yes') {
      const select = autofill.clinicalSelects.antihypertensives
      value = 'yes'; origin = 'rule'; date = select.date; detail = text(`規則：${select.testName}`, `Rule: ${select.testName}`)
    }
    // Known hypertension (HPA's 「已知高血壓」): a code, or treatment under way.
    if (!isManual && key === 'hbp') {
      const code = facts.hypertensionDiagnosis
      if (code) { value = 'yes'; origin = 'icd'; date = code.date; detail = text(`ICD：${code.zh}`, `ICD: ${code.en}`) }
      else if (autofill.clinicalSelects?.antihypertensives?.value === 'yes') { value = 'yes'; origin = 'rule'; date = autofill.clinicalSelects.antihypertensives.date; detail = text('規則：降血壓藥供藥中', 'Rule: an antihypertensive is currently supplied') }
    }
    // PCE publishes White and African American equations only; the guideline
    // reads other groups, Taiwanese patients included, with the White ones.
    if (!isManual && key === 'race' && !value) {
      value = 'other'; origin = 'rule'; detail = text('規則：台灣病人預設其他族裔，以白人係數估算（2013 ACC/AHA）', 'Rule: Taiwanese patients default to 「other」, read with the White equations (2013 ACC/AHA)')
    }
    // The smoking answer HTN DP-08 asks (Taiwan 2022 Figure 4) fills the same
    // question here, so the clinician answers once; their own entry still wins.
    if (!isManual && key === 'smoking' && visit.smokingCurrent) {
      value = visit.smokingCurrent; origin = 'visit'; date = today; detail = text('問診：DP-08 目前吸菸', 'Asked: DP-08 current smoking')
    }
    // The chart's own BMI and eGFR facts outrank a lab line.
    const clinicKey = key === 'bmi' ? 'bodyMassIndex' : key === 'egfr' ? 'eGFR' : undefined
    const clinic = clinicKey ? facts[clinicKey] : undefined
    if (!isManual && clinic?.numericValue !== undefined && (key !== 'egfr' || convertToBase(clinic.numericValue, clinic.unit, 'egfr'))) {
      value = String(clinic.numericValue); date = clinic.date; origin = 'record'; unitError = false; detail = undefined
    }
    // Measured in the room today: outranks the chart.
    const vitalKey = key === 'sbp' ? 'systolic' : key === 'height' ? 'bodyHeight' : key === 'weight' ? 'bodyWeight' : undefined
    const measured = vitalKey ? vitals?.entries?.[vitalKey] : undefined
    if (!isManual && measured) {
      value = String(measured.value); date = measured.measuredOn; origin = 'clinic'; unitError = false; detail = text('門診今日量測', 'Measured in clinic today')
    }
    values[key] = value
    const days = date && profile.evaluatedAt ? Math.floor((Date.parse(profile.evaluatedAt) - Date.parse(date)) / 86400000) : undefined
    const source: RiskFieldSource = origin === 'physician' ? 'physician' : origin === 'none' ? 'none' : 'record'
    return { input, value, ...(date ? { date } : {}), source, origin, ...(detail ? { detail } : {}), locked: positive, unitError, ...(days !== undefined && Number.isFinite(days) ? { ageDays: days } : {}), usedBy }
  })
  return { values, fields }
}

/** The shared values under the HPA form's keys. */
export function hpaValuesOf(shared: RiskInputs): CalcValues {
  const values: CalcValues = {}
  for (const input of HPA_INPUTS) {
    const sharedKey = SHARED_KEY_FROM_HPA[input.key] ?? input.key
    values[input.key] = shared.values[sharedKey] ?? ''
  }
  return values
}

/** The shared field a form key reads, by the form's own key (HPA's `gender` is the shared `sex`). */
export function sharedFieldFor(shared: RiskInputs, formKey: string): RiskField | undefined {
  const key = SHARED_KEY_FROM_HPA[formKey] ?? formKey
  return shared.fields.find((field) => field.input.key === key)
}
