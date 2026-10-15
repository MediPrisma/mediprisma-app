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
        tag.system === 'urn:wildcatch:source' && tag.code === 'vghtpe-outpatient-supplement')
        && d.type?.text === '門診 SOAP 與醫囑',
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

// ---------------------------------------------------------------------------
// Key-section extraction
//
// Discharge summaries dominate the AI context. Most of their bulk is routine
// and already available to the model from structured FHIR (labs, imaging,
// vitals) or is clinically irrelevant to a first-visit summary (physical
// examination, review of systems, nursing notes, the administrative header of
// the NHI 出院病摘 form). Sending only the clinically dense sections keeps a
// multi-admission chart inside a small clinical-token cap.
//
// This is deliberately CONSERVATIVE. A section is only recognised when its
// header matches a known vocabulary entry; anything else is left attached to
// the section it follows, and a document whose format is not confidently
// recognised is sent whole. Extraction NEVER runs for a manual (custom)
// document selection — see `formatDocumentsSection` / `documentTextMode`.
// ---------------------------------------------------------------------------

/** Sections kept, in the order they are emitted. */
type KeySectionCategory =
  | 'diagnosis'
  | 'chiefComplaint'
  | 'hospitalCourse'
  | 'procedure'
  | 'pathology'
  | 'dischargeMedication'
  | 'plan'

/** Recognised sections that are dropped whole. */
type OmittedSectionCategory =
  | 'presentIllness'
  | 'physicalExam'
  | 'reviewOfSystems'
  | 'laboratory'
  | 'imaging'
  | 'specialExam'
  | 'nursing'
  | 'administrative'

const KEY_SECTION_ORDER: KeySectionCategory[] = [
  'diagnosis',
  'chiefComplaint',
  'hospitalCourse',
  'procedure',
  'pathology',
  'dischargeMedication',
  'plan',
]

const KEY_SECTION_CATEGORIES = new Set<string>(KEY_SECTION_ORDER)

/**
 * Header vocabulary, matched against a normalized label (NFKC, lower-cased,
 * punctuation/whitespace removed). FIRST match wins, so more specific entries
 * come first. Prefix matching is what makes real headers work
 * (理學檢查發現 → 理學檢查, "Discharge Medications (7 days)" → discharge
 * medication); the label-length cap below is what stops a prose sentence from
 * being mistaken for a header.
 */
const SECTION_HEADER_RULES: Array<{
  category: KeySectionCategory | OmittedSectionCategory
  pattern: RegExp
  /**
   * A generic word that is also used as a SUB-heading inside a report body
   * ("Impression:", "Recommendation:", "Procedure:" in an endoscopy or
   * radiology report). It may open a section of its own, but never inside a
   * section that is being dropped — otherwise a whole imaging dump is promoted
   * back into the context under a one-word heading.
   */
  weak?: boolean
}> = [
  // --- discharge / final / admission diagnosis, cancer stage ---------------
  { category: 'diagnosis', pattern: /^(discharge|final|principal|primary|admission|admitting|provisional|tentative|clinical)(diagnos[ei]s|impression)/ },
  { category: 'diagnosis', pattern: /^diagnos[ei]s/ },
  { category: 'diagnosis', pattern: /^impression/, weak: true },
  { category: 'diagnosis', pattern: /^(cancer|tumou?r)stag(e|ing)/ },
  { category: 'diagnosis', pattern: /^stag(e|ing)$/, weak: true },
  { category: 'diagnosis', pattern: /^(出院|入院|住院|最後|最終|主要|臨床)(診斷|臆斷|印象)/ },
  { category: 'diagnosis', pattern: /^(診斷|臆斷)/ },
  { category: 'diagnosis', pattern: /^癌症(期別|分期)/ },
  // --- chief complaint ----------------------------------------------------
  { category: 'chiefComplaint', pattern: /^(chief|presenting)(complaint|concern)/ },
  { category: 'chiefComplaint', pattern: /^cc$/, weak: true },
  { category: 'chiefComplaint', pattern: /^reasonfor(admission|visit|encounter)/ },
  { category: 'chiefComplaint', pattern: /^(主訴|入院原因|就診原因)/ },
  // --- hospital course / complications ------------------------------------
  { category: 'hospitalCourse', pattern: /^(brief)?(hospital|clinical|inpatient|treatment|admission)course/ },
  { category: 'hospitalCourse', pattern: /^course/, weak: true },
  { category: 'hospitalCourse', pattern: /^(summaryof)?(hospitalisation|hospitalization)/ },
  { category: 'hospitalCourse', pattern: /^complication/, weak: true },
  { category: 'hospitalCourse', pattern: /^(住院|入院|治療|臨床)*(治療)?經過/ },
  { category: 'hospitalCourse', pattern: /^(合併症|併發症)/ },
  // --- operations / procedures --------------------------------------------
  { category: 'procedure', pattern: /^(major|invasive|significant)(operation|surgery|surgical|procedure)/ },
  { category: 'procedure', pattern: /^(operation|surgery|surgical|procedure)/, weak: true },
  { category: 'procedure', pattern: /^(手術|開刀|處置)/ },
  // --- pathology ----------------------------------------------------------
  { category: 'pathology', pattern: /^(surgical|histo)patholog/ },
  { category: 'pathology', pattern: /^patholog/, weak: true },
  { category: 'pathology', pattern: /^(病理|組織病理)/ },
  // --- discharge medication (before the generic discharge-plan entries) ----
  { category: 'dischargeMedication', pattern: /^(discharge|dc)(medication|medicine|drug|med)/ },
  { category: 'dischargeMedication', pattern: /^medication(sat|son)?discharge/ },
  { category: 'dischargeMedication', pattern: /^(出院|帶回|帶出)(用藥|藥物|藥品|帶藥|處方|medication)/ },
  // --- plan / follow-up / discharge instructions --------------------------
  { category: 'plan', pattern: /^assessment(and)?plan$/ },
  { category: 'plan', pattern: /^assessment$/, weak: true },
  { category: 'plan', pattern: /^discharge(plan|instruction|recommendation|advice|disposition|followup|follow)/ },
  { category: 'plan', pattern: /^(plan|instruction|recommendation|advice|disposition|followup|follow)/, weak: true },
  { category: 'plan', pattern: /^condition(at|on)discharge/ },
  { category: 'plan', pattern: /^(出院|離院)(指示|醫囑|計畫|計劃|準備|狀況|情形|建議|護理|衛教|後追蹤)/ },
  { category: 'plan', pattern: /^(追蹤|後續)(治療|計畫|計劃|門診)?/, weak: true },
  // --- dropped: history ---------------------------------------------------
  { category: 'presentIllness', pattern: /^(historyof)?presentillness/ },
  { category: 'presentIllness', pattern: /^hpi$/ },
  { category: 'presentIllness', pattern: /^(brief|past|personal|family|social|medical|surgical|medication|smoking|drinking)?histor(y|ies)/ },
  { category: 'presentIllness', pattern: /^allerg/ },
  { category: 'presentIllness', pattern: /^(病史|現病史|過去病史|過去史|家族史|個人史|過敏史|藥物過敏|藥物史|抽菸|吸菸)/ },
  // --- dropped: physical examination / vitals -----------------------------
  { category: 'physicalExam', pattern: /^(physical|admission|initial|general|on)?exam(ination)?/ },
  { category: 'physicalExam', pattern: /^pe$/ },
  { category: 'physicalExam', pattern: /^vital(sign)?/ },
  { category: 'physicalExam', pattern: /^(理學檢查|身體檢查|體格檢查|生命徵象|生命跡象)/ },
  // --- dropped: review of systems -----------------------------------------
  { category: 'reviewOfSystems', pattern: /^reviewofsystem/ },
  { category: 'reviewOfSystems', pattern: /^ros$/ },
  { category: 'reviewOfSystems', pattern: /^系統回顧/ },
  // --- dropped: laboratory data -------------------------------------------
  { category: 'laboratory', pattern: /^lab(orator(y|ies))?(data|result|finding|exam|studie|study|test)?/ },
  { category: 'laboratory', pattern: /^(檢驗|實驗室|化驗|生化檢查|血液檢查)/ },
  // --- dropped: imaging ---------------------------------------------------
  { category: 'imaging', pattern: /^(imag(e|ing)|radiolog|sonograph|echograph)/ },
  { category: 'imaging', pattern: /^(醫療影像|影像|放射|超音波)/ },
  // --- dropped: other instrumental studies --------------------------------
  { category: 'specialExam', pattern: /^(special|other|ancillary|diagnostic)(exam|study|studies|investigation|procedure)/ },
  { category: 'specialExam', pattern: /^(特殊檢查|其他檢查|檢查報告)/ },
  // --- dropped: nursing ---------------------------------------------------
  { category: 'nursing', pattern: /^nursing/ },
  { category: 'nursing', pattern: /^護理/ },
  // --- dropped: administrative form fields --------------------------------
  { category: 'administrative', pattern: /^(patient)?name$/ },
  { category: 'administrative', pattern: /^(medical)?record(no|number)/ },
  { category: 'administrative', pattern: /^(chart|mrn|ward|bed|gender|sex|age|birth|dob|department|attending|admitted|discharged)/ },
  { category: 'administrative', pattern: /^(admission|discharge|admit)(date|time)/ },
  { category: 'administrative', pattern: /^(病患|病人)?姓名/ },
  { category: 'administrative', pattern: /^(病歷號|身分證|出生日期|性別|年齡|病房|床號|科別|主治醫師|住院醫師|醫事人員|醫療機構|文件保管|轉入醫院|轉出醫院|列印|記錄日期)/ },
  { category: 'administrative', pattern: /^(住院|入院|出院)(日期|時間|科別)/ },
]

/** Header labels longer than this are prose, not a section header. */
const MAX_HEADER_LABEL_LENGTH = 28

/** Below this size a document is not worth reducing (and the guards below
 *  become statistically meaningless). */
const MIN_KEY_SECTION_SOURCE_LENGTH = 300

/** At least this share of the document must be recognised, or the whole
 *  document is sent — an unknown layout must never be silently cut. */
const MIN_RECOGNIZED_COVERAGE = 0.3

/** At least this many recognised headers, for the same reason. */
const MIN_RECOGNIZED_HEADERS = 2

/** Extraction only makes sense when at least one high-value section survived. */
const REQUIRED_KEY_SECTIONS: KeySectionCategory[] = ['diagnosis', 'hospitalCourse', 'plan']

/**
 * What the omission marker calls each dropped section. Fixed labels, never the
 * source header line: a header line can carry patient-identifying content
 * (`病患姓名：陳○明`), and a marker must not smuggle back what was dropped.
 */
const OMITTED_SECTION_LABELS: Partial<
  Record<KeySectionCategory | OmittedSectionCategory | 'preamble', string>
> = {
  preamble: 'document header',
  administrative: 'administrative fields',
  presentIllness: 'history',
  physicalExam: 'physical exam',
  reviewOfSystems: 'review of systems',
  laboratory: 'labs',
  imaging: 'imaging reports',
  specialExam: 'other studies',
  nursing: 'nursing notes',
}

/** Emitted on the document header line when the body was reduced. Absence of
 *  this line means the document body is the complete note. */
export const DOCUMENT_KEY_SECTIONS_NOTICE =
  'Document text: key sections only (routine and administrative sections omitted)'

export function documentKeySectionsOmissionMarker(labels: string[]): string {
  return `[sections omitted: ${labels.join(', ')}]`
}

function normalizeHeaderLabel(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * The normalized label a line would carry as a section header, or null when
 * the line cannot be one. Handles the three real shapes: a bare header line
 * (`主訴`), a `header: content` line, and the NHI form's table rows, which
 * `stripHtmlToText` renders as `header\tcontent`.
 */
function headerLabelOf(line: string): string | null {
  const firstCell = line.split('\t')[0]
  const colonIndex = firstCell.search(/[:：]/)
  const label = colonIndex >= 0 ? firstCell.slice(0, colonIndex) : firstCell
  const normalized = normalizeHeaderLabel(label)
  if (!normalized || normalized.length > MAX_HEADER_LABEL_LENGTH) return null
  return normalized
}

function ruleFor(normalizedLabel: string): (typeof SECTION_HEADER_RULES)[number] | null {
  for (const rule of SECTION_HEADER_RULES) {
    if (rule.pattern.test(normalizedLabel)) return rule
  }
  return null
}

function isKeptCategory(category: KeySectionCategory | OmittedSectionCategory | null): boolean {
  return category !== null && KEY_SECTION_CATEGORIES.has(category)
}

interface DocumentSectionSlice {
  /** null for the preamble that precedes the first recognised header. */
  category: KeySectionCategory | OmittedSectionCategory | null
  /** Original header line, used verbatim in the omission marker. */
  headerText: string
  lines: string[]
}

export interface DocumentKeySectionsResult {
  /** Reduced body, or the untouched input when extraction did not apply. */
  text: string
  /** True only when the body was actually reduced. */
  extracted: boolean
  /** Source header text of the sections that were dropped. */
  omittedSections: string[]
  /**
   * The note's 病史 / history sections, truncated, when the caller asked for
   * them via `keepHistoryChars`. Returned SEPARATELY from `text` so the caller
   * can give the history its own budget: the body fit cuts out the middle of
   * whatever it is handed, and history placed inside it would be the first
   * thing to disappear.
   */
  historyText?: string
}

export interface DocumentKeySectionsOptions {
  /**
   * Keep the recognised history sections (病史 / 過去病史 / HPI / 家族史 …),
   * truncated to this many characters in total, instead of dropping them.
   *
   * WHY it is optional rather than always on: for a medical/surgical patient
   * the history repeats what the structured problem, medication and procedure
   * lists already carry, and it is the largest block in the note. For an
   * oncology patient it is the ONLY place the treatment narrative (staging,
   * regimen, cycle dates) exists, so the overview lane asks for it and pays
   * for it out of its own budget.
   */
  keepHistoryChars?: number
}

/** Marks a history block that was cut to fit `keepHistoryChars`. */
export const DOCUMENT_HISTORY_TRUNCATION_MARKER = '[…病史 truncated]'

/**
 * Reduce a clinical document to its clinically dense sections.
 *
 * Sections are kept or dropped WHOLE — never cut in the middle — and a single
 * marker line names what was elided. When the layout cannot be recognised with
 * confidence the input is returned unchanged.
 */
export function extractDocumentKeySections(
  text: string,
  options: DocumentKeySectionsOptions = {},
): DocumentKeySectionsResult {
  const historyChars = Math.max(0, Math.floor(options.keepHistoryChars ?? 0))
  const unchanged = (): DocumentKeySectionsResult => ({ text, extracted: false, omittedSections: [] })
  if (!text || text.length < MIN_KEY_SECTION_SOURCE_LENGTH) return unchanged()

  const lines = text.split('\n')
  const slices: DocumentSectionSlice[] = [{ category: null, headerText: '', lines: [] }]
  let recognizedHeaders = 0
  for (const line of lines) {
    const trimmed = line.trim()
    const label = trimmed ? headerLabelOf(trimmed) : null
    const rule = label ? ruleFor(label) : null
    const current = slices[slices.length - 1]
    // A one-word heading inside a report we are dropping ("Impression:" in a
    // radiology report) is part of that report, not a new top-level section.
    const suppressed = !!rule?.weak
      && current.category !== null
      && !isKeptCategory(current.category)
    if (rule && !suppressed) {
      recognizedHeaders += 1
      slices.push({ category: rule.category, headerText: trimmed, lines: [line] })
      continue
    }
    // Unrecognised text stays attached to the section it follows, so an
    // unknown header inside a kept section is kept with it rather than lost.
    slices[slices.length - 1].lines.push(line)
  }
  if (recognizedHeaders < MIN_RECOGNIZED_HEADERS) return unchanged()

  const sizeOf = (slice: DocumentSectionSlice): number =>
    slice.lines.reduce((total, line) => total + line.length + 1, 0)
  const totalSize = slices.reduce((total, slice) => total + sizeOf(slice), 0)
  if (totalSize === 0) return unchanged()
  const recognizedSize = slices
    .filter((slice) => slice.category !== null)
    .reduce((total, slice) => total + sizeOf(slice), 0)
  if (recognizedSize / totalSize < MIN_RECOGNIZED_COVERAGE) return unchanged()

  const kept = slices.filter((slice) => isKeptCategory(slice.category))
  if (!kept.some((slice) => REQUIRED_KEY_SECTIONS.includes(slice.category as KeySectionCategory))) {
    return unchanged()
  }
  // History is neither kept in the body nor counted as an omission when the
  // caller asked for it: it leaves through `historyText` instead.
  const historySlices = historyChars > 0
    ? slices.filter((slice) => slice.category === 'presentIllness')
    : []
  const dropped = slices.filter((slice) => !kept.includes(slice) && !historySlices.includes(slice))
  const droppedSize = dropped.reduce((total, slice) => total + sizeOf(slice), 0)
  // Nothing meaningful to remove — send the note as written rather than
  // reordering it for no benefit.
  if (droppedSize === 0) return unchanged()

  const orderedKept = KEY_SECTION_ORDER.flatMap((category) =>
    kept.filter((slice) => slice.category === category),
  )
  const body = orderedKept
    .map((slice) => slice.lines.join('\n').trim())
    .filter(Boolean)
    .join('\n')
  if (!body.trim()) return unchanged()

  const omittedSections: string[] = []
  for (const slice of dropped) {
    if (slice.lines.every((line) => !line.trim())) continue
    const label = OMITTED_SECTION_LABELS[slice.category ?? 'preamble']
    if (label && !omittedSections.includes(label)) omittedSections.push(label)
  }

  const historyBody = historySlices
    .map((slice) => slice.lines.join('\n').trim())
    .filter(Boolean)
    .join('\n')
  const historyText = historyBody
    ? historyBody.length > historyChars
      ? `${historyBody.slice(0, historyChars)}${DOCUMENT_HISTORY_TRUNCATION_MARKER}`
      : historyBody
    : undefined

  return {
    text: omittedSections.length
      ? `${body}\n${documentKeySectionsOmissionMarker(omittedSections)}`
      : body,
    extracted: true,
    omittedSections,
    ...(historyText ? { historyText } : {}),
  }
}

export function formatDocumentsSection(
  docs: ClinicalDocumentRef[],
  documentTokenBudget?: number,
): ClinicalContextSection | null {
  if (docs.length === 0) return null
  const escapeBoundaryToken = (value: string): string =>
    value.replace(/<(BEGIN_DOCUMENT|END_DOCUMENT)\b/gi, '&lt;$1')
  // Short notes consume only what they need, leaving unused shares available
  // to longer summaries instead of unnecessarily truncating their middle.
  const budgets = new Map<ClinicalDocumentRef, number>()
  if (documentTokenBudget !== undefined) {
    const costs = docs.map(doc => ({ doc, cost: estimateTokens(doc.text || '[No document body was available]') }))
      .sort((a, b) => a.cost - b.cost)
    let remaining = Math.max(0, documentTokenBudget)
    costs.forEach(({ doc, cost }, index) => {
      const share = Math.max(1, Math.floor(remaining / (costs.length - index)))
      const allocation = Math.min(cost, share)
      budgets.set(doc, allocation)
      remaining = Math.max(0, remaining - allocation)
    })
  }
  const items = docs.map((d) => {
    const date = d.date ? new Date(d.date).toLocaleDateString() : ''
    const header = `${d.title}${date ? ` (${date})` : ''}`
    const bodyText = d.text || '[No document body was available]'
    const body = escapeBoundaryToken(
      documentTokenBudget === undefined
        ? bodyText
        : fitDocumentTextToTokenBudget(bodyText, budgets.get(d) ?? 0),
    )
    // Only a sanitized FHIR id is allowed in the delimiter. Document titles
    // are untrusted source text and must not be able to close or mutate the
    // boundary by injecting quotes / angle brackets into an attribute.
    const boundaryId = d.id.replace(/[^A-Za-z0-9.-]/g, '_') || 'unknown'
    return `<BEGIN_DOCUMENT id="${boundaryId}">\nDocument title: ${escapeBoundaryToken(header)}\n${body}\n<END_DOCUMENT id="${boundaryId}">`
  })
  return { title: 'Documents', items }
}
