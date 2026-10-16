import { buildLabTrendSeries, groupLabTrendPoints } from '@/src/shared/utils/lab-trend.utils'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

function observation(day: number, value: number, unit?: string, text = 'Creatinine') {
  return {
    id: `lab-${day}`, status: 'final', code: { text },
    effectiveDateTime: `2026-01-${String(day).padStart(2, '0')}`,
    valueQuantity: { value, unit },
  }
}
function analyze(observations: any[], categoryId = 'chem') {
  const identity = getLabPivotTestIdentity(observations[0], categoryId, 'standardized')
  const series = buildLabTrendSeries(observations, { ...identity, categoryId, nameMode: 'standardized' })
  const row = buildLabPivots(observations)[categoryId]?.rows.find(row => row.mapKey === identity.mapKey)
  return { series, groups: groupLabTrendPoints(series.points, categoryId), row }
}

describe('unit groups for all laboratory trends', () => {
  it('opens non-eGFR groups independently and never shares ranges across units', () => {
    const results = [observation(1, 1, 'mg/dL'), observation(2, 1.2, 'mg/dL'), observation(3, 90, 'µmol/L'), observation(4, 95, 'µmol/L')]
      .map((point, index) => ({ ...point, referenceRange: [{ high: { value: index < 2 ? 1.3 : 110, unit: point.valueQuantity.unit } }] }))
    const { series, groups, row } = analyze(results)
    expect(series.chartable).toBe(true)
    expect(row?.trendChartable).toBe(true)
    expect(series.sharedReferenceRange).toBeUndefined()
    expect(groups).toHaveLength(2)
    expect(groups.find(group => group.unit === 'mg/dL')).toMatchObject({ chartable: true, sharedReferenceRange: { high: 1.3 } })
    expect(groups.find(group => group.unit === 'µmol/L')).toMatchObject({ chartable: true, sharedReferenceRange: { high: 110 } })
  })

  it('uses audited conversions before grouping, without treating an unknown label as an error', () => {
    const { groups, row } = analyze([observation(1, 10, 'mg/L', 'CRP'), observation(2, 2, 'mg/dL', 'CRP'), observation(3, 3, 'source label', 'CRP')])
    expect(row?.trendChartable).toBe(true)
    expect(groups[0].chartPoints.map(point => point.value)).toEqual([1, 2])
    expect(groups[0].unit).toBe('mg/dL')
    expect(groups[1]).toMatchObject({ unit: 'source label', chartable: false })
    expect(groups[1].points[0]).toMatchObject({ rawValue: 3, rawUnit: 'source label' })
  })

  it('keeps missing units and unknown unit case separate; never guesses equivalence', () => {
    const { groups, row } = analyze([observation(1, 1), observation(2, 2), observation(3, 3, 'mU/L'), observation(4, 4, 'MU/L')])
    expect(groups).toHaveLength(3)
    expect(row?.trendChartable).toBe(true)
    expect(groups[0]).toMatchObject({ unit: undefined, chartable: true })
    expect(groups.slice(1).every(group => !group.chartable)).toBe(true)
  })

  it('does not count comparator, cancelled or undated results toward a line', () => {
    const results = [observation(1, 1, 'mg/dL'), { ...observation(2, 2, 'mg/dL'), valueQuantity: { value: 2, unit: 'mg/dL', comparator: '<' } }, { ...observation(3, 3, 'mg/dL'), status: 'cancelled' }, { ...observation(4, 4, 'mg/dL'), effectiveDateTime: '' }]
    const { series, groups, row } = analyze(results)
    expect(series.chartable).toBe(false)
    expect(row?.trendChartable).toBe(false)
    expect(groups[0].points).toHaveLength(2)
    expect(groups[0].chartPoints).toHaveLength(1)
  })

  it('honors UCUM code precedence on both pivot and series', () => {
    const results = [1, 2].map(day => ({ ...observation(day, day, 'source label', 'CRP'), valueQuantity: { value: day, unit: 'source label', code: 'mg/dL', system: 'http://unitsofmeasure.org' } }))
    const { groups, row } = analyze(results)
    expect(row?.trendChartable).toBe(true)
    expect(groups).toHaveLength(1)
    expect(groups[0].unit).toBe('mg/dL')
  })

  it('separates blood-gas specimens even with matching units', () => {
    const results = [1, 2, 3, 4].map(day => ({
      ...observation(day, 30 + day, 'mmHg', 'PCO2'),
      specimen: { reference: day < 3 ? 'Specimen/a' : 'Specimen/v' },
    }))
    const { groups, row } = analyze(results, 'bloodgas')
    expect(row?.trendChartable).toBe(true)
    expect(groups).toHaveLength(2)
    expect(groups.every(group => group.chartable && new Set(group.points.map(point => point.specimen)).size === 1)).toBe(true)
    expect(analyze([results[0], results[2]], 'bloodgas').row?.trendChartable).toBe(false)
  })
})
