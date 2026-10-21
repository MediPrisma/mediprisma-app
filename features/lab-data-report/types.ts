// Wire contract for a clinician-initiated lab-data problem report. The same
// shape is re-validated by the `submitLabDataReport` Function
// (firebase-smart-on-fhir, functions/src/services/lab-data-report); change
// both sides together and bump LAB_DATA_REPORT_SCHEMA_VERSION.
//
// What is deliberately absent: patient identity, FHIR resource ids, absolute
// dates, Observation.note, report narrative, and anything that is not a
// laboratory Observation. See PRIVACY_POLICY.md §2.10.
import type { LabCategoryDecision } from '@/src/shared/utils/lab-categories'

export type { LabCategoryDecision }

export const LAB_DATA_REPORT_SCHEMA_VERSION = 1

/** A report carries every laboratory row of the patient's cumulative report.
 *  Real patients carry up to ~1,400 (2026-09-27, 278 bundles); past this cap
 *  the flagged panels are kept whole and the oldest other rows are counted in
 *  `truncatedRows`. */
export const LAB_DATA_REPORT_MAX_ROWS = 3000
export const LAB_DATA_REPORT_MAX_DESCRIPTION = 1000
/** A source result string longer than this is narrative and is never sent. */
export const LAB_DATA_REPORT_MAX_VALUE_STRING = 40
/** Reference-range text longer than this is narrative and is never sent. */
export const LAB_DATA_REPORT_MAX_RANGE_TEXT = 120
/** Hard cap for any other row string (names, units, codes). */
export const LAB_DATA_REPORT_MAX_STRING = 200

/** The one-tap choices. Picking one is optional — a busy clinic reports in
 *  seconds, and the rows themselves show what went wrong. */
export const LAB_DATA_REPORT_PROBLEM_TYPES = [
  'wrong-panel',
  'split-column',
  'duplicate',
  'value-unit',
  'name',
  'other',
] as const
export type LabDataReportProblemType = (typeof LAB_DATA_REPORT_PROBLEM_TYPES)[number] | 'unspecified'

export const LAB_DATA_REPORT_DATA_SOURCES = ['medcloud', 'nhi', 'smart', 'demo', 'import', 'unknown'] as const
export type LabDataReportDataSource = (typeof LAB_DATA_REPORT_DATA_SOURCES)[number]

export type LabDataReportValue =
  /** `value`/`comparator` only when the reporter chose to attach values. */
  | { kind: 'quantity'; value?: number; comparator?: string; magnitude: number | null; decimals: number }
  | { kind: 'range'; low?: number; high?: number }
  | { kind: 'coded'; code?: string; text?: string }
  | { kind: 'string'; value?: string; length: number }
  | { kind: 'other'; type: string }
  | { kind: 'none' }

export interface LabDataReportCoding {
  system?: string
  code?: string
  display?: string
}

export interface LabDataReportReferenceRange {
  low?: number
  high?: number
  unit?: string
  text?: string
}

export interface LabDataReportRow {
  /** Ordinal inside this report (1-based); never a FHIR id. */
  ref: number
  /** Days since the earliest dated row in this report (day 0). */
  day: number | null
  /** Local time of day from effectiveDateTime, when the source carried one. */
  timeOfDay?: string
  /** MediCloud report-instance time, relative to this row's day. Decides
   *  whether the bridge merges a daily and a monthly copy. */
  sourceTime?: { dayDelta: number; time: string }
  /** Performing organisation(s) as the source labelled them (not the patient). */
  performer: string[]
  code: { text?: string; codings: LabDataReportCoding[] }
  category: string[]
  specimen?: string
  status?: string
  unit?: string
  unitCode?: string
  value: LabDataReportValue
  /** Rows whose result is identical share a group number. */
  sameValueGroup?: number
  interpretation: string[]
  referenceRange: LabDataReportReferenceRange[]
  /** Whitelisted bridge extensions (source category, inspect mode, data mark,
   *  copy count …), by short name. */
  sourceExtensions: { name: string; value: string }[]
  /** Whitelisted meta.tag entries as `name:code`. Never nhi-visit-date. */
  sourceTags: string[]
  /** What the app did with the row. */
  app: {
    categoryId: string | null
    decidedBy: LabCategoryDecision
    testKey: string
    column: string
  }
}

export interface LabDataReportContext {
  appVersion: string
  dataSource: LabDataReportDataSource
  site: 'vghtpe' | 'unknown'
  language: string
  nameMode: 'standardized' | 'original'
}

// ── MediCloud raw source rows (optional) ────────────────────────────────
// When the patient came from the 雲端病歷 extension and its same-run raw
// capture can still be read (1 hour, the extension decides), the report may
// carry the raw IMUE0060 laboratory rows — S02 detail rows and the S03
// history sidecar — so a mapping error can be traced to the source row that
// produced it (or failed to). Allow-listed fields only, dates on the report's
// day axis, every string scanned; see PRIVACY_POLICY.md §2.10.

/** A capture carries at most a few hundred lab rows per patient (8 local
 *  captures, 2026-09-29: ≤ 733 S02 + 92 S03). */
export const LAB_DATA_REPORT_MAX_RAW_ROWS = 5000

/** S02 source fields sent verbatim (after the identifier scan). Everything
 *  else — the masked ID, log2time, fee_ym, ICD and pathology diagnoses,
 *  hosp_id, any field the source adds later — never leaves the browser. */
export const LAB_DATA_REPORT_RAW_S02_TEXT_FIELDS = [
  'order_code',
  'order_name',
  'assay_item_name',
  'unit_data',
  'consult_value',
  'assay_mark',
  'assay_method',
  'assay_tp_cname',
  'inspect_mode',
  'data_mark',
  'hosp',
  'func_type',
] as const
/** Result-bearing free text: sent only as a short result, and only with values. */
export const LAB_DATA_REPORT_RAW_S02_RESULT_FIELDS = ['assay_value', 'inspect_result', 'memo_data'] as const
export const LAB_DATA_REPORT_RAW_S02_DATE_FIELDS = ['case_time', 'real_inspect_date', 'recipe_date'] as const

export type LabDataReportRawTextField = (typeof LAB_DATA_REPORT_RAW_S02_TEXT_FIELDS)[number] | 'assaY_NAME'
export type LabDataReportRawResultField = (typeof LAB_DATA_REPORT_RAW_S02_RESULT_FIELDS)[number] | 'assaY_VALUE'
export type LabDataReportRawDateField = (typeof LAB_DATA_REPORT_RAW_S02_DATE_FIELDS)[number] | 'assaY_DATE'

/** A source date on the report's day axis (may be negative: a raw row can
 *  predate every converted row), plus the time of day when it had one. */
export interface LabDataReportRawDate {
  day: number
  time?: string
}

export interface LabDataReportRawRow {
  /** Ordinal inside rawSource.rows (1-based). */
  ref: number
  /** IMUE0060 S02 detail row, or S03 history row. */
  source: 's02' | 's03'
  /** The source's own row number (`r` / `rn`). */
  ordinal?: number
  dates: Partial<Record<LabDataReportRawDateField, LabDataReportRawDate>>
  /** Allow-listed text fields under their source names. */
  fields: Partial<Record<LabDataReportRawTextField, string>>
  /** Result fields, only when values are attached and the text is a short
   *  result (a number stays a number). */
  results: Partial<Record<LabDataReportRawResultField, string | number>>
  /** Length of each result field that was present but not sent. */
  withheld: Partial<Record<LabDataReportRawResultField, number>>
}

export interface LabDataReportRawSource {
  producer: 'medcloud2'
  /** Extension version that produced the capture (from its metadata). */
  producerVersion?: string
  rows: LabDataReportRawRow[]
  /** Rows the capture held, before the cap. */
  s02Rows: number
  s03Rows: number
  /** HTTP status the capture recorded for each source. */
  endpointStatus: { s02?: number; s03?: number }
  truncatedRows: number
  droppedStrings: number
  /** Dates in a format the report does not know; never sent. */
  unparsedDates: number
  /** Field NAMES outside the allowlist (schema drift), never their values. */
  unknownFields: string[]
}

/** Why the raw rows the reporter asked for are not attached. */
export const LAB_DATA_REPORT_RAW_ERRORS = [
  'NOT_AVAILABLE',
  'EXPIRED',
  'BUNDLE_MISMATCH',
  'PATIENT_MISMATCH',
  'PATIENT_UNVERIFIED',
  'CONTEXT_CHANGED',
  'REQUEST_IN_PROGRESS',
  'INVALID_REQUEST',
  'READ_FAILED',
  'EXTENSION_UNAVAILABLE',
  'NO_LAB_SOURCE',
] as const
export type LabDataReportRawError = (typeof LAB_DATA_REPORT_RAW_ERRORS)[number]

export interface LabDataReportPayload {
  schemaVersion: typeof LAB_DATA_REPORT_SCHEMA_VERSION
  problemType: LabDataReportProblemType
  description: string
  includesValues: boolean
  scope: {
    /** Panels the reporter ticked as looking wrong (optional, several allowed). */
    flaggedCategories: string[]
    /** Rows sent per panel, in the clinician's panel order. */
    categories: Array<{ categoryId: string; rows: number }>
  }
  context: LabDataReportContext
  rows: LabDataReportRow[]
  /** Rows left out by the row cap. */
  truncatedRows: number
  /** Rows shown in a lab panel whose FHIR category is not laboratory. */
  excludedNonLabRows: number
  /** Row strings removed because they looked like an identifier or date. */
  droppedStrings: number
  /** MediCloud raw laboratory rows, when attached. */
  rawSource?: LabDataReportRawSource
  /** The reporter asked for raw rows but they could not be read. */
  rawSourceError?: LabDataReportRawError
}

export interface LabDataReportResponse {
  success: boolean
  reportId?: string
  /** Set on the answer to a connection test, which stores nothing. */
  connectionTest?: boolean
  error?: string
  reason?: string
}
