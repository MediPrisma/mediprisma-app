// lab-day-grouping.ts
// 健保存摺 ships labs as ONE DiagnosticReport per analyte (or small panel) —
// a hospital 生化 panel arrives as 10+ single-item DRs, so the Lab tab reads
// as shredded paper strips instead of the "一份檢驗單展開閱讀" clinicians
// expect. This module folds same-(collection day, institution, LAB CATEGORY)
// lab DRs into one synthetic group row rendered by LabDayGroupCard — the
// hospital reading unit: 血液一份報告、生化一份報告 (user feedback
// 2026-07-07; a whole-day mega-sheet matched neither the NHI原樣 nor the
// hospital's per-section report). Category vocabulary = the cumulative
// report's LAB_CATEGORIES, so both views speak the same words.
// Source-program provenance is also a group boundary: an adult preventive
// exam must never lend its provenance label to an ordinary same-day lab.
//
// Pure DISPLAY-level aggregation (sibling of multi-region-grouping.ts):
//   • every member Row keeps its own DR identity — source citations, trend
//     dialogs, bridge-dup badges and 向右展開 keep working per member, and
//     nothing about the underlying data shape is suppressed (the
//     no-mask-bridge-bugs rule);
//   • members are ordered by lab-categories (CBC → 生化 → …, the cumulative
//     report's order) so a group reads like a printed lab sheet, not bridge
//     arrival order;
//   • rows without a collection date never cluster — they pass through
//     unchanged rather than being hidden or guessed at;
//   • single-report days STILL become a day card — mixing bare report rows
//     (title-first) between day cards (date-first) read as visual noise, so
//     the by-day view keeps ONE uniform row shape (user feedback 2026-07-07).

import {
  LAB_CATEGORIES,
  categorizeObservation,
  compareTestsByPreferred,
  type LabCategory,
} from '@/src/shared/utils/lab-categories'
import { getAnalyteLabel, getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
import { isObservationAbnormal } from '@voho0000/clinical-lab-normalization/interpretation'
import type { Observation, Row } from '../types'

const CHEM_CATEGORY = LAB_CATEGORIES.find((c) => c.id === 'chem') ?? null

// Day-card taxonomy tweak (day cards ONLY — the cumulative report keeps its
// dedicated 血糖 sub-tab with the subtype breakdown). Blood glucose AND HbA1c
// run on the chemistry analyzer and sit beside BUN/CREA/electrolytes on a
// hospital 生化 單, so folding them into the 生化 card de-fragments the day view
// instead of issuing a lone 血糖 card (a standalone HbA1c card read oddly —
// user decision 2026-07-07). Keyed on the CANONICAL key so subtype variants
// (GLUCOSE-AC / finger sugar / n-hr PC) fold too. C-peptide categorises as
// 內分泌 (endocrine), never glucose, so it's inherently separate anyway; kept
// here only as a defensive guard.
const GLUCOSE_KEEP_SEPARATE = new Set(['C-PEPTIDE'])

/** Normalise a date to the LOCAL calendar day (YYYY-MM-DD) for grouping.
 *  Must match what the card header displays (toLocaleDateString) — a raw
 *  string slice would file a UTC-stamped draw ("…T18:00:00Z") under a
 *  different day than the header shows. NHI bridge data carries +08:00 so
 *  both agree today, but foreign-formatted bundles must not split a card
 *  from its own header date. Unparseable strings fall back to the slice.
 *  Empty string when missing. */
function dayKey(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return iso.slice(0, 10)
}

/** Day-card category for a row — like memberCategory, but plain glucose is
 *  refiled under chem (see GLUCOSE_KEEP_SEPARATE). This is the category the
 *  day cards cluster and sort by; memberCategory stays the true (cumulative)
 *  category so the two views can legitimately differ here. */
/** True for glucose-category rows that must NOT fold into 生化. Only C-peptide
 *  is listed, and in practice it categorises as 內分泌 (endocrine) rather than
 *  glucose, so it already sits in its own card — the set is a defensive guard.
 *  HbA1c now folds into the 生化 card with plain glucose (user decision
 *  2026-07-07); it resolves cleanly to its canonical key (LOINC 4548-4 →
 *  HBA1C). */
function staysInGlucose(row: Row): boolean {
  const key = getAnalyteCanonicalKey(row.obs?.[0])
  return !!key && GLUCOSE_KEEP_SEPARATE.has(key)
}

function dayCardCategory(row: Row): LabCategory | null {
  const cat = memberCategory(row)
  if (cat?.id === 'glucose' && CHEM_CATEGORY && !staysInGlucose(row)) {
    return CHEM_CATEGORY
  }
  return cat
}

/** Category id a row files under — 'other' for narratives / uncategorised. */
function rowCategoryId(row: Row): string {
  return dayCardCategory(row)?.id ?? 'other'
}

function clusterKey(row: Row): string {
  return `${dayKey(row.effectiveDate)}|${(row.institution ?? '').trim()}|${rowCategoryId(row)}|${row.sourceProgram ?? ''}|${row.sourceProvenance ?? ''}`
}

// Category rank lookup — index in LAB_CATEGORIES so members sort in the same
// order the cumulative report presents its sub-tabs.
const CATEGORY_RANK = new Map(LAB_CATEGORIES.map((c, i) => [c.id, i]))
const UNCATEGORIZED_RANK = LAB_CATEGORIES.length

/** The lab category a member row belongs to — from its first categorisable
 *  observation. Uncategorised rows (narrative cultures, 0-obs DRs, specimen
 *  types outside the cumulative allowlist) return null and sink to the tail,
 *  so numeric analytes read first, like a printed lab sheet. Exported for
 *  LabDayGroupCard's section headers so grouping and rendering can't diverge. */
export function memberCategory(row: Row): LabCategory | null {
  for (const o of row.obs || []) {
    const cat = categorizeObservation(o)
    if (cat) return cat
  }
  return null
}

/** Order members like a hospital lab sheet: category order first (CBC → 生化
 *  → …), then the category's preferredOrder over canonical analyte keys
 *  (WBC → RBC → HB …), then title as the stable tail. */
function compareMembers(a: Row, b: Row): number {
  const ca = dayCardCategory(a)
  const cb = dayCardCategory(b)
  const ra = ca ? (CATEGORY_RANK.get(ca.id) ?? UNCATEGORIZED_RANK) : UNCATEGORIZED_RANK
  const rb = cb ? (CATEGORY_RANK.get(cb.id) ?? UNCATEGORIZED_RANK) : UNCATEGORIZED_RANK
  if (ra !== rb) return ra - rb
  if (ca && cb && ca.id === cb.id) {
    // getAnalyteLabel = canonical English key — the value preferredOrder is
    // written in (never the audience/language display string).
    const cmp = compareTestsByPreferred(ca)(getAnalyteLabel(a.obs[0]), getAnalyteLabel(b.obs[0]))
    if (cmp !== 0) return cmp
  }
  const byTitle = (a.title || '').localeCompare(b.title || '')
  if (byTitle !== 0) return byTitle
  // Same analyte drawn multiple times that day (serial troponin, repeat CBC):
  // newest first, matching the app-wide date-desc convention. ReportRow shows
  // a time-only badge on these rows (hideMeta + showTime) so the order is
  // visible, not just deterministic.
  const ta = a.effectiveDate ? new Date(a.effectiveDate).getTime() : 0
  const tb = b.effectiveDate ? new Date(b.effectiveDate).getTime() : 0
  return tb - ta
}

/** Abnormal-observation count across a set of rows — same per-obs logic as
 *  ReportRow's badge (interpretation tag first, reference-range fallback,
 *  component-level check for composites). */
export function countAbnormalInRows(rows: Row[]): number {
  let count = 0
  for (const row of rows) {
    for (const o of row.obs || []) {
      if (isObservationAbnormal(o)) {
        count++
        continue
      }
      if (Array.isArray(o.component)) {
        for (const c of o.component as Observation[]) {
          if (isObservationAbnormal(c)) {
            count++
            break
          }
        }
      }
    }
  }
  return count
}

/**
 * Walk a flat list of lab report rows, cluster by (collection day,
 * institution, lab category, source program), and replace every cluster — including
 * single-report ones, for a uniform row shape — with one synthetic group
 * row whose `groupedRows` holds the originals (pre-sorted by
 * preferredOrder). Only undated rows pass through.
 *
 * Output ordering is DETERMINISTIC, not arrival order: collection day desc
 * (the list's convention), then institution, then LAB_CATEGORIES rank — so
 * a day's cards always read 血液 → 生化 → … like a hospital report stack.
 * Undated pass-through rows sort last. The render layer switches on
 * `row.dayGroup` and renders LabDayGroupCard instead of the default
 * ReportRow.
 */
export function groupLabReportsByDay(rows: Row[]): Row[] {
  if (rows.length < 2) return rows
  const clusters = new Map<string, { firstIdx: number; rows: Row[] }>()
  rows.forEach((row, idx) => {
    if (!dayKey(row.effectiveDate)) return // undated rows never cluster
    const key = clusterKey(row)
    const c = clusters.get(key)
    if (c) c.rows.push(row)
    else clusters.set(key, { firstIdx: idx, rows: [row] })
  })

  const out: Row[] = []
  rows.forEach((row, idx) => {
    if (!dayKey(row.effectiveDate)) {
      out.push(row)
      return
    }
    const cluster = clusters.get(clusterKey(row))!
    if (idx !== cluster.firstIdx) return // already emitted as part of the group
    out.push(buildDayGroupRow(cluster.rows))
  })
  // Deterministic stack order: day desc → institution → category rank.
  // Without this, a day's category cards would come out in bridge arrival
  // order — 內分泌 before 血液 one day, after it the next.
  out.sort((a, b) => {
    const da = dayKey(a.effectiveDate)
    const db = dayKey(b.effectiveDate)
    if (da !== db) return da < db ? 1 : -1 // '' (undated) sorts last
    const ia = (a.institution ?? '').trim()
    const ib = (b.institution ?? '').trim()
    if (ia !== ib) return ia.localeCompare(ib)
    const sa = a.sourceProgram ?? ''
    const sb = b.sourceProgram ?? ''
    if (sa !== sb) return sa.localeCompare(sb)
    const pa = a.sourceProvenance ?? ''
    const pb = b.sourceProvenance ?? ''
    if (pa !== pb) return pa.localeCompare(pb)
    return groupCategoryRank(a) - groupCategoryRank(b)
  })
  return out
}

function groupCategoryRank(row: Row): number {
  if (!row.dayGroup) return UNCATEGORIZED_RANK + 1 // flat pass-through rows tail their day
  const id = row.dayGroupCategoryId
  return id && id !== 'other' ? (CATEGORY_RANK.get(id) ?? UNCATEGORIZED_RANK) : UNCATEGORIZED_RANK
}

/** The category ids the card's chip should name. Normally just the cluster
 *  category — but the chem cluster ABSORBS plain glucose (dayCardCategory), so
 *  a chem card labels itself by its ACTUAL contents: `['chem']` (生化),
 *  `['glucose']` (血糖), or `['chem','glucose']` (生化・血糖). A 生化 chip on an
 *  all-glucose card reads wrong (user feedback 2026-07-07). Ordered by
 *  LAB_CATEGORIES rank (chem before glucose). */
export function dayGroupLabelIds(categoryId: string, members: Row[]): string[] {
  if (categoryId !== 'chem') return [categoryId]
  const present = new Set<string>()
  for (const m of members) present.add(memberCategory(m)?.id === 'glucose' ? 'glucose' : 'chem')
  return ['chem', 'glucose'].filter((id) => present.has(id))
}

/** Build the synthetic Row for one collection day. Copies the head row's
 *  display-relevant fields so the row sits naturally amongst ungrouped
 *  siblings; per-member flags (dup badges, images) stay on the members —
 *  the group row must not re-assert them at the top level. */
function buildDayGroupRow(rows: Row[]): Row {
  const head = rows[0]
  const sorted = [...rows].sort(compareMembers)
  const categoryId = rowCategoryId(head)
  return {
    ...head,
    hospitalSource: rows.some(row => row.hospitalSource === 'cloud-and-in-house')
      || (rows.some(row => row.hospitalSource === 'in-house') && rows.some(row => row.hospitalSource === 'cloud'))
      ? 'cloud-and-in-house' : rows.some(row => row.hospitalSource === 'in-house') ? 'in-house' : head.hospitalSource,
    // Distinct id so virtualizer keys don't collide with the underlying row.
    id: `labday:${clusterKey(head)}`,
    title: head.title, // a11y / plain-Row-consumer fallback; the card renders its own header
    obs: [], // members carry their own obs; the group row has none of its own
    images: undefined,
    isPossibleDuplicate: undefined,
    bridgeDupCount: undefined,
    groupedRows: sorted,
    dayGroup: true,
    // Cluster category (drives stacking rank). NOTE: for a chem cluster this
    // is always 'chem' even when the card holds only glucose — the CHIP label
    // comes from dayGroupLabelIds below, which reads actual contents.
    dayGroupCategoryId: categoryId,
    dayGroupLabelIds: dayGroupLabelIds(categoryId, sorted),
  }
}
