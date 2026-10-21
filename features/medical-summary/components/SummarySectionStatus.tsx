// Per-section streaming state for 初診快覽. Each section of the single scroll
// column paints on its own as its module closes, so a pending section needs a
// placeholder of its own. A failed section is reported in the shared
// generation banner, not here, so one failure is never shown twice.
"use client"

import { StreamingIndicator } from "@/src/shared/components/StreamingIndicator"

interface SummarySectionPendingProps {
  title: string
  label: string
}

export function SummarySectionPending({ title, label }: SummarySectionPendingProps) {
  return (
    <div className="reveal-scope border-b border-border px-0.5 py-3">
      <h3 className="mb-2 text-[length:max(12px,0.75rem)] font-semibold tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex justify-center py-4">
        <StreamingIndicator label={label} />
      </div>
    </div>
  )
}
