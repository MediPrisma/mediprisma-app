import { clinicalEncounterAlias } from '@/src/infrastructure/fhir/mappers/clinical-projection-disposition'
import { excludeUnresolvedDecisionVariants, formatClinicalVariantExclusions, outboundClinicalVariantExclusions } from '@/src/core/utils/clinical-variant-inputs'
import { clinicalRecordKey } from '@/src/core/utils/observation-selectors'
import { clinicalSourceNodesEqualWithContext } from '@/src/core/services/clinical-source-context'
// Unified FHIR Tools for AI Agent
//
// Single implementation backing BOTH SMART-live mode and local-bundle mode.
// Both modes populate the React Query / LocalBundleService cache with a
// `ClinicalDataCollection`; the tool layer reads from that snapshot.
//
// Every tool response goes through `scrubPii()` so cloud LLMs never see
// patient ID, DOB, or provider names.
import { tool } from 'ai'
import { sourceSelfPurchase } from '@/src/shared/utils/medication-source-markers'
import { sourceComparisonNarrative } from '@/src/shared/utils/source-record-comparison'
import { summarizeSourceComparisons } from '@/src/shared/utils/source-record-comparison'
import type { z } from 'zod'
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import type {
  ClinicalDataCollection,
  ClinicalDataQueryKey,
  ClinicalDataQueryStatus,
  MedicationEntity,
} from '@/src/core/entities/clinical-data.entity'
import {
  conditionsSchema,
  medicationsSchema,
  allergiesSchema,
  observationsSchema,
  proceduresSchema,
  encountersSchema,
  diagnosticReportsSchema,
  labResultsByCategorySchema,
  imagingRecordsSchema,
  immunizationsSchema,
  patientInfoSchema,
  healthSummarySnapshotSchema,
  encounterDetailsSchema,
  encounterDiagnosisSearchSchema,
  activeMedicationsSchema,
  observationSearchSchema,
  recentVisitsSchema,
  overviewSchema,
  listDepartmentsSchema,
  listObservationCodesSchema,
} from './fhir-tool-schemas'
import {
  isWithinDateRange,
  matchCategoryCoding,
  matchClinicalStatus,
  matchStatus,
  isChronicByCourseOfTherapy,
  matchChronic,
  matchEncounterClass,
  matchDiagnosticReportCategory,
  matchAllergyType,
  matchAllergySeverity,
  matchSubstring,
  isAbnormalObservation,
  applyLimit,
} from './_filter-helpers'
import { scrubPii } from './_scrub-pii'
import { CANONICAL_KEYS, canonicalKeyFromLoinc, canonicalTestKeyFromString } from '@voho0000/clinical-lab-normalization/canonical'
import { buildPatientTextLiterals } from '@/src/shared/utils/pii-text-scrub'
import {
  medicationClinicalIdentityKey,
  pickAiMedicationName,
} from '@/src/shared/utils/fhir-display-helpers'
import { isNhiDrugCodeSystem } from '@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service'
import {
  assessMedicationCurrentness,
  isMedicationCurrentlyInUse,
  isMedicationCurrentnessUncertain,
  medicationExpectedEnd,
  normalizeClinicalStatus,
} from '@/src/core/utils/clinical-context-selection.utils'
import { referenceId } from '@/src/core/utils/observation-selectors'
import {
  imagingStudyModalityText,
  imagingStudyTitle,
} from '@/src/shared/utils/imaging-study.utils'
import { decodeBase64, stripHtmlToText } from '@/src/core/utils/clinical-documents.utils'
import {
  LAB_CATEGORIES,
  categorizeObservation,
  getTestDisplayName,
  compareTestsByPreferred,
  isExcludedFromCumulativeReport,
} from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity, isKnownPivotKey } from '@/src/shared/utils/lab-pivot.utils'
import { IMMUNOLOGY_LOINC_SCALE, IMMUNOLOGY_LOINC_TO_KEY } from '@/src/shared/utils/immunology-analytes'
import { THYROID_LOINC_SCALE, THYROID_LOINC_TO_KEY } from '@/src/shared/utils/thyroid-analytes'
import { isOrdinalValue } from '@/src/shared/utils/qualitative-value'
import {
  foldNumericText,
  isPercentQuantity,
  NUMERIC_TEXT_RE,
  PERCENT_UNIT_PREFIX_RE,
} from '@/src/shared/utils/lab-value-grammar'
import { isParaproteinTextKey, PARAPROTEIN_PREFIX } from '@/src/shared/utils/paraprotein-analytes'
import { isNhiOrderCodeSystem, meaningfulLocalCode } from '@/src/shared/utils/nhi-order-code'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'
import {
  getAnalyteCanonicalKey,
  getAnalyteLabel,
} from '@voho0000/clinical-lab-normalization/canonical'
import {
  expandObservationValues,
  observationDisplayValue,
} from '@/src/core/utils/observation-value.utils'
import {
  getAuditedReferenceRangeBounds,
  getInterpretationTag,
} from '@voho0000/clinical-lab-normalization/interpretation'

export interface AgentDataSource {
  patient: PatientEntity | null
  collection: ClinicalDataCollection | null
}

// ── helpers ────────────────────────────────────────────────────────────────

function pickName(concept: any): string | undefined {
  return concept?.text || concept?.coding?.[0]?.display
}

/**
 * Every canonical analyte key a concept can be known by: its LOINC, and each
 * text / display run through the shared alias table. A record coded LOINC
 * 3094-0 with display "Urea nitrogen [Mass/volume] in Serum or Plasma" and
 * text 「血中尿素氮」 is therefore reachable as BUN; a substring search for
 * "BUN" alone finds none of those three strings and reports an absence the
 * record contradicts.
 */
function conceptAnalyteKeys(concept: any): Set<string> {
  const keys = new Set<string>()
  const fromLoinc = canonicalKeyFromLoinc({ code: concept })
  if (fromLoinc) keys.add(fromLoinc)
  for (const raw of [concept?.text, ...((concept?.coding ?? []).map((coding: any) => coding?.display))]) {
    if (typeof raw !== 'string' || !raw) continue
    const key = canonicalTestKeyFromString(raw)
    if (CANONICAL_KEYS.has(key)) keys.add(key)
  }
  return keys
}

/** Query spellings the shared table does not carry but clinicians type daily. */
const QUERY_ANALYTE_ALIASES: Record<string, string> = {
  CR: 'CREA',
  SCR: 'CREA',
  'S-CR': 'CREA',
}

/** The canonical analyte a free-text query names, if the alias table knows it.
 * A specimen word in front ("blood urea nitrogen", "serum potassium") or a
 * "level" behind it does not change which analyte is meant. */
function queryAnalyteKey(query: string | undefined): string | undefined {
  if (!query) return undefined
  const candidates = [query]
  const trimmed = query
    .normalize('NFKC')
    .replace(/^\s*(?:whole\s+blood|blood|serum|plasma|venous|arterial|s\.|b\.)\s+/i, '')
    .replace(/\s+(?:levels?|values?|concentration)\s*$/i, '')
    .trim()
  if (trimmed && trimmed !== query) candidates.push(trimmed)
  for (const candidate of candidates) {
    const direct = QUERY_ANALYTE_ALIASES[candidate.toUpperCase()]
    if (direct) return direct
    const key = canonicalTestKeyFromString(candidate)
    if (CANONICAL_KEYS.has(key)) return key
  }
  return undefined
}

/** Substring match on the concept's names and codes, or the same analyte by alias. */
function conceptMatchesQuery(concept: any, query: string | undefined): boolean {
  if (matchSubstring(conceptSearchText(concept), query)) return true
  const key = queryAnalyteKey(query)
  return key !== undefined && conceptAnalyteKeys(concept).has(key)
}

function conceptSearchText(concept: any): string {
  return [
    concept?.text,
    ...((concept?.coding ?? []).flatMap((coding: any) => [
      coding?.code,
      coding?.display,
    ])),
  ].filter(Boolean).join(' ')
}

function loincOf(concept: any): string | undefined {
  return (concept?.coding ?? []).find((c: any) => /loinc/i.test(c.system || ''))?.code
}

function notFoundMessage(noun: string, dateFrom?: string, dateTo?: string): string {
  if (dateFrom || dateTo) {
    return `在指定時間範圍內（${dateFrom || '開始'} 至 ${dateTo || '現在'}）沒有找到${noun}`
  }
  return `沒有找到${noun}`
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveMedicationDateRange(
  timeRange: z.infer<typeof medicationsSchema>['timeRange'],
  dateFrom?: string,
  dateTo?: string,
): { dateFrom?: string; dateTo?: string } {
  if (!timeRange || timeRange === 'all') return { dateFrom, dateTo }
  const daysByRange = {
    'last-30-days': 30,
    'last-90-days': 90,
    'last-180-days': 180,
    'last-365-days': 365,
  } as const
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - daysByRange[timeRange])
  return {
    dateFrom: dateFrom ?? localIsoDate(start),
    dateTo: dateTo ?? localIsoDate(today),
  }
}

function observationDate(observation: any): string | undefined {
  return observation?.effectiveDateTime
    || observation?.effectivePeriod?.start
    || observation?.issued
}

function observationConcepts(observation: any): any[] {
  return [observation?.code, ...(observation?.component ?? []).map((component: any) => component.code)]
    .filter(Boolean)
}

function uniqueObservations(collection: ClinicalDataCollection): any[] {
  const seen = new Set<string>()
  return [...collection.observations, ...collection.vitalSigns].filter((observation: any) => {
    const key = clinicalRecordKey(observation)
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    return true
  })
}

function diagnosticReportDate(report: any): string | undefined {
  return report?.effectiveDateTime
    || report?.effectivePeriod?.start
    || report?.issued
}

function paginationMeta(totalCount: number, returnedCount: number) {
  return {
    totalCount,
    returnedCount,
    truncated: returnedCount < totalCount,
    hasMore: returnedCount < totalCount,
  }
}

const COMPLETE_QUERY_STATES = new Set(['ok', 'empty'])

interface SafeQueryIssue {
  resourceType: string
  state: ClinicalDataQueryStatus['state']
  httpStatus?: number
  message?: string
}

function queryIssuesFor(
  collection: ClinicalDataCollection,
  keys: ClinicalDataQueryKey[],
): SafeQueryIssue[] {
  return keys.flatMap((key) => {
    const status = collection.resourceQueryStatus?.[key]
    if (!status || COMPLETE_QUERY_STATES.has(status.state)) return []
    return [{
      resourceType: status.resourceType,
      state: status.state,
      httpStatus: status.httpStatus,
      message: status.message,
    }]
  })
}

function unavailableQueryResult(
  collection: ClinicalDataCollection | null,
  keys: ClinicalDataQueryKey[],
  noun: string,
) {
  if (!collection) {
    return {
      success: false,
      summary: `無法確認是否有${noun}：臨床資料尚未載入完成`,
      count: 0,
      totalCount: 0,
      returnedCount: 0,
      truncated: false,
      hasMore: false,
      incomplete: true,
      canConcludeAbsence: false,
      queryIssues: [{ resourceType: keys.join(', '), state: 'not-loaded' }],
      data: [],
    }
  }

  const queryIssues = queryIssuesFor(collection, keys)
  if (queryIssues.length === 0) return null
  return {
    success: false,
    summary: `無法確認是否有${noun}：相關 FHIR 資源查詢未成功`,
    count: 0,
    totalCount: 0,
    returnedCount: 0,
    truncated: false,
    hasMore: false,
    incomplete: true,
    canConcludeAbsence: false,
    queryIssues,
    data: [],
  }
}

const attachmentDetailsCache = new WeakMap<object, any[]>()

function attachmentDetails(report: any) {
  if (report && typeof report === 'object') {
    const cached = attachmentDetailsCache.get(report)
    if (cached) return cached
  }
  const details = (report?.presentedForm ?? []).map((attachment: any, index: number) => {
    const contentType = String(attachment?.contentType || '').toLowerCase()
    const isText = contentType.includes('text')
      || contentType.includes('html')
      || contentType.includes('xml')
      || (!contentType && !!attachment?.data)
    const decoded = isText && attachment?.data ? decodeBase64(attachment.data) : ''
    const text = contentType.includes('html') || contentType.includes('xml')
      ? stripHtmlToText(decoded)
      : decoded.trim()
    const maxChars = 12_000
    return {
      title: attachment?.title || `Attachment ${index + 1}`,
      contentType: attachment?.contentType,
      kind: contentType.startsWith('image/')
        ? 'image'
        : isText
          ? 'text'
          : 'binary',
      available: !!(attachment?.data || attachment?._imageRef || attachment?.url),
      ...(text
        ? {
            text: text.slice(0, maxChars),
            textTruncated: text.length > maxChars,
          }
        : {}),
    }
  })
  if (report && typeof report === 'object') {
    attachmentDetailsCache.set(report, details)
  }
  return details
}

function observationResultFields(observation: any) {
  const displayValue = observationDisplayValue(observation)
  const interpretation = getInterpretationTag(observation?.interpretation)
  // The source interpretation is authoritative. Only expose a reference range
  // when no interpretation exists, matching the app's audited abnormality
  // policy and preventing the model from presenting contradictory verdicts.
  const referenceRange = interpretation
    ? null
    : getAuditedReferenceRangeBounds(observation?.referenceRange)
  const hasNormalityAssessment = Boolean(interpretation || referenceRange)
  const abnormal = isAbnormalObservation(observation)

  return {
    name: pickName(observation?.code) || observation?.code?.coding?.[0]?.code || 'Unknown',
    value: observation?.valueQuantity?.value
      ?? observation?.valueString
      ?? observation?.valueBoolean
      ?? observation?.valueInteger
      ?? observation?.valueDecimal
      ?? displayValue?.value,
    unit: displayValue?.unit || '',
    date: observationDate(observation),
    abnormal: hasNormalityAssessment ? abnormal : null,
    normalityStatus: interpretation?.label
      ?? (referenceRange
        ? abnormal ? 'Outside audited reference range' : 'Within audited reference range'
        : 'Not provided'),
    assessmentBasis: interpretation
      ? 'source-interpretation'
      : referenceRange
        ? 'audited-reference-range'
        : 'not-provided',
    ...(referenceRange ? { referenceRange } : {}),
    ...(observation?.dataAbsentReason ? {
      dataAbsentReason: pickName(observation.dataAbsentReason)
        || observation.dataAbsentReason.coding?.[0]?.code,
    } : {}),
  }
}

function observationComponentFields(observation: any) {
  const components = observation?.component ?? []
  if (components.length === 0) return {}
  // Keep each value with its own name, unit and assessment. A BP panel has no
  // top-level value; flattening only that field silently loses both pressures.
  // Missing components remain missing rather than borrowing an older value.
  return {
    components: components.map((component: any) => ({
      ...observationResultFields(component),
      loinc: loincOf(component.code),
    })),
  }
}

function observationResult(observation: any) {
  return {
    ...observationResultFields(observation),
    ...observationComponentFields(observation),
  }
}

function diagnosticReportSearchText(report: any): string {
  return [
    conceptSearchText(report?.code),
    report?.conclusion,
    ...((report?.conclusionCode ?? []).map(conceptSearchText)),
    ...((report?.note ?? []).map((note: any) => note?.text)),
    ...((report?._observations ?? []).map((observation: any) =>
      observationConcepts(observation).map(conceptSearchText).join(' ')
    )),
    ...attachmentDetails(report).flatMap((attachment: any) => [
      attachment.title,
      attachment.text,
    ]),
  ].filter(Boolean).join(' ')
}

function diagnosticReportQueryTerms(query?: string, queries?: string[]): string[] {
  const terms = [query, ...(queries ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .flatMap(value => value.split(/[,，、;；\n]+/))
    .map(value => value.trim())
    .filter(Boolean)

  return [...new Map(terms.map(term => [term.normalize('NFKC').toLowerCase(), term])).values()]
}

/** A report matches a term by substring anywhere in its text, or because its
 * own code or one of its result observations is the analyte the term names. */
function diagnosticReportMatchesTerm(report: any, term: string): boolean {
  if (matchSubstring(diagnosticReportSearchText(report), term)) return true
  const key = queryAnalyteKey(term)
  if (key === undefined) return false
  if (conceptAnalyteKeys(report?.code).has(key)) return true
  return (report?._observations ?? []).some((observation: any) =>
    observationConcepts(observation).some(concept => conceptAnalyteKeys(concept).has(key))
  )
}

function matchesDiagnosticReportQuery(report: any, queryTerms: string[]): boolean {
  if (queryTerms.length === 0) return true
  return queryTerms.some(term => diagnosticReportMatchesTerm(report, term))
}

function selectDiagnosticReportPage(
  reports: any[],
  queryTerms: string[],
  limit?: number,
): any[] {
  const cap = limit && limit > 0 ? limit : Math.max(10, queryTerms.length)
  if (queryTerms.length === 0) return reports.slice(0, cap)

  // A pure newest-first cap can hide one requested analyte when another has
  // many newer repeats. Reserve one representative row per matched query term
  // before filling the remaining page by recency.
  const selected: any[] = []
  const seen = new Set<any>()
  for (const term of queryTerms) {
    const representative = reports.find(report => diagnosticReportMatchesTerm(report, term))
    if (representative && !seen.has(representative)) {
      selected.push(representative)
      seen.add(representative)
    }
  }
  for (const report of reports) {
    if (!seen.has(report)) selected.push(report)
  }
  return selected.slice(0, cap)
}

function labAnalyteKey(observation: any): string {
  const named = ownCodingFirst(observation)
  return getAnalyteCanonicalKey(named)
    ?? loincOf(observation?.code)
    ?? getAnalyteLabel(named).normalize('NFKC').toUpperCase()
}

/**
 * The label readers take coding[0] as the row's name, but MediCloud writes
 * the NHI order coding first: under a panel order (08011C "CBC", 06013C) every
 * analyte would read as the order. When the row has no code.text and a local
 * code that names the analyte, read that local coding first instead.
 */
function ownCodingFirst(observation: any): any {
  const codings: any[] = Array.isArray(observation?.code?.coding) ? observation.code.coding : []
  if (observation?.code?.text || !isNhiOrderCodeSystem(codings[0]?.system)) return observation
  const own = codings.filter((c: any) => !isNhiOrderCodeSystem(c?.system))
  const named = own.some((c: any) => typeof c?.display === 'string' && c.display.trim()) || !!meaningfulLocalCode(codings)
  if (!named) return observation
  return { ...observation, code: { ...observation.code, coding: [...own, ...codings.filter((c: any) => isNhiOrderCodeSystem(c?.system))] } }
}

export type LabValueFamily = 'quantity' | 'percent' | 'titer' | 'ordinal' | 'text'

// "1:160", "< 1:40", "1：80 speckled"; also a FHIR valueRatio.
const TITER_VALUE_RE = /^\s*(?:[<>≤≥≦≧]=?\s*)?1\s*[:：/]\s*\d+/
/** Value family of one lab row: a count / concentration, a percentage, a
 *  titer, an ordinal (presence / grade) or free text. Rows of different
 *  families never share a group. */
export function labValueFamily(observation: any): LabValueFamily {
  const quantity = observation?.valueQuantity
  if (quantity && typeof quantity.value === 'number') {
    return isPercentQuantity(quantity) ? 'percent' : 'quantity'
  }
  const range = observation?.valueRange
  if (range && (range.low || range.high)) {
    return [range.low, range.high].some((bound: any) => bound && isPercentQuantity(bound)) ? 'percent' : 'quantity'
  }
  if (typeof observation?.valueInteger === 'number' || typeof observation?.valueDecimal === 'number') return 'quantity'
  if (observation?.valueRatio) return 'titer'
  if (observation?.valueCodeableConcept || typeof observation?.valueBoolean === 'boolean') return 'ordinal'
  const text = typeof observation?.valueString === 'string' ? foldNumericText(observation.valueString) : ''
  if (TITER_VALUE_RE.test(text)) return 'titer'
  // One shared vocabulary: "Negative", "NEG", 「陰性」, "(-)", "2+" are one
  // family — checked before numbers so a grade "2+" is not read as 2 (a sign
  // followed by a digit is never ordinal, so "-3.2" falls through).
  if (isOrdinalValue(text)) return 'ordinal'
  // A number written as text — signed, grouped, full-width, a range, after a
  // comparator — is a quantity; a percentage when its unit is one ("62%",
  // "62 ％", "62 percent"), like valueQuantity.
  const numeric = text.match(NUMERIC_TEXT_RE)
  if (numeric) return PERCENT_UNIT_PREFIX_RE.test(text.slice(numeric[0].length)) ? 'percent' : 'quantity'
  return 'text'
}

/** LOINC Scale (Qn / Ord / Titr) of a LOINC in the app's declared maps;
 *  undefined when not declared (the value family still separates rows). */
export function declaredLoincScale(loinc: string): 'Qn' | 'Ord' | 'Titr' | undefined {
  return IMMUNOLOGY_LOINC_SCALE[loinc] ?? THYROID_LOINC_SCALE[loinc]
}

/** The analyte an explicit LOINC → key mapping assigns to `loinc` (the
 *  normalization package's LOINC map, then the app's immunology and thyroid
 *  maps). LOINCs mapped to one key are declared equivalent; nothing else is. */
export function declaredLoincAnalyteKey(loinc: string): string | null {
  return canonicalKeyFromLoinc({ code: { coding: [{ system: 'http://loinc.org', code: loinc }] } })
    ?? IMMUNOLOGY_LOINC_TO_KEY[loinc]
    ?? THYROID_LOINC_TO_KEY[loinc]
    ?? null
}

/**
 * Group key and label for one row of queryLabResultsByCategory. Two rows share
 * a group only when
 * - they carry the same LOINC, or LOINCs an explicit LOINC → key mapping
 *   declares equivalent (declaredLoincAnalyteKey) — a shared display name
 *   never merges different LOINCs (751-8 absolute neutrophils vs 770-8
 *   neutrophil %, both labelled Neutrophil); or
 * - neither carries a LOINC and the cumulative report's identity names the
 *   same recognised analyte (one NHI order split into SS-A / SS-B / Ro52);
 *   unrecognised LOINC-less rows keep the name-based key;
 * Rows of ONE LOINC are always one group, however the value is written
 * (Quantity, Range, Integer, string, coded, "Negative for HBsAg"): the LOINC
 * already fixes what was measured and on what scale. Different LOINCs share
 * a group only when declared equivalent AND on one known LOINC scale
 * (declaredLoincScale) — a titer, a presence and a quantitative result of one
 * antibody stay apart. Only LOINC-less rows are also split by value family
 * (labValueFamily), the one signal left to tell a count from a percentage.
 */
export function labCategoryAnalyte(observation: any, category: string): {
  key: string
  label: string
  canonicalKey: string
  loinc?: string
  family: LabValueFamily
} {
  const family = labValueFamily(observation)
  const loinc = loincOf(observation?.code)
  const identity = getLabPivotTestIdentity(observation, category)
  const known = isKnownPivotKey(identity.testKey)
  const label = known
    ? getLabRowDisplayParts(identity, 'medical', 'en').name
    : getAnalyteLabel(ownCodingFirst(observation))
  if (loinc) {
    const declared = declaredLoincAnalyteKey(loinc)
    const scale = declaredLoincScale(loinc)
    // Merge across LOINCs only on a declared key with a known scale;
    // otherwise the LOINC alone is the group.
    if (declared && scale) {
      return { key: `key:${declared}|${scale}`, label, canonicalKey: declared, loinc, family }
    }
    return { key: `loinc:${loinc}`, label, canonicalKey: declared ?? loinc, loinc, family }
  }
  // 免疫 電泳／輕鏈 rows keep their specimen-qualified column (a serum and a
  // urine neutral κ never merge). A report column (IFE / IEP) gathers a
  // report and its lanes in the cumulative table, but the AI answer gives
  // each lane its own analyte, so latest-value selection never drops one.
  if (identity.testKey.startsWith(PARAPROTEIN_PREFIX)) {
    const columnLabel = getLabRowDisplayParts(identity, 'medical', 'en').name
    if (isParaproteinTextKey(identity.testKey)) {
      const own = getTestDisplayName(observation)
      const lane = own.normalize('NFKC').trim().toUpperCase()
      const canonicalKey = `${identity.mapKey}:${lane}`
      return { key: `name:${canonicalKey}|${family}`, label: `${columnLabel} · ${own}`, canonicalKey, family }
    }
    return { key: `name:${identity.mapKey}|${family}`, label: columnLabel, canonicalKey: identity.mapKey, family }
  }
  const canonicalKey = known ? identity.mapKey : labAnalyteKey(observation)
  return { key: `${known ? 'name' : 'label'}:${canonicalKey}|${family}`, label, canonicalKey, family }
}

/**
 * A label for one AI lab group that holds for EVERY member. Members of one
 * LOINC can carry different own labels — 2345-7 headed "Glu-AC" for an older
 * "AC Sugar" row and "Glucose" for a newer generic one — and naming the group
 * after its first member would present a non-fasting latest value as fasting.
 * When the members agree their label is kept; otherwise the group's generic
 * name: the display of its declared / recognised analyte key, else the LOINC's
 * own display, else the LOINC code or name key.
 */
export function labGroupLabel(members: readonly any[], category: string): string {
  const analytes = members.map((observation) => labCategoryAnalyte(observation, category))
  const labels = new Set(analytes.map((analyte) => analyte.label))
  if (labels.size === 1) return analytes[0].label
  const { canonicalKey, loinc } = analytes[0]
  if (isKnownPivotKey(canonicalKey)) {
    return getLabRowDisplayParts({ testKey: canonicalKey, displayName: canonicalKey }, 'medical', 'en').name
  }
  if (loinc) {
    const loincDisplay = members
      .flatMap((observation) => observation?.code?.coding ?? [])
      .find((coding: any) => /loinc/i.test(coding?.system || '') && coding?.code === loinc && coding?.display)?.display
    return loincDisplay ?? `LOINC ${loinc}`
  }
  return canonicalKey
}

export function labCategoryAnalyteKey(observation: any, category: string): string {
  return labCategoryAnalyte(observation, category).key
}

function diagnosticReportOutput(report: any) {
  const date = diagnosticReportDate(report)
  const attachments = attachmentDetails(report)
  return {
    resourceType: 'DiagnosticReport',
    reportName: pickName(report?.code),
    reportCode: report?.code?.coding?.[0]?.code,
    date,
    effectiveDateTime: report?.effectiveDateTime,
    issued: report?.issued,
    status: report?.status,
    conclusion: report?.conclusion,
    conclusionCodes: (report?.conclusionCode ?? []).map(pickName).filter(Boolean),
    notes: (report?.note ?? []).map((note: any) => note?.text).filter(Boolean),
    results: (report?._observations ?? []).map(observationResult),
    attachments,
    imageAttachmentCount: attachments.filter((attachment: any) => attachment.kind === 'image').length,
  }
}

function imagingStudyMetadataForAi(study: any): string {
  const lines: string[] = []
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    lines.push(`${label}: ${value}`)
  }
  const concepts = (values: any[]) =>
    values.map(conceptSearchText).filter(Boolean).join('; ')

  push('Description', study?.description)
  push('Status', study?.status)
  push('Modality', imagingStudyModalityText(study))
  push('Procedure', concepts(study?.procedureCode ?? []))
  push('Reason', concepts(study?.reasonCode ?? []))
  push('Series count', study?.numberOfSeries ?? study?.series?.length)
  push('Instance count', study?.numberOfInstances)
  for (const note of study?.note ?? []) push('Note', note?.text)

  for (const [index, series] of (study?.series ?? []).entries()) {
    const heading = [
      series?.modality?.display || series?.modality?.code,
      series?.description,
    ].filter(Boolean).join(' · ')
    lines.push(`Series ${series?.number ?? index + 1}${heading ? ` — ${heading}` : ''}`)
    push('  Body site', series?.bodySite?.display || series?.bodySite?.code)
    push('  Laterality', series?.laterality?.display || series?.laterality?.code)
    push('  Instance count', series?.numberOfInstances ?? series?.instance?.length)
    const titles = (series?.instance ?? [])
      .map((instance: any) => instance?.title)
      .filter(Boolean)
      .slice(0, 50)
    if (titles.length > 0) push('  Instance titles', titles.join('; '))
  }

  return lines.join('\n')
    || 'ImagingStudy metadata is present; no report narrative was supplied.'
}

function imagingStudySearchText(study: any): string {
  return [
    imagingStudyTitle(study),
    imagingStudyMetadataForAi(study),
    imagingStudyModalityText(study),
  ].filter(Boolean).join(' ')
}

function imagingStudyBodySiteText(study: any): string {
  return (study?.series ?? []).flatMap((series: any) => [
    series?.bodySite?.code,
    series?.bodySite?.display,
    series?.laterality?.code,
    series?.laterality?.display,
  ]).filter(Boolean).join(' ')
}

function imagingStudyModalitySearchText(study: any): string {
  return [
    ...(study?.modality ?? []).flatMap((coding: any) => [
      coding?.code,
      coding?.display,
    ]),
    ...(study?.series ?? []).flatMap((series: any) => [
      series?.modality?.code,
      series?.modality?.display,
    ]),
  ].filter(Boolean).join(' ')
}

/**
 * FHIR bundles often store an English report label while users and local
 * models search in Chinese (or the reverse). Keep this deliberately small and
 * anatomy/modality based: it bridges equivalent labels without attempting to
 * infer a finding or diagnosis.
 */
function matchesImagingQuery(searchText: string, query?: string): boolean {
  if (!query) return true
  if (matchSubstring(searchText, query)) return true

  const normalized = query.normalize('NFKC').toLowerCase()
  const hasChest = /(胸部|胸腔|chest)/i.test(normalized)
  const hasXray = /(x\s*[-–—]?\s*ray|x\s*光|x\s*線|放射線攝影)/i.test(normalized)
  const hasCt = /(電腦斷層|斷層掃描|computed tomography|\bct\b)/i.test(normalized)
  const hasMri = /(核磁共振|磁振造影|magnetic resonance|\bmri?\b)/i.test(normalized)
  const hasUltrasound = /(超音波|超聲|ultrasound|sonograph)/i.test(normalized)

  const aliases = [
    hasXray && hasChest ? 'chest x-ray' : undefined,
    hasXray ? 'x-ray' : undefined,
    hasChest ? 'chest' : undefined,
    hasCt ? 'ct' : undefined,
    hasMri ? 'mri' : undefined,
    hasUltrasound ? 'ultrasound' : undefined,
  ].filter((alias): alias is string => !!alias)

  // If both anatomy and modality were supplied, require their combined alias
  // first so a chest-X-ray request does not match an unrelated chest CT.
  if (hasChest && hasXray) return matchSubstring(searchText, 'chest x-ray')
  return aliases.some(alias => matchSubstring(searchText, alias))
}

function calculateAge(birthDate?: string): number | null {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (
    birthDate.length > 4
    && (m < 0 || (birthDate.length === 10 && m === 0 && today.getDate() < birth.getDate()))
  ) age--
  return age
}

/** Lower-case, NFKC, and strip the separators that vary between how an ICD
 * code is written (R35.0 / R350 / r35-0) so a code or a diagnosis label can be
 * matched as a plain substring. */
function normalizeDiagnosisTerm(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s.\-–—_·]/g, '')
}

/** Resolve joins in their captured source scope, never by a URL's final segment. */
function encounterLinks(collection: ClinicalDataCollection) {
  const graph = collection.clinicalSource?.graph
  const byId = new Map<string, typeof collection.encounters>()
  for (const encounter of collection.encounters) byId.set(encounter.id, [...(byId.get(encounter.id) ?? []), encounter])
  const ambiguous = (id: string) => (byId.get(id)?.length ?? 0) > 1
  const byNode = new Map(collection.encounters.filter(row => row.clinicalSourceNodeKey).map(row => [row.clinicalSourceNodeKey!, row]))
  const nodes = new Map(graph?.nodes.map(node => [node.key, node]))
  const edges = new Map(graph?.references.filter(edge => edge.path === 'encounter').map(edge => [edge.origin.key, edge]))
  let incomplete = false
  const target = (row: { clinicalSourceNodeKey?: string; encounter?: { reference?: string }; _encounterInferred?: boolean }) => {
    const edge = row.clinicalSourceNodeKey ? edges.get(row.clinicalSourceNodeKey) : undefined
    if (graph && edge) {
      if (edge.status !== 'resolved') { incomplete = true; return undefined }
      const linked = edge.targetKeys.flatMap(key => {
        const direct = byNode.get(key) ?? byNode.get(clinicalEncounterAlias(collection.clinicalSource!, key) ?? '')
        if (direct) return [direct]
        const node = nodes.get(key)
        return node ? collection.encounters.filter(encounter => {
          const candidate = encounter.clinicalSourceNodeKey ? nodes.get(encounter.clinicalSourceNodeKey) : undefined
          return candidate && clinicalSourceNodesEqualWithContext(graph, node, candidate)
        }) : []
      })
      const distinct = [...new Set(linked)]
      if (distinct.length === 1) return distinct[0]
      incomplete = true
      return undefined
    }
    const reference = row.encounter?.reference
    if (!reference) return undefined
    // Date-inferred local links are explicitly marked by the mapper. Legacy
    // snapshots without a graph may only use a unique, plain relative reference.
    const id = (!graph || row._encounterInferred) ? /^Encounter\/([^/]+)$/.exec(reference)?.[1] : undefined
    if (id && byId.get(id)?.length === 1) return byId.get(id)![0]
    incomplete = true
    return undefined
  }
  return { target, ambiguous, get incomplete() { return incomplete } }
}

function encounterDeptText(enc: any): string {
  // Bridge v0.9.2 splits Encounter.type into kind + channel entries (see
  // bridge integration doc 2026-05-27). For AI tool filtering we want a
  // single searchable string that includes BOTH dimensions, so the LLM
  // can match "IC卡資料" or "藥局" or "門診" against the same field.
  // Joining all type[].text/.display covers both v0.9.2 (multi-entry) and
  // v0.9.1 (single-entry) bundles without any version branching.
  if (Array.isArray(enc.type) && enc.type.length > 0) {
    const joined = enc.type
      .map((entry: any) => entry?.text || entry?.coding?.[0]?.display)
      .filter(Boolean)
      .join(' ')
    if (joined) return joined
  }
  return pickName(enc.serviceType) || ''
}

function encounterInstitution(enc: any): string {
  return enc.serviceProvider?.display || enc.location?.[0]?.location?.display || ''
}

function encounterDate(enc: any): string | undefined {
  return enc.period?.start
}

function classifyEncounterType(enc: any):
  'outpatient' | 'inpatient' | 'emergency' | 'pharmacy' | 'home' | 'virtual' | 'other' {
  const cls = String(enc.class?.code || enc.class?.display || '').toLowerCase()
  const dept = encounterDeptText(enc).toLowerCase()
  if (['emer', 'emergency', 'ed'].includes(cls) || dept.includes('急診')) return 'emergency'
  if (['imp', 'inpatient', 'acute'].includes(cls) || dept.includes('住院')) return 'inpatient'
  if (dept.includes('藥局') || cls === 'pharm' || cls === 'pharmacy') return 'pharmacy'
  if (['amb', 'ambulatory', 'outpatient', 'op'].includes(cls) || dept.includes('門診')) return 'outpatient'
  if (['hh', 'home'].includes(cls)) return 'home'
  if (['vr', 'virtual', 'tele'].includes(cls)) return 'virtual'
  return 'other'
}

function normalizedMedicationKeyPart(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * A refill-equivalence key, deliberately stricter than display name.
 *
 * Same-name records may be different strengths, routes, schedules or orders
 * from different facilities. Collapsing those hides clinically important
 * duplicates. Exact governed product identity remains the first component so
 * NHI reimbursement/package variants of the same licensed product can still
 * join when every regimen/source dimension also agrees.
 */
function medicationRegimenKey(medication: MedicationEntity): string {
  const dosage = medication.dosageInstruction?.[0]
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity
  const timing = dosage?.timing?.repeat
  const identity = medicationClinicalIdentityKey(medication)
    || pickAiMedicationName(
      medication.medicationCodeableConcept,
      medication.medicationReference?.display,
    )

  return [
    identity,
    dosage?.text,
    dosage?.route?.text,
    dose?.value,
    dose?.unit,
    timing?.frequency,
    timing?.period,
    timing?.periodUnit,
    ...(timing?.when ?? []),
    medication.requester?.reference || medication.requester?.display,
    medication.informationSource?.reference || medication.informationSource?.display,
  ].map(normalizedMedicationKeyPart).join('|')
}

function countsAsRefillRecord(medication: MedicationEntity): boolean {
  return !['draft', 'cancelled', 'entered-in-error'].includes(
    normalizeClinicalStatus(medication.status),
  )
}

// Compact deduper for repeated refill cycles. `refillPool` may include older
// completed cycles while `meds` contains only the currently-valid rows.
function annotateMedicationRecordCounts(
  meds: MedicationEntity[],
  refillPool: MedicationEntity[] = meds,
): Array<MedicationEntity & { sourceRecordCount: number }> {
  const sourceRecordCounts = new Map<string, number>()
  for (const medication of refillPool) {
    if (!countsAsRefillRecord(medication)) continue
    const key = medicationRegimenKey(medication)
    sourceRecordCounts.set(key, (sourceRecordCounts.get(key) ?? 0) + 1)
  }

  // Product/regimen similarity does not prove prescription identity. The
  // import graph has already reconciled confirmed copies; retain real orders.
  return meds.map((m) => ({ ...m, sourceRecordCount: sourceRecordCounts.get(medicationRegimenKey(m)) ?? 1 }))
}

function medicationNameFields(medication: any): {
  medication: string
  recordedName?: string
} {
  const medicationName = pickAiMedicationName(
    medication?.medicationCodeableConcept,
    medication?.medicationReference?.display,
  ) || 'Unknown'
  const recordedName = [
    medication?.medicationCodeableConcept?.text,
    medication?.medicationReference?.display,
  ].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim()

  return {
    medication: medicationName,
    ...(recordedName && recordedName !== medicationName ? { recordedName } : {}),
  }
}

function medicationClassificationFields(medication: MedicationEntity) {
  const nhiDrugCode = medication.medicationCodeableConcept?.coding?.find(
    (coding) => isNhiDrugCodeSystem(coding.system) && coding.code?.trim(),
  )?.code?.trim()
  const terminology = medication.drugTerminology
  const atcClassification = terminology ? undefined : medication.atcClassification
  const sourceName = medicationNameFields(medication).medication
  const terminologyStatus = terminology
    ? 'matched'
    : atcClassification
      ? 'source-atc-only'
      : 'unmatched'
  const medicationIdentity = terminology
    ? [
        sourceName,
        terminology.officialNameEn,
        terminology.officialNameZh,
        terminology.ingredientText ? `ingredient: ${terminology.ingredientText}` : undefined,
        terminology.atcCode ? `ATC ${terminology.atcCode}` : undefined,
        [terminology.atcLevel2NameEn, terminology.atcLevel2NameZh].filter(Boolean).join(' / '),
        [terminology.atcLevel4NameEn, terminology.atcLevel4NameZh].filter(Boolean).join(' / '),
      ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index).join(' | ')
    : undefined
  const recordedCategories = (medication.category ?? []).flatMap((category) => {
    const coding = category.coding?.find((candidate) =>
      candidate?.code || candidate?.display,
    )
    const text = category.text?.trim()
    if (!coding && !text) return []
    return [{
      ...(coding?.system ? { system: coding.system } : {}),
      ...(coding?.code ? { code: coding.code } : {}),
      ...(text ? { text } : {}),
      ...(coding?.display ? { display: coding.display } : {}),
      meaning: 'source-administrative-category' as const,
    }]
  })

  return {
    terminologyStatus,
    ...(medicationIdentity ? { medicationIdentity } : {}),
    ...(nhiDrugCode ? { nhiDrugCode } : {}),
    ...(terminology ? {
      drugTerminology: {
        source: terminology.source,
        snapshotId: terminology.snapshotId,
        ...(terminology.officialNameZh ? { officialNameZh: terminology.officialNameZh } : {}),
        ...(terminology.officialNameEn ? { officialNameEn: terminology.officialNameEn } : {}),
        ...(terminology.ingredientText ? { ingredientText: terminology.ingredientText } : {}),
        ...(terminology.doseForm ? { doseForm: terminology.doseForm } : {}),
        ...(terminology.atcCode ? { atcCode: terminology.atcCode } : {}),
        ...(terminology.atcNameZh ? { atcNameZh: terminology.atcNameZh } : {}),
        ...(terminology.atcNameEn ? { atcNameEn: terminology.atcNameEn } : {}),
        ...(terminology.atcLevel2Code ? { atcLevel2Code: terminology.atcLevel2Code } : {}),
        ...(terminology.atcLevel2NameZh ? { atcLevel2NameZh: terminology.atcLevel2NameZh } : {}),
        ...(terminology.atcLevel2NameEn ? { atcLevel2NameEn: terminology.atcLevel2NameEn } : {}),
        ...(terminology.atcLevel3Code ? { atcLevel3Code: terminology.atcLevel3Code } : {}),
        ...(terminology.atcLevel3NameZh ? { atcLevel3NameZh: terminology.atcLevel3NameZh } : {}),
        ...(terminology.atcLevel3NameEn ? { atcLevel3NameEn: terminology.atcLevel3NameEn } : {}),
        ...(terminology.atcLevel4Code ? { atcLevel4Code: terminology.atcLevel4Code } : {}),
        ...(terminology.atcLevel4NameZh ? { atcLevel4NameZh: terminology.atcLevel4NameZh } : {}),
        ...(terminology.atcLevel4NameEn ? { atcLevel4NameEn: terminology.atcLevel4NameEn } : {}),
      },
    } : {}),
    ...(atcClassification ? { sourceAtcClassification: atcClassification } : {}),
    ...(recordedCategories.length > 0 ? { recordedCategories } : {}),
  }
}

function medicationToolFields(
  medication: MedicationEntity,
  nowMs: number,
  dosageField: 'dosage' | 'dosageInstruction',
) {
  const dosageInstruction = medication.dosageInstruction?.[0]
  const dosage = dosageInstruction?.text
  const route = dosageInstruction?.route as any
  const timing = dosageInstruction?.timing
  const repeat = timing?.repeat
  const doseQuantity = dosageInstruction?.doseAndRate?.[0]?.doseQuantity
  const timingCode = timing?.code
  const additionalInstructions = (dosageInstruction?.additionalInstruction ?? [])
    .map((instruction) => instruction.text
      || instruction.coding?.find((coding) => coding.display)?.display
      || instruction.coding?.find((coding) => coding.code)?.code
    )
    .filter((instruction): instruction is string => Boolean(instruction))
  const structuredDosage = {
    ...(route?.text ? { route: route.text } : route?.coding?.[0]?.display
      ? { route: route.coding[0].display }
      : route?.coding?.[0]?.code ? { route: route.coding[0].code } : {}),
    ...(doseQuantity?.value !== undefined ? {
      doseQuantity: {
        value: doseQuantity.value,
        ...(doseQuantity.unit ? { unit: doseQuantity.unit } : {}),
      },
    } : {}),
    ...(timingCode?.text ? { timing: timingCode.text } : timingCode?.coding?.[0]?.display
      ? { timing: timingCode.coding[0].display }
      : timingCode?.coding?.[0]?.code ? { timing: timingCode.coding[0].code } : {}),
    ...(repeat?.frequency !== undefined ? { frequency: repeat.frequency } : {}),
    ...(repeat?.period !== undefined ? { period: repeat.period } : {}),
    ...(repeat?.periodUnit ? { periodUnit: repeat.periodUnit } : {}),
    ...(repeat?.when?.length ? { when: repeat.when } : {}),
    ...(additionalInstructions.length > 0 ? { additionalInstructions } : {}),
  }
  const hasStructuredDosage = Object.keys(structuredDosage).length > 0
  const expectedSupplyEnd = medicationExpectedEnd(medication)
  const dispenseRequest = medication.dispenseRequest as any
  const expectedSupplyDuration = dispenseRequest?.expectedSupplyDuration
  const dispenseQuantity = dispenseRequest?.quantity
  const currentness = assessMedicationCurrentness(medication, nowMs)
  return {
    ...medicationNameFields(medication),
    ...medicationClassificationFields(medication),
    status: medication.status,
    ...(sourceSelfPurchase(medication) === true ? { selfPurchased: true } : {}),
    ...(medication._encounterInferred ? { encounterLinkBasis: 'date-and-facility-inferred; not source-confirmed' } : {}),
    ...(medication._sourceRecordComparison ? { sourceComparison: medication._sourceRecordComparison,
      sourceComparisonInstruction: sourceComparisonNarrative(medication) } : {}),
    authoredOn: medication.authoredOn,
    ...(dosage ? { [dosageField]: dosage } : {}),
    ...(hasStructuredDosage ? { dosageDetails: structuredDosage } : {}),
    chronic: isChronicByCourseOfTherapy(medication.courseOfTherapyType),
    current: currentness.current,
    currentnessBasis: currentness.basis,
    ...(dispenseQuantity?.value !== undefined ? {
      dispenseQuantity: {
        value: dispenseQuantity.value,
        ...(dispenseQuantity.unit ? { unit: dispenseQuantity.unit } : {}),
      },
    } : {}),
    ...(expectedSupplyDuration?.value !== undefined ? {
      expectedSupplyDuration: {
        value: expectedSupplyDuration.value,
        ...(expectedSupplyDuration.unit ? { unit: expectedSupplyDuration.unit } : {}),
        ...(expectedSupplyDuration.code ? { code: expectedSupplyDuration.code } : {}),
      },
    } : {}),
    ...(expectedSupplyEnd ? { expectedSupplyEnd } : {}),
    ...(medication._sourceResourceType
      ? { sourceResourceType: medication._sourceResourceType }
      : {}),
  }
}

function medicationGroundingRules(medications: MedicationEntity[]) {
  return {
    providedFieldsOnly: true,
    ingredientProvided: medications.some((medication) =>
      Boolean(medication.drugTerminology?.ingredientText),
    ),
    drugClassProvided: medications.some((medication) =>
      Boolean(medication.drugTerminology?.atcCode || medication.atcClassification?.atcCode),
    ),
    purposeOrIndicationProvided: false,
    instruction: 'Copy medication, recordedName, dosage/dosageInstruction, status, dates, current, currentnessBasis, and terminology fields exactly. current/currentnessBasis are deterministically computed from source lifecycle status and any computable supply window: an open supply window can resolve currentness when source status is missing or unknown. drugTerminology is an exact NHI-code/date match and may establish that row\'s ingredient, dose form, and ATC class. sourceAtcClassification may establish only the exact source WHO ATC hierarchy. recordedCategories are source/administrative labels, not proof of ingredient, mechanism, or indication. Never infer why the patient received a medicine, whether they actually took it, adherence, response, or outcome. A record with current=false or unresolved currentness must not be called a current medication.',
  }
}

// ── factory ────────────────────────────────────────────────────────────────

export function createFhirTools(getRawData: () => AgentDataSource) {
  const getData = (): AgentDataSource => {
    const raw = getRawData()
    return { ...raw, collection: raw.collection ? excludeUnresolvedDecisionVariants(raw.collection) : raw.collection }
  }
  // Structured scrub (ids / birthDate / provider display) + free-text scrub:
  // discharge summaries and report conclusions carry the patient's name /
  // chart number / 身分證字號 INSIDE the text, so every string is also masked
  // against those patterns and the loaded patient's own name/id literals.
  const scrub = <T,>(payload: T, resourceTypes?: readonly string[]): T => {
    const data = getData()
    const exclusions = data.collection?.clinicalRecordVariantExclusions
      ?.filter(item => !resourceTypes || resourceTypes.includes(item.resourceType))
    const annotated = exclusions?.length && payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, incomplete: true, canConcludeAbsence: false, clinicalRecordVariantExclusions: outboundClinicalVariantExclusions(exclusions), sourceRecordUncertainty: formatClinicalVariantExclusions({ clinicalRecordVariantExclusions: exclusions }) } : payload
    return scrubPii(annotated, buildPatientTextLiterals(data.patient)) as T
  }
  const DOMAIN_QUERY_KEYS: Partial<Record<string, ClinicalDataQueryKey[]>> = {
    Condition: ['Condition'],
    MedicationRequest: ['MedicationRequest'],
    MedicationStatement: ['MedicationStatement'],
    Basic: ['Basic'],
    AllergyIntolerance: ['AllergyIntolerance'],
    Observation: ['Observation', 'Observation:vital-signs'],
    DiagnosticReport: ['DiagnosticReport'],
    ImagingStudy: ['ImagingStudy'],
    Procedure: ['Procedure'],
    Encounter: ['Encounter'],
    DocumentReference: ['DocumentReference'],
    Composition: ['Composition'],
    Immunization: ['Immunization'],
    Consent: ['Consent'],
    Device: ['Device'],
    CarePlan: ['CarePlan'],
  }
  const scrubForDomains = (resourceTypes: readonly string[], explicitKeys?: ClinicalDataQueryKey[]) => <T,>(payload: T): T => {
    const collection = getData().collection
    const keys = explicitKeys ?? [...new Set(resourceTypes.flatMap(type => DOMAIN_QUERY_KEYS[type] ?? []))]
    const queryIssues: SafeQueryIssue[] = collection
      ? queryIssuesFor(collection, keys)
      : keys.map(resourceType => ({ resourceType, state: 'not-loaded' as ClinicalDataQueryStatus['state'] }))
    if (queryIssues.length === 0) return scrub(payload, resourceTypes)

    const result = payload as any
    const count = typeof result?.count === 'number'
      ? result.count
      : Array.isArray(result?.data) ? result.data.length : undefined
    const incomplete = result && typeof result === 'object' && !Array.isArray(result)
      ? {
        ...result,
        ...(count === undefined ? {} : { count }),
        ...(count === 0 && result.success === true ? { success: false } : {}),
        incomplete: true,
        canConcludeAbsence: false,
        queryIssues,
        summary: `${result.summary || '無法確認是否有相關臨床資料'}（相關 FHIR 查詢不完整）`,
      }
      : { success: false, count: 0, incomplete: true, canConcludeAbsence: false, queryIssues, data: [] }
    return scrub(incomplete, resourceTypes) as T
  }
  const scrubForQueries = (resourceTypes: readonly string[], keys: ClinicalDataQueryKey[], _noun: string) => <T,>(payload: T): T => scrubForDomains(resourceTypes, keys)(payload)

  // A failed name/category/date match is not an empty chart. Give the model
  // actual values within the requested date/abnormality scope to discover the source's names without another
  // guessed lookup. Keep matches separate from recovery evidence, and bound
  // the inventory by analyte rather than letting repeated tests crowd it out.
  const scrubLabResult = <T extends { success: boolean; count?: number }>(
    payload: T,
    filters?: { discovery: boolean; dateFrom?: string; dateTo?: string; abnormalOnly?: boolean },
  ) => {
    const scrub = scrubForDomains(['Observation', 'DiagnosticReport'])
    const collection = getData().collection
    if (!payload.success || payload.count !== 0 || !collection || !filters?.discovery) return scrub(payload)
    const observations = uniqueObservations(collection)
      .flatMap(observation => expandObservationValues(observation))
      .filter(observation => observation.status !== 'entered-in-error'
        && (!(filters.dateFrom || filters.dateTo)
          || isWithinDateRange(observationDate(observation), filters.dateFrom, filters.dateTo))
        && (!filters.abnormalOnly || isAbnormalObservation(observation)))
      .sort((a, b) => (observationDate(b) || '').localeCompare(observationDate(a) || ''))
    const latest = new Map<string, (typeof observations)[number]>()
    for (const observation of observations) {
      const key = labAnalyteKey(observation)
      if (!latest.has(key)) latest.set(key, observation)
    }
    if (latest.size === 0) return scrub(payload)
    const data = [...latest.values()].slice(0, 30).map(observationResult)
    const queryIssues = queryIssuesFor(collection, ['Observation'])
    return scrub({
      ...payload,
      availableObservationRecovery: {
        scope: 'Latest value per analyte within the requested date and abnormality filters; name/code/category relaxed. NOT matches for the original query.',
        dateRange: { from: filters.dateFrom, to: filters.dateTo },
        abnormalOnly: filters.abnormalOnly ?? false,
        totalAnalytes: latest.size,
        returnedAnalytes: data.length,
        truncated: latest.size > data.length,
        incomplete: queryIssues.length > 0,
        canConcludeAbsence: false,
        queryIssues,
        instruction: 'The chart contains these observations. Zero matches applies ONLY to the original filters. Do not say all observations are missing. Use these names to query details or trends; do not substitute another analyte or date for the requested result. This inventory is not a complete history and cannot establish absence. Use only supplied normalityStatus and referenceRange.',
        data,
      },
    })
  }

  return {
    // ── Patient ────────────────────────────────────────────────────────────

    queryPatientInfo: tool({
      description: 'Get anonymized patient demographics (gender + age only). Patient name, ID, and date of birth are intentionally not surfaced.',
      inputSchema: patientInfoSchema,
      execute: async () => {
        const scrub = scrubForDomains([])
        const { patient } = getData()
        if (!patient) {
          return scrub({ success: false, summary: 'Patient not loaded yet', data: null })
        }
        return scrub({
          success: true,
          summary: 'Patient demographics retrieved (anonymized)',
          data: {
            gender: patient.gender,
            age: calculateAge(patient.birthDate),
            ...(patient.birthDate && patient.birthDate.length < 10
              ? { ageApproximate: true }
              : {}),
            ...(patient.demographicsSource === 'user-entered-local-profile'
              ? { source: 'user-entered-local-profile' }
              : {}),
          },
        })
      },
    }),

    getDataOverview: tool({
      description: 'Start here when you need an overview of what data is available. Returns counts and date ranges for every resource type. Useful to plan which subsequent tool calls will be informative.',
      inputSchema: overviewSchema,
      execute: async () => {
        const { collection } = getData()
        if (!collection) {
          return scrub({
            success: false,
            summary: 'Clinical data is not loaded yet',
            incomplete: true,
            canConcludeAbsence: false,
            data: null,
          })
        }

        const range = (items: any[], getDate: (x: any) => string | undefined) => {
          const dates = items.map(getDate).filter(Boolean).sort() as string[]
          if (dates.length === 0) return null
          return { earliest: dates[0]?.slice(0, 10), latest: dates[dates.length - 1]?.slice(0, 10) }
        }
        const allQueryIssues = queryIssuesFor(
          collection,
          Object.keys(collection.resourceQueryStatus ?? {}) as ClinicalDataQueryKey[],
        )
        const exclusions = collection.clinicalRecordVariantExclusions ?? []
        const domainStateFor = (...keys: ClinicalDataQueryKey[]) => {
          const unresolvedVariantCount = exclusions.filter(item => keys.includes(item.resourceType as ClinicalDataQueryKey)).length
          const incomplete = unresolvedVariantCount > 0 || queryIssuesFor(collection, keys).length > 0
          return { incomplete, canConcludeAbsence: !incomplete, unresolvedVariantCount,
            recordState: unresolvedVariantCount ? 'unresolved-variants' : incomplete ? 'query-incomplete' : 'complete' }
        }
        const statusFor = (key: ClinicalDataQueryKey) => ({ ...domainStateFor(key),
          ...(collection.resourceQueryStatus?.[key] ? { queryStatus: collection.resourceQueryStatus[key]?.state } : {}) })

        return scrub({
          success: true,
          summary: allQueryIssues.length > 0 || exclusions.length > 0
            ? 'Data inventory loaded, but resource queries or unresolved source-record variants prevent absence conclusions'
            : 'Data inventory across all resource types',
          incomplete: allQueryIssues.length > 0 || exclusions.length > 0,
          canConcludeAbsence: allQueryIssues.length === 0 && exclusions.length === 0,
          queryIssues: allQueryIssues,
          data: {
            conditions: {
              count: collection.conditions.length,
              ...statusFor('Condition'),
            },
            medications: {
              count: collection.medications.length,
              ...domainStateFor('MedicationRequest', 'MedicationStatement'),
              range: range(collection.medications, (m) => m.authoredOn),
              medicationRequestQueryStatus:
                collection.resourceQueryStatus?.MedicationRequest?.state,
              medicationStatementQueryStatus:
                collection.resourceQueryStatus?.MedicationStatement?.state,
            },
            allergies: {
              count: collection.allergies.length,
              ...statusFor('AllergyIntolerance'),
            },
            encounters: {
              count: collection.encounters.length,
              range: range(collection.encounters, (e) => e.period?.start),
              ...statusFor('Encounter'),
            },
            diagnosticReports: {
              count: collection.diagnosticReports.length,
              range: range(collection.diagnosticReports, diagnosticReportDate),
              ...statusFor('DiagnosticReport'),
            },
            imagingStudies: {
              count: collection.imagingStudies?.length ?? 0,
              range: range(collection.imagingStudies ?? [], (study) => study.started),
              ...statusFor('ImagingStudy'),
            },
            observations: {
              // Count source records once when vitals also appear in observations.
              count: uniqueObservations(collection).length,
              range: range(
                [...collection.observations, ...collection.vitalSigns],
                observationDate,
              ),
              ...statusFor('Observation'),
              vitalSignsQueryStatus:
                collection.resourceQueryStatus?.['Observation:vital-signs']?.state,
            },
            procedures: {
              count: collection.procedures.length,
              range: range(collection.procedures, (p) => p.performedDateTime || p.performedPeriod?.start),
              ...statusFor('Procedure'),
            },
            immunizations: {
              count: collection.immunizations.length,
              range: range(collection.immunizations, (i) => i.occurrenceDateTime),
              ...statusFor('Immunization'),
            },
          },
        })
      },
    }),

    // ── Visits ─────────────────────────────────────────────────────────────

    getHealthSummarySnapshot: tool({
      description: 'PRIMARY compact tool for a broad patient health summary. In one call returns deduplicated conditions, current medications, latest abnormal labs, and recent vital signs. Prefer this over several separate tools when the user asks for an overall summary of their imported record.',
      inputSchema: healthSummarySnapshotSchema,
      execute: async () => {
        const collection = getData().collection
        if (!collection) {
          return scrub(unavailableQueryResult(
            collection,
            ['Condition', 'MedicationRequest', 'MedicationStatement', 'Observation'],
            '健康摘要資料',
          ))
        }

        const queryIssues = queryIssuesFor(collection, [
          'Condition',
          'MedicationRequest',
          'MedicationStatement',
          'Observation',
        ])
        const conditionByName = new Map<string, any>()
        for (const condition of collection.conditions) {
          const name = pickName(condition.code) || 'Unknown'
          const key = name.normalize('NFKC').trim().toLowerCase()
          const existing = conditionByName.get(key)
          if (!existing || (condition.recordedDate || '') > (existing.recordedDate || '')) {
            conditionByName.set(key, condition)
          }
        }
        const allConditions = [...conditionByName.values()]
          .sort((left, right) => (right.recordedDate || '').localeCompare(left.recordedDate || ''))
        const conditions = allConditions.slice(0, 40).map((condition) => ({
          name: pickName(condition.code) || 'Unknown',
          status: typeof condition.clinicalStatus === 'string'
            ? condition.clinicalStatus
            : condition.clinicalStatus?.coding?.[0]?.code,
          date: condition.recordedDate,
        }))

        const nowMs = Date.now()
        const activeMedicationRecords = collection.medications.filter((medication) =>
          isMedicationCurrentlyInUse(medication, nowMs)
        )
        const uncertainMedicationRecords = collection.medications.filter((medication) =>
          isMedicationCurrentnessUncertain(medication, nowMs)
        )
        const allMedications = annotateMedicationRecordCounts(
          activeMedicationRecords,
          collection.medications,
        )
          .sort((left, right) => (right.authoredOn || '').localeCompare(left.authoredOn || ''))
        const allUncertainMedications = annotateMedicationRecordCounts(
          uncertainMedicationRecords,
          collection.medications,
        ).sort((left, right) => (right.authoredOn || '').localeCompare(left.authoredOn || ''))
        const medications = allMedications.slice(0, 40).map((medication: any) => {
          const fields = medicationToolFields(medication, nowMs, 'dosage')
          const { medication: name, ...rest } = fields
          return {
            name,
            ...rest,
            sourceRecordCount: medication.sourceRecordCount,
          }
        })
        const medicationsWithUncertainStatus = allUncertainMedications
          .slice(0, 40)
          .map((medication: any) => {
            const fields = medicationToolFields(medication, nowMs, 'dosage')
            const { medication: name, ...rest } = fields
            return {
              name,
              ...rest,
              currentness: 'uncertain-source-status',
              sourceRecordCount: medication.sourceRecordCount,
            }
          })
        const medicationRules = medicationGroundingRules([
          ...activeMedicationRecords,
          ...uncertainMedicationRecords,
        ])

        const abnormalByAnalyte = new Map<string, any>()
        for (const observation of collection.observations.flatMap(item =>
          expandObservationValues(item)
        )) {
          if (String(observation?.status ?? '').toLowerCase() === 'entered-in-error') continue
          if (!categorizeObservation(observation) || !isAbnormalObservation(observation)) continue
          const key = labAnalyteKey(observation)
          const existing = abnormalByAnalyte.get(key)
          if (!existing || (observationDate(observation) || '') > (observationDate(existing) || '')) {
            abnormalByAnalyte.set(key, observation)
          }
        }
        const allAbnormalLabs = [...abnormalByAnalyte.values()]
          .sort((left, right) => (observationDate(right) || '').localeCompare(observationDate(left) || ''))
        const abnormalLabs = allAbnormalLabs.slice(0, 60).map(observationResult)

        const vitalByAnalyte = new Map<string, any>()
        for (const vital of collection.vitalSigns) {
          const key = labAnalyteKey(vital)
          const existing = vitalByAnalyte.get(key)
          if (!existing || (observationDate(vital) || '') > (observationDate(existing) || '')) {
            vitalByAnalyte.set(key, vital)
          }
        }
        const allVitals = [...vitalByAnalyte.values()]
          .sort((left, right) => (observationDate(right) || '').localeCompare(observationDate(left) || ''))
        const recentVitals = allVitals.slice(0, 10).map(observationResult)

        return scrub({
          success: true,
          summary: allUncertainMedications.length > 0
            ? 'Compact cross-domain health summary snapshot; one or more medication groups lack both usable lifecycle status and a computable supply window'
            : 'Compact cross-domain health summary snapshot',
          incomplete: queryIssues.length > 0,
          canConcludeAbsence: queryIssues.length === 0 && allUncertainMedications.length === 0,
          queryIssues,
          counts: {
            conditions: allConditions.length,
            activeMedications: allMedications.length,
            medicationsWithUncertainStatus: allUncertainMedications.length,
            abnormalLabs: allAbnormalLabs.length,
            recentVitals: allVitals.length,
          },
          truncated: {
            conditions: allConditions.length > conditions.length,
            activeMedications: allMedications.length > medications.length,
            medicationsWithUncertainStatus:
              allUncertainMedications.length > medicationsWithUncertainStatus.length,
            abnormalLabs: allAbnormalLabs.length > abnormalLabs.length,
            recentVitals: allVitals.length > recentVitals.length,
          },
          groundingRules: {
            medicationFieldsOnly: true,
            ...medicationRules,
            normalityStatusIsAuthoritative: true,
            instruction: medicationRules.instruction + ' Use only these records. The snapshot is already loaded: never ask the user to import or re-import data. Keep medicationsWithUncertainStatus separate from confirmed current medications. Do not add customary lab ranges. If a section is empty and canConcludeAbsence is false, say the data may be incomplete or status-uncertain. Follow the system prompt language for the entire answer, including headings and table labels. Use sections for recent conditions/chronic diseases, confirmed current medications, status-uncertain medication records, and abnormal tests. End by reminding the user to discuss concerns with their physician.',
          },
          data: {
            conditions,
            medications,
            medicationsWithUncertainStatus,
            abnormalLabs,
            recentVitals,
          },
        })
      },
    }),

    queryEncounters: tool({
      description: 'Query patient encounters (visits, admissions). Supports filtering by class, department text, institution, and date range.',
      inputSchema: encountersSchema,
      execute: async ({ class: encounterClass, department, institution, dateFrom, dateTo, limit, summarize }:
        z.infer<typeof encountersSchema>) => {
        const scrub = scrubForQueries(["Encounter","Condition"], ['Encounter'], '就診紀錄')
        const list = getData().collection?.encounters ?? []
        let filtered = list.filter((e: any) =>
          matchEncounterClass(e.class, encounterClass) &&
          matchSubstring(encounterDeptText(e), department) &&
          matchSubstring(encounterInstitution(e), institution)
        )
        if (dateFrom || dateTo) {
          filtered = filtered.filter((e: any) => isWithinDateRange(encounterDate(e), dateFrom, dateTo))
        }
        filtered = [...filtered].sort((a, b) =>
          (b.period?.start || '').localeCompare(a.period?.start || '')
        )
        const capped = applyLimit(filtered, limit)

        if (summarize) {
          return scrub({
            success: true,
            summary: `Found ${filtered.length} Encounter record(s)`,
            count: filtered.length,
            data: capped.map((e: any) => ({
              encounterId: e.id,
              date: encounterDate(e)?.slice(0, 10),
              type: classifyEncounterType(e),
            })),
          })
        }

        return scrub({
          success: true,
          summary: `Found ${filtered.length} Encounter record(s)`,
          count: filtered.length,
          data: capped.map((e: any) => ({
            encounterId: e.id,
            ...(e._sourceRecordComparison ? { sourceComparison: e._sourceRecordComparison } : {}),
            class: e.class?.code || e.class?.coding?.[0]?.code,
            type: pickName(e.type?.[0]),
            department: encounterDeptText(e),
            institution: encounterInstitution(e),
            period: e.period,
            status: e.status,
          })),
        })
      },
    }),

    getRecentVisits: tool({
      description: 'Concise summary of the most recent N visits: date, department, primary ICD, and counts of meds/labs/procedures. Use this before drilling into a specific visit with getEncounterDetails.',
      inputSchema: recentVisitsSchema,
      execute: async ({ limit, type }: z.infer<typeof recentVisitsSchema>) => {
        const scrub = scrubForDomains(['Encounter', 'Condition', 'MedicationRequest', 'MedicationStatement', 'Observation', 'DiagnosticReport', 'Procedure'])
        const { collection } = getData()
        if (!collection) return scrub({ success: false, summary: 'No data', data: [] })

        const encounters = [...collection.encounters].sort((a, b) =>
          (b.period?.start || '').localeCompare(a.period?.start || '')
        )
        const filtered = encounters.filter((e: any) =>
          !type || classifyEncounterType(e) === type
        )
        const top = filtered.slice(0, limit && limit > 0 ? limit : 10)

        const links = encounterLinks(collection)
        const counts = (rows: Array<{ clinicalSourceNodeKey?: string; encounter?: { reference?: string } }>) => {
          const result = new Map<(typeof collection.encounters)[number], number>()
          for (const row of rows) {
            const encounter = links.target(row)
            if (encounter) result.set(encounter, (result.get(encounter) ?? 0) + 1)
          }
          return result
        }
        const medsByEnc = counts(collection.medications)
        const labsByEnc = counts(uniqueObservations(collection))
        const procsByEnc = counts(collection.procedures)
        const incompleteLinks = links.incomplete || top.some(e => links.ambiguous(e.id))

        return scrub({
          success: true,
          summary: `Top ${top.length} of ${filtered.length} recent visits`,
          count: top.length,
          ...(incompleteLinks ? { incomplete: true, canConcludeAbsence: false, encounterLinkUncertainty: 'Some encounter links cannot be uniquely resolved in their source scope.' } : {}),
          data: top.map((e: any) => ({
            encounterId: e.id,
            date: encounterDate(e)?.slice(0, 10),
            type: classifyEncounterType(e),
            department: encounterDeptText(e),
            primaryIcd: e.reasonCode?.[0]?.coding?.[0]?.code,
            primaryIcdLabel: pickName(e.reasonCode?.[0]) || e.reasonCode?.[0]?.text,
            medCount: links.ambiguous(e.id) ? null : medsByEnc.get(e) ?? 0,
            labCount: links.ambiguous(e.id) ? null : labsByEnc.get(e) ?? 0,
            procedureCount: links.ambiguous(e.id) ? null : procsByEnc.get(e) ?? 0,
          })),
        })
      },
    }),

    getEncounterDetails: tool({
      description: 'Drill into one specific visit. Returns all diagnoses (incl. secondary), medications, lab observations, procedures linked to that encounter. Use this when the user asks about a specific visit identified via queryEncounters or getRecentVisits.',
      inputSchema: encounterDetailsSchema,
      execute: async ({ encounterId }: z.infer<typeof encounterDetailsSchema>) => {
        const scrub = scrubForDomains(['Encounter', 'Condition', 'MedicationRequest', 'MedicationStatement', 'Observation', 'DiagnosticReport', 'Procedure', 'ImagingStudy'])
        const { collection } = getData()
        if (!collection) return scrub({ success: false, summary: 'No data', data: null })

        const exactCandidates = collection.encounters.filter((e: any) => e.id === encounterId)
        const candidates = exactCandidates.length ? exactCandidates : collection.encounters.filter((e: any) => e.sourceId === encounterId)
        if (candidates.length > 1) return scrub({ success: false, code: 'ambiguous-encounter-identity', incomplete: true, canConcludeAbsence: false, summary: 'Multiple source encounters have this identifier; a unique visit cannot be selected.', data: null })
        const enc = candidates[0]
        if (!enc) {
          return scrub({
            success: false,
            summary: `Encounter ${encounterId} not found`,
            data: null,
          })
        }

        const links = encounterLinks(collection)
        const matches = (row: any) => links.target(row) === enc

        const diagnoses = (enc.reasonCode ?? []).map((rc: any) => ({
          code: rc.coding?.[0]?.code,
          label: pickName(rc) || rc.text,
        }))

        const nowMs = Date.now()
        const medicationRecords = collection.medications.filter(matches)
        const meds = medicationRecords.map((medication) =>
          medicationToolFields(medication, nowMs, 'dosage')
        )

        const obs = uniqueObservations(collection).filter(matches).map((o: any) => ({
          name: pickName(o.code),
          value: o.valueQuantity?.value ?? o.valueString,
          unit: o.valueQuantity?.unit,
          abnormal: isAbnormalObservation(o),
          ...observationComponentFields(o),
        }))

        const procs = collection.procedures.filter(matches).map((p: any) => ({
          procedure: pickName(p.code),
          status: p.status,
          performedDateTime: p.performedDateTime || p.performedPeriod?.start,
        }))

        const reports = collection.diagnosticReports.filter(matches).map((r: any) => ({
          reportName: pickName(r.code),
          conclusion: r.conclusion,
          effectiveDateTime: r.effectiveDateTime,
        }))

        const imagingStudies = (collection.imagingStudies ?? []).filter(matches).map((study: any) => ({
          description: study.description,
          status: study.status,
          started: study.started,
          modality: (study.modality ?? []).map((coding: any) => coding.display || coding.code).filter(Boolean),
          notes: (study.note ?? []).map((note: any) => note.text).filter(Boolean),
          series: (study.series ?? []).map((series: any) => ({
            description: series.description,
            modality: series.modality?.display || series.modality?.code,
            bodySite: series.bodySite?.display || series.bodySite?.code,
            laterality: series.laterality?.display || series.laterality?.code,
            numberOfInstances: series.numberOfInstances,
            instanceTitles: (series.instance ?? []).map((instance: any) => instance.title).filter(Boolean),
          })),
        }))

        return scrub({
          success: true,
          summary: `Encounter ${encounterId} details`,
          ...(links.incomplete ? { incomplete: true, canConcludeAbsence: false, encounterLinkUncertainty: 'Some encounter links cannot be uniquely resolved in their source scope.' } : {}),
          data: {
            encounterId,
            date: encounterDate(enc)?.slice(0, 10),
            type: classifyEncounterType(enc),
            department: encounterDeptText(enc),
            institution: encounterInstitution(enc),
            diagnoses,
            medications: meds,
            medicationGroundingRules: medicationGroundingRules(medicationRecords),
            observations: obs,
            procedures: procs,
            reports,
            imagingStudies,
          },
        })
      },
    }),

    listEncounterDepartments: tool({
      description: 'List unique departments / service types the patient has visited. Useful to discover what specialties are represented before filtering queryEncounters by department.',
      inputSchema: listDepartmentsSchema,
      execute: async () => {
        const scrub = scrubForDomains(["Encounter"])
        const { collection } = getData()
        const list = collection?.encounters ?? []
        const counts = new Map<string, number>()
        for (const e of list) {
          const dept = encounterDeptText(e)
          if (dept) counts.set(dept, (counts.get(dept) ?? 0) + 1)
        }
        const data = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([department, visitCount]) => ({ department, visitCount }))

        return scrub({
          success: true,
          summary: `${data.length} distinct departments`,
          count: data.length,
          data,
        })
      },
    }),

    searchEncountersByDiagnosis: tool({
      description: 'Find every visit whose recorded diagnosis / reason (ICD code or text) matches, across the whole record, oldest first, with the first and latest occurrence. ONE call answers "when did X first appear", "how many visits carried X", "was X ever recorded" — do not page through visits with getEncounterDetails for that. Matching ignores case, dots, spaces and dashes (R350, R35.0 and 頻尿 all work) and a code matches as a prefix. Also returns matching problem-list Conditions. Visit-level codes are billing/reason codes, not confirmed diagnoses.',
      inputSchema: encounterDiagnosisSearchSchema,
      execute: async ({ query, dateFrom, dateTo, limit }: z.infer<typeof encounterDiagnosisSearchSchema>) => {
        const scrub = scrubForDomains(["Encounter","Condition"])
        const { collection } = getData()
        if (!collection) return scrub({ success: false, summary: 'No data', data: [] })
        const needle = normalizeDiagnosisTerm(query)
        if (!needle) return scrub({ success: false, summary: 'Empty query', data: [] })

        const conceptMatches = (concept: any): boolean => {
          const texts: unknown[] = [concept?.text, ...((concept?.coding ?? []) as any[]).flatMap((c) => [c?.code, c?.display])]
          return texts.some((v) => typeof v === 'string' && normalizeDiagnosisTerm(v).includes(needle))
        }

        const hits: Array<{ encounterId: string; date?: string; type: string; department: string; matchedDiagnoses: Array<{ code?: string; label?: string }> }> = []
        for (const e of collection.encounters as any[]) {
          const date = encounterDate(e)
          if ((dateFrom || dateTo) && !isWithinDateRange(date, dateFrom, dateTo)) continue
          const matched = ((e.reasonCode ?? []) as any[]).filter(conceptMatches)
          if (matched.length === 0) continue
          hits.push({
            encounterId: e.id,
            date: date?.slice(0, 10),
            type: classifyEncounterType(e),
            department: encounterDeptText(e),
            matchedDiagnoses: matched.map((rc: any) => ({ code: rc.coding?.[0]?.code, label: pickName(rc) || rc.text })),
          })
        }
        hits.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

        const conditions = ((collection.conditions ?? []) as any[]).filter((c) => conceptMatches(c.code)).map((c) => ({
          code: pickName(c.code),
          clinicalStatus: typeof c.clinicalStatus === 'string' ? c.clinicalStatus : c.clinicalStatus?.coding?.[0]?.code,
          recordedDate: c.recordedDate,
          onsetDateTime: c.onsetDateTime,
        }))

        const first = hits[0]?.date
        const latest = hits[hits.length - 1]?.date
        return scrub({
          success: true,
          summary: hits.length > 0
            ? `Found ${hits.length} visit(s) with a diagnosis matching "${query}" (first ${first ?? 'unknown date'}, latest ${latest ?? 'unknown date'}); ${conditions.length} matching problem-list Condition(s)`
            : `No visit carries a diagnosis matching "${query}"; ${conditions.length} matching problem-list Condition(s)`,
          count: hits.length,
          firstOccurrence: first,
          latestOccurrence: latest,
          data: applyLimit(hits, limit, 100),
          conditions,
        })
      },
    }),

    // ── Diagnoses & Problems ───────────────────────────────────────────────

    queryConditions: tool({
      description: 'Query patient conditions/diagnoses (cross-visit). Use this for confirmed clinical conditions, not visit-level billing ICDs.',
      inputSchema: conditionsSchema,
      execute: async ({ category, clinicalStatus, limit }: z.infer<typeof conditionsSchema>) => {
        const scrub = scrubForQueries(["Condition"], ['Condition'], '診斷或健康問題')
        const list = getData().collection?.conditions ?? []
        const filtered = list.filter((c: any) =>
          matchCategoryCoding(c.category, category) &&
          matchClinicalStatus(c.clinicalStatus, clinicalStatus)
        )
        const capped = applyLimit(filtered, limit, 100)
        return scrub({
          success: true,
          summary: `Found ${filtered.length} Condition record(s)`,
          count: filtered.length,
          data: capped.map((c: any) => ({
            code: pickName(c.code),
            clinicalStatus: typeof c.clinicalStatus === 'string'
              ? c.clinicalStatus
              : c.clinicalStatus?.coding?.[0]?.code,
            recordedDate: c.recordedDate,
          })),
        })
      },
    }),

    // ── Reports ────────────────────────────────────────────────────────────

    queryObservations: tool({
      description: 'Query patient observations (lab results, vital signs). Supports date range, exact code, fuzzy `codeQuery`, and `abnormalOnly`. Detailed results preserve panel values (such as systolic/diastolic blood pressure) under components; code/name filters also match components. For lab panels prefer queryDiagnosticReports; for trend of a specific lab prefer searchObservationByName.',
      inputSchema: observationsSchema,
      execute: async ({ category, code, codeQuery, abnormalOnly, dateFrom, dateTo, limit, summarize }:
        z.infer<typeof observationsSchema>) => {
        const collection = getData().collection
        const unavailable = unavailableQueryResult(
          collection,
          ['Observation'],
          '檢驗或觀察數據',
        )
        if (unavailable) return scrubLabResult(unavailable)

        const list = uniqueObservations(collection!)

        let filtered = list.filter((o: any) => {
          if (!matchCategoryCoding(o.category, category)) return false
          if (code) {
            // Case-insensitive — LLMs commonly mis-case ("body height" vs "Body Height")
            const targetLc = code.toLowerCase()
            const matchesCode = observationConcepts(o).some(concept =>
              pickName(concept)?.toLowerCase() === targetLc
              || (concept.coding ?? []).some((coding: any) => String(coding.code || '').toLowerCase() === targetLc)
            )
            if (!matchesCode) return false
          }
          if (codeQuery && !observationConcepts(o).some(concept => conceptMatchesQuery(concept, codeQuery))) return false
          if (abnormalOnly && !isAbnormalObservation(o)) return false
          return true
        })

        if (dateFrom || dateTo) {
          filtered = filtered.filter((o: any) =>
            isWithinDateRange(observationDate(o), dateFrom, dateTo)
          )
        }

        filtered = [...filtered].sort((a, b) =>
          (observationDate(b) || '').localeCompare(observationDate(a) || '')
        )
        const capped = applyLimit(filtered, limit)
        const page = paginationMeta(filtered.length, capped.length)

        const summary = filtered.length > 0
          ? `Found ${filtered.length} Observation record(s)`
          : notFoundMessage('檢驗數據', dateFrom, dateTo)

        if (summarize) {
          return scrubLabResult({
            success: true,
            summary,
            count: filtered.length,
            ...page,
            incomplete: false,
            canConcludeAbsence: true,
            dateRange: { from: dateFrom, to: dateTo },
            data: capped.map((o: any) => ({
              code: pickName(o.code),
              date: observationDate(o),
              effectiveDateTime: o.effectiveDateTime,
              abnormal: isAbnormalObservation(o),
            })),
          }, { discovery: Boolean(category || code || codeQuery), dateFrom, dateTo, abnormalOnly })
        }

        return scrubLabResult({
          success: true,
          summary,
          count: filtered.length,
          ...page,
          incomplete: false,
          canConcludeAbsence: true,
          dateRange: { from: dateFrom, to: dateTo },
          data: capped.map((o: any) => ({
            code: pickName(o.code),
            value: o.valueQuantity?.value ?? o.valueString,
            unit: o.valueQuantity?.unit,
            date: observationDate(o),
            effectiveDateTime: o.effectiveDateTime,
            abnormal: isAbnormalObservation(o),
            status: o.status,
            ...observationComponentFields(o),
          })),
        }, { discovery: Boolean(category || code || codeQuery), dateFrom, dateTo, abnormalOnly })
      },
    }),

    queryDiagnosticReports: tool({
      description: 'Query DiagnosticReport records for lab panels and report-level tests. Search is case- and separator-insensitive, so CA199, CA-199, CA–199, and CA 19-9 match. For multiple specific tests use `queries` (for example ["CA125", "CA199"]), or comma-separate them in `query`; matching records plus matchedQueryTerms/unmatchedQueryTerms are returned. Also supports category, date range, and abnormalOnly. For imaging/pathology questions prefer queryImagingRecords, which also covers standalone ImagingStudy resources.',
      inputSchema: diagnosticReportsSchema,
      execute: async ({ category, query, queries, abnormalOnly, dateFrom, dateTo, limit, summarize }:
        z.infer<typeof diagnosticReportsSchema>) => {
        const collection = getData().collection
        const unavailable = unavailableQueryResult(
          collection,
          ['DiagnosticReport'],
          '檢驗或診斷報告',
        )
        if (unavailable) return scrubLabResult(unavailable)
        // Report names/conclusions remain usable if the separate Observation
        // search failed, but component-result coverage may then be incomplete.
        const queryIssues = queryIssuesFor(collection!, ['Observation'])
        const incomplete = queryIssues.length > 0
        const requestedQueryTerms = diagnosticReportQueryTerms(query, queries)

        const list = collection!.diagnosticReports
        let filtered = list.filter((r: any) =>
          matchDiagnosticReportCategory(r, category)
          && matchesDiagnosticReportQuery(r, requestedQueryTerms)
        )
        if (dateFrom || dateTo) {
          filtered = filtered.filter((r: any) =>
            isWithinDateRange(diagnosticReportDate(r), dateFrom, dateTo)
          )
        }
        if (abnormalOnly) {
          filtered = filtered.filter((r: any) =>
            Array.isArray(r._observations) && r._observations.some(isAbnormalObservation)
          )
        }
        filtered = [...filtered].sort((a, b) =>
          (diagnosticReportDate(b) || '').localeCompare(diagnosticReportDate(a) || '')
        )
        const matchedQueryTerms = requestedQueryTerms.filter(term =>
          filtered.some(report => diagnosticReportMatchesTerm(report, term))
        )
        const unmatchedQueryTerms = requestedQueryTerms.filter(term =>
          !matchedQueryTerms.includes(term)
        )
        const capped = selectDiagnosticReportPage(filtered, requestedQueryTerms, limit)
        const page = paginationMeta(filtered.length, capped.length)

        const summary = filtered.length > 0
          ? `Found ${filtered.length} DiagnosticReport record(s)`
          : incomplete
            ? 'Unable to determine absence because Observation result coverage is incomplete'
          : notFoundMessage('檢驗報告', dateFrom, dateTo)

        if (summarize) {
          return scrubLabResult({
            success: filtered.length > 0 || !incomplete,
            summary,
            count: filtered.length,
            ...page,
            incomplete,
            canConcludeAbsence: !incomplete,
            queryIssues,
            requestedQueryTerms,
            matchedQueryTerms,
            unmatchedQueryTerms,
            dateRange: { from: dateFrom, to: dateTo },
            data: capped.map((r: any) => ({
              reportName: pickName(r.code),
              reportCode: r.code?.coding?.[0]?.code,
              date: diagnosticReportDate(r),
              effectiveDateTime: r.effectiveDateTime,
              issued: r.issued,
              abnormalCount: (r._observations ?? []).filter(isAbnormalObservation).length,
              resultCount: (r._observations ?? []).length,
              imageAttachmentCount: attachmentDetails(r)
                .filter((attachment: any) => attachment.kind === 'image').length,
            })),
          }, { discovery: Boolean(category || query || queries?.length), dateFrom, dateTo, abnormalOnly })
        }

        return scrubLabResult({
          success: filtered.length > 0 || !incomplete,
          summary,
          count: filtered.length,
          ...page,
          incomplete,
          canConcludeAbsence: !incomplete,
          queryIssues,
          requestedQueryTerms,
          matchedQueryTerms,
          unmatchedQueryTerms,
          dateRange: { from: dateFrom, to: dateTo },
          data: capped.map(diagnosticReportOutput),
        }, { discovery: Boolean(category || query || queries?.length), dateFrom, dateTo, abnormalOnly })
      },
    }),

    queryLabResultsByCategory: tool({
      description: 'PRIMARY tool for semantic lab-group questions such as "all tumor markers", "cancer markers", "CBC", "renal/liver biochemistry", "lipids", "diabetes labs", or "urinalysis". Uses the exact same audited lab classification as the cumulative-report UI. `category="tumor"` returns every tumor-marker analyte the patient actually has (for example AFP, CEA, CA-125, CA-199/CA19-9, PSA), not merely the names mentioned by the user. By default returns the latest value for every analyte; set withTrend=true for up to 10 values per analyte.',
      inputSchema: labResultsByCategorySchema,
      execute: async ({ category, withTrend, abnormalOnly, dateFrom, dateTo, limit }:
        z.infer<typeof labResultsByCategorySchema>) => {
        const collection = getData().collection
        const unavailable = unavailableQueryResult(
          collection,
          ['Observation'],
          '指定分類的檢驗數據',
        )
        if (unavailable) return scrubLabResult(unavailable)

        const categoryDefinition = LAB_CATEGORIES.find(item => item.id === category)!
        const expanded = collection!.observations
          .flatMap(observation => expandObservationValues(observation))
          .filter((observation: any) =>
            String(observation?.status ?? '').toLowerCase() !== 'entered-in-error'
            && categorizeObservation(observation)?.id === category
            && isWithinDateRange(observationDate(observation), dateFrom, dateTo)
            && (!abnormalOnly || isAbnormalObservation(observation))
          )

        // See labCategoryAnalyte: same LOINC, declared-equivalent LOINCs, or
        // (LOINC-less) the same recognised analyte — always one value family.
        const byAnalyte = new Map<string, ReturnType<typeof labCategoryAnalyte> & { observations: any[] }>()
        for (const observation of expanded) {
          const analyte = labCategoryAnalyte(observation, category)
          const group = byAnalyte.get(analyte.key)
          if (group) group.observations.push(observation)
          else byAnalyte.set(analyte.key, { ...analyte, observations: [observation] })
        }
        // A label that holds for every member, not the first member's subtype.
        for (const group of byAnalyte.values()) group.label = labGroupLabel(group.observations, category)

        // Groups that share a label (751-8 and 770-8 both read "NEU") are told
        // apart by their LOINC and value family, so none looks like a duplicate.
        const labelCounts = new Map<string, number>()
        for (const group of byAnalyte.values()) {
          labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1)
        }
        const familyText = { quantity: null, percent: '%', titer: 'titer', ordinal: 'qualitative', text: 'text' } as const
        const distinctLabel = (group: ReturnType<typeof labCategoryAnalyte>) => {
          if ((labelCounts.get(group.label) ?? 0) < 2) return group.label
          const qualifiers = [group.loinc ? `LOINC ${group.loinc}` : null, familyText[group.family]].filter(Boolean)
          return qualifiers.length > 0 ? `${group.label} (${qualifiers.join(', ')})` : `${group.label} (${group.canonicalKey})`
        }

        const groups = [...byAnalyte.values()].map((group) => {
          const series = [...group.observations].sort((a, b) =>
            (observationDate(b) || '').localeCompare(observationDate(a) || '')
          )
          return {
            analyte: distinctLabel(group),
            canonicalKey: group.canonicalKey,
            ...(group.loinc ? { loinc: group.loinc } : {}),
            category,
            observationCount: series.length,
            latestDate: observationDate(series[0]),
            results: series.slice(0, withTrend ? 10 : 1).map(observationResult),
          }
        }).sort((a, b) =>
          compareTestsByPreferred(categoryDefinition)(a.analyte, b.analyte)
        )

        const capped = applyLimit(groups, limit, 50)
        const page = paginationMeta(groups.length, capped.length)
        return scrubLabResult({
          success: true,
          summary: groups.length > 0
            ? `Found ${groups.length} analyte(s) in lab category "${category}"`
            : `No observations matched lab category "${category}"`,
          category,
          count: groups.length,
          analyteCount: groups.length,
          observationCount: expanded.length,
          ...page,
          incomplete: false,
          canConcludeAbsence: true,
          ...(category === 'immuno' ? {
            // Specific-allergen IgE (30022C) is kept out of every lab category,
            // so this answer says nothing about allergen tests.
            excludedFromCategory: {
              specificAllergenIgE: collection!.observations.filter((observation: any) =>
                String(observation?.status ?? '').toLowerCase() !== 'entered-in-error'
                && isExcludedFromCumulativeReport(observation)
                && isWithinDateRange(observationDate(observation), dateFrom, dateTo)
              ).length,
              instruction: 'Specific-allergen IgE results are not part of any lab category; canConcludeAbsence does not apply to them. Use searchObservationByName (e.g. the allergen name) or queryObservations to find allergen tests.',
            },
          } : {}),
          dateRange: { from: dateFrom, to: dateTo },
          availableAnalytes: groups.map(group => group.analyte),
          groundingRules: {
            normalityStatusIsAuthoritative: true,
            referenceRangeMayOnlyBeRepeatedWhenPresent: true,
            missingNormalityText: '資料未提供正常／異常判定',
            instruction: 'Do not add customary ranges, diagnose a condition, or infer the cause of an abnormal result.',
          },
          data: capped,
        }, { discovery: true, dateFrom, dateTo, abnormalOnly })
      },
    }),

    queryImagingRecords: tool({
      description: 'PRIMARY tool for imaging and pathology existence/details. Queries BOTH imaging/pathology DiagnosticReports and standalone ImagingStudy resources using the same classification rules as the Imaging UI. Supports fuzzy query, modality, body site, status, and date range. Image attachments are reported as present without sending binary pixels; textual report attachments are decoded.',
      inputSchema: imagingRecordsSchema,
      execute: async ({ query, modality, bodySite, status, dateFrom, dateTo, limit, summarize }:
        z.infer<typeof imagingRecordsSchema>) => {
        const scrub = scrubForDomains(["DiagnosticReport","Observation","ImagingStudy"])
        const collection = getData().collection
        if (!collection) {
          return scrub(unavailableQueryResult(
            collection,
            ['DiagnosticReport', 'ImagingStudy'],
            '影像或病理檢查',
          ))
        }

        const queryIssues = queryIssuesFor(
          collection,
          ['DiagnosticReport', 'ImagingStudy'],
        )
        const studiesById = new Map(
          (collection.imagingStudies ?? [])
            .filter((study: any) => !!study?.id)
            .map((study: any) => [study.id, study]),
        )
        const linkedStudyIds = new Set<string>()
        const records: any[] = []

        for (const report of collection.diagnosticReports) {
          if (!matchDiagnosticReportCategory(report, 'imaging')) continue
          const linkedStudies = (report.imagingStudy ?? [])
            .map((reference: any) => referenceId(reference?.reference))
            .filter((id: string | undefined): id is string => !!id)
            .map((id: string) => {
              linkedStudyIds.add(id)
              return studiesById.get(id)
            })
            .filter(Boolean)

          const reportSearchText = [
            diagnosticReportSearchText(report),
            ...linkedStudies.map(imagingStudySearchText),
          ].join(' ')
          const modalityText = [
            conceptSearchText(report.code),
            ...linkedStudies.map(imagingStudyModalitySearchText),
          ].filter(Boolean).join(' ')
          const bodySiteText = [
            conceptSearchText(report.code),
            report.conclusion,
            ...linkedStudies.map(imagingStudyBodySiteText),
          ].filter(Boolean).join(' ')
          const date = diagnosticReportDate(report)

          if (!matchesImagingQuery(reportSearchText, query)) continue
          if (!matchSubstring(modalityText, modality)) continue
          if (!matchSubstring(bodySiteText, bodySite)) continue
          if (
            !matchStatus(report.status, status)
            && !linkedStudies.some((study: any) => matchStatus(study.status, status))
          ) continue
          if ((dateFrom || dateTo) && !isWithinDateRange(date, dateFrom, dateTo)) continue

          const detail = diagnosticReportOutput(report)
          records.push({
            ...detail,
            linkedImagingStudies: linkedStudies.map((study: any) => ({
              resourceType: 'ImagingStudy',
              studyName: imagingStudyTitle(study),
              date: study.started,
              status: study.status,
              modality: imagingStudyModalityText(study),
              metadata: imagingStudyMetadataForAi(study),
            })),
          })
        }

        for (const study of collection.imagingStudies ?? []) {
          if (study?.id && linkedStudyIds.has(study.id)) continue
          const searchText = imagingStudySearchText(study)
          const modalitySearchText = imagingStudyModalitySearchText(study)
          const modalityText = imagingStudyModalityText(study)
          const bodySiteText = imagingStudyBodySiteText(study)
          if (!matchesImagingQuery(searchText, query)) continue
          if (!matchSubstring(modalitySearchText, modality)) continue
          if (!matchSubstring(bodySiteText, bodySite)) continue
          if (!matchStatus(study.status, status)) continue
          if (
            (dateFrom || dateTo)
            && !isWithinDateRange(study.started, dateFrom, dateTo)
          ) continue

          records.push({
            resourceType: 'ImagingStudy',
            studyName: imagingStudyTitle(study),
            date: study.started,
            status: study.status,
            modality: modalityText,
            bodySite: bodySiteText || undefined,
            metadata: imagingStudyMetadataForAi(study),
          })
        }

        records.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        const capped = applyLimit(records, limit, 20)
        const page = paginationMeta(records.length, capped.length)
        const incomplete = queryIssues.length > 0
        const summary = records.length > 0
          ? `Found ${records.length} imaging/pathology record(s)`
          : incomplete
            ? 'Unable to determine absence because one or more imaging resource queries failed'
            : notFoundMessage('影像或病理檢查', dateFrom, dateTo)

        return scrub({
          success: records.length > 0 || !incomplete,
          summary,
          count: records.length,
          ...page,
          incomplete,
          canConcludeAbsence: !incomplete,
          queryIssues,
          dateRange: { from: dateFrom, to: dateTo },
          data: summarize
            ? capped.map((record: any) => ({
                resourceType: record.resourceType,
                name: record.reportName || record.studyName,
                date: record.date,
                status: record.status,
                modality: record.modality,
                resultCount: record.results?.length,
                imageAttachmentCount: record.imageAttachmentCount,
              }))
            : capped,
        })
      },
    }),

    searchObservationByName: tool({
      description: 'Fuzzy-search observations by name or component name/code when you don\'t know the LOINC. e.g. query="HbA1c" returns latest values. Panel readings retain their named values and units under components. Set withTrend=true to get up to 10 most recent values for trending.',
      inputSchema: observationSearchSchema,
      execute: async ({ query, withTrend, limit }: z.infer<typeof observationSearchSchema>) => {
        const { collection } = getData()
        const unavailable = unavailableQueryResult(
          collection,
          ['Observation'],
          '指定名稱的檢驗或觀察數據',
        )
        if (unavailable) return scrubLabResult(unavailable)

        const unique = uniqueObservations(collection!)

        // Grouping key = LOINC code so one analyte stored under different display
        // names (e.g. "eGFR" vs "Estimated GFR", both LOINC 33914-3) collapses
        // into a single dated series instead of splitting — which would let a
        // stale value be returned as "latest". Real data also mixes coded and
        // uncoded entries of the same analyte (e.g. PT: one with LOINC, one
        // without), so an uncoded entry inherits the LOINC of a same-text sibling.
        const textToLoinc = new Map<string, string>()
        for (const o of unique) {
          const loinc = loincOf(o.code)
          const text = o.code?.text
          if (loinc && text && !textToLoinc.has(text)) textToLoinc.set(text, loinc)
        }
        const codeKey = (concept: any): string =>
          loincOf(concept) ||
          (concept?.text && textToLoinc.get(concept.text)) ||
          concept?.coding?.[0]?.code ||
          pickName(concept) ||
          'Unknown'

        // Match panel and component names/codes, then retain each dated panel
        // as a whole so systolic and diastolic readings cannot be mixed.
        const nameMatches = (o: any): boolean => {
          return observationConcepts(o).some(concept => conceptMatchesQuery(concept, query))
        }
        const seedKeys = new Set(unique.filter(nameMatches).map((o: any) => codeKey(o.code)))
        // Expand to every observation sharing a matched LOINC, so display aliases
        // (e.g. "eGFR" vs "Estimated GFR") come along as one series.
        let matches = unique.filter((o: any) => seedKeys.has(codeKey(o.code)))
        matches = matches.sort((a, b) =>
          (observationDate(b) || '').localeCompare(observationDate(a) || '')
        )

        // Group by LOINC code → keep N most recent per analyte
        const perCodeLimit = withTrend ? 10 : 1
        const byCode = new Map<string, any[]>()
        for (const o of matches) {
          const k = codeKey(o.code)
          const arr = byCode.get(k) ?? []
          if (arr.length < perCodeLimit) {
            arr.push(o)
            byCode.set(k, arr)
          }
        }

        const flat: any[] = []
        for (const [, items] of byCode) {
          // Canonical display = the most-recent entry's name (matches found at top).
          const name = pickName(items[0].code) || 'Unknown'
          for (const o of items) flat.push({ name, obs: o })
        }
        const capped = applyLimit(flat, limit, 50)
        const page = paginationMeta(flat.length, capped.length)

        return scrubLabResult({
          success: true,
          summary: matches.length > 0
            ? `Matched ${matches.length} observation(s) across ${byCode.size} code(s) for "${query}"`
            : `Matched 0 observation(s) for "${query}". Names are matched by substring and by analyte alias (BUN, CRP, uric acid, HbA1c, …); before concluding the test was never done, call listAvailableObservationCodes to see the names this record actually uses.`,
          count: capped.length,
          ...page,
          incomplete: false,
          canConcludeAbsence: true,
          data: capped.map(({ name, obs }) => ({
            code: name,
            value: obs.valueQuantity?.value ?? obs.valueString,
            unit: obs.valueQuantity?.unit,
            date: observationDate(obs),
            effectiveDateTime: obs.effectiveDateTime,
            abnormal: isAbnormalObservation(obs),
            ...observationComponentFields(obs),
          })),
        }, { discovery: Boolean(query) })
      },
    }),

    queryProcedures: tool({
      description: 'Query patient procedures (surgeries, interventions).',
      inputSchema: proceduresSchema,
      execute: async ({ status, dateFrom, dateTo, limit }: z.infer<typeof proceduresSchema>) => {
        const scrub = scrubForQueries(["Procedure"], ['Procedure'], '處置或手術紀錄')
        const list = getData().collection?.procedures ?? []
        let filtered = list.filter((p: any) => matchStatus(p.status, status))
        if (dateFrom || dateTo) {
          filtered = filtered.filter((p: any) =>
            isWithinDateRange(p.performedDateTime || p.performedPeriod?.start, dateFrom, dateTo)
          )
        }
        const capped = applyLimit(filtered, limit)
        return scrub({
          success: true,
          summary: `Found ${filtered.length} Procedure record(s)`,
          count: filtered.length,
          data: capped.map((p: any) => ({
            procedure: pickName(p.code),
            status: p.status,
            performedDateTime: p.performedDateTime || p.performedPeriod?.start,
          })),
        })
      },
    }),

    listAvailableObservationCodes: tool({
      description: 'List distinct observation / lab names the patient has on record, with how many entries exist for each. Useful before using searchObservationByName when you\'re unsure what to search for.',
      inputSchema: listObservationCodesSchema,
      execute: async () => {
        const scrub = scrubForDomains(['Observation', 'DiagnosticReport'])
        const { collection } = getData()
        const unavailable = unavailableQueryResult(
          collection,
          ['Observation'],
          '可查詢的檢驗項目',
        )
        if (unavailable) return scrub(unavailable)

        const all = uniqueObservations(collection!)
        const counts = new Map<string, number>()
        for (const o of all) {
          const names = new Set(observationConcepts(o).map(pickName).filter((name): name is string => !!name))
          for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
        }
        const data = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([code, count]) => ({ code, count }))

        return scrub({
          success: true,
          summary: `${data.length} distinct observation codes`,
          count: data.length,
          ...paginationMeta(data.length, data.length),
          incomplete: false,
          canConcludeAbsence: true,
          data,
        })
      },
    }),

    // ── Medications & Allergies ────────────────────────────────────────────

    queryMedications: tool({
      description: 'Query medication records with exact source name/status/dosage/supply fields plus governed NHI terminology or source WHO ATC classification when available. Supports product/ingredient/ATC search, status, chronic, explicit dates, and server-resolved timeRange presets such as last-90-days. For "what is the patient on right now" prefer getActiveMedicationList, which applies currentness rules and safely deduplicates refill cycles.',
      inputSchema: medicationsSchema,
      execute: async ({ query, status, chronic, timeRange, dateFrom, dateTo, limit }:
        z.infer<typeof medicationsSchema>) => {
        const scrub = scrubForDomains(["MedicationRequest","MedicationStatement","Basic"])
        const { collection } = getData()
        if (!collection) {
          return scrub(unavailableQueryResult(
            collection,
            ['MedicationRequest', 'MedicationStatement'],
            '用藥紀錄',
          ))
        }
        const queryIssues = queryIssuesFor(
          collection,
          ['MedicationRequest', 'MedicationStatement'],
        )
        const list = collection.medications
        let filtered = list.filter((m: any) =>
          matchStatus(m.status, status) &&
          matchChronic(m.courseOfTherapyType, chronic)
        )
        const resolvedDateRange = resolveMedicationDateRange(timeRange, dateFrom, dateTo)
        if (resolvedDateRange.dateFrom || resolvedDateRange.dateTo) {
          filtered = filtered.filter((m: any) => isWithinDateRange(
            m.authoredOn,
            resolvedDateRange.dateFrom,
            resolvedDateRange.dateTo,
          ))
        }
        if (query) {
          filtered = filtered.filter((medication) => matchSubstring([
            conceptSearchText(medication.medicationCodeableConcept),
            medication.medicationReference?.display,
            medication.drugTerminology?.officialNameZh,
            medication.drugTerminology?.officialNameEn,
            medication.drugTerminology?.ingredientText,
            medication.drugTerminology?.doseForm,
            medication.drugTerminology?.atcCode,
            medication.drugTerminology?.atcNameZh,
            medication.drugTerminology?.atcNameEn,
            medication.drugTerminology?.atcLevel2NameZh,
            medication.drugTerminology?.atcLevel2NameEn,
            medication.drugTerminology?.atcLevel4NameZh,
            medication.drugTerminology?.atcLevel4NameEn,
            medication.atcClassification?.atcCode,
            medication.atcClassification?.atcNameEn,
            medication.atcClassification?.atcLevel2NameZh,
            medication.atcClassification?.atcLevel2NameEn,
            medication.atcClassification?.atcLevel4NameZh,
            medication.atcClassification?.atcLevel4NameEn,
          ].filter(Boolean).join(' '), query))
        }
        filtered = [...filtered].sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))
        const capped = applyLimit(filtered, limit)
        const nowMs = Date.now()
        return scrub({
          success: true,
          summary: queryIssues.length > 0
            ? `Found ${filtered.length} medication record(s), but one or more medication resource queries are incomplete`
            : `Found ${filtered.length} medication record(s)`,
          count: filtered.length,
          ...paginationMeta(filtered.length, capped.length),
          incomplete: queryIssues.length > 0,
          canConcludeAbsence: queryIssues.length === 0,
          queryIssues,
          ...(timeRange ? { timeRange, resolvedDateRange } : {}),
          groundingRules: medicationGroundingRules(capped),
          data: capped.map((medication) =>
            medicationToolFields(medication, nowMs, 'dosageInstruction')
          ),
        })
      },
    }),

    getActiveMedicationList: tool({
      description: 'Shortcut for "what is the patient currently on?" — uses explicit lifecycle status when usable and a computable supply window when source status is missing or unknown. Only records with neither usable status nor computable supply timing remain uncertain. Every distinct order remains available; sourceComparison marks unconfirmed source copies. Set chronicOnly to filter to 慢箋.',
      inputSchema: activeMedicationsSchema,
      execute: async ({ chronicOnly }: z.infer<typeof activeMedicationsSchema>) => {
        const scrub = scrubForDomains(["MedicationRequest","MedicationStatement","Basic"])
        const { collection } = getData()
        if (!collection) {
          return scrub(unavailableQueryResult(
            collection,
            ['MedicationRequest', 'MedicationStatement'],
            '目前用藥',
          ))
        }
        const queryIssues = queryIssuesFor(
          collection,
          ['MedicationRequest', 'MedicationStatement'],
        )
        const list = collection.medications
        const now = Date.now()
        const active = list.filter((m: any) => {
          if (chronicOnly && !isChronicByCourseOfTherapy(m.courseOfTherapyType)) return false
          return isMedicationCurrentlyInUse(m, now)
        })
        const uncertain = list.filter((m: any) =>
          (!chronicOnly || isChronicByCourseOfTherapy(m.courseOfTherapyType))
          && isMedicationCurrentnessUncertain(m, now)
        )

        const deduped = annotateMedicationRecordCounts(active, list)
          .sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))
        const uncertainDeduped = annotateMedicationRecordCounts(uncertain, list)
          .sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))
        const currentPage = deduped.slice(0, 50)
        const uncertainPage = uncertainDeduped.slice(0, 50)
        const incomplete = queryIssues.length > 0
        const canConcludeAbsence = !incomplete && uncertainDeduped.length === 0

        return scrub({
          success: true,
          summary: `${deduped.length} current medication source records in ${summarizeSourceComparisons(active).comparisonGroupCount} display groups; ${summarizeSourceComparisons(active).unconfirmedGroupCount} groups have unconfirmed cross-source correspondence.${uncertainDeduped.length ? ` ${uncertainDeduped.length} additional records have unresolved currentness.` : ''} Source record count is not a confirmed prescription count.`,
          count: deduped.length,
          sourceComparisonCounts: summarizeSourceComparisons(active),
          ...paginationMeta(deduped.length, currentPage.length),
          incomplete,
          canConcludeAbsence,
          queryIssues,
          uncertainCount: uncertainDeduped.length,
          uncertainReturnedCount: uncertainPage.length,
          uncertainTruncated: uncertainPage.length < uncertainDeduped.length,
          groundingRules: medicationGroundingRules([...currentPage, ...uncertainPage]),
          data: currentPage.map((medication) => ({
            ...medicationToolFields(medication, now, 'dosage'),
            sourceRecordCount: medication.sourceRecordCount,
          })),
          uncertainData: uncertainPage.map((medication) => ({
            ...medicationToolFields(medication, now, 'dosage'),
            currentness: 'uncertain-source-status',
            sourceRecordCount: medication.sourceRecordCount,
          })),
        })
      },
    }),

    queryAllergies: tool({
      description: 'Query patient allergies and intolerances. Filter by `severity` (high/moderate/low) to narrow to clinically significant ones.',
      inputSchema: allergiesSchema,
      execute: async ({ type, severity }: z.infer<typeof allergiesSchema>) => {
        const scrub = scrubForQueries(["AllergyIntolerance"], ['AllergyIntolerance'], '過敏或不耐受紀錄')
        const list = getData().collection?.allergies ?? []
        const filtered = list.filter((a: any) =>
          matchAllergyType(a.type, type) &&
          matchAllergySeverity(a.criticality, severity)
        )
        return scrub({
          success: true,
          summary: `Found ${filtered.length} AllergyIntolerance record(s)`,
          count: filtered.length,
          data: filtered.map((a: any) => ({
            substance: pickName(a.code),
            criticality: a.criticality,
            type: a.type,
            recordedDate: a.recordedDate,
          })),
        })
      },
    }),

    queryImmunizations: tool({
      description: 'Query preventive vaccinations (FHIR Immunization). Supports date range.',
      inputSchema: immunizationsSchema,
      execute: async ({ dateFrom, dateTo, limit }: z.infer<typeof immunizationsSchema>) => {
        const scrub = scrubForQueries(["Immunization"], ['Immunization'], '疫苗接種紀錄')
        const list = getData().collection?.immunizations ?? []
        let filtered = list
        if (dateFrom || dateTo) {
          filtered = filtered.filter((imm: any) => isWithinDateRange(imm.occurrenceDateTime, dateFrom, dateTo))
        }
        const capped = applyLimit(filtered, limit)
        return scrub({
          success: true,
          summary: `Found ${filtered.length} Immunization record(s)`,
          count: filtered.length,
          dateRange: { from: dateFrom, to: dateTo },
          data: capped.map((imm: any) => ({
            vaccine: pickName(imm.vaccineCode),
            code: imm.vaccineCode?.coding?.[0]?.code,
            status: imm.status,
            occurrenceDateTime: imm.occurrenceDateTime,
            lotNumber: imm.lotNumber,
            manufacturer: imm.manufacturer?.display,
          })),
        })
      },
    }),
  }
}
