/**
 * The hypertension page's baseline-risk calculators, run by the host and
 * handed to the pack as facts (plan 05 §19; owner decisions 2026-11-03:
 * R1 (c) — PREVENT's ASCVD endpoint is shown with its endpoint named until the
 * total-CVD coefficients arrive; R2 (a) — the HPA MACE reconstruction is shown
 * with its level, never as a gate). Every formula stays in medical-calculator;
 * this file only resolves inputs and writes results in the shape the pack's
 * `readHypertensionRiskResult` accepts: a completed calculator result with its
 * id, version, ten-year horizon, endpoint and inputs, evaluated at the
 * profile's own instant.
 */
import { HPA_RISK } from '@/features/medical-calculator/calculators/hpa-risk'
import { calculateHpaRisks, HPA_RECONSTRUCTION_VERSION, type HpaRiskResult } from '@/features/medical-calculator/hpa-risk-model'
import { PREVENT_VERSION } from '@/features/medical-calculator/calculators/prevent'
import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitals } from '../stores/clinic-vitals.store'
import type { PreventReading } from './prevent-reading'

type Facts = CdssPatientProfile['facts']
type Fact = Facts[string]
type CalculatorInput = NonNullable<NonNullable<Fact['calculator']>['inputs']>[number]

/** The pack's fact keys (`HTN_RISK_MODELS`: `prevent-ascvd`, `hpa-mace-reconstructed`). */
export const HTN_PREVENT_ASCVD_FACT = 'preventAscvdRisk10y'
export const HTN_HPA_MACE_FACT = 'hpaMaceRisk10y'
/** The 計算機 list's entries these results stand beside (`HF_VISIT_CALCULATORS`). */
export const HTN_PREVENT_CALCULATOR_ENTRY = 'prevent-ascvd'
export const HTN_HPA_CALCULATOR_ENTRY = 'hpa-mace'
/** The host's own assessment of the HPA MACE estimate (status and what blocks it), beside the value fact. */
export const HTN_HPA_ASSESSMENT_FACT = 'hpaMaceAssessment'

/**
 * Where a calculator the host runs stands for this patient, for the 計算機
 * list's status column: computed (with the figure), inputs to fill (how many),
 * or not applicable (an exclusion, an age outside the model). The row stays
 * open either way (owner 2026-11-03: 「不適用還是開放點選」).
 */
export interface HostCalculatorState {
  status: 'computed' | 'to-fill' | 'inapplicable'
  value?: string
}

type FieldSource = 'physician' | 'record' | 'none'
export interface HpaField {
  key: string
  label: { zh: string; en: string }
  value: string
  unit?: string
  date?: string
  source: FieldSource
}
export interface HpaReading {
  values: CalcValues
  fields: HpaField[]
  /** The MACE outcome of the five; the pack reads only this one. */
  mace: HpaRiskResult | undefined
}

const HPA_INPUTS = HPA_RISK[0].inputs
// HPA's history fields read the PREVENT form's answers, so the clinician
// answers once for both calculators. PREVENT's 既有心血管疾病 covers coronary
// disease, stroke, PAD and HF; HPA asks for coronary disease or stroke, and a
// yes withholds its estimate the way it makes PREVENT ineligible.
const FROM_PREVENT: Readonly<Record<string, string>> = { prior_cvd: 'cvd', smoke: 'smoking', diabetes: 'dm', hbp: 'bptreat', sbp: 'sbp' }

export function buildHpaReading(profile: CdssPatientProfile, autofill: Autofill, prevent: PreventReading | undefined, vitals?: ClinicVitals): HpaReading {
  const values: CalcValues = {}
  const fields = HPA_INPUTS.map((input): HpaField => {
    const key = input.key
    const resolved = resolveInput(input, autofill)
    let value = resolved.unconvertible ? '' : resolved.value
    let date: string | undefined = resolved.date || undefined
    let source: FieldSource = resolved.filled ? 'record' : 'none'
    const preventKey = FROM_PREVENT[key]
    const preventField = preventKey ? prevent?.fields.find((field) => field.input.key === preventKey) : undefined
    if (preventField?.value) {
      value = preventField.value
      date = preventField.date
      source = preventField.source === 'physician' ? 'physician' : 'record'
    }
    // A hypertension code is known hypertension whether or not it is treated.
    if (key === 'hbp' && !value && profile.facts.hypertensionDiagnosis) {
      value = 'yes'
      date = profile.facts.hypertensionDiagnosis.date
      source = 'record'
    }
    // Height and weight measured in the room today outrank the chart's.
    const clinicKey = key === 'height' ? 'bodyHeight' : key === 'weight' ? 'bodyWeight' : undefined
    const clinic = clinicKey ? vitals?.entries?.[clinicKey] : undefined
    if (clinic) {
      value = String(clinic.value)
      date = clinic.measuredOn
      source = 'record'
    }
    values[key] = value
    return {
      key,
      label: input.label,
      value,
      ...(input.type === 'number' && input.unit ? { unit: input.unit } : {}),
      ...(date ? { date } : {}),
      source,
    }
  })
  const mace = calculateHpaRisks(values).find((result) => result.outcome === 'mace')
  return { values, fields, mace }
}

function calculatorInputs(fields: readonly HpaField[]): CalculatorInput[] {
  return fields.filter((field) => field.value).map((field) => ({
    key: field.key,
    label: field.label.zh,
    value: field.value,
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.date ? { date: field.date } : {}),
    source: field.source,
  }))
}

/**
 * Writes the two results as facts, clearing the previous ones first so a
 * changed input can never leave an old estimate behind. The pack's reader
 * rejects a result not evaluated within a day of the profile, so both carry
 * the profile's own instant.
 */
export function applyHtnRiskReadings(profile: CdssPatientProfile, prevent?: PreventReading, hpa?: HpaReading): CdssPatientProfile {
  const facts: Record<string, Fact> = { ...profile.facts }
  delete facts[HTN_PREVENT_ASCVD_FACT]
  delete facts[HTN_HPA_MACE_FACT]
  delete facts[HTN_HPA_ASSESSMENT_FACT]
  const at = profile.evaluatedAt
  if (!at) return { ...profile, facts }
  const day = at.slice(0, 10)
  if (hpa?.mace) {
    // Status first, then the inputs that block it — the same shape as PREVENT's
    // `preventAssessment`, read by `htnCalculatorValues` for the list.
    facts[HTN_HPA_ASSESSMENT_FACT] = {
      zh: hpa.mace.status,
      en: hpa.mace.status,
      textEvidence: { direction: 'unknown', matchedTerms: [hpa.mace.status, ...(hpa.mace.missing ?? []), ...(hpa.mace.outside ?? [])] },
    }
  }
  if (prevent?.result.status === 'ready' && prevent.result.risk10 !== undefined) {
    const value = prevent.result.risk10
    const inputs: CalculatorInput[] = prevent.fields.map((field) => ({
      key: field.input.key,
      label: field.input.label.zh,
      value: field.value,
      ...(field.input.type === 'number' && field.input.unit ? { unit: field.input.unit } : {}),
      ...(field.date ? { date: field.date } : {}),
      source: field.source,
    }))
    facts[HTN_PREVENT_ASCVD_FACT] = {
      zh: `${value.toFixed(1)}%`,
      en: `${value.toFixed(1)}%`,
      numericValue: value,
      unit: '%',
      date: day,
      calculator: { id: 'prevent-ascvd', version: PREVENT_VERSION, status: 'complete', evaluatedAt: at, horizonYears: 10, endpoint: 'ascvd', inputs },
      // Shown only: the pack's row for it has no threshold (plan 05 §19.3 R1 (c)).
      textEvidence: { direction: 'unknown', matchedTerms: [`calculator:prevent-ascvd@${PREVENT_VERSION}`, 'endpoint:ascvd'] },
    }
  }
  const mace = hpa?.mace
  if (hpa && mace?.status === 'estimated' && mace.risk !== undefined && mace.level) {
    facts[HTN_HPA_MACE_FACT] = {
      zh: `${mace.risk}%`,
      en: `${mace.risk}%`,
      numericValue: mace.risk,
      unit: '%',
      date: day,
      calculator: { id: 'hpa-mace-reconstructed', version: HPA_RECONSTRUCTION_VERSION, status: 'complete', evaluatedAt: at, horizonYears: 10, endpoint: 'mace', inputs: calculatorInputs(hpa.fields) },
      // The level the official site would grade (<10 low, 10–20 moderate, ≥20
      // high); the pack prints it beside the value and reads no threshold.
      textEvidence: { direction: 'unknown', matchedTerms: [`level:${mace.level}`, ...(mace.nearBoundary ? ['near-boundary'] : [])] },
    }
  }
  return { ...profile, facts }
}

const LEVEL_ZH: Readonly<Record<string, string>> = { low: '低', moderate: '中', high: '高' }

/**
 * The 計算機 list's status column for the two calculators, by entry id, read
 * off the facts the host wrote: the figure where there is one, otherwise the
 * assessment facts (`preventAssessment`, `hpaMaceAssessment`) say whether
 * inputs are missing or the model does not apply. Absent where the host has
 * not read the patient at all.
 */
export function htnCalculatorValues(facts: Facts | undefined, isEnglish: boolean): Readonly<Record<string, HostCalculatorState>> | undefined {
  const out: Record<string, HostCalculatorState> = {}
  const prevent = facts?.[HTN_PREVENT_ASCVD_FACT]
  const preventAssessment = facts?.preventAssessment
  if (prevent?.numericValue !== undefined) out[HTN_PREVENT_CALCULATOR_ENTRY] = { status: 'computed', value: `${prevent.numericValue.toFixed(1)}%` }
  else if (preventAssessment?.zh === 'ineligible') out[HTN_PREVENT_CALCULATOR_ENTRY] = { status: 'inapplicable' }
  else if (preventAssessment?.zh === 'needs-data') out[HTN_PREVENT_CALCULATOR_ENTRY] = { status: 'to-fill', value: String(Math.max(0, (preventAssessment.textEvidence?.matchedTerms.length ?? 1) - 1)) }
  const mace = facts?.[HTN_HPA_MACE_FACT]
  const maceAssessment = facts?.[HTN_HPA_ASSESSMENT_FACT]
  if (mace?.numericValue !== undefined) {
    const level = mace.textEvidence?.matchedTerms.find((term) => term.startsWith('level:'))?.slice('level:'.length)
    out[HTN_HPA_CALCULATOR_ENTRY] = { status: 'computed', value: `${mace.numericValue}%${level ? (isEnglish ? ` ${level}` : `（${LEVEL_ZH[level] ?? level}）`) : ''}` }
  } else if (maceAssessment?.zh === 'outside' || maceAssessment?.zh === 'existing') out[HTN_HPA_CALCULATOR_ENTRY] = { status: 'inapplicable' }
  else if (maceAssessment?.zh === 'missing') out[HTN_HPA_CALCULATOR_ENTRY] = { status: 'to-fill', value: String(Math.max(0, (maceAssessment.textEvidence?.matchedTerms.length ?? 1) - 1)) }
  return Object.keys(out).length ? out : undefined
}
