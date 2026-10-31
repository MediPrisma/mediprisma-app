"use client"

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Eye,
  FileDown,
  FileText,
  Settings2,
  XCircle,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownRenderer } from '@/src/shared/components/MarkdownRenderer'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { IpsExportFormat } from '../hooks/useIpsExport'
import type { IpsBundle } from '../utils/ips-types'
import type { ValidationResult } from '../utils/ips-lite-validator'
import { IPS_SIZE_WARN_BYTES } from '../utils/ips-constants'
import { formatByteSize, utf8ByteLength } from '../utils/ips-helpers'

type DownloadFormat = 'pdf' | 'markdown' | 'json'
type MarkdownView = 'rendered' | 'source'

interface IpsExportPreviewProps {
  bundle: IpsBundle
  markdown: string
  validation: ValidationResult | null
  copiedFormat: IpsExportFormat | null
  copyError: string | null
  markdownFilename: string
  resourceCount: number
  includeImageAttachments: boolean
  includePatientIdentifiers: boolean
  onOpenSettings: () => void
  onDownloadJson: () => void
  onDownloadMarkdown: () => void
  onCopyJson: () => void
  onCopyMarkdown: () => void
}

function splitFrontmatter(markdown: string): { body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  return { body: match ? markdown.slice(match[0].length).trimStart() : markdown }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function compactPrintHtml(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const headers = Array.from(table.querySelectorAll('thead th'))
    const groupIndex = headers.findIndex((th) => th.textContent?.trim().toLowerCase() === 'group')
    if (groupIndex === -1) continue
    for (const row of Array.from(table.querySelectorAll('tr'))) row.children.item(groupIndex)?.remove()
  }
  return root.innerHTML
}

export function IpsExportPreview({
  bundle,
  markdown,
  validation,
  copiedFormat,
  copyError,
  markdownFilename,
  resourceCount,
  includeImageAttachments,
  includePatientIdentifiers,
  onOpenSettings,
  onDownloadJson,
  onDownloadMarkdown,
  onCopyJson,
  onCopyMarkdown,
}: IpsExportPreviewProps) {
  const { t } = useLanguage()
  const x = t.ipsExport
  const [format, setFormat] = useState<DownloadFormat>('pdf')
  const [markdownView, setMarkdownView] = useState<MarkdownView>('rendered')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [pendingAction, setPendingAction] = useState<'copy' | 'download' | 'pdf' | null>(null)
  // A confirmed action waits here until the dialog has finished closing:
  // print() blocks the page, and a dialog still animating out when it opens
  // stays on screen afterwards with the page locked behind it.
  const confirmedActionRef = useRef<typeof pendingAction>(null)
  const printSourceRef = useRef<HTMLDivElement>(null)
  const json = useMemo(() => JSON.stringify(bundle, null, 2), [bundle])
  const markdownBody = useMemo(() => splitFrontmatter(markdown).body, [markdown])
  const jsonBytes = useMemo(() => utf8ByteLength(json), [json])
  const pdfFilename = markdownFilename.replace(/\.md$/i, '.pdf')

  const handlePrintPdf = () => {
    const html = printSourceRef.current?.innerHTML
    if (!html) return
    const printDocument = `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(pdfFilename)}</title>
<style>
@page { size: A4 landscape; margin: 10mm 8mm; }
body { color:#111827; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:10px; line-height:1.35; }
h1 { font-size:16px; margin:0 0 8px; } h2 { font-size:12px; margin:10px 0 4px; border-bottom:1px solid #e5e7eb; padding-bottom:2px; }
h3 { font-size:11px; margin:8px 0 3px; } h4 { font-size:10px; margin:6px 0 2px; } p,ul,ol { margin:4px 0; }
blockquote { margin:6px 0 10px; padding:6px 8px; border-left:3px solid #d97706; background:#fffbeb; color:#78350f; }
table { width:auto; max-width:100%; border-collapse:collapse; margin:3px 0 7px; page-break-inside:auto; table-layout:auto; }
tr { page-break-inside:avoid; page-break-after:auto; } th,td { border-top:1px solid #e5e7eb; padding:1.5px 4px 1.5px 0; text-align:left; vertical-align:top; }
th { color:#4b5563; font-weight:600; } th:first-child,td:first-child { width:56px; white-space:nowrap; }
code,pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
</style></head><body>${compactPrintHtml(html)}</body></html>`

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    frame.onload = () => {
      const printWindow = frame.contentWindow
      if (!printWindow) {
        toast.error(x.pdfPopupBlocked)
        frame.remove()
        return
      }
      printWindow.focus()
      printWindow.print()
      setTimeout(() => frame.remove(), 1000)
    }
    frame.srcdoc = printDocument
    document.body.appendChild(frame)
  }

  const performAction = (action: NonNullable<typeof pendingAction>) => {
    if (action === 'pdf') handlePrintPdf()
    else if (action === 'download') {
      if (format === 'json') onDownloadJson()
      else onDownloadMarkdown()
    } else if (format === 'json') onCopyJson()
    else onCopyMarkdown()
  }

  const requestAction = (action: NonNullable<typeof pendingAction>) => {
    if (includePatientIdentifiers) setPendingAction(action)
    else performAction(action)
  }

  const primaryAction = () => {
    if (format === 'pdf') requestAction('pdf')
    else requestAction('download')
  }

  const primaryLabel = format === 'pdf' ? x.savePdf : format === 'markdown' ? x.downloadMarkdown : x.downloadJson
  const selectedFilename = format === 'pdf'
    ? pdfFilename
    : format === 'markdown'
      ? markdownFilename
      : markdownFilename.replace(/\.md$/i, '.json')
  const copied = copiedFormat === (format === 'json' ? 'json' : 'markdown')

  const formatOptions: Array<{
    id: DownloadFormat
    title: string
    description: string
    icon: typeof FileText
    badge?: string
  }> = [
    { id: 'pdf', title: x.pdfFormat, description: x.pdfFormatDescription, icon: FileDown, badge: x.recommended },
    { id: 'markdown', title: x.formatMarkdown, description: x.markdownFormatDescription, icon: FileText },
    { id: 'json', title: x.formatFhirJson, description: x.fhirJsonFormatDescription, icon: Braces, badge: x.advancedBadge },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{x.chooseFormatTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{x.chooseFormatDescription}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{x.currentData}</p>
          <p className="mt-0.5 text-sm font-semibold">{x.resourceCountLabel.replace('{count}', String(resourceCount))}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {includeImageAttachments ? x.imagesIncludedSummary : x.imagesExcludedSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          <Badge variant="outline" className={includePatientIdentifiers ? 'border-amber-400 text-amber-700 dark:text-amber-300' : 'text-teal-700 dark:text-teal-300'}>
            {includePatientIdentifiers ? <AlertTriangle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
            {includePatientIdentifiers ? x.identifiersIncludedBadge : x.identifiersMaskedBadge}
          </Badge>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onOpenSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            {x.adjust}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {formatOptions.map((option) => {
          const Icon = option.icon
          const selected = format === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFormat(option.id)}
              className={`relative rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary/40' : 'bg-card hover:border-muted-foreground/40 hover:bg-muted/20'}`}
            >
              {option.badge && (
                <Badge variant={option.id === 'pdf' ? 'default' : 'secondary'} className="absolute right-3 top-3 text-[0.625rem]">
                  {option.badge}
                </Badge>
              )}
              <Icon className={`mb-3 h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className="text-sm font-semibold">{option.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{option.description}</p>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">{x.selectedFile}</p>
            <p className="mt-0.5 truncate text-sm font-semibold">{selectedFilename}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {x.previewStats.replace('{count}', String(bundle.entry.length)).replace('{size}', formatByteSize(jsonBytes))}
            </p>
          </div>
          <Button type="button" size="lg" className="gap-2 sm:min-w-52" onClick={primaryAction}>
            {format === 'pdf' ? <FileDown className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {primaryLabel}
          </Button>
        </div>
        {jsonBytes > IPS_SIZE_WARN_BYTES && <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">{x.sizeWarning}</p>}
      </div>

      <div ref={printSourceRef} className="hidden"><MarkdownRenderer content={markdownBody} /></div>

      <Collapsible open={previewOpen} onOpenChange={setPreviewOpen} className="rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="h-12 w-full justify-between rounded-xl px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Eye className="h-4 w-4 text-muted-foreground" />
              {x.previewContent}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {format !== 'json' && (
              <div className="flex h-9 rounded-lg bg-muted/50 p-1">
                <Button type="button" size="sm" variant={markdownView === 'rendered' ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setMarkdownView('rendered')}>
                  <Eye className="mr-1 h-3.5 w-3.5" />{x.renderedPreview}
                </Button>
                <Button type="button" size="sm" variant={markdownView === 'source' ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setMarkdownView('source')}>
                  <Code2 className="mr-1 h-3.5 w-3.5" />{x.sourceView}
                </Button>
              </div>
            )}
            <Button type="button" size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => requestAction('copy')}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? x.copied : format === 'json' ? x.copyJson : x.copyMarkdown}
            </Button>
            {validation && (
              <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowChecks((value) => !value)}>
                {validation.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> : <XCircle className="h-4 w-4 text-destructive" />}
                {validation.ok ? x.validation.pass : x.validation.fail}
              </Button>
            )}
          </div>

          {showChecks && validation && (
            <ul className="mb-3 space-y-1 rounded-lg border bg-muted/20 p-3">
              {validation.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-xs">
                  {item.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                  <span className={item.ok ? 'text-muted-foreground' : 'text-destructive'}>{item.label}{!item.ok && item.detail ? ` - ${item.detail}` : ''}</span>
                </li>
              ))}
            </ul>
          )}

          {copyError && <p className="mb-2 text-xs text-destructive">{copyError}</p>}
          {format === 'json' ? (
            <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/30 p-3 text-[0.6875rem] leading-relaxed">{json}</pre>
          ) : markdownView === 'rendered' ? (
            <div className="max-h-[32rem] overflow-auto rounded-lg border bg-background p-4 text-sm [&_table]:w-max [&_table]:text-left [&_td]:border-t [&_td]:border-border/60 [&_td]:py-1.5 [&_td]:pr-6 [&_th]:whitespace-nowrap [&_th]:py-1.5 [&_th]:pr-6 [&_th]:font-medium [&_th]:text-muted-foreground">
              <MarkdownRenderer content={markdownBody} />
            </div>
          ) : (
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-[0.6875rem] leading-relaxed">{markdownBody}</pre>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent
          onCloseAutoFocus={() => {
            const action = confirmedActionRef.current
            confirmedActionRef.current = null
            if (action) performAction(action)
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{x.shareConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{x.shareConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmedActionRef.current = pendingAction; setPendingAction(null) }}>
              {x.shareConfirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
