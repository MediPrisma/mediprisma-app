// 影像與病理重點 — the deterministic digest the `reports` lane is asked about.
//
// Clinicians cannot read every report. This module decides, without any
// model, WHICH reports the section covers (every imaging and pathology report
// in the AI scope that carries text and resolves to a catalog key), what each
// one's prompt text is, and how much of it fits ONE request: merging the same
// finding across reports needs every report in the same prompt, so the digest
// is fitted to a token budget instead of being split into chunks. The model
// then groups and states the findings; the finalizer verifies each quote
// against `narrative` (the full text kept here), and every report the model
// did not cite — including the ones past the budget — lands in the collapsed
// footer.
//
// Prompt text is a shortened VIEW of the report (conclusion first, admin lines
// removed, capped); verification always runs against the full narrative, so a
// quote copied from the view still verifies, and a quote that does not occur
// in the report never displays.
//
// The text handling and the budget fit are shared with the outpatient
// assistant (`@voho0000/personalized-care-fhir/report-text`); which reports
// are offered, their catalog keys and headers stay here.
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import type { SummaryCatalogInput } from './generate-medical-summary.use-case'
import {
  isAiScopeReport,
  reportIdentities,
  reportModality,
  reportNarrative,
  type ReportModalityKind,
} from '@/src/core/utils/report-narrative.utils'
import { estimateTokens } from '@/src/shared/utils/token-estimator'
import {
  fitReportTextsToBudget,
  type FittedReportText,
  type ReportTextCandidate,
} from '@voho0000/personalized-care-fhir/report-text'

export {
  REPORT_CONCLUSION_EXCERPT_CHARS,
  REPORT_DIGEST_MAX_REPORTS,
  REPORT_DIGEST_PER_REPORT_CHARS,
  REPORT_DIGEST_SHRINK_STEPS,
  REPORT_DIGEST_TOKEN_BUDGET,
  REPORT_OPENING_EXCERPT_CHARS,
  buildReportPromptBody,
  cutAtSentenceBoundary,
  deterministicReportExcerpt,
  findConclusionSection,
  isAdministrativeLine,
  type ConclusionSection,
  type DeterministicReportExcerpt,
} from '@voho0000/personalized-care-fhir/report-text'

export interface ReportDigestOptions {
  maxReports?: number
  /** Starting per-report length (the first shrink step is replaced by it). */
  perReportChars?: number
  /** Estimated-token budget of the request's report text. */
  tokenBudget?: number
}

export interface ReportDigestInput {
  clinicalData?: SummaryCatalogInput | null
  catalog: readonly SummarySourceCatalogEntry[]
}

export interface ReportDigestItem {
  /** Catalog key, e.g. "L14". Every digest item has one. */
  key: string
  resourceType: string
  resourceId: string
  kind: ReportModalityKind
  /** Fine-grained modality class (the dedupe unit) and its rank. */
  modalityClass: string
  rank: number
  /** Catalog display of the report. */
  title: string
  date?: string
  organization?: string
  /** The FULL report text — what every quote is verified against. */
  narrative: string
  /** Header line plus the shortened report view sent to the model. */
  promptText: string
  estimatedTokens: number
  /** Whether a header-anchored conclusion section was found. */
  hasConclusion: boolean
}

export interface ReportDigest {
  /** Reports sent to the model, newest first. */
  items: ReportDigestItem[]
  /** Reports left out of the request — past the report cap, or the oldest
   *  ones dropped to fit the token budget — newest first. They are never
   *  cited, so they always render in the footer. */
  overflow: ReportDigestItem[]
  /** The single request's report text. */
  promptText: string
  /** Estimated tokens of `promptText`. */
  estimatedTokens: number
  /** Per-report length the request was built at (the last shrink step used). */
  perReportChars: number
}

/** Every report the section renders, in display order (newest first). */
/** The digest's reports whose whole text a request carried. A context-window
 *  reduction cuts the middle of the text (`fitClinicalContextTextToTokenBudget`),
 *  so a report is read only when its full block survived; undefined when every
 *  report did. */
export function sentReportKeys(digest: ReportDigest, sentText: string): string[] | undefined {
  const sent = digest.items.filter((item) => sentText.includes(item.promptText))
  return sent.length < digest.items.length ? sent.map((item) => item.key) : undefined
}

export function allDigestItems(digest: ReportDigest): ReportDigestItem[] {
  return [...digest.items, ...digest.overflow]
}

const PROMPT_KIND_LABEL: Record<ReportModalityKind, string> = {
  pathology: 'Pathology',
  pet: 'PET',
  ct: 'CT',
  mri: 'MRI',
  echo: 'Echo',
  us: 'Ultrasound',
  ecg: 'ECG',
  xray: 'X-ray',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

interface DigestCandidate extends ReportTextCandidate {
  resourceType: string
  resourceId: string
  kind: ReportModalityKind
  modalityClass: string
  title: string
  organization?: string
}

function digestItem({
  candidate,
  promptText,
  estimatedTokens,
  hasConclusion,
}: FittedReportText<DigestCandidate>): ReportDigestItem {
  return {
    key: candidate.key,
    resourceType: candidate.resourceType,
    resourceId: candidate.resourceId,
    kind: candidate.kind,
    modalityClass: candidate.modalityClass,
    rank: candidate.rank,
    title: candidate.title,
    ...(candidate.date ? { date: candidate.date } : {}),
    ...(candidate.organization ? { organization: candidate.organization } : {}),
    narrative: candidate.narrative,
    promptText,
    estimatedTokens,
    hasConclusion,
  }
}

function computeReportDigest(
  input: ReportDigestInput,
  options: ReportDigestOptions,
): ReportDigest {
  const entryByResourceId = new Map(
    input.catalog
      .filter((entry) => entry.resourceType === 'DiagnosticReport')
      .map((entry) => [entry.resourceId, entry]),
  )
  const candidates: DigestCandidate[] = []
  for (const report of input.clinicalData?.diagnosticReports ?? []) {
    if (!isAiScopeReport(report)) continue
    const entry = report.id ? entryByResourceId.get(report.id) : undefined
    // A report without a catalog key cannot be cited, navigated or verified.
    if (!entry) continue
    const narrative = reportNarrative(report)
    if (!narrative.trim()) continue
    const { cls, rank, kind } = reportModality(report)
    candidates.push({
      key: entry.key,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      kind,
      modalityClass: cls,
      rank,
      title: entry.display,
      ...(entry.date ? { date: entry.date } : {}),
      ...(entry.organization ? { organization: entry.organization } : {}),
      narrative,
      header: [
        `[${entry.key}] ${PROMPT_KIND_LABEL[kind]}`,
        entry.date ?? 'date unknown',
        entry.organization?.trim(),
        entry.display.replace(/\s+/g, ' ').trim(),
      ].filter(Boolean).join(' · '),
      // Same study twice (bilingual bridge rows): the first is kept, exactly
      // as the overview snapshot does.
      identities: reportIdentities(report, cls, entry.date ?? ''),
    })
  }
  const fit = fitReportTextsToBudget(candidates, { ...options, estimateTokens })
  return {
    items: fit.items.map(digestItem),
    overflow: fit.overflow.map(digestItem),
    promptText: fit.promptText,
    estimatedTokens: fit.estimatedTokens,
    perReportChars: fit.perReportChars,
  }
}

// The finalizer runs on every streamed card; the default digest of one scoped
// bundle is built once.
const defaultDigestCache = new WeakMap<object, WeakMap<object, ReportDigest>>()

/** Imaging & pathology reports to summarise, newest first, with the single
 *  request's prompt text fitted to the token budget. Pure and deterministic. */
export function buildReportDigest(
  input: ReportDigestInput,
  options?: ReportDigestOptions,
): ReportDigest {
  const clinicalData = input.clinicalData
  const cacheable = !options && clinicalData && typeof clinicalData === 'object'
  if (cacheable) {
    const cached = defaultDigestCache.get(clinicalData)?.get(input.catalog)
    if (cached) return cached
  }
  const digest = computeReportDigest(input, options ?? {})
  if (cacheable) {
    const byCatalog = defaultDigestCache.get(clinicalData) ?? new WeakMap()
    byCatalog.set(input.catalog, digest)
    defaultDigestCache.set(clinicalData, byCatalog)
  }
  return digest
}
