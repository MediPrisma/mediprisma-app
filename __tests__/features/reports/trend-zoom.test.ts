import { resolveTrendDragSelection } from '@/features/clinical-summary/reports/components/CumulativeLabTrendDetail'
import {
  buildCustomTrendTimeScale,
  buildTrendTimeScale,
  findDenseTrendClusters,
  padTrendRange,
} from '@/features/clinical-summary/reports/utils/trend-time-scale'

const DAY = 24 * 60 * 60 * 1000
const point = (iso: string) => ({ timestamp: Date.parse(iso) })

// Monthly outpatient results around a two-week admission with near-daily labs.
const admission = [
  '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06',
  '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-12', '2026-03-13',
  '2026-03-15', '2026-03-16', '2026-03-18',
]
const series = [
  '2025-10-05', '2025-11-16', '2025-12-28', '2026-02-08',
  ...admission,
  '2026-04-20', '2026-06-01', '2026-07-13', '2026-08-24', '2026-09-20',
].map((date) => point(`${date}T00:00:00.000Z`))

describe('dense trend clusters', () => {
  it('finds an admission that is squeezed into a one-year window', () => {
    const { domain } = buildTrendTimeScale(series, '1y')
    expect(findDenseTrendClusters(series, domain)).toEqual([{
      start: Date.parse('2026-03-02T00:00:00.000Z'),
      end: Date.parse('2026-03-18T00:00:00.000Z'),
      count: admission.length,
    }])
  })

  it('does not flag a run that already fills a large share of the window', () => {
    const domain: [number, number] = [Date.parse('2026-02-25T00:00:00.000Z'), Date.parse('2026-03-25T00:00:00.000Z')]
    expect(findDenseTrendClusters(series, domain)).toEqual([])
  })

  it('ignores short runs and results outside the window', () => {
    const sparse = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-06-01'].map((date) => point(`${date}T00:00:00.000Z`))
    expect(findDenseTrendClusters(sparse, buildTrendTimeScale(sparse, '1y').domain)).toEqual([])
    expect(findDenseTrendClusters(series, buildTrendTimeScale(series, '6m').domain)).toEqual([])
  })
})

describe('custom trend time scale', () => {
  it('pads a selection so its end points stay inside the plot', () => {
    const range = padTrendRange(Date.parse('2026-03-02T00:00:00.000Z'), Date.parse('2026-03-18T00:00:00.000Z'))
    expect(range.start).toBeLessThan(Date.parse('2026-03-02T00:00:00.000Z'))
    expect(range.end).toBeGreaterThan(Date.parse('2026-03-18T00:00:00.000Z'))
    const sameTime = padTrendRange(1000, 1000)
    expect(sameTime.end - sameTime.start).toBe(DAY)
  })

  it('scales the pad with a minutes-apart selection so the results spread across the plot', () => {
    const start = Date.parse('2026-03-02T08:00:00+08:00')
    const end = Date.parse('2026-03-02T08:05:00+08:00')
    const range = padTrendRange(start, end)
    // The two results occupy most of the domain instead of ~0.3% of a day.
    expect((end - start) / (range.end - range.start)).toBeGreaterThan(0.8)

    const scale = buildCustomTrendTimeScale(range)
    expect(scale.tickUnit).toBe('time')
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2)
    expect(scale.ticks.length).toBeLessThanOrEqual(7)
    for (const tick of scale.ticks) {
      expect(tick).toBeGreaterThanOrEqual(range.start)
      expect(tick).toBeLessThanOrEqual(range.end)
      expect(new Date(tick).getSeconds()).toBe(0)
    }
  })

  it('uses day ticks on local midnights for an admission-length range', () => {
    const scale = buildCustomTrendTimeScale(padTrendRange(
      Date.parse('2026-03-02T00:00:00.000Z'),
      Date.parse('2026-03-18T00:00:00.000Z'),
    ))
    expect(scale.tickUnit).toBe('day')
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3)
    expect(scale.ticks.length).toBeLessThanOrEqual(7)
    for (const tick of scale.ticks) {
      expect(tick).toBeGreaterThanOrEqual(scale.domain[0])
      expect(tick).toBeLessThanOrEqual(scale.domain[1])
      const date = new Date(tick)
      expect(date.getHours() + date.getMinutes()).toBe(0)
    }
  })

  it('uses hour ticks within a single day and month ticks for long ranges', () => {
    const day = buildCustomTrendTimeScale({
      start: Date.parse('2026-03-02T00:00:00.000Z'),
      end: Date.parse('2026-03-02T20:00:00.000Z'),
    })
    expect(day.tickUnit).toBe('time')
    for (const tick of day.ticks) expect(new Date(tick).getMinutes()).toBe(0)
    expect(day.ticks.length).toBeGreaterThanOrEqual(3)
    expect(day.ticks.length).toBeLessThanOrEqual(7)

    const long = buildCustomTrendTimeScale({
      start: Date.parse('2025-01-10T00:00:00.000Z'),
      end: Date.parse('2026-01-10T00:00:00.000Z'),
    })
    expect(long.tickUnit).toBe('month')
    expect(long.ticks.length).toBeLessThanOrEqual(7)
    expect(new Date(long.ticks[0]).getDate()).toBe(1)
  })
})

describe('drag selection on the trend chart', () => {
  const points = [point('2026-03-02T00:00:00Z'), point('2026-03-03T00:00:00Z'), point('2026-03-05T00:00:00Z')]

  it('treats a short pointer travel as a click', () => {
    expect(resolveTrendDragSelection(points, 0, 2, 3)).toEqual({ kind: 'click' })
  })

  it('reports a real drag that stays on one result instead of ignoring it', () => {
    expect(resolveTrendDragSelection(points, 1, 1, 40)).toEqual({ kind: 'too-few' })
  })

  it('zooms between the first and last selected results in either drag direction', () => {
    const expected = { kind: 'zoom', start: points[0].timestamp, end: points[2].timestamp }
    expect(resolveTrendDragSelection(points, 0, 2, 120)).toEqual(expected)
    expect(resolveTrendDragSelection(points, 2, 0, 120)).toEqual(expected)
  })
})
