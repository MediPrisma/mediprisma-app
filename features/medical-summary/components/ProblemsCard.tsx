// 問題清單與負責院所 — the complete whole-person problem list: what the
// patient has, who follows it, and with what values and medicines. One markup,
// laid out by the card's own width (the right panel is resizable): three
// columns when there is room — problem and basis; key values (two lines at
// most, the review tag and citations kept beside them); managing facility and
// the first medicine tokens — and layered rows when narrow. Medicines are
// tokens with the drug master's short name; the record's full name stays in
// each token's title (owner, 2026-10-04).
"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Flag } from "lucide-react"
import { cn } from "@/src/shared/utils/cn.utils"
import type { MedicalSummaryResult } from "@/src/core/entities/medical-summary.entity"
import type { ResourceNavTarget } from "@/src/application/stores/resource-navigation.store"
import { SourceLink } from "./SourceLink"
import { resolveClaimSources } from "../utils/resolve-claim-sources"
import { keyMentionLanguage, keyMentionsText, resolveKeyMentions } from "@/src/core/utils/key-mentions.utils"

interface ProblemsCardProps {
  result: MedicalSummaryResult
  title: string
  subtitle: string
  /** "{count} 項 · 依臨床重要性" */
  metaLabel: string
  columnLabels: { problem: string; metric: string; care: string }
  /** Small label before the metric when the columns are stacked, e.g. 指標. */
  metricLabel: string
  /** "+{count} 項" — the medicines folded behind the first few. */
  medicationsMoreLabel: string
  /** Words for a flagged value (title and screen readers), e.g. 偏高. */
  abnormalLabels: { high: string; low: string; abnormal: string }
  basisLabel: string
  /** Shown before the date when it is the organization's latest record
   *  rather than a visit for this problem, e.g. 該院最近紀錄. */
  organizationLatestLabel: string
  /** Tag on a metric whose trend the cited records cannot carry. */
  metricNeedsReviewLabel: string
  /** Shown after the date when the managing visit was inferred from the
   *  pharmacy refills the row cites, e.g. 由慢箋推定. */
  inferredLabel: string
  /** Tag on a problem that rests on medicines alone, e.g. 用藥推定. */
  medicationInferredLabel: string
  /** Tag on a lab problem resting on one unassessed value, e.g. 單次數值. */
  singleValueLabel: string
  /** Tag on a chronic disease named from values spanning under three months,
   *  e.g. 數值未滿 3 個月. Optional: callers without it show no tag. */
  shortSpanLabel?: string
  /** Tag on a medicine-inferred problem whose medicine also treats another
   *  listed problem; "{problem}" is replaced. Optional. */
  medicationAlsoForLabel?: string
  /** Why a medicine token carries the 待核對 flag, e.g. 藥物分類與此問題不符，待核對. */
  medicationReviewLabel: string
  verifyLabel: string
  legendLabel: string
  showAllLabel: string
  showLessLabel: string
  typeLabel: (resourceType?: string) => string
  unverifiedLabel: string
  sourceTypeMismatchLabel: string
  onNavigate?: (target: ResourceNavTarget) => void
}

// Eight rows is roughly one screen of the section before the fold; the rest of
// a 12-problem patient stays one click away rather than pushing 影像與病理重點
// off.
const INITIAL_VISIBLE = 8
// A row shows its first few medicines (two in the narrower third column of
// the three-column layout); the rest open on request.
const INITIAL_MEDICATIONS = 3
const INITIAL_MEDICATIONS_WIDE = 2

export function ProblemsCard({
  result,
  title,
  subtitle,
  metaLabel,
  columnLabels,
  metricLabel,
  medicationsMoreLabel,
  abnormalLabels,
  basisLabel,
  organizationLatestLabel,
  metricNeedsReviewLabel,
  inferredLabel,
  medicationInferredLabel,
  singleValueLabel,
  shortSpanLabel,
  medicationAlsoForLabel,
  medicationReviewLabel,
  verifyLabel,
  legendLabel,
  showAllLabel,
  showLessLabel,
  typeLabel,
  unverifiedLabel,
  sourceTypeMismatchLabel,
  onNavigate,
}: ProblemsCardProps) {
  const [showAll, setShowAll] = useState(false)
  const [openMedications, setOpenMedications] = useState<ReadonlySet<number>>(new Set())
  const problems = result.problems ?? []
  if (problems.length === 0) return null
  const byKey = new Map(result.sourceIndex.map((source) => [source.key, source]))
  const visible = showAll ? problems : problems.slice(0, INITIAL_VISIBLE)
  const hiddenCount = Math.max(0, problems.length - INITIAL_VISIBLE)

  return (
    <section
      className="rounded-lg border border-border bg-card px-3 py-2.5"
      aria-labelledby="medical-summary-problems-title"
    >
      {/* Narrow containers stack the two header lines: a wrapping subtitle and
          a right-aligned count interleave into an unreadable zig-zag. */}
      <div className="@container mb-1">
        <div className="flex flex-col gap-0 @min-[34rem]:flex-row @min-[34rem]:items-baseline @min-[34rem]:justify-between @min-[34rem]:gap-2">
          <h3
            id="medical-summary-problems-title"
            className="min-w-0 text-[length:max(12px,0.75rem)] font-semibold tracking-wide text-muted-foreground"
          >
            {title}
            <span className="ml-1 font-normal text-muted-foreground/80">{subtitle}</span>
          </h3>
          <span className="shrink-0 text-[length:max(12px,0.75rem)] tabular-nums text-muted-foreground/80">
            {metaLabel.replace("{count}", String(problems.length))}
          </span>
        </div>
      </div>

      {/* @container: three columns from 38rem of card width; below that the
          same cells dissolve (display: contents) into layered rows — name and
          facility on one line from 28rem, everything stacked under it. */}
      <div className="@container">
        {/* One grid for the whole list in the three-column layout, each row a
            subgrid: the columns are sized by every row's content together —
            the care column only as wide as its facility and medicines need
            (up to 14rem), the rest shared by the problem (at least 11rem) and the key values — and still line up. */}
        <ul className="@min-[38rem]:grid @min-[38rem]:grid-cols-[minmax(11rem,1fr)_minmax(0,1.15fr)_fit-content(14rem)] @min-[38rem]:gap-x-3">
          <li
            aria-hidden="true"
            className="hidden border-b border-border pb-1 text-[length:max(12px,0.75rem)] font-medium leading-snug text-muted-foreground @min-[38rem]:col-span-3 @min-[38rem]:grid @min-[38rem]:grid-cols-subgrid"
            data-problem-column-headings
          >
            <span>{columnLabels.problem}</span>
            <span>{columnLabels.metric}</span>
            <span>{columnLabels.care}</span>
          </li>
          {visible.map((problem, index) => {
            // Finalize-detected evidence-type mismatches (依據:心電圖 citing a
            // chest X-ray) tint that citation amber instead of hiding it.
            const suspectKeys = problem.suspectSourceKeys?.length
              ? new Set(problem.suspectSourceKeys)
              : undefined
            // The cited text is the link: no citation marks beside it.
            const cited = (
              keys: readonly string[] | undefined,
              children: ReactNode,
              variant: "text" | "token" = "text",
              className?: string,
            ) => {
              if (!keys?.length) return children
              return (
                <SourceLink
                  sources={resolveClaimSources([...keys], byKey, problem.documentEvidence)}
                  typeLabel={typeLabel}
                  unverifiedLabel={unverifiedLabel}
                  suspectKeys={suspectKeys}
                  suspectLabel={sourceTypeMismatchLabel}
                  onNavigate={onNavigate}
                  variant={variant}
                  className={className}
                >
                  {children}
                </SourceLink>
              )
            }
            // Per-column citations: each claim carries the records behind it.
            // Legacy results (demo snapshots, caches) hold one row-level list.
            const perColumn = Boolean(
              problem.basisSourceKeys || problem.metricSourceKeys || problem.medicationSourceKeys,
            )
            // "2 care plans (K1, K2)": keys the model wrote into the basis read
            // as the records they name; the line itself opens them.
            const basisKeys = (perColumn ? problem.basisSourceKeys : problem.sourceKeys) ?? []
            const basisText = problem.basis
              ? keyMentionsText(resolveKeyMentions(
                  problem.basis,
                  basisKeys,
                  (key) => byKey.get(key),
                  keyMentionLanguage(problem.basis),
                ))
              : undefined
            const managedByDate = !problem.managedByDate
              ? undefined
              : problem.managedByScope === "organization"
                ? `${organizationLatestLabel} ${problem.managedByDate}`
                : problem.managedByScope === "inferred"
                  ? `${problem.managedByDate}（${inferredLabel}）`
                  : problem.managedByDate
            const managedByLine = [problem.managedBy, managedByDate]
              .filter(Boolean)
              .join(" · ")
            const medicationItems = problem.medicationItems ?? []
            const medicationsOpen = openMedications.has(index)
            const toggleMedications = () => setOpenMedications((current) => {
              const next = new Set(current)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
            const moreButton = (count: number, className: string) => (
              <button
                type="button"
                onClick={toggleMedications}
                aria-expanded={medicationsOpen}
                className={cn(
                  "relative shrink-0 rounded-full px-1 text-[length:max(12px,0.75rem)] leading-[1.375rem] text-primary hover:text-primary/80 before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] lg:before:-inset-y-1",
                  className,
                )}
              >
                {medicationsOpen ? showLessLabel : medicationsMoreLabel.replace("{count}", String(count))}
              </button>
            )
            const tag = (label: string) => (
              <span className="ml-1 inline-flex items-center rounded border border-border px-1 align-baseline text-[length:max(12px,0.75rem)] font-normal leading-[1.125rem] text-muted-foreground">
                {label}
              </span>
            )
            return (
              <li
                key={`${problem.label}-${index}`}
                className={cn(
                  "grid gap-x-3 gap-y-0.5 border-b border-border py-1.5 last:border-b-0",
                  "grid-cols-1 [grid-template-areas:'name'_'org'_'basis'_'metric'_'meds']",
                  "@min-[28rem]:grid-cols-[minmax(0,1fr)_auto] @min-[28rem]:[grid-template-areas:'name_org'_'basis_basis'_'metric_metric'_'meds_meds']",
                  "@min-[38rem]:col-span-3 @min-[38rem]:grid-cols-subgrid @min-[38rem]:[grid-template-areas:none] @min-[38rem]:items-start",
                )}
              >
                <div className="contents @min-[38rem]:block @min-[38rem]:min-w-0" data-problem-column="problem">
                  <p className="min-w-0 text-[length:max(14px,0.9375rem)] font-semibold leading-snug text-foreground break-words [grid-area:name]">
                    {/* The name opens the records behind the problem when no
                        basis line carries them. */}
                    {cited(
                      perColumn ? (problem.basis ? undefined : problem.basisSourceKeys) : problem.sourceKeys,
                      problem.label,
                    )}
                    {problem.inferredFromMedication ? tag(medicationInferredLabel) : null}
                    {problem.singleUnassessedLab ? tag(singleValueLabel) : null}
                    {problem.shortSpanChronic && shortSpanLabel ? tag(shortSpanLabel) : null}
                    {problem.medicationAlsoFor && medicationAlsoForLabel
                      ? tag(medicationAlsoForLabel.replace("{problem}", problem.medicationAlsoFor))
                      : null}
                    {problem.flag ? (
                      <Flag
                        className="ml-1 inline h-3.5 w-3.5 shrink-0 align-[-0.125em] text-amber-500 dark:text-amber-300"
                        aria-label={verifyLabel}
                      />
                    ) : null}
                  </p>
                  {problem.basis ? (
                    <p className="text-[length:max(12px,0.75rem)] leading-snug text-muted-foreground break-words [grid-area:basis]">
                      <span className="text-muted-foreground/80">{basisLabel}</span>
                      {perColumn ? cited(problem.basisSourceKeys, basisText) : basisText}
                    </p>
                  ) : null}
                </div>
                <div className="contents @min-[38rem]:block @min-[38rem]:min-w-0" data-problem-column="metric">
                  {problem.metric ? (
                    <div className="flex min-w-0 items-start gap-0.5 [grid-area:metric]">
                      <RowFillClamp
                        className="min-w-0 flex-1 text-[length:max(13px,0.8125rem)] leading-snug tabular-nums text-foreground break-words"
                        title={problem.metric}
                      >
                        <span className="mr-1.5 text-[length:max(12px,0.75rem)] text-muted-foreground @min-[38rem]:sr-only">{metricLabel}</span>
                        {cited(perColumn ? problem.metricSourceKeys : undefined, problem.metricSegments?.length
                          ? problem.metricSegments.map((segment, segmentIndex) => segment.abnormal ? (
                            // Same rule and colour as the lab tables; the
                            // arrow and the label carry it beyond colour.
                            <span
                              key={segmentIndex}
                              className="font-semibold text-clinical-abnormal"
                              title={abnormalLabels[segment.abnormal]}
                              data-metric-abnormal={segment.abnormal}
                            >
                              {segment.text}
                              {segment.abnormal === "high" ? "↑" : segment.abnormal === "low" ? "↓" : null}
                              <span className="sr-only">（{abnormalLabels[segment.abnormal]}）</span>
                            </span>
                          ) : (
                            <span key={segmentIndex}>{segment.text}</span>
                          ))
                          : problem.metric)}
                        {/* The model often writes the date into the value
                            ("Echo: … (2026-07-07)"); then it is not repeated. */}
                        {problem.metricMeta && !problem.metric.includes(problem.metricMeta) ? (
                          <span className="ml-1 text-[length:max(12px,0.75rem)] text-muted-foreground">（{problem.metricMeta}）</span>
                        ) : null}
                      </RowFillClamp>
                      {/* Kept outside the two-line clamp: the review tag must
                          never be cut off. */}
                      {problem.metricNeedsReview ? (
                        <span className="inline-flex shrink-0 items-center rounded border border-amber-500/40 px-1 text-[length:max(13px,0.8125rem)] leading-5 text-amber-700 dark:text-amber-300">
                          {metricNeedsReviewLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="contents @min-[38rem]:block @min-[38rem]:min-w-0 @min-[38rem]:space-y-0.5" data-problem-column="care">
                  {managedByLine ? (
                    <p className="text-[length:max(13px,0.8125rem)] leading-snug tabular-nums text-muted-foreground break-words [grid-area:org] @min-[28rem]:text-right @min-[38rem]:text-left" data-problem-managed-by>
                      {cited(problem.managedBySourceKey ? [problem.managedBySourceKey] : undefined, managedByLine)}
                    </p>
                  ) : null}
                  {medicationItems.length > 0 ? (
                    <div
                      className="flex min-w-0 flex-wrap items-center gap-1 [grid-area:meds]"
                      data-problem-medications
                    >
                      {medicationItems.map((item, itemIndex) => {
                        if (!medicationsOpen && itemIndex >= INITIAL_MEDICATIONS) return null
                        // Each token opens its own record; the record's full
                        // name stays in the title. A medicine whose class does
                        // not treat this problem carries the 待核對 flag.
                        const review = problem.medicationReviewKeys?.includes(item.key) ?? false
                        return (
                          <span
                            key={item.key}
                            title={review ? `${item.fullName} — ${medicationReviewLabel}` : item.fullName}
                            className={cn(
                              "inline-block max-w-full truncate rounded-full border bg-muted text-[length:max(12px,0.75rem)] leading-[1.375rem] text-foreground",
                              review ? "border-amber-500/60" : "border-border",
                              !medicationsOpen && itemIndex >= INITIAL_MEDICATIONS_WIDE && "@min-[38rem]:hidden",
                            )}
                            data-problem-medication
                            data-medication-review={review || undefined}
                          >
                            {cited(
                              [item.key],
                              review ? (
                                <>
                                  <Flag className="mr-0.5 inline h-3 w-3 align-[-0.1em] text-amber-500 dark:text-amber-300" aria-hidden="true" />
                                  {item.name}
                                  <span className="sr-only">（{medicationReviewLabel}）</span>
                                </>
                              ) : item.name,
                              "token",
                              "block truncate rounded-full px-1.5",
                            )}
                          </span>
                        )
                      })}
                      {medicationsOpen
                        ? (medicationItems.length > INITIAL_MEDICATIONS_WIDE ? moreButton(0, "") : null)
                        : (
                          <>
                            {medicationItems.length > INITIAL_MEDICATIONS
                              ? moreButton(medicationItems.length - INITIAL_MEDICATIONS, "@min-[38rem]:hidden")
                              : null}
                            {medicationItems.length > INITIAL_MEDICATIONS_WIDE
                              ? moreButton(medicationItems.length - INITIAL_MEDICATIONS_WIDE, "hidden @min-[38rem]:inline")
                              : null}
                          </>
                        )}
                    </div>
                  ) : problem.medications ? (
                    // A result from before per-medicine items: the joined names.
                    <p className="text-[length:max(12px,0.75rem)] leading-snug text-muted-foreground break-words [grid-area:meds]">
                      {perColumn ? cited(problem.medicationSourceKeys, problem.medications) : problem.medications}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="flex items-center gap-1 text-[length:max(12px,0.75rem)] leading-snug text-muted-foreground/80">
          <Flag className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
          {legendLabel}
        </p>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="flex min-h-[44px] items-center gap-1 text-[length:max(12px,0.75rem)] font-medium text-primary hover:text-primary/80 lg:min-h-8"
            aria-expanded={showAll}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
            {showAll
              ? showLessLabel
              : showAllLabel.replace("{count}", String(problems.length))}
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * The key values in the three-column layout: as many lines as the row already
 * has room for (the care column's facility and tokens usually make it taller
 * than two lines), never fewer than two, then an ellipsis. The row's height is
 * set by the other columns, so filling it adds no height. Unclamped when the
 * columns are stacked (the cell is display: contents).
 */
function RowFillClamp({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [lines, setLines] = useState<number | null>(2)
  useLayoutEffect(() => {
    const text = ref.current
    const cell = text?.closest<HTMLElement>('[data-problem-column="metric"]')
    const row = text?.closest<HTMLElement>("li")
    if (!text || !cell || !row || typeof ResizeObserver === "undefined") return
    const update = () => {
      if (getComputedStyle(cell).display === "contents") {
        setLines(null)
        return
      }
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return
      const rowStyle = getComputedStyle(row)
      const room = row.clientHeight - parseFloat(rowStyle.paddingTop) - parseFloat(rowStyle.paddingBottom)
      setLines(Math.max(2, Math.floor((room + 1) / lineHeight)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    return () => observer.disconnect()
  }, [])
  return (
    <p
      ref={ref}
      className={className}
      title={title}
      style={lines ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" } : undefined}
    >
      {children}
    </p>
  )
}
