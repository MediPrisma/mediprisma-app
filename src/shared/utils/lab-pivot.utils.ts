// Lab pivot builder — pure data transform (no React). Moved from
// features/clinical-summary/reports/hooks/useLabPivot.ts so core (AI-context
// lab section) can reuse it without a core→features dependency; the hook file
// re-exports everything for existing feature/test imports.
// Groups observations by lab category, then pivots into test (row) × date (column).
// Groups observations by lab category, then pivots into test (row) × date (column).
import { categorizeObservation, getTestDisplayName, compareTestsByPreferred, LAB_CATEGORIES, withLocalCodeAsText, type LabCategory } from '@/src/shared/utils/lab-categories'
import { isNhiOrderCodeSystem, nhiOrderCode } from '@/src/shared/utils/nhi-order-code'
import { THYROID_DISPLAY, THYROID_LOINC_TO_KEY } from '@/src/shared/utils/thyroid-analytes'
import { dualSpecimenAnalyte } from '@/src/shared/utils/specimen-evidence'
import {
  PARAPROTEIN_COLUMN_ORDER,
  paraproteinDisplay,
  paraproteinIdentity,
  isParaproteinTextKey,
} from '@/src/shared/utils/paraprotein-analytes'
import {
  AUTOANTIBODY_KEYS,
  IMMUNOGLOBULIN_KEYS,
  IMMUNOLOGY_DISPLAY,
  IMMUNOLOGY_LOINC_TO_KEY,
  immunologyKeyFromName,
} from '@/src/shared/utils/immunology-analytes'
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
export function cellDisplayValue(cell: Pick<LabCell, 'value' | 'comparator'>): string {
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
  /** Original-name mode only: this column shares its source label with
   *  another column of the table, and this is what tells them apart. */
  originalHintKind?: OriginalHintKind
  /** Cheap availability index built during the pivot pass. Full trend point
   *  details are constructed only after the user opens this analyte. */
  trendChartable?: boolean
}

export type OriginalHintKind = 'specimen' | 'unit' | 'freeTotal' | 'standard'

export const specimenOfKey = (testKey: string): string | undefined =>
  testKey.startsWith('PP:U:') ? 'urine' : testKey.startsWith('PP:CSF:') ? 'csf' : testKey.startsWith('PP:') ? 'serum' : undefined
export const freeTotalOfKey = (testKey: string): string | undefined =>
  /-FREE$/.test(testKey) ? 'free' : /-TOTAL$/.test(testKey) ? 'total' : undefined

/** The hint that tells apart original-mode columns sharing one source label:
 *  the specimen, else count vs %, else free vs total, else the standardized
 *  column label. Columns with a unique label get none. */
function assignOriginalHints(rows: LabRow[]): void {
  const groups = new Map<string, LabRow[]>()
  for (const row of rows) {
    if (row.values.size === 0) continue
    const label = row.displayName.normalize('NFKC').trim().toLowerCase()
    groups.set(label, [...(groups.get(label) ?? []), row])
  }
  const distinct = (values: Array<string | undefined>) =>
    values.every((v) => v !== undefined) && new Set(values).size === values.length
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const kind: OriginalHintKind =
      distinct(group.map((r) => specimenOfKey(r.testKey))) ? 'specimen'
        : distinct(group.map((r) => (r.unit === '%' ? 'percent' : 'count'))) ? 'unit'
          : distinct(group.map((r) => freeTotalOfKey(r.testKey))) ? 'freeTotal'
            : 'standard'
    for (const row of group) row.originalHintKind = kind
  }
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

const LEGACY_NHI_LAB_OID_SYSTEM = 'urn:oid:nhi.lab.code'

// NHI 醫令 codes come from the shared helper (nhiOrderCode), which accepts
// 健保存摺's `…/nhi-medical-order-code`, MediCloud's `…/medical-service-payment-tw`
// and the legacy `urn:oid:nhi.lab.code` / `nhi-lab-code` systems alike.
function microbiologyLocalIdentity(obs: any): { testKey: string; displayName: string } | null {
  const nhiCode = nhiOrderCode(obs)
  if (!nhiCode) return null
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  const labels = [
    obs?.code?.text,
    ...codings
      .filter((coding) => !isNhiOrderCodeSystem(coding?.system))
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
  const nhiCode = nhiOrderCode(obs)
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
  '706-2': 'BASO',   // Basophils/Leukocytes in Blood by Automated count
  '713-8': 'EOS',    // Eosinophils/Leukocytes in Blood by Automated count
  '736-9': 'LYM',    // Lymphocytes/Leukocytes in Blood by Automated count
  '5905-5': 'MONO',  // Monocytes/Leukocytes in Blood by Automated count
  '770-8': 'NEU',    // Neutrophils/Leukocytes in Blood by Automated count
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
  '2890-2': 'PROT/CR RATIO', // Protein/Creatinine [Mass Ratio] in Urine
  // Its own column — not folded into RISKF, whose exact ratio definition at
  // the source hospital is unverified.
  '9830-1': 'TC/HDL RATIO', // Cholesterol.total/Cholesterol in HDL [Mass Ratio] in Serum or Plasma
}

const APP_TEXT_TO_CANONICAL: Readonly<Record<string, string>> = {
  'PROTEIN,TOTAL': 'TP',
  '總蛋白': 'TP',
  '血清總蛋白': 'TP',
  '總蛋白質': 'TP',
  // 09040C 全蛋白 — the NHI order's own name.
  '全蛋白': 'TP',
  // 09011C 鈣 — the NHI order's own name.
  '鈣': 'CA',
  '血清鈣': 'CA',
  // 09002C 血中尿素氮 / 09013C 尿酸 — the NHI order names and their common
  // spellings. 尿 here is part of the analyte name, not a urine specimen.
  // (尿素, urea, is a different quantity from urea nitrogen: no BUN alias.)
  '血中尿素氮': 'BUN',
  '血尿素氮': 'BUN',
  '血清尿素氮': 'BUN',
  '尿素氮': 'BUN',
  'BLOOD UREA NITROGEN': 'BUN',
  'UREA NITROGEN': 'BUN',
  '尿酸': 'UA',
  '血中尿酸': 'UA',
  '血清尿酸': 'UA',
  'URIC ACID': 'UA',
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

/**
 * The 免疫 column of one observation. Several analytes share one NHI order
 * (12064B = SS-A + SS-B + Ro52; 30022C = one row per allergen), so the order
 * code and its panel-name display are never consulted: the analyte LOINC
 * first, then the row's own item name. Null when neither is recognised — the
 * row then keeps its source name as its column (every allergen does).
 */
/** The 內分泌 column of a thyroid antibody / thyroglobulin row, by its LOINC
 *  (see thyroid-analytes.ts). Null when the row carries none of them. */
function thyroidAnalyteKey(obs: any): string | null {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  for (const coding of codings) {
    if (coding?.system === FHIR_SYSTEMS.LOINC && THYROID_LOINC_TO_KEY[coding?.code]) {
      return THYROID_LOINC_TO_KEY[coding.code]
    }
  }
  return null
}

const IMMUNOLOGY_COLUMN_KEYS = new Set([...IMMUNOGLOBULIN_KEYS, ...AUTOANTIBODY_KEYS])

function immunologyAnalyteKey(obs: any): string | null {
  const codings: any[] = Array.isArray(obs?.code?.coding) ? obs.code.coding : []
  for (const coding of codings) {
    if (coding?.system === FHIR_SYSTEMS.LOINC && IMMUNOLOGY_LOINC_TO_KEY[coding?.code]) {
      return IMMUNOLOGY_LOINC_TO_KEY[coding.code]
    }
  }
  const ownNames = [
    obs?.code?.text,
    ...codings
      .filter((coding) => !isNhiOrderCodeSystem(coding?.system))
      .flatMap((coding) => [coding?.display, coding?.code]),
  ]
  for (const name of ownNames) {
    const key = typeof name === 'string' ? immunologyKeyFromName(name) : null
    if (key) return key
  }
  return null
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
  // 免疫 columns (IgG / IgA / IgM / ANA already have package labels).
  ...IMMUNOLOGY_DISPLAY,
  // 內分泌 thyroid columns keyed by LOINC (thyroid-analytes.ts).
  ...THYROID_DISPLAY,
  // 免疫 電泳／輕鏈 fixed columns (English here; getLabRowDisplayParts gives
  // each language its own header via paraproteinDisplay).
  ...Object.fromEntries(PARAPROTEIN_COLUMN_ORDER.map((key) => [key, paraproteinDisplay(key, 'en')!])),
}

/** Canonical labels supplied by the app while the shared normalization
 * package catches up with bridge-emitted LOINC codes. Display consumers must
 * consult this before falling back to the source hospital label. */
export function getLabCompatibilityCanonicalDisplay(testKey: string): string | undefined {
  return APP_CANONICAL_DISPLAY[testKey]
}

// Returns the canonical analyte name (alias-resolved display key).
// Used for subgroup lookup, HARDCODED_REF_RANGES, and pinned-column matching.
function canonicalTestKey(obs: any): string {
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

function glucoseSubtype(source: any): ReturnType<typeof classifyGlucose> {
  // A bare local code ("GLU-AC") is the row's name, as code.text would be.
  const obs = withLocalCodeAsText(source)
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

  // 免疫 電泳／輕鏈: the paraprotein column comes first and alone — an IgG lane
  // under an IEP / IFE order never reaches the IgG column.
  const paraprotein = categoryId === 'immuno' ? paraproteinIdentity(obs) : null
  if (paraprotein) {
    testKey = paraprotein.key
    displayOverride = paraprotein.display ?? paraproteinDisplay(paraprotein.key, 'en')
  } else if (categoryId === 'immuno') {
    // Only a LOINC or the immunology name matcher may assign a 免疫 column.
    // The general name resolver reads "IgG抗體" (anti-IgG) as IgG; when the
    // matcher refused such a name, the row keeps its own source name.
    const immunologyKey = canonicalKeyFromLoinc(obs) ?? immunologyAnalyteKey(obs)
    testKey = immunologyKey
      ?? (IMMUNOLOGY_COLUMN_KEYS.has(testKey) ? raw.normalize('NFKC').trim().toUpperCase() : testKey)
  }

  // 生化 serum-or-urine analytes named generically ("Protein", "PROT") are
  // the chemistry analyte there — the column is TP / ALB / CA / CREA.
  if (categoryId === 'chem') {
    const dual = dualSpecimenAnalyte(obs)
    if (dual && !isKnownPivotKey(testKey)) testKey = dual
    if (dual && (testKey === 'PROTEIN' || testKey === 'PROT')) testKey = dual
  }

  if (categoryId === 'endocrine') {
    // The header comes from APP_CANONICAL_DISPLAY, the same map every
    // rendered label (getLabRowDisplayParts) reads.
    testKey = thyroidAnalyteKey(obs) ?? testKey
  }

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

  const nhiCode = nhiOrderCode(obs) ?? undefined
  // The NHI display is a header fallback only for the legacy OID system. The
  // current 健保存摺 and MediCloud systems both fall through to the row's own
  // label: their NHI display is usually the panel name (「細菌培養鑑定檢查」
  // for "Anaerobic #2"), which would make a misleading column header.
  const nhiCoding = obs.code?.coding?.find((c: any) => c?.system === LEGACY_NHI_LAB_OID_SYSTEM)
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
  // A 免疫 order display names the whole multi-analyte order (「可抽出的核抗體
  // 測定— Ro/La 抗體」 for SS-A, SS-B and Ro52), never the analyte in this column.
  const candidateDisplay = (categoryId !== 'immuno' && nhiDisplay) || rawDisplay
  const isCanonical = CANONICAL_KEYS.has(testKey) || !!APP_CANONICAL_DISPLAY[testKey]
  const canonicalDisplay = APP_CANONICAL_DISPLAY[testKey] || CANONICAL_DISPLAY[testKey] || testKey
  const displayName = nameMode === 'original'
    ? raw
    : displayOverride || (isCanonical ? canonicalDisplay : candidateDisplay)

  return { mapKey, testKey, displayName }
}

// ── Shared markdown-cell rendering ──────────────────────────────────────────
// Both AI lanes print the same pivot cell: the value, the SOURCE's abnormal
// flag when the source called it abnormal, and a status tag when the record is
// not a plain final result. Kept here, beside the builder that fills the cell,
// so the two lanes can never drift into different abnormal semantics.

const UNREMARKABLE_LAB_STATUSES = new Set(['final', 'amended', 'corrected', 'unknown'])

/** `{status:preliminary}` and friends; nothing for an ordinary final result. */
export function labStatusSuffix(status?: string): string {
  return status && !UNREMARKABLE_LAB_STATUSES.has(status)
    ? ` {status:${status}}`
    : ''
}

/** One measured value as text: the value, the SOURCE's abnormal marker when it
 *  called the value abnormal — its own interpretation code (H/L/A/…), falling
 *  back to `*` when it flagged through a structured reference range without
 *  naming a code — and a status tag for anything but a plain final result. */
export function formatLabValueText(
  cell: Pick<LabCell, 'value' | 'comparator' | 'isAbnormal' | 'interpretationCode' | 'status'>,
): string {
  const status = labStatusSuffix(cell.status)
  // The comparator travels with the value ("<0.5"), in both lanes.
  const value = cellDisplayValue(cell)
  if (!cell.isAbnormal) return `${value}${status}`
  return `${value} ${cell.interpretationCode || '*'}${status}`
}

/** One markdown table cell. `-` when the analyte was not measured that day. */
export function formatLabPivotCell(row: LabRow, date: string): string {
  const cell = row.values.get(date)
  return cell ? formatLabValueText(cell) : '-'
}

/** Column header text: the analyte and, when every cell agrees on one, its unit. */
export function labPivotColumnLabel(row: LabRow): string {
  return row.unit ? `${row.displayName} (${row.unit})` : row.displayName
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
      // An IEP / IFE report column folds the report and its lane rows into
      // one cell; each record keeps its own analyte ("IgG: Present").
      // The comparator goes inside the record ("M-band: <0.2 g/L"), so the
      // cell itself carries none.
      const sourceComparator = typeof obs.valueQuantity?.comparator === 'string' && obs.valueQuantity.comparator.trim()
        ? obs.valueQuantity.comparator.trim()
        : undefined
      let cellValue = isParaproteinTextKey(testKey) && value && value !== '—'
        ? `${getTestDisplayName(obs)}: ${recordDisplayValue({ value, comparator: sourceComparator })}${unit ? ` ${unit}` : ''}`
        : value
      let cellUnit = isParaproteinTextKey(testKey) ? undefined : unit
      let trendUnit = unit
      if (numericValue !== undefined && !isParaproteinTextKey(testKey)) {
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
      // A folded IEP / IFE report column gathers different analytes (IgG and
      // IgA lanes): never a trend, never graded.
      const foldedReport = isParaproteinTextKey(testKey)
      const hasTrendPoint = !foldedReport
        && numericValue !== undefined
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
        isAbnormal: foldedReport ? false : isAbnormal,
        comparator: isParaproteinTextKey(testKey) ? undefined : sourceComparator,
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
      const incomingNumeric = numericValue !== undefined && !isParaproteinTextKey(testKey)
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
      const prefixes = cat.subgroups.flatMap((sg) => (sg.keyPrefixes ?? []).map((prefix) => [prefix, sg.id] as const))
      for (const row of testMap.values()) {
        row.subgroupId = memberToGroup.get(row.testKey)
          ?? prefixes.find(([prefix]) => row.testKey.startsWith(prefix))?.[1]
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

    if (nameMode === 'original') assignOriginalHints(rows)
    result[cat.id] = { category: cat, dates, rows }
  }

  return result
}
