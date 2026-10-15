import type { AiModelExecution } from '@/src/core/entities/ai-model-execution.entity'
// Medical Summary (醫療摘要) — the FIXED, structured shape the AI must return so
// the UI renders 初診快覽 instead of free-text markdown (same philosophy as
// safety-alert.entity.ts). The AI may ONLY cite data via reference keys taken
// from an app-built source catalog; dates / organizations / resource types are
// never AI output — they are resolved app-side from the FHIR bundle, which is
// what makes the source chips and report chips hallucination-proof.
import { z } from 'zod'
import { clampLine } from '@/src/core/utils/clamp-line.utils'
import type { SafetyScanResult } from './safety-alert.entity'

// What KIND of evidence an inferred problem rests on — drives the card badge.
// 'diagnosis' = coded on a claim; the rest are cross-referenced inferences
// (abnormal labs, dispensed meds implying a condition, a care plan, a
// discharge summary). 'careplan' reads as more authoritative than a pattern.
export const PROBLEM_KINDS = [
  'diagnosis',
  'lab',
  'medication',
  'careplan',
  'discharge',
  'other',
] as const
export type ProblemKind = (typeof PROBLEM_KINDS)[number]

// ---------------------------------------------------------------------------
// AI output schema (validated with Zod; malformed replies are rejected)
//
// Size caps CLAMP (slice/truncate), they never reject: verbose models (Claude
// Haiku especially) routinely exceed them with perfectly good content — a
// long narrative, 8 cited keys, an 85-char basis — and rejecting the whole
// reply for that made Haiku's parse-failure rate near-total (2026-07).
// Wrong TYPES and missing required fields still reject; oversize just trims.
// ---------------------------------------------------------------------------

const clampedText = (max: number) =>
  z.string().min(1).transform((s) => (s.length > max ? s.slice(0, max) : s))
const clampedLineText = (max: number) =>
  z.string().min(1).transform((s) => clampLine(s.trim(), max))
/** An optional one-line field a small model sometimes writes as a list
 * (VGHBrain wrote "metric": [] on 2026-10-05, which rejected the whole
 * problem list) or as null: an empty list or null is no value, items join. */
const optionalClampedLineTextOrList = (max: number) =>
  z.union([z.string(), z.array(z.string()), z.null()])
    .transform((value) => {
      const text = Array.isArray(value)
        ? value.map((item) => item.trim()).filter(Boolean).join('; ')
        : (value ?? '').trim()
      return text ? clampLine(text, max) : undefined
    })
    .optional()
/** A free-text list field some models emit as a JSON array of strings
 * (Qwen 3.6 writes problems.medications as ["A", "B"]). Both shapes carry the
 * same content; join instead of rejecting the whole card. */
const optionalClampedTextOrList = (max: number) =>
  z.union([z.string(), z.array(z.string())])
    .transform((value) => {
      const text = Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean).join('、') : value
      return text.length > max ? text.slice(0, max) : text
    })
    .optional()
const clampedRequiredKeys = (max: number) =>
  z.array(z.string().min(1)).min(1).transform((a) => a.slice(0, max))
/** An optional citation list some models write as a bare string ("L3"). */
const optionalKeyList = (max: number) => z.unknown()
  .transform((value) => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
    .slice(0, max))
  .optional()

// Verification-only metadata for claims translated or paraphrased from a
// free-text clinical document. The quote must remain in the document's
// original language so an offline checker can verify it without maintaining
// an unbounded bilingual dictionary of examinations, diagnoses, and findings.
export const DocumentEvidenceSchema = z.object({
  source: z.string().min(1),
  quote: clampedText(240),
})
export type DocumentEvidence = z.infer<typeof DocumentEvidenceSchema> & {
  /** App-authored excerpt check. Never establishes clinical entailment. */
  verification?: import('@/src/core/utils/document-evidence.utils').DocumentQuoteVerification
}
const optionalDocumentEvidence = () =>
  z.array(DocumentEvidenceSchema).max(4).optional()

// Inferred active-problem list: the model synthesises problems from ALL data
// types (coded diagnoses, abnormal labs, dispensed meds, care plans, discharge
// summaries) — not just claim ICD codes — and cites the records via catalog keys.
// Deliberately NO ICD field: LLM-emitted codes proved unstable across runs
// (N18 / N18.3 / N18.9 for the same patient) and unverifiable codes must not
// look authoritative. The problem NAME + navigable sources are the product.
export const SummaryProblemSchema = z.object({
  label: clampedLineText(120),
  /** Short human-readable basis, e.g. "5 次檢驗異常" / "藥局調劑". */
  basis: optionalClampedLineTextOrList(80),
  /** What kind of evidence — drives the badge (off-list → 'other'). */
  kind: z.string().optional(),
  /** Data-first key indicator, e.g. "eGFR 33 → 32 ▼". */
  metric: optionalClampedLineTextOrList(120),
  /** Dates/units belonging to `metric`, rendered as its meta line. */
  metricMeta: optionalClampedLineTextOrList(120),
  /** Organization + specialty as visible in the data (never invented). */
  managedBy: optionalClampedLineTextOrList(80),
  /** Catalog key of the latest encounter at that organization. The APP reads
   *  its date — the model never writes a date for this row. */
  managedByRef: z.string().optional(),
  /** Legacy free text. When `medicationSources` resolve, the APP writes the
   *  names from those records instead. */
  medications: optionalClampedTextOrList(160),
  flag: z.boolean().optional(),
  // Each column cites its own records, so every claim on the row is one click
  // from its source: the condition (label/basis), the values (metric), and the
  // medicines. `sources` is the legacy single list (demo snapshots, caches).
  basisSources: optionalKeyList(6),
  metricSources: optionalKeyList(6),
  medicationSources: optionalKeyList(8),
  sources: optionalKeyList(8),
  documentEvidence: optionalDocumentEvidence(),
}).refine(
  (p) => [p.basisSources, p.metricSources, p.medicationSources, p.sources].some((keys) => (keys?.length ?? 0) > 0),
  { message: 'a problem must cite at least one source key' },
)

// Patient-facing medication education. This intentionally describes how a
// recorded medicine may support the patient's care before offering one calm,
// practical reminder. It is structured (rather than free markdown) so every
// item remains tied to the original medication record.
export const SummaryMedicationEducationSchema = z.object({
  name: clampedText(120),
  benefit: clampedText(400),
  attention: clampedText(400),
  sources: clampedRequiredKeys(8),
  documentEvidence: optionalDocumentEvidence(),
})

// 影像與病理重點: the model groups the reports' findings by organ and states
// each one in a short line, citing the reports it comes from and quoting each
// verbatim. The app verifies every quote against the report's full text, hides
// any point no quote survives for, and writes the dates, modality, titles and
// organizations itself. Lenient by construction (clamp, never reject): a
// malformed group, point or quote is skipped rather than costing its
// neighbours, and oversize lists are cut to the bounds the prompt states.
export const REPORT_ORGANS = [
  'brain',
  'head-neck',
  'chest-lung',
  'heart',
  'breast',
  'abdomen-liver-biliary',
  'abdomen-other',
  'kidney-urinary',
  'gynecologic',
  'prostate',
  'musculoskeletal',
  'vascular',
  'hematologic-lymph',
  'other',
] as const
export type ReportOrgan = (typeof REPORT_ORGANS)[number]

/** Labels the app writes for each organ group; the model only names the enum. */
export const REPORT_ORGAN_LABELS: Record<'en' | 'zh-TW', Record<ReportOrgan, string>> = {
  'zh-TW': {
    brain: '腦部',
    'head-neck': '頭頸部',
    'chest-lung': '肺部',
    heart: '心臟',
    breast: '乳房',
    'abdomen-liver-biliary': '肝膽',
    'abdomen-other': '腹部',
    'kidney-urinary': '腎臟泌尿',
    gynecologic: '婦科',
    prostate: '攝護腺',
    musculoskeletal: '骨骼肌肉',
    vascular: '血管',
    'hematologic-lymph': '血液淋巴',
    other: '其他',
  },
  en: {
    brain: 'Brain',
    'head-neck': 'Head & neck',
    'chest-lung': 'Lungs',
    heart: 'Heart',
    breast: 'Breast',
    'abdomen-liver-biliary': 'Liver & biliary',
    'abdomen-other': 'Abdomen',
    'kidney-urinary': 'Kidney & urinary',
    gynecologic: 'Gynecologic',
    prostate: 'Prostate',
    musculoskeletal: 'Musculoskeletal',
    vascular: 'Vascular',
    'hematologic-lymph': 'Blood & lymph',
    other: 'Other',
  },
}

/** Off-list or missing organ values land in `other`. */
export function normaliseReportOrgan(raw?: unknown): ReportOrgan {
  const value = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  return (REPORT_ORGANS as readonly string[]).includes(value) ? (value as ReportOrgan) : 'other'
}

/** Bounds the prompt states; anything past them is a looping reply. */
export const REPORT_MAX_GROUPS = 8
export const REPORT_MAX_POINTS_PER_GROUP = 4
export const REPORT_MAX_QUOTES_PER_POINT = 2
export const REPORT_POINT_TEXT_MAX_CHARS = 120
/** A quote longer than this is not one sentence; it is clamped (a clamped
 *  prefix still verifies verbatim if the original did). */
const REPORT_QUOTE_MAX_CHARS = 400

/** Keep the entries of an unknown array that parse; drop the rest. */
const lenientArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.unknown()
    .optional()
    .transform((value): Array<z.infer<T>> => (Array.isArray(value) ? value : [])
      .flatMap((entry) => {
        const parsed = item.safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
      .slice(0, max))

const reportKeyList = (max: number) => z.unknown()
  .optional()
  .transform((value) => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
    .slice(0, max))

export const ReportPointQuoteSchema = z.object({
  source: z.string().min(1),
  quote: z.string().min(1).transform((s) => (s.length > REPORT_QUOTE_MAX_CHARS ? s.slice(0, REPORT_QUOTE_MAX_CHARS) : s)),
})
export const ReportPointSchema = z.object({
  text: clampedText(REPORT_POINT_TEXT_MAX_CHARS),
  sources: reportKeyList(12),
  quotes: lenientArray(ReportPointQuoteSchema, REPORT_MAX_QUOTES_PER_POINT),
})
export const ReportGroupSchema = z.object({
  organ: z.unknown().optional(),
  points: lenientArray(ReportPointSchema, REPORT_MAX_POINTS_PER_GROUP),
})
export type ReportPointDraft = z.infer<typeof ReportPointSchema>
export type ReportGroupDraft = z.infer<typeof ReportGroupSchema>

export const MedicalSummaryReportsModuleSchema = z.object({
  groups: lenientArray(ReportGroupSchema, REPORT_MAX_GROUPS),
  // 30 reports in the digest at most; a generous bound stops a loop.
  unremarkable: reportKeyList(60),
})
export type ReportsModuleDraft = z.infer<typeof MedicalSummaryReportsModuleSchema>

export const MedicalSummaryAiResultSchema = z.object({
  headline: clampedLineText(240),
  // Patient audience only; the clinician overview is the headline alone.
  medicationEducation: z.array(SummaryMedicationEducationSchema).default([]).transform((a) => a.slice(0, 5)),
  problems: z.array(SummaryProblemSchema).default([]).transform((a) => a.slice(0, 20)),
  // Requested on its own lane (never in the one-shot schema), so it is
  // optional here: demo snapshots and legacy objects simply have none.
  reports: MedicalSummaryReportsModuleSchema.optional(),
})
export type MedicalSummaryAiResult = z.infer<typeof MedicalSummaryAiResultSchema> & {
  /** App-only carry-over for the retained `reports` module. A retry of
   *  ANOTHER card rebuilds the draft from the verified result, which no longer
   *  holds the quotes or points the finalizer dropped, so their counts ride
   *  along here instead. Never model output. */
  reportsCarriedCounts?: {
    droppedQuoteCount: number
    hiddenPointCount: number
    hiddenPoints?: UnverifiedReportPoint[]
  }
  /** App-only carry-over for retained problem rows whose metric the finalizer
   *  marked 需核對: the draft holds the cleaned line (arrows removed), which
   *  would pass the check again unmarked. Keys from `metricReviewCarryKey`.
   *  Never model output; a fresh problems module clears it. */
  problemsCarriedMetricReview?: string[]
}

/** The identity of a problem row's reviewed metric across a card retry. */
export const metricReviewCarryKey = (label: string, metric: string): string => `${label}\u0000${metric}`

// The fixed summary is generated as independently validated modules. Keeping
// these ids in the domain layer lets generation, cache, orchestration, and UI
// agree on exactly which card failed without coupling those layers together.
// Order here is the streaming/presentation order of 初診快覽.
export const MEDICAL_SUMMARY_MODULE_IDS = [
  'overview',
  'problems',
  'reports',
] as const
export type MedicalSummaryModuleId = (typeof MEDICAL_SUMMARY_MODULE_IDS)[number]

/** The modules written from the clinical context. `reports` is not one of
 *  them: it is asked for on its own lane over the report digest (medical
 *  audience only) and never joins the narrative batch prompt. */
export const MEDICAL_SUMMARY_NARRATIVE_MODULE_IDS = [
  'overview',
  'problems',
] as const satisfies readonly MedicalSummaryModuleId[]
export type MedicalSummaryNarrativeModuleId = (typeof MEDICAL_SUMMARY_NARRATIVE_MODULE_IDS)[number]

export const MedicalSummaryOverviewModuleSchema = z.object({
  headline: clampedLineText(240),
  medicationEducation: z.array(SummaryMedicationEducationSchema).default([]).transform((a) => a.slice(0, 5)),
})
export const MedicalSummaryProblemsModuleSchema = z.object({
  problems: z.array(SummaryProblemSchema).default([]).transform((a) => a.slice(0, 20)),
})

export interface MedicalSummaryModuleResultMap {
  overview: z.infer<typeof MedicalSummaryOverviewModuleSchema>
  problems: z.infer<typeof MedicalSummaryProblemsModuleSchema>
  reports: z.infer<typeof MedicalSummaryReportsModuleSchema>
}

export type MedicalSummaryModuleResult<T extends MedicalSummaryModuleId = MedicalSummaryModuleId> =
  MedicalSummaryModuleResultMap[T]

export const MEDICAL_SUMMARY_CARD_IDS = [
  ...MEDICAL_SUMMARY_MODULE_IDS,
  'safety',
] as const
export type MedicalSummaryCardId = (typeof MEDICAL_SUMMARY_CARD_IDS)[number]
export type MedicalSummaryCardErrors = Partial<Record<MedicalSummaryCardId, string>>

// ---------------------------------------------------------------------------
// App-side catalog & finalized (verified) result
// ---------------------------------------------------------------------------

/** Encounter subtype derived from FHIR `Encounter.class` (IMP/EMER/AMB…) —
 *  app-side and deterministic, so 住院 never renders as 門診 just because the
 *  AI could only say "encounter". */
export type EncounterClass = 'inpatient' | 'emergency' | 'outpatient'

/** One citable data point, built deterministically from the bundle. */
export interface SummarySourceCatalogEntry {
  /** Stable prompt key, e.g. "E1" (encounter), "M3" (medication). */
  key: string
  resourceType: string
  resourceId: string
  display: string
  /** ISO date (YYYY-MM-DD) taken from the resource — never from the AI. */
  date?: string
  /** ISO period end date taken from the resource. Currently populated for
   *  Encounter periods so admissions render their full stay deterministically. */
  endDate?: string
  organization?: string
  /** Whether the cited laboratory evidence itself contains an interpretation
   *  flag or reference range. A numeric value alone must not be described as
   *  high/low, controlled/uncontrolled, or at/not at target. */
  supportsNormalityAssessment?: boolean
  /** Lazy decoded document narrative, used only for claim-level verification.
   *  Kept out of prompts/source pills so large discharge summaries are not
   *  duplicated in memory or exposed as metadata. */
  getContentText?: () => string
  /** Only set for Encounter entries whose class is recognisable. */
  encounterClass?: EncounterClass
  /** Medication entries only: the ingredient, the ATC pharmacological
   *  subgroup and the mechanism ("oxybutynin · G04B UROLOGICALS · Cholinergic
   *  Muscarinic Antagonist"), printed beside the key so a medicine is chosen
   *  and described by what it is, not by the dispensing batch it sits in. The
   *  SOURCE LIST adds "anticholinergic ACB 3" for a fill supplied in the last
   *  90 days. */
  medicationClass?: string
  /** Medication entries only, when a listed source knows the medicine: its
   *  mechanism, whether every ingredient is known, and its anticholinergic
   *  burden ("ACB 3", "antimuscarinic", "ACB 3 (chlorpheniramine)"). */
  medicine?: { mechanism?: string; complete: boolean; anticholinergic?: string }
  /** Medication entries only: the day the recorded supply runs out (authoredOn
   *  plus the expected supply duration), when the record gives one. */
  supplyEnd?: string
}

/** A cited source resolved against the catalog. `verified: false` means the
 *  model cited a key that doesn't exist in the bundle — shown, not hidden. */
export interface ResolvedSourceRef {
  key: string
  /** 1-based display number used for superscripts + chips. */
  num: number
  verified: boolean
  resourceType?: string
  /** Bundle id — present iff verified; drives left-panel navigation. */
  resourceId?: string
  display?: string
  date?: string
  endDate?: string
  organization?: string
  /** Claim-specific verbatim excerpt used to pinpoint a cited free-text
   *  document. Never populated on the global source index; cards attach it
   *  while resolving the sources for one claim. */
  evidenceQuote?: string
  /** A resolved document may exist while its claim-specific quote is missing
   * or mismatched. Keep the original source navigable. */
  evidenceWarning?: 'missing' | 'mismatch' | 'unchecked'
}

export interface SummaryProblem {
  label: string
  basis?: string
  kind: ProblemKind
  metric?: string
  metricMeta?: string
  managedBy?: string
  /** Resolved app-side from `managedByRef` — the model never writes a date. */
  managedByDate?: string
  medications?: string
  flag?: boolean
  /** Every record the row stands on is a medicine: the problem is inferred
   *  from medication, which the row says. */
  inferredFromMedication?: true
  /** A lab problem resting on one value with no reference range or flag:
   *  whether it is abnormal is the model's reading, which the row says. */
  singleUnassessedLab?: true
  /** A chronic disease named from values alone that span under three months:
   *  its chronicity is the model's reading, which the row says. */
  shortSpanChronic?: true
  /** A problem inferred from medicines alone that are also given for another
   *  listed problem: that problem's label (an SGLT2 inhibitor and CKD). */
  medicationAlsoFor?: string
  /** Every key the row cites (all columns), for consumers that need one list. */
  sourceKeys: string[]
  /** Per-column citations. Absent on legacy results, which render the single
   *  row-level `sourceKeys` list instead. */
  basisSourceKeys?: string[]
  metricSourceKeys?: string[]
  medicationSourceKeys?: string[]
  /** The row's medicines one by one, app-written: `name` is the drug
   *  master's ingredient and strength ("Acetaminophen 500 mg") when the
   *  record resolves to it, else the record's own name; `fullName` is always
   *  the record's name. `medications` keeps the joined record names. */
  medicationItems?: Array<{ key: string; name: string; fullName: string }>
  /** Keys of `medicationItems` whose ATC class clearly does not treat this
   *  problem (medicationFitsProblem): shown 待核對, never removed. */
  medicationReviewKeys?: string[]
  /** An app-written lab metric in pieces, present only when one of its values
   *  is abnormal: each value carries its own record's flag (source
   *  interpretation, else an audited reference range). Joined, the pieces are
   *  exactly `metric`. Model-written metrics never carry them. */
  metricSegments?: MetricSegment[]
  /** The record behind "managedBy · date". */
  managedBySourceKey?: string
  /** 'organization': no visit for this problem or the named specialty was
   *  found, so the date is the organization's latest record — the row says so.
   *  'inferred': the row cites only pharmacy refills; the visit is the latest
   *  same-diagnosis visit before them (see prescriberFromRefills). */
  managedByScope?: 'organization' | 'inferred'
  /** The model's metric drew a trend its cited records cannot carry (one
   *  day, two sides, two modalities, or dates out of order): shown without
   *  arrows and marked for review. */
  metricNeedsReview?: true
  /** Cited keys whose report type contradicts the evidence type the basis
   *  names (e.g. 依據:心電圖紀錄 citing a chest X-ray). Detected app-side at
   *  finalize; rendered amber — shown, not hidden — so the clinician knows to
   *  verify that citation instead of trusting the pill. */
  suspectSourceKeys?: string[]
  documentEvidence?: DocumentEvidence[]
}

export interface SummaryMedicationEducation {
  name: string
  benefit: string
  attention: string
  sourceKeys: string[]
  documentEvidence?: DocumentEvidence[]
}

export interface MedicalSummaryResult {
  /** App-authored generation provenance. This is added only after the
   * structured AI reply has been parsed/finalized, so the model cannot claim a
   * different model or timestamp. Legacy caches may omit it; bundled demo
   * snapshots use explicit pre-generated provenance without a timestamp. */
  generation?: MedicalSummaryGeneration
  /** Per-card generation failures. Successful modules remain renderable and
   * cached; Retry regenerates only these ids. Missing means a legacy or fully
   * successful result. */
  cardErrors?: MedicalSummaryCardErrors
  /** Cards that have completed validation in this artifact. Present on live
   * results so streaming UI can distinguish completed empty cards from cards
   * that are still pending. Omitted legacy results are treated as complete for
   * backward-compatible rendering. */
  completedCardIds?: MedicalSummaryCardId[]
  /** Safety is a first-class generated card in the same briefing artifact,
   * not a separately validated or cached pipeline. High-severity alerts render
   * in the overview card under the headline; the rest fold into a closed
   * disclosure. */
  safety?: SafetyScanResult
  headline: string
  problems: SummaryProblem[]
  medicationEducation: SummaryMedicationEducation[]
  /** Unique cited sources in first-appearance order, matching the RENDER
   *  order (medication education → problems) so superscript numbers read
   *  top-to-bottom on the page. */
  sourceIndex: ResolvedSourceRef[]
  /** 影像與病理重點 — organ-grouped key findings across the imaging and
   *  pathology reports in the AI scope, plus every report no shown point cites.
   *  The model only selected and stated the findings; every quote was verified
   *  verbatim against its report, and dates, modality, titles and
   *  organizations are the app's. Present for the medical audience whenever
   *  the scoped data was available at finalize, including when the `reports`
   *  module failed or never ran (then `summarized` is false and every report
   *  is listed in `others`). */
  reportHighlights?: ReportHighlights
  /** Counter for medication-only problems (tagged 用藥推定): how many, and
   *  the ATC classes (4 characters) they rest on, for periodic review. */
  medicationInference?: { inferred: number; atcClasses: string[] }
}

/** pathology · pet · ct · mri · echo · us · ecg · xray · other */
export type ReportHighlightKind = import('@/src/core/utils/report-narrative.utils').ReportModalityKind

/** One report as the app knows it — never the model's words. */
export interface ReportFindingSource {
  /** Catalog key (L#) of the report. */
  key: string
  resourceType: string
  resourceId: string
  /** Modality class, read from the report's order name by the app. */
  kind: ReportHighlightKind
  date?: string
  /** Catalog display of the report. */
  title: string
  organization?: string
}

/** A report listed in the collapsed footer: judged unremarkable by the model,
 *  not cited by any shown point, or — when the key-findings summary is
 *  unavailable — every report. */
export interface ReportRow extends ReportFindingSource {
  /** Deterministic conclusion section (else the opening) of the report, a
   *  verbatim slice of its text. Shown only when the summary is unavailable. */
  excerpt?: string
  excerptSource?: 'conclusion' | 'opening'
  /** The excerpt stopped mid-sentence at its length cap. */
  excerptTruncated?: boolean
}

export interface ReportFindingPoint {
  /** The model's one-line statement of the finding, shown as written. */
  text: string
  /** 'quote': a verified quote carries an uncertainty marker the text dropped,
   *  so the UI shows the quote(s) in place of the text. */
  displayAs: 'text' | 'quote'
  /** Verified, source-faithful quotes (≥ 1 on every shown point). */
  quotes: Array<{ key: string; quote: string }>
  /** The cited reports, newest first. */
  sources: ReportFindingSource[]
}

/** A piece of an app-written metric; `abnormal` only on a flagged value. */
export interface MetricSegment {
  text: string
  abnormal?: 'high' | 'low' | 'abnormal'
}

/** A point no verified quote supported (see ReportHighlights.hiddenPoints). */
export interface UnverifiedReportPoint {
  organ: ReportOrgan
  text: string
  /** The listed reports the point cited, newest first. */
  sources: ReportFindingSource[]
}

export interface ReportFindingGroup {
  organ: ReportOrgan
  /** App-written organ label in the output locale. */
  label: string
  points: ReportFindingPoint[]
}

export interface ReportHighlights {
  /** True when a `reports` module result was applied. False for a demo
   *  snapshot, a failed or never-run module: the UI then lists every report
   *  with its deterministic excerpt and says the summary is unavailable. */
  summarized: boolean
  groups: ReportFindingGroup[]
  /** Newest first. */
  others: ReportRow[]
  /** Reports in the digest, including the ones past the request budget. */
  totalReports: number
  /** Quotes that failed the verbatim check or named no listed report. */
  droppedQuoteCount: number
  /** Points with no surviving verified quote; shown with an unverified label. */
  hiddenPointCount: number
  /** The model's unverified lines and cited reports. The UI shows them
   *  directly with an explicit label so clinicians can check the originals. */
  hiddenPoints?: UnverifiedReportPoint[]
  /** Points shown as their quote because the text dropped an uncertainty
   *  marker the quote carries. The counter the uncertainty guard is judged on. */
  uncertaintyRewriteCount: number
}

export type MedicalSummaryGeneration = {
  source: 'live'
  modelId: string
  modelExecution?: AiModelExecution
  /** Provenance of the cards currently retained, including across partial retries. */
  cardModelExecutions?: Partial<Record<MedicalSummaryCardId, AiModelExecution>>
  /** Immutable display name captured at generation time (especially
   * important for user-configured upstream model ids). */
  modelName: string
  /** When the structured summary itself finished. Also serves as the stable
   * identity used to attach app-authored batch metadata. */
  generatedAt: number
  /** Milliseconds from the start of this generation to the moment its FIRST
   * card became visible. This is the number the 初診快覽 redesign is measured
   * on — a clinician has about thirty seconds — so it is recorded separately
   * from the end-to-end duration. Absent on legacy caches and on runs whose
   * cards all failed. */
  firstCardMs?: number
  /** When the complete user-visible summary + safety batch settled. Optional
   * for legacy caches and unsuccessful/incomplete batches. */
  completedAt?: number
  /** End-to-end user-visible generation batch duration. Optional for legacy
   * caches and unsuccessful/incomplete batches. */
  durationMs?: number
} | {
  source: 'pre-generated'
  modelId: string
  modelName: string
}

/** Deterministic coverage stats — zero AI, computed straight from the bundle. */
export interface SummaryCoverageStats {
  start?: string
  end?: string
  organizations: number
  encounters: number
  medications: number
  labs: number
  procedures: number
}

export function normaliseProblemKind(raw?: string): ProblemKind {
  const c = (raw ?? '').toLowerCase().trim()
  return (PROBLEM_KINDS as readonly string[]).includes(c) ? (c as ProblemKind) : 'other'
}

export { clampLine }
