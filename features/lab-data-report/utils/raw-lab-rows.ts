// MediCloud raw laboratory rows for a lab-data report. The 雲端病歷 extension
// hands back the whole same-run capture (every endpoint, not de-identified);
// this module narrows it to the IMUE0060 laboratory rows at once and keeps
// only allow-listed fields, so the capture itself is never held on to.
//
// Two steps:
//   extractRawLabRows(json)  — right after the read: allowlist, identifier
//                              scan, dates parsed to day ordinals. The caller
//                              drops the JSON string afterwards.
//   assembleRawLabSource()   — at send time: dates onto the report's day
//                              axis, result fields only when values are sent.
//
// The `submitLabDataReport` Function re-validates the same shape
// (firebase-smart-on-fhir functions/src/services/lab-data-report/schema.ts).
import { stripInstitutionCodes } from './build-lab-data-report'
import { findRowIdentifier, isShortResultText } from './identifier-scan'
import {
  LAB_DATA_REPORT_MAX_RANGE_TEXT,
  LAB_DATA_REPORT_MAX_RAW_ROWS,
  LAB_DATA_REPORT_MAX_STRING,
  LAB_DATA_REPORT_MAX_VALUE_STRING,
  LAB_DATA_REPORT_RAW_S02_DATE_FIELDS,
  LAB_DATA_REPORT_RAW_S02_RESULT_FIELDS,
  LAB_DATA_REPORT_RAW_S02_TEXT_FIELDS,
  type LabDataReportRawDate,
  type LabDataReportRawDateField,
  type LabDataReportRawResultField,
  type LabDataReportRawRow,
  type LabDataReportRawSource,
  type LabDataReportRawTextField,
} from '../types'

/** IMUE0060 S02 dataset path fragment (the capture keys endpoints by path). */
const S02_PATH = /imue0060s02/i
/** Where the extension embeds the S03 history response inside the S02 body. */
const S03_SIDECAR = '_cloudWildcatchLabHistory'

const S02_TEXT = new Set<string>(LAB_DATA_REPORT_RAW_S02_TEXT_FIELDS)
const S02_RESULT = new Set<string>(LAB_DATA_REPORT_RAW_S02_RESULT_FIELDS)
const S02_DATE = new Set<string>(LAB_DATA_REPORT_RAW_S02_DATE_FIELDS)
/** Known S02 fields that are never sent. Named so that they are not reported
 *  as schema drift. */
const S02_NEVER_SENT = new Set([
  'fee_ym', 'hosp_id', 'icd_code', 'icd_cname', 'path_diag_1', 'path_diag_2', 'path_diag_3',
])
const S03_FIELDS = new Set(['assaY_NAME', 'assaY_VALUE', 'assaY_DATE', 'rn'])
const FIELD_NAME = /^[A-Za-z0-9_]{1,40}$/
const MAX_UNKNOWN_FIELDS = 20

interface ParsedDate {
  ordinal: number
  time?: string
}

/** A result field before the includeValues choice is applied. */
type ExtractedResult = { sent: string | number } | { withheld: number }

export interface RawLabRowExtract {
  source: 's02' | 's03'
  ordinal?: number
  dates: Partial<Record<LabDataReportRawDateField, ParsedDate>>
  fields: Partial<Record<LabDataReportRawTextField, string>>
  results: Partial<Record<LabDataReportRawResultField, ExtractedResult>>
}

/** What a read keeps in memory: already narrowed and scanned. */
export interface RawLabExtract {
  rows: RawLabRowExtract[]
  s02Rows: number
  s03Rows: number
  endpointStatus: { s02?: number; s03?: number }
  droppedStrings: number
  unparsedDates: number
  unknownFields: string[]
}

// ── Dates (the bridge's parseMedCloudDate formats) ────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/
const GREGORIAN_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
const ROC_SLASH = /^(\d{1,3})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/

function dayOrdinal(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day)
  const date = new Date(ms)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return ms / 86_400_000
}

function clockTime(hour?: string, minute?: string, second?: string): string | undefined {
  if (hour === undefined || minute === undefined) return undefined
  const h = Number(hour)
  const m = Number(minute)
  const s = second === undefined ? undefined : Number(second)
  if (h > 23 || m > 59 || (s !== undefined && s > 59)) return undefined
  const pad = (value: number) => String(value).padStart(2, '0')
  return s === undefined ? `${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** A source date as written — the local date the source printed, never
 *  shifted across time zones. */
export function parseRawDate(raw: unknown): ParsedDate | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  let match: RegExpExecArray | null
  let ordinal: number | null = null
  let time: string | undefined
  if ((match = ISO_DATE.exec(text))) {
    ordinal = dayOrdinal(Number(match[1]), Number(match[2]), Number(match[3]))
  } else if ((match = ISO_DATE_TIME.exec(text))) {
    ordinal = dayOrdinal(Number(match[1]), Number(match[2]), Number(match[3]))
    time = clockTime(match[4], match[5], match[6])
  } else if ((match = GREGORIAN_SLASH.exec(text))) {
    ordinal = dayOrdinal(Number(match[1]), Number(match[2]), Number(match[3]))
    time = clockTime(match[4], match[5], match[6])
  } else if ((match = ROC_SLASH.exec(text))) {
    const rocYear = Number(match[1])
    ordinal = rocYear > 0 ? dayOrdinal(rocYear + 1911, Number(match[2]), Number(match[3])) : null
    time = clockTime(match[4], match[5], match[6])
  } else if ((match = COMPACT.exec(text))) {
    ordinal = dayOrdinal(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if (ordinal === null) return null
  return { ordinal, ...(time && { time }) }
}

// ── Extraction ────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

function endpointsOf(capture: unknown): Array<{ path: string; status?: number; body: unknown }> {
  if (!isRecord(capture)) return []
  const endpoints = capture.endpoints
  if (isRecord(endpoints)) {
    return Object.entries(endpoints)
      .filter(([, endpoint]) => isRecord(endpoint))
      .map(([path, endpoint]) => ({
        path,
        status: httpStatus((endpoint as Record<string, unknown>).status),
        body: (endpoint as Record<string, unknown>).body,
      }))
  }
  // Older captures listed endpoints as an array.
  if (Array.isArray(endpoints)) {
    return endpoints
      .filter(isRecord)
      .map((endpoint) => ({
        path: String(endpoint.path ?? endpoint.url ?? ''),
        status: httpStatus(endpoint.status),
        body: endpoint.body,
      }))
  }
  return []
}

class Extractor {
  droppedStrings = 0
  unparsedDates = 0
  private unknown = new Set<string>()

  noteUnknown(name: string) {
    if (FIELD_NAME.test(name) && !findRowIdentifier(name) && this.unknown.size < MAX_UNKNOWN_FIELDS) this.unknown.add(name)
  }

  get unknownFields(): string[] {
    return [...this.unknown].sort()
  }

  /** A text field that is safe and short enough to send, else undefined. */
  text(value: unknown, maxLength: number): string | undefined {
    if (value === null || value === undefined) return undefined
    if (typeof value !== 'string' && typeof value !== 'number') return undefined
    const trimmed = String(value).trim()
    if (!trimmed) return undefined
    const clipped = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
    // The server re-scans what arrives, i.e. the clipped string.
    if (findRowIdentifier(trimmed) || findRowIdentifier(clipped)) {
      this.droppedStrings += 1
      return undefined
    }
    return clipped
  }

  /** A result: numbers stay numbers; text travels only as a short result. */
  result(value: unknown): ExtractedResult | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? { sent: value } : undefined
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (trimmed.length > LAB_DATA_REPORT_MAX_VALUE_STRING || !isShortResultText(trimmed)) {
      return { withheld: trimmed.length }
    }
    const safe = this.text(trimmed, LAB_DATA_REPORT_MAX_VALUE_STRING)
    return safe === undefined ? undefined : { sent: safe }
  }

  date(value: unknown): ParsedDate | undefined {
    if (value === null || value === undefined || value === '') return undefined
    const parsed = parseRawDate(value)
    if (!parsed) this.unparsedDates += 1
    return parsed ?? undefined
  }
}

function ordinalOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function extractS02Row(row: Record<string, unknown>, extractor: Extractor): RawLabRowExtract {
  const out: RawLabRowExtract = { source: 's02', dates: {}, fields: {}, results: {} }
  for (const [key, value] of Object.entries(row)) {
    if (S02_TEXT.has(key)) {
      // `hosp` is the performer display's source ("院所;科別;0601160016"):
      // only the 10-digit 醫事機構代碼 segment comes out, as for performer.
      const source = key === 'hosp' && typeof value === 'string' ? stripInstitutionCodes(value) : value
      const text = extractor.text(source, key === 'consult_value' ? LAB_DATA_REPORT_MAX_RANGE_TEXT : LAB_DATA_REPORT_MAX_STRING)
      if (text !== undefined) out.fields[key as LabDataReportRawTextField] = text
    } else if (S02_RESULT.has(key)) {
      const result = extractor.result(value)
      if (result) out.results[key as LabDataReportRawResultField] = result
    } else if (S02_DATE.has(key)) {
      const date = extractor.date(value)
      if (date) out.dates[key as LabDataReportRawDateField] = date
    } else if (key === 'r') {
      const ordinal = ordinalOf(value)
      if (ordinal !== undefined) out.ordinal = ordinal
    } else if (!S02_NEVER_SENT.has(key)) {
      extractor.noteUnknown(key)
    }
  }
  return out
}

function extractS03Row(row: Record<string, unknown>, extractor: Extractor): RawLabRowExtract {
  const out: RawLabRowExtract = { source: 's03', dates: {}, fields: {}, results: {} }
  const name = extractor.text(row.assaY_NAME, LAB_DATA_REPORT_MAX_STRING)
  if (name !== undefined) out.fields.assaY_NAME = name
  const result = extractor.result(row.assaY_VALUE)
  if (result) out.results.assaY_VALUE = result
  const date = extractor.date(row.assaY_DATE)
  if (date) out.dates.assaY_DATE = date
  const ordinal = ordinalOf(row.rn)
  if (ordinal !== undefined) out.ordinal = ordinal
  for (const key of Object.keys(row)) if (!S03_FIELDS.has(key)) extractor.noteUnknown(key)
  return out
}

/**
 * Narrow a raw capture to its laboratory rows. Returns null when the capture
 * has no IMUE0060 laboratory source at all. Throws nothing: an unreadable
 * capture is simply "no laboratory source".
 */
export function extractRawLabRows(captureJson: string): RawLabExtract | null {
  const capture = parseJsonText(captureJson)
  const extractor = new Extractor()
  const rows: RawLabRowExtract[] = []
  const endpointStatus: RawLabExtract['endpointStatus'] = {}
  let s02Rows = 0
  let s03Rows = 0
  let found = false

  for (const endpoint of endpointsOf(capture)) {
    if (!S02_PATH.test(endpoint.path)) continue
    found = true
    if (endpoint.status !== undefined) endpointStatus.s02 = endpoint.status
    const body = parseJsonText(endpoint.body)
    if (!isRecord(body)) continue
    const s02 = Array.isArray(body.robject) ? body.robject.filter(isRecord) : []
    s02Rows += s02.length
    for (const row of s02) rows.push(extractS02Row(row, extractor))

    const sidecar = body[S03_SIDECAR]
    if (!isRecord(sidecar)) continue
    const status = httpStatus(sidecar.status)
    if (status !== undefined) endpointStatus.s03 = status
    const history = parseJsonText(sidecar.body)
    const s03 = Array.isArray(history) ? history.filter(isRecord) : []
    s03Rows += s03.length
    for (const row of s03) rows.push(extractS03Row(row, extractor))
  }
  if (!found) return null

  return {
    rows,
    s02Rows,
    s03Rows,
    endpointStatus,
    droppedStrings: extractor.droppedStrings,
    unparsedDates: extractor.unparsedDates,
    unknownFields: extractor.unknownFields,
  }
}

// ── Assembly at send time ─────────────────────────────────────────────────

export interface AssembleRawLabSourceOptions {
  /** The report's day 0 (a UTC day ordinal); null when no converted row is
   *  dated — the raw rows then start their own axis at their earliest date. */
  dayZero: number | null
  includeValues: boolean
  producerVersion?: string
}

/** The extension's manifest version: 1–4 dot-separated integers
 *  (chrome.runtime.getManifest().version, e.g. "0.12.19"). Like every other
 *  sent string it must also pass the identifier scan ("2026.07.04"). */
const PRODUCER_VERSION = /^\d{1,5}(?:\.\d{1,5}){0,3}$/

function safeProducerVersion(version: string | undefined): string | undefined {
  return version && PRODUCER_VERSION.test(version) && !findRowIdentifier(version) ? version : undefined
}

export function assembleRawLabSource(extract: RawLabExtract, options: AssembleRawLabSourceOptions): LabDataReportRawSource {
  const kept = extract.rows.slice(0, LAB_DATA_REPORT_MAX_RAW_ROWS)
  let zero = options.dayZero
  if (zero === null) {
    const ordinals = kept.flatMap((row) => Object.values(row.dates).map((date) => date!.ordinal))
    zero = ordinals.length > 0 ? Math.min(...ordinals) : 0
  }
  const axis = zero

  const rows: LabDataReportRawRow[] = kept.map((row, index) => {
    const dates: LabDataReportRawRow['dates'] = {}
    for (const [field, date] of Object.entries(row.dates) as Array<[LabDataReportRawDateField, ParsedDate]>) {
      const out: LabDataReportRawDate = { day: date.ordinal - axis }
      if (date.time) out.time = date.time
      dates[field] = out
    }
    const results: LabDataReportRawRow['results'] = {}
    const withheld: LabDataReportRawRow['withheld'] = {}
    for (const [field, result] of Object.entries(row.results) as Array<[LabDataReportRawResultField, ExtractedResult]>) {
      if ('sent' in result && options.includeValues) results[field] = result.sent
      else withheld[field] = 'sent' in result ? String(result.sent).length : result.withheld
    }
    return {
      ref: index + 1,
      source: row.source,
      ...(row.ordinal !== undefined && { ordinal: row.ordinal }),
      dates,
      fields: { ...row.fields },
      results,
      withheld,
    }
  })

  return {
    producer: 'medcloud2',
    ...(safeProducerVersion(options.producerVersion) && { producerVersion: options.producerVersion }),
    rows,
    s02Rows: extract.s02Rows,
    s03Rows: extract.s03Rows,
    endpointStatus: { ...extract.endpointStatus },
    truncatedRows: Math.max(0, extract.rows.length - kept.length),
    droppedStrings: extract.droppedStrings,
    unparsedDates: extract.unparsedDates,
    unknownFields: [...extract.unknownFields],
  }
}
