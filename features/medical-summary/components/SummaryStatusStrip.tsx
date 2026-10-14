// Sticky status strip above the summary sections. It keeps two facts in view
// while the clinician scrolls: how much of the record the AI actually read
// (deterministic coverage counts, zero AI) and whether a generation is still
// running (live elapsed timer, then provenance + duration). The old card nav
// carried both; the single-column 初診快覽 has no nav, so they live here.
"use client"

import { ModelExecutionNotice } from "@/src/shared/components/ModelExecutionNotice"
import { modelExecutionFallback } from "@/src/shared/utils/ai-model-execution"
import type { SummaryCoverageStats } from "@/src/core/entities/medical-summary.entity"
import type { MedicalSummaryGenerationInfo } from "../utils/summary-generation-info"
import {
  SummaryGenerationMeta,
  type ActiveSummaryGeneration,
} from "./SummaryGenerationMeta"

interface SummaryStatusStripProps {
  coverage: SummaryCoverageStats | null | undefined
  /** Patients see the boundary sentence in the footer instead of raw counts. */
  statsVisible: boolean
  labels: {
    orgs: string
    encounters: string
    medications: string
    labs: string
  }
  generationInfo?: MedicalSummaryGenerationInfo
  activeGeneration?: ActiveSummaryGeneration | null
  runningLabel: string
  runningAriaTemplate: string
}

export function SummaryStatusStrip({
  coverage,
  statsVisible,
  labels,
  generationInfo,
  activeGeneration,
  runningLabel,
  runningAriaTemplate,
}: SummaryStatusStripProps) {
  const fill = (template: string, value: number) => template.replace("{count}", String(value))
  const showStats = statsVisible && Boolean(coverage)
  const showMeta = Boolean(activeGeneration || generationInfo)
  if (!showStats && !showMeta) return null

  return (
    <div
      data-testid="medical-summary-status-strip"
      className="sticky top-0 z-20 -mx-1 border-y border-border/60 bg-background py-1.5"
    >
      <div className="flex min-w-0 flex-nowrap items-center gap-2 px-2">
        {showStats && coverage ? (
          <div
            className="flex min-w-0 flex-none flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[length:max(12px,0.75rem)] tabular-nums text-foreground/70"
            aria-label={[
              fill(labels.orgs, coverage.organizations),
              fill(labels.encounters, coverage.encounters),
              fill(labels.medications, coverage.medications),
              fill(labels.labs, coverage.labs),
            ].join(", ")}
          >
            <span>{fill(labels.orgs, coverage.organizations)}</span>
            <span>{fill(labels.encounters, coverage.encounters)}</span>
            <span>{fill(labels.medications, coverage.medications)}</span>
            <span>{fill(labels.labs, coverage.labs)}</span>
          </div>
        ) : null}
        <SummaryGenerationMeta
          generationInfo={generationInfo}
          activeGeneration={activeGeneration}
          runningLabel={runningLabel}
          runningAriaTemplate={runningAriaTemplate}
          className="ml-auto min-w-0 max-w-[min(60%,26rem)] flex-1 justify-end text-xs"
        />
      </div>
      {!activeGeneration && generationInfo?.modelExecution && modelExecutionFallback(generationInfo.modelExecution) ? (
        <div className="px-2 pb-1.5 pt-1"><ModelExecutionNotice execution={generationInfo.modelExecution} /></div>
      ) : null}
    </div>
  )
}
