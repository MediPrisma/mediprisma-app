// Builds the de-identified lab-data problem report from the Observations the
// cumulative report is showing — every laboratory row of every panel, since
// one mis-filed result usually shows up in two panels at once. Pure — no
// React, no network — so the dialog preview and the sent payload are
// literally the same object.
//
// Panel and column come from the SAME two functions the cumulative table uses
// (categorizeObservationWithReason → panel, getLabPivotTestIdentity → column),
// so "the rows in 尿液" here are the rows the clinician is looking at.
import {
  categorizeObservationWithReason,
  LAB_CATEGORIES,
  type LabCategoryDecision,
} from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import type { AnalyteNameMode } from '@voho0000/clinical-lab-normalization/display'
import { findRowIdentifier, isShortResultText } from './identifier-scan'
import { isLaboratoryObservation } from './laboratory-scope'
import {
  LAB_DATA_REPORT_MAX_RANGE_TEXT,
  LAB_DATA_REPORT_MAX_ROWS,
  LAB_DATA_REPORT_MAX_STRING,
  LAB_DATA_REPORT_MAX_VALUE_STRING,
  LAB_DATA_REPORT_SCHEMA_VERSION,
  type LabDataReportCoding,
  type LabDataReportContext,
  type LabDataReportDataSource,
  type LabDataReportPayload,
  type LabDataReportProblemType,
  type LabDataReportReferenceRange,
  type LabDataReportRow,
  type LabDataReportValue,
} from '../types'

// ── Source metadata whitelist ─────────────────────────────────────────────
// Only these bridge extensions and tags travel. Anything else on the
// Observation — including every reference, id, note and the absolute
// nhi-visit-date tag — is never read into the report.

const MEDCLOUD_SD = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/'
const REPORT_INSTANCE_TIME_URL = `${MEDCLOUD_SD}medcloud-source-report-instance-time`

type ExtensionReader = (extension: any) => string | undefined

const stringValue: ExtensionReader = (extension) =>
  typeof extension?.valueString === 'string' ? extension.valueString : undefined

const SOURCE_EXTENSIONS: ReadonlyArray<readonly [string, ExtensionReader]> = [
  ['medcloud-source-assay-category', stringValue],
  ['medcloud-source-inspect-mode', stringValue],
  ['medcloud-source-data-mark', stringValue],
  ['medcloud-source-system', (extension) => {
    const codings: any[] = extension?.valueCodeableConcept?.coding ?? []
    return codings.map((coding) => coding?.code).find((code) => typeof code === 'string')
  }],
  // The MediCloud endpoint the row came from — its path only.
  ['medcloud-historical-lab-source', (extension) => {
    if (typeof extension?.valueUri !== 'string') return undefined
    try {
      return new URL(extension.valueUri).pathname.replace(/^\/imu\/api\//, '')
    } catch {
      return undefined
    }
  }],
  // How many source rows the bridge merged into this Observation. The row
  // digests themselves never travel.
  ['medcloud-lab-source-copy', (extension) => {
    const parts: any[] = Array.isArray(extension?.extension) ? extension.extension : []
    const rows = parts.filter((part) => part?.url === 'sourceRow').length
    return rows > 0 ? String(rows) : undefined
  }],
]

const SOURCE_TAG_SYSTEMS: Readonly<Record<string, string>> = {
  'http://nhi-fhir-bridge/source-program': 'source-program',
  'http://nhi-fhir-bridge/nhi-source-channel': 'nhi-source-channel',
  'http://nhi-fhir-bridge/dedup-provenance': 'dedup-provenance',
  'http://nhi-fhir-bridge/nhi-source-occurrence-count': 'nhi-source-occurrence-count',
  'https://nhi-fhir-bridge.github.io/CodeSystem/sdk-unit-origin': 'sdk-unit-origin',
  'https://cloud-wildcatch.invalid/fhir/source-program': 'source-program',
  'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module': 'source-module',
  'https://cloud-wildcatch.invalid/fhir/CodeSystem/adapter-version': 'adapter-version',
  'https://cloud-wildcatch.invalid/fhir/CodeSystem/data-class': 'data-class',
  'https://cloud-wildcatch.invalid/fhir/CodeSystem/data-quality': 'data-quality',
  'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-reconciliation': 'source-reconciliation',
}

// ── Candidate collection ─────────────────────────────────────────────────

export interface LabDataReportCandidate {
  observation: any
  decidedBy: LabCategoryDecision
  categoryId: string
  mapKey: string
  testKey: string
  /** The column label the table header shows for this row. */
  column: string
}

export interface LabDataReportCandidates {
  candidates: LabDataReportCandidate[]
  /** Laboratory rows per panel, before any cap. */
  rowsByCategory: Record<string, number>
  /** Rows shown in a lab panel whose FHIR category is not laboratory. */
  excludedNonLabRows: number
}

/** Resolves the column label the table header shows for a pivot identity. */
export type LabDataReportLabelResolver = (identity: {
  mapKey: string
  testKey: string
  displayName: string
  displaySource: { code?: any }
}) => string

const defaultLabel: LabDataReportLabelResolver = (identity) => identity.displayName

/**
 * Every laboratory row the cumulative report files into a panel, in one pass.
 * The panel and column come from the same two functions the table uses
 * (categorizeObservationWithReason, getLabPivotTestIdentity).
 */
export function collectLabDataReportCandidates(
  observations: readonly any[],
  nameMode: AnalyteNameMode,
  resolveLabel: LabDataReportLabelResolver = defaultLabel,
): LabDataReportCandidates {
  const pending: Array<Omit<LabDataReportCandidate, 'column'> & { displayName: string }> = []
  const rowsByCategory: Record<string, number> = {}
  // Same rule as the pivot: the shortest source label names the column.
  const columns = new Map<string, { testKey: string; mapKey: string; sourceName: string; displaySource: { code?: any } }>()
  let excludedNonLabRows = 0

  for (const observation of observations) {
    if (observation?.resourceType && observation.resourceType !== 'Observation') continue
    const { category, decidedBy } = categorizeObservationWithReason(observation)
    if (!category) continue
    // Policy boundary: laboratory results only, by FHIR category. A vital
    // sign, survey or uncategorised row that a panel rule pulled into the
    // table is counted, never sent.
    if (!isLaboratoryObservation(observation)) {
      excludedNonLabRows += 1
      continue
    }
    const identity = getLabPivotTestIdentity(observation, category.id, nameMode)
    pending.push({
      observation,
      decidedBy,
      categoryId: category.id,
      mapKey: identity.mapKey,
      testKey: identity.testKey,
      displayName: identity.displayName,
    })
    rowsByCategory[category.id] = (rowsByCategory[category.id] ?? 0) + 1
    const columnKey = `${category.id}\u0000${identity.mapKey}`
    const existing = columns.get(columnKey)
    if (!existing || identity.displayName.length < existing.sourceName.length) {
      columns.set(columnKey, {
        testKey: identity.testKey,
        mapKey: identity.mapKey,
        sourceName: identity.displayName,
        displaySource: { code: observation.code },
      })
    }
  }

  const labels = new Map<string, string>()
  for (const [columnKey, column] of columns) {
    labels.set(columnKey, resolveLabel({
      mapKey: column.mapKey,
      testKey: column.testKey,
      displayName: column.sourceName,
      displaySource: column.displaySource,
    }) || column.sourceName)
  }

  return {
    candidates: pending.map(({ displayName, ...candidate }) => ({
      ...candidate,
      column: labels.get(`${candidate.categoryId}\u0000${candidate.mapKey}`) ?? displayName,
    })),
    rowsByCategory,
    excludedNonLabRows,
  }
}

// ── Row building ─────────────────────────────────────────────────────────

interface StringBudget {
  dropped: number
}

/** Returns the string when it is safe and short enough to send. */
function safeText(
  value: unknown,
  budget: StringBudget,
  maxLength = LAB_DATA_REPORT_MAX_STRING,
): string | undefined {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  if (!trimmed) return undefined
  const clipped = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
  // Scan both: the server re-scans what arrives, i.e. the clipped string.
  if (findRowIdentifier(trimmed) || findRowIdentifier(clipped)) {
    budget.dropped += 1
    return undefined
  }
  return clipped
}

const QUANTITY_COMPARATORS = new Set(['<', '<=', '>=', '>', 'ad'])

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function effectiveInstant(observation: any): string | undefined {
  const value = observation?.effectiveDateTime ?? observation?.effectivePeriod?.start
  return typeof value === 'string' ? value : undefined
}

function dateOrdinal(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const ordinal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000
  return Number.isFinite(ordinal) ? ordinal : null
}

function timeOfDay(value: string | undefined): string | undefined {
  return value?.match(/T(\d{2}:\d{2}(?::\d{2})?)/)?.[1]
}

function decimalsOf(value: number): number {
  const text = String(value)
  if (/e/i.test(text)) {
    const [mantissa, exponent] = text.toLowerCase().split('e')
    const fraction = mantissa.split('.')[1]?.length ?? 0
    return Math.max(0, fraction - Number(exponent))
  }
  return text.split('.')[1]?.length ?? 0
}

function describeValue(observation: any, includeValues: boolean, budget: StringBudget): {
  value: LabDataReportValue
  /** Identity of the result, for grouping identical results. */
  identity: string | null
} {
  const quantity = observation?.valueQuantity
  const quantityValue = finiteNumber(quantity?.value)
  if (quantityValue !== undefined) {
    const comparator = QUANTITY_COMPARATORS.has(quantity.comparator) ? quantity.comparator as string : undefined
    return {
      value: {
        kind: 'quantity',
        ...(includeValues && { value: quantityValue }),
        ...(comparator && { comparator }),
        magnitude: quantityValue === 0 ? null : clamp(Math.floor(Math.log10(Math.abs(quantityValue))), -30, 30),
        decimals: clamp(decimalsOf(quantityValue), 0, 30),
      },
      identity: `q|${comparator ?? ''}${quantityValue}|${quantity.unit ?? quantity.code ?? ''}`,
    }
  }
  const range = observation?.valueRange
  if (range && (finiteNumber(range.low?.value) !== undefined || finiteNumber(range.high?.value) !== undefined)) {
    const low = finiteNumber(range.low?.value)
    const high = finiteNumber(range.high?.value)
    return {
      value: { kind: 'range', ...(includeValues && low !== undefined && { low }), ...(includeValues && high !== undefined && { high }) },
      identity: `r|${low ?? ''}|${high ?? ''}`,
    }
  }
  if (typeof observation?.valueString === 'string') {
    const raw = observation.valueString.trim()
    const short = raw.length <= LAB_DATA_REPORT_MAX_VALUE_STRING && isShortResultText(raw)
      ? safeText(raw, budget, LAB_DATA_REPORT_MAX_VALUE_STRING)
      : undefined
    return {
      value: { kind: 'string', ...(includeValues && short !== undefined && { value: short }), length: raw.length },
      identity: raw ? `s|${raw.normalize('NFKC').toLowerCase()}` : null,
    }
  }
  const concept = observation?.valueCodeableConcept
  if (concept) {
    const coding = Array.isArray(concept.coding) ? concept.coding.find((c: any) => c?.code) : undefined
    const rawText = typeof concept.text === 'string' ? concept.text : coding?.display
    const text = typeof rawText === 'string'
      && rawText.trim().length <= LAB_DATA_REPORT_MAX_VALUE_STRING
      && isShortResultText(rawText)
      ? safeText(rawText, budget, LAB_DATA_REPORT_MAX_VALUE_STRING)
      : undefined
    const code = safeText(coding?.code, budget, LAB_DATA_REPORT_MAX_VALUE_STRING)
    return {
      value: {
        kind: 'coded',
        ...(includeValues && code !== undefined && { code }),
        ...(includeValues && text !== undefined && { text }),
      },
      identity: `c|${coding?.code ?? ''}|${String(rawText ?? '').normalize('NFKC').toLowerCase()}`,
    }
  }
  const valueKey = Object.keys(observation ?? {}).find((key) => key.startsWith('value'))
  if (valueKey) return { value: { kind: 'other', type: valueKey.slice('value'.length) }, identity: null }
  return { value: { kind: 'none' }, identity: null }
}

function readCodings(codings: unknown, budget: StringBudget): LabDataReportCoding[] {
  if (!Array.isArray(codings)) return []
  return codings.slice(0, 10).map((coding: any) => {
    const system = safeText(coding?.system, budget)
    const code = safeText(coding?.code, budget)
    const display = safeText(coding?.display, budget)
    return {
      ...(system && { system }),
      ...(code && { code }),
      ...(display && { display }),
    }
  }).filter((coding) => Object.keys(coding).length > 0)
}

function readCategories(categories: unknown, budget: StringBudget): string[] {
  const list = Array.isArray(categories) ? categories : categories ? [categories] : []
  // "laboratory" first: the server checks for it, so the cap never cuts it.
  const codes = new Set<string>(['laboratory'])
  for (const concept of list) {
    for (const coding of Array.isArray((concept as any)?.coding) ? (concept as any).coding : []) {
      const code = safeText(coding?.code, budget, 64)
      if (code) codes.add(code)
    }
  }
  return [...codes].slice(0, 8)
}

function readInterpretation(interpretation: unknown): string[] {
  const list = Array.isArray(interpretation) ? interpretation : interpretation ? [interpretation] : []
  const codes = new Set<string>()
  for (const concept of list) {
    for (const coding of Array.isArray((concept as any)?.coding) ? (concept as any).coding : []) {
      if (typeof coding?.code === 'string' && /^[A-Za-z<>=+-]{1,8}$/.test(coding.code)) codes.add(coding.code)
    }
  }
  return [...codes].slice(0, 5)
}

function readReferenceRanges(ranges: unknown, budget: StringBudget): LabDataReportReferenceRange[] {
  if (!Array.isArray(ranges)) return []
  return ranges.slice(0, 3).map((range: any) => {
    const low = finiteNumber(range?.low?.value)
    const high = finiteNumber(range?.high?.value)
    const unit = safeText(range?.low?.unit ?? range?.high?.unit, budget, 64)
    const rawText = typeof range?.text === 'string' ? range.text.trim() : ''
    const text = rawText && rawText.length <= LAB_DATA_REPORT_MAX_RANGE_TEXT
      ? safeText(rawText, budget, LAB_DATA_REPORT_MAX_RANGE_TEXT)
      : undefined
    return {
      ...(low !== undefined && { low }),
      ...(high !== undefined && { high }),
      ...(unit && { unit }),
      ...(text && { text }),
    }
  }).filter((range) => Object.keys(range).length > 0)
}

function readSourceExtensions(observation: any, budget: StringBudget): { name: string; value: string }[] {
  const extensions: any[] = Array.isArray(observation?.extension) ? observation.extension : []
  const result: { name: string; value: string }[] = []
  for (const extension of extensions) {
    const url = typeof extension?.url === 'string' ? extension.url : ''
    if (!url.startsWith(MEDCLOUD_SD)) continue
    const name = url.slice(MEDCLOUD_SD.length)
    const reader = SOURCE_EXTENSIONS.find(([known]) => known === name)?.[1]
    if (!reader) continue
    const value = safeText(reader(extension), budget, 120)
    if (value) result.push({ name, value })
  }
  return result.slice(0, 12)
}

function readSourceTime(observation: any, rowDay: number | null): { dayDelta: number; time: string } | undefined {
  const extensions: any[] = Array.isArray(observation?.extension) ? observation.extension : []
  const raw = extensions.find((extension) => extension?.url === REPORT_INSTANCE_TIME_URL)?.valueString
  if (typeof raw !== 'string' || rowDay === null) return undefined
  const day = dateOrdinal(raw)
  const time = timeOfDay(raw)
  if (day === null || !time || Math.abs(day - rowDay) > 3660) return undefined
  return { dayDelta: day - rowDay, time }
}

function readSourceTags(observation: any, budget: StringBudget): string[] {
  const tags: any[] = Array.isArray(observation?.meta?.tag) ? observation.meta.tag : []
  const result = new Set<string>()
  for (const tag of tags) {
    const name = typeof tag?.system === 'string' ? SOURCE_TAG_SYSTEMS[tag.system] : undefined
    if (!name) continue
    const code = safeText(tag.code, budget, 80)
    if (code) result.add(`${name}:${code}`)
  }
  return [...result].slice(0, 16)
}

// The bridges print the 10-digit 醫事機構代碼 as its own segment of the
// performer display: "院所;科別;0601160016", "院所 / 科別 / 0936050029".
// Only this field is known to carry one, so only here is it taken out — the
// segment and the one separator before it, nothing else. Every other
// character stays as the source wrote it (a "/" inside "65/3/12" must stay a
// "/"), so the rest of the string gets the same scan as every other and a
// date, chart or mobile number anywhere else still drops it.
const INSTITUTION_CODE_SEGMENT = /(?:^|\s*[;/|]\s*)\d{10}(?=\s*(?:[;/|]|$))/g

export function stripInstitutionCodes(display: string): string {
  // NFKC first: full-width ；／｜ and digits become their ASCII forms.
  return display
    .normalize('NFKC')
    .replace(INSTITUTION_CODE_SEGMENT, '')
    .replace(/^\s*[;/|]\s*/, '')
    .trim()
}

function readPerformers(observation: any, budget: StringBudget): string[] {
  const performers: any[] = Array.isArray(observation?.performer) ? observation.performer : []
  const names = new Set<string>()
  for (const performer of performers) {
    const display = typeof performer?.display === 'string' ? stripInstitutionCodes(performer.display) : undefined
    const name = safeText(display, budget, 120)
    if (name) names.add(name)
  }
  return [...names].slice(0, 3)
}

// ── Payload ──────────────────────────────────────────────────────────────

export interface BuildLabDataReportOptions {
  problemType: LabDataReportProblemType
  description: string
  includeValues: boolean
  context: LabDataReportContext
  /** Panels in the clinician's order; rows follow it. Panels missing here
   *  sort after, in LAB_CATEGORIES order. */
  categoryOrder?: readonly string[]
  /** Panels the reporter ticked. Kept whole if the row cap bites. */
  flaggedCategories?: readonly string[]
}

export interface BuiltLabDataReport {
  payload: LabDataReportPayload
  /** Laboratory rows before the cap. */
  totalRows: number
  /** The report's day 0 as a UTC day ordinal (never sent): raw source rows
   *  are placed on the same axis. Null when no row is dated. */
  dayZero: number | null
}

export function buildLabDataReport(
  collected: LabDataReportCandidates,
  options: BuildLabDataReportOptions,
): BuiltLabDataReport {
  const flagged = new Set(options.flaggedCategories ?? [])
  const order = [
    ...(options.categoryOrder ?? []),
    ...LAB_CATEGORIES.map((category) => category.id),
  ]
  const rank = (categoryId: string) => {
    const index = order.indexOf(categoryId)
    return index === -1 ? order.length : index
  }
  const newestFirst = (a: LabDataReportCandidate, b: LabDataReportCandidate) =>
    (effectiveInstant(b.observation) ?? '').localeCompare(effectiveInstant(a.observation) ?? '')

  // Under the cap, flagged panels are kept whole; the rest keep their newest
  // rows. Real patients stay far below it, so normally everything is sent.
  let kept = collected.candidates
  if (kept.length > LAB_DATA_REPORT_MAX_ROWS) {
    const [mustKeep, rest] = [
      kept.filter((candidate) => flagged.has(candidate.categoryId)),
      kept.filter((candidate) => !flagged.has(candidate.categoryId)).sort(newestFirst),
    ]
    kept = [...mustKeep, ...rest].slice(0, LAB_DATA_REPORT_MAX_ROWS)
  }
  // Panel by panel in the clinician's order, newest first inside a panel.
  kept = kept
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => rank(a.candidate.categoryId) - rank(b.candidate.categoryId)
      || newestFirst(a.candidate, b.candidate)
      || a.index - b.index)
    .map(({ candidate }) => candidate)

  // One day axis for the whole report, so the same draw lines up across
  // panels (WBC in 血液 and in 尿液 on the same day).
  const ordinals = kept
    .map((candidate) => dateOrdinal(effectiveInstant(candidate.observation)))
    .filter((ordinal): ordinal is number => ordinal !== null)
  const dayZero = ordinals.length > 0 ? Math.min(...ordinals) : null

  const budget: StringBudget = { dropped: 0 }
  const identities: Array<string | null> = []
  const rows: LabDataReportRow[] = kept.map((candidate, index) => {
    const observation = candidate.observation
    const instant = effectiveInstant(observation)
    const ordinal = dateOrdinal(instant)
    const { value, identity } = describeValue(observation, options.includeValues, budget)
    identities.push(identity)
    const time = timeOfDay(instant)
    const sourceTime = readSourceTime(observation, ordinal)
    const specimen = safeText(observation?.specimen?.display, budget, 120)
    const status = typeof observation?.status === 'string' && /^[a-z-]{1,24}$/.test(observation.status)
      ? observation.status
      : undefined
    const unit = safeText(observation?.valueQuantity?.unit, budget, 64)
    const unitCode = safeText(observation?.valueQuantity?.code, budget, 64)
    const codeText = safeText(observation?.code?.text, budget)
    const column = safeText(candidate.column, budget) ?? ''
    const testKey = safeText(candidate.testKey, budget) ?? ''
    return {
      ref: index + 1,
      day: ordinal !== null && dayZero !== null ? ordinal - dayZero : null,
      ...(time && { timeOfDay: time }),
      ...(sourceTime && { sourceTime }),
      performer: readPerformers(observation, budget),
      code: {
        ...(codeText && { text: codeText }),
        codings: readCodings(observation?.code?.coding, budget),
      },
      category: readCategories(observation?.category, budget),
      ...(specimen && { specimen }),
      ...(status && { status }),
      ...(unit && { unit }),
      ...(unitCode && { unitCode }),
      value,
      interpretation: readInterpretation(observation?.interpretation),
      referenceRange: readReferenceRanges(observation?.referenceRange, budget),
      sourceExtensions: readSourceExtensions(observation, budget),
      sourceTags: readSourceTags(observation, budget),
      app: {
        categoryId: candidate.categoryId,
        decidedBy: candidate.decidedBy,
        testKey,
        column,
      },
    }
  })

  // Identical results share a group number — the signal for a duplicated
  // cell ("4.41 / 4.41") or one result filed in two panels — whether or not
  // the values themselves are sent.
  const counts = new Map<string, number>()
  for (const identity of identities) if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1)
  const groupNumbers = new Map<string, number>()
  rows.forEach((row, index) => {
    const identity = identities[index]
    if (!identity || (counts.get(identity) ?? 0) < 2) return
    if (!groupNumbers.has(identity)) groupNumbers.set(identity, groupNumbers.size + 1)
    row.sameValueGroup = groupNumbers.get(identity)
  })

  const sentByCategory = new Map<string, number>()
  for (const row of rows) {
    const id = row.app.categoryId ?? ''
    sentByCategory.set(id, (sentByCategory.get(id) ?? 0) + 1)
  }

  return {
    totalRows: collected.candidates.length,
    dayZero,
    payload: {
      schemaVersion: LAB_DATA_REPORT_SCHEMA_VERSION,
      problemType: options.problemType,
      description: options.description.trim(),
      includesValues: options.includeValues,
      scope: {
        flaggedCategories: [...flagged].filter((id) => (collected.rowsByCategory[id] ?? 0) > 0),
        categories: [...sentByCategory.entries()].map(([categoryId, count]) => ({ categoryId, rows: count })),
      },
      context: options.context,
      rows,
      truncatedRows: Math.max(0, collected.candidates.length - kept.length),
      excludedNonLabRows: collected.excludedNonLabRows,
      droppedStrings: budget.dropped,
    },
  }
}

// ── Context helpers ──────────────────────────────────────────────────────

/**
 * Where the rows came from, read from the rows themselves: the two bridges
 * stamp their Observations, so an imported MediCloud file and the live
 * MediCloud route both read as `medcloud`.
 */
export function detectLabDataSource(
  observations: readonly any[],
  launchSource: string | undefined,
): LabDataReportDataSource {
  let medcloud = false
  let nhi = false
  for (const observation of observations) {
    const tags: any[] = Array.isArray(observation?.meta?.tag) ? observation.meta.tag : []
    const extensions: any[] = Array.isArray(observation?.extension) ? observation.extension : []
    const source = typeof observation?.meta?.source === 'string' ? observation.meta.source : ''
    if (
      source.includes('medcloud')
      || tags.some((tag) => typeof tag?.system === 'string' && tag.system.startsWith('https://cloud-wildcatch.invalid/'))
      || extensions.some((extension) => typeof extension?.url === 'string' && extension.url.startsWith(MEDCLOUD_SD))
    ) medcloud = true
    else if (
      source.startsWith('nhi-fhir-bridge')
      || tags.some((tag) => typeof tag?.system === 'string' && tag.system.startsWith('http://nhi-fhir-bridge/'))
    ) nhi = true
    if (medcloud) break
  }
  if (medcloud || launchSource === 'medcloud2') return 'medcloud'
  if (nhi) return 'nhi'
  if (launchSource === 'smart' || launchSource === 'demo' || launchSource === 'import') return launchSource
  return 'unknown'
}
