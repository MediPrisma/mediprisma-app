"use client"

// 影像／檢查報告 — the narrative half of the 報告 tab.
//
// Rows come from the same `buildReportsData` projection the 報告 tab renders,
// so the title, the type badge and the institution label are identical; only
// the density differs (one line in the 2×2 layout, two lines when stacked).
import { useMemo, useState, type Ref } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, Loader2, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { FormattedReportText } from '@/features/clinical-summary/reports/components/FormattedReportText'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { formatReportTextForClipboard } from '@/src/shared/utils/report-text-format'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import { formatDate } from '@/src/shared/utils/date.utils'
import { cn } from '@/src/shared/utils/cn.utils'
import { ReportTypeBadge } from '@/features/clinical-summary/reports/components/ReportTypeBadge'
import { ReportInstitutionLabel } from '@/features/clinical-summary/reports/components/ReportInstitutionLabel'
import {
  NhiViewerActions,
  NhiViewerTooltip,
  nhiViewerFirstLabel,
  nhiViewerOpenLabel,
  nhiViewerPrerequisiteHint,
  useNhiViewerOpener,
} from '@/features/clinical-summary/reports/components/NhiViewerActions'
import type { ReportGroup } from '@/features/clinical-summary/reports/types'
import type { OverviewReportItem, OverviewReportsData } from '../hooks/useOverviewData'
import type { OverviewSectionFit } from '../overview.types'
import { OVERVIEW_SECTION_DOM_ID } from '../overview.types'
import { OverviewSectionCard } from './OverviewSectionCard'
import {
  OverviewEmptyRow,
  OverviewExpandButton,
  OverviewFullListDialog,
  OverviewTruncationNote,
  useOverviewNavigate,
} from './OverviewSectionParts'
import { OVERVIEW_LIST_ROW_CLASS, overviewChipClass } from './overview-styles'

/** Single-line row: 26px of content, the row's 2px border, the 4px stack gap. */

// ReportGroup ids and the reports card's sub-tab values are the same strings,
// except 'other', which has no tab of its own and falls back to the card's
// existing "first tab that contains the row" behaviour.
function reportTabForGroup(group: ReportGroup | undefined): string | undefined {
  return group && group !== 'other' ? group : undefined
}

function matchedGroupOf(items: { group: ReportGroup }[]): string | undefined {
  return reportTabForGroup(items[0]?.group)
}

/**
 * The type badge IS the 健保影像 entry when the study carries one.
 *
 * A badge plus its own viewer button gave a row two targets for what the
 * reader thinks of as one thing, and the row itself is a third. The badge
 * already says 「影像」, so hanging 「開啟影像」 on it costs no extra width and
 * leaves exactly one thing to aim at. Picking BETWEEN several studies stays in
 * the opened report, where there is room to label them; out here the first one
 * opens, which is what the reader wants in the common single-study case.
 */
function OverviewReportBadge({ item }: { item: OverviewReportItem }) {
  const { locale } = useLanguage()
  const { opening, open } = useNhiViewerOpener()
  const actions = item.viewerActions ?? []

  if (actions.length === 0) return <ReportTypeBadge group={item.group} className="h-5" />

  const label = nhiViewerFirstLabel(locale, actions.length)
  // The prerequisite rides the tooltip, not the accessible name: a screen
  // reader would otherwise read the whole caveat on every imaging row.
  const hint = actions.some((action) => action.kind === 'live')
    ? nhiViewerPrerequisiteHint(locale)
    : null
  return (
    <NhiViewerTooltip label={nhiViewerOpenLabel(locale)} hint={hint}>
      <button
        type="button"
        disabled={opening}
        aria-label={label}
        // The row opens the narrative; this opens the images. Both are legitimate
        // reads of a tap on the badge, so the badge has to claim the event.
        onClick={(event) => {
          event.stopPropagation()
          void open(actions[0])
        }}
        onKeyDown={(event) => event.stopPropagation()}
        // The badge is small and the row is a fixed 26px, so the touch target is
        // grown with padding that negative margin pays back: the hit box gets
        // taller and wider, the laid-out box does not move.
        className="-mx-1 -my-1.5 shrink-0 rounded-md px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-wait"
      >
        <ReportTypeBadge
          group={item.group}
          className="h-5 cursor-pointer gap-0.5 pr-1 transition-colors hover:brightness-95"
          // Same glyph and size the 報告 tab's viewer buttons use, so the two
          // surfaces teach the reader one symbol rather than two.
          trailing={opening
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            : <ExternalLink className="h-3 w-3" aria-hidden="true" />}
        />
      </button>
    </NhiViewerTooltip>
  )
}

export function OverviewReportsSection({
  data,
  fit,
  flash = false,
  headingRef,
}: {
  data: OverviewReportsData
  fit: OverviewSectionFit
  flash?: boolean
  headingRef?: Ref<HTMLDivElement>
}) {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const navigateTo = useOverviewNavigate()
  const [group, setGroup] = useState<ReportGroup | 'all'>('all')
  // The 2×2 card has room for exactly one open narrative, so expansion is
  // single-select there; the stacked layout keeps the same rule for symmetry.
  // A report opens in a dialog rather than expanding in place. The bounded
  // 2×2 card is a fixed height by design, so growing a row inside it either
  // pushed the other rows out or clipped the narrative to a couple of lines —
  // and a radiology conclusion is the one thing here that has to be read
  // whole. The dialog also lets the reader keep their place in the list.
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  // Same helper the 報告 tab uses, so 「已複製」 behaves identically here.
  const { copied, copy: copyToClipboard } = useCopyToClipboard(1500)
  // Which block the last copy came from — one shared 「已複製」 flash across
  // several buttons would light up the wrong report.
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const badgeLabels = t.reports.typeBadges as Record<string, string>
  const effectiveGroup = group !== 'all' && !data.groups.includes(group) ? 'all' : group
  const matched = useMemo(
    () => (effectiveGroup === 'all'
      ? data.items
      : data.items.filter((item) => item.group === effectiveGroup)),
    [data.items, effectiveGroup],
  )

  // 「全部」 is a flat per-report index, so landing there after reading a
  // truncated imaging list means searching for the same rows again. Send the
  // reader to the sub-tab they were already filtered to — or, with no filter,
  // the one the first listed report belongs to. 'other' has no sub-tab of its
  // own; that request is simply omitted and the card keeps its own behaviour.
  const preferredReportTab = effectiveGroup !== 'all'
    ? reportTabForGroup(effectiveGroup)
    : matchedGroupOf(matched)
  const target = {
    resourceType: 'DiagnosticReport',
    resourceId: matched[0]?.navResourceId ?? data.items[0]?.navResourceId,
    tabLabel: t.tabs.reports,
    reportTab: preferredReportTab,
  }

  // Every matched row renders; the card scrolls. Slicing the list meant a
  // report the reader could see the top of was unreachable without leaving the
  // card, and the budget had to be re-measured on every resize to stay honest.
  const shown = matched
  const hidden = 0
  const opened = matched.find((item) => item.id === openedId) ?? null
  const openedReports = opened?.reports?.length
    ? opened.reports
    : opened?.fullText
      ? [{ id: opened.id, text: opened.fullText }]
      : []
  const groupLabel = (value: ReportGroup): string =>
    badgeLabels[value === 'cancer-screening' ? 'cancerScreening' : value] ?? value

  // One renderer for the card and the full-length dialog (see
  // OverviewExpandButton): two copies of a clinical row would drift.
  const renderRows = (items: OverviewReportItem[]) => (
  <div className={cn('flex min-w-0 shrink-0 flex-col', 'gap-1')}>
    {items.map((item) => {
      const hasText = !!item.fullText || !!item.reports?.length
      return (
        <div
          key={item.id}
          className={cn(OVERVIEW_LIST_ROW_CLASS, hasText && 'cursor-pointer')}
          role={hasText ? 'button' : undefined}
          tabIndex={hasText ? 0 : undefined}
          aria-haspopup={hasText ? 'dialog' : undefined}
          aria-label={hasText ? strings.reports.expand : undefined}
          onClick={() => hasText && setOpenedId(item.id)}
          onKeyDown={(event) => {
            if (!hasText) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setOpenedId(item.id)
          }}
        >
          <div className={cn('min-w-0 px-2', 'py-0')}>
            <div className={cn(
              'flex min-w-0 items-center gap-1.5',
              'h-[26px]',
            )}>
              <span className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-foreground">
                {item.day ? formatDate(item.day, locale) : '—'}
              </span>
              <OverviewReportBadge item={item} />
              <span
                className={cn(
                  // The exam name outranks the institution and the
                  // one-line conclusion for space on a crowded row.
                  'truncate text-xs font-semibold text-foreground',
                  'max-w-[40%] shrink-0',
                )}
                title={item.title}
              >
                {item.title}
              </span>
              {item.institution && (
                <ReportInstitutionLabel
                  institution={item.institution}
                  locale={locale}
                  // The whole row is the expand target here, so the
                  // institution tooltip must not swallow the tap the
                  // way it does in the 報告 tab's own rows.
                  stopPropagation={false}
                  className="max-w-[8rem] shrink text-[0.6875rem]"
                />
              )}
              {item.summary && (
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-foreground/75">
                  {item.summaryLabel && (
                    <span className="mr-1 font-semibold text-muted-foreground">{item.summaryLabel}</span>
                  )}
                  {item.summary}
                </span>
              )}
              {/* A merged multi-region cluster says so, and says that the NHI
                  order code is shared — the bridge cannot tell which report
                  belongs to which image, and hiding that would be inventing a
                  pairing the data does not support. */}
              {item.groupedCount ? (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="rounded-sm bg-amber-50 px-1 text-[0.625rem] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    {strings.reports.multiRegion.replace('{count}', String(item.groupedCount))}
                  </span>
                  {item.hasAmbiguity && (
                    <span className="rounded-sm bg-amber-100 px-1 text-[0.625rem] font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      {strings.reports.sharedCode}
                    </span>
                  )}
                </span>
              ) : null}
              {!item.summary && !item.groupedCount && item.hasImages && (
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] italic text-muted-foreground">
                  {strings.reports.imageOnly}
                </span>
              )}
              {/* No 健保影像 button out here — the badge above is the row's
                  single viewer target. */}
              {hasText && (
                <ChevronRight
                  aria-hidden="true"
                  className="ml-auto h-4 w-4 shrink-0 text-muted-foreground"
                />
              )}
            </div>

          </div>
        </div>
      )
    })}
  </div>
  )

  // One definition, two places: the card header and the expanded dialog, both
  // driving the same `group` state.
  const filterChips = (
    <>
      <button
        type="button"
        aria-pressed={effectiveGroup === 'all'}
        className={overviewChipClass(effectiveGroup === 'all')}
        onClick={() => setGroup('all')}
      >
        {strings.reports.all}
      </button>
      {data.groups.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={effectiveGroup === value}
          className={overviewChipClass(effectiveGroup === value)}
          onClick={() => setGroup(value)}
        >
          {groupLabel(value)}
        </button>
      ))}
    </>
  )

  return (
    <OverviewSectionCard
      id={OVERVIEW_SECTION_DOM_ID.reports}
      icon={ScanLine}
      title={strings.sections.reports}
      count={strings.counts.reports.replace('{count}', String(data.count))}
      bounded={fit.bounded}
      flash={flash}
      headingRef={headingRef}
      actions={(
        <>
          {filterChips}
          <OverviewExpandButton
            label={t.overview.expandList}
            onClick={() => setListOpen(true)}
            disabled={matched.length === 0}
          />
        </>
      )}
    >
      {shown.length === 0 ? (
        <OverviewEmptyRow hasWindowData={data.items.length > 0} />
      ) : (
        <>
          <div className={cn('min-w-0', fit.bounded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
            {renderRows(shown)}
          </div>
          <OverviewTruncationNote hiddenCount={hidden} target={target} always />
          <OverviewFullListDialog
            open={listOpen}
            onOpenChange={setListOpen}
            title={strings.sections.reports}
            subtitle={strings.counts.reports.replace('{count}', String(matched.length))}
            filters={filterChips}
          >
            {renderRows(matched)}
          </OverviewFullListDialog>
          <Dialog open={!!opened} onOpenChange={(next) => { if (!next) setOpenedId(null) }}>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
              <DialogHeader>
                <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                  {opened && <ReportTypeBadge group={opened.group} className="h-5" />}
                  <span className="min-w-0 break-words">{opened?.title}</span>
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {opened?.day ? formatDate(opened.day, locale) : '—'}
                  </span>
                  {opened?.institution && (
                    <ReportInstitutionLabel
                      institution={opened.institution}
                      locale={locale}
                      className="max-w-full text-xs"
                    />
                  )}
                  {/* The reader opened this to decide something; sending them
                      back to the list to find the images again would undo
                      exactly what the dialog is for. */}
                  <NhiViewerActions actions={opened?.viewerActions} />
                </div>
              </DialogHeader>
              {/* The narrative is the reason the dialog exists: it scrolls
                  here rather than being clamped, and stays selectable so a
                  finding can be copied into a note.
                  FormattedReportText, not raw pre-line: the 報告 tab renders
                  the same narrative through it, and a report that reads one
                  way there and another way here is a report the clinician has
                  to reconcile twice. */}
              <div className="max-h-[60vh] space-y-4 overflow-y-auto">
                {openedReports.map((report, index) => (
                  <div
                    key={report.id}
                    // A merged cluster is SEVERAL reports on different body
                    // parts. Each keeps its own block, its own heading and its
                    // own copy button — run together they read as one report
                    // covering everything, which is not what was reported.
                    className={cn(index > 0 && 'border-t border-border/60 pt-4')}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      {openedReports.length > 1 ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          {strings.reports.reportIndex
                            .replace('{index}', String(index + 1))
                            .replace('{total}', String(openedReports.length))}
                        </span>
                      ) : <span />}
                      <button
                        type="button"
                        onClick={async () => {
                          // The clipboard gets the SAME formatting pass as the
                          // 報告 tab, so text pasted into a note matches
                          // whichever surface it was copied from.
                          setCopiedId(report.id)
                          if (!await copyToClipboard(formatReportTextForClipboard(report.text))) {
                            toast.error(t.common.copyFailed)
                          }
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card/95 px-1.5 py-0.5 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
                        aria-label={t.reports.copyFullReport}
                      >
                        {copied && copiedId === report.id ? (
                          <>
                            <Check className="h-3 w-3" aria-hidden="true" />
                            {t.common.copied}
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            {t.common.copy}
                          </>
                        )}
                      </button>
                    </div>
                    <FormattedReportText
                      text={report.text}
                      className="text-sm leading-relaxed text-foreground/90"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="self-start text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={() => {
                  if (!opened) return
                  setOpenedId(null)
                  navigateTo({
                    resourceType: opened.navResourceType,
                    resourceId: opened.navResourceId,
                    tabLabel: t.tabs.reports,
                    reportTab: reportTabForGroup(opened.group),
                  })
                }}
              >
                {strings.reports.fullTextLink}
              </button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </OverviewSectionCard>
  )
}
