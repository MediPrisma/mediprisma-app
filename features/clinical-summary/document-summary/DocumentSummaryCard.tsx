// DocumentSummaryCard
// Renders the human-readable narratives carried inside FHIR document
// resources. Today this covers two sources:
//
//   1. Composition  — typically IPS (International Patient Summary) imports.
//                     Multi-section structure; each section.text.div is
//                     sanitised XHTML rendered by CompositionRenderer.
//   2. DocumentReference — 健保存摺 discharge summaries via bridge v0.17.0+.
//                          A single self-contained HTML attachment per doc;
//                          rendered by HtmlDocumentRenderer.
//
// Both flow through the same DocumentEntry view-model and the card is
// source-agnostic — the per-entry header strip (type label, badges, date,
// institution, period) works the same way for either, and the renderer is
// dispatched on `entry.sourceKind`.
//
// Bridge sessions without any Composition / clinical-note DocumentReference
// hit the `isEmpty` branch and the card hides itself; the friendly empty
// state explains the feature so users know it exists once they import IPS
// or once the bridge ships discharge summaries.
"use client"

import { useCallback, useMemo, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Building2, Info, PanelRight } from 'lucide-react'
import { FeatureCard } from '@/src/shared/components'
import { cn } from '@/src/shared/utils/cn.utils'
import { useRightDetail } from '@/src/application/providers/right-detail.provider'
import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'
import type { ResourceNavTarget } from '@/src/application/stores/resource-navigation.store'
import { RIGHT_PANE_ACTION_CLASSES } from '@/src/shared/config/ui-theme.config'
import { ReportInterpretationLauncher, ReportInterpretationPanel } from '@/features/report-interpretation'
import { useDocumentSummaries } from './hooks/useDocumentSummaries'
import { CompositionRenderer } from './components/CompositionRenderer'
import { HtmlDocumentRenderer, HtmlDocumentBody } from './components/HtmlDocumentRenderer'
import { DocumentDetailDialog } from './components/DocumentDetailDialog'
import { useDocumentSummaryStrings, makeResolveSectionLabel, type DocSummaryStrings } from './utils/strings'
import { getDocumentPlainText } from './utils/document-text'
import { isPreventiveMedicineComposition } from './utils/loinc-document-types'
import type { DocumentEntry } from './types'
import { useLanguage } from '@/src/application/providers/language.provider'


function formatDate(iso?: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

/**
 * Build the period string for an entry's header — e.g. "2025-05-18 ~ 2025-05-22"
 * for a discharge summary, or empty when the entry has no period.
 */
function formatPeriod(period?: { start?: string; end?: string }): string {
  if (!period) return ''
  const start = formatDate(period.start)
  const end = formatDate(period.end)
  if (start && end && start !== end) return `${start} ~ ${end}`
  return start || end
}

export function DocumentSummaryCard() {
  const { locale } = useLanguage()
  const strings = useDocumentSummaryStrings()
  const { entries, isLoading, error } = useDocumentSummaries(strings.docTypes)
  const resolveSectionLabel = makeResolveSectionLabel(strings)

  const isEmpty = entries.length === 0
  // One-doc datasets auto-expand the body to save a click; multi-doc lists
  // stay collapsed so the card height doesn't balloon.
  const autoExpand = entries.length === 1

  return (
    <FeatureCard
      title={strings.title}
      featureId="document-summary"
      titleAccessory={(
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={strings.tooltipLabel}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs text-xs leading-relaxed">
              {strings.tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage={strings.noData}
    >
      <ul className="space-y-2" data-tour="documents-list">
        {entries.map((entry) => (
          <DocumentEntryCard
            key={entry.id}
            entry={entry}
            autoExpand={autoExpand}
            strings={strings}
            resolveSectionLabel={resolveSectionLabel}
            locale={locale}
          />
        ))}
      </ul>
    </FeatureCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Per-entry card — header strip (type + badges + institution + period +
// date) plus the source-specific renderer.
// ─────────────────────────────────────────────────────────────────────────
interface DocumentEntryCardProps {
  entry: DocumentEntry
  autoExpand: boolean
  strings: DocSummaryStrings
  resolveSectionLabel: (i18nKey: string) => string | null
  locale: string
}

function DocumentEntryCard({
  entry,
  autoExpand,
  strings,
  resolveSectionLabel,
  locale,
}: DocumentEntryCardProps) {
  const dateStr = formatDate(entry.date)
  const periodStr = formatPeriod(entry.period)
  const resourceType = entry.sourceKind === 'composition' ? 'Composition' : 'DocumentReference'
  const [forceExpandKey, setForceExpandKey] = useState<number>()
  const [evidenceQuote, setEvidenceQuote] = useState<string>()
  const handleResourceMatch = useCallback((sequence: number, target: ResourceNavTarget) => {
    setEvidenceQuote(target.evidenceQuote)
    setForceExpandKey(sequence)
  }, [])
  const anchorRef = useResourceAnchor<HTMLLIElement>(resourceType, entry.id, handleResourceMatch)

  // Plain-text extraction reuses the same strip-HTML path the clinical-context
  // builder uses, so the model gets readable document text (not sanitised HTML
  // or base64) when 「AI翻譯」opens the document in the right pane.
  const docPlainText = useMemo(() => getDocumentPlainText(entry), [entry])
  const canInterpret = docPlainText.trim().length > 0
  const interpretationMode = entry.isDischargeSummary ? 'long-document' : 'standard'
  const isPreventiveComposition = entry.sourceKind === 'composition' &&
    !!entry.composition && isPreventiveMedicineComposition(entry.composition)

  // 向右展開 — dock the full document (the same content the maximize dialog
  // shows) in the right pane to read it beside the list.
  const { detail: rightDetail, showDetail, toggleDetail } = useRightDetail()
  const sourceId = `doc:${entry.id}`
  const isRightActive = rightDetail?.sourceId === sourceId
  const createRightDetail = () => ({
      sourceId,
      title: (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{entry.typeLabel}</span>
          {(periodStr || (dateStr && !entry.period)) && (
            <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">
              · {periodStr || dateStr}
            </span>
          )}
        </span>
      ),
      node: (
        <div key={sourceId} className="scrollbar-thin-persistent h-full overflow-y-auto pr-1">
          {/* The launcher completes before opening this pane, so manual mode
              reuses the cached result. Ordinary right-pane opening remains
              non-generating. */}
          {canInterpret && (
            <ReportInterpretationPanel
              analyticsHost="document-card"
              reportId={sourceId}
              reportText={docPlainText}
              reportTitle={entry.typeLabel}
              mode={interpretationMode}
              autoGenerate={false}
            />
          )}
          {/* Docking is an explicit request to read the document. Open its
              full content immediately instead of presenting a second toggle
              in the right pane. */}
          {entry.sourceKind === 'composition' && entry.composition ? (
            <CompositionRenderer
              composition={entry.composition}
              locale={locale}
              defaultExpandFirst
              forceExpandKey={0}
              resolveSectionLabel={resolveSectionLabel}
              labels={{
                documentDate: strings.documentDate,
                author: strings.author,
                custodian: strings.custodian,
                noSections: strings.noSections,
                fullDocument: strings.fullDocument,
                expandFullDocument: strings.expandFullDocument,
                collapseFullDocument: strings.collapseFullDocument,
                sectionCount: strings.sectionCount,
              }}
            />
          ) : entry.sourceKind === 'documentReference' && entry.attachment ? (
            <HtmlDocumentBody
              attachment={entry.attachment}
              labels={{ noContent: strings.htmlNoContent, externalUrl: strings.htmlExternalUrl }}
            />
          ) : null}
        </div>
      ),
    })
  const openRight = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    toggleDetail(createRightDetail())
  }
  const showInterpretationRight = () => showDetail(createRightDetail())
  // div[role=button] (not <button>) so it can nest inside HtmlDocumentRenderer's
  // AccordionTrigger button without invalid HTML; mousedown stopProp keeps the
  // click from toggling the accordion. Desktop-only (no right pane on phones).
  const rightButton = (
    <div
      role="button"
      data-tour="document-open-right"
      tabIndex={0}
      onClick={openRight}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openRight(e)
        }
      }}
      title={isRightActive ? strings.openInRightPaneActive : strings.openInRightPane}
      aria-label={strings.openInRightPane}
      className={cn(
        RIGHT_PANE_ACTION_CLASSES,
        'px-1 py-0.5',
        isRightActive && 'border-primary bg-primary/10 text-primary',
      )}
    >
      <PanelRight className="h-3.5 w-3.5" />
    </div>
  )

  return (
    <li
      ref={anchorRef}
      data-tour="document-entry"
      className={cn(
        'rounded-md border border-border/60 bg-muted/20 p-2.5 transition-colors',
        isRightActive && 'border-primary/40 bg-primary/5',
      )}
    >
      {/* Header strip: type label · IPS / discharge badge · date · maximize */}
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-sm font-semibold">{entry.typeLabel}</span>
          {entry.isIps && (
            <span
              title={strings.ipsBadgeTooltip}
              className="inline-flex shrink-0 items-center rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[0.625rem] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
            >
              {strings.ipsBadge}
            </span>
          )}
          {/* Suppress the discharge badge when the type label already says
              出院病摘 — otherwise the badge is redundant noise. */}
          {entry.isDischargeSummary && entry.typeLabel !== strings.dischargeBadge && (
            <span
              title={strings.dischargeBadgeTooltip}
              className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[0.625rem] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              {strings.dischargeBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* CompositionRenderer already owns Composition date metadata.
              Keeping the same date here duplicated it on preventive-care
              documents. Standalone DocumentReferences without a period still
              need this header date as their only temporal anchor. */}
          {dateStr && !entry.period && entry.sourceKind !== 'composition' && (
            <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
              {dateStr}
            </span>
          )}
          {/* 「AI 翻譯解讀」— shown for any document with extractable text.
              Hidden while docked to the right pane (which owns the AI card
              there), so there's no duplicate left card / orphan button. */}
          {canInterpret && !isRightActive && (
            <ReportInterpretationLauncher
              analyticsHost="document-card"
              detailSourceId={sourceId}
              reportId={sourceId}
              reportText={docPlainText}
              reportTitle={entry.typeLabel}
              mode={interpretationMode}
              onReady={showInterpretationRight}
            />
          )}
          {/* Section-based compositions keep the action in the header. Adult
              preventive-care has one document-level bar, so its action moves
              there to match the discharge-summary interaction. */}
          {entry.sourceKind === 'composition' && !isPreventiveComposition && rightButton}
          {/* Maximize button — opens the same content in a centred dialog
              at ~90vw so the discharge-summary tables breathe. The inline
              accordion below still works for quick previews. */}
          <DocumentDetailDialog
            entry={entry}
            locale={locale}
            strings={strings}
            resolveSectionLabel={resolveSectionLabel}
            interpretation={
              canInterpret
                ? {
                    reportId: sourceId,
                    reportText: docPlainText,
                    reportTitle: entry.typeLabel,
                    mode: interpretationMode,
                  }
                : undefined
            }
          />
        </div>
      </div>

      {entry.outpatient && (
        <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="min-w-0 break-words">
            {locale === 'en' ? 'Department: ' : '科別：'}
            {entry.outpatient.department || (locale === 'en' ? 'Not provided' : '未提供')}
          </span>
          <span className="min-w-0 break-words">
            {locale === 'en' ? 'Physician: ' : '門診醫師：'}
            {entry.outpatient.physician || (locale === 'en' ? 'Not provided' : '未提供')}
          </span>
        </div>
      )}
      {entry.primaryDiagnosis && (
        <div className="mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[0.8125rem] font-medium text-foreground/90">
          {entry.outpatient && <span className="text-xs text-muted-foreground">{locale === 'en' ? 'Primary diagnosis:' : '主診斷：'}</span>}
          {entry.primaryDiagnosis.code && (
            <span
              className={cn('font-mono', entry.outpatient ? 'text-xs' : 'text-[0.6875rem] text-muted-foreground cursor-help')}
              title={entry.outpatient ? undefined : strings.primaryDiagnosisTooltip}
            >{entry.primaryDiagnosis.code}</span>
          )}
          <span
            title={entry.outpatient ? undefined : strings.primaryDiagnosisTooltip}
            className={cn('min-w-0 break-words', !entry.outpatient && 'cursor-help')}
          >
            {entry.primaryDiagnosis.text || (locale === 'en' ? 'Description not provided' : '未提供診斷名稱')}
          </span>
        </div>
      )}

      {/* Secondary line: institution + period (e.g. "長庚嘉義 · 2025-05-18 ~ 2025-05-22") */}
      {(entry.institution || periodStr) && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          {entry.institution && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" aria-hidden />
              {entry.institution}
            </span>
          )}
          {entry.institution && periodStr && <span className="select-none">·</span>}
          {periodStr && <span className="tabular-nums">{periodStr}</span>}
        </div>
      )}

      {/* Source-specific renderer. Composition → per-section accordion,
          DocumentReference → single HTML-body accordion. */}
      {entry.sourceKind === 'composition' && entry.composition ? (
        <CompositionRenderer
          composition={entry.composition}
          locale={locale}
          defaultExpandFirst={autoExpand}
          forceExpandKey={forceExpandKey}
          resolveSectionLabel={resolveSectionLabel}
          rightControl={isPreventiveComposition ? rightButton : undefined}
          labels={{
            documentDate: strings.documentDate,
            author: strings.author,
            custodian: strings.custodian,
            noSections: strings.noSections,
            fullDocument: strings.fullDocument,
            expandFullDocument: strings.expandFullDocument,
            collapseFullDocument: strings.collapseFullDocument,
            sectionCount: strings.sectionCount,
          }}
        />
      ) : entry.sourceKind === 'documentReference' && entry.attachment ? (
        <HtmlDocumentRenderer
          attachment={entry.attachment}
          defaultExpanded={autoExpand}
          forceExpandKey={forceExpandKey}
          evidenceQuote={evidenceQuote}
          rightControl={rightButton}
          labels={{
            bodyHeader: strings.htmlBodyHeader,
            noContent: strings.htmlNoContent,
            externalUrl: strings.htmlExternalUrl,
          }}
        />
      ) : null}
    </li>
  )
}
