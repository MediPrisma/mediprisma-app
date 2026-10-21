// Pairs a report's MediCloud raw rows with its converted rows, for the
// developer viewer. Most converted Observations carry no pointer back to
// their source row, so the pairing is a best match on what both sides show:
// the same day, the same test, and — when values were attached — the same
// result. Unpaired raw rows are the ones the conversion dropped (or turned
// into something unrecognisable); unpaired converted rows have no raw row
// that explains them.
//
// It must never hide a conversion error by pairing the wrong rows, so:
// - the test is decided by its name first, strongest match wins: the same
//   name (incl. a history row's name kept as a coding code), then the same
//   canonical key the cumulative report uses ("HGB", "Hb 血色素" → HB;
//   "SEG", "Neutrophil 嗜中性多核球" → NEU) or that this report's own rows
//   give a history name ("Renal_Scr" → CREA), then a whole-word containment;
//   an order code shared by several tests (08011C covers WBC, RBC, PLT …)
//   only pairs when it is the one row carrying that code on that day, on
//   both sides — or the one left after the others paired by name; either
//   way the pair is flagged as resting on the code alone;
// - a raw row that names a test is that test: it is never paired by order
//   code to another one, even when its own test is already taken;
// - a result is its comparator, its numbers and its qualitative text
//   together ("<0.5" ≠ "0.5", "Reactive(0.18)" ≠ "Nonreactive(0.18)");
// - a pair whose values differ is made only when it is the single candidate
//   left, and is flagged;
// - a second 健保日檔／月檔 copy of a paired result is shown as merged into
//   that row, not as dropped — only when it is provably that copy: the same
//   value, or (values withheld) the bridge's own merge of a 日檔 and a 月檔
//   row of one report instance. A missing value proves nothing, and another
//   report instance (MediCloud case time) is another test: both stay
//   unpaired.
import { canonicalTestKeyFromString } from '@voho0000/clinical-lab-normalization/canonical'
import type { LabDataReportRawRow, LabDataReportRow } from '../types'

export interface RawPairing {
  /** raw ref → converted ref */
  convertedByRaw: Map<number, number>
  /** converted ref → raw ref */
  rawByConverted: Map<number, number>
  /** Raw refs paired on day and test although the values differ — itself a
   *  sign of a conversion error (unit, decimal, comparator, wording). */
  valueDiffers: Set<number>
  /** Raw refs paired on a day + order code alone (their names did not
   *  match): the code was unique that day, or the others under it paired
   *  by name and left exactly one raw row and one converted row. */
  codeOnly: Set<number>
  /** raw ref → converted ref it was merged into: a second copy of a result
   *  already paired — a 健保日檔／月檔 copy, or a history (S03) row the
   *  bridge folded into the S02 row — proven by an equal value, or by the
   *  bridge's own record of merging that 日檔／月檔 pair. */
  mergedInto: Map<number, number>
  /** Raw rows with no converted row and no merge that explains them. */
  unmatchedRaw: number[]
  /** Converted IMUE0060 rows with no raw row. */
  unmatchedConverted: number[]
  /** Converted rows from another MediCloud module (e.g. IMUE0140): the raw
   *  rows sent cover IMUE0060 only, so these have none by design. */
  otherSource: number[]
}

const normalize = (text: string | undefined) =>
  (text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
/** Like normalize, but single spaces stay: they are word boundaries. */
const normalizeSpaced = (text: string | undefined) =>
  (text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

// ── Results ──────────────────────────────────────────────────────────────

/** What a result says: comparator, every number, and its words. */
interface ResultKey {
  comparator: string
  numbers: number[]
  text: string
}

// Every way a source writes "at most" / "at least" (NFKC folds the full-
// width forms ＜ ＞ ＝ into ASCII, but not ≤ ≥ ≦ ≧ ⩽ ⩾).
const COMPARATORS: Record<string, string> = {
  '<': '<', '>': '>', '=': '',
  '<=': '<=', '=<': '<=', '≤': '<=', '≦': '<=', '⩽': '<=',
  '>=': '>=', '=>': '>=', '≥': '>=', '≧': '>=', '⩾': '>=',
}
const LEADING_COMPARATOR = /^\s*(<=|=<|>=|=>|≤|≦|⩽|≥|≧|⩾|<|>|=)/
const NUMBER = /(?<![\d.])-?\d+(?:\.\d+)?/g

function resultKeyOfText(value: string, units: readonly (string | undefined)[]): ResultKey {
  let text = value.normalize('NFKC').trim()
  // A unit already stated in the unit field is not part of the result.
  for (const unit of units) {
    const plain = unit?.normalize('NFKC').trim()
    if (plain) text = text.split(plain).join(' ')
  }
  let comparator = ''
  const lead = text.match(LEADING_COMPARATOR)
  if (lead) {
    comparator = COMPARATORS[lead[1]]
    text = text.slice(lead[0].length)
  }
  const numbers = (text.match(NUMBER) ?? []).map(Number)
  // The words: letters (any script) and plus signs ("1+", "(+)") survive;
  // digits, spaces, brackets and separators do not.
  const words = text.replace(NUMBER, ' ').toLowerCase().replace(/[^\p{L}+]/gu, '')
  return { comparator, numbers, text: words }
}

function rawResultKey(row: LabDataReportRawRow, converted: LabDataReportRow): ResultKey | undefined {
  const value = row.results.assay_value ?? row.results.assaY_VALUE
  if (value === undefined) return undefined
  if (typeof value === 'number') return { comparator: '', numbers: [value], text: '' }
  return resultKeyOfText(value, [row.fields.unit_data, converted.unit])
}

function convertedResultKey(row: LabDataReportRow): ResultKey | undefined {
  const value = row.value
  switch (value.kind) {
    case 'quantity':
      return value.value === undefined
        ? undefined
        : { comparator: COMPARATORS[value.comparator ?? '='] ?? value.comparator ?? '', numbers: [value.value], text: '' }
    case 'range':
      return value.low === undefined && value.high === undefined
        ? undefined
        : { comparator: '', numbers: [value.low, value.high].filter((n): n is number => n !== undefined), text: '' }
    case 'string':
      return value.value === undefined ? undefined : resultKeyOfText(value.value, [row.unit])
    case 'coded': {
      const text = value.text ?? value.code
      return text === undefined ? undefined : resultKeyOfText(text, [row.unit])
    }
    default:
      return undefined
  }
}

const sameResult = (a: ResultKey, b: ResultKey) =>
  a.comparator === b.comparator
  && a.text === b.text
  && a.numbers.length === b.numbers.length
  && a.numbers.every((n, i) => Math.abs(n - b.numbers[i]) < 1e-9)

/** Equal and differs are proven; unknown means a side has no value to
 *  compare (not attached, or withheld) — it is evidence of neither. */
type Comparison = 'equal' | 'differs' | 'unknown'

function compareResults(rawRow: LabDataReportRawRow, row: LabDataReportRow): Comparison {
  const rawKey = rawResultKey(rawRow, row)
  const convertedKey = convertedResultKey(row)
  if (!rawKey || !convertedKey) return 'unknown'
  return sameResult(rawKey, convertedKey) ? 'equal' : 'differs'
}

// ── Report instances ─────────────────────────────────────────────────────

/** A MediCloud report instance (its case time) on the report's day axis,
 *  to the minute: the bridge keeps the rows of two instances apart, and a
 *  健保月檔 copy drops the seconds its 日檔 twin has. */
interface Instance {
  day: number
  minute?: string
}

const minuteOf = (time: string | undefined) => time?.slice(0, 5) || undefined

function rawInstance(row: LabDataReportRawRow): Instance | undefined {
  const caseTime = row.dates.case_time
  return caseTime && { day: caseTime.day, minute: minuteOf(caseTime.time) }
}

function convertedInstance(row: LabDataReportRow): Instance | undefined {
  if (!row.sourceTime || row.day === null) return undefined
  return { day: row.day + row.sourceTime.dayDelta, minute: minuteOf(row.sourceTime.time) }
}

/** Both sides say when, and they name different instances. */
const otherInstance = (a: Instance | undefined, b: Instance | undefined) =>
  !!a && !!b && (a.day !== b.day || (!!a.minute && !!b.minute && a.minute !== b.minute))

/** Both sides say when, to the minute, and it is the same instance. */
const sameInstance = (a: Instance | undefined, b: Instance | undefined) =>
  !!a?.minute && !!b?.minute && a.day === b.day && a.minute === b.minute

// The bridge's merge of source copies (medcloud2 lab-source-reconciliation):
// exactly two rows of one report instance — a 健保日檔 and a 健保月檔 copy,
// or the two NHI-calculated eGFR copies such a pair anchors (no data mark) —
// and it tags the row it keeps.
const BRIDGE_MERGED_COPIES = 'source-reconciliation:merged-'

function sourceChannel(row: LabDataReportRawRow): 'daily' | 'monthly' | undefined {
  const mark = row.fields.data_mark?.trim().replace(/;$/, '')
  return mark === '健保日檔' ? 'daily' : mark === '健保月檔' ? 'monthly' : undefined
}

/** `copy` is the second source row the bridge says it merged into `host`,
 *  whose own raw row is `hostRaw`. */
function bridgeMergedCopy(copy: LabDataReportRawRow, host: LabDataReportRow, hostRaw: LabDataReportRawRow): boolean {
  if (!host.sourceTags.some((tag) => tag.startsWith(BRIDGE_MERGED_COPIES))) return false
  if (!sameInstance(rawInstance(copy), rawInstance(hostRaw))) return false
  const channels = [sourceChannel(copy), sourceChannel(hostRaw)]
  return (channels.includes('daily') && channels.includes('monthly')) || channels.every((channel) => !channel)
}

// ── Tests ────────────────────────────────────────────────────────────────

/** How strongly a raw row's name names a converted row's test.
 *  Exact: the same name — the converted text or one of its " / "-joined
 *  parts (a merged daily + monthly row), a coding display, or a coding code
 *  (history rows keep their source name there: "Renal_Scr").
 *  Canonical: the same canonical analyte key (the cumulative report's own).
 *  Contains: one name contains the other as a whole word. */
const NameTier = { None: 0, Contains: 1, Canonical: 2, Exact: 3 } as const
type NameTier = (typeof NameTier)[keyof typeof NameTier]

const canonicalKey = (name: string | undefined) =>
  name?.trim() ? normalize(canonicalTestKeyFromString(name)) : ''

function rawName(row: LabDataReportRawRow): string | undefined {
  return row.fields.assay_item_name ?? row.fields.assaY_NAME
}

function exactNames(row: LabDataReportRow): string[] {
  const text = row.code.text ?? ''
  return [
    text,
    ...text.split(/\s+\/\s+/),
    ...row.code.codings.flatMap((coding) => [coding.display, coding.code]),
  ].map(normalize).filter(Boolean)
}

function canonicalNames(row: LabDataReportRow): string[] {
  const text = row.code.text ?? ''
  return [
    canonicalKey(text),
    ...text.split(/\s+\/\s+/).map(canonicalKey),
    normalize(row.app.testKey),
    normalize(row.app.column),
  ].filter(Boolean)
}

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char)

/** `needle` appears in `hay` as a whole word ("testosterone" in
 *  "…(testosterone(eia/lia))", but "hb" not in "hba1c"). */
function containsWord(hay: string, needle: string): boolean {
  if (needle.length < 2) return false
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (!isWordChar(hay[at - 1]) && !isWordChar(hay[at + needle.length])) return true
  }
  return false
}

/**
 * Source names this report itself explains: a converted row that carries a
 * name as a coding code ("Renal_Scr" on a history row) and sits in one
 * column (CREA) says that name is that analyte — so the same name on a raw
 * row that the bridge folded into another row still finds its column. Only
 * a code that points at a single column counts.
 */
function learnNames(converted: readonly LabDataReportRow[]): Map<string, string> {
  const keys = new Map<string, Set<string>>()
  for (const row of converted) {
    const key = normalize(row.app.testKey)
    if (!key) continue
    for (const coding of row.code.codings) {
      const code = normalize(coding.code)
      if (!code) continue
      keys.set(code, (keys.get(code) ?? new Set()).add(key))
    }
  }
  const learned = new Map<string, string>()
  for (const [code, found] of keys) if (found.size === 1) learned.set(code, [...found][0])
  return learned
}

function nameTier(raw: LabDataReportRawRow, converted: LabDataReportRow, learned: Map<string, string>): NameTier {
  const name = rawName(raw)
  const plain = normalize(name)
  if (!plain) return NameTier.None
  const exact = exactNames(converted)
  if (exact.includes(plain)) return NameTier.Exact
  const canonical = [canonicalKey(name), learned.get(plain)].filter((key): key is string => !!key)
  const others = canonicalNames(converted)
  if (canonical.some((key) => others.includes(key))) return NameTier.Canonical
  // Whole-word containment, with spaces kept as boundaries ("a/A O2" in
  // "a/A O2 ratio", "Testosterone" in "…(Testosterone (EIA/LIA))").
  const spaced = normalizeSpaced(name)
  const spacedOthers = [
    converted.code.text,
    ...converted.code.codings.map((coding) => coding.display),
    converted.app.column,
  ].map(normalizeSpaced).filter(Boolean)
  if (spacedOthers.some((other) => containsWord(other, spaced) || containsWord(spaced, other))) return NameTier.Contains
  return NameTier.None
}

const orderCodeOf = (raw: LabDataReportRawRow) => raw.fields.order_code?.trim() || undefined
const hasCode = (row: LabDataReportRow, code: string) => row.code.codings.some((coding) => coding.code === code)

const SOURCE_MODULE = 'source-module:'

/** The converted row came from IMUE0060, or does not say where it came from. */
function fromLabSource(row: LabDataReportRow): boolean {
  const sourceModule = row.sourceTags.find((tag) => tag.startsWith(SOURCE_MODULE))
  return !sourceModule || sourceModule.slice(SOURCE_MODULE.length).toLowerCase() === 'imue0060'
}

function rawDays(row: LabDataReportRawRow): number[] {
  return [...new Set(Object.values(row.dates).map((date) => date!.day))]
}

export function pairRawRows(converted: readonly LabDataReportRow[], raw: readonly LabDataReportRawRow[]): RawPairing {
  const convertedByRaw = new Map<number, number>()
  const rawByConverted = new Map<number, number>()
  const valueDiffers = new Set<number>()
  const codeOnly = new Set<number>()
  const learned = learnNames(converted)
  const mergedInto = new Map<number, number>()
  const rawByRef = new Map(raw.map((row) => [row.ref, row]))

  const byDay = new Map<number, LabDataReportRow[]>()
  for (const row of converted) {
    if (row.day === null || !fromLabSource(row)) continue
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row])
  }
  // How many raw rows carry an order code on a day — a code only identifies
  // a test when it is the only one of its kind that day.
  const rawPerDayCode = new Map<string, number>()
  for (const row of raw) {
    const code = orderCodeOf(row)
    if (!code) continue
    for (const day of rawDays(row)) rawPerDayCode.set(`${day}|${code}`, (rawPerDayCode.get(`${day}|${code}`) ?? 0) + 1)
  }

  /** Converted rows on this day that are this raw row's test, at the
   *  strongest name tier any of them reaches — taken or not, so a raw row
   *  whose exact match is already paired never settles for a weaker one. */
  const namedOnDay = (rawRow: LabDataReportRawRow, day: number): LabDataReportRow[] => {
    const tiers = (byDay.get(day) ?? []).map((row) => ({ row, tier: nameTier(rawRow, row, learned) }))
    const best = Math.max(NameTier.None, ...tiers.map((entry) => entry.tier)) as NameTier
    return best === NameTier.None ? [] : tiers.filter((entry) => entry.tier === best).map((entry) => entry.row)
  }

  /** Still-free converted rows on this day that are this raw row's test,
   *  and whether that rests on the order code alone (no name matched). */
  const candidates = (rawRow: LabDataReportRawRow, day: number): { rows: LabDataReportRow[]; byCode: boolean } => {
    const named = namedOnDay(rawRow, day)
    if (named.length > 0) return { rows: named.filter((row) => !rawByConverted.has(row.ref)), byCode: false }
    const code = orderCodeOf(rawRow)
    if (!code || rawPerDayCode.get(`${day}|${code}`) !== 1) return { rows: [], byCode: true }
    const coded = (byDay.get(day) ?? []).filter((row) => hasCode(row, code))
    return { rows: coded.length === 1 && !rawByConverted.has(coded[0].ref) ? coded : [], byCode: true }
  }

  const pair = (rawRow: LabDataReportRawRow, row: LabDataReportRow, flags: { differs?: boolean; codeOnly?: boolean } = {}) => {
    convertedByRaw.set(rawRow.ref, row.ref)
    rawByConverted.set(row.ref, rawRow.ref)
    if (flags.differs) valueDiffers.add(rawRow.ref)
    if (flags.codeOnly) codeOnly.add(rawRow.ref)
  }

  // Equal results first, so that a row with no attached value never takes
  // one a later raw row matches exactly; then rows where a value is
  // missing; last, a lone candidate whose value differs (flagged).
  for (const pass of ['equal', 'unknown', 'differs'] as const) {
    for (const rawRow of raw) {
      if (convertedByRaw.has(rawRow.ref)) continue
      for (const day of rawDays(rawRow)) {
        const { rows: found, byCode } = candidates(rawRow, day)
        const match = pass === 'differs'
          ? (found.length === 1 ? found[0] : undefined)
          : found.find((row) => compareResults(rawRow, row) === pass)
        if (match) {
          pair(rawRow, match, { differs: compareResults(rawRow, match) === 'differs', codeOnly: byCode })
          break
        }
      }
    }
  }

  // Merged copies, before elimination, so a provable copy is not taken for
  // the row left under its order code. The bridge turns a 健保日檔 and a
  // 健保月檔 copy of one result into a single row ("三酸甘油脂 /
  // Triglyceride"), and folds an S03 history row into the S02 row of the
  // same result. A raw row whose test is already paired on that day is that
  // second copy, not a dropped row — when it is proven: the same result, or
  // with values withheld, the bridge's own record of merging the pair.
  // A different result, a value that cannot be compared, or another report
  // instance (case time) stays unpaired: it may be a test the conversion
  // dropped.
  const bridgeHosts = new Set<number>()
  /** What proves `rawRow` a second copy of the result `host` already
   *  shows for its paired raw row — nothing when unproven. */
  const copyProof = (rawRow: LabDataReportRawRow, host: LabDataReportRow): 'same-result' | 'bridge' | undefined => {
    const hostRaw = rawByRef.get(rawByConverted.get(host.ref) ?? -1)
    if (!hostRaw) return undefined
    const instance = rawInstance(rawRow)
    if (otherInstance(instance, convertedInstance(host)) || otherInstance(instance, rawInstance(hostRaw))) return undefined
    const comparison = compareResults(rawRow, host)
    if (comparison !== 'unknown') return comparison === 'equal' ? 'same-result' : undefined
    // The bridge merges exactly two source rows into one.
    return !bridgeHosts.has(host.ref) && bridgeMergedCopy(rawRow, host, hostRaw) ? 'bridge' : undefined
  }
  for (const rawRow of raw) {
    if (convertedByRaw.has(rawRow.ref)) continue
    for (const day of rawDays(rawRow)) {
      const merge = namedOnDay(rawRow, day)
        .map((host) => ({ host, proof: copyProof(rawRow, host) }))
        .find((entry) => entry.proof)
      if (merge) {
        mergedInto.set(rawRow.ref, merge.host.ref)
        if (merge.proof === 'bridge') bridgeHosts.add(merge.host.ref)
        break
      }
    }
  }

  // Elimination: when a day and order code leave exactly one free raw row
  // and one free converted row (the others shared the code but were paired
  // by name, or merged), they are each other's — flagged as paired by code
  // only. Never for a raw row that names a test: it is that test, even
  // when that test is already taken (a copy, or a test the conversion
  // dropped), and must not be passed off as a different one.
  for (const rawRow of raw) {
    if (convertedByRaw.has(rawRow.ref) || mergedInto.has(rawRow.ref)) continue
    const code = orderCodeOf(rawRow)
    if (!code) continue
    const days = rawDays(rawRow)
    if (days.some((day) => namedOnDay(rawRow, day).length > 0)) continue
    for (const day of days) {
      const freeRaw = raw.filter((row) => !convertedByRaw.has(row.ref) && !mergedInto.has(row.ref)
        && orderCodeOf(row) === code && rawDays(row).includes(day))
      const freeConverted = (byDay.get(day) ?? []).filter((row) => !rawByConverted.has(row.ref) && hasCode(row, code))
      if (freeRaw.length === 1 && freeConverted.length === 1) {
        pair(rawRow, freeConverted[0], { codeOnly: true, differs: compareResults(rawRow, freeConverted[0]) === 'differs' })
        break
      }
    }
  }

  return {
    convertedByRaw,
    rawByConverted,
    valueDiffers,
    codeOnly,
    mergedInto,
    unmatchedRaw: raw.filter((row) => !convertedByRaw.has(row.ref) && !mergedInto.has(row.ref)).map((row) => row.ref),
    unmatchedConverted: converted
      .filter((row) => !rawByConverted.has(row.ref) && fromLabSource(row))
      .map((row) => row.ref),
    otherSource: converted.filter((row) => !fromLabSource(row)).map((row) => row.ref),
  }
}
