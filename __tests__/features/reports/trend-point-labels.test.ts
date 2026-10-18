import { pickTrendLabels, shouldShowTrendPointLabel } from '@/features/clinical-summary/reports/components/CumulativeLabTrendDetail'

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

  it('makes every result a candidate when zoomed', () => {
    const points = Array.from({ length: 19 }, () => ({ abnormal: false }))
    expect(points.every((_, index) => shouldShowTrendPointLabel(points, index, true))).toBe(true)
  })
})

describe('pickTrendLabels', () => {
  const box = (index: number, x: number, y: number, priority: number, text = '4.3') => ({ index, x, y, text, priority })

  it('drops labels that would collide on a narrow plot and keeps the latest', () => {
    // 19 equal daily values ~12px apart: '4.3' is ~18px wide, so neighbours collide.
    const boxes = Array.from({ length: 19 }, (_, index) => box(index, 40 + index * 12.13, 100, index === 18 ? 1000 : index))
    const picked = pickTrendLabels(boxes)
    expect(picked.has(18)).toBe(true)
    const xs = [...picked].map((index) => boxes[index].x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(20)
    expect(picked.size).toBeGreaterThan(5)
    expect(picked.size).toBeLessThan(19)
  })

  it('keeps labels that are close in time but far apart vertically', () => {
    const picked = pickTrendLabels([box(0, 100, 50, 1), box(1, 106, 120, 2)])
    expect([...picked].sort()).toEqual([0, 1])
  })

  it('keeps every label when there is room, and prefers higher priority on a clash', () => {
    expect(pickTrendLabels([box(0, 50, 80, 1), box(1, 100, 80, 2), box(2, 150, 80, 3)]).size).toBe(3)
    expect([...pickTrendLabels([box(0, 100, 80, 1), box(1, 105, 80, 9)])]).toEqual([1])
  })
})
