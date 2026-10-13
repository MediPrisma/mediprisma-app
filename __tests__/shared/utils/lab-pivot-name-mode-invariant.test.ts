// Original-name mode is an audit view: it may split columns further by source
// label, but it must never merge two observations that standardized mode
// keeps apart (serum vs urine, free vs total, κ vs λ, count vs %, lanes,
// immunology columns, unit-specimen evidence). And in both modes every trend
// series holds one analyte, and no folded report column has a series.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { isParaproteinTextKey } from '@/src/shared/utils/paraprotein-analytes'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOINC = 'http://loinc.org'
let seq = 0
function obs(item: string, opts: { nhi?: string; loinc?: string; value?: any; unit?: string; specimen?: string; date?: string } = {}) {
  seq += 1
  const { nhi, loinc, value = 10, unit = 'mg/dL', specimen, date = '2026-01-01' } = opts
  return {
    resourceType: 'Observation', id: `nm-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [...(nhi ? [{ system: NHI, code: nhi }] : []), ...(loinc ? [{ system: LOINC, code: loinc }] : [])] },
    ...(typeof value === 'number' ? { valueQuantity: { value, unit } } : { valueString: value }),
    ...(specimen ? { specimen: { display: specimen } } : {}),
    effectiveDateTime: `${date}T08:00:00+08:00`,
  }
}

// Same source label, different standardized columns.
const SYNTHETIC = [
  // paraprotein: serum vs urine, free vs total, κ / λ, lanes, neutral
  ...['2026-01-01', '2026-03-01'].flatMap((date) => [
    obs('Free Kappa', { nhi: '12160B', value: 12, unit: 'mg/L', date }),
    obs('Free Kappa', { nhi: '12160B', value: 30, unit: 'mg/L', specimen: 'Urine', date }),
    obs('Kappa', { nhi: '12160B', value: 12, unit: 'mg/L', date }),
    obs('Kappa', { nhi: '12160B', value: 30, unit: 'mg/L', specimen: 'Urine', date }),
    obs('Kappa', { nhi: '12160B', loinc: '36916-5', value: 12, unit: 'mg/L', date }),
    obs('Kappa', { nhi: '12160B', loinc: '11050-2', value: 200, date }),
    obs('IgG', { nhi: '12103B', value: 1000, date }),
    obs('IgG', { nhi: '12025B', value: 1000, date }),
    obs('IgG', { nhi: '12159B', value: 5, specimen: 'Urine', date }),
    obs('IFE', { nhi: '12103B', value: 'Negative', date }),
    obs('IFE', { nhi: '12159B', value: 'Negative', specimen: 'Urine', date }),
    obs('M-protein', { nhi: '09065B', value: 1, unit: 'g/dL', date }),
    obs('M-protein', { nhi: '09100B', value: 1, unit: 'g/dL', specimen: 'Urine', date }),
    // CBC count vs %
    obs('Neutrophil', { loinc: '751-8', value: 4, unit: '10^3/uL', date }),
    obs('Neutrophil', { loinc: '770-8', value: 60, unit: '%', date }),
    // immunology column by LOINC vs a lane-name
    obs('SS-A', { nhi: '12064B', loinc: '33569-5', value: 2, unit: 'U/mL', date }),
    obs('SS-A', { nhi: '12064B', value: 'Negative', date }),
    // thyroid by LOINC
    obs('Tg', { loinc: '3013-0', value: 10, unit: 'ng/mL', date }),
    obs('Tg', { loinc: '2571-8', value: 100, date }),
    // unit-specimen evidence: same label, serum vs urine by unit
    obs('Creatinine', { nhi: '09015C', value: 1, date }),
    obs('Creatinine', { nhi: '09015C', value: 1, unit: 'g/g', date }),
    obs('Albumin', { nhi: '09038C', value: 4, unit: 'g/dL', date }),
    obs('Albumin', { nhi: '09038C', value: 30, unit: 'mg/g', date }),
    // glucose subtypes under one label
    obs('Glucose', { loinc: '1558-6', value: 100, date }),
    obs('Glucose', { loinc: '2345-7', value: 140, date }),
  ]),
]

function bundleObservations(): any[] {
  const root = process.cwd()
  const files = ['public/demo/demo-bundle.json',
    ...readdirSync(join(root, 'public/demo/hfrEF')).filter((f) => f.endsWith('.json') && f !== 'manifest.json').map((f) => `public/demo/hfrEF/${f}`),
    'e2e/fixtures/hospital-cdss-bundle.json', 'e2e/fixtures/medcloud-hepatitis-bundle.json', 'e2e/fixtures/synthetic-bundle.json']
  return files.flatMap((f) => (JSON.parse(readFileSync(join(root, f), 'utf8')).entry ?? [])
    .map((e: any) => e.resource).filter((r: any) => r?.resourceType === 'Observation'))
}

const CORPORA: Array<[string, () => any[]]> = [['synthetic same-label rows', () => SYNTHETIC], ['demo / e2e bundles', bundleObservations]]

describe.each(CORPORA)('%s', (_name, load) => {
  const observations = load()

  it('original mode never merges what standardized mode keeps apart', () => {
    const failures: string[] = []
    const byOriginal = new Map<string, Set<string>>()
    for (const o of observations) {
      const category = categorizeObservation(o)?.id
      if (!category) continue
      const original = getLabPivotTestIdentity(o, category, 'original').mapKey
      const standardized = getLabPivotTestIdentity(o, category, 'standardized').mapKey
      const id = `${category}|${original}`
      byOriginal.set(id, (byOriginal.get(id) ?? new Set()).add(standardized))
    }
    for (const [id, keys] of byOriginal) if (keys.size > 1) failures.push(`${id}: ${[...keys].join(' + ')}`)
    expect(failures).toEqual([])
  })

  it.each(['standardized', 'original'] as const)('every %s-mode trend series holds one standardized analyte', (nameMode) => {
    const failures: string[] = []
    const byId = new Map(observations.map((o: any) => [o.id, o]))
    for (const [categoryId, pivot] of Object.entries(buildLabPivots(observations, { nameMode }))) {
      for (const row of pivot.rows) {
        const series = buildLabTrendSeries(observations, {
          categoryId, mapKey: row.mapKey, testKey: row.testKey, displayName: row.displayName, nameMode,
        } as any)
        if (isParaproteinTextKey(row.testKey)) {
          if (series.points.length > 0 || row.trendChartable) failures.push(`${categoryId}/${row.mapKey}: folded report has a series`)
          continue
        }
        const keys = new Set(series.points.map((point: any) => {
          const o: any = byId.get(point.id)
          return getLabPivotTestIdentity(o, categorizeObservation(o)?.id, 'standardized').mapKey
        }))
        if (keys.size > 1) failures.push(`${categoryId}/${row.mapKey}: ${[...keys].join(' + ')}`)
      }
    }
    expect(failures).toEqual([])
  })
})
