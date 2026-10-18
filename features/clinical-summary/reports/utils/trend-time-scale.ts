import type { LabTrendPoint } from '@/src/shared/utils/lab-trend.utils'

export type TrendWindow = '6m' | '1y' | '3y' | 'all'

export interface TrendTimeScale {
  domain: [number, number]
  ticks: number[]
  /** Granularity the axis labels should print. Preset windows are monthly. */
  tickUnit: 'month' | 'day' | 'time'
}

/**
 * Shift a timestamp by whole calendar months without letting dates at the end
 * of a long month spill into the following month (Aug 31 → Mar 3). Keeping the
 * source time-of-day also makes the chart boundary match the result timestamp.
 */
function shiftUtcMonths(timestamp: number, amount: number): number {
  const source = new Date(timestamp)
  const target = new Date(timestamp)
  const sourceDay = source.getUTCDate()

  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + amount)
  const daysInTargetMonth = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  target.setUTCDate(Math.min(sourceDay, daysInTargetMonth))
  return target.getTime()
}

const FIXED_WINDOW_MONTHS: Record<Exclude<TrendWindow, 'all'>, number> = {
  '6m': 6,
  '1y': 12,
  '3y': 36,
}

const STANDARD_ALL_WINDOW_STEPS = [1, 2, 3, 6, 12, 24, 36, 60]

/**
 * Build a calendar-based X axis instead of letting Recharts distribute the
 * available observations as categories. Fixed windows always contain six
 * periods: monthly for 6m, every two months for 1y, and every six months for
 * 3y. Sparse results therefore stay in their real time slots.
 */
export function buildTrendTimeScale(
  points: ReadonlyArray<Pick<LabTrendPoint, 'timestamp'>>,
  window: TrendWindow,
): TrendTimeScale {
  const timestamps = points
    .map((point) => point.timestamp)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  if (timestamps.length === 0) return { domain: [0, 1], ticks: [0, 1], tickUnit: 'month' }

  const end = timestamps.at(-1)!
  let stepMonths: number
  let segments: number

  if (window === 'all') {
    const earliest = timestamps[0]
    const startDate = new Date(earliest)
    const endDate = new Date(end)
    let monthSpan = Math.max(1,
      (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12
      + endDate.getUTCMonth() - startDate.getUTCMonth(),
    )
    // The first tick must contain the earliest result, including its day and
    // time. A March 6 → June 10 group needs four calendar months, not three.
    if (shiftUtcMonths(end, -monthSpan) > earliest) monthSpan += 1
    stepMonths = STANDARD_ALL_WINDOW_STEPS.find((step) => Math.ceil(monthSpan / step) <= 6)
      ?? STANDARD_ALL_WINDOW_STEPS.at(-1)!
    segments = Math.max(1, Math.ceil(monthSpan / stepMonths))
  } else {
    const windowMonths = FIXED_WINDOW_MONTHS[window]
    segments = 6
    stepMonths = windowMonths / segments
  }

  const ticks = Array.from({ length: segments + 1 }, (_, index) => (
    shiftUtcMonths(end, -stepMonths * (segments - index))
  ))

  return {
    domain: [ticks[0], end],
    ticks,
    tickUnit: 'month',
  }
}

export interface TrendCustomRange {
  start: number
  end: number
}

export interface TrendCluster extends TrendCustomRange {
  count: number
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const CUSTOM_MAX_SEGMENTS = 6
const CUSTOM_MINUTE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720]
const CUSTOM_DAY_STEPS = [1, 2, 3, 7, 14]
const CUSTOM_MONTH_STEPS = [1, 2, 3, 6, 12, 24]

/**
 * Pad a zoom selection so the first and last results sit inside the plot
 * instead of on its edges. The pad scales with the selection, so results a few
 * minutes apart still spread across the plot; only a selection with no span
 * (results sharing one timestamp) falls back to a fixed half day each side.
 */
export function padTrendRange(start: number, end: number): TrendCustomRange {
  const span = end - start
  const pad = span > 0 ? span * 0.1 : DAY_MS / 2
  return { start: start - pad, end: end + pad }
}

function localStartOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * X axis for a user-selected range. The tick unit follows the span so a
 * two-week admission reads in days and a single day in hours or minutes,
 * rather than the month ticks the preset windows use. Ticks fall on local
 * midnights / round clock times so they line up with the labels printed.
 */
export function buildCustomTrendTimeScale(range: TrendCustomRange): TrendTimeScale {
  const { start, end } = range
  const span = end - start
  const ticks: number[] = []

  if (span <= 2 * DAY_MS) {
    const stepMinutes = CUSTOM_MINUTE_STEPS.find((step) => span / (step * MINUTE_MS) <= CUSTOM_MAX_SEGMENTS)
      ?? CUSTOM_MINUTE_STEPS.at(-1)!
    const step = stepMinutes * MINUTE_MS
    // Align to a round local clock time (08:00, 08:15…), counted from local
    // midnight so whole-hour steps stay on the hour in any timezone.
    const midnight = localStartOfDay(start)
    const first = midnight + Math.ceil((start - midnight) / step) * step
    for (let tick = first; tick <= end; tick += step) ticks.push(tick)
    return { domain: [start, end], ticks, tickUnit: 'time' }
  }

  if (span <= 120 * DAY_MS) {
    const stepDays = CUSTOM_DAY_STEPS.find((step) => span / (step * DAY_MS) <= CUSTOM_MAX_SEGMENTS)
      ?? CUSTOM_DAY_STEPS.at(-1)!
    const cursor = new Date(localStartOfDay(start))
    if (cursor.getTime() < start) cursor.setDate(cursor.getDate() + 1)
    while (cursor.getTime() <= end) {
      ticks.push(cursor.getTime())
      cursor.setDate(cursor.getDate() + stepDays)
    }
    return { domain: [start, end], ticks, tickUnit: 'day' }
  }

  const spanMonths = span / (30 * DAY_MS)
  const stepMonths = CUSTOM_MONTH_STEPS.find((step) => spanMonths / step <= CUSTOM_MAX_SEGMENTS)
    ?? CUSTOM_MONTH_STEPS.at(-1)!
  const cursor = new Date(localStartOfDay(start))
  cursor.setDate(1)
  if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1)
  while (cursor.getTime() <= end) {
    ticks.push(cursor.getTime())
    cursor.setMonth(cursor.getMonth() + stepMonths)
  }
  return { domain: [start, end], ticks, tickUnit: 'month' }
}

/**
 * Runs of results taken close together (e.g. daily labs during an admission)
 * that occupy a sliver of the current window, so their points and labels pile
 * up. Offered as one-tap zoom targets; never used to hide or merge results.
 */
export function findDenseTrendClusters(
  points: ReadonlyArray<Pick<LabTrendPoint, 'timestamp'>>,
  domain: [number, number],
  {
    maxGapMs = 3 * DAY_MS,
    minCount = 4,
    maxShareOfWindow = 0.1,
    limit = 3,
  }: { maxGapMs?: number; minCount?: number; maxShareOfWindow?: number; limit?: number } = {},
): TrendCluster[] {
  const [windowStart, windowEnd] = domain
  const windowSpan = windowEnd - windowStart
  const timestamps = points
    .map((point) => point.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= windowEnd)
    .sort((left, right) => left - right)

  const clusters: TrendCluster[] = []
  let runStart = 0
  for (let index = 1; index <= timestamps.length; index += 1) {
    if (index < timestamps.length && timestamps[index] - timestamps[index - 1] <= maxGapMs) continue
    const count = index - runStart
    const start = timestamps[runStart]
    const end = timestamps[index - 1]
    if (count >= minCount && end - start < windowSpan * maxShareOfWindow) {
      clusters.push({ start, end, count })
    }
    runStart = index
  }
  return clusters.slice(0, limit)
}
