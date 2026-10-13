// A folded IEP / IFE report column gathers different analytes (IgG, IgA, κ
// lanes) under one key. It must never be a numeric series: no trend
// availability, no trend points, no abnormal flag. Invariant over the demo
// bundle plus synthetic lanes: every trend series holds one analyte only.
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { isParaproteinTextKey } from '@/src/shared/utils/paraprotein-analytes'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
let seq = 0
function lane(item: string, nhi: string, value: number, date: string, extra: Record<string, any> = {}) {
  seq += 1
  return {
    resourceType: 'Observation', id: `lane-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi }] },
    valueQuantity: { value, unit: 'mg/dL' },
    effectiveDateTime: `${date}T08:00:00+08:00`,
    ...extra,
  }
}

const LANES = [
  lane('IgG', '12103B', 1000, '2026-01-01'), lane('IgA', '12103B', 200, '2026-01-01'),
  lane('IgG', '12103B', 1100, '2026-04-01', { interpretation: [{ coding: [{ code: 'H' }] }] }),
  lane('IgA', '12103B', 250, '2026-04-01'),
  lane('IgG', '12159B', 5, '2026-01-01', { specimen: { display: 'Urine' } }),
  lane('IgA', '12159B', 6, '2026-04-01', { specimen: { display: 'Urine' } }),
]

describe('folded report columns are never numeric series', () => {
  const pivot = buildLabPivots(LANES).immuno
  const report = pivot.rows.find((r) => r.testKey === 'PP:IFE')!

  it('is not trend-chartable even with numeric lanes in one unit', () => {
    expect(report.values.size).toBe(2)
    expect(report.trendChartable).toBe(false)
    expect(pivot.rows.find((r) => r.testKey === 'PP:U:IFE')!.trendChartable).toBe(false)
  })

  it('builds no trend points for it', () => {
    const series = buildLabTrendSeries(LANES, {
      categoryId: 'immuno', mapKey: report.mapKey, testKey: report.testKey, displayName: report.displayName, nameMode: 'standardized',
    } as any)
    expect(series.points).toHaveLength(0)
    expect(series.chartable).toBe(false)
  })

  it('carries no abnormal flag', () => {
    const cell = report.values.get('2026-04-01')!
    expect(cell.isAbnormal).toBe(false)
    expect((cell.sourceRecords ?? []).every((record) => !record.isAbnormal)).toBe(true)
  })
})

describe('invariant: a trend series holds one analyte', () => {
  const bundle = JSON.parse(readFileSync(join(process.cwd(), 'public/demo/demo-bundle.json'), 'utf8'))
  const observations = [
    ...(bundle.entry ?? []).map((e: any) => e.resource).filter((r: any) => r?.resourceType === 'Observation'),
    ...LANES,
  ]
  it('for every pivot row of every category', () => {
    const failures: string[] = []
    const byId = new Map(observations.map((o: any) => [o.id, o]))
    for (const [categoryId, pivot] of Object.entries(buildLabPivots(observations))) {
      for (const row of pivot.rows) {
        const series = buildLabTrendSeries(observations, {
          categoryId, mapKey: row.mapKey, testKey: row.testKey, displayName: row.displayName, nameMode: 'standardized',
        } as any)
        if (isParaproteinTextKey(row.testKey)) {
          if (series.points.length > 0 || row.trendChartable) failures.push(`${categoryId}/${row.testKey}: folded report has a series`)
          continue
        }
        const keys = new Set(series.points.map((point: any) => {
          const obs: any = byId.get(point.id)
          const category = categorizeObservation(obs)?.id
          return getLabPivotTestIdentity(obs, category).testKey
        }))
        if (keys.size > 1) failures.push(`${categoryId}/${row.testKey}: ${[...keys].join(' + ')}`)
      }
    }
    expect(failures).toEqual([])
  })
})
