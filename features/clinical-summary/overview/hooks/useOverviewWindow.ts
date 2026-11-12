"use client"

// Range state for the 總覽 tab.
//
// The range a clinician picks is a preference: it is remembered (the caller
// stores it in 門診偏好) and the next chart opens on it. What is NOT carried
// over is a range that only applies to one chart — the window widened because
// this patient had nothing inside the remembered one. That lives here, tied to
// the chart it was made for, so the next patient starts from the remembered
// range again.
import { useCallback, useMemo, useState } from 'react'
import { useNow } from '@/src/shared/hooks/use-now.hook'
import {
  DEFAULT_OVERVIEW_RANGE_MONTHS,
  buildOverviewWindow,
  type OverviewRangeMonths,
  type OverviewWindow,
} from '../utils/overview-selectors'

export interface UseOverviewWindowResult {
  months: OverviewRangeMonths
  /** The reader picked this range on this chart. */
  setMonths: (months: OverviewRangeMonths) => void
  /** Show a longer window on this chart only, without it being a choice. */
  widenTo: (months: OverviewRangeMonths) => void
  /** The reader picked a range on this chart, so it is not widened for them. */
  chosenForChart: boolean
  window: OverviewWindow
}

interface ChartRange {
  chartKey: string | null
  months: OverviewRangeMonths
  chosen: boolean
}

/**
 * @param remembered the range last picked on any chart; `null` = never picked.
 * @param chartKey identifies the open chart (the patient id).
 */
export function useOverviewWindow(
  remembered: OverviewRangeMonths | null = null,
  chartKey: string | null = null,
): UseOverviewWindowResult {
  const [chartRange, setChartRange] = useState<ChartRange | null>(null)
  const forThisChart = chartRange && chartRange.chartKey === chartKey ? chartRange : null
  const months = forThisChart?.months ?? remembered ?? DEFAULT_OVERVIEW_RANGE_MONTHS
  // Re-anchor when the calendar day rolls over on a tab left open overnight.
  const nowMs = useNow()
  const window = useMemo(() => buildOverviewWindow(months, nowMs), [months, nowMs])
  const setMonths = useCallback(
    (next: OverviewRangeMonths) => setChartRange({ chartKey, months: next, chosen: true }),
    [chartKey],
  )
  const widenTo = useCallback(
    (next: OverviewRangeMonths) => setChartRange({ chartKey, months: next, chosen: false }),
    [chartKey],
  )
  return { months, setMonths, widenTo, chosenForChart: !!forThisChart?.chosen, window }
}
