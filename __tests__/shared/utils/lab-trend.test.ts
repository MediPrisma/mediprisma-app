import {
  assessLabTrendCompatibility,
  buildLabTrendSeries,
  type LabTrendSelection,
} from '@/src/shared/utils/lab-trend.utils'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

function selectionFor(observation: any, categoryId = 'chem'): LabTrendSelection {
  const identity = getLabPivotTestIdentity(observation, categoryId, 'standardized')
  return {
    categoryId,
    mapKey: identity.mapKey,
    testKey: identity.testKey,
    displayName: identity.displayName,
    nameMode: 'standardized',
  }
}

describe('buildLabTrendSeries', () => {
  it.each(['eGFR(MDRD)', 'eGFR(CKD-EPI,新)', 'mL/min', '%'])(
    'retains an eGFR result with unit %s in history while charting comparable results', (unit) => {
      const make = (day: string, value: number, unit: string) => ({
        id: `egfr-${day}`, status: 'final', code: { text: 'eGFR' },
        effectiveDateTime: `2026-01-${day}`,
        valueQuantity: { value, unit },
      })
      const observations = [make('01', 70, 'mL/min/1.73m2'), make('02', 65, 'mL/min/1.73m²'), make('03', 60, unit)]
      const selection = selectionFor(observations[0])
      const series = buildLabTrendSeries(observations, selection)
      expect(series.chartable).toBe(true)
      expect(series.chartPoints.map(point => point.value)).toEqual([70, 65])
      expect(series.points).toHaveLength(3)
      expect(series.points[2]).toMatchObject({ value: 60, rawUnit: unit, plotEligible: false, plotExclusionReason: 'unrecognized-unit' })
      expect(buildLabPivots(observations).chem.rows.find(row => row.testKey === selection.testKey)?.trendChartable).toBe(true)
      const insufficient = observations.slice(1)
      expect(buildLabTrendSeries(insufficient, selection).chartable).toBe(false)
      expect(buildLabPivots(insufficient).chem.rows.find(row => row.testKey === selection.testKey)?.trendChartable).toBe(false)
    },
  )
  it('assesses unit compatibility from the selected points instead of all history', () => {
    const fullHistory = assessLabTrendCompatibility([
      { unit: 'pmol/L' },
      { unit: 'ng/dL' },
      { unit: 'ng/dL' },
    ], 'endocrine')
    const recentWindow = assessLabTrendCompatibility([
      { unit: 'ng/dL' },
      { unit: 'ng/dL' },
    ], 'endocrine')

    expect(fullHistory).toMatchObject({
      chartable: false,
      unavailableReason: 'mixed-units',
    })
    expect(recentWindow).toMatchObject({
      chartable: true,
      unit: 'ng/dL',
      mixedUnits: false,
    })
  })

  it('normalizes values and matching reference ranges onto the cumulative-report unit', () => {
    const first = {
      id: 'crp-mg-l',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'C-reactive protein' }] },
      effectiveDateTime: '2026-01-01T08:00:00+08:00',
      valueQuantity: { value: 5, unit: 'mg/L', code: 'mg/L', system: 'http://unitsofmeasure.org' },
      interpretation: [{ coding: [{ code: 'N' }] }],
      referenceRange: [{ low: { value: 0, unit: 'mg/L' }, high: { value: 10, unit: 'mg/L' } }],
    }
    const second = {
      id: 'crp-mg-dl',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
      effectiveDateTime: '2026-07-01T08:00:00+08:00',
      valueQuantity: { value: 0.7, unit: 'mg/dL', code: 'mg/dL', system: 'http://unitsofmeasure.org' },
      interpretation: [{ coding: [{ code: 'H' }] }],
      referenceRange: [{ low: { value: 0, unit: 'mg/dL' }, high: { value: 1, unit: 'mg/dL' } }],
    }

    const series = buildLabTrendSeries([second, first], selectionFor(first))

    expect(series.chartable).toBe(true)
    expect(series.unit).toBe('mg/dL')
    expect(series.chartPoints.map((point) => point.value)).toEqual([0.5, 0.7])
    expect(series.sharedReferenceRange).toMatchObject({ low: 0, high: 1 })
    expect(series.chartPoints[1]).toMatchObject({ abnormal: true, interpretationCode: 'H' })
  })

  it('refuses to connect incompatible units instead of drawing a false line', () => {
    const first = {
      id: 'creatinine-a',
      code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
      effectiveDateTime: '2026-01-01',
      valueQuantity: { value: 1.2, unit: 'mg/dL' },
    }
    const second = {
      ...first,
      id: 'creatinine-b',
      effectiveDateTime: '2026-02-01',
      valueQuantity: { value: 106, unit: 'µmol/L' },
    }

    const series = buildLabTrendSeries([first, second], selectionFor(first))

    expect(series.chartable).toBe(false)
    expect(series.unavailableReason).toBe('mixed-units')
    expect(series.points).toHaveLength(2)
  })

  it('uses each result interpretation and removes a shared range when ranges vary', () => {
    const first = {
      id: 'alt-a',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '1742-6', display: 'ALT' }] },
      effectiveDateTime: '2026-01-01',
      valueQuantity: { value: 40, unit: 'U/L' },
      interpretation: [{ coding: [{ code: 'N' }] }],
      referenceRange: [{ high: { value: 41, unit: 'U/L' } }],
    }
    const second = {
      ...first,
      id: 'alt-b',
      effectiveDateTime: '2026-02-01',
      interpretation: [{ coding: [{ code: 'H' }] }],
      referenceRange: [{ high: { value: 35, unit: 'U/L' } }],
    }

    const series = buildLabTrendSeries([first, second], selectionFor(first))

    expect(series.chartable).toBe(true)
    expect(series.sharedReferenceRange).toBeUndefined()
    expect(series.referenceRangesVary).toBe(true)
    expect(series.points.map((point) => point.abnormal)).toEqual([false, true])
  })

  it('falls back to effectivePeriod or issued, excludes invalid statuses, and does not plot comparators', () => {
    const base = {
      code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
      valueQuantity: { value: 1, unit: 'mg/dL' },
    }
    const series = buildLabTrendSeries([
      { ...base, id: 'period', effectivePeriod: { start: '2026-01-01' } },
      { ...base, id: 'issued', issued: '2026-02-01' },
      { ...base, id: 'invalid', status: 'entered-in-error', effectiveDateTime: '2026-03-01' },
      { ...base, id: 'bounded', effectiveDateTime: '2026-04-01', valueQuantity: { value: 2, unit: 'mg/dL', comparator: '<' } },
    ], selectionFor(base))

    expect(series.points.map((point) => point.id)).toEqual(['period', 'issued', 'bounded'])
    expect(series.chartPoints.map((point) => point.id)).toEqual(['period', 'issued'])
    expect(series.excluded).toMatchObject({ invalidStatus: 1, comparator: 1 })
    expect(series.chartable).toBe(true)
  })
})
