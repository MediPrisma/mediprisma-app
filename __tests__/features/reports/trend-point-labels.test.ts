import { shouldShowTrendPointLabel } from '@/features/clinical-summary/reports/components/CumulativeLabTrendDetail'

describe('lab trend point labels', () => {
  it('keeps abnormal values visible in a long time window', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({
      abnormal: index === 4 || index === 8,
    }))

    expect(shouldShowTrendPointLabel(points, 3)).toBe(false)
    expect(shouldShowTrendPointLabel(points, 4)).toBe(true)
    expect(shouldShowTrendPointLabel(points, 8)).toBe(true)
    expect(shouldShowTrendPointLabel(points, 11)).toBe(true)
  })

  it('shows every value when the selected range contains eight points or fewer', () => {
    const points = Array.from({ length: 8 }, () => ({ abnormal: false }))

    expect(points.every((_, index) => shouldShowTrendPointLabel(points, index))).toBe(true)
  })

  it('labels a zoomed range by spacing, not by count', () => {
    const DAY = 24 * 60 * 60 * 1000
    // Two spread-out results, then six squeezed into six days, in a ~1 year view.
    const days = [0, 80, 150, 151, 152, 153, 154, 156, 240, 350]
    const points = days.map((day) => ({ abnormal: true, timestamp: day * DAY }))
    const span = 360 * DAY

    expect(shouldShowTrendPointLabel(points, 0, span)).toBe(true)
    expect(shouldShowTrendPointLabel(points, 1, span)).toBe(true)
    // Crowded results stay unlabelled even though they are abnormal.
    for (const index of [2, 3, 4, 5, 6, 7]) {
      expect(shouldShowTrendPointLabel(points, index, span)).toBe(false)
    }
    expect(shouldShowTrendPointLabel(points, 8, span)).toBe(true)
    // The latest result is always labelled.
    expect(shouldShowTrendPointLabel(points, 9, span)).toBe(true)

    // Narrowed to the crowded week, the same results have room again.
    const week = points.slice(2, 8)
    expect(week.every((_, index) => shouldShowTrendPointLabel(week, index, 7 * DAY))).toBe(true)
  })
})
