// 帶回病歷 — deterministic plain-text builders for pasting curated labs and
// exam reports back into a hospital EMR's SOAP "O" field.
//
// Hard constraints that shape every decision here (confirmed with the user,
// 2026-08-20):
//  * The destination is a PLAIN textarea in a proportional font. No markdown,
//    no box drawing, no column alignment — anything that relies on whitespace
//    lining up is destroyed by the destination's own soft wrapping.
//    => every emitted line must be self-describing and survive being folded.
//  * NO AI. This text becomes part of a signed medical record, so it is a
//    deterministic transform of source values only. Nothing is paraphrased,
//    summarised, re-ordered by relevance, or inferred.
//  * NO provenance boilerplate ("匯入自健康存摺" …). The user rejected it as
//    noise. Collection DATES stay, because a lab value without its date is
//    not interpretable — that is clinical content, not a source label.
//  * Abnormal flags come ONLY from the source's own interpretation (or an
//    audited source reference range), never from an app-side normal range —
//    see memory/feedback_abnormal_flag_source_only.md. `buildLabPivots`
//    already applies that rule; we only render what it produced.

import { formatReportText } from '@/src/shared/utils/report-text-format'
import { markdownToPlainText } from '@/src/shared/utils/markdown-to-text'
import { decodeBase64Utf8 } from '@/src/shared/utils/base64.utils'
import { inferReportDisplayGroup } from '@/src/shared/utils/report-grouping-helpers'
import { cellDisplayValue, type LabCell, type LabPivot } from '@/src/shared/utils/lab-pivot.utils'

/** 'last' / 'last3' count DRAWS (a panel's own most recent collection days);
 *  the rest are calendar windows. Counting draws is what a clinician means by
 *  「最近三次」 — three months of nothing must still yield three results. */
export type EmrRange = 'last' | 'last3' | '1m' | '3m' | '6m' | '1y'
export type EmrPreset = 'compact' | 'standard' | 'full'

/** Trend separator. Kept in one place: if a hospital terminal turns out to
 *  mangle the arrow (legacy encodings), this is the single line to change. */
const ARROW = ' → '

/** Longest run of time points printed before the middle is elided. */
export const MAX_TREND_POINTS = 6
/** Points kept at the recent end when eliding. The oldest point is always kept
 *  as well, so the reader still sees where the trajectory started. */
const TAIL_POINTS = 5

const RANGE_MONTHS: Record<'1m' | '3m' | '6m' | '1y', number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }

function toIsoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** How many most-recent collection days a draw-counting range keeps. */
const DRAW_COUNT_RANGES: Partial<Record<EmrRange, number>> = { last: 1, last3: 3 }

/** Inclusive lower bound for the selected window, or null for the draw-counting
 *  ranges (resolved per panel / per report rather than by a date cut-off). */
export function emrRangeCutoff(range: EmrRange, now: Date = new Date()): string | null {
  const months = RANGE_MONTHS[range as keyof typeof RANGE_MONTHS]
  if (!months) return null
  const d = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  return toIsoDay(d)
}

function fullDate(iso: string): string {
  return iso.replace(/-/g, '/')
}

/**
 * Trend-point dates. Month/day is enough while a run stays inside the current
 * year; the moment a point falls in an earlier year it carries the year too —
 * "05/18" next to "06/02" silently reads as this May, and a chart line that
 * ages a result by a year is a clinical error, not a formatting one.
 */
function shortDate(iso: string, preset: EmrPreset, currentYear: number): string {
  const full = fullDate(iso)
  if (preset === 'full') return full
  return iso.slice(0, 4) === String(currentYear) ? full.slice(5) : full
}

/**
 * One pivot cell rendered as `值` or `值(旗標)`.
 *
 * A flag is printed ONLY when the cell is abnormal by the app's single
 * authority (`isObservationAbnormal`, already applied inside the pivot): source
 * interpretation when present, audited source reference range otherwise. The
 * label is then the source's own code (H / L / A / POS …), or `A` when the
 * range decided it and gave no direction. Codes that mean "not abnormal"
 * (N / NEG / Normal) are therefore never printed — a chart line reading
 * "UROBI Normal (NEG)" is noise, and the flag exists to mark the outliers.
 *
 * Returns null for an empty / placeholder cell so callers skip it entirely
 * rather than pasting a dash into the chart.
 */
function cellText(cell: LabCell | undefined): string | null {
  // The comparator is part of the result: "<0.5" pasted as "0.5" is wrong.
  const raw = (cell ? cellDisplayValue(cell) : '').trim()
  if (!cell || !raw || raw === '—') return null
  if (!cell.isAbnormal) return raw
  const code = cell.interpretationCode && cell.interpretationCode !== 'N' ? cell.interpretationCode : ''
  return `${raw}(${code || 'A'})`
}

/** Dates (ascending) this panel actually has results on, inside the window. */
function datesInRange(pivot: LabPivot, range: EmrRange, cutoff: string | null): string[] {
  const asc = [...pivot.dates].sort()
  const draws = DRAW_COUNT_RANGES[range]
  if (draws) return asc.slice(-draws)
  return cutoff ? asc.filter((d) => d >= cutoff) : asc
}

export interface EmrLabPanelSummary {
  id: string
  label: string
  /** Number of collection days with results inside the window. */
  drawCount: number
  /** Those collection days, ascending — callers union them to count how many
   *  times the patient was actually drawn (panels share a draw). */
  dates: string[]
}

export interface EmrLabTextOptions {
  pivots: Record<string, LabPivot>
  /** Category id → display label (i18n `reports.cumulativeCategories`). */
  categoryLabels: Record<string, string>
  selected: Record<string, boolean>
  range: EmrRange
  preset: EmrPreset
  /** "…略去 {count} 次…" — localized, injected so this stays pure. */
  omittedLabel: string
  /** "{count} 次" — occurrences in a panel header. */
  drawCountLabel: string
  now?: Date
}

/** Panels that have anything to offer in this window, in LAB_CATEGORIES order. */
export function summarizeEmrLabPanels(
  pivots: Record<string, LabPivot>,
  categoryLabels: Record<string, string>,
  range: EmrRange,
  now: Date = new Date(),
): EmrLabPanelSummary[] {
  const cutoff = emrRangeCutoff(range, now)
  const out: EmrLabPanelSummary[] = []
  for (const [id, pivot] of Object.entries(pivots)) {
    const dates = datesInRange(pivot, range, cutoff)
    // A panel whose only rows are pinned-column stubs has dates but no values.
    const hasValue = dates.some((d) => pivot.rows.some((r) => cellText(r.values.get(d)) !== null))
    if (!dates.length || !hasValue) continue
    out.push({ id, label: categoryLabels[id] || id, drawCount: dates.length, dates })
  }
  return out
}

/** Keep the oldest point and the most recent ones; mark what was dropped.
 *  Silently truncating a chart entry would read as "this is everything". */
function elideTrend(points: string[], omittedLabel: string): string[] {
  if (points.length <= MAX_TREND_POINTS) return points
  const omitted = points.length - 1 - TAIL_POINTS
  return [
    points[0],
    omittedLabel.replace('{count}', String(omitted)),
    ...points.slice(points.length - TAIL_POINTS),
  ]
}

/** `2026/06/02 生化 BUN 23.7(H), CREA 1.93(H), …` — one self-describing line
 *  holding everything measured in this panel on one day. */
function panelDayLine(date: string, label: string, values: string[], preset: EmrPreset): string {
  const head = preset === 'compact' ? `${fullDate(date)} ` : `${fullDate(date)} ${label} `
  return head + values.join(', ')
}

export function buildEmrLabText(options: EmrLabTextOptions): string {
  const { pivots, categoryLabels, selected, range, preset, omittedLabel, drawCountLabel } = options
  const cutoff = emrRangeCutoff(range, options.now)
  const currentYear = (options.now ?? new Date()).getFullYear()
  const blocks: string[] = []

  for (const [id, pivot] of Object.entries(pivots)) {
    if (!selected[id]) continue
    const dates = datesInRange(pivot, range, cutoff)
    if (!dates.length) continue
    const label = categoryLabels[id] || id

    const cellUnit = (row: (typeof pivot.rows)[number], date: string) =>
      (preset === 'full' ? (row.values.get(date)?.unit || row.unit) : undefined)

    // 最近一次 — one line per panel. Panels are drawn on different days, so each
    // keeps its own date rather than being forced under one shared heading.
    if (range === 'last') {
      const date = dates[0]
      const values: string[] = []
      for (const row of pivot.rows) {
        const text = cellText(row.values.get(date))
        if (!text) continue
        const unit = cellUnit(row, date)
        values.push(`${row.displayName} ${text}${unit ? ` ${unit}` : ''}`)
      }
      if (values.length) blocks.push(panelDayLine(date, label, values, preset))
      continue
    }

    // 趨勢 — one line per analyte, every point carrying its own date, so a soft
    // wrap can never separate a value from the day it was drawn and a missing
    // draw needs no placeholder.
    //
    // An analyte measured only ONCE in the window has no trajectory to show,
    // and giving it a line of its own is what turned a urinalysis into fifteen
    // lines. Those collapse back onto one shared line per collection day.
    const trendLines: string[] = []
    const singlesByDate = new Map<string, string[]>()

    for (const row of pivot.rows) {
      const points: Array<{ date: string; text: string }> = []
      for (const date of dates) {
        const text = cellText(row.values.get(date))
        if (text) points.push({ date, text })
      }
      if (!points.length) continue

      if (points.length === 1) {
        const { date, text } = points[0]
        const unit = cellUnit(row, date)
        const bucket = singlesByDate.get(date) ?? []
        bucket.push(`${row.displayName} ${text}${unit ? ` ${unit}` : ''}`)
        singlesByDate.set(date, bucket)
        continue
      }

      const unit = preset === 'full' && row.unit ? ` (${row.unit})` : ''
      const sequence = points.map((point) => `${shortDate(point.date, preset, currentYear)} ${point.text}`)
      trendLines.push(`${row.displayName}${unit} ${elideTrend(sequence, omittedLabel).join(ARROW)}`)
    }

    const singleDates = [...singlesByDate.keys()].sort()

    // Nothing in this panel has a trajectory — it is a one-off panel inside a
    // long window, so print it exactly as 最近一次 would.
    if (!trendLines.length) {
      for (const date of singleDates) {
        blocks.push(panelDayLine(date, label, singlesByDate.get(date)!, preset))
      }
      continue
    }

    const lines = [...trendLines]
    for (const date of singleDates) {
      lines.push(`${shortDate(date, preset, currentYear)} ${singlesByDate.get(date)!.join(', ')}`)
    }
    if (preset !== 'compact') {
      const span = dates.length > 1 ? `${fullDate(dates[0])}-${fullDate(dates[dates.length - 1])}, ` : ''
      lines.unshift(`${label} (${span}${drawCountLabel.replace('{count}', String(dates.length))})`)
    }
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n')
}

// ---------------------------------------------------------------------------
// 檢查／報告
// ---------------------------------------------------------------------------

export interface EmrReportItem {
  id: string
  /** ISO day, "YYYY-MM-DD". */
  date: string
  name: string
  org?: string
  /** Narrative already re-flowed by `formatReportText` (the same transform the
   *  report detail view uses) — the user asked to carry OUR line breaks, not
   *  the bridge's single run-on blob. */
  body: string
  /** The narrative before re-flowing. Fed to the translation task, which does
   *  its own PII scrub and formatting. */
  raw: string
}

/**
 * Narrative text of one DiagnosticReport. Mirrors the extraction the reports
 * list performs (conclusion → note[].text → long synthetic valueString
 * observations), plus base64 text/* presentedForm bodies (Roche DIP ships the
 * full report there). Verbatim: nothing is trimmed to an "impression".
 */
function reportNarrative(dr: any): string {
  const parts: string[] = []
  if (typeof dr?.conclusion === 'string' && dr.conclusion.trim()) parts.push(dr.conclusion)
  if (Array.isArray(dr?.note)) {
    for (const n of dr.note) {
      if (typeof n?.text === 'string' && n.text.trim()) parts.push(n.text)
    }
  }
  const obs = Array.isArray(dr?._observations) ? dr._observations : []
  for (const o of obs) {
    if (typeof o?.valueString === 'string' && o.valueString.trim().length > 30) parts.push(o.valueString)
  }
  if (Array.isArray(dr?.presentedForm)) {
    for (const form of dr.presentedForm) {
      const ct = (form?.contentType || '').toLowerCase()
      if (!form?.data || !ct.startsWith('text/') || ct.includes('html')) continue
      try {
        const decoded = decodeBase64Utf8(form.data).trim()
        if (decoded) parts.push(decoded)
      } catch {
        // Undecodable attachment: skip it rather than pasting mojibake.
      }
    }
  }
  return parts.join('\n').trim()
}

function reportTitle(dr: any): string {
  const text = (dr?.code?.text || '').trim()
  if (text && text !== '—') return text
  const coding = dr?.code?.coding?.[0]
  return (coding?.display || coding?.code || '').replace(/_/g, ' ').trim()
}

function reportOrg(dr: any): string | undefined {
  return dr?._observations?.[0]?.performer?.[0]?.display || dr?.performer?.[0]?.display || undefined
}

function normalizeForDedup(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function formatNarrative(raw: string): string {
  // Some channels ship an ECG / imaging narrative as one line whose "line
  // breaks" are runs of spaces ("心電圖:    Sinus bradycardia    Left axis
  // deviation"). `formatReportText` only breaks where it recognises a section
  // heading or a list marker, so those blobs would paste as a single unreadable
  // line. A run of 3+ spaces is a lost newline; 1–2 spaces are left alone, and
  // no character of the clinical text itself is touched.
  const deblobbed = raw.replace(/[ \t]{3,}/g, '\n')
  return formatReportText(deblobbed)
    .map((line) => {
      const indent = line.level === 0 ? '' : line.level === 1 ? '  ' : '    '
      return `${indent}${line.marker ? `${line.marker} ` : ''}${line.text}`
    })
    .join('\n')
}

/**
 * EVERY exam report with real narrative text, newest first — no window applied.
 *
 * "Has narrative" alone is NOT the test for what belongs here. Most lab
 * DiagnosticReports carry their values on linked Observations and no narrative,
 * so they fall out on their own — but microbiology does not: a culture reports
 * free text ("No Mycobacterium tuberculosis complex isolated"), which looks
 * exactly like an exam narrative. Those are 檢驗, and the app already says so —
 * the reports list files them under 檢驗 — so this defers to that same
 * classifier rather than guessing from the text.
 *
 * Specifically `inferReportDisplayGroup`, the one the reports tabs themselves
 * use: it knows the pathology paths (pathology category codes, NHI 病理 order
 * codes, order-title patterns) that the coarser report-level classifier folds
 * into "imaging" or misses entirely. Sharing it is what keeps this section and
 * the 病理 tab from disagreeing about the same report.
 *
 * Extraction and windowing are separate on purpose: the caller needs to know
 * "does this patient have any reports at all" (so the section, and the range
 * control inside it, stay on screen) independently of what the current range
 * happens to select.
 */
export function collectEmrReports(diagnosticReports: any[]): EmrReportItem[] {
  const items: EmrReportItem[] = []
  const seen = new Set<string>()

  for (const dr of diagnosticReports || []) {
    const group = inferReportDisplayGroup(dr)
    if (group === 'lab' || group === 'vitals') continue
    const item = toEmrReportItem(dr)
    if (!item) continue

    // Bridge duplicates: the same narrative re-sent for one exam. Identical
    // text on the same day would paste twice into the chart.
    const key = emrReportDedupKey(item)
    if (seen.has(key)) continue
    seen.add(key)

    items.push(item)
  }

  items.sort((a, b) => b.date.localeCompare(a.date))
  return items
}

/** Exam day of a report, "YYYY-MM-DD", or '' when the source gave none. */
export function emrReportDate(dr: any): string {
  return (dr?.effectiveDateTime || dr?.issued || '').slice(0, 10)
}

/** Title of a report as the handoff prints it. */
export function emrReportTitle(dr: any): string {
  return reportTitle(dr)
}

/** One report as a pasteable item, or null when it has no narrative text
 *  (image-only, viewer-only) or no usable date / title. */
export function toEmrReportItem(dr: any): EmrReportItem | null {
  const raw = reportNarrative(dr)
  if (!raw) return null
  const date = emrReportDate(dr)
  if (!date) return null
  const name = reportTitle(dr)
  if (!name) return null
  const key = `${date}|${normalizeForDedup(name)}|${normalizeForDedup(raw)}`
  return { id: dr?.id || key, date, name, org: reportOrg(dr), body: formatNarrative(raw), raw }
}

function emrReportDedupKey(item: EmrReportItem): string {
  return `${item.date}|${normalizeForDedup(item.name)}|${normalizeForDedup(item.raw)}`
}

/** Same narrative, ignoring whitespace — used to fold the separately billed
 *  2D and Doppler records of one echocardiogram into one paste. */
export function emrNarrativeKey(item: EmrReportItem): string {
  return normalizeForDedup(item.raw)
}

/** The reports a window selects, from an already-collected list. */
export function filterEmrReportsByRange(
  items: EmrReportItem[],
  range: EmrRange,
  now?: Date,
): EmrReportItem[] {
  // The draw-counting ranges keep whole exam DAYS: a same-day CXR + ECG pair is
  // one visit's worth of imaging, not two separate "last" results.
  const days = DRAW_COUNT_RANGES[range]
  if (days) {
    const keep = new Set([...new Set(items.map((r) => r.date))].slice(0, days))
    return items.filter((r) => keep.has(r.date))
  }
  const cutoff = emrRangeCutoff(range, now)
  return cutoff ? items.filter((r) => r.date >= cutoff) : items
}

/** True when the patient has any lab result at all, whatever the window. */
export function hasEmrLabData(pivots: Record<string, LabPivot>): boolean {
  return Object.values(pivots).some((pivot) => pivot.dates.length > 0)
}

/**
 * Report blocks: a `日期 檢查名稱` title line, then the narrative.
 *
 * Deliberately takes no `EmrPreset`. The preset shapes how lab VALUES are
 * written (units, four-digit years, panel headings) and has no meaningful
 * equivalent for a narrative, so letting it reach in here only made a
 * labs-shaped control look like it governed this section too.
 *
 * @param bodies optional per-report replacement text (the Chinese translation
 *   when the user switched the report language). A report with no entry keeps
 *   its source narrative — falling back is visible in the preview, whereas
 *   dropping the report would silently shorten the paste.
 */
export function buildEmrReportText(
  items: EmrReportItem[],
  bodies?: Record<string, string | undefined>,
): string {
  return items
    .map((r) => {
      const body = bodies?.[r.id]?.trim() || r.body
      return `${fullDate(r.date)} ${r.name}\n${body}`
    })
    .join('\n\n')
}

/**
 * A report translation ready for a plain textarea. The translation task is
 * allowed to answer in markdown (the source often has sections and lists), and
 * `**`/`#` noise in a chart is worse than losing the emphasis. Its own line
 * structure is kept as-is — unlike the source narrative it does not need
 * re-flowing, and running the English-keyword section parser over Chinese text
 * would only invent headings.
 */
export function translationToPlainText(translation: string): string {
  return markdownToPlainText(translation || '').replace(/\n{3,}/g, '\n\n').trim()
}

/** The two sections as one paste, separated by a blank line. */
export function joinEmrSections(labText: string, reportText: string): string {
  return [labText, reportText].filter((s) => s.trim().length > 0).join('\n\n')
}
