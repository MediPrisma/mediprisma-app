// HtmlDocumentRenderer
// Renders a single HTML attachment (e.g. 健保存摺 出院病摘) inside the doc
// summary card. The base64 → text → DOMPurify pipeline runs lazily on
// expand so we don't pay the cost for documents the user never opens —
// a typical 健保存摺 dataset can carry many tens of discharge summaries.
//
// Differs from CompositionRenderer in that there is exactly ONE collapsible
// region per document (the whole HTML body) rather than a per-section
// accordion. That matches the source: a Composition has structured sections,
// a DocumentReference attachment is one self-contained document.
"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { sanitizeNarrative } from '../utils/sanitize-narrative'
import { decodeBase64Utf8 } from '../utils/base64'

/**
 * Pure content renderer for an HTML attachment — decode + sanitise pipeline
 * plus the `<div dangerouslySetInnerHTML>` mount, no wrapper chrome. Used
 * directly by DocumentDetailDialog so the dialog reader doesn't carry a
 * second "文件內容" accordion layer that already redundantly wraps the body
 * the user is reading. The card's inline accordion version still wraps
 * this body for the collapse-by-default behaviour.
 */
interface HtmlDocumentBodyProps {
  attachment: {
    contentType?: string
    data?: string
    url?: string
    title?: string
    size?: number
  }
  labels: {
    noContent: string
    externalUrl: string
  }
  /** Original-language excerpt attached to the clicked AI claim. */
  evidenceQuote?: string
  /** Navigation sequence; lets clicking the same citation highlight again. */
  highlightRequestKey?: number
}

interface TextPoint {
  /** Synthetic spaces between block elements have no backing text node. */
  node: Text | null
  offset: number
}

function normalizedTextWithPoints(root: HTMLElement): { text: string; points: TextPoint[] } {
  const points: TextPoint[] = []
  let text = ''
  let previousWasSpace = true

  const appendSpace = (node: Text | null = null, offset = 0) => {
    if (previousWasSpace || text.length === 0) return
    text += ' '
    points.push({ node, offset })
    previousWasSpace = true
  }
  const appendTextNode = (node: Text) => {
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset]
      if (/\s/u.test(character)) {
        appendSpace(node, offset)
        continue
      }
      const normalizedCharacter = character.toLocaleLowerCase('en-US')
      text += normalizedCharacter
      for (let i = 0; i < normalizedCharacter.length; i += 1) {
        points.push({ node, offset })
      }
      previousWasSpace = false
    }
  }

  // textContent does not insert separators between adjacent <p>/<div>/<td>
  // nodes, even though the canonical document reader (and what users see)
  // treats those boundaries as whitespace. Walk the DOM and add an unmapped
  // space at structural boundaries so a verified quote can span HTML blocks.
  const blockTags = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
    'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ])
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendTextNode(node as Text)
      return
    }
    if (!(node instanceof HTMLElement)) return
    const isBreak = node.tagName === 'BR'
    const isBlock = blockTags.has(node.tagName)
    if (isBreak || isBlock) appendSpace()
    if (!isBreak) node.childNodes.forEach(visit)
    if (isBlock) appendSpace()
  }
  root.childNodes.forEach(visit)

  return { text: text.trimEnd(), points: points.slice(0, text.trimEnd().length) }
}

function normalizedEvidenceQuote(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

function clearEvidenceMarks(root: HTMLElement): void {
  root.querySelectorAll('mark[data-document-evidence]').forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

function highlightEvidenceQuote(root: HTMLElement, quote: string): HTMLElement | null {
  clearEvidenceMarks(root)
  const needle = normalizedEvidenceQuote(quote)
  if (!needle) return null
  const { text, points } = normalizedTextWithPoints(root)
  const start = text.indexOf(needle)
  if (start < 0) return null
  const matchPoints = points.slice(start, start + needle.length)
  if (matchPoints.length === 0) return null

  const segments: Array<{ node: Text; start: number; end: number }> = []
  for (const point of matchPoints) {
    if (!point.node) continue
    const previous = segments[segments.length - 1]
    if (previous?.node === point.node) {
      previous.start = Math.min(previous.start, point.offset)
      previous.end = Math.max(previous.end, point.offset + 1)
    } else {
      segments.push({ node: point.node, start: point.offset, end: point.offset + 1 })
    }
  }

  for (const segment of [...segments].reverse()) {
    const range = document.createRange()
    range.setStart(segment.node, segment.start)
    range.setEnd(segment.node, segment.end)
    const mark = document.createElement('mark')
    mark.dataset.documentEvidence = 'true'
    mark.className = 'rounded-sm bg-amber-200 px-0.5 text-inherit ring-2 ring-amber-400/70 dark:bg-amber-500/35'
    range.surroundContents(mark)
  }
  return root.querySelector<HTMLElement>('mark[data-document-evidence]')
}

export function HtmlDocumentBody({
  attachment,
  labels,
  evidenceQuote,
  highlightRequestKey,
}: HtmlDocumentBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const sanitised = useMemo(() => {
    if (!attachment.data) return ''
    const decoded = decodeBase64Utf8(attachment.data)
    if (!decoded) return ''
    return sanitizeNarrative(decoded)
  }, [attachment.data])

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    if (!evidenceQuote) {
      clearEvidenceMarks(root)
      return
    }
    const timer = window.setTimeout(() => {
      const mark = highlightEvidenceQuote(root, evidenceQuote)
      if (mark && typeof mark.scrollIntoView === 'function') {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [evidenceQuote, highlightRequestKey, sanitised])

  // Only link out to real web URLs — attachment.url comes from an untrusted
  // imported bundle, so a `javascript:`/`data:` scheme must never become a
  // clickable href.
  const isExternal =
    !attachment.data && !!attachment.url && /^https?:\/\//i.test(attachment.url.trim())

  if (isExternal) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary underline"
      >
        {labels.externalUrl}
      </a>
    )
  }
  if (!sanitised) {
    return <div className="text-xs italic text-muted-foreground">{labels.noContent}</div>
  }
  // `table-layout: fixed` + the colgroup injected by sanitizeNarrative is
  // what actually forces tables to respect the container width. Without
  // table-fixed the browser sizes <table> by its cells' natural content
  // widths and silently ignores `max-width: 100%` when those widths sum
  // to more than the parent. The colgroup pins col 1 at 80px (label) and
  // lets the remaining columns share the rest. `break-words` + default
  // CJK wrapping handle any cell content that's still too long for its
  // column. `whitespace-pre-wrap` on <pre> preserves doctor-written line
  // breaks for the body sections the bridge originally shipped inside
  // <textarea> (stripped by DOMPurify, content kept).
  return (
    <div
      ref={bodyRef}
      className="prose prose-sm dark:prose-invert max-w-none break-words [&_table]:w-full [&_table]:table-fixed [&_table]:text-xs [&_table]:border-collapse [&_td]:border [&_td]:border-border/40 [&_td]:px-1.5 [&_td]:py-0.5 [&_td]:align-top [&_td]:break-words [&_th]:border [&_th]:border-border/40 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:font-medium [&_th]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
       
      dangerouslySetInnerHTML={{ __html: sanitised }}
    />
  )
}

interface HtmlDocumentRendererProps {
  attachment: {
    contentType?: string
    data?: string
    url?: string
    title?: string
    size?: number
  }
  /** Whether to expand the body by default. The card sets this to true when
   *  the dataset contains exactly one document, to save the user a click. */
  defaultExpanded?: boolean
  /** Navigation sequence that should open the body for a cited source. */
  forceExpandKey?: number
  /** Verbatim excerpt to scroll to and highlight after expansion. */
  evidenceQuote?: string
  /** Optional control rendered inside the trigger, just left of the ▼ chevron
   *  (e.g. the 向右展開 button). */
  rightControl?: ReactNode
  /** Labels for the empty / fallback states. */
  labels: {
    /** Header shown above the collapsible HTML body. */
    bodyHeader: string
    /** Shown when decode + sanitisation produce no visible content. */
    noContent: string
    /** Shown for url-only attachments (no inline data) — bridge doesn't ship
     *  these today but the FHIR spec allows them. */
    externalUrl: string
  }
}

export function HtmlDocumentRenderer({
  attachment,
  defaultExpanded = false,
  forceExpandKey,
  evidenceQuote,
  rightControl,
  labels,
}: HtmlDocumentRendererProps) {
  // Track open state ourselves so we can defer the decode + sanitise pipeline
  // until the user actually expands the document. For a typical bundle with
  // ~tens of discharge summaries this turns a multi-MB eager parse into
  // sub-100KB per-open work.
  const [hasOpened, setHasOpened] = useState(defaultExpanded)
  const [openValue, setOpenValue] = useState(defaultExpanded ? 'body' : '')

  useEffect(() => {
    if (forceExpandKey === undefined) return
    const timer = window.setTimeout(() => {
      setHasOpened(true)
      setOpenValue('body')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [forceExpandKey])

  return (
    <Accordion
      type="single"
      collapsible
      value={openValue}
      className="space-y-1.5"
      onValueChange={(v) => {
        if (v === 'body') setHasOpened(true)
        setOpenValue(v)
      }}
    >
      <AccordionItem value="body" className="border-0">
        {/* AccordionTrigger ships its own ChevronDown that auto-rotates via
            `[&[data-state=open]>svg]:rotate-180` (see components/ui/accordion).
            We use the default chevron so the open/closed state is visually
            unambiguous — important because the title is a neutral noun
            ("文件內容") rather than an action verb. */}
        <AccordionTrigger className="px-0 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:no-underline">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <span className="truncate font-medium">{labels.bodyHeader}</span>
          </div>
          {rightControl && <span className="mr-1 shrink-0">{rightControl}</span>}
        </AccordionTrigger>
        <AccordionContent className="px-0 pb-2">
          {hasOpened && (
            <HtmlDocumentBody
              attachment={attachment}
              labels={{ noContent: labels.noContent, externalUrl: labels.externalUrl }}
              evidenceQuote={evidenceQuote}
              highlightRequestKey={forceExpandKey}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
