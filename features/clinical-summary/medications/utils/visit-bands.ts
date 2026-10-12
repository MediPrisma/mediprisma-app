// Visit banding — rows prescribed at the same outpatient visit (same start
// day + institution) share an alternating background band, in both the
// current-medication list and the medication history.
import type { MedicationRow } from '../types'
import type { MedicationHistoryGroup } from '../hooks/useGroupedMedications'

/** Sortable YYYY-MM-DD for a display date, only when it is unambiguous
 *  (year first, as zh-TW renders "2026/8/5"). Month/day-first locale strings
 *  ("10/1/2026", "1/10/2026") can't be told apart, so they return '' rather
 *  than a guess. Rows built by useMedicationRows carry *Iso fields and never
 *  reach this fallback. */
export function dateSortKey(value?: string): string {
  const match = value?.trim().match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})(?!\d)/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function startDayOf(m?: MedicationRow): string {
  return m?.startedOnIso || dateSortKey(m?.startedOn)
}

function latestDayOf(m?: MedicationRow): string {
  return m?.endDateIso || dateSortKey(m?.endDate || m?.stoppedOn) || startDayOf(m)
}

/** One outpatient visit ≈ start day + institution. Falls back to a per-row
 *  key when the start day is unknown or ambiguous, so an undated row is never
 *  merged into a neighbouring visit. */
export function visitKeyOfRow(m: MedicationRow | undefined, fallbackKey: string): string {
  const started = startDayOf(m)
  if (!started) return `row:${fallbackKey}`
  return `${started}|${(m?.pharmacy ?? '').trim()}`
}

/** Visit of a history group = visit of its latest (representative) fill. */
export function visitKeyOf(group: MedicationHistoryGroup): string {
  return visitKeyOfRow(group.medications[0], group.key)
}

/** Newest visit first; rows of one visit stay adjacent (institution, then the
 *  fill that ran longest). Ties keep their incoming order (stable sort). */
export function compareRowsByVisit(a?: MedicationRow, b?: MedicationRow): number {
  const byVisitDate = (startDayOf(b) || latestDayOf(b))
    .localeCompare(startDayOf(a) || latestDayOf(a))
  if (byVisitDate !== 0) return byVisitDate
  const byInstitution = (a?.pharmacy ?? '').localeCompare(b?.pharmacy ?? '')
  if (byInstitution !== 0) return byInstitution
  return latestDayOf(b).localeCompare(latestDayOf(a))
}

export interface VisitBand {
  /** Alternates 0/1 each time the visit changes. */
  band: 0 | 1
  /** First row of a visit (other than the very first row). */
  visitStart: boolean
  /** Rows in this visit, set on the visit's FIRST row (including index 0)
   *  so it can render the visit header; 0 on the rest. */
  headerCount: number
}

/** Alternating band per visit for an already-sorted list of visit keys. */
export function bandsFromVisitKeys(keys: string[]): VisitBand[] {
  let band: 0 | 1 = 0
  const bands = keys.map((key, index): VisitBand => {
    const changed = index > 0 && key !== keys[index - 1]
    if (changed) band = band === 0 ? 1 : 0
    return { band, visitStart: changed, headerCount: 0 }
  })
  let first = 0
  keys.forEach((key, index) => {
    if (index > 0 && key !== keys[index - 1]) first = index
    bands[first].headerCount += 1
  })
  return bands
}

/** Diagnosis to show in a visit header: only when every row of the visit
 *  carries the same ICD code — a mixed visit gets none rather than a guess. */
export function sharedVisitIcd(rows: Array<MedicationRow | undefined>): { code: string; text?: string } | undefined {
  const first = rows[0]
  if (!first?.icdCode) return undefined
  if (!rows.every((row) => row?.icdCode === first.icdCode)) return undefined
  return { code: first.icdCode, text: first.icdText }
}

export function assignVisitBands(groups: MedicationHistoryGroup[]): VisitBand[] {
  return bandsFromVisitKeys(groups.map(visitKeyOf))
}

export function assignRowVisitBands(rows: MedicationRow[]): VisitBand[] {
  return bandsFromVisitKeys(rows.map((row, index) => visitKeyOfRow(row, row.id || String(index))))
}

/** Tint for the alternate band. */
export const visitBandTintClass = 'bg-sky-500/[0.07] dark:bg-sky-400/[0.09]'
