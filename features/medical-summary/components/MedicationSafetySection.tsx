// 開藥注意 — the medication-safety scan, placed after 影像與病理重點
// (owner decision 2026-10-02). Every alert is one plain row in the same
// neutral style, ordered most important first: no red badges or severity
// banners (the owner asked for no alarm styling). The first few rows are open;
// the rest fold behind one control so a long monitoring list stays short.
"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, Flag, Loader2 } from "lucide-react"
import { cn } from "@/src/shared/utils/cn.utils"
import type { SafetyAlert } from "@/src/core/entities/safety-alert.entity"
import { keyMentionsText, type KeyMentionSegment } from "@/src/core/utils/key-mentions.utils"

const INITIAL_VISIBLE = 3

interface MedicationSafetySectionProps {
  /** Already ordered most important first. */
  alerts: SafetyAlert[]
  /** "開藥注意" */
  title: string
  /** "顯示其餘 {count} 項" */
  moreLabel: string
  lessLabel: string
  disclaimer: string
  /** Wraps the alert's title so the title itself opens the cited records. */
  renderSources?: (keys: string[], unsupportedKeys: string[] | undefined, children: ReactNode) => ReactNode
  /** Splits a sentence at the source keys the model wrote into it ("(M8,
   *  M11)"), each mention named as its record. In the detail and the
   *  recommendation a mention opens its record; the title, a link already,
   *  reads plain. */
  resolveMentions?: (text: string, citedKeys: string[]) => KeyMentionSegment[]
  /** The newest cited date when every cited record is over a year old
   *  (「依據資料已逾 1 年」); labels the alert, never hides it. */
  staleEvidenceDate?: (alert: SafetyAlert) => string | undefined
  /** "依據資料已逾 1 年（{date}）" */
  staleEvidenceLabel?: string
  /** "待核對：mirabegron 未列為抗膽鹼藥" for an alert that calls a medicine
   *  anticholinergic against its listed mechanism; labels, never hides. */
  propertyReviewLabel?: (alert: SafetyAlert) => string | undefined
  /** Shown when a finished scan found nothing, so "scanned, nothing found"
   *  never reads like "not scanned". */
  emptyLabel: string
  /** A rescan is running over the alerts on screen. */
  updating?: boolean
  /** "AI 掃描中…", read by assistive tech while updating. */
  updatingLabel?: string
}

export function MedicationSafetySection({
  alerts,
  title,
  moreLabel,
  lessLabel,
  disclaimer,
  renderSources,
  resolveMentions,
  staleEvidenceDate,
  staleEvidenceLabel,
  propertyReviewLabel,
  emptyLabel,
  updating = false,
  updatingLabel,
}: MedicationSafetySectionProps) {
  const [showAll, setShowAll] = useState(false)
  const prose = (alert: SafetyAlert, text: string): ReactNode => {
    const keys = alert.sources ?? []
    if (!resolveMentions || keys.length === 0) return text
    return resolveMentions(text, keys).map((segment, i) =>
      segment.keys && renderSources ? (
        <span key={i}>
          {renderSources(
            segment.keys,
            alert.unsupportedSourceKeys?.filter((key) => segment.keys!.includes(key)),
            segment.text,
          )}
        </span>
      ) : (
        segment.text
      ),
    )
  }
  const plain = (alert: SafetyAlert, text: string) =>
    resolveMentions && alert.sources?.length ? keyMentionsText(resolveMentions(text, alert.sources)) : text
  const hiddenCount = Math.max(0, alerts.length - INITIAL_VISIBLE)
  const visible = showAll ? alerts : alerts.slice(0, INITIAL_VISIBLE)

  return (
    <section
      className="rounded-lg border border-border bg-card px-3 py-2.5"
      aria-labelledby="medical-summary-safety-title"
    >
      <h3
        id="medical-summary-safety-title"
        className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground"
      >
        {title}
        {updating ? (
          <Loader2
            className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
            role="status"
            aria-label={updatingLabel}
            data-safety-updating
          />
        ) : null}
      </h3>
      {alerts.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground" data-safety-empty>{emptyLabel}</p>
      ) : null}
      <ol className="space-y-1.5" data-safety-alerts>
        {visible.map((alert) => {
          const staleDate = staleEvidenceLabel ? staleEvidenceDate?.(alert) : undefined
          const review = propertyReviewLabel?.(alert)
          return (
            <li key={alert.id} className="border-b border-border pb-1.5 last:border-b-0 last:pb-0">
              <p className="text-[0.8125rem] font-semibold leading-snug text-foreground">
                {renderSources
                  ? renderSources(alert.sources ?? [], alert.unsupportedSourceKeys, plain(alert, alert.title))
                  : plain(alert, alert.title)}
                {staleDate ? (
                  <span className="ml-1 inline-flex items-center rounded border border-border px-1 align-baseline text-[0.625rem] font-normal leading-4 text-muted-foreground">
                    {staleEvidenceLabel!.replace("{date}", staleDate)}
                  </span>
                ) : null}
                {review ? (
                  <span
                    className="ml-1 inline-flex items-center gap-0.5 rounded border border-amber-500/40 px-1 align-baseline text-[0.625rem] font-normal leading-4 text-amber-700 dark:text-amber-300"
                    data-property-review
                  >
                    <Flag className="h-2.5 w-2.5 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
                    {review}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-foreground/85">
                {prose(alert, alert.detail)}
              </p>
              {alert.recommendation ? (
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {prose(alert, alert.recommendation)}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
          className="mt-1 flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground lg:min-h-8"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", showAll && "rotate-180")} aria-hidden="true" />
          {showAll ? lessLabel : moreLabel.replace("{count}", String(hiddenCount))}
        </button>
      ) : null}
      <p className="mt-1 text-[0.65rem] leading-snug text-muted-foreground/70">{disclaimer}</p>
    </section>
  )
}
