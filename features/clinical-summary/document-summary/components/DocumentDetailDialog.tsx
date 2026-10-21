// DocumentDetailDialog
// "Open in dialog" reader for a single document entry. Mirrors the 健康存摺
// pattern: the sidebar list gives a quick header + collapsible preview,
// but for actually reading a discharge summary the user clicks Maximize
// to pop the full content into a centred modal at ~90% of the viewport.
// The wider viewport eliminates the ~577px panel constraint that crams
// the diagnosis tables on the inline accordion.
//
// Trigger is rendered as `children`; the parent (DocumentSummaryCard)
// supplies a button slot in the entry header. Dialog content reuses the
// existing CompositionRenderer / HtmlDocumentRenderer so all the
// table-fixed + colgroup + DOMPurify pipeline still applies.
"use client"

import { useState } from "react"
import { FileText, Maximize2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReportInterpretationButton, ReportInterpretationPanel } from "@/features/report-interpretation"
import { CompositionRenderer } from "./CompositionRenderer"
import { HtmlDocumentBody } from "./HtmlDocumentRenderer"
import type { ReportInterpretationMode } from "@/src/core/entities/report-interpretation.entity"
import type { DocumentEntry } from "../types"

interface DocumentDetailDialogProps {
  entry: DocumentEntry
  locale?: string
  /** Localised strings forwarded to the inner renderers. The parent already
   *  resolves these from i18n, so we accept them as-is to avoid coupling
   *  this dialog to the language provider. */
  strings: {
    title: string
    documentDate: string
    author: string
    custodian: string
    noSections: string
    fullDocument: string
    expandFullDocument: string
    collapseFullDocument: string
    sectionCount: string
    ipsBadge: string
    ipsBadgeTooltip: string
    dischargeBadge: string
    dischargeBadgeTooltip: string
    htmlBodyHeader: string
    htmlNoContent: string
    htmlExternalUrl: string
    openInDialog: string
  }
  resolveSectionLabel: (i18nKey: string) => string | null
  interpretation?: {
    reportId: string
    reportText: string
    reportTitle: string
    mode?: ReportInterpretationMode
  }
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function formatPeriod(period?: { start?: string; end?: string }): string {
  if (!period) return ''
  const start = formatDate(period.start)
  const end = formatDate(period.end)
  if (start && end && start !== end) return `${start} ~ ${end}`
  return start || end
}

export function DocumentDetailDialog({
  entry,
  locale = 'zh-TW',
  strings,
  resolveSectionLabel,
  interpretation,
}: DocumentDetailDialogProps) {
  const [open, setOpen] = useState(false)
  const [interpretOpen, setInterpretOpen] = useState(false)

  const periodStr = formatPeriod(entry.period)
  const dateStr = formatDate(entry.date)

  // Build a sentence-style header that mirrors the inline metadata strip but
  // reads naturally as a dialog title.
  const headerParts: string[] = []
  if (entry.institution) headerParts.push(entry.institution)
  if (periodStr) headerParts.push(periodStr)
  else if (dateStr && !entry.period) headerParts.push(dateStr)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={strings.openInDialog}
        aria-label={strings.openInDialog}
        className="reveal-on-hover inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
      </button>

      <DialogContent
        className="sm:max-w-[min(90vw,1100px)] max-h-[90vh] flex flex-col gap-0 p-0"
      >
        {/* Header — type label + IPS/discharge badge + primary diagnosis
            + institution / period. Mirrors the inline list header so the
            user keeps their context when popping out the full document. */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <span>{entry.typeLabel}</span>
            {entry.isIps && (
              <span
                title={strings.ipsBadgeTooltip}
                className="inline-flex shrink-0 items-center text-xs font-normal text-muted-foreground"
              >
                {strings.ipsBadge}
              </span>
            )}
            {entry.isDischargeSummary && entry.typeLabel !== strings.dischargeBadge && (
              <span
                title={strings.dischargeBadgeTooltip}
                className="inline-flex shrink-0 items-center text-xs font-normal text-muted-foreground"
              >
                {strings.dischargeBadge}
              </span>
            )}
          </DialogTitle>
          {entry.primaryDiagnosis && (
            <div className="flex items-baseline gap-1.5 text-sm font-medium text-foreground/90">
              {entry.primaryDiagnosis.code && (
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.primaryDiagnosis.code}
                </span>
              )}
              <span>{entry.primaryDiagnosis.text}</span>
            </div>
          )}
          {(headerParts.length > 0 || interpretation) && (
            <div className="flex flex-wrap items-center gap-2 pr-8">
              {headerParts.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {entry.institution && (
                    <span className="inline-flex items-center gap-1">
                      {entry.institution}
                    </span>
                  )}
                  {entry.institution && (periodStr || dateStr) && (
                    <span className="select-none">·</span>
                  )}
                  {periodStr ? (
                    <span className="tabular-nums">{periodStr}</span>
                  ) : dateStr ? (
                    <span className="tabular-nums">{dateStr}</span>
                  ) : null}
                </div>
              )}
              {interpretation && (
                <ReportInterpretationButton
                  active={interpretOpen}
                  analyticsHost="document-dialog"
                  onToggle={(e) => {
                    e.stopPropagation()
                    setInterpretOpen((value) => !value)
                  }}
                  className="ml-auto"
                />
              )}
            </div>
          )}
        </DialogHeader>

        {/* Body — plain overflow-y-auto div (not Radix ScrollArea) because
            ScrollArea's internal viewport uses `height: 100%`, which only
            constrains when the parent has an EXPLICIT pixel height. In a
            flex-1 column the parent has a flex-derived rendered height but
            its `height` CSS property is still `auto`, so the viewport
            inherits `auto` and grows to its content (the long discharge
            summary), defeating the scroll. A plain `overflow-y-auto` div
            relies on the flex algorithm directly — `flex: 1 1 0%` +
            `min-h-0` gives it a definite computed cross-axis size that
            `overflow` honours.
            For DocumentReference we render the body DIRECTLY (no extra
            "文件內容" accordion) — the dialog itself is the container,
            wrapping the body in another collapsible adds visual noise the
            user has to dismiss every time they open a document. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {interpretation && interpretOpen && (
            <ReportInterpretationPanel
              reportId={interpretation.reportId}
              reportText={interpretation.reportText}
              reportTitle={interpretation.reportTitle}
              mode={interpretation.mode}
              analyticsHost="document-dialog"
              className="mb-4"
            />
          )}
          {entry.sourceKind === 'composition' && entry.composition ? (
            <CompositionRenderer
              composition={entry.composition}
              locale={locale}
              defaultExpandFirst={true}
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
              labels={{
                noContent: strings.htmlNoContent,
                externalUrl: strings.htmlExternalUrl,
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
