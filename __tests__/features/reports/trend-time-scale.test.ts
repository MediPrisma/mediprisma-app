import { buildTrendTimeScale } from '@/features/clinical-summary/reports/utils/trend-time-scale'

const point = (iso: string) => ({ timestamp: Date.parse(iso) })

describe('fixed lab trend time scale', () => {
  it.each([
    ['2024-03-06T00:00:00Z', '2024-06-10T00:00:00Z'],
    ['2024-03-10T00:00:00Z', '2024-06-10T12:00:00Z'],
  ])('keeps both endpoints in an all-history group from %s to %s', (start, end) => {
    const scale = buildTrendTimeScale([point(start), point(end)], 'all')
    expect(scale.domain[0]).toBeLessThanOrEqual(Date.parse(start))
    expect(scale.domain[1]).toBe(Date.parse(end))
  })
  it('divides a six-month window into six calendar-month intervals', () => {
    const points = [
      point('2026-05-12T00:00:00.000Z'),
      point('2026-06-12T00:00:00.000Z'),
      point('2026-07-12T00:00:00.000Z'),
      point('2026-08-12T00:00:00.000Z'),
    ]

    const scale = buildTrendTimeScale(points, '6m')

    expect(scale.ticks).toHaveLength(7)
    expect(new Date(scale.domain[0]).toISOString()).toBe('2026-02-12T00:00:00.000Z')
    expect(new Date(scale.domain[1]).toISOString()).toBe('2026-08-12T00:00:00.000Z')
    expect(scale.ticks.map((timestamp) => new Date(timestamp).getUTCMonth() + 1)).toEqual([
      2, 3, 4, 5, 6, 7, 8,
    ])

    const mayPosition = (points[0].timestamp - scale.domain[0]) / (scale.domain[1] - scale.domain[0])
    expect(mayPosition).toBeGreaterThan(0.48)
    expect(mayPosition).toBeLessThan(0.52)
  })

  it('uses fixed two-month intervals for a one-year window', () => {
    const scale = buildTrendTimeScale([
      point('2026-02-12T00:00:00.000Z'),
      point('2026-08-12T00:00:00.000Z'),
    ], '1y')

    expect(scale.ticks).toHaveLength(7)
    expect(scale.ticks.map((timestamp) => {
      const date = new Date(timestamp)
      return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`
    })).toEqual([
      '2025-8', '2025-10', '2025-12', '2026-2', '2026-4', '2026-6', '2026-8',
    ])
  })

  it('expands all history to stable calendar intervals instead of data categories', () => {
    const scale = buildTrendTimeScale([
      point('2024-11-20T00:00:00.000Z'),
      point('2026-08-12T00:00:00.000Z'),
    ], 'all')

    expect(scale.ticks.length).toBeLessThanOrEqual(7)
    expect(scale.domain[0]).toBeLessThanOrEqual(Date.parse('2024-11-20T00:00:00.000Z'))
    expect(scale.domain[1]).toBe(Date.parse('2026-08-12T00:00:00.000Z'))
  })
})
