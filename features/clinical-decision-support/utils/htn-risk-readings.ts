/**
 * The hypertension page's baseline-risk calculators, run by the host and
 * handed to the pack as facts (plan 05 §19; owner decisions 2026-11-03:
 * R1 (c) — PREVENT's ASCVD endpoint is shown with its endpoint named until the
 * total-CVD coefficients arrive; R2 (a) — the HPA MACE reconstruction is shown
 * with its level, never a gate; and the 2013 ACC/AHA Pooled Cohort Equations
 * beside them as a reference, 「其他族裔」 read with the White equations). All
 * three read the shared inputs (`buildRiskInputs`, carried on the PREVENT
 * reading as `shared`). Every formula stays in medical-calculator; this file
 * only resolves inputs and writes results in the shape the pack's
 * `readHypertensionRiskResult` accepts: a completed calculator result with its
 * id, version, ten-year horizon, endpoint and inputs, evaluated at the
 * profile's own instant.
 */
import { HPA_RISK } from '@/features/medical-calculator/calculators/hpa-risk'
import { calculateHpaRisks, HPA_RECONSTRUCTION_VERSION, type HpaRiskResult } from '@/features/medical-calculator/hpa-risk-model'
import { PREVENT_VERSION } from '@/features/medical-calculator/calculators/prevent'
import { calculatePce, PCE_INPUTS, PCE_VERSION, type PceResult } from '@/features/medical-calculator/calculators/pce'
import type { Autofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import type { CalcValues } from '@/features/medical-calculator/types'
import type { CdssPatientProfile } from '../types'
import type { ClinicVitals } from '../stores/clinic-vitals.store'
import type { PreventReading } from './prevent-reading'
import { hpaValuesOf, sharedFieldFor, type RiskField, type RiskFieldSource } from './risk-inputs'

type Facts = CdssPatientProfile['facts']
type Fact = Facts[string]
type CalculatorInput = NonNullable<NonNullable<Fact['calculator']>['inputs']>[number]

/** The pack's fact keys (`HTN_RISK_MODELS`: `prevent-ascvd`, `pce-ascvd`, `hpa-mace-reconstructed`). */
export const HTN_PREVENT_ASCVD_FACT = 'preventAscvdRisk10y'
export const HTN_PCE_ASCVD_FACT = 'pceAscvdRisk10y'
export const HTN_HPA_MACE_FACT = 'hpaMaceRisk10y'
/** The 計算機 list's entries these results stand beside (`HF_VISIT_CALCULATORS`). */
export const HTN_PREVENT_CALCULATOR_ENTRY = 'prevent-ascvd'
export const HTN_PCE_CALCULATOR_ENTRY = 'pce-ascvd'
export const HTN_HPA_CALCULATOR_ENTRY = 'hpa-mace'
/** The host's own assessment of an estimate (status and what blocks it), beside the value fact. */
export const HTN_HPA_ASSESSMENT_FACT = 'hpaMaceAssessment'
export const HTN_PCE_ASSESSMENT_FACT = 'pceAssessment'

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

export interface HpaField {
  key: string
  label: { zh: string; en: string }
  value: string
  unit?: string
  date?: string
  source: RiskFieldSource
}
export interface HpaReading {
  values: CalcValues
  fields: HpaField[]
  /** The MACE outcome of the five; the pack reads only this one. */
  mace: HpaRiskResult | undefined
}

/**
 * The HPA form read off the shared inputs: its history fields are the PREVENT
 * answers (one answer for every calculator), its anthropometrics and labs the
 * shared fields under its own keys. `autofill` and `vitals` are already in the
 * shared reading; they stay in the signature for the callers that pass them.
 */
export function buildHpaReading(_profile: CdssPatientProfile, _autofill: Autofill, prevent: PreventReading | undefined, vitals?: ClinicVitals): HpaReading {
  if (!prevent) return { values: {}, fields: [], mace: undefined }
  const values = hpaValuesOf(prevent.shared)
  const fields = HPA_RISK[0]!.inputs.map((input): HpaField => {
    const key = input.key
    const field = sharedFieldFor(prevent.shared, key)
    let value = values[key] ?? ''
    let date = field?.date
    let source: RiskFieldSource = field?.source ?? 'none'
    // Height and weight measured in the room today outrank the chart's, where
    // the caller hands them separately from the shared reading.
    const vitalKey = key === 'height' ? 'bodyHeight' : key === 'weight' ? 'bodyWeight' : undefined
    const measured = vitalKey ? vitals?.entries?.[vitalKey] : undefined
    if (measured && field?.source !== 'physician') {
      value = String(measured.value)
      date = measured.measuredOn
      source = 'record'
      values[key] = value
    }
    return {
      key,
      // The HPA form's own words for its items (「既往冠心病或中風」, not PREVENT's wider 「既有心血管疾病」).
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

export interface PceReading {
  values: CalcValues
  fields: RiskField[]
  result: PceResult
}

/** The Pooled Cohort Equations read off the shared inputs. */
export function buildPceReading(prevent: PreventReading | undefined): PceReading | undefined {
  if (!prevent) return undefined
  const fields = PCE_INPUTS.map((input) => prevent.shared.fields.find((field) => field.input.key === input.key)!)
  const values: CalcValues = Object.fromEntries(fields.map((field) => [field.input.key, field.value]))
  return { values, fields, result: calculatePce(values) }
}

function calculatorInputs(fields: readonly { key: string; label: { zh: string }; value: string; unit?: string; date?: string; source: RiskFieldSource }[]): CalculatorInput[] {
  return fields.filter((field) => field.value).map((field) => ({
    key: field.key,
    label: field.label.zh,
    value: field.value,
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.date ? { date: field.date } : {}),
    source: field.source,
  }))
}

function riskFieldInputs(fields: readonly RiskField[]): CalculatorInput[] {
  return calculatorInputs(fields.map((field) => ({
    key: field.input.key,
    label: field.input.label,
    value: field.value,
    ...(field.input.type === 'number' && field.input.unit ? { unit: field.input.unit } : {}),
    ...(field.date ? { date: field.date } : {}),
    source: field.source,
  })))
}

/**
 * Writes the results as facts, clearing the previous ones first so a changed
 * input can never leave an old estimate behind. The pack's reader rejects a
 * result not evaluated within a day of the profile, so each carries the
 * profile's own instant.
 */
export function applyHtnRiskReadings(profile: CdssPatientProfile, prevent?: PreventReading, hpa?: HpaReading, pce?: PceReading): CdssPatientProfile {
  const facts: Record<string, Fact> = { ...profile.facts }
  for (const key of [HTN_PREVENT_ASCVD_FACT, HTN_PCE_ASCVD_FACT, HTN_HPA_MACE_FACT, HTN_HPA_ASSESSMENT_FACT, HTN_PCE_ASSESSMENT_FACT]) delete facts[key]
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
  if (pce) {
    facts[HTN_PCE_ASSESSMENT_FACT] = {
      zh: pce.result.status,
      en: pce.result.status,
      textEvidence: { direction: 'unknown', matchedTerms: [pce.result.status, ...pce.result.issues] },
    }
  }
  if (prevent?.result.status === 'ready' && prevent.result.risk10 !== undefined) {
    const value = prevent.result.risk10
    facts[HTN_PREVENT_ASCVD_FACT] = {
      zh: `${value.toFixed(1)}%`,
      en: `${value.toFixed(1)}%`,
      numericValue: value,
      unit: '%',
      date: day,
      calculator: { id: 'prevent-ascvd', version: PREVENT_VERSION, status: 'complete', evaluatedAt: at, horizonYears: 10, endpoint: 'ascvd', inputs: riskFieldInputs(prevent.fields) },
      // The pack reads the AHA 7.5% one-sidedly from it (plan 05 §19.3 追加 5).
      textEvidence: { direction: 'unknown', matchedTerms: [`calculator:prevent-ascvd@${PREVENT_VERSION}`, 'endpoint:ascvd'] },
    }
  }
  if (pce?.result.status === 'ready' && pce.result.risk10 !== undefined) {
    const value = pce.result.risk10
    facts[HTN_PCE_ASCVD_FACT] = {
      zh: `${value.toFixed(1)}%`,
      en: `${value.toFixed(1)}%`,
      numericValue: value,
      unit: '%',
      date: day,
      calculator: { id: 'pce-ascvd', version: PCE_VERSION, status: 'complete', evaluatedAt: at, horizonYears: 10, endpoint: 'ascvd', inputs: riskFieldInputs(pce.fields) },
      // Shown only: the pack's row for it has no threshold.
      textEvidence: { direction: 'unknown', matchedTerms: [`calculator:pce-ascvd@${PCE_VERSION}`, 'endpoint:ascvd', `equations:${pce.result.equations ?? 'white'}`] },
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
      // high); the pack prints it beside the value, and reads 「high」 as its
      // operational trigger for the SBP <120 choice at DP-09 (owner 2026-11-03).
      textEvidence: { direction: 'unknown', matchedTerms: [`level:${mace.level}`, ...(mace.nearBoundary ? ['near-boundary'] : [])] },
    }
  }
  return { ...profile, facts }
}

const LEVEL_ZH: Readonly<Record<string, string>> = { low: '低', moderate: '中', high: '高' }

function toFill(assessment: Fact | undefined): HostCalculatorState {
  return { status: 'to-fill', value: String(Math.max(0, (assessment?.textEvidence?.matchedTerms.length ?? 1) - 1)) }
}

/**
 * The 計算機 list's status column for the three calculators, by entry id, read
 * off the facts the host wrote: the figure where there is one, otherwise the
 * assessment facts (`preventAssessment`, `pceAssessment`, `hpaMaceAssessment`)
 * say whether inputs are missing or the model does not apply. Absent where
 * the host has not read the patient at all.
 */
export function htnCalculatorValues(facts: Facts | undefined, isEnglish: boolean): Readonly<Record<string, HostCalculatorState>> | undefined {
  const out: Record<string, HostCalculatorState> = {}
  const prevent = facts?.[HTN_PREVENT_ASCVD_FACT]
  const preventAssessment = facts?.preventAssessment
  if (prevent?.numericValue !== undefined) out[HTN_PREVENT_CALCULATOR_ENTRY] = { status: 'computed', value: `${prevent.numericValue.toFixed(1)}%` }
  else if (preventAssessment?.zh === 'ineligible') out[HTN_PREVENT_CALCULATOR_ENTRY] = { status: 'inapplicable' }
  else if (preventAssessment?.zh === 'needs-data') out[HTN_PREVENT_CALCULATOR_ENTRY] = toFill(preventAssessment)
  const pce = facts?.[HTN_PCE_ASCVD_FACT]
  const pceAssessment = facts?.[HTN_PCE_ASSESSMENT_FACT]
  if (pce?.numericValue !== undefined) out[HTN_PCE_CALCULATOR_ENTRY] = { status: 'computed', value: `${pce.numericValue.toFixed(1)}%` }
  else if (pceAssessment?.zh === 'ineligible') out[HTN_PCE_CALCULATOR_ENTRY] = { status: 'inapplicable' }
  else if (pceAssessment?.zh === 'needs-data') out[HTN_PCE_CALCULATOR_ENTRY] = toFill(pceAssessment)
  const mace = facts?.[HTN_HPA_MACE_FACT]
  const maceAssessment = facts?.[HTN_HPA_ASSESSMENT_FACT]
  if (mace?.numericValue !== undefined) {
    const level = mace.textEvidence?.matchedTerms.find((term) => term.startsWith('level:'))?.slice('level:'.length)
    out[HTN_HPA_CALCULATOR_ENTRY] = { status: 'computed', value: `${mace.numericValue}%${level ? (isEnglish ? ` ${level}` : `（${LEVEL_ZH[level] ?? level}）`) : ''}` }
  } else if (maceAssessment?.zh === 'outside' || maceAssessment?.zh === 'existing') out[HTN_HPA_CALCULATOR_ENTRY] = { status: 'inapplicable' }
  else if (maceAssessment?.zh === 'missing') out[HTN_HPA_CALCULATOR_ENTRY] = toFill(maceAssessment)
  return Object.keys(out).length ? out : undefined
}
