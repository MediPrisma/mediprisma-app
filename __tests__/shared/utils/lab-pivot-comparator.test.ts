// Quantity.comparator in the cumulative pivot. The pivot keeps a single
// record's value as the bare number (comparator beside it) and builds same-day
// merges as display text; either way a source "<0.5" must never read as "0.5"
// in the report, the overview, a paste into the chart, or the AI context.
import {
  buildLabPivots,
  cellDisplayValue,
  recordDisplayValue,
  type LabCell,
} from '@/src/shared/utils/lab-pivot.utils'
import { buildEmrLabText } from '@/features/ips-export/utils/emr-plaintext'
import { buildIpsMarkdown } from '@/features/ips-export/utils/ips-markdown'
import { labReportsCategory } from '@/src/core/categories/lab-reports.category'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'

const DAY = '2026-05-01'
const EARLIER = '2026-04-01'

function crp(
  id: string,
  date: string,
  value: number,
  opts: { comparator?: string; unit?: string | null; interpretation?: string } = {},
) {
  const unit = opts.unit === undefined ? 'mg/dL' : opts.unit
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    valueQuantity: {
      value,
      ...(unit ? { unit } : {}),
      ...(opts.comparator ? { comparator: opts.comparator } : {}),
    },
    ...(opts.interpretation
      ? { interpretation: [{ coding: [{ code: opts.interpretation }] }] }
      : {}),
  }
}

// Anti-HBc ships as a qualitative + quantitative pair under two LOINCs that
// resolve to one ANTI-HBC column (see lab-pivot-serology-merge.test.ts).
const antiHbcCode = (loinc: string) => ({
  coding: [
    { system: 'http://loinc.org', code: loinc },
    { system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '14037C', display: 'Ｂ型肝炎核心抗體檢查' },
  ],
  text: 'Anti-HBc',
})
const antiHbcQual = {
  resourceType: 'Observation',
  id: 'hbc-qual',
  code: antiHbcCode('13952-7'),
  effectiveDateTime: `${DAY}T09:00:00+08:00`,
  valueCodeableConcept: { text: 'Reactive' },
}
const antiHbcQuant = {
  resourceType: 'Observation',
  id: 'hbc-quant',
  code: antiHbcCode('22316-4'),
  effectiveDateTime: `${DAY}T09:00:00+08:00`,
  valueQuantity: { value: 0.5, comparator: '<', unit: 'COI' },
}

function row(observations: any[], categoryId: string, testKey: string) {
  const found = buildLabPivots(observations)[categoryId]?.rows.find((r) => r.testKey === testKey)
  if (!found) throw new Error(`no ${testKey} row in ${categoryId}`)
  return found
}

const crpCell = (observations: any[], date = DAY): LabCell => {
  const cell = row(observations, 'chem', 'CRP').values.get(date)
  if (!cell) throw new Error(`no CRP cell on ${date}`)
  return cell
}

describe('lab pivot — single-record cell', () => {
  it('keeps the bare number in value and puts the comparator back for display', () => {
    const cell = crpCell([crp('a', DAY, 0.5, { comparator: '<' })])
    expect(cell.value).toBe('0.5')
    expect(cell.comparator).toBe('<')
    expect(cell.sourceRecords).toEqual([expect.objectContaining({ value: '0.5', comparator: '<' })])
    expect(cellDisplayValue(cell)).toBe('<0.5')
  })

  it('shows two-character comparators whole', () => {
    expect(cellDisplayValue(crpCell([crp('a', DAY, 100, { comparator: '>=' })]))).toBe('>=100')
    expect(cellDisplayValue(crpCell([crp('a', DAY, 0.3, { comparator: '<=' })]))).toBe('<=0.3')
  })

  it('leaves a value without a comparator exactly as before', () => {
    const cell = crpCell([crp('a', DAY, 1.2)])
    expect(cell.comparator).toBeUndefined()
    expect(cellDisplayValue(cell)).toBe('1.2')
  })

  it('keeps the comparator through unit normalisation (<5 mg/L → <0.5 mg/dL)', () => {
    const cell = crpCell([crp('a', DAY, 5, { comparator: '<', unit: 'mg/L' })])
    expect(cell.unit).toBe('mg/dL')
    expect(cellDisplayValue(cell)).toBe('<0.5')
  })
})

describe('lab pivot — same-day merge', () => {
  it('gives each value its own comparator ("<0.5 / 0.7")', () => {
    const cell = crpCell([
      crp('a', DAY, 0.5, { comparator: '<' }),
      crp('b', DAY, 0.7),
    ])
    expect(cell.allValues).toEqual(['<0.5', '0.7'])
    expect(cell.value).toBe('<0.5 / 0.7')
    expect(cellDisplayValue(cell)).toBe('<0.5 / 0.7')
    expect(cell.sourceRecords?.map((record) => record.comparator)).toEqual(['<', undefined])
  })

  it('never lends one record’s comparator to the whole merged cell', () => {
    // The later record carries the comparator. A cell-level "<" left on the
    // merge would read the earlier 0.7 as "<0.7".
    const cell = crpCell([
      crp('a', DAY, 0.7),
      crp('b', DAY, 0.5, { comparator: '<' }),
    ])
    expect(cell.comparator).toBeUndefined()
    expect(cellDisplayValue(cell)).toBe('0.7 / <0.5')
  })

  it('keeps every comparator across three records of one day', () => {
    const cell = crpCell([
      crp('a', DAY, 0.5, { comparator: '<' }),
      crp('b', DAY, 0.7),
      crp('c', DAY, 10, { comparator: '>' }),
    ])
    expect(cell.allValues).toEqual(['<0.5', '0.7', '>10'])
    expect(cellDisplayValue(cell)).toBe('<0.5 / 0.7 / >10')
  })

  it('still withholds the column-header unit when merged unit-less values carry a comparator', () => {
    // Day 1 has a unit; day 2 holds two unit-less "<" values. A header unit
    // would attach mg/dL to numbers the source never gave a unit.
    const crpRow = row([
      crp('a', EARLIER, 1.2),
      crp('b', DAY, 0.5, { comparator: '<', unit: null }),
      crp('c', DAY, 0.3, { comparator: '<', unit: null }),
    ], 'chem', 'CRP')
    expect(crpRow.values.get(DAY)?.allValues).toEqual(['<0.5', '<0.3'])
    expect(crpRow.unit).toBeUndefined()
  })
})

describe('lab pivot — qualitative + quantitative pair', () => {
  it('shows the number with its comparator inside the qualitative result', () => {
    const cell = row([antiHbcQual, antiHbcQuant], 'hep', 'ANTI-HBC').values.get(DAY)!
    expect(cell.value).toBe('Reactive (<0.5)')
    expect(cell.comparator).toBeUndefined()
    expect(cellDisplayValue(cell)).toBe('Reactive (<0.5)')
  })

  it('is the same whichever half arrives first', () => {
    const cell = row([antiHbcQuant, antiHbcQual], 'hep', 'ANTI-HBC').values.get(DAY)!
    expect(cellDisplayValue(cell)).toBe('Reactive (<0.5)')
  })
})

describe('cellDisplayValue / recordDisplayValue', () => {
  it('never double-prefixes a value that already starts with a comparator', () => {
    expect(cellDisplayValue({ value: '<0.5', comparator: '<' })).toBe('<0.5')
    expect(cellDisplayValue({ value: '<0.5 / 0.7', comparator: '<' })).toBe('<0.5 / 0.7')
    expect(recordDisplayValue({ value: '≥8', comparator: '>=' })).toBe('≥8')
  })

  it('never turns a missing value into "<—"', () => {
    expect(cellDisplayValue({ value: '—', comparator: '<' })).toBe('—')
    expect(cellDisplayValue({ value: '', comparator: '<' })).toBe('')
  })
})

describe('readers outside the cumulative table', () => {
  const observations = [
    crp('old', EARLIER, 0.5, { comparator: '<' }),
    crp('new-a', DAY, 20, { comparator: '>', interpretation: 'H' }),
    crp('new-b', DAY, 0.7),
  ]

  it('帶回病歷 plain text pastes the comparator into the chart', () => {
    const pivots = buildLabPivots(observations)
    const text = buildEmrLabText({
      pivots,
      categoryLabels: { chem: '生化' },
      selected: { chem: true },
      range: '1y',
      preset: 'full',
      omittedLabel: '…略去 {count} 次…',
      drawCountLabel: '{count} 次',
      now: new Date(2026, 4, 2),
    })
    expect(text).toContain('<0.5')
    expect(text).toContain('>20 / 0.7(H)')
    expect(text).not.toMatch(/(^|[^<>\d.])0\.5(?![\d])/)
  })

  it('the AI context pivot table and key trends keep the comparator', () => {
    const section = labReportsCategory.getContextSection(
      observations as any,
      { labDepth: '8', labReportTimeRange: 'all' } as any,
      { observations: [] },
    )
    const items = Array.isArray(section) ? [] : section?.items ?? []
    const chem = items.find((item) => item.startsWith('[chem]')) ?? ''
    expect(chem).toContain(`| ${DAY} | >20 / 0.7 H |`)
    expect(chem).toContain(`| ${EARLIER} | <0.5 |`)
    const trend = items.find((item) => item.startsWith('CRP')) ?? ''
    expect(trend).toContain(`<0.5 (${EARLIER})`)
    expect(trend).toContain(`>20 / 0.7[H] (${DAY})`)
  })

  it('the IPS markdown lab table keeps the comparator', () => {
    const data = {
      conditions: [], medications: [], medicationRemainingSummaries: [], allergies: [],
      observations, vitalSigns: [], diagnosticReports: [], imagingStudies: [], procedures: [],
      encounters: [], documentReferences: [], compositions: [], immunizations: [], consents: [],
      devices: [], carePlans: [],
    } as unknown as ClinicalDataCollection
    const md = buildIpsMarkdown({
      patient: { id: 'p', resourceType: 'Patient' } as any,
      data,
      generatedAt: new Date('2026-06-24T00:00:00Z'),
    })
    expect(md).toContain('<0.5')
    expect(md).toContain('>20 / 0.7 H')
  })
})
