// 影像與病理重點 — the key findings across the imaging and pathology reports,
// one row per organ. The model only selected the findings and stated each in
// a line; every verified point carries at least one quote the app verified
// verbatim against its report, and every chip (modality, date) is the app's,
// read from the report itself — never from the line. A point whose line
// dropped the report's uncertainty is shown as the report's own words, tagged
// 原文. Every report no point cites folds into the footer, so nothing in the
// digest disappears silently. Unverified AI points remain visible with an
// explicit label and links to their cited reports.
"use client"

import { useState } from "react"
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/src/shared/utils/cn.utils"
import type {
  ReportFindingPoint,
  ReportFindingSource,
  ReportHighlightKind,
  ReportHighlights,
  ReportRow,
} from "@/src/core/entities/medical-summary.entity"
import type { ResourceNavTarget } from "@/src/application/stores/resource-navigation.store"
import { useOptionalLanguage } from "@/src/application/providers/language.provider"
import { formatOrganizationDisplay } from "@/src/shared/utils/organization-display"

const HAN = /[㐀-鿿]/
/** Report chips a point shows before "+N". */
const CHIPS_SHOWN = 2

/** Quote marks that match the quote's own script — a quote stays in the
 *  report's original language, whatever the interface language is. */
function quoted(text: string, truncated = false): string {
  const body = truncated ? `${text}…` : text
  return HAN.test(text) ? `「${body}」` : `“${body}”`
}

/** MM-DD inside the newest year the section shows, YYYY-MM-DD otherwise —
 *  the year is read off the reports, never the wall clock. */
export function reportChipDate(date: string | undefined, newestYear: string | undefined): string {
  if (!date) return "—"
  return newestYear && date.startsWith(`${newestYear}-`) && date.length >= 10
    ? date.slice(5, 10)
    : date.slice(0, 10)
}

export interface ReportHighlightsCardLabels {
  title: string
  /** Short modality labels for chips and footer rows. */
  kindLabels: Record<ReportHighlightKind, string>
  /** Tag on a point shown as its quote, e.g. 原文. */
  originalTag: string
  showQuotes: string
  hideQuotes: string
  /** "{count}" — footer when the summary ran. */
  othersSummarized: string
  /** "{count}" — footer when the summary is unavailable. */
  othersAll: string
  /** "{count}" — reports the model never finished reading (past the cap, or
   *  a reply cut off); listed with their excerpt. */
  unreviewed: string
  /** One-line note when the summary failed or never ran. */
  unavailable: string
  /** "{count}" — points not shown because no quote matched. */
  hiddenPoints: string
  /** Label on each AI point whose wording was not verified. */
  unverifiedTag: string
  /** Note above the unverified AI points. */
  hiddenPointsNote: string
  conclusionTag: string
  openingTag: string
  /** "{count}" — accessible name of the "+N" that shows a point's other reports. */
  moreSources: string
  /** Said when the scope holds no imaging or pathology report at all, e.g.
   *  「過去一年無檢查報告」 for a 雲端病歷 year; without it the section is
   *  not drawn. */
  noReports?: string
}

interface ReportHighlightsCardProps {
  highlights: ReportHighlights
  labels: ReportHighlightsCardLabels
  onNavigate?: (target: ResourceNavTarget) => void
}

function navTarget(source: ReportFindingSource, evidenceQuote?: string): ResourceNavTarget {
  return {
    resourceType: source.resourceType,
    resourceId: source.resourceId,
    display: source.title,
    date: source.date,
    ...(evidenceQuote ? { evidenceQuote } : {}),
  }
}

export function ReportHighlightsCard({ highlights, labels, onNavigate }: ReportHighlightsCardProps) {
  const language = useOptionalLanguage()
  const locale = language?.locale ?? "zh-TW"
  const groups = highlights.groups ?? []
  const others = highlights.others ?? []
  const unreviewed = highlights.unreviewed ?? []
  // Nothing to list at all: the section has no content of its own.
  const [othersOpen, setOthersOpen] = useState(groups.length === 0)
  const [unreviewedOpen, setUnreviewedOpen] = useState(groups.length === 0 && others.length === 0)
  const [openPoints, setOpenPoints] = useState<ReadonlySet<string>>(new Set())
  const unverifiedPoints = highlights.hiddenPoints ?? []
  if (groups.length === 0 && others.length === 0 && unreviewed.length === 0 && unverifiedPoints.length === 0) {
    if (!labels.noReports || highlights.totalReports > 0) return null
    return (
      <section className="rounded-lg border border-border bg-card px-3 py-2.5" aria-labelledby="medical-summary-reports-title">
        <h3 id="medical-summary-reports-title" className="mb-1 text-[length:max(12px,0.75rem)] font-semibold tracking-wide text-muted-foreground">
          {labels.title}
        </h3>
        <p className="text-[length:max(13px,0.8125rem)] leading-snug text-muted-foreground" data-no-reports>{labels.noReports}</p>
      </section>
    )
  }

  const newestYear = [
    ...groups.flatMap((group) => group.points.flatMap((point) => point.sources.map((source) => source.date))),
    ...others.map((row) => row.date),
    ...unverifiedPoints.flatMap((point) => point.sources.map((source) => source.date)),
  ]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)
    ?.slice(0, 4)

  const togglePoint = (id: string) => setOpenPoints((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const chipLabel = (source: ReportFindingSource) => `${labels.kindLabels[source.kind]} ${reportChipDate(source.date, newestYear)}`
  const chip = (source: ReportFindingSource, quotes: ReportFindingPoint["quotes"] = [], sameDayCount = 1) => {
    const label = sameDayCount > 1 ? `${chipLabel(source)} ×${sameDayCount}` : chipLabel(source)
    const evidenceQuote = quotes.find((quote) => quote.key === source.key)?.quote
    const className =
      "relative ml-1 inline-flex items-center whitespace-nowrap rounded border border-border bg-muted/40 px-1.5 align-baseline text-[length:max(12px,0.75rem)] leading-[1.375rem] tabular-nums text-muted-foreground"
    if (!onNavigate) {
      return <span key={source.key} className={className} data-report-chip={source.key}>{label}</span>
    }
    return (
      <button
        key={source.key}
        type="button"
        data-report-chip={source.key}
        title={[source.title, source.organization ? formatOrganizationDisplay(source.organization, locale) : ""].filter(Boolean).join(" · ")}
        onClick={() => onNavigate(navTarget(source, evidenceQuote))}
        className={cn(
          className,
          "transition-colors hover:bg-muted hover:text-foreground",
          // The chip is ~18px tall; an invisible overlay extends the touch
          // target toward 44px without breaking the line it sits in.
          "before:absolute before:-inset-x-0.5 before:-inset-y-3 before:content-[''] lg:before:-inset-y-1",
        )}
      >
        {label}
      </button>
    )
  }

  // A finding seen on many serial studies would line up a chip per study
  // ("MRI 07-08" ×8): the first few, the rest one click away.
  // Studies of one kind on one day ("CT 08-14" twice: a chest and an abdomen
  // series) read as one chip with a count until the point is opened; the
  // chip opens the first, and opening the point lists each.
  const chips = (id: string, sources: ReportFindingSource[], quotes?: ReportFindingPoint["quotes"]) => {
    const open = openPoints.has(id)
    const sameDay = new Map<string, ReportFindingSource[]>()
    for (const source of sources) {
      const label = chipLabel(source)
      sameDay.set(label, [...(sameDay.get(label) ?? []), source])
    }
    const merged = [...sameDay.values()]
    const shown = merged.slice(0, CHIPS_SHOWN)
    // Counted in studies, not chips: "+3" means three more reports.
    const hidden = sources.length - shown.reduce((sum, group) => sum + group.length, 0)
    return (
      <>
        {open
          ? sources.map((source) => chip(source, quotes))
          : shown.map((group) => chip(group[0], quotes, group.length))}
        {!open && hidden > 0 ? (
          <button
            type="button"
            onClick={() => togglePoint(id)}
            aria-label={labels.moreSources.replace("{count}", String(hidden))}
            className="relative ml-1 inline-flex items-center rounded px-1 align-baseline text-[length:max(12px,0.75rem)] leading-[1.375rem] tabular-nums text-muted-foreground transition-colors hover:text-foreground before:absolute before:-inset-x-0.5 before:-inset-y-3 before:content-[''] lg:before:-inset-y-1"
            data-report-more-sources
          >
            +{hidden}
          </button>
        ) : null}
      </>
    )
  }

  const footerLabel = (highlights.summarized ? labels.othersSummarized : labels.othersAll)
    .replace("{count}", String(others.length))

  const otherRow = (row: ReportRow, withExcerpt = !highlights.summarized) => {
    const organizationLabel = row.organization ? formatOrganizationDisplay(row.organization, locale) : ""
    const showExcerpt = withExcerpt && row.excerpt
    const inner = (
      <span className="block min-w-0">
        <span className="block text-[length:max(13px,0.8125rem)] leading-snug text-foreground/90">
          <span className="font-semibold tabular-nums text-foreground/80">{row.date ?? "—"}</span>
          {" · "}
          {labels.kindLabels[row.kind]}
          {" · "}
          {row.title}
          {organizationLabel ? <span className="text-muted-foreground">{" · "}{organizationLabel}</span> : null}
          {onNavigate ? (
            <ArrowUpRight className="ml-1 inline h-3 w-3 align-[-0.1em] text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-60" aria-hidden="true" />
          ) : null}
        </span>
        {showExcerpt ? (
          <span className="mt-0.5 block break-words text-[length:max(13px,0.8125rem)] leading-snug text-muted-foreground">
            <span
              className="mr-1 whitespace-nowrap rounded border border-dashed border-border px-1 py-px text-[length:max(12px,0.75rem)]"
              data-excerpt-source={row.excerptSource}
            >
              {row.excerptSource === "conclusion" ? labels.conclusionTag : labels.openingTag}
            </span>
            {quoted(row.excerpt!, Boolean(row.excerptTruncated))}
          </span>
        ) : null}
      </span>
    )
    return (
      <li key={row.key} className="border-b border-border last:border-b-0" data-report-row={row.key}>
        {onNavigate ? (
          <button
            type="button"
            onClick={() => onNavigate(navTarget(row, row.excerpt))}
            className="group -mx-1 flex min-h-[44px] w-[calc(100%+0.5rem)] items-center rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50 lg:min-h-8"
          >
            {inner}
          </button>
        ) : (
          <div className="py-1">{inner}</div>
        )}
      </li>
    )
  }

  return (
    <section
      className="rounded-lg border border-border bg-card px-3 py-2.5"
      aria-labelledby="medical-summary-reports-title"
    >
      <h3
        id="medical-summary-reports-title"
        className="mb-1 text-[length:max(12px,0.75rem)] font-semibold tracking-wide text-muted-foreground"
      >
        {labels.title}
      </h3>

      {groups.length > 0 ? (
        <div className="@container">
          <ul>
            {groups.map((group) => (
              <li
                key={group.organ}
                data-report-organ={group.organ}
                className="grid grid-cols-1 gap-x-3 border-b border-border py-1.5 last:border-b-0 @min-[26rem]:grid-cols-[max(4.5rem,66px)_minmax(0,1fr)]"
              >
                <span className="text-[length:max(13px,0.8125rem)] font-semibold leading-snug text-foreground/80 @min-[26rem]:pt-px">
                  {group.label}
                </span>
                <ul className="min-w-0 space-y-0.5">
                  {group.points.map((point, index) => {
                    const id = `${group.organ}-${index}`
                    const open = openPoints.has(id)
                    const showAsQuote = point.displayAs === "quote"
                    return (
                      <li key={id} data-report-point={point.displayAs} className="flex items-start gap-1">
                        {showAsQuote ? (
                          <span className="mt-[0.375rem] h-3 w-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => togglePoint(id)}
                            aria-expanded={open}
                            aria-label={open ? labels.hideQuotes : labels.showQuotes}
                            className="relative mt-[0.375rem] flex h-3 w-3 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground before:absolute before:-inset-4 before:content-[''] lg:before:-inset-1.5"
                          >
                            <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} aria-hidden="true" />
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[length:max(13px,0.875rem)] leading-snug text-foreground">
                            {showAsQuote ? (
                              <>
                                <span
                                  className="mr-1 whitespace-nowrap rounded border border-border px-1 py-px align-[0.0625rem] text-[length:max(12px,0.75rem)] font-medium text-muted-foreground"
                                  data-original-wording
                                >
                                  {labels.originalTag}
                                </span>
                                {/* Serial studies often repeat a finding word for word
                                    (two ECGs, "…age undetermined"); the chips already
                                    show every source, so print each wording once. */}
                                {point.quotes
                                  .filter((quote, quoteIndex, all) => all.findIndex((other) => other.quote.trim() === quote.quote.trim()) === quoteIndex)
                                  .map((quote, quoteIndex) => (
                                  <span key={`${quote.key}-${quoteIndex}`} className="text-foreground/90">
                                    {quoteIndex > 0 ? " " : null}
                                    {quoted(quote.quote)}
                                  </span>
                                ))}
                              </>
                            ) : (
                              <span
                                className="cursor-pointer"
                                onClick={() => togglePoint(id)}
                              >
                                {point.text}
                              </span>
                            )}
                            {chips(id, point.sources, point.quotes)}
                          </p>
                          {open && !showAsQuote ? (
                            <ul className="mt-0.5 space-y-0.5 border-l border-border pl-2">
                              {point.quotes.map((quote, quoteIndex) => {
                                const source = point.sources.find((candidate) => candidate.key === quote.key)
                                return (
                                  <li
                                    key={`${quote.key}-${quoteIndex}`}
                                    className="break-words text-[length:max(13px,0.8125rem)] leading-snug text-muted-foreground"
                                    data-verified-quote={quote.key}
                                  >
                                    {quoted(quote.quote)}
                                    {source ? (
                                      <span className="ml-1 whitespace-nowrap tabular-nums text-muted-foreground/80">
                                        {labels.kindLabels[source.kind]} {reportChipDate(source.date, newestYear)}
                                      </span>
                                    ) : null}
                                  </li>
                                )
                              })}
                            </ul>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!highlights.summarized ? (
        <p className="mt-0.5 text-[length:max(13px,0.8125rem)] leading-snug text-muted-foreground">{labels.unavailable}</p>
      ) : null}

      {unverifiedPoints.length > 0 ? (
        <div className="mt-2 border-t border-border pt-2" data-hidden-points>
          <p className="text-[length:max(13px,0.8125rem)] leading-snug text-muted-foreground">{labels.hiddenPointsNote}</p>
          <ul className="mt-1 space-y-1">
            {unverifiedPoints.map((point, index) => (
              <li key={point.organ + '-' + index} className="break-words text-[length:max(13px,0.875rem)] leading-snug text-foreground" data-unverified-point>
                <span className="mr-1 inline-block rounded border border-border bg-muted/40 px-1 py-px text-[length:max(13px,0.8125rem)] font-medium text-muted-foreground" data-unverified-tag>
                  {labels.unverifiedTag}
                </span>
                {point.text}
                {chips(`unverified-${index}`, point.sources)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {highlights.hiddenPointCount > unverifiedPoints.length ? (
        <p className="mt-0.5 text-[length:max(12px,0.75rem)] text-muted-foreground/80">
          {labels.hiddenPoints.replace("{count}", String(highlights.hiddenPointCount - unverifiedPoints.length))}
        </p>
      ) : null}

      {others.length > 0 ? (
        <div className={cn(groups.length > 0 && "mt-0.5 border-t border-border")}>
          <button
            type="button"
            onClick={() => setOthersOpen((value) => !value)}
            aria-expanded={othersOpen}
            className="flex min-h-[44px] w-full items-center gap-1.5 text-left text-[length:max(13px,0.8125rem)] text-muted-foreground transition-colors hover:text-foreground lg:min-h-8"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 -rotate-90 transition-transform", othersOpen && "rotate-0")} aria-hidden="true" />
            {footerLabel}
          </button>
          {othersOpen ? <ul className="pb-0.5">{others.map((row) => otherRow(row))}</ul> : null}
        </div>
      ) : null}

      {unreviewed.length > 0 ? (
        <div className={cn((groups.length > 0 || others.length > 0) && "border-t border-border")} data-report-unreviewed>
          <button
            type="button"
            onClick={() => setUnreviewedOpen((value) => !value)}
            aria-expanded={unreviewedOpen}
            className="flex min-h-[44px] w-full items-center gap-1.5 text-left text-[length:max(13px,0.8125rem)] text-muted-foreground transition-colors hover:text-foreground lg:min-h-8"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 -rotate-90 transition-transform", unreviewedOpen && "rotate-0")} aria-hidden="true" />
            {labels.unreviewed.replace("{count}", String(unreviewed.length))}
          </button>
          {unreviewedOpen ? <ul className="pb-0.5">{unreviewed.map((row) => otherRow(row, true))}</ul> : null}
        </div>
      ) : null}
    </section>
  )
}
