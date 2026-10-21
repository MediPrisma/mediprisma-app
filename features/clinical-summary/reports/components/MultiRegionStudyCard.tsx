// MultiRegionStudyCard
// Renders a synthetic Row that wraps several DRs sharing
// (code, date, institution) — typical of NHI CT studies where every body
// part imaged on the same machine bills under one code (33070B etc.) and
// arrives as multiple narrative + image-only DRs that bridge cannot
// reliably pair (see utils/multi-region-grouping.ts for the why).
//
// UX contract:
//   • The card MUST make it visually obvious that there are N distinct
//     items (not one merged document). We do this with numbered (①②③)
//     sub-cards stacked vertically, each in its own bordered box.
//   • Section dividers ("2 份報告" / "2 組影像") spell out the counts.
//   • Body-part hint is extracted from the narrative's first line
//     ("…of Head and neck Without…" → "Head and Neck") so the user can
//     identify each report at a glance without expanding it.
//   • Ambiguity warning explains *why* multiple distinct studies are
//     grouped together (same NHI code, no body-part field).
//
// We intentionally do NOT attempt auto-pairing of image sets to
// narratives — CT slice content is visually unmistakable (brain ≠ chest
// ≠ abdomen), so the clinician's eye is the right authority.
"use client"

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, FileText, ImageIcon, PanelRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useRightDetail } from '@/src/application/providers/right-detail.provider'
import { RIGHT_PANE_ACTION_CLASSES } from '@/src/shared/config/ui-theme.config'
import { cn } from '@/src/shared/utils/cn.utils'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import type { Row } from '../types'
import { formatDate } from '../utils/fhir-helpers'
import { ReportImageDialog } from './ReportImageDialog'
import { FormattedReportText } from './FormattedReportText'
import { ReportPreviewLine } from './ReportPreviewLine'
import { ReportInterpretationLauncher, ReportInterpretationPanel } from '@/features/report-interpretation'
import { NhiViewerActions } from './NhiViewerActions'
import { ReportTypeBadge } from './ReportTypeBadge'

interface MultiRegionStudyCardProps {
  row: Row
  showTypeBadge?: boolean
}

const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
function circled(n: number): string {
  return CIRCLED_NUMBERS[n] || `(${n + 1})`
}


/** Pull the first long-form valueString from the row's observations — the
 *  narrative text bridge typically writes there for image reports. Returns
 *  '' when no narrative is present (image-only rows). */
function getNarrativeText(row: Row): string {
  for (const o of row.obs || []) {
    if (typeof o.valueString === 'string' && o.valueString.trim().length > 30) {
      return o.valueString
    }
  }
  return ''
}

/** Try to extract the body-part label from a radiology narrative's first
 *  line. NHI imaging reports almost always open with "Computed Tomography
 *  of <Body Part> Without/With <Contrast> Show:" — so we lift the
 *  "<Body Part>" segment for the sub-card subtitle. Returns '' when the
 *  pattern doesn't match (preserves the row's raw title in that case). */
function inferBodyPart(text: string): string {
  if (!text) return ''
  // Match "<modality> of <body part> (Without|With|w/ …) (Show|:|Enhancement)"
  const m = text.match(
    /(?:Computed Tomography|CT|MRI|Magnetic Resonance|Ultrasound|US|X-?ray|Radiograph|Plain film)\s+of\s+([A-Za-z][A-Za-z\s,\-/&()]*?)(?=\s+(?:Without|With|w\/|w\/o|Enhancement|Show|:))/i,
  )
  return m ? m[1].trim().replace(/\s+/g, ' ') : ''
}

function formatBytes(size?: number): string {
  if (!size || size <= 0) return ''
  const mb = size / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(size / 1024)} KB`
}

export function MultiRegionStudyCard({ row, showTypeBadge }: MultiRegionStudyCardProps) {
  // Collapsed by default — these cards are large (warning banner + N sub-
  // cards). On a busy day the user wants to scan the imaging tab quickly;
  // forcing them to scroll past several fully-expanded groups slows that
  // down. The header alone (type / count / date / institution + ⚠ icon if
  // ambiguous) carries enough info to decide whether to dive in. Mirrors
  // the rest of the app's "collapse by default for multi-item containers"
  // pattern (DocumentSummaryCard list, VisitItem accordion, etc.).
  const [expanded, setExpanded] = useState(false)
  const { t, locale } = useLanguage()
  const tm = (t as any).reports?.multiRegion || {
    title: 'Same-day same-code studies',
    ambiguityWarning:
      'NHI uses one health-record code for every CT body part (e.g. head CT and chest CT are both billed as 33070B), so multiple body parts imaged on the same day arrive as several distinct records. Because NHI provides no body-part field, the app cannot automatically tell which report belongs to which image set — please rely on the image content itself.',
    narrativeSection: 'reports',
    imageSection: 'image sets',
    viewerSection: 'NHI viewer links',
    reportLabel: 'Report',
    imageLabel: 'Image set',
    viewerLabel: 'NHI DICOM Viewer',
    noNarrative: 'No written report attached',
    viewImages: 'View images',
    imagesCount: 'images',
    firstFrame: 'first frame',
    itemCount: '{count} items',
    sharedCode: 'Shared NHI code',
    openText: 'Open the full report in the right panel',
    openTextActive: 'Report is open in the right panel',
  }

  const sub = row.groupedRows ?? []
  const viewerSection = tm.viewerSection ?? (locale === 'zh-TW' ? '健保影像 Viewer 連結' : 'NHI viewer links')
  const viewerLabel = tm.viewerLabel ?? (locale === 'zh-TW' ? '健保 DICOM Viewer' : 'NHI DICOM Viewer')
  const narratives = sub.filter((r) => getNarrativeText(r).length > 0)
  const imageSets = sub.filter((r) => (r.images?.length ?? 0) > 0)
  const viewerRows = sub.filter((r) => (r.viewerActions?.length ?? 0) > 0)
  const dateStr = formatDate(row.effectiveDate)

  return (
    <Card className="rounded-lg border-border bg-amber-50/20 shadow-none hover:shadow-none dark:bg-amber-500/5">
      {/* Header — always visible, click to toggle the body. Carries enough
          info (type + count + ⚠ ambiguity hint + date + institution +
          narrative/image counts as small chips) for the user to decide
          whether to expand. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full rounded-t-lg px-3 py-2 text-left transition-colors hover:bg-amber-50/40 dark:hover:bg-amber-500/10"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {showTypeBadge && <ReportTypeBadge group="imaging" />}
              <span className="font-semibold text-sm">{row.title}</span>
              <span className="inline-flex items-center rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0 text-[0.625rem] font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {tm.itemCount.replace('{count}', String(sub.length))}
              </span>
              {row.hasAmbiguity && (
                <span
                  title={tm.ambiguityWarning}
                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0 text-[0.625rem] font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                  {tm.sharedCode}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {dateStr && <span className="tabular-nums">{dateStr}</span>}
              {row.institution && (
                <span className="inline-flex items-center gap-1">
                  {formatOrganizationDisplay(row.institution, locale)}
                </span>
              )}
              {narratives.length > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden />
                  {narratives.length} {tm.narrativeSection}
                </span>
              )}
              {imageSets.length > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <ImageIcon className="h-3 w-3 shrink-0" aria-hidden />
                  {imageSets.length} {tm.imageSection}
                </span>
              )}
              {viewerRows.length > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  {viewerRows.length} {viewerSection}
                </span>
              )}
            </div>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 mt-1 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-3 border-t border-amber-200/60 dark:border-amber-500/30 pt-2.5">
          {/* Ambiguity warning — full text shown only when expanded; the
              header carries a compact ⚠ chip for collapsed-state context. */}
          {row.hasAmbiguity && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/80 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{tm.ambiguityWarning}</span>
            </div>
          )}

          {/* Narratives section — each in its own sub-card, numbered */}
          {narratives.length > 0 && (
            <section className="space-y-1.5">
              <SectionDivider
                icon={<FileText className="h-3 w-3" />}
                label={`${narratives.length} ${tm.narrativeSection}`}
              />
              {narratives.map((r, i) => (
                <NarrativeSubCard
                  key={r.id}
                  row={r}
                  index={i}
                  reportLabel={tm.reportLabel}
                />
              ))}
            </section>
          )}

          {/* Image sets section — each in its own sub-card, numbered */}
          {imageSets.length > 0 && (
            <section className="space-y-1.5">
              <SectionDivider
                icon={<ImageIcon className="h-3 w-3" />}
                label={`${imageSets.length} ${tm.imageSection}`}
              />
              {imageSets.map((r, i) => (
                <ImageSetSubCard
                  key={r.id}
                  row={r}
                  index={i}
                  imageLabel={tm.imageLabel}
                  viewLabel={tm.viewImages}
                  imagesCount={tm.imagesCount}
                  firstFrame={tm.firstFrame}
                />
              ))}
            </section>
          )}

          {viewerRows.length > 0 && (
            <section className="space-y-1.5">
              <SectionDivider
                icon={<ExternalLink className="h-3 w-3" />}
                label={`${viewerRows.length} ${viewerSection}`}
              />
              {viewerRows.map((r, i) => (
                <ViewerSubCard
                  key={r.id}
                  row={r}
                  index={i}
                  viewerLabel={viewerLabel}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </Card>
  )
}

function ViewerSubCard({
  row,
  index,
  viewerLabel,
}: {
  row: Row
  index: number
  viewerLabel: string
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2 shadow-sm">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
        <span className="shrink-0 select-none font-semibold tabular-nums text-amber-700 dark:text-amber-300">
          {circled(index)}
        </span>
        <span>{viewerLabel} {circled(index)}</span>
      </div>
      <NhiViewerActions actions={row.viewerActions} />
    </div>
  )
}

function SectionDivider({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex-1 border-t border-border/60" aria-hidden />
    </div>
  )
}

function NarrativeSubCard({
  row,
  index,
  reportLabel,
}: {
  row: Row
  index: number
  reportLabel: string
}) {
  const { t } = useLanguage()
  const rightLabels = (t as any).reports?.multiRegion
  const [expanded, setExpanded] = useState(false)
  const text = getNarrativeText(row)
  const bodyPart = inferBodyPart(text)
  const hasText = text.trim().length > 0
  const toggle = () => setExpanded((v) => !v)

  // 向右展開 — dock this sub-report's narrative (with its AI card on top) into
  // the right pane, matching a normal report row. Sub-reports are text-only
  // here (image sets are separate ImageSetSubCards), so the docked node is a
  // simple text + AI-panel column.
  const { detail: rightDetail, showDetail, toggleDetail } = useRightDetail()
  const reportId = `report:${row.id}`
  const isRightActive = rightDetail?.sourceId === reportId
  const createRightDetail = () => ({
      sourceId: reportId,
      title: (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{reportLabel} {circled(index)}</span>
          {bodyPart && (
            <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">· {bodyPart}</span>
          )}
        </span>
      ),
      node: (
        <div key={reportId} className="scrollbar-thin-persistent h-full overflow-y-auto pr-1">
          {/* The launcher finishes before opening this pane. Manual mode then
              reuses its cached result; ordinary docking stays non-generating. */}
          <ReportInterpretationPanel
            analyticsHost="report-row"
            reportId={reportId}
            reportText={text}
            reportTitle={bodyPart || undefined}
            autoGenerate={false}
          />
          <FormattedReportText text={text} className="text-sm leading-relaxed text-foreground/90" />
        </div>
      ),
    })
  const openRight = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleDetail(createRightDetail())
  }
  const showInterpretationRight = () => {
    // Preserve the original narrative on the left for direct comparison with
    // the completed translation that is about to open on the right.
    setExpanded(true)
    showDetail(createRightDetail())
  }

  return (
    <div className={cn(
      'rounded-md border bg-background shadow-sm transition-colors',
      isRightActive ? 'border-primary/40 bg-primary/5' : 'border-border',
    )}>
      {/* Sub-card header — number + body-part hint or label. A div-role=button
          (not <button>) so the 「AI 翻譯解讀」button can nest without an invalid
          button-in-button. */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
        }}
        aria-expanded={expanded}
        className="w-full cursor-pointer px-2.5 py-1.5 text-left flex items-start gap-2 hover:bg-muted/40 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md"
      >
        <span className="text-amber-700 font-semibold text-sm shrink-0 select-none tabular-nums dark:text-amber-300">
          {circled(index)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">
            {reportLabel} {circled(index)}
            {bodyPart && (
              <span className="ml-1.5 font-normal text-foreground/70">
                · {bodyPart}
              </span>
            )}
          </div>
          {!expanded && (
            <ReportPreviewLine text={text} className="mt-0.5 text-[0.6875rem] text-muted-foreground" />
          )}
        </div>
        {/* AI button hidden while docked to the right pane (which owns the card
            there) — no duplicate left card / orphan button. */}
        {hasText && !isRightActive && (
          <ReportInterpretationLauncher
            analyticsHost="report-row"
            detailSourceId={reportId}
            reportId={reportId}
            reportText={text}
            reportTitle={bodyPart || undefined}
            onReady={showInterpretationRight}
          />
        )}
        {/* 向右展開 — dock to the right pane (desktop only). Neutral-grey button
            with a hover tooltip, matching a normal report row. */}
        {hasText && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openRight}
                aria-label={rightLabels.openText}
                className={cn(
                  RIGHT_PANE_ACTION_CLASSES,
                  'px-2 py-1 text-xs font-medium',
                  isRightActive && '!opacity-100 border-border bg-foreground/[0.07] text-foreground',
                )}
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{isRightActive ? rightLabels.openTextActive : rightLabels.openText}</TooltipContent>
          </Tooltip>
        )}
        <span className={cn('text-xs text-muted-foreground shrink-0 select-none mt-0.5', expanded && 'rotate-180')}>
          ▾
        </span>
      </div>
      {/* Expanded full report body */}
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0.5 text-xs border-t border-border/40">
          <FormattedReportText text={text} />
        </div>
      )}
    </div>
  )
}

function ImageSetSubCard({
  row,
  index,
  imageLabel,
  viewLabel,
  imagesCount,
  firstFrame,
}: {
  row: Row
  index: number
  imageLabel: string
  viewLabel: string
  imagesCount: string
  firstFrame: string
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const images = row.images ?? []
  const count = images.length
  const firstSize = images[0]?.size

  return (
    <div className="rounded-md border border-border bg-background shadow-sm">
      <div className="px-2.5 py-2 flex items-start gap-2">
        <span className="text-amber-700 font-semibold text-sm shrink-0 select-none tabular-nums dark:text-amber-300">
          {circled(index)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">
            {imageLabel} {circled(index)}
          </div>
          <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            {count} {imagesCount}
            {firstSize ? ` · ${firstFrame} ${formatBytes(firstSize)}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setMounted(true)
            setOpen(true)
          }}
          className="text-xs text-primary hover:underline shrink-0 px-2 py-1"
        >
          {viewLabel}
        </button>
      </div>
      {mounted && (
        <ReportImageDialog
          images={images}
          title={`${imageLabel} ${circled(index)}`}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  )
}
