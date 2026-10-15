// Clinical documents — a unified, i18n-free list over BOTH FHIR sources the
// app surfaces as "文件": Composition (IPS-style, narrative in section.text.div)
// and DocumentReference (健保存摺 discharge summaries — a base64 HTML attachment).
//
// SINGLE SOURCE OF TRUTH for the AI-context document text AND the data-selection
// checkbox list, so the document ids the UI ticks match exactly what the context
// builder includes. The feature layer (DocumentSummaryCard) keeps its own
// i18n-rich adapter for pretty display; this stays in core (no i18n / no UI).
import type { ClinicalContextSection } from '../interfaces/data-category.interface'
import type {
  CompositionEntity,
  DocumentReferenceEntity,
} from '../entities/clinical-data.entity'
import { estimateTokens } from '@/src/shared/utils/token-estimator'

/** LOINC 18842-5 = 出院病摘 (discharge summary). */
export const DISCHARGE_SUMMARY_LOINC = '18842-5'

export type DocumentMode = 'latestAdmission' | 'recentAdmissions' | 'all' | 'custom'

/** How many admissions 'recentAdmissions' mode includes. */
export const RECENT_ADMISSIONS_COUNT = 3

export interface ClinicalDocumentRef {
  id: string
  date?: string
  title: string
  isDischargeSummary: boolean
  isOutpatientSupplement?: boolean
  /** Plain-text body for the AI context (HTML/XHTML stripped). */
  text: string
}

interface DocumentSource {
  compositions?: CompositionEntity[]
  documentReferences?: DocumentReferenceEntity[]
}

export function stripHtmlToText(html: string): string {
  return html
    // Drop <style>/<script>/<head> bodies entirely — their contents (CSS/JS)
    // are not document text and otherwise leak in as garbage.
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<\/table>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function hasDischargeLoinc(coding?: Array<{ code?: string }>): boolean {
  return (coding ?? []).some((c) => c.code === DISCHARGE_SUMMARY_LOINC)
}

export function decodeBase64(data?: string): string {
  if (!data) return ''
  try {
    if (typeof atob !== 'undefined') {
      // atob yields a Latin-1 binary string; the bridge encodes UTF-8 (Chinese
      // discharge summaries), so re-decode the bytes as UTF-8 — otherwise every
      // multibyte char turns to mojibake (é·åº…).
      const binary = atob(data)
      if (typeof TextDecoder !== 'undefined') {
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
        return new TextDecoder('utf-8').decode(bytes)
      }
      return binary
    }
    // Node / SSR fallback
    return Buffer.from(data, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

// Decoding + HTML-stripping a discharge summary is expensive, and
// listClinicalDocuments is invoked MANY times per UI interaction (several
// consumers × React re-renders × StrictMode double-invoke). Cache the derived
// text per resource object so each document is decoded at most once per bundle,
// regardless of how often it gets re-listed — this is what keeps the
// data-selection checkbox responsive on patients with many discharge summaries.
// Cache by resource object identity, never by FHIR id. Resource ids are scoped
// to one FHIR base and can repeat after patient/server/bundle switches.
const decodedTextCache = new WeakMap<object, string>()

function compositionText(c: CompositionEntity): string {
  const hit = decodedTextCache.get(c as object)
  if (hit !== undefined) return hit
  const documentNarrative = c.text?.div ? stripHtmlToText(c.text.div) : ''
  const sectionNarratives = (c.section ?? [])
    .map((s) => {
      const t = s.text?.div ? stripHtmlToText(s.text.div) : ''
      if (!t) return ''
      return s.title ? `${s.title}:\n${t}` : t
    })
    .filter(Boolean)
    .join('\n\n')
  const result = [documentNarrative, sectionNarratives].filter(Boolean).join('\n\n')
  decodedTextCache.set(c as object, result)
  return result
}

function documentReferenceText(d: DocumentReferenceEntity): string {
  const hit = decodedTextCache.get(d as object)
  if (hit !== undefined) return hit
  const attachmentTexts = (d.content ?? []).map((content, index) => {
    const att = content.attachment
    const ct = att?.contentType?.toLowerCase() ?? ''
    const label = att?.title || `Attachment ${index + 1}`
    if (att?.data && (ct.includes('html') || ct.includes('text') || ct.includes('xml') || !ct)) {
      const decoded = decodeBase64(att.data)
      return decoded.trim()
        ? `${label}:\n${stripHtmlToText(decoded)}`
        : `${label}: [base64 attachment could not be decoded]`
    }
    if (att?.data) {
      return `${label}: [binary attachment not decoded; contentType=${ct || 'unknown'}; size=${att.size ?? 'unknown'}]`
    }
    if (att?.url) {
      // Do not copy a possibly signed/identifying URL into a cloud prompt. Make
      // the missing body explicit so it cannot be mistaken for an empty note.
      return `${label}: [URL-backed attachment not resolved; contentType=${ct || 'unknown'}]`
    }
    return `${label}: [attachment has no inline data or URL]`
  })
  const result = attachmentTexts.filter(Boolean).join('\n\n') || d.description || ''
  decodedTextCache.set(d as object, result)
  return result
}

/** All documents (Composition + DocumentReference), newest-first. */
export function listClinicalDocuments(data?: DocumentSource | null): ClinicalDocumentRef[] {
  if (!data) return []
  const out: ClinicalDocumentRef[] = []
  for (const c of data.compositions ?? []) {
    let textCache: string | undefined
    out.push({
      id: c.id,
      date: c.date,
      title: c.title || c.type?.text || c.type?.coding?.[0]?.display || 'Document',
      isDischargeSummary: hasDischargeLoinc(c.type?.coding),
      // Lazy: decode/HTML-strip is heavy and ONLY the AI-context formatter reads
      // it (for SELECTED docs). The checklist + count badges must not trigger it,
      // or every render re-decodes all documents — the data-selection lag.
      get text() { return (textCache ??= compositionText(c)) },
    })
  }
  for (const d of data.documentReferences ?? []) {
    const att = d.content?.[0]?.attachment
    let textCache: string | undefined
    out.push({
      id: d.id,
      // Prefer the encounter period start (admission date) over
      // DocumentReference.date: the NHI 健保存摺 bridge sets `date` to a
      // registration timestamp that is often shared across a batch (so it
      // clusters — e.g. many docs all showing the same day) and doesn't match
      // the real admission shown in the 文件 panel. The period is the meaningful,
      // distinct date and keeps both views consistent.
      date: d.context?.period?.start ?? d.date,
      title: d.type?.text || d.type?.coding?.[0]?.display || att?.title || 'Document',
      isDischargeSummary: hasDischargeLoinc(d.type?.coding),
      isOutpatientSupplement: d.meta?.tag?.some((tag) =>
        tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement'),
      get text() { return (textCache ??= documentReferenceText(d)) },
    })
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

/**
 * The documents to actually include, given the user's mode + custom id list.
 * - latestAdmission  → the single most recent 出院病摘 (fallback: latest doc)
 * - recentAdmissions → the most recent N 出院病摘 (fallback: N latest docs) —
 *                      covers a multi-admission treatment course without dumping
 * - all              → every document
 * - custom           → exactly the ticked ids
 * Input is assumed newest-first (as `listClinicalDocuments` returns).
 */
export function resolveSelectedDocuments(
  docs: ClinicalDocumentRef[],
  mode: DocumentMode,
  ids: string[],
): ClinicalDocumentRef[] {
  if (mode === 'all') return docs
  if (mode === 'custom') {
    const set = new Set(ids)
    return docs.filter((d) => set.has(d.id))
  }
  // The importer has already selected the latest visit per physician. Keep
  // that outpatient context together; explicit custom selections still win.
  const includeSupplement = (selected: ClinicalDocumentRef[]) => docs.filter((doc) =>
    doc.isOutpatientSupplement || selected.includes(doc))
  if (mode === 'recentAdmissions') {
    const discharges = docs.filter((d) => d.isDischargeSummary)
    const pool = discharges.length ? discharges : docs
    return includeSupplement(pool.slice(0, RECENT_ADMISSIONS_COUNT))
  }
  // latestAdmission
  const discharge = docs.find((d) => d.isDischargeSummary)
  if (discharge) return includeSupplement([discharge])
  return includeSupplement(docs.length ? [docs[0]] : [])
}

export const DOCUMENT_CONTEXT_OMISSION_MARKER =
  '\n[... middle of document omitted to fit the selected model context window ...]\n'

/**
 * Preserve both the start and end of a long clinical document. Discharge
 * diagnoses/history are commonly near the beginning, while discharge plans
 * and follow-up instructions are commonly near the end.
 */
export function fitDocumentTextToTokenBudget(text: string, maxTokens: number): string {
  if (!text || estimateTokens(text) <= maxTokens) return text
  const markerTokens = estimateTokens(DOCUMENT_CONTEXT_OMISSION_MARKER)
  if (maxTokens <= markerTokens) {
    let prefix = DOCUMENT_CONTEXT_OMISSION_MARKER.trim()
    while (prefix && estimateTokens(prefix) > maxTokens) {
      prefix = prefix.slice(0, Math.floor(prefix.length * 0.75))
    }
    return prefix
  }

  let low = 0
  let high = text.length
  let best = DOCUMENT_CONTEXT_OMISSION_MARKER.trim()
  while (low <= high) {
    const keptCharacters = Math.floor((low + high) / 2)
    const headCharacters = Math.ceil(keptCharacters / 2)
    const tailCharacters = keptCharacters - headCharacters
    const candidate = `${text.slice(0, headCharacters)}${DOCUMENT_CONTEXT_OMISSION_MARKER}${
      tailCharacters > 0 ? text.slice(-tailCharacters) : ''
    }`
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate
      low = keptCharacters + 1
    } else {
      high = keptCharacters - 1
    }
  }
  return best
}

export function formatDocumentsSection(
  docs: ClinicalDocumentRef[],
  documentTokenBudget?: number,
): ClinicalContextSection | null {
  if (docs.length === 0) return null
  const escapeBoundaryToken = (value: string): string =>
    value.replace(/<(BEGIN_DOCUMENT|END_DOCUMENT)\b/gi, '&lt;$1')
  const perDocumentBudget = documentTokenBudget === undefined
    ? undefined
    : Math.max(1, Math.floor(documentTokenBudget / docs.length))
  const items = docs.map((d) => {
    const date = d.date ? new Date(d.date).toLocaleDateString() : ''
    const header = `${d.title}${date ? ` (${date})` : ''}`
    const bodyText = d.text || '[No document body was available]'
    const body = escapeBoundaryToken(
      perDocumentBudget === undefined
        ? bodyText
        : fitDocumentTextToTokenBudget(bodyText, perDocumentBudget),
    )
    // Only a sanitized FHIR id is allowed in the delimiter. Document titles
    // are untrusted source text and must not be able to close or mutate the
    // boundary by injecting quotes / angle brackets into an attribute.
    const boundaryId = d.id.replace(/[^A-Za-z0-9.-]/g, '_') || 'unknown'
    return `<BEGIN_DOCUMENT id="${boundaryId}">\nDocument title: ${escapeBoundaryToken(header)}\n${body}\n<END_DOCUMENT id="${boundaryId}">`
  })
  return { title: 'Documents', items }
}
