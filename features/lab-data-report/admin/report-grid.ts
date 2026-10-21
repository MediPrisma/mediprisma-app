// Rebuilds, from a stored report's rows, what the clinician was looking at:
// one grid per panel, relative days (newest first) × the column labels the
// app showed. Pure, so the viewer and its tests read the same thing.
import type { LabCategoryDecision, LabDataReportRow } from '../types'

export interface ReportGridCell {
  rows: LabDataReportRow[]
}

export interface ReportGridColumn {
  label: string
  /** Every rule that placed a row in this column — the "why is it here". */
  decidedBy: LabCategoryDecision[]
}

export interface ReportPanelGrid {
  categoryId: string
  rowCount: number
  flagged: boolean
  columns: ReportGridColumn[]
  /** Newest first; null collects undated rows. */
  days: Array<number | null>
  /** `${day}|${columnIndex}` → rows. */
  cells: Map<string, ReportGridCell>
}

export const cellKey = (day: number | null, columnIndex: number) => `${day ?? '-'}|${columnIndex}`

export function buildReportGrids(
  rows: readonly LabDataReportRow[],
  categoryOrder: readonly string[],
  flaggedCategories: readonly string[],
): ReportPanelGrid[] {
  const byPanel = new Map<string, LabDataReportRow[]>()
  for (const row of rows) {
    const id = row.app.categoryId ?? 'unknown'
    byPanel.set(id, [...(byPanel.get(id) ?? []), row])
  }
  const order = [...categoryOrder, ...[...byPanel.keys()].filter((id) => !categoryOrder.includes(id))]
  const flagged = new Set(flaggedCategories)

  return order
    .filter((id) => byPanel.has(id))
    .map((categoryId) => {
      const panelRows = byPanel.get(categoryId)!
      const columns: ReportGridColumn[] = []
      const columnIndex = new Map<string, number>()
      const days = new Set<number | null>()
      const cells = new Map<string, ReportGridCell>()
      for (const row of panelRows) {
        const label = row.app.column || row.app.testKey || '—'
        let index = columnIndex.get(label)
        if (index === undefined) {
          index = columns.length
          columnIndex.set(label, index)
          columns.push({ label, decidedBy: [] })
        }
        if (!columns[index].decidedBy.includes(row.app.decidedBy)) columns[index].decidedBy.push(row.app.decidedBy)
        days.add(row.day)
        const key = cellKey(row.day, index)
        const cell = cells.get(key) ?? { rows: [] }
        cell.rows.push(row)
        cells.set(key, cell)
      }
      return {
        categoryId,
        rowCount: panelRows.length,
        flagged: flagged.has(categoryId),
        columns,
        days: [...days].sort((a, b) => (b ?? -1) - (a ?? -1)),
        cells,
      }
    })
}

/** What a cell shows: the value (or its shape when values were not sent). */
export function formatReportValue(row: LabDataReportRow): string {
  const value = row.value
  switch (value.kind) {
    case 'quantity':
      return value.value === undefined
        ? `(${value.decimals} dp)`
        : `${value.comparator ?? ''}${value.value}`
    case 'range':
      return value.low === undefined && value.high === undefined ? '(range)' : `${value.low ?? '?'}–${value.high ?? '?'}`
    case 'coded':
      return value.text ?? value.code ?? '(coded)'
    case 'string':
      return value.value ?? `(${value.length} chars)`
    case 'other':
      return `(${value.type})`
    default:
      return '—'
  }
}
