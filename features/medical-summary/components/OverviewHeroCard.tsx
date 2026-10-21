// 初診快覽 hero — the one line that positions the patient, with its copy
// button. Safety alerts live in 開藥注意 after 影像與病理重點.
"use client"

import { Check, Copy, Info, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCopyToClipboard } from "@/src/shared/hooks/use-copy-to-clipboard"
import { trackEvent } from "@/src/application/telemetry/usage-analytics"
import type { MedicalSummaryResult } from "@/src/core/entities/medical-summary.entity"

interface OverviewHeroCardProps {
  result: MedicalSummaryResult
  title: string
  /** Deterministic coverage line, e.g. "健保雲端 · 至 2026-08-27". */
  dataRange: string | null
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
  /** Text comparison details; a mismatch alone does not establish an error. */
  reviewLabel?: string
  reviewButtonLabel: string
  reviewDescription: string
  /** Failure to generate the comparison list remains visible inline. */
  reviewUnavailable?: boolean
}

export function OverviewHeroCard({
  result,
  title,
  dataRange,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
  reviewLabel,
  reviewButtonLabel,
  reviewDescription,
  reviewUnavailable = false,
}: OverviewHeroCardProps) {
  const { copied, copy } = useCopyToClipboard()

  const handleCopy = async () => {
    if (!await copy(result.headline.trim())) {
      toast.error(copyFailedLabel)
      return
    }
    // Usage analytics: that the hero block was copied, never what was in it.
    trackEvent('summary_copy', { block: 'hero' })
  }

  return (
    <section
      data-tour="medical-summary-overview"
      className="reveal-scope overflow-hidden border-b border-border"
      aria-labelledby="medical-summary-overview-title"
    >
      <div className="px-0.5 pb-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            id="medical-summary-overview-title"
            className="min-w-0 text-[length:max(13px,0.8125rem)] font-medium text-muted-foreground"
          >
            {title}
          </h3>
          {reviewLabel && !reviewUnavailable ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] shrink-0 gap-1 px-1.5 text-[length:max(13px,0.8125rem)] text-muted-foreground lg:min-h-8"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  {reviewButtonLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                aria-label={reviewButtonLabel}
                className="w-[min(22rem,calc(100vw-2rem))] space-y-2 break-words text-[length:max(13px,0.8125rem)] leading-relaxed"
              >
                <p className="font-medium">{reviewLabel}</p>
                <p className="text-muted-foreground">{reviewDescription}</p>
              </PopoverContent>
            </Popover>
          ) : null}
          <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            {dataRange ? (
              <span className="text-[length:max(13px,0.8125rem)] tabular-nums text-muted-foreground">{dataRange}</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="reveal-on-hover h-[44px] shrink-0 gap-1.5 px-2 text-xs text-muted-foreground shadow-none hover:shadow-none lg:h-8"
              onClick={handleCopy}
              aria-label={copied ? copiedLabel : copyLabel}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-300" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copied ? copiedLabel : copyLabel}</span>
            </Button>
          </span>
        </div>
        <p className="mt-1.5 text-[length:max(16px,1.0625rem)] font-semibold leading-snug text-foreground">
          {result.headline}
        </p>
        {reviewLabel && reviewUnavailable ? (
          <p
            className="mt-1 inline-flex items-center gap-0.5 rounded border border-amber-500/40 px-1 text-[length:max(13px,0.8125rem)] leading-5 text-amber-700 dark:text-amber-300"
            data-headline-review
            role="status"
          >
            <TriangleAlert className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
            {reviewLabel}
          </p>
        ) : null}
      </div>

    </section>
  )
}
