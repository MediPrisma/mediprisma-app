"use client"

import { useMemo } from 'react'
import { cn } from '@/src/shared/utils/cn.utils'
import { extractReportPreview } from '@/src/shared/utils/report-preview'

/**
 * Collapsed-card preview of a free-text report. Shows the report's conclusion
 * section under the source's own heading ("Impression", "IMP"…) so the label
 * tells the reader this is not where the report starts; falls back to the text
 * after any method/history preamble, then to the report as written.
 */
export function ReportPreviewLine({
  text,
  className,
  onClick,
}: {
  text: string
  className?: string
  onClick?: () => void
}) {
  const preview = useMemo(() => extractReportPreview(text), [text])
  return (
    <p
      data-testid="report-preview"
      data-preview-kind={preview?.label ? 'conclusion' : preview ? 'after-preamble' : 'as-written'}
      className={cn(preview?.label ? 'line-clamp-2' : 'line-clamp-1', className)}
      onClick={onClick}
    >
      {preview?.label && (
        <span className="mr-1.5 font-semibold text-muted-foreground">{preview.label}</span>
      )}
      {preview?.text ?? text}
    </p>
  )
}
