import { buildReportGrids, cellKey, formatReportValue } from '@/features/lab-data-report/admin/report-grid'
import type { LabDataReportRow } from '@/features/lab-data-report/types'

let ref = 0
const row = (categoryId: string, column: string, day: number | null, value: number | undefined, decidedBy: LabDataReportRow['app']['decidedBy'] = 'loinc'): LabDataReportRow => ({
  ref: ++ref,
  day,
  performer: [],
  code: { codings: [] },
  category: ['laboratory'],
  value: value === undefined
    ? { kind: 'quantity', magnitude: 0, decimals: 2 }
    : { kind: 'quantity', value, magnitude: 0, decimals: 2 },
  interpretation: [],
  referenceRange: [],
  sourceExtensions: [],
  sourceTags: [],
  app: { categoryId, decidedBy, testKey: column.toUpperCase(), column },
})

describe('buildReportGrids', () => {
  it('rebuilds each panel as days (newest first) × columns, keeping duplicates in one cell', () => {
    const rows = [
      row('chem', 'K', 77, 4.41),
      row('chem', 'K', 77, 4.41),
      row('chem', 'Na', 77, 139),
      row('chem', 'K', 0, 4.2),
      row('urine', 'RBC', 10, 4.1, 'specimen-urine'),
      row('urine', 'C3', 10, 98, 'text-urine'),
      row('urine', 'C3', null, 90, 'text-urine'),
    ]
    const grids = buildReportGrids(rows, ['urine', 'chem'], ['urine'])
    expect(grids.map((grid) => [grid.categoryId, grid.rowCount, grid.flagged])).toEqual([
      ['urine', 3, true],
      ['chem', 4, false],
    ])
    const chem = grids[1]
    expect(chem.days).toEqual([77, 0])
    expect(chem.columns.map((column) => column.label)).toEqual(['K', 'Na'])
    expect(chem.cells.get(cellKey(77, 0))?.rows.map(formatReportValue)).toEqual(['4.41', '4.41'])
    const urine = grids[0]
    expect(urine.days).toEqual([10, null])
    expect(urine.columns).toEqual([
      { label: 'RBC', decidedBy: ['specimen-urine'] },
      { label: 'C3', decidedBy: ['text-urine'] },
    ])
  })

  it('shows the shape, not a number, when values were not attached', () => {
    expect(formatReportValue(row('chem', 'K', 0, undefined))).toBe('(2 dp)')
  })
})
