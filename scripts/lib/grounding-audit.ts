// Grounding audit for AI summary / safety output — the "second pass" that the
// citation-resolution check (validate-demo-snapshots) does NOT do: it checks
// that claims are grounded in the ACTUAL bundle, not merely that cited keys
// resolve. Catches the hallucination classes we hit in practice:
//   - fabricated tests: naming an 內視鏡 / 心臟超音波 / CT that isn't in the data
//   - positional cross-refs (上述/下述) between separate UI fields
//   - citation relevance: a renal claim citing the chest X-ray, a polyp citing
//     an ultrasound, a valve citing the ECG
//
// Deterministic and record-grounded. Used by scripts/validate-demo-snapshots.ts
// and available to the offline snapshot generator as a validation gate.
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import { listClinicalDocuments } from '@/src/core/utils/clinical-documents.utils'

interface CatEntry {
  key: string
  display?: string
  resourceType?: string
  resourceId?: string
  getContentText?: () => string
}

interface DocumentEvidenceEntry {
  source?: string
  quote?: string
}

// Examination/report words that must be BACKED by a matching report in the
// bundle. Keyed on the term; a term is "allowed" only if it appears in the
// bundle text at all (so if the record genuinely has a CT report, 電腦斷層/CT
// claims are fine).
const TEST_TERMS = ['內視鏡', '胃鏡', '大腸鏡', '心臟超音波', 'echocardiog', '切片', 'biopsy', 'MRI', '磁振造影']
const POSITIONAL = /上述|下述|如上|如下|as above|as below/
// A test named alongside a recommendation verb is being ARRANGED, not asserted
// as already-done — e.g. 「安排心臟超音波」 is legitimate clinical advice, only
// 「內視鏡報告顯示…」 is a fabrication. Skip the fabricated-test flag when the
// span recommends the test rather than citing its result.
const RECOMMEND_VERB = /安排|建議|考慮|轉介|排程|可做|應做|需做|接受|arrange|schedule|order|consider|recommend|refer/i

/** A span "fabricates" a test only if the term is absent from the bundle AND
 *  the span is asserting it as done (no recommendation verb present). */
function fabricatedTests(text: string, presentTerms: Set<string>): string[] {
  if (RECOMMEND_VERB.test(text)) return []
  return TEST_TERMS.filter((t) => text.includes(t) && !presentTerms.has(t))
}

export interface GroundingAuditInput {
  /**
   * Searchable evidence in the selected AI scope. This includes structured
   * records plus decoded plain text from inline clinical documents.
   */
  clinicalEvidenceText: string
  /** Catalog entries, for citation-relevance lookups. */
  catalog: CatEntry[]
}

/**
 * Build the same free-text evidence corpus the checker needs from the already
 * scoped clinical data. DocumentReference attachments are Base64-decoded and
 * HTML-stripped by the application's canonical document reader; their prose
 * remains free text and is not converted into inferred diagnoses or events.
 */
export function buildGroundingAuditInput(
  clinicalData: Partial<ClinicalDataCollection>,
  catalog: CatEntry[],
): GroundingAuditInput {
  const documents = listClinicalDocuments(clinicalData)
  const documentTextById = new Map(documents.map((document) => [document.id, document.text]))
  const decodedDocuments = documents
    .map((document) => `${document.title}\n${document.text}`)
    .join('\n\n')
  return {
    clinicalEvidenceText: `${JSON.stringify(clinicalData)}\n${decodedDocuments}`,
    catalog: catalog.map((entry) => {
      const documentText = entry.resourceId
        ? documentTextById.get(entry.resourceId)
        : undefined
      return documentText === undefined || entry.getContentText
        ? entry
        : { ...entry, getContentText: () => documentText }
    }),
  }
}

function normalizedSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim()
}

function makeHelpers({ clinicalEvidenceText, catalog }: GroundingAuditInput) {
  const byKey = new Map(catalog.map((c) => [c.key, c]))
  const normalizedEvidence = normalizedSearchText(clinicalEvidenceText)
  const presentTerms = new Set(TEST_TERMS.filter((t) =>
    normalizedEvidence.includes(normalizedSearchText(t)),
  ))
  const isImaging = (k: string) => {
    const e = byKey.get(k)
    return !!e && /胸腔|X光|X-ray|心電圖|ECG|超音波/i.test(e.display ?? '')
  }
  const displayOf = (k: string) => byKey.get(k)?.display ?? ''
  return { byKey, presentTerms, isImaging, displayOf }
}

function auditDocumentEvidence(
  sources: string[],
  evidence: DocumentEvidenceEntry[] | undefined,
  tag: string,
  byKey: Map<string, CatEntry>,
  issues: string[],
): boolean {
  const normalizedSources = sources.map((source) => source.trim().toUpperCase())
  const documentSources = normalizedSources.filter((source) => {
    const resourceType = byKey.get(source)?.resourceType
    return resourceType === 'DocumentReference' || resourceType === 'Composition'
  })
  const entries = evidence ?? []

  for (const entry of entries) {
    const source = entry.source?.trim().toUpperCase() ?? ''
    if (!normalizedSources.includes(source)) {
      issues.push(`document evidence ${source || '(missing source)'} is not cited in ${tag}`)
    }
  }
  if (documentSources.length === 0) return false

  let allDocumentSourcesVerified = true
  for (const source of documentSources) {
    const sourceText = byKey.get(source)?.getContentText?.() ?? ''
    const candidates = entries.filter((entry) =>
      entry.source?.trim().toUpperCase() === source,
    )
    if (candidates.length === 0) {
      issues.push(`missing verbatim document evidence for ${source} in ${tag}`)
      allDocumentSourcesVerified = false
      continue
    }
    const matched = candidates.some((entry) => {
      const quote = normalizedSearchText(entry.quote ?? '')
      return quote.length >= 8 && normalizedSearchText(sourceText).includes(quote)
    })
    if (!matched) {
      issues.push(`document evidence quote not found verbatim in ${source} for ${tag}`)
      allDocumentSourcesVerified = false
    }
  }
  return allDocumentSourcesVerified
}

/** Returns a list of grounding issues (empty = clean) for a parsed medical summary. */
/** Every key a problem row cites, across its per-column lists. */
function problemKeys(p: any): string[] {
  return [...new Set([
    ...(p.basisSources ?? []),
    ...(p.metricSources ?? []),
    ...(p.medicationSources ?? []),
    ...(p.sources ?? []),
  ])] as string[]
}

export function auditSummaryGrounding(ai: any, input: GroundingAuditInput): string[] {
  const { byKey, presentTerms, isImaging, displayOf } = makeHelpers(input)
  const issues: string[] = []
  const spans: Array<{
    text: string
    tag: string
    sources: string[]
    documentEvidence?: DocumentEvidenceEntry[]
  }> = []
  spans.push({ text: ai.headline ?? '', tag: 'headline', sources: [] })
  for (const [i, p] of (ai.problems ?? []).entries()) spans.push({ text: `${p.label} ${p.basis ?? ''} ${p.metric ?? ''} ${p.metricMeta ?? ''} ${p.managedBy ?? ''} ${p.medications ?? ''}`, tag: `problem[${i}] ${p.label}`, sources: problemKeys(p), documentEvidence: p.documentEvidence })
  for (const [i, item] of (ai.medicationEducation ?? []).entries()) spans.push({ text: `${item.name} ${item.benefit} ${item.attention}`, tag: `medicationEducation[${i}] ${item.name}`, sources: item.sources ?? [], documentEvidence: item.documentEvidence })
  for (const { text, tag, sources, documentEvidence } of spans) {
    const citesClinicalDocument = sources.some((source) => {
      const resourceType = byKey.get(source.trim().toUpperCase())?.resourceType
      return resourceType === 'DocumentReference' || resourceType === 'Composition'
    })
    auditDocumentEvidence(
      sources,
      documentEvidence,
      tag,
      byKey,
      issues,
    )
    // Original-language excerpts replace bilingual keyword lists for all
    // free-text document claims. Missing/changed quotes are reported above;
    // do not add a second, dictionary-based verdict that could mistranslate
    // an otherwise legitimate examination name.
    if (!citesClinicalDocument) {
      for (const term of fabricatedTests(text, presentTerms)) issues.push(`fabricated test "${term}" in ${tag}`)
    }
    if (POSITIONAL.test(text)) issues.push(`positional cross-ref in ${tag}`)
  }
  for (const [i, p] of (ai.problems ?? []).entries()) {
    if (/腎|eGFR|GFR/i.test(p.label)) for (const k of problemKeys(p)) if (isImaging(k) && !/超音波/.test(displayOf(k))) issues.push(`renal claim cites imaging ${k} (${displayOf(k)}) in problem[${i}] ${p.label}`)
    if (/息肉/.test(p.label)) for (const k of problemKeys(p)) if (/超音波|X光/.test(displayOf(k))) issues.push(`polyp cites imaging ${k} (${displayOf(k)}) in problem[${i}] ${p.label}`)
    if (/瓣/.test(p.label)) for (const k of problemKeys(p)) if (/心電圖|ECG/i.test(displayOf(k))) issues.push(`valve claim cites ECG ${k} in problem[${i}] ${p.label}`)
  }
  return issues
}

/** Returns a list of grounding issues (empty = clean) for a parsed safety scan. */
export function auditSafetyGrounding(scan: any, input: GroundingAuditInput): string[] {
  const { presentTerms, isImaging, displayOf } = makeHelpers(input)
  const issues: string[] = []
  for (const [i, a] of (scan.alerts ?? []).entries()) {
    // Exclude the recommendation field from the fabrication check — a safety
    // alert may legitimately say 「建議安排心臟超音波」. Check where the alert
    // ASSERTS findings (title/detail/evidence).
    const asserted = `${a.title} ${a.detail} ${(a.evidence ?? []).join(' ')}`
    for (const term of fabricatedTests(asserted, presentTerms)) issues.push(`fabricated test "${term}" in alert[${i}] ${a.title}`)
    const text = `${a.title} ${a.detail} ${a.recommendation ?? ''}`
    if (POSITIONAL.test(text)) issues.push(`positional cross-ref in alert[${i}] ${a.title}`)
    if (a.category === 'renal') for (const k of a.sources ?? []) if (isImaging(k) && !/肌酸酐|Creat|GFR|尿素|BUN/i.test(displayOf(k))) issues.push(`renal alert cites imaging ${k} (${displayOf(k)}) in alert[${i}]`)
  }
  return issues
}
