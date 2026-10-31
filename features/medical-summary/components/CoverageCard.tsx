// Coverage card — the honesty footer of the summary. 100% deterministic
// (computed from the bundle, zero AI, renders immediately), and always
// visible for BOTH audiences: cross-hospital 健康存摺 data must never be
// mistaken for a complete chart.
"use client"

import type { SummaryCoverageStats } from "@/src/core/entities/medical-summary.entity"

interface CoverageCardProps {
  coverage: SummaryCoverageStats
  labels: {
    range: string // "涵蓋 {start} ~ {end}"
    orgs: string // "院所 {count}"
    encounters: string
    medications: string
    labs: string
    boundary: string
  }
  /** Patient audience gets only the plain-language boundary text. */
  statsVisible: boolean
}

export function CoverageCard({ coverage, labels, statsVisible }: CoverageCardProps) {
  const fill = (template: string, value: string | number) =>
    template.replace("{count}", String(value))

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      {statsVisible ? (
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:max(12px,0.75rem)] tabular-nums text-foreground/70">
          {coverage.start && coverage.end ? (
            <span className="font-medium">
              {labels.range.replace("{start}", coverage.start).replace("{end}", coverage.end)}
            </span>
          ) : null}
          <span>{fill(labels.orgs, coverage.organizations)}</span>
          <span>{fill(labels.encounters, coverage.encounters)}</span>
          <span>{fill(labels.medications, coverage.medications)}</span>
          <span>{fill(labels.labs, coverage.labs)}</span>
        </div>
      ) : null}
      <p className="text-[length:max(12px,0.75rem)] leading-snug text-muted-foreground">{labels.boundary}</p>
    </div>
  )
}
