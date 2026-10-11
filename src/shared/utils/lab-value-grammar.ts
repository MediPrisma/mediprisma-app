// One grammar for how a lab value and its unit are written, shared by the
// AI's value family (fhir-tools labValueFamily) and the cumulative report's
// count / percentage split (lab-pivot countFractionAwareKey), so a result's
// family never depends on whether it arrived as a Quantity, a Range or a
// number printed as text.

// "1:160", "< 1:40", "1：80 speckled"; also a FHIR valueRatio.
// One number: optional sign, digits with optional thousands separators and
// decimals, or a bare leading decimal (".5"), optional exponent ("1.2e3").
export const NUMBER_PATTERN = String.raw`[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?`
// A number or a range ("0-5", "0 ~ 5", "0 to 5"), after an optional
// comparator (<, >, ≤, ≥, <=, >=), ending where the number ends.
export const NUMERIC_TEXT_RE = new RegExp(
  String.raw`^\s*(?:<=|>=|[<>≤≥≦≧])?\s*${NUMBER_PATTERN}(?:\s*(?:-|~|\bto\b)\s*${NUMBER_PATTERN})?(?![\d.,:])`,
  'i',
)
/** NFKC folds full-width digits and ＋/－; the other dashes (− U+2212, ‒, –,
 *  —) are read as the ASCII hyphen-minus before a number, so "−3.2" and
 *  "0–5" parse while a lone "—" (no value) stays text. */
export const foldNumericText = (text: string) =>
  text.normalize('NFKC').replace(/[−‒–—](?=\s*[+-]?[\d.])/g, '-')

// The ways a percent unit is printed: "%", full-width 「％」 (NFKC folds it),
// "percent", "per cent", "pct", 「百分比」 — in any case, as a whole word.
export const PERCENT_UNIT_RE = /^(?:%|percent|per\s*cent|pct|百分比)$/i
export const PERCENT_UNIT_PREFIX_RE = /^\s*(?:%|percent|per\s*cent|pct|百分比)(?![a-z])/i

export function isPercentUnit(unit: unknown): boolean {
  return typeof unit === 'string' && PERCENT_UNIT_RE.test(unit.normalize('NFKC').trim())
}

/** A UCUM code the Quantity carries, when its system is UCUM or absent. */
function ucumCode(quantity: any): string {
  const code = typeof quantity?.code === 'string' ? quantity.code.trim() : ''
  const system = typeof quantity?.system === 'string' ? quantity.system : ''
  return code && (!system || /unitsofmeasure\.org/i.test(system)) ? code : ''
}

/** A Quantity (or Range bound) in percent. Its UCUM code decides when it has
 *  one (system UCUM or absent): code '%' is percent whatever the unit text
 *  says, and a count code ('10*3/uL') is not. Without a code, the unit text. */
export function isPercentQuantity(quantity: any): boolean {
  const code = ucumCode(quantity)
  if (code) return code === '%'
  return isPercentUnit(quantity?.unit)
}

/**
 * Count per volume: /µL, 10^3/µL, x10^9/L, /mm3, /cumm, cells/µL, K/µL, and
 * the UCUM forms (10*3/uL, {cells}/uL). Deliberately not G/L, which is also
 * grams/litre.
 */
export function isCountPerVolumeUnit(unit: string): boolean {
  const compact = unit
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, '')
    .replace(/[µμ]/g, 'u')
  const match = compact.match(/^(.*)\/(ul|mm3|mm\^3|cumm|cmm|nl|l)$/)
  if (!match) return false
  const prefix = match[1].replace(/^[x*×·]/, '').replace(/^(?:cells?|#)/, '').replace(/(?:cells?|#)$/, '')
  const power = /^10(?:\^|\*|e)?(\d{1,2})$/.exec(prefix)
  if (match[2] === 'l') return !!power && (power[1] === '9' || power[1] === '6')
  return prefix === '' || /^(?:k|thou|1000)$/.test(prefix) || (!!power && Number(power[1]) <= 6)
}

export type UnitFamily = 'count' | 'fraction'

/** A Quantity or Range bound: UCUM code first, then the unit text. */
function quantityUnitFamily(quantity: any): UnitFamily | null {
  if (!quantity) return null
  const code = ucumCode(quantity)
  if (code) {
    if (code === '%') return 'fraction'
    if (isCountPerVolumeUnit(code)) return 'count'
  }
  const unit = typeof quantity.unit === 'string' ? quantity.unit : ''
  if (isPercentUnit(unit)) return 'fraction'
  return unit && isCountPerVolumeUnit(unit) ? 'count' : null
}

/** The unit written after a number printed as text ("3,100 /uL (H)",
 *  "3.1e3/uL H", "62 pct"), read with the value family's number grammar. */
function textUnitFamily(value: string): UnitFamily | null {
  const text = foldNumericText(value)
  const numeric = text.match(NUMERIC_TEXT_RE)
  if (!numeric) return null
  const rest = text.slice(numeric[0].length)
  if (PERCENT_UNIT_PREFIX_RE.test(rest)) return 'fraction'
  const unit = rest.split(/[(（,;]/)[0].trim()
  if (!unit) return null
  if (isCountPerVolumeUnit(unit)) return 'count'
  const firstToken = unit.split(/\s+/)[0]
  return firstToken && isCountPerVolumeUnit(firstToken) ? 'count' : null
}

/**
 * Whether a result is a count per volume or a fraction (%), from its value:
 * a Quantity, either Range bound (bounds that disagree decide nothing), or a
 * number printed as text with its unit. An Integer / Decimal / Ratio, a
 * unitless value or anything else decides nothing (null).
 */
export function valueUnitFamily(observation: any): UnitFamily | null {
  const quantity = observation?.valueQuantity
  if (quantity && typeof quantity.value === 'number') return quantityUnitFamily(quantity)
  const range = observation?.valueRange
  if (range && (range.low || range.high)) {
    const families = new Set(
      [range.low, range.high].map(quantityUnitFamily).filter((family): family is UnitFamily => family !== null),
    )
    return families.size === 1 ? families.values().next().value ?? null : null
  }
  if (typeof observation?.valueString === 'string') return textUnitFamily(observation.valueString)
  return null
}
