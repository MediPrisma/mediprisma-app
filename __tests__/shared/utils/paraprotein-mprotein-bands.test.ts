/**
 * @jest-environment node
 *
 * M-protein bands are different measurements: LOINC gives band 1 and band 2
 * their own codes (51435-6 / 35559-4 by electrophoresis, verified on
 * tx.fhir.org, LOINC 2.82). A band qualifier — number, Roman numeral,
 * ordinal, 第一, #1, 峰1, or a region (γ / β / α) — keeps its own column; only
 * an undifferentiated synonym is the generic M-protein column, and a total
 * never merges with band 1. Pivot, trend series and AI grouping all agree.
 */
import { paraproteinIdentity } from '@/src/shared/utils/paraprotein-analytes'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { buildLabTrendSeries } from '@/src/shared/utils/lab-trend.utils'
import { labCategoryAnalyteKey } from '@/src/infrastructure/ai/tools/fhir-tools'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOINC = 'http://loinc.org'
let seq = 0
function row(item: string, nhi: string | undefined, value: number, date = '2026-01-01', loinc?: string, specimen?: string) {
  seq += 1
  return {
    resourceType: 'Observation', id: `mb-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [...(nhi ? [{ system: NHI, code: nhi }] : []), ...(loinc ? [{ system: LOINC, code: loinc }] : [])] },
    valueQuantity: { value, unit: 'g/dL' },
    ...(specimen ? { specimen: { display: specimen } } : {}),
    effectiveDateTime: `${date}T08:00:00+08:00`,
  }
}
const key = (item: string, nhi = '09065B') => paraproteinIdentity(row(item, nhi, 1))?.key

describe('two bands across two dates stay two columns', () => {
  const observations = [
    row('M-spike 1', '09065B', 1.5, '2026-01-01'), row('M-spike 2', '09065B', 0.3, '2026-01-01'),
    row('M-spike 1', '09065B', 1.2, '2026-04-01'), row('M-spike 2', '09065B', 0.4, '2026-04-01'),
  ]
  const rows = buildLabPivots(observations).immuno.rows.filter((r) => r.values.size > 0)

  it('pivot: one column per band, each cell one value', () => {
    expect(rows.map((r) => r.testKey).sort()).toEqual(['PP:M-PROTEIN:BAND1', 'PP:M-PROTEIN:BAND2'])
    const band1 = rows.find((r) => r.testKey === 'PP:M-PROTEIN:BAND1')!
    expect([...band1.values.values()].map((c) => c.value).sort()).toEqual(['1.2', '1.5'])
    expect(getLabRowDisplayParts(band1, 'medical', 'en', 'standardized').name).toMatch(/band 1/i)
    expect(getLabRowDisplayParts(band1, 'medical', 'zh-TW', 'standardized').name).toMatch(/1/)
  })

  it('trend: each band its own series', () => {
    for (const r of rows) {
      const series = buildLabTrendSeries(observations, {
        categoryId: 'immuno', mapKey: r.mapKey, testKey: r.testKey, displayName: r.displayName, nameMode: 'standardized',
      } as any)
      expect(series.points).toHaveLength(2)
      const values = series.points.map((p: any) => p.value).sort()
      expect(values).toEqual(r.testKey.endsWith('BAND1') ? [1.2, 1.5] : [0.3, 0.4])
    }
  })

  it('AI grouping: each band its own analyte', () => {
    const keys = new Set(observations.map((o) => labCategoryAnalyteKey(o, 'immuno')))
    expect(keys.size).toBe(2)
  })
})

describe('band wordings', () => {
  const BAND1 = ['M-spike 1', 'M spike 1', 'M-spike #1', 'M-spike I', 'M-protein band 1', 'M-protein 1', 'Band 1 M-protein',
    'First M-spike', 'M-spike (1st)', 'M蛋白 1', '第一 M蛋白', 'M蛋白峰1', 'M-spike peak 1', 'Paraprotein band 1']
  const BAND2 = ['M-spike 2', 'M-spike II', 'M-spike #2', 'M-protein band 2', 'Second M-spike', 'M-spike (2nd)', '第二 M蛋白', 'M蛋白峰2']
  const BAND3 = ['M-spike 3', 'M-spike III', 'Third M-spike', '第三 M蛋白']
  it.each(BAND1)('%s → band 1', (label) => expect(key(label)).toBe('PP:M-PROTEIN:BAND1'))
  it.each(BAND2)('%s → band 2', (label) => expect(key(label)).toBe('PP:M-PROTEIN:BAND2'))
  it.each(BAND3)('%s → band 3', (label) => expect(key(label)).toBe('PP:M-PROTEIN:BAND3'))
  it.each([
    ['M-spike (gamma)', 'PP:M-PROTEIN:GAMMA'], ['M-spike, gamma region', 'PP:M-PROTEIN:GAMMA'], ['M-protein (γ)', 'PP:M-PROTEIN:GAMMA'],
    ['M-spike beta region', 'PP:M-PROTEIN:BETA'], ['M-protein (β)', 'PP:M-PROTEIN:BETA'], ['M-spike alpha-2', 'PP:M-PROTEIN:ALPHA2'],
  ])('%s → %s', (label, want) => expect(key(label)).toBe(want))
  it.each(['Total M-spike', 'M-spike, total', 'M-protein total (sum of bands)', 'Sum of M-spikes', 'M蛋白總量', '總M蛋白'])(
    '%s → total, never band 1', (label) => expect(key(label)).toBe('PP:M-PROTEIN:TOTAL'),
  )
  it.each(['M-protein', 'M-spike', 'M spike', 'Mprotein', 'Paraprotein', 'M蛋白', 'Serum M-protein', 'M-protein (g/dL)', 'Monoclonal protein'])(
    'undifferentiated %s → the generic column', (label) => expect(key(label)).toBe('PP:M-PROTEIN'),
  )
  it('band qualifiers hold under the report orders and in urine', () => {
    expect(key('M-spike 2', '12103B')).toBe('PP:M-PROTEIN:BAND2')
    expect(paraproteinIdentity(row('M-spike 2', '09100B', 1, '2026-01-01', undefined, 'Urine'))?.key).toBe('PP:U:M-PROTEIN:BAND2')
  })
  it('genuine synonyms still merge into one column', () => {
    const rows = buildLabPivots(['M-protein', 'M-spike', 'Paraprotein', 'M蛋白'].map((label, i) => row(label, '09065B', 1, `2026-0${i + 1}-01`)))
      .immuno.rows.filter((r) => r.values.size > 0)
    expect(rows.map((r) => r.testKey)).toEqual(['PP:M-PROTEIN'])
  })
})

describe('band-specific LOINCs stay separate', () => {
  it.each([
    ['51435-6', 'PP:M-PROTEIN:BAND1'], ['99415-2', 'PP:M-PROTEIN:BAND1'], ['35559-4', 'PP:M-PROTEIN:BAND2'], ['99416-0', 'PP:M-PROTEIN:BAND2'],
    ['50796-2', 'PP:M-PROTEIN:BAND3'], ['50797-0', 'PP:M-PROTEIN:BAND4'],
    ['97772-8', 'PP:U:M-PROTEIN:BAND1'], ['51437-2', 'PP:U:M-PROTEIN:BAND2'], ['87834-8', 'PP:U:M-PROTEIN:BAND2'], ['35561-0', 'PP:U:M-PROTEIN:BAND2'],
    ['51440-6', 'PP:U:M-PROTEIN:BAND3'], ['87833-0', 'PP:U:M-PROTEIN:BAND3'], ['59563-7', 'PP:U:M-PROTEIN:BAND4'],
    ['33358-3', 'PP:M-PROTEIN'], ['104837-0', 'PP:M-PROTEIN'],
  ])('%s → %s', (loinc, want) => {
    expect(paraproteinIdentity(row('Band', undefined, 1, '2026-01-01', loinc))?.key).toBe(want)
  })
})
