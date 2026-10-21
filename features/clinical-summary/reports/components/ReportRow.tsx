// Report Row Component
import { useRef, useState, memo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertCircle, Copy, Check, ChevronDown, GripHorizontal, ImageIcon, Info, Package, PanelRight } from 'lucide-react'
import { cn } from "@/src/shared/utils/cn.utils"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { useCopyToClipboard } from "@/src/shared/hooks/use-copy-to-clipboard"
import { TapTooltip } from "@/src/shared/components/TapTooltip"
import { useRightDetail } from "@/src/application/providers/right-detail.provider"
import { RIGHT_PANE_ACTION_CLASSES } from "@/src/shared/config/ui-theme.config"
import { useReportImageUrls } from '../hooks/useReportImageUrls'
import type { Row, Observation, ReportImage } from '../types'
import type { SharedReportSource } from '@/src/shared/utils/shared-report-grouping'
import { getValueWithUnit, getReferenceRangeText, getCodeableConceptText, formatDate, formatSourceTime } from '../utils/fhir-helpers'
import {
  getReferenceRangeComparison,
  isObservationAbnormal,
  isReferenceRangeAssessmentUnavailable,
} from '@voho0000/clinical-lab-normalization/interpretation'
import { ObservationBlock } from './ObservationBlock'
import {
  ObservationLongitudinalAction,
  ObservationLongitudinalAffordance,
  rowLongitudinalHandlers,
  useObservationLongitudinal,
} from './ObservationLongitudinalAction'
import { useCompactLayout } from '@/src/shared/hooks/layout/use-compact-layout.hook'
import { HighlightText } from '@/src/shared/components/HighlightText'
import { ReportImageDialog } from './ReportImageDialog'
import { FormattedReportText } from './FormattedReportText'
import { ReportPreviewLine } from './ReportPreviewLine'
import { MultiRegionStudyCard } from './MultiRegionStudyCard'
import { ReportInterpretationLauncher, ReportInterpretationPanel } from '@/features/report-interpretation'
import { CompactLabResultRow } from '@/features/clinical-summary/components/CompactLabResultRow'
// Circular at module level (LabDayGroupCard nests ReportRow for its members)
// but safe: `export function ReportRow` is hoisted, and the reference is only
// dereferenced at render time, long after both modules finish initialising.
import { LabDayGroupCard } from './LabDayGroupCard'
import { NhiViewerActions } from './NhiViewerActions'
import { ReportInstitutionLabel } from './ReportInstitutionLabel'
import { REPORT_ABNORMAL_TONE } from './report-color-roles'
import { ReportSourceProgramBadge } from './ReportSourceProgramBadge'
import { ReportTypeBadge } from './ReportTypeBadge'
import { NhiMedicloudSourceIndicator } from './NhiMedicloudSourceIndicator'
import { getSystolicDiastolicBloodPressureSummary } from '../utils/blood-pressure-panel'
import { formatReportTextForClipboard } from '@/src/shared/utils/report-text-format'

/** Small badge surfaced on a Row's header when bridge sent N duplicate
 *  DRs that the SMART app merged via strict-prefix dedup. It's a QA signal
 *  (surfaces a bridge-side dedup miss so it can be filed) — so it's scoped to
 *  the CLINICIAN view: a patient neither files bridge reports nor benefits from
 *  a ⚠ "duplicate copies" flag (it only worries them). The dedup itself always
 *  happens; only this badge is audience-gated. The visible label drops the
 *  "bridge" jargon; the file-a-report hint stays in the tooltip. */
function BridgeDupBadge({ count }: { count: number }) {
  const { t } = useLanguage()
  const { audience } = useAudience()
  if (audience === 'patient') return null
  const bd = (t.reports as { bridgeDup?: { label: string; tooltip: string } }).bridgeDup
  const tooltip = (bd?.tooltip ?? '').replace('{count}', String(count + 1))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-[0.625rem] font-medium text-amber-800 cursor-help dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          aria-label={tooltip}
        >
          ⚠ {bd?.label ?? 'dup'} ×{count}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Report title. It truncates to keep the row compact, so the full text lived
 * only in a hover bubble — unreachable on an iPad. Two tap-friendly answers,
 * picked by whether the row itself can open:
 *  - a row that expands (long-text header, accordion panel) simply STOPS
 *    truncating once open. The row's own tap is the reveal; putting a second
 *    tap target on the title would steal the row's primary action.
 *  - a row that cannot expand (image-only imaging report) gets a
 *    tap-accessible bubble instead, since nothing else would ever show it.
 * Desktop keeps the hover peek in both cases.
 */
function ReportTitle({
  title,
  children,
  expanded,
  expandable,
  className,
}: {
  title: string
  children: ReactNode
  expanded: boolean
  expandable: boolean
  className: string
}) {
  if (expanded) {
    return <span className={cn(className, 'select-text whitespace-normal break-words')}>{children}</span>
  }
  if (!expandable) {
    return (
      <TapTooltip content={title} aria-label={title} className={cn(className, 'select-text truncate')}>
        {children}
      </TapTooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(className, 'select-text truncate')}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

function selectionIsInside(element: HTMLElement): boolean {
  if (typeof window === 'undefined') return false
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.toString()) return false
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  return !!anchor && !!focus && element.contains(anchor) && element.contains(focus)
}

function CopyReportTitleAction({
  title,
  nestedInButton = true,
  className,
}: {
  title: string
  nestedInButton?: boolean
  className?: string
}) {
  const { t } = useLanguage()
  const { copied, copy } = useCopyToClipboard(1500)
  const label = copied ? t.reports.titleCopied : t.reports.copyTitle
  const activate = async (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!await copy(title)) toast.error(t.common.copyFailed)
  }
  const classes = cn(
    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-7 sm:min-w-7',
    copied && 'text-primary',
    className,
  )
  const content = copied
    ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
    : <Copy className="h-3.5 w-3.5" aria-hidden="true" />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {nestedInButton ? (
          <span
            role="button"
            tabIndex={0}
            data-testid="copy-report-title"
            data-report-title-copy="true"
            aria-label={label}
            className={classes}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') void activate(event)
            }}
          >
            {content}
          </span>
        ) : (
          <button
            type="button"
            data-testid="copy-report-title"
            data-report-title-copy="true"
            aria-label={label}
            className={classes}
            onClick={activate}
          >
            {content}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyableRightDetailTitle({
  title,
  dateLabel,
  trailing,
}: {
  title: string
  dateLabel?: string
  trailing?: ReactNode
}) {
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5">
      <span className="min-w-0 select-text truncate">{title}</span>
      {dateLabel && (
        <span className="shrink-0 text-xs font-normal text-muted-foreground">· {dateLabel}</span>
      )}
      {trailing}
      <CopyReportTitleAction title={title} nestedInButton={false} />
    </span>
  )
}

function formatImageBytes(size?: number): string {
  if (!size || size <= 0) return ''
  const mb = size / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(size / 1024)} KB`
}

function SharedReportSources({ sources }: { sources?: SharedReportSource[] }) {
  const { t } = useLanguage()
  if (!sources || sources.length < 2) return null
  const labels = t.reports.sharedReport
  return (
    <details
      data-testid="shared-report-sources"
      className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground"
    >
      <summary className="flex min-h-11 cursor-pointer select-none items-center font-medium text-foreground/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-6">
        {labels.showSources}
      </summary>
      <ul className="mt-1.5 divide-y divide-border/60" aria-label={labels.sourceListLabel}>
        {sources.map((source, index) => (
          <li
            key={`${source.reportId ?? 'source'}-${index}`}
            className="grid gap-0.5 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-3"
          >
            <span className="flex min-w-0 items-center gap-1 break-words text-foreground/90">
              {source.title}
              {source.narrative && (
                <ObservationLongitudinalAction
                  observation={{ code: { text: 'Report Summary' }, valueString: source.narrative }}
                  title={source.title}
                  sourceId={`report-source-history-${source.reportId ?? index}`}
                  reportTitle={source.title}
                  reportLookupTitle={source.title}
                  stopPropagation
                />
              )}
            </span>
            {source.codes.length > 0 && (
              <span className="break-all tabular-nums">
                {labels.orderCode}: {source.codes.join(', ')}
              </span>
            )}
            {source.reportId && (
              <span className="break-all sm:col-span-2">
                {labels.recordId}: {source.reportId}
              </span>
            )}
            {source.narrative && (
              <div className="whitespace-pre-wrap break-words text-foreground/90 sm:col-span-2">
                {source.narrative}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Report detail rendered in the right pane (向右展開) — findings text on top,
 *  images below, each its own scroll region (per the user's 文上圖下、各自捲動).
 *  Self-contained (owns copy + lightbox state + image-URL lifecycle) because the
 *  node is snapshotted into the right-detail context and rendered apart from the
 *  originating ReportRow, so it can't share the row's local state. Falls back to
 *  a single natural-scroll column when only text OR only images are present. */
function ReportImagingDetail({
  text,
  images,
  title,
  reportId,
  sharedReportSources,
}: {
  text: string
  images: ReportImage[]
  title: string
  reportId?: string
  sharedReportSources?: SharedReportSource[]
}) {
  const { t } = useLanguage()
  const tt = (t as any).reports?.image
  const hasText = text.length > 0
  const hasImages = images.length > 0
  const urls = useReportImageUrls(images, hasImages)
  // Shared clipboard helper: it owns the transient 「已複製」 state and reports
  // failure (http origin / denied permission) so the button can say so.
  const { copied, copy: copyToClipboard } = useCopyToClipboard(1500)
  // Lazy-mount the full-screen lightbox only after the user clicks an image;
  // kept mounted afterwards so re-opening is instant. Inline images already
  // decode (via the hook) for the docked preview; the lightbox offers the
  // zoom/full-res view the half-width pane can't.
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxMounted, setLightboxMounted] = useState(false)
  const openLightbox = () => {
    setLightboxMounted(true)
    setLightboxOpen(true)
  }

  // Draggable splitter between the text (top) and image (bottom) regions: the
  // user can pull it to give the image more (or less) room. `topPct` is the text
  // region's share of the height; pointer capture keeps the drag tracking even
  // when the cursor leaves the thin handle. Clamped so neither region vanishes.
  const splitRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false) // synchronous flag so moves track off-handle
  // null = auto: the text region hugs its content (a short report leaves no
  // blank gap — the image starts right under the text) and the image takes the
  // rest. Becomes a number once the user drags the splitter, switching to an
  // explicit ratio they control (needed when BOTH text and image are long).
  const [topPct, setTopPct] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false) // mirror, for the visual state
  const clampPct = (p: number) => Math.min(80, Math.max(15, p))
  // Current rendered share of the text region — the starting point for keyboard
  // nudges while still in auto mode.
  const measurePct = () => {
    const c = splitRef.current?.getBoundingClientRect()
    const tr = textRef.current?.getBoundingClientRect()
    if (!c || !tr || c.height === 0) return 42
    return (tr.height / c.height) * 100
  }
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const rect = splitRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return
    setTopPct(clampPct(((e.clientY - rect.top) / rect.height) * 100))
  }
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* no-op */ }
  }

  const copy = async () => {
    if (!await copyToClipboard(formatReportTextForClipboard(text))) {
      toast.error(t.common.copyFailed)
    }
  }

  const textBlock = hasText ? (
    <div>
      {/* Copy button pinned to the top-right of the (scrolling) text region —
          floated so the report text flows past it, sticky so it stays put as
          the text scrolls. */}
      <button
        type="button"
        onClick={copy}
        className="sticky top-0 z-10 float-right ml-2 inline-flex items-center gap-1 rounded-md border bg-card/95 px-1.5 py-0.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary"
        aria-label={t.reports.copyFullReport}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            {t.common.copied}
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            {t.common.copy}
          </>
        )}
      </button>
      <FormattedReportText text={text} className="text-sm leading-relaxed text-foreground/90" />
      <SharedReportSources sources={sharedReportSources} />
    </div>
  ) : null

  // The translation launcher finishes in the background before opening this
  // view, so manual mode can render the cached result without another AI call.
  // Ordinary 「向右展開」continues to show a manual trigger when uncached.
  const interpretBlock = reportId && hasText ? (
    <ReportInterpretationPanel
      analyticsHost="report-row"
      reportId={reportId}
      reportText={text}
      reportTitle={title}
      autoGenerate={false}
    />
  ) : null

  // Source caveat — 健保存摺 carries at most 10 preview JPEGs per exam (no
  // DICOM). It's an IMAGE caveat, so it renders inside the image region (above
  // the images, below the splitter) — not above the text report.
  const noticeBlock = hasImages && tt?.previewLimitNotice ? (
    <div className="flex shrink-0 items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{tt.previewLimitNotice}</span>
    </div>
  ) : null

  const imageBlock = hasImages ? (
    <div className="space-y-3">
      {images.map((img, i) => (
        <figure key={i} className="space-y-1">
          {urls[i] ? (
            <button
              type="button"
              onClick={openLightbox}
              title={tt?.view ?? t.common.maximize}
              className="block w-full"
            >
              <img
                src={urls[i]}
                alt={img.title || title}
                loading="lazy"
                decoding="async"
                className="mx-auto max-h-[60vh] w-auto max-w-full rounded-md border bg-black/5 object-contain cursor-zoom-in"
              />
            </button>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border bg-muted/40 text-sm text-muted-foreground">
              {tt?.loading ?? t.common.loading}
            </div>
          )}
          {(img.title || img.size) && (
            <figcaption className="text-center text-xs text-muted-foreground">
              {img.title}
              {img.title && img.size ? ' • ' : ''}
              {formatImageBytes(img.size)}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  ) : null

  const lightbox = lightboxMounted ? (
    <ReportImageDialog images={images} title={title} open={lightboxOpen} onOpenChange={setLightboxOpen} />
  ) : null

  // Both present → a fixed notice bar on top, then two independently-scrolling
  // regions split 50/50 (the text caps at half so the image gets a genuine
  // half — the notice sits OUTSIDE the split so it doesn't steal image space).
  // Otherwise a single natural-scroll column (the pane's own overflow handles).
  if (hasText && hasImages) {
    return (
      <div ref={splitRef} className="flex h-full flex-col">
        <div
          ref={textRef}
          className="scrollbar-thin-persistent shrink-0 overflow-y-auto pr-1"
          style={topPct === null ? { maxHeight: '40%' } : { height: `${topPct}%` }}
        >{interpretBlock}{textBlock}</div>
        {/* Draggable splitter — defaults to sitting right under the text (auto),
            so a short report leaves no blank gap; drag up/down (or focus + ↑/↓)
            to rebalance when both text and image are long enough to scroll. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t.reports.resizeTextAndImages}
          aria-valuenow={topPct === null ? undefined : Math.round(topPct)}
          aria-valuemin={15}
          aria-valuemax={80}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); setTopPct((p) => clampPct((p ?? measurePct()) - 4)) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setTopPct((p) => clampPct((p ?? measurePct()) + 4)) }
          }}
          className="group relative shrink-0 cursor-row-resize touch-none py-2 outline-none"
        >
          {/* full-width hairline so the divider reads as a movable boundary */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          {/* centered grip handle — a clear, obviously-draggable affordance */}
          <div
            className={cn(
              'relative mx-auto flex h-4 w-9 items-center justify-center rounded-md border bg-card shadow-sm transition-colors',
              dragging
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground group-hover:border-primary/50 group-hover:text-primary group-focus-visible:border-primary/50',
            )}
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </div>
        </div>
        {/* Image region — the preview-limit caveat lives HERE (with the images,
            below the splitter), not above the text. The image gets the majority
            of the height since the text caps at 40%. */}
        <div className="scrollbar-thin-persistent min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {noticeBlock}
          {imageBlock}
        </div>
        {lightbox}
      </div>
    )
  }
  return (
    <>
      {interpretBlock}
      {textBlock}
      {noticeBlock}
      {imageBlock}
      {lightbox}
    </>
  )
}

/** Lab-panel detail rendered in the right pane (向右展開) — the panel's analyte
 *  rows (the very same ObservationBlocks the accordion expands to inline), in a
 *  scroll region with a persistent scrollbar so a long panel reads beside the
 *  list. */
function ReportPanelDetail({
  observations,
  interpretation,
  sharedReportSources,
}: {
  observations: Observation[]
  interpretation?: {
    reportId: string
    reportText: string
    reportTitle: string
  }
  sharedReportSources?: SharedReportSource[]
}) {
  return (
    <div className="scrollbar-thin-persistent h-full space-y-0 overflow-y-auto pr-1">
      {interpretation && (
        <ReportInterpretationPanel
          analyticsHost="report-row"
          reportId={interpretation.reportId}
          reportText={interpretation.reportText}
          reportTitle={interpretation.reportTitle}
          autoGenerate={false}
        />
      )}
      {observations.map((obs, i) => (
        <ObservationBlock key={obs.id ? `obs-${obs.id}-${i}` : `obs-${i}`} observation={obs} />
      ))}
      <SharedReportSources sources={sharedReportSources} />
    </div>
  )
}

interface ReportRowProps {
  row: Row
  defaultOpen: string[]
  /** Active search query — highlights matches in the report title. */
  query?: string
  /** Hide the per-row institution + date cluster — set by LabDayGroupCard,
   *  whose group header already states both, so nested members don't repeat
   *  the same date/hospital on every line of the "lab sheet". */
  hideMeta?: boolean
  /** Show the row's report kind in mixed lists such as the All tab. */
  showTypeBadge?: boolean
}

// Date and time both go through the shared, partial-date/timezone-faithful
// helpers: what is shown is what the source wrote, so a report never moves to
// a different day (or hour) because of where the reader happens to be. Time is
// appended only when the source string actually carries one — never fabricated
// from a date-only value.
function formatDisplayDate(date?: string, showTime?: boolean): string {
  if (!date) return ''
  const datePart = formatDate(date)
  if (!showTime) return datePart
  const timePart = formatSourceTime(date)
  return timePart ? `${datePart} ${timePart}` : datePart
}

// Time-only label for rows inside a LabDayGroupCard (hideMeta): the group
// header owns the date, but same-analyte serials (q6h troponin, repeat CBC)
// still need their draw TIME to be tellable apart. Only rendered when the
// row carries the showTime disambiguation flag. Date-only values have no
// time to show — returning '' beats inventing "08:00" from UTC midnight.
// The card groups by the SOURCE's collection day, so the badge must read the
// source's clock too, or a 08:30 draw would show as the previous evening to a
// reader west of the hospital and contradict the card it sits in.
function formatTimeOnly(date?: string): string {
  return formatSourceTime(date)
}

/** Stable provenance columns for the vital-sign scan list. A missing source
 * program keeps its slot on wide report surfaces so institution and date do
 * not jump sideways between otherwise comparable rows. Narrow panels retain
 * the existing compact flex layout and natural wrapping. */
function VitalReportMetadata({
  row,
  dateLabel,
  metaLabel,
  sourceProgramLabel,
  locale,
}: {
  row: Row
  dateLabel: string
  metaLabel: string
  sourceProgramLabel?: string
  locale: string
}) {
  return (
    <div
      data-testid="vital-report-meta"
      className="flex min-w-0 items-center justify-end gap-1 sm:gap-2 @min-[800px]:!grid @min-[800px]:grid-cols-[152px_168px_auto]"
    >
      <span
        data-testid="vital-source-program-slot"
        className="contents @min-[800px]:flex @min-[800px]:w-[152px] @min-[800px]:justify-end"
      >
        <ReportSourceProgramBadge
          sourceProgram={row.sourceProgram}
          label={sourceProgramLabel}
        />
      </span>
      <span
        data-testid="vital-institution-slot"
        className="contents @min-[800px]:flex @min-[800px]:w-[168px] @min-[800px]:min-w-0"
      >
        {row.institution && (
          <ReportInstitutionLabel
            institution={row.institution}
            hospitalSource={row.hospitalSource}
            locale={locale}
            className="max-w-[5rem] flex-1 min-[430px]:max-w-[7rem] sm:max-w-[9rem] sm:flex-none @min-[800px]:w-full @min-[800px]:max-w-full"
          />
        )}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal whitespace-nowrap">
            {dateLabel || metaLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{metaLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// Collapse repeated blank lines so verbose hospital-report text doesn't waste
// vertical space when expanded inline. Keeps single line breaks intact.
function compactBlankLines(s: string): string {
  return (s || '').replace(/(\r?\n)[ \t]*(?:\r?\n)+/g, '\n').trim()
}

function countAbnormal(obs: Observation[]): number {
  let count = 0
  for (const o of obs) {
    if (isObservationAbnormal(o)) {
      count++
      continue
    }
    if (Array.isArray(o.component)) {
      for (const c of o.component) {
        if (isObservationAbnormal(c)) {
          count++
          break
        }
      }
    }
  }
  return count
}

function ReportRowImpl({ row, defaultOpen, query, hideMeta, showTypeBadge }: ReportRowProps) {
  const { t, locale } = useLanguage()
  const rightPaneLabels = t.reports.rightPane
  const imageViewLabel = t.reports.image.view
  const sourceProgramLabel = (t.reports.sourcePrograms as { adultPreventive?: string } | undefined)
    ?.adultPreventive
  // Image lightbox — only enter the tree (and decode the multi-MB base64) after
  // the user clicks the
  // indicator. Kept mounted afterwards; the dialog itself revokes its Blob URLs
  // whenever it closes, so memory is released without unmounting.
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [imageDialogMounted, setImageDialogMounted] = useState(false)
  const openImageDialog = () => {
    setImageDialogMounted(true)
    setImageDialogOpen(true)
  }
  // Long-text reports honour defaultOpen too: a day-group card opening all its
  // members, or a search matching INSIDE the narrative (valueString), starts
  // this expanded — previously only accordion panels respected defaultOpen.
  const [textExpanded, setTextExpanded] = useState(() => defaultOpen.includes(row.id))
  // Mirror of the (uncontrolled) Accordion's open state — only used so the
  // panel's truncated title can un-truncate once the user opens it.
  const [panelExpanded, setPanelExpanded] = useState(() => defaultOpen.includes(row.id))
  const { copied, copy: copyToClipboard } = useCopyToClipboard(1500)
  // 向右展開 — single long reports (imaging / ECG / pathology narratives) can be
  // pushed to the right pane so the long text reads beside the rest of the list.
  // Lab panels / 累積報告 are deliberately excluded (handled below in the
  // isLongText branch only).
  const { detail: rightDetail, showDetail, toggleDetail } = useRightDetail()

  const handleCopy = async (text: string) => {
    if (!await copyToClipboard(formatReportTextForClipboard(text))) {
      toast.error(t.common.copyFailed)
    }
  }

  // A procedure's details (status, date, performer, NHI/PCS codes, reason) live
  // as components on the synthetic observation at index 0 — keep it. (It used to
  // be sliced off, which left bridge ≥0.18.14 procedures — that carry no related
  // observations — showing "0 項" with an empty body.)
  const displayObs = row.obs
  const firstObs = row.obs[0]

  const images = row.images
  const hasImages = !!images && images.length > 0
  const viewerActions = row.viewerActions
  const hasViewerActions = !!viewerActions && viewerActions.length > 0

  // Inline-image indicator. Clicking opens the lazy lightbox. `stopProp` is set
  // when the button lives inside an AccordionTrigger so the click doesn't also
  // toggle the accordion (mirrors TrendButton).
  // This one stays a real button on every layout — unlike the trend icon it has
  // no row-level equivalent to fall back to, and it shares rows with a row-tap
  // that means something else. So it keeps a 36px touch box (literal px: the
  // root font-size is user-settable, 12px on phones), with `max-md:-my-[11px]`
  // so the box overlaps the host's padding instead of stretching the line it
  // sits on. Measured host: the imaging report row is 43px tall on a phone, so
  // the box is not clipped.
  const renderImageButton = (stopProp?: boolean) => (
    <div
      data-tour="report-image"
      onClick={(e) => {
        if (stopProp) e.stopPropagation()
        openImageDialog()
      }}
      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-0.5 text-muted-foreground transition-colors cursor-pointer shrink-0 touch-manipulation hover:text-primary max-md:-my-[11px] md:min-h-0 md:min-w-0"
      role="button"
      tabIndex={0}
      aria-label={imageViewLabel}
      data-report-image-action="true"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (stopProp) e.stopPropagation()
          openImageDialog()
        }
      }}
    >
      <ImageIcon className="h-4 w-4" />
      {images!.length > 1 && <span className="text-xs tabular-nums">{images!.length}</span>}
    </div>
  )

  // Computed element (not an inner component) so the same reference is dropped
  // into whichever return branch renders — a `() => <Dialog/>` inner component
  // would get a fresh identity each render and remount the dialog (re-decoding
  // images, losing open state).
  const imageLightbox = imageDialogMounted && hasImages ? (
    <ReportImageDialog
      images={images!}
      title={row.title}
      open={imageDialogOpen}
      onOpenChange={setImageDialogOpen}
    />
  ) : null

  const isSingleValue =
    displayObs.length === 1 &&
    (!(displayObs[0].component) || displayObs[0].component.length === 0)

  const longitudinalSourceId = `report-longitudinal:${row.id}:${firstObs?.id || 'first'}`

  // Same detail the trend button opens, reachable from the row itself. On the
  // single-panel layout a one-line result row IS the tap target — 343×24px
  // beats a 36px icon, and it lets the row shrink to the height of its text
  // instead of padding out around a square. Desktop keeps the icon button, so
  // the decision is a rendered-handler difference and cannot be a media query.
  const compactLayout = useCompactLayout()
  const longitudinal = useObservationLongitudinal({
    observation: firstObs,
    title: row.title,
    sourceId: longitudinalSourceId,
    reportTitle: row.title,
    reportLookupTitle: row.rawTitle,
  })

  const renderTrendButton = (stopPropagation?: boolean) => (
    <ObservationLongitudinalAction
      observation={firstObs}
      title={row.title}
      sourceId={longitudinalSourceId}
      reportTitle={row.title}
      reportLookupTitle={row.rawTitle}
      as="div"
      stopPropagation={stopPropagation}
      dataTour="report-trend"
    />
  )

  // Single-value report: compact display
  if (isSingleValue) {
    const obs = displayObs[0]
    const isAbnormal = isObservationAbnormal(obs)
    const refText = getReferenceRangeText(obs.referenceRange)
    const referenceComparison = getReferenceRangeComparison(obs)
    const referenceStrings = t.reports.referenceComparison
    // Synthetic narrative obs from text-based DiagnosticReports (imaging / ECG /
    // pathology) carry code.text === 'Report Summary'. These are ALWAYS routed to
    // the expandable long-text branch regardless of length — a short ECG
    // conclusion ("Sinus rhythm") must still be fully readable + expandable, not
    // truncated to one line behind a hover tooltip like a short lab string value.
    const isReportSummary = obs.code?.text === 'Report Summary'
    const isLongText = !obs.valueQuantity && ((obs.valueString?.length ?? 0) > 80 || isReportSummary)

    const dateLabel = formatDisplayDate(row.effectiveDate, row.showTime)
    const metaWithDate = row.meta + (dateLabel ? ` • ${dateLabel}` : '')

    // Date-only badge + institution inline, consistent with the single-value
    // and accordion rows. Category/status (e.g. "Radiology • final") are noise
    // in this dataset — they live on the badge's hover tooltip instead.
    // bridgeDupCount badge surfaces bridge-side dedup misses so the bug
    // doesn't get silently hidden by our merge (no-mask-bridge-bugs rule).
    const headerRight = (
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none sm:gap-2">
        {row.bridgeDupCount && row.bridgeDupCount > 0 ? <BridgeDupBadge count={row.bridgeDupCount} /> : null}
        {hasViewerActions && <NhiViewerActions actions={viewerActions} />}
        {!hideMeta && (
          <ReportSourceProgramBadge
            sourceProgram={row.sourceProgram}
            label={sourceProgramLabel}
          />
        )}
        {!hideMeta && (row.sourceProvenance === 'nhi-medicloud' ? (
          <NhiMedicloudSourceIndicator institution={row.institution} className="max-w-[15rem] flex-1 sm:flex-none" />
        ) : row.institution ? (
          <ReportInstitutionLabel institution={row.institution} hospitalSource={row.hospitalSource} locale={locale} className="max-w-[6rem] flex-1 sm:max-w-[10rem] sm:flex-none" />
        ) : null)}
        {!hideMeta && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">{dateLabel || metaWithDate}</Badge>
            </TooltipTrigger>
            <TooltipContent>{metaWithDate}</TooltipContent>
          </Tooltip>
        )}
        {hideMeta && row.showTime && formatTimeOnly(row.effectiveDate) && (
          <Badge variant="outline" className="text-xs font-normal whitespace-nowrap tabular-nums">
            {formatTimeOnly(row.effectiveDate)}
          </Badge>
        )}
      </div>
    )

    // Long text (ECG conclusion, CT description): collapsed shows truncated preview,
    // header row toggles open/close (mirrors the multi-item accordion below).
    // Body text stays selectable; a Copy button shows when expanded.
    if (isLongText) {
      // Keep the source untouched for the raw-report disclosure. The display
      // parser already handles excess blank lines in the formatted view.
      const fullText = obs.valueString || ''
      // Image-only imaging reports (X-ray / ECG with empty conclusion) reach
      // this branch via the synthetic "Report Summary" obs but carry no text —
      // render just the header (title + image indicator), with no toggle,
      // chevron, or empty expandable.
      const hasText = fullText.trim().length > 0
      // 向右展開 target id — namespaced so it can't collide with visit/med ids
      // that share the single right-pane slot.
      const reportSourceId = `report:${row.id}`
      const isReportRightActive = rightDetail?.sourceId === reportSourceId
      const createReportRightDetail = () => ({
          sourceId: reportSourceId,
          title: (
            <CopyableRightDetailTitle title={row.title} dateLabel={dateLabel} />
          ),
          // key per report so the splitter ratio (and lightbox state) reset to
          // the content-aware default on each open instead of React reusing the
          // instance and carrying a previous report's dragged ratio over.
          node: (
            <ReportImagingDetail
              key={reportSourceId}
              text={fullText}
              images={images ?? []}
              title={row.title}
              reportId={reportSourceId}
              sharedReportSources={row.sharedReportSources}
            />
          ),
        })
      const openReportRight = (e: React.MouseEvent) => {
        e.stopPropagation()
        toggleDetail(createReportRightDetail())
      }
      const showReportInterpretationRight = () => {
        // Keep the source visible for side-by-side comparison: translation
        // completion opens the right pane and expands the matching original
        // report on the left in the same state update.
        setTextExpanded(true)
        showDetail(createReportRightDetail())
      }
      return (
        <>
          <div
            data-tour="report-tour-row"
            className={cn(
              'w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-muted/40 px-2 py-1 transition-colors sm:px-2.5 sm:py-1.5',
              // 向右展開 active: tint the row so it's clear which report the
              // right pane is showing.
              isReportRightActive && 'border-primary/40 bg-primary/5',
            )}
          >
            <div
              className={cn(
                'flex rounded-md transition-all outline-none @min-[520px]:mb-0.5',
                hasText
                  ? 'flex-col items-stretch gap-0 @min-[520px]:flex-row @min-[520px]:flex-nowrap @min-[520px]:items-center @min-[520px]:justify-between @min-[520px]:gap-2'
                  : 'flex-wrap items-center justify-between gap-2',
                hasText && 'cursor-pointer select-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50'
              )}
              role={hasText ? 'button' : undefined}
              tabIndex={hasText ? 0 : undefined}
              aria-expanded={hasText ? textExpanded : undefined}
              onClick={(e) => {
                if (!hasText) return
                if ((e.target as HTMLElement).closest('[data-report-history-action]')) return
                if ((e.target as HTMLElement).closest('[data-report-image-action]')) return
                if ((e.target as HTMLElement).closest('[data-report-title-copy]')) return
                if (selectionIsInside(e.currentTarget)) return
                setTextExpanded(!textExpanded)
              }}
              onKeyDown={(e) => {
                if (!hasText) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setTextExpanded(!textExpanded)
                }
              }}
            >
              <div className={cn('flex min-w-[8rem] flex-1 basis-0 items-center gap-1.5', hasText && 'w-full @min-[520px]:w-auto @min-[520px]:min-w-[12rem]')}>
                {showTypeBadge && <ReportTypeBadge group={row.group} />}
                <ReportTitle
                  title={row.title}
                  expanded={hasText && textExpanded}
                  expandable={hasText}
                  className="min-w-0 flex-1 text-sm font-semibold text-foreground"
                >
                  <HighlightText text={row.title} query={query} />
                </ReportTitle>
                <CopyReportTitleAction title={row.title} />
                {renderTrendButton()}
                {hasImages && renderImageButton()}
              </div>
              <div
                className={cn(
                  'flex max-w-full shrink-0 items-center',
                  hasText
                    ? 'min-w-0 flex-wrap justify-start gap-1 @min-[520px]:flex-nowrap @min-[520px]:justify-end @min-[520px]:gap-2'
                    : 'gap-2',
                )}
              >
                {headerRight}
                {row.isPossibleDuplicate && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">⚠ {t.reports.possibleDuplicate}</span>
                )}
                {/* 「AI 翻譯解讀」— only when there's narrative text to work on.
                    Hidden while this report is docked to the right pane, which
                    owns the AI card there (no duplicate left card / orphan
                    button); it returns when the right pane is closed.
                    stopPropagation so opening it doesn't also toggle the
                    accordion (the header row is itself a toggle button). */}
                {hasText && !isReportRightActive && (
                  <ReportInterpretationLauncher
                    analyticsHost="report-row"
                    dataTour="report-ai-interpretation"
                    detailSourceId={reportSourceId}
                    reportId={reportSourceId}
                    reportText={fullText}
                    reportTitle={row.title}
                    onReady={showReportInterpretationRight}
                  />
                )}
                {/* 向右展開 — full report text + images in the right pane
                    (desktop only; no side-by-side room on phones). Sits beside
                    the ▼ chevron (向下展開) so the user picks per report. Shown
                    whenever there's text OR images to dock. */}
                {(hasText || hasImages) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-tour="report-open-right"
                        onClick={openReportRight}
                        aria-label={hasImages ? rightPaneLabels.openTextAndImages : rightPaneLabels.openText}
                        className={cn(
                          RIGHT_PANE_ACTION_CLASSES,
                          'gap-1 px-2 py-1 text-xs font-medium',
                          isReportRightActive && 'border-primary bg-primary/10 text-primary',
                        )}
                      >
                        <PanelRight className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    {/* Radix tooltip (not the native title) so the icon-only
                        button explains itself on hover, quickly and styled. */}
                    <TooltipContent>
                      {isReportRightActive
                        ? rightPaneLabels.active
                        : hasImages
                          ? rightPaneLabels.openTextAndImages
                          : rightPaneLabels.openText}
                    </TooltipContent>
                  </Tooltip>
                )}
                {hasText && (
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground pointer-events-none transition-transform duration-200',
                      textExpanded && 'rotate-180'
                    )}
                  />
                )}
              </div>
            </div>
            {row.sharedReportSources && row.sharedReportSources.length > 1 && (
              <div
                data-testid="shared-report-summary"
                className="mt-1 text-xs leading-relaxed text-muted-foreground"
              >
                {t.reports.sharedReport.summary.replace('{count}', String(row.sharedReportSources.length))}
              </div>
            )}
            {hasText && (
              textExpanded ? (
                <>
                  <FormattedReportText text={fullText} className="text-xs leading-relaxed text-foreground/80" />
                  <SharedReportSources sources={row.sharedReportSources} />
                </>
              ) : (
                <ReportPreviewLine
                  text={fullText}
                  className="cursor-pointer text-xs leading-relaxed text-foreground/80"
                  onClick={() => setTextExpanded(true)}
                />
              )
            )}
            {hasText && textExpanded && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopy(fullText)
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  aria-label={t.reports.copyFullReport}
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      {t.common.copied}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t.common.copy}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          {imageLightbox}
        </>
      )
    }

    // Numeric or short text: single-row compact display. Falls through to a
    // coded value (valueCodeableConcept — e.g. a qualitative "Positive" / blood
    // type / mCODE result) so a single-obs report never shows a bare "—".
    const value = obs.valueQuantity
      ? getValueWithUnit(obs.valueQuantity)
      : obs.valueString || getCodeableConceptText(obs.valueCodeableConcept) || '—'

    // On the single-panel layout the ROW opens the trend, so the icon is left
    // as a plain affordance and the row carries the role, the label and the
    // handlers. Desktop is untouched: the icon stays a real button.
    const rowOpensTrend = compactLayout && longitudinal.available
    const rowHandlers = rowLongitudinalHandlers(longitudinal.show)

    // Prefer one scan line when the content genuinely fits. The clinical name
    // keeps a readable minimum; if a long value/range/source exceeds the phone
    // width, the source/date cluster wraps as one unit instead of squeezing the
    // name away or overlapping the trend action.
    const compactRow = (
      <CompactLabResultRow
        title={row.title}
        titleNode={<HighlightText text={row.title} query={query} />}
        value={value}
        abnormal={isAbnormal}
        referenceText={refText}
        referenceComparison={referenceComparison ?? undefined}
        referenceComparisonLabel={referenceComparison === 'high'
          ? referenceStrings.above
          : referenceStrings.below}
        referenceComparisonTooltip={referenceStrings.tooltip}
        rangeUnassessed={isReferenceRangeAssessmentUnavailable(obs)}
        rangeUnassessedLabel={referenceStrings.unassessed}
        rangeUnassessedTooltip={referenceStrings.unassessedTooltip}
        adaptivePhoneLayout
        alignedDesktopColumns={row.group === 'vitals'}
        role={rowOpensTrend ? 'button' : undefined}
        tabIndex={rowOpensTrend ? 0 : undefined}
        ariaLabel={rowOpensTrend ? longitudinal.describe(`${row.title} ${value}`) : undefined}
        onClick={rowOpensTrend ? rowHandlers.onClick : undefined}
        onKeyDown={rowOpensTrend ? rowHandlers.onKeyDown : undefined}
        className={rowOpensTrend ? 'cursor-pointer' : undefined}
        titleActions={(
          <>
            {rowOpensTrend ? (
              <ObservationLongitudinalAffordance
                mode={longitudinal.mode}
                isActive={longitudinal.isActive}
              />
            ) : renderTrendButton()}
            {/* stopProp once the row is the control, or opening an image would
                also dock the trend behind it. */}
            {hasImages && renderImageButton(rowOpensTrend)}
          </>
        )}
        leadingTitleContent={showTypeBadge ? <ReportTypeBadge group={row.group} /> : undefined}
        trailingContent={(
          <>
            {hasViewerActions && <NhiViewerActions actions={viewerActions} />}
            {/* Institution + date — the compact badge shows only the date to give
                the report name maximum width; category/status (row.meta) move to
                the hover tooltip. Falls back to the full meta when there's no date.
                Hidden inside a LabDayGroupCard (hideMeta) — the group header
                already states both. */}
            {!hideMeta && (
              row.group === 'vitals' ? (
                <VitalReportMetadata
                  row={row}
                  dateLabel={dateLabel}
                  metaLabel={metaWithDate}
                  sourceProgramLabel={sourceProgramLabel}
                  locale={locale}
                />
              ) : (
                <div className="flex min-w-0 items-center justify-end gap-1 sm:shrink-0 sm:gap-2">
                  <ReportSourceProgramBadge
                    sourceProgram={row.sourceProgram}
                    label={sourceProgramLabel}
                  />
                  {row.sourceProvenance === 'nhi-medicloud' ? (
                    <NhiMedicloudSourceIndicator institution={row.institution} className="max-w-[15rem] flex-1 sm:flex-none" />
                  ) : row.institution ? (
                    <ReportInstitutionLabel institution={row.institution} hospitalSource={row.hospitalSource} locale={locale} className="max-w-[5rem] flex-1 min-[430px]:max-w-[7rem] sm:max-w-[9rem] sm:flex-none" />
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal whitespace-nowrap">{dateLabel || metaWithDate}</Badge>
                    </TooltipTrigger>
                    <TooltipContent>{metaWithDate}</TooltipContent>
                  </Tooltip>
                </div>
              )
            )}
            {row.group === 'vitals' && !hideMeta && (
              <span
                data-testid="vital-toggle-slot"
                aria-hidden="true"
                className="ml-1.5 hidden h-4 w-4 shrink-0 @min-[800px]:block"
              />
            )}
            {hideMeta && row.showTime && formatTimeOnly(row.effectiveDate) && (
              <Badge variant="outline" className="shrink-0 text-xs font-normal tabular-nums whitespace-nowrap">
                {formatTimeOnly(row.effectiveDate)}
              </Badge>
            )}
            {row.isPossibleDuplicate && (
              <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">⚠ 可能重複</span>
            )}
          </>
        )}
      />
    )

    return (
      <>
        {compactRow}
        {imageLightbox}
      </>
    )
  }

  // Multi-item report: accordion with summary
  const abnormalCount = countAbnormal(displayObs)
  const accordionDateLabel = formatDisplayDate(row.effectiveDate, row.showTime)
  const accordionMeta = row.meta + (accordionDateLabel ? ` • ${accordionDateLabel}` : '')
  const bloodPressureSummary = row.group === 'vitals' && displayObs.length === 1
    ? getSystolicDiastolicBloodPressureSummary(row)
    : null

  // A panel report can ALSO carry a narrative (e.g. a pathology report whose
  // presentedForm text rides as a "Report Summary" obs alongside structured
  // histologic / biomarker results). The narrative deserves the same 「AI 翻譯
  // 解讀」affordance as a standalone text report — the button is gated on
  // "has narrative", not on "is a single-obs long-text report". This keeps the
  // clinically-faithful grouping (results belong to their report) without
  // sacrificing translatability.
  const panelNarrativeObs = displayObs.find(
    (o) => o.code?.text === 'Report Summary' && (o.valueString?.trim().length ?? 0) > 0,
  )
  const panelNarrative = compactBlankLines(panelNarrativeObs?.valueString || '')
  const panelHasNarrative = panelNarrative.length > 0

  // 向右展開 for multi-analyte lab panels (e.g. CBC's 8 items) and procedures:
  // dock the detail in the right pane to read it beside the list. Lab panels
  // gate to 3+ analytes (a 1–2 item panel expands inline fine); a procedure is
  // always eligible — its detail (status / date / performer / NHI codes /
  // reason, plus any related sub-procedures) is rich enough to be worth docking.
  const panelSourceId = `report:${row.id}`
  const isPanelRightActive = rightDetail?.sourceId === panelSourceId
  const canExpandPanelRight = row.group === 'procedures' || displayObs.length >= 3
  const createPanelRightDetail = () => ({
      sourceId: panelSourceId,
      title: (
        <CopyableRightDetailTitle
          title={row.title}
          dateLabel={accordionDateLabel}
          trailing={abnormalCount > 0 ? (
            <span className={cn('inline-flex items-center rounded-full px-1.5 py-0 text-[0.6875rem] font-medium', REPORT_ABNORMAL_TONE)}>
              {abnormalCount} 異常
            </span>
          ) : undefined}
        />
      ),
      node: (
        <ReportPanelDetail
          key={panelSourceId}
          observations={displayObs}
          interpretation={panelHasNarrative ? {
            reportId: panelSourceId,
            reportText: panelNarrative,
            reportTitle: row.title,
          } : undefined}
          sharedReportSources={row.sharedReportSources}
        />
      ),
    })
  const openPanelRight = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    toggleDetail(createPanelRightDetail())
  }
  const showPanelInterpretationRight = () => {
    // Reveal the structured source rows alongside the finished translation.
    setPanelExpanded(true)
    showDetail(createPanelRightDetail())
  }

  return (
    <>
      <Accordion
        type="multiple"
        value={panelExpanded ? [row.id] : []}
        onValueChange={(open) => setPanelExpanded(open.includes(row.id))}
        className="w-full min-w-0 max-w-full"
      >
        <AccordionItem
          value={row.id}
          className={cn(
            'overflow-hidden rounded-md border bg-muted/40 transition-colors',
            // 向右展開 active: tint the panel row so it's clear which one the
            // right pane is showing.
            isPanelRightActive && 'border-primary/40 bg-primary/5',
          )}
        >
          <AccordionTrigger
            trailingAction={(
              <CopyReportTitleAction
                title={row.title}
                nestedInButton={false}
                className="mr-1 mt-1"
              />
            )}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('[data-report-title-copy]')) {
                event.preventDefault()
                return
              }
              if (selectionIsInside(event.currentTarget)) event.preventDefault()
            }}
            className={cn(
              // `min-w-0` is what actually lets a long title truncate. The
              // trigger is a flex item of AccordionPrimitive.Header, so without
              // it its automatic minimum size is the title's MAX-CONTENT width:
              // the trigger grows past the row (measured 712px inside a 600px
              // row), the row's overflow-hidden clips the institution and date
              // off the end, and the title's own `truncate` never gets to act
              // because nothing ever constrains it. Panel rows hid this by
              // giving their title a fixed `basis-[45%]`; procedures, which
              // must flex, exposed it.
              'min-w-0 items-center justify-start gap-x-1.5 px-2.5 py-1.5 text-sm hover:no-underline [&>svg]:ml-0 [&>svg]:translate-y-0 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:gap-y-1 max-sm:[&>svg]:col-start-3 max-sm:[&>svg]:row-start-1',
              panelHasNarrative && 'flex-wrap gap-y-1 sm:flex-nowrap',
              row.group === 'procedures' && 'flex-wrap gap-y-1 sm:flex-nowrap',
              row.group === 'vitals' && '@max-[799px]:!grid @max-[799px]:grid-cols-[minmax(0,1fr)_auto_auto] @max-[799px]:gap-y-1 @max-[799px]:[&>svg]:col-start-3 @max-[799px]:[&>svg]:row-start-1',
              row.group === 'vitals' && '@min-[800px]:!grid @min-[800px]:grid-cols-[minmax(12rem,1fr)_auto_auto_auto] @min-[800px]:items-center',
            )}
          >
            <div
              className={cn(
                'flex min-w-0 items-center gap-1.5 max-sm:col-start-1 max-sm:row-start-1 max-sm:basis-auto max-sm:shrink',
                // Procedures carry the longest titles in the app (a whole NHI
                // order name, parentheses and all). `flex-1 basis-0` alone did
                // not save them: `shrink-0 grow-0` sat in the shared half of
                // this class list and, being a different utility group, was not
                // merged away — so the box refused to shrink and a long title
                // shoved the institution and date off the row. The title itself
                // already truncates with a hover tooltip; it just needed a
                // container that could give ground.
                row.group === 'procedures' ? 'min-w-0 flex-1 basis-0' : 'shrink-0 grow-0 basis-[45%]',
                row.group === 'vitals' && '@max-[799px]:col-start-1 @max-[799px]:row-start-1 @max-[799px]:basis-auto @max-[799px]:shrink',
                row.group === 'vitals' && '@min-[800px]:basis-auto @min-[800px]:shrink @min-[800px]:grow-0',
              )}
            >
              {showTypeBadge && <ReportTypeBadge group={row.group} />}
              <ReportTitle
                title={row.title}
                expanded={panelExpanded}
                expandable
                className="text-[0.8125rem] font-semibold text-foreground"
              >
                <HighlightText text={row.title} query={query} />
              </ReportTitle>
              {/* Single observation that expands to components (e.g. Blood
                  Pressure → systolic/diastolic) — surface its composite
                  trend here. Multi-item panels (length > 1) are skipped:
                  the dialog only trends firstObs, which would mislead.
                  Procedures are skipped too — they're events, not values. */}
              {displayObs.length === 1 && row.group !== 'procedures' && renderTrendButton(true)}
              {hasImages && renderImageButton(true)}
            </div>
            <div
              data-testid="report-panel-summary"
              className={cn(
                'flex shrink-0 items-center gap-1.5 max-sm:col-start-2 max-sm:row-start-1',
                row.group === 'vitals' && '@max-[799px]:col-start-2 @max-[799px]:row-start-1',
                row.group === 'vitals' && '@min-[800px]:w-full @min-[800px]:justify-end',
              )}
            >
              {/* "N 項" = sub-item count for a lab panel; meaningless for a
                  single procedure event, so hide it there. */}
              {row.group !== "procedures" && (
                <span className="shrink-0 text-[0.8125rem] font-bold tabular-nums text-foreground">
                  {bloodPressureSummary ?? `${displayObs.length} 項`}
                </span>
              )}
              {abnormalCount > 0 && (
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 text-[0.625rem] font-medium', REPORT_ABNORMAL_TONE)}>
                  <AlertCircle className="h-3 w-3" />
                  {abnormalCount} 異常
                </span>
              )}
              {/* Same-session sub-procedures grouped via Procedure.partOf —
                  tells the user this one title expands to several. */}
              {row.group === "procedures" && (row.relatedCount ?? 0) > 0 && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 py-0 text-[0.625rem] font-medium text-violet-700 dark:bg-primary/10 dark:text-primary">
                  +{row.relatedCount} 相關處置
                </span>
              )}
              {row.group === "procedures" && (row.specialMaterialCount ?? 0) > 0 && (
                <span
                  data-testid="procedure-material-count"
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground"
                >
                  <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {t.procedures.materials.count.replace('{count}', String(row.specialMaterialCount))}
                </span>
              )}
            </div>
            {/* Right cluster mirrors the single-value rows: institution inline +
                date-only badge. Category/status (accordionMeta) live on the
                badge's hover tooltip — no separate meta line, so nothing is
                shown twice. */}
            <div
              data-testid="report-panel-meta"
              className={cn(
                'ml-auto flex shrink-0 items-center gap-2 max-sm:col-span-3 max-sm:col-start-1 max-sm:row-start-2 max-sm:ml-0 max-sm:w-full max-sm:min-w-0 max-sm:justify-start',
                panelHasNarrative && 'order-last w-full min-w-0 flex-wrap justify-start gap-1.5 sm:order-none sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-2',
                row.group === 'procedures' && 'max-sm:order-last max-sm:w-full max-sm:flex-wrap max-sm:justify-start max-sm:gap-1.5',
                row.group === 'vitals' && '@max-[799px]:col-span-3 @max-[799px]:col-start-1 @max-[799px]:row-start-2 @max-[799px]:!ml-0 @max-[799px]:w-full @max-[799px]:min-w-0 @max-[799px]:justify-start',
                row.group === 'vitals' && '@min-[800px]:!ml-0',
              )}
            >
              {hasViewerActions && <NhiViewerActions actions={viewerActions} nestedInButton />}
              {!hideMeta && (
                row.group === 'vitals' ? (
                  <VitalReportMetadata
                    row={row}
                    dateLabel={accordionDateLabel}
                    metaLabel={accordionMeta}
                    sourceProgramLabel={sourceProgramLabel}
                    locale={locale}
                  />
                ) : (
                  <>
                    <ReportSourceProgramBadge
                      sourceProgram={row.sourceProgram}
                      label={sourceProgramLabel}
                    />
                    {row.sourceProvenance === 'nhi-medicloud' ? (
                      <NhiMedicloudSourceIndicator institution={row.institution} className="max-w-[15rem]" />
                    ) : row.institution ? (
                      <ReportInstitutionLabel institution={row.institution} hospitalSource={row.hospitalSource} locale={locale} className="max-w-[10rem]" />
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">{accordionDateLabel || accordionMeta}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>{accordionMeta}</TooltipContent>
                    </Tooltip>
                  </>
                )
              )}
              {hideMeta && row.showTime && formatTimeOnly(row.effectiveDate) && (
                <Badge variant="outline" className="text-xs font-normal whitespace-nowrap tabular-nums shrink-0">
                  {formatTimeOnly(row.effectiveDate)}
                </Badge>
              )}
              {/* 「AI 翻譯解讀」— shown when this panel report carries a
                  narrative (e.g. a pathology report with its report text +
                  structured results). asDiv so it can nest inside the
                  AccordionTrigger <button> without button-in-button. Hidden
                  while docked to the right pane (which owns the card). */}
              {panelHasNarrative && !isPanelRightActive && (
                <ReportInterpretationLauncher
                  analyticsHost="report-row"
                  asDiv
                  dataTour="report-ai-interpretation"
                  detailSourceId={panelSourceId}
                  reportId={panelSourceId}
                  reportText={panelNarrative}
                  reportTitle={row.title}
                  onReady={showPanelInterpretationRight}
                />
              )}
              {/* 向右展開 — placed LAST in the right cluster so it sits just
                  to the left of the AccordionTrigger's ▼ chevron, matching
                  the imaging-report layout. div[role=button] (not <button>)
                  avoids button-in-button; mousedown stopProp keeps the click
                  from toggling the accordion. */}
              {canExpandPanelRight && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={openPanelRight}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openPanelRight(e)
                    }
                  }}
                  title={isPanelRightActive ? rightPaneLabels.active : rightPaneLabels.openDetails}
                  aria-label={rightPaneLabels.openDetails}
                  className={cn(
                    RIGHT_PANE_ACTION_CLASSES,
                    'px-1 py-0.5',
                    isPanelRightActive && 'border-primary bg-primary/10 text-primary',
                  )}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          </AccordionTrigger>
          {row.sharedReportSources && row.sharedReportSources.length > 1 && (
            <div
              data-testid="shared-report-summary"
              className="px-2.5 pb-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              {t.reports.sharedReport.summary.replace('{count}', String(row.sharedReportSources.length))}
            </div>
          )}
          <AccordionContent className="pb-0">
            <div className="space-y-0 border-t border-border/60">
              {displayObs.map((obs, i) => (
                <ObservationBlock
                  key={obs.id ? `obs-${obs.id}-${i}` : `obs-${i}`}
                  observation={obs}
                  nested
                />
              ))}
              <div className="px-2.5 pb-2">
                <SharedReportSources sources={row.sharedReportSources} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {imageLightbox}
    </>
  )
}

// Memoized — `row` is stable across re-renders because the parent
// (ReportsCard) memoizes the rows array via useMemo, so referential
// equality skips re-render when only the active tab changes. This is
// the key win for tab-switch latency when "全部" has 500+ rows. The
// inactive tabs are kept mounted via forceMount, so without memo every
// tab switch would re-render every row.
const SingleReportRow = memo(ReportRowImpl)

// Public ReportRow — dispatches between the regular single-DR card
// (SingleReportRow above, with all its hooks), the lab collection-day group
// (LabDayGroupCard, `dayGroup` synthetic rows) and the multi-region study
// card (MultiRegionStudyCard) for imaging group rows. Kept as a thin
// component so the hook order inside SingleReportRow stays unconditional,
// honouring React's rules of hooks even when the same virtualizer slot
// flips between a group and an ungrouped row across re-renders.
export function ReportRow(props: ReportRowProps) {
  const { row } = props
  // dayGroup first — day-group rows also carry groupedRows, but their members
  // are heterogeneous lab DRs, not one ambiguous imaging study. Unlike
  // multi-region groups, a day group can hold a SINGLE member (single-report
  // days still render as a day card so the by-day list keeps one row shape).
  if (row.dayGroup && row.groupedRows && row.groupedRows.length > 0) {
    return <LabDayGroupCard row={row} defaultOpen={props.defaultOpen} query={props.query} />
  }
  if (row.groupedRows && row.groupedRows.length > 1) {
    return <MultiRegionStudyCard row={row} showTypeBadge={props.showTypeBadge} />
  }
  return <SingleReportRow {...props} />
}
