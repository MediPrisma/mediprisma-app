import type { LabTrendPoint } from '@/src/shared/utils/lab-trend.utils'

export type TrendWindow = '6m' | '1y' | '3y' | 'all'

export interface TrendTimeScale {
  domain: [number, number]
  ticks: number[]
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

  if (timestamps.length === 0) return { domain: [0, 1], ticks: [0, 1] }

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
  }
}
