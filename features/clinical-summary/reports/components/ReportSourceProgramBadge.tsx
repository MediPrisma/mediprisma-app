import { cn } from '@/src/shared/utils/cn.utils'
import type { ReportSourceProgram } from '../types'

export function ReportSourceProgramBadge({
  sourceProgram,
  label,
  className,
}: {
  sourceProgram?: ReportSourceProgram
  label?: string
  className?: string
}) {
  if (sourceProgram !== 'adult-preventive' || !label) return null

  return (
    <span
      data-testid="report-source-program"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-xs font-medium text-primary",
        className,
      )}
    >
      {label}
    </span>
  )
}
