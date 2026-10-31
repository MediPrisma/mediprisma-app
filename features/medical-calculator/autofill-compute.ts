// Shared "seed from autofill → compute" logic. This is the SINGLE source of
// truth for turning one calculator input + the patient's data into a seeded
// value (with unit conversion). Both the detail view (CalculatorDetail.seed)
// and the list (computeAutofilledResult, for the inline card result) resolve
// inputs through `resolveInput` here, so the two can never drift.

import type { CalcInput, CalcResult, CalculatorDef, AutofillSource } from './types'
import type { Autofill } from './hooks/use-lab-autofill.hook'
import { convertToBase, normUnit } from './units'

export function formatNum(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/** Everything a caller might need about one seeded input. The list uses only
 *  `value` + `date`; the detail view additionally uses the unit/conversion
 *  fields to render its auto-fill badges. */
export interface ResolvedInput {
  /** Seeded string value for the field (already unit-converted). */
  value: string
  /** effectiveDateTime of the source observation, '' when not from patient data. */
  date: string
  /** True when this came from patient data (not a default / left empty). */
  filled: boolean
  /** Unit the source observation reported the value in. */
  sourceUnit: string
  /** Unit to DISPLAY: the expected unit when a numeric conversion happened,
   *  otherwise the source unit (so equivalent-unit fills show the chart's unit). */
  displayUnit: string
  /** True when the value was numerically converted into the expected unit. */
  changed: boolean
  /** The original (pre-conversion) source value, for the "from X" hint. */
  origValue: number
  /** True when the source unit differs and could NOT be converted → real ⚠. */
  unconvertible: boolean
  /** Source-report provenance for the "來源" line (only set when filled). */
  source?: { testName?: string; loinc?: string; facility?: string; obsId?: string; resourceType?: 'Condition' | 'Encounter' | 'Observation' | 'DiagnosticReport' | 'MedicationRequest' | 'MedicationStatement' }
}

const EMPTY: ResolvedInput = {
  value: '', date: '', filled: false, sourceUnit: '', displayUnit: '', changed: false, origValue: 0, unconvertible: false,
}

/** Resolve one input against the patient's data. Single source of truth for
 *  both seeding logics. */
export function resolveInput(input: CalcInput, autofill: Autofill): ResolvedInput {
  if (input.type === 'select') {
    // Sex from patient demographics counts as data-backed (filled) so a
    // sex-dependent formula can still be shown inline; a manual/clinical select
    // stays unfilled (its default is not "from the patient").
    if (input.source?.kind === 'hfpefClinical') {
      const hit = autofill.clinicalSelects?.[input.source.key]
      if (hit && input.options.some(option => option.value === hit.value)) return {
        ...EMPTY, value: hit.value, filled: true, date: hit.date,
        source: { testName: hit.testName, facility: hit.facility, obsId: hit.obsId, resourceType: hit.resourceType },
      }
    }
    if (input.source?.kind === 'sex' && autofill.sex) return { ...EMPTY, value: autofill.sex, filled: true }
    return { ...EMPTY, value: input.defaultValue ?? input.options[0]?.value ?? '' }
  }
  if (input.type !== 'number') return { ...EMPTY, value: input.defaultValue ?? '' }
  const expected = input.unit ?? ''
  const hit = autofill.resolve(input.source)
  if (!hit) return { ...EMPTY, value: input.defaultValue ?? '', displayUnit: expected }

  // Safety gate: a value matched only by display name (viaLoinc === false) whose
  // unit is incompatible with the input's expected dimension is probably a
  // different analyte — don't autofill it. LOINC-matched values (trusted
  // identity) are never rejected here; a genuine unit mismatch there still
  // surfaces as the ⚠ badge below.
  if (hit.viaLoinc === false && input.dimension && hit.unit) {
    const compatible = convertToBase(hit.value, hit.unit, input.dimension) != null
    const sameUnit = normUnit(hit.unit) === normUnit(expected)
    if (!compatible && !sameUnit) {
      return { ...EMPTY, value: input.defaultValue ?? '', displayUnit: expected }
    }
  }

  // Preserve HFpEF threshold precision (e.g. RWT 0.424 must not become 0.42).
  const formatted = input.source && ['echo', 'bmi', 'natriuretic'].includes(input.source.kind) ? String(hit.value) : formatNum(hit.value)
  const prov = { testName: hit.testName, loinc: hit.loinc, facility: hit.facility, obsId: hit.obsId, resourceType: hit.resourceType }
  const conv = convertToBase(hit.value, hit.unit, input.dimension)
  if (conv && conv.changed) {
    // Genuine numeric conversion — the box now holds an expected-unit value.
    return { value: formatNum(conv.value), date: hit.date, filled: true, sourceUnit: hit.unit, displayUnit: expected, changed: true, origValue: hit.value, unconvertible: false, source: prov }
  }
  if (conv) {
    // Equivalent unit (factor 1) — keep the source value AND show the source
    // unit, since that's what the chart actually reported.
    return { value: formatted, date: hit.date, filled: true, sourceUnit: hit.unit, displayUnit: hit.unit || expected, changed: false, origValue: hit.value, unconvertible: false, source: prov }
  }
  // No conversion rule — keep the raw value and show its real unit; flag it
  // only when the units genuinely differ (never cry wolf on a unitless input
  // or a unit that matches the expected one).
  const sameUnit = normUnit(hit.unit) === normUnit(expected)
  return {
    value: formatted, date: hit.date, filled: true, sourceUnit: hit.unit, displayUnit: hit.unit || expected,
    changed: false, origValue: hit.value, unconvertible: !sameUnit && !!hit.unit && !!input.unit, source: prov,
  }
}

/** Resolve a single input to its seeded string value only. */
export function resolveValue(input: CalcInput, autofill: Autofill): string {
  return resolveInput(input, autofill).value
}

const DATA_SOURCE_KINDS: AutofillSource['kind'][] = ['echo', 'bmi', 'natriuretic', 'lab', 'labSpecimen', 'labLoinc', 'vital', 'age', 'sex']

/**
 * True only when EVERY required input is backed by patient data (a lab/vital/
 * demographic source) — i.e. no clinical-judgment select or manual-entry number.
 * These are the calculators whose result can be trusted inline on the card
 * without the clinician confirming anything. A clinical yes/no select (dialysis,
 * comorbidity) or a manual number (SBP, PT) makes a calculator NOT eligible, so
 * we never show an under-/over-estimate built from default values.
 */
export function isFullyAutofillable(calc: CalculatorDef): boolean {
  return calc.inputs.every((inp) => {
    if (inp.optional) return true
    return !!inp.source && DATA_SOURCE_KINDS.includes(inp.source.kind)
  })
}

export interface AutofilledResult {
  result: CalcResult
  /** ISO date of the OLDEST data-backed input the result depends on — the
   *  staleness signal for a glanceable inline card (e.g. an eGFR built off a
   *  year-old creatinine shouldn't look as fresh as one from today). Null
   *  when every input is dateless (age/sex only — effectively always current). */
  asOf: string | null
}

/** Compute a calculator's result purely from autofilled data, or null when it
 *  isn't fully data-driven, the required data is missing, or `compute` throws
 *  (a defensive guard — one bad formula must not break the whole list). */
export function computeAutofilledResult(calc: CalculatorDef, autofill: Autofill): AutofilledResult | null {
  if (!isFullyAutofillable(calc)) return null
  try {
    const values: Record<string, string> = {}
    let asOf: string | null = null
    for (const inp of calc.inputs) {
      const resolved = resolveInput(inp, autofill)
      values[inp.key] = resolved.value
      if (resolved.date && (asOf === null || resolved.date < asOf)) asOf = resolved.date
      // Every non-optional input that has a data source must have ACTUALLY
      // resolved from the patient. If a sourced field fell back to its default
      // (e.g. FiO₂ 21%, or sex when the patient's sex is unknown), the inline
      // card would look auto-computed while resting on an assumption — suppress.
      const isOptional = !!inp.optional
      if (inp.source && !isOptional && !resolved.filled) return null
    }
    const result = calc.compute(values)
    return result ? { result, asOf } : null
  } catch (err) {
    console.error(`[medical-calculator] compute() threw for "${calc.id}":`, err)
    return null
  }
}

export interface Readiness {
  /** Non-optional inputs that draw on patient data (lab/vital/age/sex). */
  sourced: number
  /** …of those, how many actually resolved from the patient. */
  filled: number
  /** Every data-backed input is present — the clinician only needs to add any
   *  manual / clinical-judgment fields (if any). */
  ready: boolean
  /** Fully data-driven AND all present → an inline result is shown. */
  computable: boolean
}

// Lab/vital sources only — the data a patient may actually lack. Age/sex are
// demographics (always available, and `sex` never reports `filled`), so they
// don't gate how "ready" a calculator is for the loaded patient.
const LAB_VITAL_KINDS: AutofillSource['kind'][] = ['echo', 'bmi', 'natriuretic', 'lab', 'labSpecimen', 'labLoinc', 'vital']

/** How "ready to use for THIS patient" a calculator is, from the loaded data. */
export function calcReadiness(calc: CalculatorDef, autofill: Autofill): Readiness {
  let sourced = 0
  let filled = 0
  for (const inp of calc.inputs) {
    const isData = !!inp.source && LAB_VITAL_KINDS.includes(inp.source.kind)
    if (!isData) continue
    if (inp.optional) continue
    sourced += 1
    if (resolveInput(inp, autofill).filled) filled += 1
  }
  return {
    sourced,
    filled,
    ready: sourced > 0 && filled === sourced,
    computable: computeAutofilledResult(calc, autofill) != null,
  }
}

/** Relevance score for the "for this patient" view: fully-computable calculators
 *  rank highest, then data-complete ones, then everything else (score 0, hidden
 *  from that view). Higher `filled` breaks ties so richer matches float up. */
export function relevanceScore(calc: CalculatorDef, autofill: Autofill): number {
  const r = calcReadiness(calc, autofill)
  if (r.computable) return 2000 + r.filled
  if (r.ready) return 1000 + r.filled
  return 0
}
