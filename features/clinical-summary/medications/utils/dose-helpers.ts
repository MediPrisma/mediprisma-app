// Dose and Frequency Helper Functions
import type { DosageInstruction, CodeableConcept } from '@/src/shared/types/fhir.types'
import { extractFrequencyFromText } from '@/src/shared/utils/fhir-display-helpers'
import { routeDisplayText } from './route-display'

type DoseAndRate = NonNullable<DosageInstruction['doseAndRate']>[number]
type TimingRepeat = NonNullable<NonNullable<DosageInstruction['timing']>['repeat']>

function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n
}

function normalizeFormUnit(u?: string): string {
  if (!u) return ""
  const s = u.toLowerCase().trim()
  if (["tablet", "tablets", "tab", "tabs", "錠"].includes(s)) return "tab"
  if (["capsule", "capsules", "cap", "caps"].includes(s)) return "cap"
  if (["milliliter", "milliliters", "ml", "mL"].includes(s)) return "mL"
  if (["drop", "drops", "gtt"].includes(s)) return "drop"
  if (["puff", "puffs", "actuation", "spray", "sprays"].includes(s)) return "puff"
  if (["mg","g","mcg","μg","ug"].includes(s)) return s
  return u
}

export function humanDoseAmount(doseAndRate?: DoseAndRate[], text?: string): string {
  const d = doseAndRate?.[0]
  
  if (d?.doseQuantity?.value != null) {
    const v = round1(d.doseQuantity.value!)
    const u = normalizeFormUnit(d.doseQuantity.unit || "")
    return `${v}${u ? " " + u : ""}`
  }
  
  if (d?.doseRange?.low?.value != null || d?.doseRange?.high?.value != null) {
    const lo = d.doseRange.low
    const hi = d.doseRange.high
    const unit = normalizeFormUnit(lo?.unit || hi?.unit || "")
    const left = lo?.value != null ? String(round1(lo.value)) : ""
    const right = hi?.value != null ? String(round1(hi.value)) : ""
    const core = left && right ? `${left}-${right}` : (left || right)
    if (core) return `${core}${unit ? " " + unit : ""}`
  }
  
  if (text) {
    // A decimal-only matcher would read "1/2 tab" as "2 tab". Keep a
    // fractional free-text dose verbatim in the full SIG instead of inventing
    // a separate numeric dose. An explicit structured dose still wins above.
    if (/\d\s*\/\s*\d|[¼½¾⅓⅔]/.test(text)) return ''
    const m = text.match(/(\d+(?:\.\d+)?)\s*(tab(?:let)?s?|cap(?:sule)?s?|mL|ml|mg|mcg|g|drop(?:s)?|puff(?:s)?)/i)
    if (m) {
      const val = m[1]
      const unit = normalizeFormUnit(m[2])
      return `${val} ${unit}`
    }
  }
  
  return ""
}

/** `dose`, unless the instruction already starts with that same dose. A
 *  free-text SIG such as "1 tab QD" yields the dose "1 tab" and is also shown
 *  whole as the instruction (kept verbatim, see displayDosageInstruction), so
 *  joining the two read "1 tab 1 tab QD". Only an equal dose is dropped; a
 *  different leading dose ("2 tab QD" against 1 tab) is a discrepancy and both
 *  stay. The row's `dose` field itself is untouched: dose changes compare it. */
export function doseUnlessRepeated(dose?: string, instruction?: string): string | undefined {
  if (!dose) return undefined
  const match = instruction?.match(
    // The unit must end there: "5 mg/kg" or "5 mg/mL" is a per-weight dose
    // or a concentration, not the absolute dose "5 mg".
    /^\s*(\d+(?:\.\d+)?)\s*(tab(?:let)?s?|cap(?:sule)?s?|mL|ml|mg|mcg|g|drop(?:s)?|puff(?:s)?|錠)(?=$|[\s,;，、])/i,
  )
  if (!match) return dose
  const leading = `${match[1]} ${normalizeFormUnit(match[2])}`.toLowerCase()
  return leading === dose.trim().toLowerCase() ? undefined : dose
}

export function humanDoseFreq(rep?: TimingRepeat): string {
  if (!rep) return ""
  const freq = rep.frequency ?? 0
  const period = rep.period ?? 0
  const unitRaw = (rep.periodUnit || "").toLowerCase()

  const unit =
    unitRaw.startsWith("d") ? "day" :
    unitRaw.startsWith("h") ? "hour" :
    unitRaw.startsWith("wk") ? "week" :
    unitRaw.startsWith("mo") ? "month" :
    unitRaw

  if (unit === "day" && period === 1) {
    const map: Record<number, string> = { 1: "QD", 2: "BID", 3: "TID", 4: "QID" }
    const code = map[freq]
    if (code) return code
    if (freq > 0) return `${freq}×/day`
  }

  if (unit === "hour" && period > 0 && freq === 1) return `q${period}h`
  if (unit === "week" && period === 1 && freq === 1) return "QW"
  if (unit === "month" && period === 1 && freq === 1) return "QM"

  if (unit === "day" && period > 0 && freq > 0) return `${freq}× every ${period} day${period > 1 ? "s" : ""}`
  if (unit === "hour" && period > 0 && freq > 0) return `${freq}× q${period}h`
  if (unit === "week" && period > 0 && freq > 0) return `${freq}× every ${period} week${period > 1 ? "s" : ""}`
  if (unit === "month" && period > 0 && freq > 0) return `${freq}× every ${period} month${period > 1 ? "s" : ""}`

  return ""
}

function conceptValues(concept?: CodeableConcept): string[] {
  if (!concept) return []
  return [
    ...(concept.coding ?? []).flatMap((coding) => [coding.code, coding.display]),
    concept.text,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function administrationMealTiming(dosage?: DosageInstruction): 'AC' | 'PC' | '' {
  const candidates = [
    ...(dosage?.timing?.repeat?.when ?? []),
    ...(dosage?.additionalInstruction ?? []).flatMap(conceptValues),
  ]
  for (const candidate of candidates) {
    const normalized = candidate.trim().toUpperCase()
    if (/^(?:AC|BEFORE\s+MEALS?)$/.test(normalized)) return 'AC'
    if (/^(?:PC|AFTER\s+MEALS?)$/.test(normalized)) return 'PC'
  }
  return ''
}

/** Prefer an explicit source SIG code (including composite QDPC/BIDAC), then
 * derive a conventional frequency from structured FHIR repeat fields. */
export function humanDosageFrequency(dosage?: DosageInstruction): string {
  if (!dosage) return ''
  const sourceValues = [
    ...conceptValues(dosage.timing?.code),
    dosage.text,
  ]
  const explicitFrequency = sourceValues
    .map(extractFrequencyFromText)
    .find(Boolean) || ''
  const frequency = explicitFrequency || humanDoseFreq(dosage.timing?.repeat)
  const mealTiming = administrationMealTiming(dosage)
  if (mealTiming && /^(?:QD|BID|TID|QID)$/.test(frequency)) {
    return `${frequency}${mealTiming}`
  }
  if (frequency) return frequency

  // Unknown source SIG values on true prescriptions remain clinically
  // meaningful; preserve hospital-local instructions that are not whitelisted.
  return sourceValues
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim() || ''
}

/** Exact source dosage text for display, with structured timing as fallback.
 * FHIR dosageInstruction.text is the source's complete human-readable SIG and
 * therefore takes precedence over an App-normalized frequency abbreviation. */
export function displayDosageInstruction(dosage?: DosageInstruction): string {
  const sourceText = dosage?.text?.trim()
  if (sourceText && /(?:給藥總量|給藥日數|平均每日)/.test(sourceText)) {
    // Health-passbook records sometimes put dispensing arithmetic in
    // dosageInstruction.text. It is useful supply metadata, but it is not a
    // SIG. Keep any actual code such as QOD if present; otherwise let the
    // compact row render quantity and days from dispenseRequest instead of
    // repeating the entire arithmetic sentence in the dosage position.
    const normalized = humanDosageFrequency(dosage)
    if (normalized && normalized !== sourceText) return normalized
    return humanDosageFrequency({ ...dosage, text: undefined })
  }
  return sourceText || humanDosageFrequency(dosage)
}

export function buildDetail({
  doseAndRate,
  doseText,
  route,
  repeat,
  timingCode,
  additionalInstruction,
  audience,
  locale,
}: {
  doseAndRate?: DoseAndRate[]
  doseText?: string
  route?: CodeableConcept
  repeat?: TimingRepeat
  timingCode?: CodeableConcept
  additionalInstruction?: CodeableConcept[]
  audience?: 'medical' | 'patient'
  locale?: string
}): string {
  const dose = humanDoseAmount(doseAndRate, doseText)
  const r = routeDisplayText(route, { audience, locale })
  const freq = humanDosageFrequency({
    text: doseText,
    timing: { repeat, code: timingCode },
    additionalInstruction,
  })

  const parts = [
    dose ? `Dose: ${dose}` : "",
    r !== "—" ? `Route: ${r}` : "",
    freq ? `Freq: ${freq}` : "",
  ].filter(Boolean)

  return parts.join(" · ")
}
