import { cn } from '@/src/shared/utils/cn.utils'
import type { ReportSourceProgram } from '../types'

export function ReportSourceProgramBadge({
  sourceProgram,
  label,
  shortLabel,
  className,
}: {
  sourceProgram?: ReportSourceProgram
  label?: string
  /** Shown in place of `label` while the enclosing `@container` is narrower
   *  than 230px (the lab table's source cell); the full label shows once there
   *  is room, and stays the accessible name and the hover title throughout. */
  shortLabel?: string
  className?: string
}) {
  if (sourceProgram !== 'adult-preventive' || !label) return null

  return (
    <span
      data-testid="report-source-program"
      aria-label={label}
      title={shortLabel ? label : undefined}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-xs font-medium text-primary",
        className,
      )}
    >
      {shortLabel ? (
        <>
          {/* Narrow cell: the short form; once the enclosing container (the
              lab table's source cell) has room, the full label. */}
          <span aria-hidden="true" className="@min-[230px]:hidden">{shortLabel}</span>
          <span aria-hidden="true" className="hidden @min-[230px]:inline">{label}</span>
        </>
      ) : label}
    </span>
  )
}
