"use client"

import { cn } from '@/src/shared/utils/cn.utils'
import { useLanguage } from '@/src/application/providers/language.provider'
import { LAB_TABLE_LAYOUT, type LabTableVariant } from './lab-table-layout'

/** Column labels for the one-line layout; the two-line layout has none (each
 *  row's second line labels itself by position, as on a phone lab slip). */
export function LabTableHeader({ variant }: { variant: LabTableVariant }) {
  const { t } = useLanguage()
  const columns = t.reports.labTable.columns
  const layout = LAB_TABLE_LAYOUT[variant]
  return (
    <div
      data-testid="lab-table-header"
      className={cn(
        layout.header,
        layout.grid,
        'sticky top-0 z-10 items-center gap-x-2.5 border-b border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground',
      )}
    >
      <span className="col-start-1 row-start-1" aria-hidden="true" />
      <span className="col-start-2 row-start-1">{columns.item}</span>
      <span className="col-start-3 row-start-1 text-right">{columns.result}</span>
      <span className="col-start-4 row-start-1">{columns.unit}</span>
      <span className="col-start-5 row-start-1 text-center">{columns.flag}</span>
      <span className={layout.range}>{columns.range}</span>
      {variant === 'flat' && <span className={layout.source}>{columns.source}</span>}
      {variant === 'flat' && <span className={layout.date}>{columns.date}</span>}
    </div>
  )
}
