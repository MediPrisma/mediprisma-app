// Public fallback retained from medical-note-smart-on-fhir at 80c3a767c^
// (before the shared utilities moved to the private package).
// Interpretation Helper Functions (audit C3 — shared by clinical-summary
// reports and ips-export's inference engine)
//
// POLICY (2026-07-10, per user directive): the SOURCE's Observation.interpretation
// is the single authority for "is this result abnormal". The app must NOT run
// its own range math to override or supplement an explicit interpretation.
// 健康存摺 and most EHRs often ship N / H / L / …, but some institutions omit it.
// Many hospitals also send unreliable referenceRange TEXT (duplicated
// "[lo ~ hi][lo ~ hi]" brackets, sex / age / specimen-conditional prose).
// App-side re-judging produced false red flags on perfectly normal reports.
// Rules:
//   1. interpretation present  → it decides; no range math runs.
//   2. interpretation absent    → audited referenceRange.low/high, or a simple
//      parseable text range only (e.g. "0~41", "<5", ">5").
//   3. Unsafe ranges            → ignored (low > high, repeated bracket text,
//      multi-band/prose ranges).

interface CodeableConcept {
  coding?: Array<{ code?: string; display?: string }>
  text?: string
}

// FHIR `Observation.interpretation` has cardinality 0..* — it is an ARRAY of
// CodeableConcept. The bridge / FhirMapper pass it through verbatim, so at
// runtime callers hand us the raw array; some entity code paths hand us a single
// CodeableConcept. Normalise to the first concept either way. (Reading the array
// as if it were a single concept — `arr.coding` — silently yields undefined,
// which is exactly the bug that made every interpretation code get ignored.)
function firstConcept(
  interp: CodeableConcept | CodeableConcept[] | undefined,
): CodeableConcept | undefined {
  if (!interp) return undefined
  return Array.isArray(interp) ? interp[0] : interp
}

export interface ReferenceRangeBounds {
  low?: number
  high?: number
  lowInclusive?: boolean
  highInclusive?: boolean
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function auditReferenceBounds(bounds: ReferenceRangeBounds | null): ReferenceRangeBounds | null {
  if (!bounds) return null
  const low = finiteNumber(bounds.low)
  const high = finiteNumber(bounds.high)
  if (low === undefined && high === undefined) return null
  // Basic data-quality audit: a range like "41~0" or structured low=41/high=0
  // is invalid. Do NOT swap it; ignoring the range is safer than colouring
  // every row red.
  if (low !== undefined && high !== undefined && low > high) return null
  return {
    ...(low !== undefined
      ? { low, lowInclusive: bounds.lowInclusive ?? true }
      : {}),
    ...(high !== undefined
      ? { high, highInclusive: bounds.highInclusive ?? true }
      : {}),
  }
}

function normalizeRangeText(text: string): string {
  return text
    .trim()
    .replace(/[＜﹤]/g, '<')
    .replace(/[＞﹥]/g, '>')
    .replace(/[≤≦]/g, '<=')
    .replace(/[≥≧]/g, '>=')
    .replace(/[－—–]/g, '-')
}

const NUM = '[-+]?\\d+(?:\\.\\d+)?'

function referenceRangeHasPotentialBounds(rr: any): boolean {
  if (!rr) return false
  if (finiteNumber(rr.low?.value) !== undefined || finiteNumber(rr.high?.value) !== undefined) return true
  const text = typeof rr.text === 'string' ? rr.text : ''
  // Avoid warning on true "no range" placeholders like "[.]" or qualitative
  // text like "[Negative]". The badge is for ranges that look numeric but are
  // too complex/dirty to assess.
  return /[0-9]/.test(text)
}

/**
 * Safely parse only simple referenceRange.text forms:
 *   "0~41", "8-31", "<5", "≤5", ">40", "[0][41]".
 * Complex or repeated forms return null instead of guessing.
 */
export function parseSimpleReferenceRangeText(text?: string): ReferenceRangeBounds | null {
  if (!text) return null
  const raw = normalizeRangeText(text)
  if (!raw) return null

  // Old bridge garbage: "[4180 ~ 9380][4180 ~ 9380]". It contains two bracket
  // groups that are themselves ranges, so it must not be treated as [low][high].
  const bracketGroups = raw.match(/\[[^\]]*\]/g)
  if (bracketGroups && bracketGroups.length > 1) {
    const pair = raw.match(new RegExp(`^\\[\\s*(${NUM})\\s*\\]\\s*\\[\\s*(${NUM})\\s*\\]$`))
    if (pair) {
      return auditReferenceBounds({ low: Number(pair[1]), high: Number(pair[2]) })
    }
    const upperOnly = raw.match(new RegExp(`^\\[\\s*\\]\\s*\\[\\s*(${NUM})\\s*\\]$`))
    if (upperOnly) return auditReferenceBounds({ high: Number(upperOnly[1]) })
    const lowerOnly = raw.match(new RegExp(`^\\[\\s*(${NUM})\\s*\\]\\s*\\[\\s*\\]$`))
    if (lowerOnly) return auditReferenceBounds({ low: Number(lowerOnly[1]) })
    return null
  }

  const unwrapped = raw.replace(/^\[\s*([\s\S]*?)\s*\]$/, '$1').trim()

  const cmp = unwrapped.match(new RegExp(`^(<=|=<|<|>=|=>|>)\\s*(${NUM})$`))
  if (cmp) {
    const n = Number(cmp[2])
    const inclusive = cmp[1].includes('=')
    return auditReferenceBounds(cmp[1].includes('<')
      ? { high: n, highInclusive: inclusive }
      : { low: n, lowInclusive: inclusive })
  }

  const range = unwrapped.match(new RegExp(`^(${NUM})\\s*(?:~|-|TO|to|至|到)\\s*(${NUM})$`))
  if (range) {
    return auditReferenceBounds({ low: Number(range[1]), high: Number(range[2]) })
  }

  return null
}

export function getAuditedReferenceRangeBounds(referenceRange?: any[]): ReferenceRangeBounds | null {
  // Multiple ranges commonly encode age-, sex-, specimen-, or population-
  // specific bands. Selecting the first one would turn a display-order detail
  // into a clinical judgement, so only a single supplied range is eligible for
  // fallback comparison.
  if (!Array.isArray(referenceRange) || referenceRange.length !== 1) return null
  const rr = referenceRange?.[0]
  if (!rr) return null

  const structured = auditReferenceBounds({
    low: rr.low?.value,
    high: rr.high?.value,
  })
  if (structured) return structured

  return parseSimpleReferenceRangeText(rr.text)
}

function normalizeUnit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/μ/g, 'µ')
    .toLowerCase()
  return normalized || undefined
}

function quantityUnit(quantity: any): string | undefined {
  return normalizeUnit(quantity?.code || quantity?.unit)
}

function referenceRangeUnitsAreCompatible(obs: any, rr: any): boolean {
  const resultUnit = quantityUnit(obs?.valueQuantity)
  const rangeUnits = new Set(
    [quantityUnit(rr?.low), quantityUnit(rr?.high)].filter(
      (unit): unit is string => typeof unit === 'string',
    ),
  )

  if (rangeUnits.size > 1) return false
  if (rangeUnits.size === 0) return true
  if (!resultUnit) return false
  return rangeUnits.has(resultUnit)
}

export type ReferenceRangeComparison = 'high' | 'low' | 'normal'

/**
 * Conservatively compare a numeric result with one safe source range.
 *
 * Source interpretation remains authoritative. The fallback intentionally
 * abstains for multiple ranges, incompatible units, and complex text rather
 * than guessing which age/sex/specimen band applies.
 */
export function getReferenceRangeComparison(obs: any): ReferenceRangeComparison | null {
  const value = finiteNumber(obs?.valueQuantity?.value)
  if (value === undefined || getInterpretationCode(obs?.interpretation)) return null

  const ranges = obs?.referenceRange
  if (!Array.isArray(ranges) || ranges.length !== 1) return null
  const range = ranges[0]
  if (!referenceRangeUnitsAreCompatible(obs, range)) return null

  const bounds = getAuditedReferenceRangeBounds(ranges)
  if (!bounds) return null

  if (
    bounds.low !== undefined
    && (value < bounds.low || (value === bounds.low && bounds.lowInclusive === false))
  ) return 'low'
  if (
    bounds.high !== undefined
    && (value > bounds.high || (value === bounds.high && bounds.highInclusive === false))
  ) return 'high'
  return 'normal'
}

export function isReferenceRangeAssessmentUnavailable(obs: any): boolean {
  if (finiteNumber(obs?.valueQuantity?.value) === undefined) return false
  if (getInterpretationCode(obs?.interpretation)) return false
  const ranges = obs?.referenceRange
  if (!Array.isArray(ranges) || ranges.length === 0) return false
  if (!ranges.some(referenceRangeHasPotentialBounds)) return false
  if (ranges.length !== 1) return true
  if (!referenceRangeUnitsAreCompatible(obs, ranges[0])) return true
  return !getAuditedReferenceRangeBounds(ranges)
}

/**
 * Check whether a numeric observation is outside its audited FHIR reference
 * range. Used ONLY as a last-resort fallback when the source provides no
 * interpretation at all.
 */
export function checkReferenceRangeAbnormal(obs: any): boolean {
  const comparison = getReferenceRangeComparison(obs)
  return comparison === 'high' || comparison === 'low'
}

export interface InterpretationTag {
  label: string
  style: string
}

export function getInterpretationCode(concept?: CodeableConcept | CodeableConcept[]): string {
  const c = firstConcept(concept)
  const raw = c?.coding?.[0]?.code || c?.coding?.[0]?.display || c?.text || ""
  return (raw || "").toString().toUpperCase()
}

export function getInterpretationTag(concept?: CodeableConcept | CodeableConcept[]): InterpretationTag | null {
  const code = getInterpretationCode(concept)
  if (!code) return null

  let label = code
  let style = "bg-muted text-muted-foreground"

  if (["H", "HI", "HIGH", "ABOVE", ">", "HH", "CRIT-HI"].includes(code)) {
    label = code === "HH" ? "Critical High" : "High"
    style = "border border-red-200 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
  } else if (["L", "LO", "LOW", "BELOW", "<", "LL", "CRIT-LO"].includes(code)) {
    label = code === "LL" ? "Critical Low" : "Low"
    style = "border border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
  } else if (["A", "AA", "ABN", "ABNORMAL"].includes(code)) {
    label = "Abnormal"
    style = "border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
  } else if (["POS", "POSITIVE", "DETECTED", "REACTIVE"].includes(code)) {
    label = "Positive"
    style = "border border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"
  } else if (["NEG", "NEGATIVE", "NOT DETECTED", "NONREACTIVE", "NR"].includes(code)) {
    label = "Negative"
    style = "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
  } else if (["N", "NORMAL"].includes(code)) {
    label = "Normal"
    style = "border border-gray-200 bg-gray-100 text-gray-600 dark:border-border dark:bg-muted dark:text-muted-foreground"
  }

  return { label, style }
}

// Tag labels that count as "abnormal" for value colouring / abnormal counts.
// 'Normal' and 'Negative' (the desired serology outcome) are NOT abnormal. An
// UNRECOGNISED interpretation code (muted tag, raw label) is treated as NOT
// abnormal too, so an unknown code never produces a false red flag — the app
// only ever flags codes it positively recognises as abnormal.
const ABNORMAL_TAG_LABELS = new Set([
  "High", "Critical High", "Low", "Critical Low", "Abnormal", "Positive",
])

// Label-string form for callers that already carry a computed tag label
// (e.g. visit-history rows store `interpretationLabel: tag.label`).
export function isAbnormalInterpretationLabel(label?: string | null): boolean {
  return !!label && ABNORMAL_TAG_LABELS.has(label)
}

export function isInterpretationAbnormal(tag: InterpretationTag | null): boolean {
  return isAbnormalInterpretationLabel(tag?.label)
}

/**
 * Single source of truth for "should this observation be flagged abnormal".
 *   1. Source interpretation is authoritative when present (N/Normal/Negative →
 *      not abnormal; H/L/A/Positive/… → abnormal). No app-side range math runs.
 *   2. Only when there is NO interpretation at all → audited referenceRange
 *      bounds, including only simple parseable referenceRange.text forms.
 * Accepts a raw FHIR observation (interpretation array or single concept).
 */
export function isObservationAbnormal(obs: any): boolean {
  const tag = getInterpretationTag(obs?.interpretation)
  if (tag) return isInterpretationAbnormal(tag)
  return checkReferenceRangeAbnormal(obs)
}
