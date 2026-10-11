// Lab pivot builder — pure data transform (no React). Moved from
// features/clinical-summary/reports/hooks/useLabPivot.ts so core (AI-context
// lab section) can reuse it without a core→features dependency; the hook file
// re-exports everything for existing feature/test imports.
// Groups observations by lab category, then pivots into test (row) × date (column).
// Groups observations by lab category, then pivots into test (row) × date (column).
import { categorizeObservation, getTestDisplayName, compareTestsByPreferred, LAB_CATEGORIES, type LabCategory } from '@/src/shared/utils/lab-categories'
import {
  CANONICAL_KEYS,
  CANONICAL_DISPLAY,
  canonicalKeyFromLoinc,
  canonicalTestKeyFromString,
  MYCOBACTERIAL_CULTURE_KEY,
} from '@voho0000/clinical-lab-normalization/canonical'
import {
  classifyGlucose,
  GLUCOSE_SUBTYPE_LABEL,
  getOriginalAnalyteDisplayForObs,
  type AnalyteNameMode,
} from '@voho0000/clinical-lab-normalization/display'
import { normalizeAnalyteUnit } from '@/src/shared/utils/unit-scale'
import { isObservationAbnormal } from '@voho0000/clinical-lab-normalization/interpretation'
import { FHIR_SYSTEMS } from '@/src/shared/constants/fhir-systems.constants'
import {
  getNhiMedicloudOriginalInstitution,
  isInferredObservationUnit,
  isAdultPreventiveHealthExamResource,
  isNhiMedicloudObservation,
} from '@/src/shared/utils/observation-provenance.utils'
import { formatNumberSmart } from '@/src/shared/utils/number-format.utils'

export interface LabCell {
  adultPreventive?: boolean
  /** A single record's value — for a Quantity, the bare number. A same-day
   *  merge ("a / b", "Reactive (0.5)") is display text that already carries
   *  each record's comparator. Print it through `cellDisplayValue`. */
  value: string
  /** Every source value, as display text with its own comparator, when
   *  multiple records share one analyte/day cell. */
  allValues?: string[]
  unit?: string
  interpretationCode?: string  // 'H'|'L'|'N'|'A'|'AA'|'HH'|'LL' (HL7)
  isAbnormal?: boolean
  /** Quantity.comparator ('<' | '<=' | '>=' | '>') when the source sent one.
   *  `value` holds only the number, so a reader that prints a value on its own
   *  must put this back in front of it. Unset on a same-day merge, whose
   *  `value` already carries each record's comparator. */
  comparator?: string
  effectiveDateTime?: string
  status?: string
  unitInferred?: boolean
  sourceProvenance?: 'nhi-medicloud'
  sourceInstitution?: string
  /** Every source record behind this cell, in arrival order. A same-day cell
   *  merges several records into one slot and its top-level unit / status /
   *  flag are merged too, so anything that prints ONE value (copy formats)
   *  must read that value's own details from here. */
  sourceRecords?: LabCellRecord[]
}

export interface LabCellRecord {
  value: string
  provenance?: 'nhi-medicloud'
  institution?: string
  unit?: string
  comparator?: string
  isAbnormal?: boolean
  interpretationCode?: string
  status?: string
}

const INVALID_RECORD_STATUSES = new Set(['entered-in-error', 'cancelled'])

function isInvalidRecord(record: LabCellRecord): boolean {
  const status = record.status?.trim().toLowerCase()
  const value = record.value?.trim()
  return (!!status && INVALID_RECORD_STATUSES.has(status)) || !value || value === '—'
}

/** "<5" must never read as "5": the comparator goes back in front. The
 *  source text is otherwise left exactly as it came. */
export function recordDisplayValue(record: LabCellRecord): string {
  const text = record.value
  return record.comparator && !/^\s*[<>≤≥]/.test(text) ? `${record.comparator}${text.trim()}` : text
}

/**
 * The one record a single-value reader (the overview cell, a copy format)
 * shows for this cell, plus every valid record of that day.
 *
 * A same-day cell merges several records into one slot, and its top-level
 * status / unit / comparator / flag are merged too — a status of
 * "entered-in-error|final", the first value beside another record's unit or H.
 * So each record is judged on its own: invalid ones (entered-in-error,
 * cancelled, empty) are dropped BEFORE anything is picked, and the picked
 * value keeps its own unit, comparator and flag. The one merge kept whole is
 * the qualitative + quantitative pair ("Reactive (0.012)"), two halves of one
 * result. Null when no record is usable.
 */
export function primaryCellRecord(cell: LabCell): { record: LabCellRecord; valid: LabCellRecord[] } | null {
  const records: LabCellRecord[] = cell.sourceRecords?.length
    ? cell.sourceRecords
    : [{
      value: cell.value,
      unit: cell.unit,
      comparator: cell.comparator,
      isAbnormal: cell.isAbnormal,
      interpretationCode: cell.interpretationCode,
      status: cell.status,
    }]
  const valid = records.filter((record) => !isInvalidRecord(record))
  if (valid.length === 0) return null
  const qualQuantPair = !cell.allValues && records.length === 2 && valid.length === 2
  if (qualQuantPair) {
    // Rebuilt from the two records rather than the merged cell, which keeps
    // neither the number's comparator nor its unit: "Reactive (<0.5)" with
    // the number's own unit, not "Reactive (0.5)".
    const [first, second] = valid as [LabCellRecord, LabCellRecord]
    const quant = isNumericCellValue(first.value) ? first : second
    const qual = quant === first ? second : first
    const combined: LabCellRecord = {
      value: `${qual.value.trim()} (${recordDisplayValue(quant).trim()})`,
      unit: quant.unit,
      isAbnormal: !!qual.isAbnormal || !!quant.isAbnormal,
      interpretationCode: qual.interpretationCode || quant.interpretationCode,
      status: qual.status === quant.status ? qual.status : undefined,
    }
    return { record: combined, valid: [combined] }
  }
  return { record: valid[0]!, valid }
}

/** A cell's value as a clinician or the AI must read it: "<0.5", never "0.5".
 *  Every reader that prints a pivot cell goes through this. A missing value
 *  stays the placeholder — a comparator never turns "—" into "<—". */
export function cellDisplayValue(cell: LabCell): string {
  const text = cell.value?.trim()
  if (!text || text === '—') return cell.value
  return recordDisplayValue({ value: cell.value, comparator: cell.comparator })
}

export interface LabRow {
  mapKey: string              // unique pivot key (NHI_CODE:testKey or testKey)
  testKey: string             // canonical analyte name; may match across institutions
  displayName: string         // shown in left column
  /** Source coding retained for language-aware labels of unrecognized tests. */
  displaySource?: { code?: any }
  unit?: string               // unit summary (most common across all dates)
  values: Map<string, LabCell>  // date "YYYY-MM-DD" → cell
  subgroupId?: string         // assigned subgroup id (renal/liver/etc.)
  /** Cheap availability index built during the pivot pass. Full trend point
   *  details are constructed only after the user opens this analyte. */
  trendChartable?: boolean
}

export interface LabPivot {
  category: LabCategory
  dates: string[]   // sorted desc (newest first)
  rows: LabRow[]
}

function dateKey(s?: string): string | null {
  return s ? s.slice(0, 10) : null
}

// A pivot cell is "numeric" when its value parses as a finite number (the unit
// lives in a separate field). Qualitative serology results (Reactive / Positive
// / Negative / Trace …) are non-numeric. Drives the qualitative+quantitative
// same-day merge in the cell-write loop.
function isNumericCellValue(v: string | undefined): boolean {
  if (!v) return false
  const t = v.trim()
  if (t === '' || t === '—') return false
  return Number.isFinite(Number(t))
}

function cellContainsNumericValue(cell: LabCell): boolean {
  if (isNumericCellValue(cell.value)) return true
  // allValues are display text: "<0.5" is still a number for the unit rule.
  return cell.allValues?.some((v) => isNumericCellValue(v.replace(/^\s*[<>≤≥]=?/, ''))) ?? false
}

interface TrendAvailabilityStats {
  pointCount: number
  units: Set<string>
  specimens: Set<string>
}

const INVALID_TREND_STATUSES = new Set(['entered-in-error', 'cancelled'])

function compactTrendUnit(unit: string | undefined): string {
  if (!unit) return '__missing__'
  return unit
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/μ/g, 'µ')
    .toLowerCase() || '__missing__'
}

// NOTE (2026-07-10): the app-side HARDCODED_REF_RANGES table (TSH / lipids /
// HbA1c / glucose-AC …) was REMOVED per user directive. Abnormal flagging now
// derives from the source's Observation.interpretation when present, falling
// back only to audited source reference ranges (structured low/high or simple
// text like "0~41" / "<5"; see @voho0000/clinical-lab-normalization/interpretation).
// The app still does not invent its own normal ranges.

// Exported for unit-test access; the cumulative-report cell colouring
// depends on its isAbnormal output, so we lock it down separately from
// the React hook.
export function formatValue(obs: any): { value: string; unit?: string; numericValue?: number; isAbnormal: boolean; interpretationCode?: string; status?: string; unitInferred: boolean } {
  let value = '—'
  let unit: string | undefined
  let numericValue: number | undefined
  if (obs.valueQuantity?.value !== undefined && obs.valueQuantity?.value !== null) {
    numericValue = obs.valueQuantity.value
    value = String(obs.valueQuantity.value)
    unit = obs.valueQuantity.unit || obs.valueQuantity.code
  } else if (
    obs.valueRange?.low?.value !== undefined
    || obs.valueRange?.high?.value !== undefined
  ) {
    const low = obs.valueRange.low?.value
    const high = obs.valueRange.high?.value
    value = `${low === undefined ? '?' : formatNumberSmart(low)}–${high === undefined ? '?' : formatNumberSmart(high)}`
    unit = obs.valueRange.low?.unit
      || obs.valueRange.low?.code
      || obs.valueRange.high?.unit
      || obs.valueRange.high?.code
  } else if (obs.valueString) {
    value = obs.valueString
  } else if (obs.valueCodeableConcept?.text) {
    value = obs.valueCodeableConcept.text
  }
  // Observation.interpretation is FHIR 0..* (array); tolerate the single-concept
  // shape too. This is the SOURCE's own verdict and is authoritative.
  const interp = obs.interpretation?.[0]?.coding?.[0]?.code || obs.interpretation?.coding?.[0]?.code
  // Shared abnormal policy: source interpretation wins; if absent, audited
  // source reference ranges may flag the value.
  const isAbnormal = isObservationAbnormal(obs)

  return {
    value,
    unit,
    numericValue,
    isAbnormal,
    interpretationCode: interp,
    status: typeof obs.status === 'string' ? obs.status.toLowerCase() : undefined,
    unitInferred: isInferredObservationUnit(obs),
  }
}

// NHI system URI used by the 健康存摺 bridge
const NHI_LAB_SYSTEM = 'urn:oid:nhi.lab.code'

// The current bridges emit the TW Core URI while older cached bundles use the
// OID above. Match both without treating unrelated local codes as NHI orders.
function getNhiLabCode(obs: any): string | null {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  for (const coding of codings) {
    const system = typeof coding?.system === 'string' ? coding.system.toLowerCase() : ''
    if (system !== NHI_LAB_SYSTEM && !system.includes('nhi-medical-order-code') && !system.includes('nhi-lab-code')) {
      continue
    }
    const code = typeof coding?.code === 'string' ? coding.code.trim().toUpperCase() : ''
    if (code) return code
  }
  return null
}

function microbiologyLocalIdentity(obs: any): { testKey: string; displayName: string } | null {
  const nhiCode = getNhiLabCode(obs)
  if (!nhiCode) return null
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const labels = [
    obs?.code?.text,
    ...codings
      .filter((coding) => !getNhiLabCode({ code: { coding: [coding] } }))
      .flatMap((coding) => [coding?.display, coding?.code]),
  ]
    .filter((label): label is string => typeof label === 'string' && !!label.trim())
    .join(' ')
    .normalize('NFKC')
    .toUpperCase()

  const microscopyIdentities: Array<[RegExp, string, string]> = [
    [/\bG\(\+\)\s*(?:BACILLUS|BACILLI)\b|格蘭氏陽性桿菌|革蘭氏陽性桿菌/, 'GRAM-POSITIVE-BACILLI', 'Gram-positive bacilli'],
    [/\bG\(-\)\s*(?:BACILLUS|BACILLI)\b|格蘭氏陰性桿菌|革蘭氏陰性桿菌/, 'GRAM-NEGATIVE-BACILLI', 'Gram-negative bacilli'],
    [/\bG\(\+\)\s*(?:COCCUS|COCCI)\b|格蘭氏陽性球菌|革蘭氏陽性球菌/, 'GRAM-POSITIVE-COCCI', 'Gram-positive cocci'],
    [/\bG\(-\)\s*(?:COCCUS|COCCI)\b|格蘭氏陰性球菌|革蘭氏陰性球菌/, 'GRAM-NEGATIVE-COCCI', 'Gram-negative cocci'],
    [/\bW\.?B\.?C\.?[- ]?SPUTUM\b/, 'MICROSCOPY-WBC', 'WBC (microscopy)'],
    [/\bEP\.?\s*CELL[- ]?SPUTUM\b/, 'MICROSCOPY-EPITHELIAL-CELLS', 'Epithelial cells (microscopy)'],
    [/^NEUTROPHILS?(?:\s|$)/, 'MICROSCOPY-NEUTROPHILS', 'Neutrophils (microscopy)'],
  ]
  if (nhiCode === '13006C') {
    for (const [pattern, testKey, displayName] of microscopyIdentities) {
      if (pattern.test(labels)) return { testKey, displayName }
    }
  }

  if (nhiCode === '13007C' || nhiCode === '13008C') {
    const cultureIdentities: Array<[RegExp, string, string]> = [
      [/\bANAEROBIC\b/, 'ANAEROBIC-CULTURE', 'Anaerobic Culture'],
      [/\bFUNGUS\b|\bFUNGAL\b|黴菌|真菌/, 'FUNGAL-CULTURE', 'Fungal Culture'],
      [/\bID\s*\+\s*DS\s+COMMON\b/, 'CULTURE-ID-SUSCEPTIBILITY', 'Culture identification / susceptibility'],
    ]
    for (const [pattern, testKey, displayName] of cultureIdentities) {
      if (pattern.test(labels)) return { testKey, displayName }
    }
  }
  return null
}

// Legacy/code-only bundles can still safely join the mycobacterial culture
// family when the official NHI culture order is paired with an explicit
// culture label. Requiring both signals prevents cross-carried SMEAR rows under
// 13026C from being mislabeled as cultures. New bundles normally take the
// stronger LOINC 50941-4 path before this fallback is needed.
const MYCOBACTERIAL_CULTURE_NHI_CODES = new Set(['13012C', '13026C'])

function hasNhiMycobacterialCultureEvidence(obs: any): boolean {
  const nhiCode = getNhiLabCode(obs)
  if (!nhiCode || !MYCOBACTERIAL_CULTURE_NHI_CODES.has(nhiCode)) return false

  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const labels = [obs?.code?.text, ...codings.map((coding) => coding?.display)]
    .filter((label): label is string => typeof label === 'string' && !!label.trim())
    .join(' ')
    .normalize('NFKC')
    .toUpperCase()

  const saysCulture = /CULTUR|培養/.test(labels)
  const saysStain = /STAIN|SMEAR|染色|抹片/.test(labels)
  return saysCulture && !saysStain
}

// testKeys where different NHI codes represent clinically distinct analytes that
// must remain as separate pivot columns. All other tests merge by testKey so
// cross-institution same-analyte rows collapse into one column.
// Glucose was here but is now subclassified by display+LOINC (see
// classifyGlucose in @voho0000/clinical-lab-normalization/display), which is more reliable than NHI code
// because some hospitals bill finger sugar under fasting NHI codes.
const KEEP_SEPARATE_BY_NHI = new Set<string>([])

// Compatibility mappings missing from clinical-lab-normalization 1.1.1.
// LOINC remains authoritative: these are verified bridge-emitted analytes,
// not display-string guesses. Remove each entry after the shared package ships
// the same mapping and this app upgrades to that release.
const APP_LOINC_TO_CANONICAL: Readonly<Record<string, string>> = {
  '2885-2': 'TP',   // Total protein [Mass/volume] in Serum or Plasma
  '2731-8': 'IPTH',  // Parathyrin.intact [Mass/volume] in Serum or Plasma
  '14866-8': 'IPTH', // Parathyrin.intact [Moles/volume] in Serum or Plasma
  // 2026-09-27: codes real bridge bundles (健康存摺 ×14, medcloud) carry
  // that the package table lacks, so the rows only joined their column when
  // the source NAME happened to match an alias — a bilingual "嗜鹼性白血球 /
  // Basophil" or "尿糖 / Glucose" split into a column of its own. Every code
  // verified against NLM Clinical Table Search (LONG_COMMON_NAME quoted).
  // (The differential percentages 706-2 / 713-8 / 736-9 / 5905-5 / 770-8 now
  // live in DIFFERENTIAL_LOINC_TO_KEY below, beside their #/volume twins.)
  '18262-6': 'LDL',  // Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay
  '22763-7': 'AMMONIA', // Ammonia [Mass/volume] in Plasma
  // High-sensitivity troponins keep their own rows, never TROP: results from
  // different troponin assays must not be compared (see lab-categories chem).
  '89579-7': 'HS-TROPONIN I', // Troponin I.cardiac [Mass/volume] in Serum or Plasma by High sensitivity method
  '67151-1': 'HS-TROPONIN T', // Troponin T.cardiac [Mass/volume] in Serum or Plasma by High sensitivity method
  // Urine — category is decided by the urine LOINC allowlist, so CREA / PROT
  // here are the urine panel's own columns, not the serum ones.
  '2161-8': 'CREA',   // Creatinine [Mass/volume] in Urine
  '14957-5': 'MALB',  // Microalbumin [Mass/volume] in Urine
  '2888-6': 'PROT',   // Protein [Mass/volume] in Urine
  '25428-4': 'GLUCOSE', // Glucose [Presence] in Urine by Test strip
  '2514-8': 'KETONE', // Ketones [Presence] in Urine by Test strip
  '19161-9': 'UROBI', // Urobilinogen [Units/volume] in Urine by Test strip
  '24124-0': 'CASTS', // Casts [Presence] in Urine sediment by Light microscopy
  // Its own column — not folded into RISKF, whose exact ratio definition at
  // the source hospital is unverified.
  '9830-1': 'TC/HDL RATIO', // Cholesterol.total/Cholesterol in HDL [Mass Ratio] in Serum or Plasma
}

// ── Differential: absolute count versus percentage ──────────────────────────
// A white-cell differential (and the reticulocyte count) is reported two ways:
// as an absolute count (LOINC property NCnc, units /µL, 10^3/µL, x10^9/L) and
// as a share of the parent cells (property NFr, unit %). Hospitals send both
// under ONE label — 「嗜中性白血球 / Neutrophil」 for 751-8 and for 770-8 — so a
// name-based key put 3.2 (10^3/µL) beside 55 (%) in one column and drew one
// trend through them. The percentage keeps the established column (NEU, LYM,
// …); the count goes to its absolute-count column, after the existing ANC.

/** Percentage key → absolute-count key. */
const COUNT_KEY_FOR_FRACTION_KEY: Readonly<Record<string, string>> = {
  NEU: 'ANC',
  LYM: 'ALC',
  MONO: 'AMC',
  EOS: 'AEC',
  BASO: 'ABC',
  BAND: 'BAND-ABS',
  BLAST: 'BLAST-ABS',
  PROMYELOCYTE: 'PROMYELOCYTE-ABS',
  MYELOCYTE: 'MYELOCYTE-ABS',
  'META-MYELOCYTE': 'META-MYELOCYTE-ABS',
  NORMOBLAST: 'NORMOBLAST-ABS',
  'PLASMA-CELL': 'PLASMA-CELL-ABS',
  RETIC: 'ARC',
}

const FRACTION_KEY_FOR_COUNT_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(COUNT_KEY_FOR_FRACTION_KEY).map(([fraction, count]) => [count, fraction]),
)

/** Every absolute-count column key (ANC itself comes from the shared package). */
export const DIFFERENTIAL_COUNT_KEYS: ReadonlySet<string> = new Set(Object.values(COUNT_KEY_FOR_FRACTION_KEY))

/**
 * LOINC codes whose PROPERTY (NCnc #/volume, NFr fraction) decides the column.
 * Consulted before the shared package table, which files 711-2 (#/volume)
 * under EOS and 14196-0 (#/volume) under RETIC. Every code and its property
 * verified with tx.fhir.org CodeSystem/$lookup (LOINC 2.82), 2026-10-09.
 */
const DIFFERENTIAL_LOINC_TO_KEY: Readonly<Record<string, string>> = {
  // Neutrophils (segmented neutrophils are the same column, as SEG → NEU is)
  '751-8': 'ANC',    // Neutrophils [#/volume] in Blood by Automated count — NCnc
  '753-4': 'ANC',    // Neutrophils [#/volume] in Blood by Manual count — NCnc
  '26499-4': 'ANC',  // Neutrophils [#/volume] in Blood — NCnc
  '768-2': 'ANC',    // Segmented neutrophils [#/volume] in Blood by Manual count — NCnc
  '30451-9': 'ANC',  // Segmented neutrophils [#/volume] in Blood — NCnc
  '770-8': 'NEU',    // Neutrophils/Leukocytes in Blood by Automated count — NFr
  '23761-0': 'NEU',  // Neutrophils/Leukocytes in Blood by Manual count — NFr
  '26511-6': 'NEU',  // Neutrophils/Leukocytes in Blood — NFr
  '769-0': 'NEU',    // Segmented neutrophils/Leukocytes in Blood by Manual count — NFr
  // Band forms
  '763-3': 'BAND-ABS',  // Band form neutrophils [#/volume] in Blood by Manual count — NCnc
  '26507-4': 'BAND-ABS', // Band form neutrophils [#/volume] in Blood — NCnc
  '764-1': 'BAND',   // Band form neutrophils/Leukocytes in Blood by Manual count — NFr
  '26508-2': 'BAND', // Band form neutrophils/Leukocytes in Blood — NFr
  '35332-6': 'BAND', // Band form neutrophils/Leukocytes in Blood by Automated count — NFr
  // Lymphocytes
  '731-0': 'ALC',    // Lymphocytes [#/volume] in Blood by Automated count — NCnc
  '732-8': 'ALC',    // Lymphocytes [#/volume] in Blood by Manual count — NCnc
  '26474-7': 'ALC',  // Lymphocytes [#/volume] in Blood — NCnc
  '736-9': 'LYM',    // Lymphocytes/Leukocytes in Blood by Automated count — NFr
  '737-7': 'LYM',    // Lymphocytes/Leukocytes in Blood by Manual count — NFr
  '26478-8': 'LYM',  // Lymphocytes/Leukocytes in Blood — NFr
  // Monocytes
  '742-7': 'AMC',    // Monocytes [#/volume] in Blood by Automated count — NCnc
  '743-5': 'AMC',    // Monocytes [#/volume] in Blood by Manual count — NCnc
  '26484-6': 'AMC',  // Monocytes [#/volume] in Blood — NCnc
  '5905-5': 'MONO',  // Monocytes/Leukocytes in Blood by Automated count — NFr
  '744-3': 'MONO',   // Monocytes/Leukocytes in Blood by Manual count — NFr
  '26485-3': 'MONO', // Monocytes/Leukocytes in Blood — NFr
  // Eosinophils
  '711-2': 'AEC',    // Eosinophils [#/volume] in Blood by Automated count — NCnc
  '712-0': 'AEC',    // Eosinophils [#/volume] in Blood by Manual count — NCnc
  '26449-9': 'AEC',  // Eosinophils [#/volume] in Blood — NCnc
  '713-8': 'EOS',    // Eosinophils/Leukocytes in Blood by Automated count — NFr
  '714-6': 'EOS',    // Eosinophils/Leukocytes in Blood by Manual count — NFr
  '26450-7': 'EOS',  // Eosinophils/Leukocytes in Blood — NFr
  // Basophils
  '704-7': 'ABC',    // Basophils [#/volume] in Blood by Automated count — NCnc
  '705-4': 'ABC',    // Basophils [#/volume] in Blood by Manual count — NCnc
  '26444-0': 'ABC',  // Basophils [#/volume] in Blood — NCnc
  '706-2': 'BASO',   // Basophils/Leukocytes in Blood by Automated count — NFr
  '707-0': 'BASO',   // Basophils/Leukocytes in Blood by Manual count — NFr
  '30180-4': 'BASO', // Basophils/Leukocytes in Blood — NFr
  // Blasts and nucleated red cells
  '30376-8': 'BLAST-ABS', // Blasts [#/volume] in Blood — NCnc
  '709-6': 'BLAST',  // Blasts/Leukocytes in Blood by Manual count — NFr
  '771-6': 'NORMOBLAST-ABS', // Nucleated erythrocytes [#/volume] in Blood by Automated count — NCnc
  // Reticulocytes
  '14196-0': 'ARC',  // Reticulocytes [#/volume] in Blood — NCnc
  '60474-4': 'ARC',  // Reticulocytes [#/volume] in Blood by Automated count — NCnc
  '17849-1': 'RETIC', // Reticulocytes/Erythrocytes in Blood by Automated count — NFr
  '4679-7': 'RETIC', // Reticulocytes/Erythrocytes in Blood — NFr
}

/** Display labels for the absolute-count columns (the header and the picker). */
export const DIFFERENTIAL_COUNT_LABELS: Readonly<Record<string, { short: string; zh: string; en: string }>> = {
  ALC: { short: 'ALC', zh: '絕對淋巴球計數', en: 'Absolute lymphocyte count' },
  AMC: { short: 'AMC', zh: '絕對單核球計數', en: 'Absolute monocyte count' },
  AEC: { short: 'AEC', zh: '絕對嗜伊紅性白血球計數', en: 'Absolute eosinophil count' },
  ABC: { short: 'ABC', zh: '絕對嗜鹼性白血球計數', en: 'Absolute basophil count' },
  'BAND-ABS': { short: 'Band#', zh: '帶狀嗜中性白血球絕對計數', en: 'Absolute band count' },
  'BLAST-ABS': { short: 'Blast#', zh: '芽細胞絕對計數', en: 'Absolute blast count' },
  'PROMYELOCYTE-ABS': { short: 'Promyl.#', zh: '前骨髓球絕對計數', en: 'Absolute promyelocyte count' },
  'MYELOCYTE-ABS': { short: 'Myelo.#', zh: '骨髓球絕對計數', en: 'Absolute myelocyte count' },
  'META-MYELOCYTE-ABS': { short: 'Meta#', zh: '後骨髓球絕對計數', en: 'Absolute metamyelocyte count' },
  'NORMOBLAST-ABS': { short: 'Normobl.#', zh: '有核紅血球絕對計數', en: 'Absolute nucleated RBC count' },
  'PLASMA-CELL-ABS': { short: 'PlasmaCell#', zh: '漿細胞絕對計數', en: 'Absolute plasma cell count' },
  ARC: { short: 'ARC', zh: '絕對網狀紅血球計數', en: 'Absolute reticulocyte count' },
}

/** The count / percentage column a differential LOINC declares, if any. */
export function differentialLoincKey(loinc: string): string | undefined {
  return DIFFERENTIAL_LOINC_TO_KEY[loinc.trim()]
}

/** LOINC Scale of a declared differential LOINC: every one is quantitative
 *  (Qn). Count (NCnc) and fraction (NFr) codes never share a declared key —
 *  751-8 → ANC, 770-8 → NEU — so one scale cannot merge a count with a %. */
export function differentialLoincScale(loinc: string): 'Qn' | undefined {
  return DIFFERENTIAL_LOINC_TO_KEY[loinc.trim()] ? 'Qn' : undefined
}

function differentialKeyFromLoinc(obs: any): string | undefined {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  for (const coding of codings) {
    // A system-less coding is read as LOINC, as the shared package reads it.
    if (typeof coding?.code !== 'string') continue
    if (coding.system !== undefined && coding.system !== FHIR_SYSTEMS.LOINC) continue
    const key = DIFFERENTIAL_LOINC_TO_KEY[coding.code.trim()]
    if (key) return key
  }
  return undefined
}

/**
 * Count per volume: /µL, 10^3/µL, x10^9/L, /mm3, /cumm, cells/µL, K/µL, and
 * the UCUM forms (10*3/uL). Deliberately not G/L, which is also grams/litre.
 */
function isCountPerVolumeUnit(unit: string): boolean {
  const compact = unit
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[µμ]/g, 'u')
  const match = compact.match(/^(.*)\/(ul|mm3|mm\^3|cumm|cmm|nl|l)$/)
  if (!match) return false
  const prefix = match[1].replace(/^[x*×·]/, '').replace(/^(?:cells?|#)/, '').replace(/(?:cells?|#)$/, '')
  const power = /^10(?:\^|\*|e)?(\d{1,2})$/.exec(prefix)
  if (match[2] === 'l') return !!power && (power[1] === '9' || power[1] === '6')
  return prefix === '' || /^(?:k|thou|1000)$/.test(prefix) || (!!power && Number(power[1]) <= 6)
}

// The ways a percent unit is printed — the same spellings the AI lab value
// family accepts (fhir-tools labValueFamily): "%", full-width 「％」 (NFKC),
// "percent", "per cent", "pct", 「百分比」, in any case, as a whole word.
const PERCENT_UNIT_TEXT_RE = /^(?:%|percent|per\s*cent|pct|百分比)$/i

function unitFamily(unit: unknown): 'count' | 'fraction' | null {
  if (typeof unit !== 'string' || !unit.trim()) return null
  if (PERCENT_UNIT_TEXT_RE.test(unit.normalize('NFKC').trim())) return 'fraction'
  return isCountPerVolumeUnit(unit) ? 'count' : null
}

// "3100 /uL", "< 1 %", "60-65%", "62 percent": a number written as text with
// its unit after it.
const NUMBER_WITH_UNIT_TEXT_RE =
  /^\s*(?:[<>≤≥≦≧]=?\s*)?\d+(?:\.\d+)?(?:\s*[-–~]\s*\d+(?:\.\d+)?)?\s*(\S.*?)\s*$/

/** The unit family of a value sent as text ("3100 /uL", "62%"), or null. */
function stringUnitFamily(value: unknown): 'count' | 'fraction' | null {
  if (typeof value !== 'string') return null
  const unit = value.normalize('NFKC').match(NUMBER_WITH_UNIT_TEXT_RE)?.[1]
  return unit ? unitFamily(unit) : null
}

/** What a Quantity's units say. Its UCUM code decides when it has one
 *  (system UCUM or absent) — code '%' is a fraction whatever the unit text
 *  says, a count code ('10*3/uL') is a count — as in the AI value family.
 *  Without a code, or with a code that is neither, the unit text. */
function quantityUnitFamily(obs: any): 'count' | 'fraction' | null {
  const quantity = obs?.valueQuantity
  if (!quantity) return stringUnitFamily(obs?.valueString)
  const code = typeof quantity.code === 'string' ? quantity.code.trim() : ''
  const system = typeof quantity.system === 'string' ? quantity.system : ''
  if (code && (!system || /unitsofmeasure\.org/i.test(system))) {
    if (code === '%') return 'fraction'
    if (isCountPerVolumeUnit(code)) return 'count'
  }
  return unitFamily(quantity.unit)
}

/**
 * The column a differential result belongs in, given the key its name (or
 * another table) resolved to. LOINC property first; otherwise the unit
 * family; otherwise the key unchanged. Exported so callers that start from the
 * shared package key (calculator autofill) land on the same column.
 */
export function countFractionAwareKey(obs: any, key: string): string {
  const fromLoinc = differentialKeyFromLoinc(obs)
  if (fromLoinc) return fromLoinc
  const countKey = COUNT_KEY_FOR_FRACTION_KEY[key]
  const fractionKey = FRACTION_KEY_FOR_COUNT_KEY[key]
  if (!countKey && !fractionKey) return key
  const family = quantityUnitFamily(obs)
  if (family === 'count' && countKey) return countKey
  if (family === 'fraction' && fractionKey) return fractionKey
  return key
}

const APP_TEXT_TO_CANONICAL: Readonly<Record<string, string>> = {
  'PROTEIN,TOTAL': 'TP',
  '總蛋白': 'TP',
  '血清總蛋白': 'TP',
  '總蛋白質': 'TP',
  'PTH-I': 'IPTH',
  IPTH: 'IPTH',
  'I-PTH': 'IPTH',
  'INTACT PTH': 'IPTH',
  '副甲狀腺素': 'PTH',
  // Typographic spellings of one analyte that the package passes through as
  // separate raw keys (each already listed in lab-categories). Pure spelling
  // only — "VITAMIN D" is NOT folded into 25-OH-D: it may be 1,25-(OH)2 D.
  DHEAS: 'DHEA-S',
  IGF1: 'IGF-1',
  PIVKA: 'PIVKA-II',
  CA72_4: 'CA72-4',
  CYF21_1: 'CYFRA21-1',
  '25-OH VITAMIN D': '25-OH-D',
  '25(OH)D': '25-OH-D',
  // Hospital short names for serum creatinine and glucose that fell to 其他
  // (健康存摺 bundles, 2026-09-27). Glucose keys are subclassified by the
  // glucose panel itself (fasting / finger / generic).
  CRE: 'CREA',
  'AC-SUG': 'GLUCOSE',
  'PC-SUG': 'GLUCOSE',
  'GLUCOSE PC': 'GLUCOSE',
  'GLUCOSE P.C': 'GLUCOSE',
  'GLUCOSE RANDOM': 'GLUCOSE',
  'TOTAL CHOLESTEROL/HDL-C RATIO': 'TC/HDL RATIO',
}

/**
 * Urinalysis spellings of one test, folded into the urine panel's column.
 * Scoped to that panel on purpose: "Protein" is urine protein there, but a
 * pleural-fluid "Protein" filed under 其他 must not become 尿蛋白.
 * Only the same measurement merges — squamous, urothelial and renal tubular
 * epithelial cells are different findings and keep their own columns.
 * (Source rows without LOINC; 2026-09-27 real-bundle probe.)
 */
const URINE_SPELLINGS: Readonly<Record<string, string>> = {
  GRAVITY: 'GRAVIT',
  'S.G': 'GRAVIT',
  PROTEIN: 'PROT',
  KETONES: 'KETONE',
  KETON: 'KETONE',
  // Clarity reported as transparency — the same inspection as turbidity.
  TRANS: 'TURBIDITY',
  TRANSPARENT: 'TURBIDITY',
  TRASPARANT: 'TURBIDITY',
  CLARITY: 'TURBIDITY',
  PCRATIO: 'PROT/CR RATIO',
  UPCR: 'PROT/CR RATIO',
  'EPITH CELL': 'EPITH',
  'EPITHELIAL CELL': 'EPITH',
  CAST: 'CASTS',
  'KETONE BODY': 'KETONE',
  'LEUCOCYTE ESTER': 'LE',
  'LEUKOCYTE ESTERASE': 'LE',
  PRO: 'PROT',
  BIL: 'BILI',
  // Semi-quantitative strip results, same columns as their LOINC-coded twins.
  '肌酸酐(尿液)(半定量)': 'CREA',
  '微白蛋白(尿)(半定量)': 'MALB',
  '微白蛋白/肌酐酸比值(半定量)': 'ACR',
}

/** A key as it lands in one panel — urine spellings folded there only. */
export function labKeyInCategory(testKey: string, categoryId?: string): string {
  return categoryId === 'urine' ? URINE_SPELLINGS[testKey] ?? testKey : testKey
}

/** The pivot's own text → key resolution (package alias + app compatibility
 *  table), for callers that must agree with the pivot about which key a
 *  spelling lands on. */
export function resolveLabTextKey(name: string): string {
  const upper = name.normalize('NFKC').trim().toUpperCase()
  if (APP_TEXT_TO_CANONICAL[upper]) return APP_TEXT_TO_CANONICAL[upper]
  const fromText = canonicalTestKeyFromString(name)
  return APP_TEXT_TO_CANONICAL[fromText] ?? fromText
}

const APP_CANONICAL_DISPLAY: Readonly<Record<string, string>> = {
  TP: 'TP',
  PTH: 'PTH',
  IPTH: 'iPTH',
  // Keys the text resolver already produces but the package has no label for;
  // without these the column header was the raw upper-case key.
  'HS-TROPONIN I': 'hs-TnI',
  'HS-TROPONIN T': 'hs-TnT',
  'LP(A)': 'Lp(a)',
  'APO-B': 'ApoB',
  'APO-A1': 'ApoA1',
  'NON-HDL': 'Non-HDL-C',
  VLDL: 'VLDL-C',
  CASTS: 'Casts',
  'PROT/CR RATIO': 'UPCR',
  'TC/HDL RATIO': 'TC/HDL',
  ...Object.fromEntries(Object.entries(DIFFERENTIAL_COUNT_LABELS).map(([key, label]) => [key, label.short])),
}

/** Canonical labels supplied by the app while the shared normalization
 * package catches up with bridge-emitted LOINC codes. Display consumers must
 * consult this before falling back to the source hospital label. */
export function getLabCompatibilityCanonicalDisplay(testKey: string): string | undefined {
  return APP_CANONICAL_DISPLAY[testKey]
}

// Returns the canonical analyte name (alias-resolved display key).
// Used for subgroup lookup, HARDCODED_REF_RANGES, and pinned-column matching.
// A differential count and its percentage share one source name, so the key
// the name resolves to is then split by LOINC property / unit family.
function canonicalTestKey(obs: any): string {
  return countFractionAwareKey(obs, sourceAnalyteKey(obs))
}

function sourceAnalyteKey(obs: any): string {
  // 1. LOINC is the authoritative analyte identifier. Trust whatever the
  //    bridge attaches — if it's wrong, the fix belongs at the bridge layer,
  //    not in app-side display-string heuristics.
  const fromLoinc = canonicalKeyFromLoinc(obs)
  if (fromLoinc) return fromLoinc

  // The package's LOINC table currently lags the bridge for TP/PTH. Resolve
  // these codes before consulting display text so a contradictory source label
  // can never overrule a recognized LOINC.
  const compatibilityLoinc = obs?.code?.coding?.find(
    (coding: { system?: string; code?: string }) =>
      coding.system === FHIR_SYSTEMS.LOINC
      && !!coding.code
      && !!APP_LOINC_TO_CANONICAL[coding.code],
  )?.code
  if (compatibilityLoinc) return APP_LOINC_TO_CANONICAL[compatibilityLoinc]

  // Compatibility with clinical-lab-normalization 1.1.1: it only maps the
  // mass-concentration magnesium code (19123-9). NHI also emits 2601-3,
  // Magnesium [Moles/volume] in Serum or Plasma (https://loinc.org/2601-3/).
  // Resolve the same panel key without changing the source value or unit.
  if (obs?.code?.coding?.some((coding: { system?: string; code?: string }) =>
    coding.system === FHIR_SYSTEMS.LOINC && coding.code === '2601-3',
  )) return 'MG'

  // 2. Fall back to display-name alias when no recognized LOINC is present
  //    (some institutions / orphan obs ship without coding entries).
  //    Delegate to canonicalTestKeyFromString — the single source of truth for
  //    text→key alias resolution. (This block used to inline a verbatim copy
  //    of that function's body; the duplication has been removed so the two
  //    pathways can never drift.)
  const raw = getTestDisplayName(obs)
  if (!raw) return 'UNKNOWN'
  // MediCloud adult screening supplies source text without a LOINC. Keep
  // these names in the existing pinned hepatitis columns, not extra columns.
  const screeningName = raw.normalize('NFKC').replace(/\s+/g, '')
  if (/^B型肝炎表面抗原(?:\(HBsAg\))?$/i.test(screeningName)) return 'HBSAG'
  if (/^C型肝炎抗體(?:\(Anti-HCV\))?$/i.test(screeningName)) return 'ANTI-HCV'
  // These category allowlist names are not yet aliases in the package.
  if (['鎂', 'MAGNESIUM'].includes(raw.trim().toUpperCase())) return 'MG'
  const resolved = resolveLabTextKey(raw)
  if (isKnownPivotKey(resolved)) return resolved
  // Bilingual source names — "嗜鹼性白血球 / Basophil", "肌酐、尿 ;(Creatinine
  // (U) CRTN)" — fail as a whole even when one half is a known analyte. Try
  // each half, the one written in Latin letters first. Only reached when the
  // full name resolved to nothing known, so it never overrides a match.
  for (const part of bilingualNameParts(raw)) {
    const key = resolveLabTextKey(part)
    if (isKnownPivotKey(key)) return key
  }
  return resolved
}

/** True when `key` is an analyte the pivot recognises (package or app label). */
export function isKnownPivotKey(key: string): boolean {
  return CANONICAL_KEYS.has(key) || !!APP_CANONICAL_DISPLAY[key]
}

/** "中文 / English" and "中文 ;(English)" halves, Latin-script half first.
 *  A slash counts only with spaces around it: "LDL/HDL", "ALB/CR RATIO" and
 *  "微白蛋白/肌酐酸比值" are single names. */
export function bilingualNameParts(raw: string): string[] {
  const text = raw.normalize('NFKC').trim()
  let parts: string[] = []
  const semi = text.match(/^(.*?)\s*;\s*\((.*)\)\s*$/)
  if (semi) parts = [semi[1], semi[2]]
  else if (/\s\/\s/.test(text)) parts = text.split(/\s+\/\s+/)
  parts = parts.map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return []
  return parts.sort((a, b) => Number(/[A-Za-z]/.test(b)) - Number(/[A-Za-z]/.test(a)))
}

// Returns { mapKey, testKey, displayName } for one observation.
//
// mapKey      – pivot row key; equals testKey for most tests so same-analyte
//               records from different institutions collapse into one column.
//               Uses "NHI_CODE:testKey" only for tests in KEEP_SEPARATE_BY_NHI
//               where the code distinguishes genuinely different analytes.
// testKey     – canonical analyte name; stable across data sources.
// displayName – label shown in the table; prefers NHI official display name.
// Known glucose-category testKeys that should NOT fall back to GLUCOSE generic.
// Everything else in the glucose category (typos, unfamiliar names) is treated
// as glucose and goes through subclassification, since the LOINC-based
// categorization already told us it's a glucose measurement.
const KNOWN_GLUCOSE_KEYS = new Set(['GLUCOSE', 'HBA1C', 'C-PEPTIDE', 'GLU,1HRPC', 'GLU,2HRPC', 'GLU,3HRPC'])

// The package's fasting pattern misses the hospital short forms "AC-Sug",
// "AC Sugar" and "Glucose AC" (健康存摺 bundles, 2026-09-27), which then sit
// in the generic 血糖 column beside the post-prandial values.
const FASTING_SHORT_NAME = /\bac[-\s]*sug(?:ar)?\b|\bglucose[-\s(]*ac\b/i

function glucoseSubtype(obs: any): ReturnType<typeof classifyGlucose> {
  const sub = classifyGlucose(obs)
  if (sub !== 'generic') return sub
  const codings = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const text = [obs?.code?.text, ...codings.map((c: any) => c?.display)].filter(Boolean).join(' ')
  return FASTING_SHORT_NAME.test(text) ? 'fasting' : sub
}

export function getLabPivotTestIdentity(
  obs: any,
  categoryId?: string,
  nameMode: AnalyteNameMode = 'standardized',
): { mapKey: string; testKey: string; displayName: string } {
  const raw = nameMode === 'original'
    ? getOriginalAnalyteDisplayForObs(obs)
    : getTestDisplayName(obs)
  if (!raw) return { mapKey: 'UNKNOWN', testKey: 'UNKNOWN', displayName: 'UNKNOWN' }

  let testKey = labKeyInCategory(canonicalTestKey(obs), categoryId)
  let displayOverride: string | undefined

  const microbiologyComponent = categoryId === 'microbio'
    ? microbiologyLocalIdentity(obs)
    : null
  if (microbiologyComponent) {
    testKey = microbiologyComponent.testKey
    displayOverride = microbiologyComponent.displayName
  }

  if (categoryId === 'microbio' && !microbiologyComponent && hasNhiMycobacterialCultureEvidence(obs)) {
    testKey = MYCOBACTERIAL_CULTURE_KEY
    displayOverride = CANONICAL_DISPLAY[MYCOBACTERIAL_CULTURE_KEY]
  }

  if (categoryId === 'glucose') {
    // (Previously: unit-based HbA1c reclassification removed 2026-05-29.)
    // Bridge sometimes mis-categorises HbA1c rows into the glucose family.
    // We used to silently reroute by sniffing the unit (% / mmol/mol);
    // that hid the bridge categorisation bug. Now we let the row stay
    // where bridge put it — clinicians will see "5.7%" next to glucose
    // values and recognise the mis-categorisation. See memory/
    // feedback_no_masking_bridge_bugs.md.
    if (!KNOWN_GLUCOSE_KEYS.has(testKey)) {
      // Unknown glucose-category name (typos, unfamiliar variants) → fallback
      // to GLUCOSE; subclassification below will route to finger / fasting /
      // generic based on display + LOINC. This is UI taxonomy, not bridge
      // data alteration, so it stays.
      testKey = 'GLUCOSE'
    }
  }

  // Glucose subclassification: split into fasting / finger-stick / generic
  // columns using display + LOINC (see classifyGlucose).
  if (testKey === 'GLUCOSE') {
    const sub = glucoseSubtype(obs)
    const label = GLUCOSE_SUBTYPE_LABEL[sub]
    testKey = label.key
    displayOverride = label.display
  }

  const nhiCoding = obs.code?.coding?.find((c: any) => c.system === NHI_LAB_SYSTEM)
  const nhiCode = nhiCoding?.code as string | undefined
  const canonicalMapKey = (nhiCode && KEEP_SEPARATE_BY_NHI.has(testKey)) ? `${nhiCode}:${testKey}` : testKey

  // The audit view must not collapse different source labels merely because
  // they share one (possibly wrong) LOINC. NFKC/case/whitespace folding avoids
  // duplicate columns for typographic-only variants while preserving genuine
  // differences such as "Atypical lym." versus "Lymphocytes %".
  //
  // The audit view may split further by source label, but never merge what
  // the standardized view keeps apart: the standardized key (specimen,
  // free / total, lane, count vs %, glucose subtype …) is part of it. The
  // header stays the source label.
  const originalMapKey = `source:${raw.normalize('NFKC').trim().toLocaleLowerCase()}|${canonicalMapKey}`
  const mapKey = nameMode === 'original' ? originalMapKey : canonicalMapKey

  // Column header preference:
  //   1. displayOverride (e.g. glucose subtypes) wins.
  //   2. If testKey is itself a canonical short code (any value the alias
  //      maps or LOINC map can emit), use it directly — possibly via the
  //      CANONICAL_DISPLAY override (e.g. APTT-RATIO → "APTT-ratio"). This
  //      is preferred over the bridge's NHI display because NHI often
  //      sends the PANEL name (e.g. "白血球分類計數" for a "嗜中性白血球"
  //      obs), which would produce confusing column headers in the
  //      cumulative report.
  //   3. Otherwise fall back to the bridge's NHI display or stripped raw
  //      label so unknown tests keep whatever the source institution sent.
  const nhiDisplay = nhiCoding?.display as string | undefined
  const rawDisplay = raw.replace(/\s*[\(\[].*$/, '').replace(/^Serum\s+/i, '').trim() || raw
  const candidateDisplay = nhiDisplay || rawDisplay
  const isCanonical = CANONICAL_KEYS.has(testKey) || !!APP_CANONICAL_DISPLAY[testKey]
  const canonicalDisplay = APP_CANONICAL_DISPLAY[testKey] || CANONICAL_DISPLAY[testKey] || testKey
  const displayName = nameMode === 'original'
    ? raw
    : displayOverride || (isCanonical ? canonicalDisplay : candidateDisplay)

  return { mapKey, testKey, displayName }
}

export function buildLabPivots(
  observations: any[],
  options: { nameMode?: AnalyteNameMode; preferInstitutionEgfr?: boolean } = {},
): Record<string, LabPivot> {
  const nameMode = options.nameMode ?? 'standardized'
  const result: Record<string, LabPivot> = {}

  // Initialize each category container
  for (const cat of LAB_CATEGORIES) {
    result[cat.id] = { category: cat, dates: [], rows: [] }
  }

  // Group observations by category
  const buckets: Record<string, any[]> = {}
  for (const cat of LAB_CATEGORIES) buckets[cat.id] = []

  for (const obs of observations) {
    const cat = categorizeObservation(obs)
    if (!cat) continue
    buckets[cat.id].push(obs)
  }

  // For each category, build the pivot. Don't early-return on empty obsList —
  // categories with pinnedColumns should still surface their standard headers
  // even when the patient has no data for any test in that category.
  for (const cat of LAB_CATEGORIES) {
    const obsList = buckets[cat.id]
    const institutionEgfrKeys = new Set<string>()
    const calculatedEgfrKeys = new Set<string>()
    const egfrKey = (obs: any): string | undefined => {
      const date = dateKey(obs.effectiveDateTime)
      const identity = getLabPivotTestIdentity(obs, cat.id, nameMode)
      return date && /^EGFR(?:\(|$)/.test(identity.testKey)
        ? `${date}|${identity.mapKey}` : undefined
    }
    const isNhiCalculated = (obs: any) => /健保署\s*計算/.test(obs.method?.text ?? '')
    if (options.preferInstitutionEgfr) {
      for (const obs of obsList) {
        const key = egfrKey(obs)
        const value = formatValue(obs).numericValue
        if (key && isNhiCalculated(obs) && value !== undefined && Number.isFinite(value)) calculatedEgfrKeys.add(key)
        if (key && !isNhiCalculated(obs) && value !== undefined && Number.isFinite(value)
          && !INVALID_TREND_STATUSES.has(obs.status?.trim().toLowerCase())) institutionEgfrKeys.add(key)
      }
    }

    const dateSet = new Set<string>()
    const testMap = new Map<string, LabRow>()
    const trendAvailability = new Map<string, TrendAvailabilityStats>()

    for (const obs of obsList) {
      // Cumulative display preference only. Preserve every original resource;
      // never equate assays or remove records by numeric equality.
      if (options.preferInstitutionEgfr && isNhiCalculated(obs)) {
        const key = egfrKey(obs)
        if (key && institutionEgfrKeys.has(key)) continue
      }
      if (options.preferInstitutionEgfr && !isNhiCalculated(obs)) {
        const key = egfrKey(obs)
        const value = formatValue(obs).numericValue
        if (key && calculatedEgfrKeys.has(key) && (value === undefined || !Number.isFinite(value))) continue
      }
      const date = dateKey(obs.effectiveDateTime)
      if (!date) continue
      dateSet.add(date)

      const { mapKey, testKey, displayName } = getLabPivotTestIdentity(obs, cat.id, nameMode)
      const fv = formatValue(obs)
      const { value, unit, numericValue, interpretationCode, status, unitInferred } = fv
      const { isAbnormal } = fv

      if (!testMap.has(mapKey)) {
        testMap.set(mapKey, { mapKey, testKey, displayName, displaySource: { code: obs.code }, values: new Map() })
      } else {
        // Prefer the shorter display name (cleaner labels)
        const row = testMap.get(mapKey)!
        if (displayName.length < row.displayName.length) {
          row.displayName = displayName
          row.displaySource = { code: obs.code }
        }
      }
      const row = testMap.get(mapKey)!

      // Cumulative-report-only unit normalisation: some analytes come through with
      // the same unit at different scales across hospitals (WBC "5 K/µL" vs raw
      // "5600 /µL"; CRP "0.5 mg/dL" vs "5 mg/L"), making a single column
      // unreadable. Rescale to one canonical unit here. `isAbnormal` was already
      // computed from the raw value vs the obs's own referenceRange above, so it
      // stays correct. The raw row-by-row report uses a different path, untouched.
      let cellValue = value
      let cellUnit = unit
      let trendUnit = unit
      if (numericValue !== undefined) {
        // Quantity.unit is human-readable and may use a local spelling such as
        // "/cumm", while Quantity.code is the machine-processable UCUM form
        // (for example "/uL"). Keep `unit` for raw display, but when the source
        // explicitly declares UCUM, prefer its code for numeric conversion.
        const conversionUnit = obs.valueQuantity?.system === FHIR_SYSTEMS.UCUM
          ? obs.valueQuantity.code || unit
          : unit
        const loincCode = obs.code?.coding?.find(
          (coding: any) => coding?.system === FHIR_SYSTEMS.LOINC,
        )?.code
        const norm = normalizeAnalyteUnit(testKey, numericValue, conversionUnit, { loincCode })
        if (norm) {
          cellValue = String(norm.value)
          cellUnit = norm.unit
        }
        trendUnit = norm?.unit ?? conversionUnit
      }

      // Trend buttons need only a yes/no availability signal while the table
      // is switching categories. Collect it in this existing O(n) pivot pass
      // instead of rescanning every Observation once per analyte.
      const normalizedStatus = typeof obs.status === 'string'
        ? obs.status.trim().toLowerCase()
        : ''
      const trendTimestamp = new Date(obs.effectiveDateTime).getTime()
      const hasTrendPoint = numericValue !== undefined
        && Number.isFinite(numericValue)
        && Number.isFinite(trendTimestamp)
        && !INVALID_TREND_STATUSES.has(normalizedStatus)
        && !obs.valueQuantity?.comparator
      if (hasTrendPoint) {
        const stats = trendAvailability.get(mapKey) ?? {
          pointCount: 0,
          units: new Set<string>(),
          specimens: new Set<string>(),
        }
        stats.pointCount += 1
        stats.units.add(compactTrendUnit(trendUnit))
        stats.specimens.add(
          obs.specimen?.display?.normalize('NFKC').trim().toLowerCase()
            || obs.specimen?.reference?.normalize('NFKC').trim().toLowerCase()
            || '__missing__',
        )
        trendAvailability.set(mapKey, stats)
      }

      const cell: LabCell = {
        value: cellValue,
        unit: cellUnit,
        isAbnormal,
        comparator: typeof obs.valueQuantity?.comparator === 'string' && obs.valueQuantity.comparator.trim()
          ? obs.valueQuantity.comparator.trim()
          : undefined,
        interpretationCode,
        effectiveDateTime: obs.effectiveDateTime,
        status,
        unitInferred,
        sourceProvenance: isNhiMedicloudObservation(obs) ? 'nhi-medicloud' : undefined,
        sourceInstitution: getNhiMedicloudOriginalInstitution(obs),
      }
      cell.sourceRecords = [{
        value: cell.value,
        provenance: cell.sourceProvenance,
        institution: cell.sourceInstitution,
        unit: cell.unit,
        comparator: cell.comparator,
        isAbnormal: cell.isAbnormal,
        interpretationCode: cell.interpretationCode,
        status: cell.status,
      }]
      // Same analyte, same day: default is last-write-wins (a revised result
      // supersedes the earlier one). EXCEPTION — a qualitative + quantitative
      // PAIR: e.g. Anti-HBc ships both a Presence result "Reactive"
      // (LOINC 13952-7) and a Units/volume COI number (22316-4), both resolving
      // to the same canonical ANTI-HBC column. Neither should clobber the other;
      // merge into one cell "Reactive (0.012)". Guarded narrowly to exactly
      // one-numeric-one-qualitative, so serial numerics (two glucose draws in a
      // day) still last-write-win rather than concatenating into garbage.
      //
      // A merged value is display text, so each record's comparator goes in
      // with it ("<0.5 / 0.7", "Reactive (<0.5)") and the cell-level
      // comparator is cleared — it could only ever describe one of them.
      const prev = row.values.get(date)
      const incomingNumeric = numericValue !== undefined
      if (prev?.allValues) {
        const allValues = [...prev.allValues, cellDisplayValue(cell)]
        row.values.set(date, {
          ...prev,
          value: allValues.join(' / '),
          allValues,
          comparator: undefined,
          isAbnormal: !!prev.isAbnormal || !!cell.isAbnormal,
          interpretationCode: prev.interpretationCode || cell.interpretationCode,
          status: prev.status === cell.status ? prev.status : [prev.status, cell.status].filter(Boolean).join('|') || undefined,
          unitInferred: !!prev.unitInferred || !!cell.unitInferred,
          sourceProvenance: prev.sourceProvenance === cell.sourceProvenance ? cell.sourceProvenance : undefined,
          sourceInstitution: prev.sourceInstitution === cell.sourceInstitution ? cell.sourceInstitution : undefined,
          sourceRecords: [...(prev.sourceRecords ?? []), ...(cell.sourceRecords ?? [])],
        })
      } else if (prev && incomingNumeric !== isNumericCellValue(prev.value)) {
        const qual = incomingNumeric ? prev : cell
        const quant = incomingNumeric ? cell : prev
        row.values.set(date, {
          value: `${cellDisplayValue(qual)} (${cellDisplayValue(quant)})`,
          isAbnormal: !!qual.isAbnormal || !!quant.isAbnormal,
          interpretationCode: qual.interpretationCode || quant.interpretationCode,
          effectiveDateTime: cell.effectiveDateTime || prev.effectiveDateTime,
          status: qual.status === quant.status ? qual.status : [qual.status, quant.status].filter(Boolean).join('|') || undefined,
          unitInferred: !!qual.unitInferred || !!quant.unitInferred,
          sourceProvenance: qual.sourceProvenance === quant.sourceProvenance ? qual.sourceProvenance : undefined,
          sourceInstitution: qual.sourceInstitution === quant.sourceInstitution ? qual.sourceInstitution : undefined,
          sourceRecords: [...(qual.sourceRecords ?? []), ...(quant.sourceRecords ?? [])],
        })
      } else if (prev) {
        // Never overwrite a same-analyte/same-day source record. A pivot cell is
        // one visual slot, so retain every value explicitly inside that slot.
        const allValues = [cellDisplayValue(prev), cellDisplayValue(cell)]
        row.values.set(date, {
          ...cell,
          value: allValues.join(' / '),
          allValues,
          comparator: undefined,
          isAbnormal: !!prev.isAbnormal || !!cell.isAbnormal,
          interpretationCode: prev.interpretationCode || cell.interpretationCode,
          status: prev.status === cell.status ? prev.status : [prev.status, cell.status].filter(Boolean).join('|') || undefined,
          unitInferred: !!prev.unitInferred || !!cell.unitInferred,
          sourceProvenance: prev.sourceProvenance === cell.sourceProvenance ? cell.sourceProvenance : undefined,
          sourceInstitution: prev.sourceInstitution === cell.sourceInstitution ? cell.sourceInstitution : undefined,
          sourceRecords: [...(prev.sourceRecords ?? []), ...(cell.sourceRecords ?? [])],
        })
      } else {
        row.values.set(date, cell)
      }
      // Keep source provenance through same-day value merging. The date badge
      // means this panel includes preventive-care results, not that all do.
      if (prev?.adultPreventive || isAdultPreventiveHealthExamResource(obs)) {
        row.values.get(date)!.adultPreventive = true
      }
    }

    // Show a shared column-header unit only when every numeric/unit-bearing cell
    // now uses the same unit. A qualitative result without a unit must not force
    // an otherwise uniform numeric column to repeat the unit below every value.
    // Numeric cells that still lack a unit remain blockers, as do genuinely
    // mixed units; those rows continue to show source units per cell.
    for (const row of testMap.values()) {
      const unitBearingCells = [...row.values.values()].filter(
        (cell) => !!cell.unit || cellContainsNumericValue(cell),
      )
      const cellUnits = unitBearingCells.map((cell) => cell.unit)
      const distinctUnits = new Set(cellUnits.filter((unit): unit is string => !!unit))
      const everyCellHasUnit = cellUnits.length > 0 && cellUnits.every((unit) => !!unit)
      row.unit = everyCellHasUnit && distinctUnits.size === 1
        ? distinctUnits.values().next().value
        : undefined
      const trendStats = trendAvailability.get(row.mapKey)
      row.trendChartable = !!trendStats
        && trendStats.pointCount >= 2
        && trendStats.units.size <= 1
        && (cat.id !== 'bloodgas' || trendStats.specimens.size <= 1)
    }

    // Inject stub rows for pinned columns not present in patient data.
    // Must check by testKey (not mapKey) since mapKey may include NHI prefix.
    if (nameMode === 'standardized' && cat.pinnedColumns) {
      const existingTestKeys = new Set([...testMap.values()].map(r => r.testKey))
      for (const pinKey of cat.pinnedColumns) {
        if (!existingTestKeys.has(pinKey)) {
          testMap.set(pinKey, { mapKey: pinKey, testKey: pinKey, displayName: pinKey, values: new Map() })
        }
      }
    }

    // Assign subgroupId to each row (matches against category.subgroups[].members)
    if (cat.subgroups) {
      const memberToGroup = new Map<string, string>()
      for (const sg of cat.subgroups) {
        for (const m of sg.members) {
          memberToGroup.set(m.toUpperCase(), sg.id)
        }
      }
      for (const row of testMap.values()) {
        row.subgroupId = memberToGroup.get(row.testKey)
      }
    }

    const dates = [...dateSet].sort((a, b) => b.localeCompare(a))  // newest first
    const cmp = compareTestsByPreferred(cat)

    // Sort by subgroup index first, then by preferredOrder within subgroup
    const sgOrder = new Map<string, number>()
    cat.subgroups?.forEach((sg, i) => sgOrder.set(sg.id, i))
    const rows = [...testMap.values()].sort((a, b) => {
      const ai = a.subgroupId ? sgOrder.get(a.subgroupId) ?? 999 : 999
      const bi = b.subgroupId ? sgOrder.get(b.subgroupId) ?? 999 : 999
      if (ai !== bi) return ai - bi
      return cmp(a.testKey, b.testKey)
    })

    result[cat.id] = { category: cat, dates, rows }
  }

  return result
}
