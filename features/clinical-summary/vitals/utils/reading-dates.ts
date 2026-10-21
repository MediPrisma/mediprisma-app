// Dating vital readings: group readings taken on the same day from the same
// source program, and say how long ago that day was. Both read the calendar
// date as the source wrote it, so a reading never moves to a neighbouring day
// with the viewer's timezone.
import type { VitalReading } from '../types'

export interface VitalReadingGroup {
  /** '2018-02-12', or '2018-02' / '2018' for a partial date; '' when undated. */
  day: string
  /** Shared by every reading in the group, so a 成人預防保健 badge on the line
   *  never covers a same-day reading from elsewhere. */
  sourceProgram?: VitalReading['sourceProgram']
  readings: VitalReading[]
}

export type ReadingAge =
  | { unit: 'today' }
  | { unit: 'days' | 'months' | 'years'; n: number }

const DAY_PREFIX = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?=$|T)/

export function readingDay(effective?: string): string {
  return effective ? (DAY_PREFIX.exec(effective.trim())?.[0] ?? '') : ''
}

/** Same-day, same-source readings together, newest day first, undated last;
 *  readings keep their display order within a group. */
export function groupReadingsByDay(readings: VitalReading[]): VitalReadingGroup[] {
  const groups = new Map<string, VitalReadingGroup>()
  for (const r of readings) {
    const day = readingDay(r.effective)
    const key = `${day}|${r.sourceProgram ?? ''}`
    const group = groups.get(key) ?? { day, sourceProgram: r.sourceProgram, readings: [] }
    group.readings.push(r)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => (a.day === '' ? 1 : b.day === '' ? -1 : b.day.localeCompare(a.day)))
}

/** Whole days, then calendar months, then years before `today`; null for a
 *  partial or unparseable date. */
export function readingAge(day: string, today: Date = new Date()): ReadingAge | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const then = new Date(y, mo - 1, d)
  if (Number.isNaN(then.getTime())) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((start.getTime() - then.getTime()) / 86_400_000)
  if (days <= 0) return { unit: 'today' }
  const months =
    (start.getFullYear() - y) * 12 + (start.getMonth() - (mo - 1)) - (start.getDate() < d ? 1 : 0)
  if (months < 1) return { unit: 'days', n: days }
  if (months < 12) return { unit: 'months', n: months }
  return { unit: 'years', n: Math.floor(months / 12) }
}
