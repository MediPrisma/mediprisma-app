// Pure selectors for the 總覽 (Overview) tab.
//
// Everything here is framework-free so the window arithmetic, the medication
// change verdict and the row-fitting maths can be unit-tested without React or
// a FHIR bundle. The React layer (hooks/useOverviewData.ts) only adapts the
// existing feature hooks into these shapes.

import {
  findPinnableLab,
  isPinnedLabReminder,
  pinnedLabId,
  pinnedLabReminderLabel,
} from '@/src/shared/utils/pinned-labs'
import type { OverviewLabRow } from '../hooks/useOverviewData'

export const OVERVIEW_RANGE_MONTHS = [1, 3, 6, 12] as const
export type OverviewRangeMonths = (typeof OVERVIEW_RANGE_MONTHS)[number]
export const DEFAULT_OVERVIEW_RANGE_MONTHS: OverviewRangeMonths = 3

/** Day-granularity window, both ends inclusive, expressed as "YYYY-MM-DD". */
export interface OverviewWindow {
  months: OverviewRangeMonths
  startDay: string
  endDay: string
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function dayKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Source-local calendar day for a FHIR dateTime.
 *
 * FHIR dateTime values carry their own offset ("2026-08-19T09:00:00+08:00").
 * The rest of the app (lab pivot, day grouping) keys on the leading 10
 * characters, i.e. the day as the SOURCE recorded it — re-projecting into the
 * reader's timezone would move a 00:30 draw to the previous day. Keep the same
 * convention here so overview counts match the report tab exactly.
 */
export function toDayKey(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
    if (!trimmed) return undefined
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? undefined : dayKeyFromDate(parsed)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dayKeyFromDate(value)
  }
  return undefined
}

/**
 * Anchor the window on today and reach back N calendar months.
 *
 * `setMonth` alone overflows (31 May − 3 months → 3 March), so the day is
 * clamped to the target month's length. Both ends are inclusive: a 3-month
 * window on 2026-09-09 is 2026-06-09 … 2026-09-09.
 */
export function buildOverviewWindow(
  months: OverviewRangeMonths,
  nowMs: number = Date.now(),
): OverviewWindow {
  const end = new Date(nowMs)
  const endDay = dayKeyFromDate(end)
  const targetMonthFirst = new Date(end.getFullYear(), end.getMonth() - months, 1)
  const daysInTargetMonth = new Date(
    targetMonthFirst.getFullYear(),
    targetMonthFirst.getMonth() + 1,
    0,
  ).getDate()
  const start = new Date(
    targetMonthFirst.getFullYear(),
    targetMonthFirst.getMonth(),
    Math.min(end.getDate(), daysInTargetMonth),
  )
  return { months, startDay: dayKeyFromDate(start), endDay }
}

/** Inclusive on both boundary days. Undated records are never in range. */
export function isWithinOverviewWindow(value: unknown, window: OverviewWindow): boolean {
  const day = toDayKey(value)
  if (!day) return false
  return day >= window.startDay && day <= window.endDay
}

/**
 * A record spanning a period (an inpatient stay, a prescription's supply) is in
 * range when ANY part of it overlaps the window — an admission that started
 * before the window but discharged inside it is still this window's event.
 */
export function overlapsOverviewWindow(
  startValue: unknown,
  endValue: unknown,
  window: OverviewWindow,
): boolean {
  const start = toDayKey(startValue)
  const end = toDayKey(endValue)
  if (!start && !end) return false
  const from = start ?? end!
  const to = end ?? start!
  const lo = from <= to ? from : to
  const hi = from <= to ? to : from
  return lo <= window.endDay && hi >= window.startDay
}

// ── Row fitting (寬版 2×2, no scrollbars anywhere) ───────────────────────────

/** Height reserved for the 「另 N 項 · 在○○分頁看全部 →」 line and its gap. */
export const OVERVIEW_TRUNCATION_ROW_PX = 24

/**
 * Sub-pixel slack. Row heights come from the design brief, but real text
 * metrics, borders and flex gaps land a pixel or two either side of them —
 * and in this layout a one-pixel overshoot is a clipped row. Erring low costs
 * nothing: the 「另 N 項」 line already says what was left out.
 */
export const OVERVIEW_FIT_SLACK_PX = 4

/**
 * How many rows fit in `availablePx` of content box.
 *
 * `headerPx` covers anything that always renders above the rows (a pivot table
 * header, the visit timeline). `rowPx` must already include the inter-row gap.
 * When the list does not fit whole, one truncation line is reserved.
 *
 * An unmeasured container (0 / NaN — first paint, jsdom) returns `total` so the
 * card renders its full list rather than blanking out.
 */
export function fitRows(
  availablePx: number,
  rowPx: number,
  headerPx: number,
  total: number,
): number {
  if (total <= 0) return 0
  if (!Number.isFinite(availablePx) || availablePx <= 0) return total
  if (!Number.isFinite(rowPx) || rowPx <= 0) return total
  const body = availablePx - Math.max(0, headerPx) - OVERVIEW_FIT_SLACK_PX
  if (body <= 0) return 0
  const withoutNote = Math.floor(body / rowPx)
  if (withoutNote >= total) return total
  const withNote = Math.floor((body - OVERVIEW_TRUNCATION_ROW_PX) / rowPx)
  return Math.max(0, Math.min(total, withNote))
}

/**
 * `fitRows` for a list that also prints a divider whenever the group changes.
 *
 * Charging every group up-front (`headerPx + groups × groupPx`) badly
 * under-fills the card, because a truncated list only ever renders the few
 * dividers its surviving rows actually need. Walking the list charges each
 * divider exactly once, where it occurs.
 */
export function fitGroupedRows(
  availablePx: number,
  groupKeys: string[],
  options: { rowPx: number; groupPx: number; headerPx: number },
): number {
  const total = groupKeys.length
  if (total === 0) return 0
  if (!Number.isFinite(availablePx) || availablePx <= 0) return total
  if (!Number.isFinite(options.rowPx) || options.rowPx <= 0) return total
  const budget = availablePx - Math.max(0, options.headerPx) - OVERVIEW_FIT_SLACK_PX
  if (budget <= 0) return 0

  const walk = (limit: number): number => {
    let used = 0
    let count = 0
    let previousGroup: string | undefined
    for (const key of groupKeys) {
      const cost = options.rowPx + (key === previousGroup ? 0 : options.groupPx)
      if (used + cost > limit) break
      used += cost
      previousGroup = key
      count += 1
    }
    return count
  }

  const whole = walk(budget)
  if (whole >= total) return total
  return walk(budget - OVERVIEW_TRUNCATION_ROW_PX)
}

// ── Medication change detection ─────────────────────────────────────────────

export type OverviewMedChangeKind = 'added' | 'stopped' | 'adjusted'

export interface OverviewMedChange {
  kind: OverviewMedChangeKind
  /** 'adjusted' only — the dose/frequency this therapy carried before. */
  previousDose?: string
}

/**
 * One prescription record reduced to the fields the verdict needs.
 *
 * `key` is the project's canonical medication identity
 * (`medicationClinicalIdentityKey`, surfaced as `MedicationRow.drugKey`), so
 * refills of one therapy — and the same ingredient under different brand
 * spellings — collapse together. `isActive` is the app's existing
 * active/inactive determiner (`!MedicationRow.isInactive`); this module never
 * re-derives it.
 */
export interface OverviewMedFact {
  key: string
  startDay?: string
  endDay?: string
  isActive: boolean
  /** Dose and frequency stay separate so display-only SIG suffixes do not
   *  masquerade as a clinical adjustment. */
  dose?: string
  frequency?: string
  /** Normalised "dose · frequency"; absent when the source stated neither. */
  doseSignature?: string
}

function normalizedDirectionPart(value: string | undefined): string {
  return value?.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '') ?? ''
}

function frequencyOpening(value: string): string {
  return value.match(
    /^(?:Q\d+(?:\.\d+)?H|QOD|QHS|QAM|QPM|QID|BID|TID|QD|QN|QW|QM|HS|PRN|STAT)/,
  )?.[0] ?? ''
}

/**
 * Some hospital SIGs append meal timing and route to the same frequency code:
 * QD → QDACPO, QOD → QODPCPO, HS → HSPCPO. Those strings describe
 * the same dosing frequency. Compare the recognized opening so QDACPO and
 * QDPCPO also remain one frequency, while QD/QOD and Q1H/Q12H stay different.
 */
function sameFrequencyOpening(previous: string | undefined, latest: string | undefined): boolean {
  const left = normalizedDirectionPart(previous)
  const right = normalizedDirectionPart(latest)
  if (!left || !right) return left === right
  if (left === right) return true
  const leftOpening = frequencyOpening(left)
  const rightOpening = frequencyOpening(right)
  if (leftOpening && rightOpening) return leftOpening === rightOpening

  // Preserve the intended prefix behavior for an unfamiliar local code, but
  // never collapse numeric intervals merely because their text shares Q1/Q2.
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  return longer.startsWith(shorter) && /^[A-Z]+$/.test(longer.slice(shorter.length))
}

function sameMedicationDirection(previous: OverviewMedFact, latest: OverviewMedFact): boolean {
  if (previous.doseSignature === latest.doseSignature) return true

  // Older callers may only supply the combined signature. Preserve their
  // exact comparison until dose and frequency are available independently.
  const hasStructuredDirection = previous.dose !== undefined
    || latest.dose !== undefined
    || previous.frequency !== undefined
    || latest.frequency !== undefined
  if (!hasStructuredDirection) return false

  return normalizedDirectionPart(previous.dose) === normalizedDirectionPart(latest.dose)
    && sameFrequencyOpening(previous.frequency, latest.frequency)
}

/**
 * Verdict per drug key. Precedence is deterministic and mutually exclusive:
 *
 *  1. 停用 — nothing of this therapy is still active and its last coverage day
 *     falls inside the window.
 *  2. 新增 — the EARLIEST record of this therapy starts inside the window
 *     (so the chart holds no earlier record of the same ingredient).
 *  3. 調整 — the newest in-window record's dose/frequency differs from the
 *     newest record before the window.
 *
 * Anything the source cannot decide (no dates, no dose text on either side)
 * gets no verdict — the row simply renders without a change badge.
 */
export function classifyMedicationChanges(
  facts: OverviewMedFact[],
  window: OverviewWindow,
): Map<string, OverviewMedChange> {
  const byKey = new Map<string, OverviewMedFact[]>()
  for (const fact of facts) {
    if (!fact?.key) continue
    const bucket = byKey.get(fact.key)
    if (bucket) bucket.push(fact)
    else byKey.set(fact.key, [fact])
  }

  const verdicts = new Map<string, OverviewMedChange>()
  byKey.forEach((records, key) => {
    const starts = records.map((r) => r.startDay).filter((d): d is string => !!d).sort()
    const ends = records.map((r) => r.endDay).filter((d): d is string => !!d).sort()
    const anyActive = records.some((r) => r.isActive)

    const lastEnd = ends.length > 0 ? ends[ends.length - 1] : undefined
    if (!anyActive && lastEnd && lastEnd >= window.startDay && lastEnd <= window.endDay) {
      verdicts.set(key, { kind: 'stopped' })
      return
    }

    const firstStart = starts.length > 0 ? starts[0] : undefined
    if (firstStart && firstStart >= window.startDay && firstStart <= window.endDay) {
      verdicts.set(key, { kind: 'added' })
      return
    }

    const dated = records.filter(
      (r): r is OverviewMedFact & { startDay: string; doseSignature: string } =>
        !!r.startDay && !!r.doseSignature,
    )
    if (dated.length < 2) return
    const inWindow = dated
      .filter((r) => r.startDay >= window.startDay && r.startDay <= window.endDay)
      .sort((a, b) => a.startDay.localeCompare(b.startDay))
    const beforeWindow = dated
      .filter((r) => r.startDay < window.startDay)
      .sort((a, b) => a.startDay.localeCompare(b.startDay))
    const latest = inWindow[inWindow.length - 1]
    const previous = beforeWindow[beforeWindow.length - 1]
    if (!latest || !previous) return
    if (sameMedicationDirection(previous, latest)) return
    verdicts.set(key, { kind: 'adjusted', previousDose: previous.doseSignature })
  })

  return verdicts
}

// ── Timeline geometry ───────────────────────────────────────────────────────

/** Position of a day inside the window, as a 0–100 percentage. */
export function windowOffsetPercent(day: string | undefined, window: OverviewWindow): number | undefined {
  if (!day) return undefined
  const start = Date.parse(`${window.startDay}T00:00:00Z`)
  const end = Date.parse(`${window.endDay}T00:00:00Z`)
  const at = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(at)) return undefined
  if (end <= start) return 0
  const ratio = (at - start) / (end - start)
  return Math.min(100, Math.max(0, ratio * 100))
}

/** First-of-month ticks inside the window, newest last. */
export function monthTicks(window: OverviewWindow): { day: string; month: number }[] {
  const [startYear, startMonth] = window.startDay.split('-').map(Number)
  const [endYear, endMonth] = window.endDay.split('-').map(Number)
  if (!startYear || !endYear) return []
  const ticks: { day: string; month: number }[] = []
  let year = startYear
  let month = startMonth
  // Cap the walk so a malformed window can never spin here.
  for (let guard = 0; guard < 24; guard += 1) {
    const day = `${year}-${pad2(month)}-01`
    if (day >= window.startDay && day <= window.endDay) ticks.push({ day, month })
    if (year > endYear || (year === endYear && month >= endMonth)) break
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return ticks
}

/**
 * 「常用」 analytes for the overview pivot, scoped by lab category.
 *
 * Deliberately NOT `LabCategory.pinnedColumns`: those exist so a standard panel
 * in the 累積報告 always shows its full column set (CBC pins eleven columns,
 * chemistry sixteen). In a bounded overview card that fills the whole budget
 * with differential percentages before creatinine is reached. This is the
 * clinician's own short list — the eight values read first on any chart.
 *
 * Category scoping matters: 'WBC' and 'CREA' also exist as urine analytes, and
 * a bare key match would pull those in. eGFR lists every canonical formula key
 * (source-faithful labels, dual-formula sources) so whichever one the lab
 * reported is the one that shows.
 */
export const OVERVIEW_PINNED_ANALYTES: Readonly<Record<string, readonly string[]>> = {
  cbc: ['WBC', 'HB', 'PLT'],
  chem: ['CREA', 'EGFR(EPI)', 'EGFR(M)', 'EGFR', 'NA', 'K', 'ALT'],
}

export function isOverviewPinnedAnalyte(categoryId: string, testKey: string): boolean {
  return OVERVIEW_PINNED_ANALYTES[categoryId]?.includes(testKey) ?? false
}

/** The system 「常用」 list as individual pins — the starting point the editor
 *  offers before a clinician has saved a list of their own. */
export function systemDefaultPinnedLabIds(): string[] {
  const ids: string[] = []
  for (const [categoryId, keys] of Object.entries(OVERVIEW_PINNED_ANALYTES)) {
    for (const key of keys) {
      const id = pinnedLabId(categoryId, key)
      if (findPinnableLab(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * 「自訂」 rows for the overview pivot: the SAME rows 常用／全部 draw, picked
 * and ordered by the clinician's pins. A pin with nothing in the window keeps
 * its row with every cell empty, so "not done in this period" is visible
 * rather than the analyte silently disappearing. It keeps its testKey so
 * the name can still open the analyte's whole-chart trend.
 */
export function selectPinnedOverviewRows(
  pinnedIds: readonly string[],
  rows: readonly OverviewLabRow[],
  columnCount: number,
): OverviewLabRow[] {
  const out: OverviewLabRow[] = []
  const used = new Set<string>()
  const placeholder = (id: string, name: string, categoryId = '', testKey = ''): OverviewLabRow => ({
    mapKey: `pinned-empty:${id}`,
    categoryId,
    categoryLabel: '',
    testKey,
    name,
    isPinned: true,
    hasAbnormal: false,
    cells: Array.from({ length: columnCount }, () => undefined),
  })
  for (const id of pinnedIds) {
    if (isPinnedLabReminder(id)) {
      out.push(placeholder(id, pinnedLabReminderLabel(id)))
      continue
    }
    const entry = findPinnableLab(id)
    const matches = entry
      ? rows.filter((row) => row.categoryId === entry.categoryId && row.testKey === entry.testKey && !used.has(row.mapKey))
      : []
    if (matches.length === 0) {
      out.push(placeholder(id, entry?.short ?? id.slice(id.indexOf(':') + 1), entry?.categoryId, entry?.testKey))
      continue
    }
    for (const row of matches) {
      used.add(row.mapKey)
      out.push(row)
    }
  }
  return out
}
