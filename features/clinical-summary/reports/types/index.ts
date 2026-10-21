// Types for Reports - Re-export from shared types
import type { Observation } from '@/src/shared/types/fhir.types'
import type { ProcedureCategoryCode } from '../utils/procedure-category'
import type { SharedReportSource } from '@/src/shared/utils/shared-report-grouping'

export type {
  Coding,
  Quantity,
  CodeableConcept,
  ReferenceRange,
  Observation,
  DiagnosticReport,
  ImagingStudy,
  Procedure,
} from '@/src/shared/types/fhir.types'

export type ReportGroup = "lab" | "imaging" | "pathology" | "cancer-screening" | "procedures" | "vitals" | "other"
export type ReportSourceProgram = 'adult-preventive'
export type ReportSourceProvenance = 'nhi-medicloud'

/** Image attachment from DiagnosticReport.presentedForm (bridge v0.14.0+).
 *  Decoded to a Blob URL lazily by the viewer (ReportImageDialog), never
 *  eagerly. Carries exactly one source:
 *   - `ref`:  IndexedDB Blob key (local-bundle import path — base64 moved
 *             off-heap at import; bytes fetched on demand via getImage).
 *   - `data`: raw base64 inline (SMART live path — images still arrive inline). */
export type ReportImage = {
  ref?: string
  data?: string
  contentType: string
  title?: string
  size?: number
}

/** Stable, URL-free descriptor handed back to the Bridge on every click. */
export type NhiViewerRequestDescriptor = {
  version: 1
  procId: 'IMUE0130'
  patientContextHash: string
  iplCaseSeqNo: string
  readPos: string
  ordMark: 'Y' | ''
  fileType: string
  fileQty: string
  feeYm: string
}

export type NhiViewerAction = {
  kind: 'live'
  descriptor: NhiViewerRequestDescriptor
  title?: string
} | {
  kind: 'legacy'
  contentType: string
  url: string
  title?: string
}

export type Row = {
  id: string
  title: string
  /** Raw bridge report title (DiagnosticReport.code.text), BEFORE any
   *  audience/language display enhancement. `title` is the rendered string and
   *  may carry an appended abbreviation/translation (e.g. "心電圖 (ECG)");
   *  history lookups (useReportHistory) must key off this raw value so the
   *  exact match against DiagnosticReport.code.text still succeeds. */
  rawTitle?: string
  meta: string
  obs: Observation[]
  group: ReportGroup
  institution?: string
  /** Display-only provenance; raw institution remains the grouping identity. */
  hospitalSource?: import('../adapters/vghtpe-source-display').HospitalSource
  /** Explicit source-program provenance supplied by the source resource.
   *  Never infer this from the analyte name or value. */
  sourceProgram?: ReportSourceProgram
  /** Exact source marker supplied by the linked Observation(s). */
  sourceProvenance?: ReportSourceProvenance
  effectiveDate?: string  // ISO date string for smart date display
  showTime?: boolean           // true when multiple same-name results share the same date
  isPossibleDuplicate?: boolean // true when same title+date+institution+value appears >1 time
  images?: ReportImage[]        // inline base64 images (presentedForm); rendered on demand
  viewerActions?: NhiViewerAction[] // live Bridge requests; legacy URL only when no request extension exists
  /** ──── Multi-region study grouping (NHI 33xxxB CT etc.) ────────────
   *  NHI bills every body part imaged on the same machine under one
   *  health-record code. When the same (code, date, institution) carries
   *  multiple DRs — some narrative-only, some image-only — bridge can't
   *  pair them (no body_part field in IHKE3408) and the SMART app must
   *  display the group together with an ambiguity warning. A synthetic
   *  row carrying `groupedRows` is rendered as MultiRegionStudyCard
   *  instead of the regular ReportRow. */
  groupedRows?: Row[]
  /** True when the group has ≥2 narrative-only DRs (multi-region) OR
   *  ≥1 narrative + ≥1 image-only with total >2 (mixed ambiguous set).
   *  Drives the warning banner in MultiRegionStudyCard. Bridge spec
   *  §"hasAmbiguousAssociation" defines the rule. */
  hasAmbiguity?: boolean
  /** ──── Lab collection-day grouping (健保存摺 fragmentation) ─────────
   *  True on a synthetic row folding all lab DRs that share (collection
   *  day, institution, lab category) — NHI ships one DR per analyte; the
   *  hospital reading unit is one report per lab section (血液/生化/…).
   *  `groupedRows` holds the members (pre-sorted by preferredOrder);
   *  ReportRow dispatches these to LabDayGroupCard. See
   *  utils/lab-day-grouping.ts. */
  dayGroup?: boolean
  /** LAB_CATEGORIES id ('cbc', 'chem', …) or 'other' — set on dayGroup rows;
   *  drives the card's STACKING rank. */
  dayGroupCategoryId?: string
  /** Category ids to name in the card's chip — usually `[dayGroupCategoryId]`,
   *  but a chem card that absorbed plain glucose labels by actual contents:
   *  ['chem'] / ['glucose'] / ['chem','glucose']. See dayGroupLabelIds. */
  dayGroupLabelIds?: string[]
  /** Display-only group used by the All tab: folds every adult preventive
   *  health-exam row sharing one source date and institution into a single
   *  expandable card. The original rows remain in `groupedRows`. */
  adultPreventiveGroup?: boolean
  /** Number of DR duplicates bridge sent for this row that we collapsed
   *  via strict-prefix dedup. Drives the "bridge dup × N" badge on the
   *  row header so the bridge bug stays visible — silently merging would
   *  violate the no-mask-bridge-bugs rule. Absent / 0 means no dup. */
  bridgeDupCount?: number
  /** Procedures only: number of secondary procedures grouped under this
   *  operative session via Procedure.partOf (bridge ≥0.20.x). Drives the
   *  "+N 相關處置" hint on the collapsed session header so the user knows
   *  expanding reveals nested sub-procedures. Absent / 0 = standalone. */
  relatedCount?: number
  /** Procedures only: special materials (特材) linked to this surgery. Drives
   *  the "使用醫材 N" hint on the collapsed header. Absent / 0 = none. */
  specialMaterialCount?: number
  /** Source-derived Procedure.category used by the procedure filter badges. */
  procedureCategory?: ProcedureCategoryCode
  /** ImagingStudy resources represented by this row. A linked
   * DiagnosticReport keeps its own id as the row id, so these ids are retained
   * separately for source navigation and deduplication. */
  imagingStudyIds?: string[]
  /** DiagnosticReport resources represented by this row. Report rendering may
   * merge same-code/same-day records into one row, so `id` alone is not enough
   * to resolve source citations back to every original report. */
  diagnosticReportIds?: string[]
  /** Distinct source procedures that intentionally share one exact narrative.
   * The report text remains single-copy while these original identities stay
   * inspectable and searchable. */
  sharedReportSources?: SharedReportSource[]
}
