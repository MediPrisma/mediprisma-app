// Medical Calculator — shared types
//
// A calculator is a pure data definition: a list of inputs (each optionally
// auto-filled from the patient's FHIR data) plus a pure `compute` function.
// Keeping calculators data-driven means adding a new one is a single entry in
// calculators.ts — no new components, no wiring.

/** Bilingual label. Rendered via `tr(locale, …)` in components. */
export interface L {
  en: string
  zh: string
}

export type CalcCategory = 'renal' | 'hepatic' | 'electrolyte' | 'cardiac' | 'pulmonary' | 'gi' | 'heme' | 'neuro' | 'mental' | 'general'

/**
 * Who a calculator is appropriate for.
 *  - 'medical' (default): clinician tool — hidden in patient audience mode.
 *  - 'patient': patient self-report (e.g. GDS-15) — shown in patient mode.
 *  - 'both': appropriate for either audience (e.g. BMI).
 * Patient mode shows only 'patient' + 'both'; medical mode shows everything.
 */
export type CalcAudience = 'medical' | 'patient' | 'both'

/** MDCalc-style purpose tag shown on each calculator card. */
export type Purpose =
  | 'diagnosis'
  | 'prognosis'
  | 'formula'
  | 'treatment'
  | 'severity'
  | 'screening'
  | 'risk'

export const PURPOSE_LABELS: Record<Purpose, L> = {
  diagnosis: { en: 'Diagnosis', zh: '診斷' },
  prognosis: { en: 'Prognosis', zh: '預後' },
  formula: { en: 'Formula', zh: '公式' },
  treatment: { en: 'Treatment', zh: '治療' },
  severity: { en: 'Severity', zh: '嚴重度' },
  screening: { en: 'Screening', zh: '篩檢' },
  risk: { en: 'Risk', zh: '風險' },
}

/** Measurement family used to auto-convert an auto-filled value into the
 *  calculator's expected unit. See units.ts. */
export type ConvertDim =
  | 'egfr'
  | 'electrolyte'
  | 'creatinine'
  | 'bilirubin'
  | 'calcium'
  | 'glucose'
  | 'albumin'
  | 'enzyme'
  | 'platelets'
  | 'wbc'
  | 'bun'
  | 'cholesterol'
  | 'triglyceride'
  | 'ethanol'
  | 'weight'
  | 'height'
  | 'pressure'    // blood-gas partial pressures (mmHg ↔ kPa)
  | 'osmolality'  // mOsm/kg ↔ Osm/kg
  | 'hemoglobin'  // g/dL ↔ g/L ↔ mmol/L
  | 'fio2'        // % ↔ fraction (21% ↔ 0.21)
  | 'albumin-creatinine-ratio' // urine ACR: mg/g ↔ mg/mmol

/**
 * Where an input's initial value comes from, if any. Resolved by
 * useLabAutofill against the current patient's observations / demographics.
 *  - lab:   canonical analyte keys (from @voho0000/clinical-lab-normalization), first match wins.
 *  - vital: LOINC codes for a vital sign (weight/height live outside the
 *           canonical lab map, so they're matched by LOINC directly).
 *  - age / sex: patient demographics.
 */
/** Vital signs live outside the canonical lab map; a `vital` source is matched
 *  by LOINC first, then (fallback) by display-name for imports that omit LOINC. */
export type VitalKind = 'sbp' | 'weight' | 'height' | 'waist'

export type AutofillSource =
  | { kind: 'hfpefClinical'; key: import('./hfpef-clinical-autofill').ClinicalSelectKey }
  | { kind: 'echo'; key: import('./echo-autofill').EchoKey }
  | { kind: 'bmi' }
  | { kind: 'natriuretic'; assay: 'BNP' | 'NT-PROBNP' }
  | { kind: 'lab'; keys: string[] }
  /** `vital` optionally carries a semantic id enabling a display-name fallback
   *  (for FHIR that omits the vital's LOINC); the name match is unit-gated. */
  | { kind: 'vital'; loinc: string[]; vital?: VitalKind }
  /** Match an observation directly by LOINC code — used for analytes with no
   *  canonical key (e.g. ABG arterial codes, osmolality). */
  | { kind: 'labLoinc'; loinc: string[] }
  /** Match by canonical analyte key AND specimen (blood vs urine). Bridge
   *  populates `Observation.specimen.display` = "Blood"/"Urine" (authoritative,
   *  confirmed 2026-07-04); falls back to `loinc` when specimen is absent. Used
   *  for urine/serum paired analytes (FENa: serum vs urine Na/Cr). */
  | { kind: 'labSpecimen'; keys: string[]; loinc?: string[]; specimen: 'blood' | 'urine' }
  | { kind: 'age' }
  | { kind: 'sex' }

export interface NumberInput {
  key: string
  type: 'number'
  label: L
  /** Expected/base unit the formula assumes (also the conversion target). */
  unit?: string
  /** Measurement family for auto unit conversion of the filled value. */
  dimension?: ConvertDim
  /** Standard adult reference range, shown as the empty-field placeholder
   *  (MDCalc-style), in the expected unit. */
  normalRange?: { low: number; high: number }
  /** Value to prefill when there is no auto-fill source/hit (e.g. an assay's
   *  upper limit of normal). */
  defaultValue?: string
  source?: AutofillSource
  /** Optional — inputs are prefilled but never required to compute; the
   *  compute fn returns null until it has what it needs. */
  optional?: boolean
}

export interface SelectOption {
  value: string
  label: L
  points?: number
}

export interface SelectInput {
  key: string
  type: 'select'
  label: L
  options: SelectOption[]
  source?: AutofillSource
  defaultValue?: string
  /**
   * Asked only in some of the cases the calculator covers (one indication's
   * question): a blank stays unknown to the rules that read it, but the
   * calculator lists do not count it as one to fill.
   */
  optional?: boolean
}

/** A local date-time (「2026-11-03T08:00」) or a time of day (「20:00」), typed by hand; never auto-filled. */
export interface DateTimeInput {
  key: string
  type: 'datetime' | 'time'
  label: L
  defaultValue?: string
  optional?: boolean
  /** Never auto-filled and unitless; declared so code reading any input's source or unit still reads one. */
  source?: undefined
  unit?: undefined
}

/**
 * Shown only while it applies (one indication's question, one procedure's
 * time). A hidden input reads as blank to `compute` and to the results, so an
 * answer left in it from another case never changes this one.
 */
export type CalcInput = (NumberInput | SelectInput | DateTimeInput) & {
  visibleWhen?: (values: CalcValues) => boolean
  /** An auto-filled value older than this many days carries a small 「N 個月前」 beside its date. */
  staleAfterDays?: number
}

/** True while the input applies to the values as they stand. */
export function inputVisible(input: CalcInput, values: CalcValues): boolean {
  return !input.visibleWhen || input.visibleWhen(values)
}

/** The values with every hidden input blank: what the rules and the results read. */
export function visibleValues(inputs: CalcInput[], values: CalcValues): CalcValues {
  const hidden = inputs.filter((input) => !inputVisible(input, values))
  if (!hidden.length) return values
  return { ...values, ...Object.fromEntries(hidden.map((input) => [input.key, ''])) }
}

export type Severity = 'normal' | 'low' | 'moderate' | 'high'

export interface CalcResult {
  /** Unrounded value for downstream clinical consumers; never parse display text. */
  numericValue?: number
  completeness?: { complete: boolean; upperBound: number; missingKeys: string[] }
  /** Formatted primary value, e.g. "72" or "Class B". */
  value: string
  unit?: string
  /** Short interpretation line — the risk category / headline, e.g.
   *  "Low risk" or "CKD stage G2". */
  interpretation?: L
  severity?: Severity
  /** Secondary rows shown under the main value — use for a risk-stratification
   *  breakdown (e.g. "2-day stroke risk" → "1.0%") or derived sub-values. */
  extra?: { label: L; value: string }[]
  /** Clinical guidance / what-to-do / caveats, shown as a highlighted note
   *  under the result (MDCalc "Next Steps"-style). Keep to 1–3 sentences. */
  scoreRanges?: { range: string; meaning: L }[]
  notes?: L
}

export type CalcValues = Record<string, string>

export interface CalculatorDef {
  /** Raise when a clinical formula or missing-input rule changes. */
  version?: string
  id: string
  name: L
  category: CalcCategory
  /** Audience targeting; defaults to 'medical' (clinician-only) when omitted. */
  audience?: CalcAudience
  blurb?: L
  inputs: CalcInput[]
  /** Pure. Returns null when required inputs are missing/invalid. */
  compute: (values: CalcValues) => CalcResult | null
  /** Formula citation, shown at the bottom of the detail view. */
  reference?: string
  /** Temporal-coherence hint for multi-lab formulas: the listed input keys
   *  should come from the same draw/day. When the auto-filled source dates span
   *  more than `windowDays`, the detail view warns that the values may be from
   *  different reports (e.g. FENa mixing today's urine with last month's serum). */
  coherence?: { keys: string[]; windowDays: number }
  /** Inputs shown under headings, in this order; inputs not named go last. */
  inputGroups?: {
    key: string
    title: L
    hint?: L
    keys: string[]
    /** Folds the group to one line while nothing in it needs the reader; `open` while something does. */
    summary?: (values: CalcValues, shownKeys: string[]) => { text: L; open: boolean }
  }[]
}

export const CATEGORY_LABELS: Record<CalcCategory, L> = {
  renal: { en: 'Renal', zh: '腎臟' },
  hepatic: { en: 'Hepatic', zh: '肝膽' },
  electrolyte: { en: 'Electrolyte', zh: '電解質' },
  cardiac: { en: 'Cardiac', zh: '心臟' },
  pulmonary: { en: 'Pulmonary / Infection', zh: '肺部 / 感染' },
  gi: { en: 'Gastrointestinal', zh: '腸胃' },
  heme: { en: 'Hematology', zh: '血液' },
  neuro: { en: 'Neurology', zh: '神經' },
  mental: { en: 'Mental Health', zh: '精神 / 心理' },
  general: { en: 'General', zh: '一般' },
}

export function tr(locale: string, l: L): string {
  return locale === 'zh-TW' ? l.zh : l.en
}

/** The OTHER language's string, for bilingual display. Empty when both
 *  languages are identical (e.g. "eGFR (CKD-EPI 2021)") so it isn't repeated. */
export function trAlt(locale: string, l: L): string {
  const primary = locale === 'zh-TW' ? l.zh : l.en
  const other = locale === 'zh-TW' ? l.en : l.zh
  return other === primary ? '' : other
}
