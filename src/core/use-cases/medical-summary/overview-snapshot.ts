// Deterministic evidence snapshot for the 初診快覽 overview (fast) lane.
//
// WHY a purpose-built snapshot rather than a filtered copy of the full
// clinical context: on the hospital's on-prem vLLM the clinician's wait before
// the first section is prefill. Measured throughput there is ~10.7 s for a
// ~5K-token request and ~23.8 s for ~13K, so a fast lane that must land inside
// 20 s has to stay at roughly 7K tokens INCLUDING its instructions and source
// list. Line-filtering the generic narrative cannot promise that: it keeps
// whatever the chart happens to contain, so a real multi-year NHI record blows
// the budget while a demo chart stays small. This builder instead composes a
// fixed set of sections with hard per-section caps, so the request size is a
// property of the CODE, not of the patient.
//
// Every reduction is explicit. A capped section always ends with a
// "+N more not listed" line: an omission must never be readable as an absence.
//
// Catalog keys are never renumbered. The returned catalog is a subset of the
// caller's, so a key cited from this lane resolves against the one catalog the
// UI shows, exactly as it does for the full lane.
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import type {
  DiagnosticReportEntity,
  EncounterEntity,
  MedicationEntity,
} from '@/src/core/entities/clinical-data.entity'
import {
  classifyEncounterClass,
  codeText,
  diagnosisCodeText,
  isoDay,
  type SummaryCatalogInput,
  type SummaryLocale,
} from './generate-medical-summary.use-case'
import {
  durationToDays,
  isLapsedDispensing,
  isMedicationCurrentlyInUse,
  procedureDate,
} from '@/src/core/utils/clinical-context-selection.utils'
import {
  documentKeySectionsOmissionMarker,
  extractDocumentKeySections,
  fitDocumentTextToTokenBudget,
  listClinicalDocuments,
} from '@/src/core/utils/clinical-documents.utils'
import {
  reportIdentities,
  reportModality,
  reportNarrative,
} from '@/src/core/utils/report-narrative.utils'
import { expandObservationValues } from '@/src/core/utils/observation-value.utils'
import { estimateTokens } from '@/src/shared/utils/token-estimator'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import {
  buildLabPivots,
  formatLabPivotCell,
  formatLabValueText,
  formatValue,
  getLabPivotTestIdentity,
  labPivotColumnLabel,
  type LabRow,
} from '@/src/shared/utils/lab-pivot.utils'

/** Default evidence budget. On-prem prefill is the whole constraint: the
 *  measured table (docs/FHIR-context-stability-optimization.txt) is ~10.7 s for
 *  a ~5K-token request and ~23.8 s for ~13K, so a request that must show its
 *  first card inside ~20 s cannot exceed roughly 10K tokens INCLUDING the
 *  overview instructions and the source list. 8K of evidence is the most that
 *  leaves room for those ~2K, and it is what buys the labs section its date ×
 *  test time series. It is not raised again without a new on-prem measurement. */
export const OVERVIEW_SNAPSHOT_TOKEN_BUDGET = 8_000

/** Per-section caps. Each one is a promise about the request size that holds
 *  for any chart, which is the whole point of this builder. */
const MAX_PROBLEMS = 20
const MAX_PROBLEMS_TRIMMED = 10
const MAX_MEDICATIONS = 25
/** Below this many current rows, recently lapsed medicines are listed too. */
const MIN_CURRENT_MEDICINES = 5
const MAX_MEDICATIONS_TRIMMED = 15
const MAX_ADMISSIONS = 8
const MAX_PROCEDURES = 12
const MAX_PROCEDURES_TRIMMED = 8
const MAX_DOCUMENTS = 2
/** Sampling dates per panel table. 8 is the full lane's default labDepth, so
 *  both lanes show a trend of the same depth. */
const MAX_LAB_DATES = 8
const MAX_LAB_DATES_TRIMMED = 4
const MAX_REPORTS = 8
const MAX_CARE_PLANS = 4
const MAX_ALLERGIES = 10

/** Discharge narratives are the single largest item here, so they are the
 *  first thing the ladder shortens. */
const DOCUMENT_TOKENS = 700
const DOCUMENT_TOKENS_TRIMMED = 350

/** 病史 is kept out of the body fit (which cuts the middle) and budgeted here,
 *  because for an oncology chart the whole treatment narrative — staging,
 *  regimen, cycle dates, prior operations — lives in that one section and
 *  nowhere else in the structured record. */
const DOCUMENT_HISTORY_CHARS = 1_500

/** Admissions/ER and their discharge documents are read from this window,
 *  measured against the newest record the DATA carries — never the wall clock,
 *  so an archived or demo chart is not silently emptied. */
const ADMISSION_WINDOW_DAYS = 730
const REPORT_CONCLUSION_CHARS = 240

export interface OverviewSnapshotPatient {
  gender?: string
  birthDate?: string
  age?: number
}

export interface OverviewSnapshotInput {
  /** The same scoped clinical data the hook already holds (`ctx.clinicalData`). */
  clinicalData: SummaryCatalogInput
  /** The same catalog the hook already holds (`ctx.catalog`). */
  catalog: SummarySourceCatalogEntry[]
  patient?: OverviewSnapshotPatient | null
}

export interface OverviewSnapshotOptions {
  nowMs: number
  locale: SummaryLocale
  tokenBudget?: number
}

/** One rendered section, with what it kept and what it could not fit. */
export interface OverviewSnapshotSection {
  id: OverviewSnapshotSectionId
  tokens: number
  kept: number
  dropped: number
}

export type OverviewSnapshotSectionId =
  | 'patient'
  | 'problems'
  | 'medications'
  | 'admissions'
  | 'procedures'
  | 'documents'
  | 'labs'
  | 'reports'
  | 'carePlans'
  | 'allergies'

export interface OverviewSnapshot {
  clinicalContext: string
  /** Only the entries this snapshot actually cites, keys unchanged. */
  catalog: SummarySourceCatalogEntry[]
  estimatedTokens: number
  sections: OverviewSnapshotSection[]
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()

const normalizeName = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/[\s.,;:()（）［］\[\]/-]+/g, '')

/** Shift an ISO day without going through the local clock. */
function dayOffset(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(shifted.getTime())) return day
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function tail(hidden: number): string[] {
  return hidden > 0 ? [`+${hidden} more not listed`] : []
}

function truncate(text: string, max: number): string {
  const cleaned = compact(text)
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

// ---------------------------------------------------------------------------
// Section item collectors (pure; run once, then rendered/trimmed repeatedly)
// ---------------------------------------------------------------------------

interface SnapshotItem {
  line: string
  /** Catalog keys this line cites. */
  keys: string[]
}

interface DocumentItem {
  id: string
  title: string
  date?: string
  text: string
  key?: string
}

function ageOf(patient: OverviewSnapshotPatient, referenceDay: string): number | undefined {
  if (patient.birthDate && patient.birthDate.length >= 4) {
    const born = new Date(`${patient.birthDate.slice(0, 10)}T00:00:00Z`)
    const at = new Date(`${referenceDay}T00:00:00Z`)
    if (!Number.isNaN(born.getTime()) && !Number.isNaN(at.getTime())) {
      let age = at.getUTCFullYear() - born.getUTCFullYear()
      const monthDelta = at.getUTCMonth() - born.getUTCMonth()
      if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < born.getUTCDate())) age -= 1
      if (age >= 0 && age < 130) return age
    }
  }
  return typeof patient.age === 'number' && patient.age >= 0 ? patient.age : undefined
}

function collectProblems(
  input: OverviewSnapshotInput,
  locale: SummaryLocale,
  keyByResourceId: Map<string, string>,
): SnapshotItem[] {
  const items: SnapshotItem[] = []
  const seen = new Set<string>()

  // Coded conditions first, then the visits' primary diagnoses. The catalog is
  // already newest-first per prefix, so the first record of a repeated name is
  // the latest one.
  for (const condition of input.clinicalData.conditions ?? []) {
    const key = condition.id ? keyByResourceId.get(condition.id) : undefined
    const label = diagnosisCodeText(condition.code, locale)
    if (!label) continue
    const identity = normalizeName(label)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    const date = isoDay(condition.recordedDate ?? condition.onsetDateTime)
    items.push({
      line: `- ${compact(label)}${date ? ` (${date})` : ''}${key ? ` [${key}]` : ''}`,
      keys: key ? [key] : [],
    })
  }

  // Visit diagnoses: the NHI cloud record carries each visit's primary
  // diagnosis, which the summary releases as the diagnosis (owner decision
  // 2026-10-03). Grouped and counted so the line says how often it was coded.
  interface ClaimGroup { label: string; code?: string; count: number; lastDate?: string; key?: string; fromAdmission: boolean; variants: number; seenLabels?: Set<string> }
  const claims = new Map<string, ClaimGroup>()
  for (const encounter of input.clinicalData.encounters ?? []) {
    const encounterKey = encounter.id ? keyByResourceId.get(encounter.id) : undefined
    const date = isoDay(encounter.period?.start)
    const encounterClass = classifyEncounterClass(encounter.class)
    const fromAdmission = encounterClass === 'inpatient' || encounterClass === 'emergency'
    // FHIR-generic: reasonCode is 0..*, so every entry counts.
    for (const reason of encounter.reasonCode ?? []) {
      const label = diagnosisCodeText(reason, locale)
      if (!label) continue
      // NHI claims spell one disease many ways (E11.9 / E11.22 / E11.65 for
      // the same diabetic), each on a different visit. Group by the ICD-10
      // three-character category so one row carries the whole disease and the
      // variants do not crowd out an unrelated problem; codes without an ICD
      // prefix fall back to the normalised label.
      // The ICD code is read from the coding itself: a zh-TW label is the
      // Chinese name alone (攝護腺惡性腫瘤), which would lose both the grouping
      // and the chapter weight below.
      const code = reason.coding?.map((coding) => coding.code?.trim().toUpperCase()).find((value) => value && /^[A-Z]\d{2}/.test(value))
      const category = code?.slice(0, 3) ?? label.match(/^([A-Z]\d{2})/)?.[1]
      const identity = category ?? normalizeName(label)
      if (!identity || seen.has(identity)) continue
      const group = claims.get(identity)
      if (!group) {
        claims.set(identity, { label: compact(label), code, count: 1, lastDate: date, key: encounterKey, fromAdmission, variants: 1, seenLabels: new Set([label]) })
        continue
      }
      group.count += 1
      if (!group.seenLabels?.has(label)) { group.variants += 1; (group.seenLabels ??= new Set()).add(label) }
      group.fromAdmission = group.fromAdmission || fromAdmission
      if (date && (!group.lastDate || date > group.lastDate)) {
        group.lastDate = date
        group.key = encounterKey
      }
    }
  }
  // Recency alone ranks 耳垢嵌塞 above 肺栓塞之個人史. The cap is small, so the
  // rows that change today's prescription must win the slots: history / long-
  // term-therapy Z codes, chronic-disease chapters and anything attached to an
  // admission outrank one-off acute or symptom codes, and recency only breaks
  // ties inside a band.
  const claimItems = [...claims.values()]
    .sort((a, b) =>
      claimWeight(b.code ?? b.label, b.fromAdmission) - claimWeight(a.code ?? a.label, a.fromAdmission) ||
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
      b.count - a.count)
    .map((group) => ({
      line: `- ${group.label} — primary diagnosis${group.variants > 1 ? ` (+${group.variants - 1} code variant${group.variants === 2 ? '' : 's'})` : ''}, ${group.count} visit${group.count === 1 ? '' : 's'}` +
        `${group.lastDate ? `, last ${group.lastDate}` : ''}${group.key ? ` [${group.key}]` : ''}`,
      keys: group.key ? [group.key] : [],
    }))
  return [...items, ...claimItems]
}

/** ICD-10 chapters that change what a clinician may prescribe today rank
 *  above one-off acute codes. Z79 (long-term drug therapy), Z86/Z87 (personal
 *  history), Z95 (devices) are the highest band because they are the only
 *  place an anticoagulant or a stent ever appears in claims data. */
function claimWeight(label: string, fromAdmission: boolean): number {
  const code = (label.match(/^([A-Z]\d{2})/)?.[1] ?? '').toUpperCase()
  const letter = code.charAt(0)
  const num = Number(code.slice(1))
  let weight = 0
  if (/^Z(79|86|87|95|99)/.test(code)) weight = 5
  else if (letter === 'C' || /^D[4-8]/.test(code)) weight = 4
  else if (letter === 'I' || letter === 'E' || letter === 'N' || /^J4[0-7]/.test(code) || /^K7/.test(code) || /^G[23]/.test(code) || /^F0/.test(code)) weight = 3
  else if (letter === 'J' || letter === 'K' || letter === 'M' || letter === 'D' || letter === 'G' || letter === 'F') weight = 2
  else if (letter === 'S' || letter === 'T' || letter === 'R' || /^Z0/.test(code) || /^H6/.test(code)) weight = 0
  else weight = 1
  if (fromAdmission) weight += 1
  return Number.isNaN(num) ? weight : weight
}

function medicationDisplay(medication: MedicationEntity, catalogDisplay?: string): string {
  return compact(
    catalogDisplay ||
    medication.medicationCodeableConcept?.text ||
    medication.medicationCodeableConcept?.coding?.find((coding) => coding.display)?.display ||
    medication.medicationReference?.display ||
    'Medication',
  )
}

function collectMedications(
  input: OverviewSnapshotInput,
  nowMs: number,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  interface MedGroup {
    display: string
    organization?: string
    days?: number
    date?: string
    key?: string
    lapsed?: boolean
  }
  const groups = new Map<string, MedGroup>()
  for (const medication of input.clinicalData.medications ?? []) {
    if (!isMedicationCurrentlyInUse(medication, nowMs)) continue
    const entry = medication.id ? entryByResourceId.get(medication.id) : undefined
    const display = medicationDisplay(medication, entry?.display)
    const identity = normalizeName(display)
    if (!identity) continue
    // Same two places `medicationExpectedEnd` reads a supply window from. The
    // loose view is deliberate: `boundsDuration` reaches the app only when the
    // FhirMapper whitelist carries it, and a missing field must read as "no
    // days supply", never as a type error.
    const supply = medication as unknown as {
      dispenseRequest?: { expectedSupplyDuration?: unknown }
      dosageInstruction?: Array<{ timing?: { repeat?: { boundsDuration?: unknown } } }>
    }
    const days = durationToDays(supply.dispenseRequest?.expectedSupplyDuration)
      ?? durationToDays(supply.dosageInstruction?.[0]?.timing?.repeat?.boundsDuration)
    const date = isoDay(medication.authoredOn)
    const existing = groups.get(identity)
    if (existing && (existing.date ?? '') >= (date ?? '')) continue
    groups.set(identity, {
      display,
      organization: entry?.organization?.trim() || medication.requester?.display?.trim() || undefined,
      days,
      date,
      key: entry?.key,
    })
  }
  // A chart whose supply windows have all lapsed (a chemotherapy patient
  // between cycles, or a quiet six months) would otherwise show NO medicines
  // at all, which reads as "takes nothing". Below a handful of current rows,
  // fill with the most recently dispensed medicines, marked as lapsed.
  const lapsed = new Map<string, MedGroup>()
  if (groups.size < MIN_CURRENT_MEDICINES) {
    for (const medication of input.clinicalData.medications ?? []) {
      // Dispensed and run out only — the same rule as the full lane's floor.
      if (!isLapsedDispensing(medication, nowMs)) continue
      const entry = medication.id ? entryByResourceId.get(medication.id) : undefined
      const display = medicationDisplay(medication, entry?.display)
      const identity = normalizeName(display)
      if (!identity || groups.has(identity)) continue
      const date = isoDay(medication.authoredOn)
      const existing = lapsed.get(identity)
      if (existing && (existing.date ?? '') >= (date ?? '')) continue
      lapsed.set(identity, {
        display,
        organization: entry?.organization?.trim() || medication.requester?.display?.trim() || undefined,
        date,
        key: entry?.key,
        lapsed: true,
      })
    }
  }
  const render = (group: MedGroup): SnapshotItem => ({
    line: `- ${group.display}` +
      `${group.organization ? ` — ${compact(group.organization)}` : ''}` +
      `${group.days ? `, ${group.days}d supply` : ''}` +
      `${group.date ? `, ${group.lapsed ? `last dispensed ${group.date} (supply ended)` : group.date}` : ''}` +
      `${group.key ? ` [${group.key}]` : ''}`,
    keys: group.key ? [group.key] : [],
  })
  const byDate = (a: MedGroup, b: MedGroup) => (b.date ?? '').localeCompare(a.date ?? '')
  return [
    ...[...groups.values()].sort(byDate).map(render),
    ...[...lapsed.values()].sort(byDate).slice(0, MIN_CURRENT_MEDICINES).map(render),
  ]
}

function selectAdmissions(
  input: OverviewSnapshotInput,
  windowStart: string,
): EncounterEntity[] {
  return (input.clinicalData.encounters ?? [])
    .filter((encounter) => {
      const encounterClass = classifyEncounterClass(encounter.class)
      if (encounterClass !== 'inpatient' && encounterClass !== 'emergency') return false
      const date = isoDay(encounter.period?.start)
      return !!date && date >= windowStart
    })
    .sort((a, b) => (isoDay(b.period?.start) ?? '').localeCompare(isoDay(a.period?.start) ?? ''))
}

function collectAdmissions(
  admissions: EncounterEntity[],
  locale: SummaryLocale,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  return admissions.map((encounter) => {
    const entry = encounter.id ? entryByResourceId.get(encounter.id) : undefined
    const start = isoDay(encounter.period?.start)
    const end = isoDay(encounter.period?.end)
    const encounterClass = classifyEncounterClass(encounter.class)
    const reasons = (encounter.reasonCode ?? [])
      .map((reason) => diagnosisCodeText(reason, locale))
      .filter((reason): reason is string => !!reason)
      .join('; ')
    const organization = entry?.organization?.trim() || encounter.serviceProvider?.display?.trim()
    return {
      line: `- ${start ?? '?'}${end && end !== start ? ` → ${end}` : ''} ${encounterClass ?? 'encounter'}` +
        `${organization ? ` @ ${compact(organization)}` : ''}` +
        `${reasons ? ` — ${truncate(reasons, 120)}` : ''}` +
        `${entry ? ` [${entry.key}]` : ''}`,
      keys: entry ? [entry.key] : [],
    }
  })
}

function collectAdmissionDocuments(
  input: OverviewSnapshotInput,
  admissions: EncounterEntity[],
  windowStart: string,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): DocumentItem[] {
  const admissionIds = new Set(
    admissions.slice(0, MAX_DOCUMENTS * 4).map((encounter) => encounter.id).filter(Boolean),
  )
  const referenced = (reference?: string): boolean => {
    const id = reference?.split('/').pop()
    return !!id && admissionIds.has(id)
  }
  const linkedIds = new Set<string>()
  for (const composition of input.clinicalData.compositions ?? []) {
    if (referenced(composition.encounter?.reference)) linkedIds.add(composition.id)
  }
  for (const document of input.clinicalData.documentReferences ?? []) {
    // FHIR-generic: context.encounter is 0..*.
    if ((document.context?.encounter ?? []).some((ref) => referenced(ref?.reference))) {
      linkedIds.add(document.id)
    }
  }

  const documents = listClinicalDocuments(input.clinicalData)
  const inWindow = documents.filter((document) => (document.date ?? '') >= windowStart)
  const linked = inWindow.filter((document) => linkedIds.has(document.id))
  // A discharge summary that carries no encounter link is still the note for
  // that stay; falling back to the discharge-summary flag keeps the section
  // populated on bridges that omit the reference.
  // Linked notes first, then any other discharge summary in the window, so a
  // second admission whose note carries no encounter reference still fills
  // the second slot instead of leaving it empty.
  const pool = [
    ...linked,
    ...inWindow.filter((document) => document.isDischargeSummary && !linkedIds.has(document.id)),
  ]

  return pool.slice(0, MAX_DOCUMENTS).map((document) => ({
    id: document.id,
    title: compact(document.title),
    date: document.date ? isoDay(document.date) : undefined,
    text: document.text,
    key: entryByResourceId.get(document.id)?.key,
  }))
}

// ---------------------------------------------------------------------------
// Procedures
//
// NHI claims record nursing and ancillary work as Procedures — dressing
// changes, IV drips, oximetry, catheterisation, radiotherapy planning steps.
// On a real oncology chart they outnumber the operations several times over,
// so listing procedures by date alone fills the cap with 換藥 rows and hides
// the mastectomy. Two deterministic rules make the section useful: an
// exclusion list that names the ancillary work, and a rank that puts
// definitive operations, implants and radiotherapy delivery first.
// ---------------------------------------------------------------------------

/** Lower-cased, width-normalised name; whitespace kept so the English
 *  phrases below can be written the way they read. */
const procedureMatchText = (name: string): string => compact(name).normalize('NFKC').toLowerCase()

/** Nursing / ancillary billing rows — never listed as a major procedure. */
const ANCILLARY_PROCEDURE = new RegExp([
  // wound and dressing care
  '換藥', '創傷處理', '傷口處置', 'dressing change', 'wound (care|dressing|treatment)',
  '拆線', 'remove stitch', 'suture removal',
  // lines, drips, catheters, irrigation
  '點滴注射', '輸液', 'iv drip', 'intravenous drip',
  '導尿', 'urinary cathet', 'foley',
  '灌洗', 'irrigation',
  '注射調理', '幫浦', 'infusion pump',
  // bedside monitoring and respiratory support
  '血氧', 'oximet',
  '監視器', 'monitor',
  '氧氣吸入', '呼吸治療', '陽壓呼吸', '抽吸', 'oxygen (therapy|inhalation)', 'suction',
  // anaesthesia and its work-up (English rows are matched by the anchored
  // pattern below, so a surgery that merely names its anaesthetic survives)
  '麻醉(前評估|諮詢)', '(靜脈|肌肉|全身|半身|局部|舒眠)麻醉',
  // radiotherapy PLANNING (the delivery itself is kept)
  '模具', 'cast design',
  '治療規劃', 'treatment plan',
  '模擬攝影', 'simulation',
  '準直儀', 'collimator',
  '劑量計算', 'dose calculation',
  // screening tests and plain films billed as procedures — they belong to
  // Reports. A bare 攝影 token cannot be used: interventional angiography is
  // billed as a procedure under the same character (血管攝影, 膽道攝影), and
  // those are exactly what a first visit must see.
  '抹片', 'smear',
  '乳房攝影', 'x光攝影', 'x-?ray', 'mammograph',
  '潛血', '篩檢', 'screening',
  // vaccination
  '疫苗', '接種', 'vaccin', 'immuni[sz]',
  // talking, teaching and fee-only rows
  '心理治療', '心理功能', '會談', '諮詢', 'psychotherap', 'counsel',
  '局部治療',
  '(處置|使用|規劃|管理|材料|治療)費',
  '衛教', '護理指導',
].join('|'))

/** An anaesthesia row is ancillary only when the row IS the anaesthesia. As a
 *  substring, `anesthe` also swallows "Excision of skin lesion under local
 *  anesthesia" — a real operation — so the English forms are matched against
 *  the WHOLE name instead. */
const STANDALONE_ANAESTHESIA =
  /^(iv or im|iv|im|general|local|spinal|epidural|regional|sedation|monitored)?\s*an(a)?esthe/

function isAncillaryProcedure(name: string): boolean {
  const text = procedureMatchText(name)
  return ANCILLARY_PROCEDURE.test(text) || STANDALONE_ANAESTHESIA.test(text)
}

/** Rank bands. Definitive operations, device implants and radiotherapy
 *  delivery are what a first visit must see; antineoplastic infusions come
 *  next (a repeated infusion row is a treatment course, not an operation);
 *  the remaining kept rows — drainage, biopsy, D&C, endoscopy — fill what is
 *  left of the cap. */
function procedureRank(name: string): number {
  const text = procedureMatchText(name)
  if (/切除|根除|摘除|重建|修補|接合|移植|截肢|手術|開刀|opera|surg|ectomy|resect|mastectom|excision|amputat/.test(text)) return 3
  if (/植入|置入|安裝|port-?a|implant|人工血管/.test(text)) return 3
  if (/加速器|照射治療|放射線治療|遠隔照射|近接治療|radiotherap|teletherap|irradiat|brachytherap/.test(text)) return 3
  if (/抗腫瘤|化學治療|化學藥物|化療|標靶|單株抗體|免疫治療|chemotherap|antineoplastic|monoclonal/.test(text)) return 2
  // Catheter-based angiography and ERCP are theatre procedures with their own
  // consent, sedation and complication profile — a first visit needs them
  // above the drainage/D&C rows that fill the rest of the cap.
  if (/血管攝影|心導管|膽道攝影|angiograph|ercp|cardiac cath/.test(text)) return 2
  return 1
}

function collectProcedures(
  input: OverviewSnapshotInput,
  locale: SummaryLocale,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  interface ProcedureGroup {
    display: string
    rank: number
    count: number
    latest?: string
    first?: string
    /** Catalog key of the LATEST record in the group. */
    key?: string
  }
  const groups = new Map<string, ProcedureGroup>()
  for (const procedure of input.clinicalData.procedures ?? []) {
    const status = String(procedure.status ?? '').trim().toLowerCase()
    // A procedure the source says did not happen (or retracted) is not history.
    if (status === 'not-done' || status === 'entered-in-error') continue
    const display = compact(codeText(procedure.code, locale) ?? 'Procedure')
    if (!display) continue
    if (isAncillaryProcedure(display)) continue
    const identity = normalizeName(display)
    if (!identity) continue
    const date = isoDay(procedureDate(procedure))
    const entry = procedure.id ? entryByResourceId.get(procedure.id) : undefined
    const group = groups.get(identity)
    if (!group) {
      groups.set(identity, {
        display,
        rank: procedureRank(display),
        count: 1,
        latest: date,
        first: date,
        key: entry?.key,
      })
      continue
    }
    group.count += 1
    if (date && (!group.latest || date > group.latest)) {
      group.latest = date
      group.key = entry?.key
    }
    if (date && (!group.first || date < group.first)) group.first = date
  }

  return [...groups.values()]
    .sort((a, b) => b.rank - a.rank || (b.latest ?? '').localeCompare(a.latest ?? '') || a.display.localeCompare(b.display))
    .map((group) => ({
      line: `- ${group.display} — ×${group.count}` +
        `${group.latest ? `, latest ${group.latest}` : ''}` +
        `${group.count > 1 && group.first && group.first !== group.latest ? ` (first ${group.first})` : ''}` +
        `${group.key ? ` [${group.key}]` : ''}`,
      keys: group.key ? [group.key] : [],
    }))
}

// ---------------------------------------------------------------------------
// Labs
//
// Rendered as the SAME date × test pivot the full lane sends, built by the one
// shared `buildLabPivots`. A first visit is read from trajectories — a
// creatinine of 1.4 means one thing after 0.8 and another after 2.2 — and the
// experiment behind the full lane's format
// (docs/LAB-FORMAT-EXPERIMENT-2026-07-12.md) measured the table as both more
// accurate and cheaper per value than one line per analyte. Abnormality is
// whatever the SOURCE said (its interpretation, else a structured reference
// range); this file owns no reference ranges of its own.
// ---------------------------------------------------------------------------

interface LabPanel {
  /** Lab category id — the table's `- [chem]` tag. */
  id: string
  /** Sampling dates the rows below cover, newest first. */
  dates: string[]
  rows: LabRow[]
  /** Catalog key of each analyte's NEWEST value, by pivot row key. */
  keyByMapKey: Map<string, string>
}

/** A value the pivot builder seats in no panel — no lab category at all (vital
 *  signs and free-standing measurements), or no sampling date to put it on a
 *  row. One line each: a one-column table per stray analyte would cost more
 *  than it says. NOT tagged `[other]`: that is a real lab category id the pivot
 *  builder itself emits, and two blocks under one tag would read as one. */
interface LabOther {
  label: string
  points: Array<{ date: string; text: string; key?: string }>
}

interface LabEvidence {
  panels: LabPanel[]
  others: LabOther[]
}

function collectLabs(
  input: OverviewSnapshotInput,
  keyByResourceId: Map<string, string>,
): LabEvidence {
  // Component-only panels are valid FHIR, so values are expanded before
  // pivoting, exactly as the full lane does. A component is not a resource and
  // has no key of its own, so it cites the PARENT observation.
  const pivotable: unknown[] = []
  const others = new Map<string, LabOther>()
  /** `categoryId|mapKey` → the newest value's date and catalog key. */
  const latestByAnalyte = new Map<string, { date: string; key?: string }>()

  for (const parent of input.clinicalData.observations ?? []) {
    const parentKey = parent.id ? keyByResourceId.get(parent.id) : undefined
    for (const value of expandObservationValues(parent)) {
      const category = categorizeObservation(value)
      const date = isoDay(value.effectiveDateTime)
      if (category && date) {
        pivotable.push(value)
        const { mapKey } = getLabPivotTestIdentity(value, category.id)
        const identity = `${category.id}|${mapKey}`
        const seen = latestByAnalyte.get(identity)
        if (!seen || date > seen.date) latestByAnalyte.set(identity, { date, key: parentKey })
        continue
      }
      const formatted = formatValue(value)
      if (formatted.value === '—') continue
      const { mapKey, displayName } = getLabPivotTestIdentity(value, category?.id)
      const other = others.get(mapKey) ?? {
        label: formatted.unit ? `${displayName} (${formatted.unit})` : displayName,
        points: [],
      }
      other.points.push({ date: date ?? '', text: formatLabValueText(formatted), key: parentKey })
      others.set(mapKey, other)
    }
  }

  const panels: LabPanel[] = []
  for (const pivot of Object.values(buildLabPivots(pivotable))) {
    // Pinned-column stubs carry no values; they exist for the on-screen table.
    const rows = pivot.rows.filter((row) => row.values.size > 0)
    if (rows.length === 0) continue
    const keyByMapKey = new Map<string, string>()
    for (const row of rows) {
      const latest = latestByAnalyte.get(`${pivot.category.id}|${row.mapKey}`)
      if (latest?.key) keyByMapKey.set(row.mapKey, latest.key)
    }
    panels.push({
      id: pivot.category.id,
      dates: pivot.dates.filter((date) => rows.some((row) => row.values.has(date))),
      rows,
      keyByMapKey,
    })
  }

  const sortedOthers = [...others.values()]
    .map((other) => ({
      ...other,
      points: [...other.points].sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) =>
      (b.points[0]?.date ?? '').localeCompare(a.points[0]?.date ?? '') ||
      a.label.localeCompare(b.label))

  return { panels, others: sortedOthers }
}

/** One coarse group ("imaging") would collapse CT, MRI, ultrasound and the
 *  daily portable chest film into a single latest report — and the portable
 *  film always wins on date. The prescribing-relevant picture is one latest
 *  report per TYPE, ordered so pathology and cross-sectional imaging outrank
 *  the routine films when the cap bites. */
/** NHI cloud records name every CT the same (33071B 電腦斷層造影) whatever the
 *  body part, so "latest per modality" would let a head CT hide a chest CT.
 *  Keep the latest few studies per modality instead, and collapse only what is
 *  demonstrably the same study: same modality, same day, and the same accession
 *  identifier when one is present (bridges emit a Chinese and an English row). */
const REPORTS_PER_MODALITY = 3

function collectReports(
  input: OverviewSnapshotInput,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  const byClass = new Map<string, { rank: number; reports: Map<string, { report: DiagnosticReportEntity; date: string; group: string }>; seen: Set<string> }>()
  for (const report of input.clinicalData.diagnosticReports ?? []) {
    const date = isoDay(report.effectiveDateTime ?? report.issued)
    if (!date) continue
    if (!reportNarrative(report).trim()) continue
    const { group, cls, rank } = reportModality(report)
    if (group === 'lab') continue
    const bucket = byClass.get(cls) ?? { rank, reports: new Map(), seen: new Set<string>() }
    const identities = reportIdentities(report, cls, date)
    // Same study twice (bilingual rows): keep the first, they carry one finding.
    if (!identities.some((identity) => bucket.seen.has(identity))) {
      identities.forEach((identity) => bucket.seen.add(identity))
      bucket.reports.set(identities[0], { report, date, group })
    }
    byClass.set(cls, bucket)
  }
  return [...byClass.values()]
    .flatMap((bucket) =>
      [...bucket.reports.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, REPORTS_PER_MODALITY)
        .map((item) => ({ ...item, rank: bucket.rank })))
    .sort((a, b) => b.rank - a.rank || b.date.localeCompare(a.date))
    .map(({ report, date, group }) => {
      const entry = report.id ? entryByResourceId.get(report.id) : undefined
      return {
        line: `- ${group} — ${compact(entry?.display ?? codeText(report.code) ?? 'Report')} (${date})` +
          `${entry ? ` [${entry.key}]` : ''}: ${truncate(reportNarrative(report), REPORT_CONCLUSION_CHARS)}`,
        keys: entry ? [entry.key] : [],
      }
    })
}

function collectCarePlans(
  input: OverviewSnapshotInput,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  return (input.clinicalData.carePlans ?? [])
    .map((carePlan) => {
      const entry = carePlan.id ? entryByResourceId.get(carePlan.id) : undefined
      const date = isoDay(carePlan.period?.start ?? carePlan.created)
      return {
        line: `- ${compact(entry?.display ?? carePlan.title ?? 'CarePlan')}` +
          `${date ? ` (${date})` : ''}${entry ? ` [${entry.key}]` : ''}`,
        keys: entry ? [entry.key] : [],
        date: date ?? '',
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ line, keys }) => ({ line, keys }))
}

function collectAllergies(
  input: OverviewSnapshotInput,
  locale: SummaryLocale,
  entryByResourceId: Map<string, SummarySourceCatalogEntry>,
): SnapshotItem[] {
  // ABSENCE IS NEVER WRITTEN HERE. "No allergy record" is an app-side fact the
  // hero card renders deterministically; a model asked to report it would need
  // a row it cannot cite, and this snapshot keeps the "every row cites a key"
  // contract intact.
  return (input.clinicalData.allergies ?? [])
    .map((allergy) => {
      const entry = allergy.id ? entryByResourceId.get(allergy.id) : undefined
      const date = isoDay(allergy.recordedDate ?? allergy.onsetDateTime)
      return {
        line: `- ${compact(entry?.display ?? codeText(allergy.code, locale) ?? 'Allergy')}` +
          `${date ? ` (${date})` : ''}${entry ? ` [${entry.key}]` : ''}`,
        keys: entry ? [entry.key] : [],
        date: date ?? '',
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ line, keys }) => ({ line, keys }))
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface RenderedSection {
  id: OverviewSnapshotSectionId
  heading: string
  lines: string[]
  keys: string[]
  kept: number
  dropped: number
}

function renderItems(
  id: OverviewSnapshotSectionId,
  heading: string,
  items: SnapshotItem[],
  cap: number,
): RenderedSection | null {
  if (items.length === 0) return null
  const shown = items.slice(0, cap)
  const dropped = items.length - shown.length
  return {
    id,
    heading,
    lines: [...shown.map((item) => item.line), ...tail(dropped)],
    keys: shown.flatMap((item) => item.keys),
    kept: shown.length,
    dropped,
  }
}

function renderDocuments(
  documents: DocumentItem[],
  perDocumentTokens: number,
  droppedDocuments: number,
  /** How many of the leading (newest) documents keep their 病史 section. */
  historyDocuments: number,
): RenderedSection | null {
  if (documents.length === 0 && droppedDocuments === 0) return null
  const lines: string[] = []
  documents.forEach((document, index) => {
    // Key-section extraction is conservative: a note whose layout it cannot
    // recognise comes through whole and is only shortened by the token fit.
    const reduced = extractDocumentKeySections(document.text, {
      keepHistoryChars: index < historyDocuments ? DOCUMENT_HISTORY_CHARS : 0,
    })
    const body = fitDocumentTextToTokenBudget(
      reduced.text || '[No document body was available]',
      perDocumentTokens,
    )
    const boundaryId = document.id.replace(/[^A-Za-z0-9.-]/g, '_') || 'unknown'
    // The body's last line is the "[sections omitted: …]" trailer. 病史 is
    // carried outside the body fit, so appending it after the body would put
    // kept text BELOW the marker that says what was dropped — the reader would
    // take the history for part of the omission notice. Re-seat the trailer
    // last so the block always reads kept sections → 病史 → what was omitted.
    const marker = reduced.omittedSections.length
      ? documentKeySectionsOmissionMarker(reduced.omittedSections)
      : undefined
    const bodyLines = body.split('\n')
    const trailer = marker && bodyLines[bodyLines.length - 1] === marker
      ? bodyLines.pop()
      : undefined
    lines.push(
      `<BEGIN_DOCUMENT id="${boundaryId}">`,
      `Document title: ${document.title}${document.date ? ` (${document.date})` : ''}` +
        `${document.key ? ` [${document.key}]` : ''}`,
      bodyLines.join('\n'),
      // Kept out of the body fit above so the middle-cut cannot eat it.
      ...(reduced.historyText ? [reduced.historyText] : []),
      ...(trailer ? [trailer] : []),
      `<END_DOCUMENT id="${boundaryId}">`,
    )
  })
  lines.push(...tail(droppedDocuments))
  return {
    id: 'documents',
    heading: '## Discharge documents (latest admissions)',
    lines,
    keys: documents.map((document) => document.key).filter((key): key is string => !!key),
    kept: documents.length,
    dropped: droppedDocuments,
  }
}

/** The labs section: one markdown pivot per panel, plus a line for each value
 *  the pivot could not seat. `kept` / `dropped` count DATED ROWS — a table's
 *  sampling-date row, or one dated point on an `[other]` line — so the section
 *  accounting stays about how much history survived the cap. */
function renderLabs(evidence: LabEvidence, maxDates: number): RenderedSection | null {
  const lines: string[] = []
  const keys: string[] = []
  let kept = 0
  let dropped = 0

  for (const panel of evidence.panels) {
    const dates = panel.dates.slice(0, maxDates)
    // Every value of this analyte predates the kept dates, so its column would
    // be nothing but dashes. The dropped-dates line below is what discloses it.
    const rows = panel.rows.filter((row) => dates.some((date) => row.values.has(date)))
    if (rows.length === 0) continue
    const headers = rows.map((row) => {
      // The key belongs to the analyte's NEWEST value, which — because the kept
      // dates are the newest ones — is always inside this table.
      const key = panel.keyByMapKey.get(row.mapKey)
      if (key) keys.push(key)
      return `${labPivotColumnLabel(row)}${key ? ` [${key}]` : ''}`
    })
    lines.push(
      `- [${panel.id}]`,
      `| Date | ${headers.join(' | ')} |`,
      `| ${Array(rows.length + 1).fill('---').join(' | ')} |`,
      ...dates.map((date) => `| ${date} | ${rows.map((row) => formatLabPivotCell(row, date)).join(' | ')} |`),
    )
    kept += dates.length
    const hidden = panel.dates.length - dates.length
    if (hidden > 0) {
      lines.push(`+${hidden} earlier sampling date${hidden === 1 ? '' : 's'} not listed`)
      dropped += hidden
    }
  }

  if (evidence.others.length > 0) {
    lines.push('- [no panel] (not part of any lab panel: vital signs and free-standing measurements)')
    for (const other of evidence.others) {
      const points = other.points.slice(0, maxDates)
      const hidden = other.points.length - points.length
      const key = points[0]?.key
      if (key) keys.push(key)
      lines.push(
        `- ${other.label}${key ? ` [${key}]` : ''}: ` +
        points.map((point) => `${point.text}${point.date ? ` (${point.date})` : ''}`).join('; ') +
        (hidden > 0 ? `; +${hidden} earlier not listed` : ''),
      )
      kept += points.length
      dropped += hidden
    }
  }

  if (lines.length === 0) return null
  return {
    id: 'labs',
    heading: '## Labs (one date × test table per panel; rows are sampling dates, newest first; ' +
      '"-" = not measured that day; a trailing H/L/A/* on a cell is the SOURCE\'s abnormal flag; ' +
      "[key] on a column header cites that column's newest value)",
    lines,
    keys,
    kept,
    dropped,
  }
}

export function buildOverviewSnapshot(
  input: OverviewSnapshotInput,
  options: OverviewSnapshotOptions,
): OverviewSnapshot {
  const { nowMs, locale } = options
  const tokenBudget = options.tokenBudget ?? OVERVIEW_SNAPSHOT_TOKEN_BUDGET
  const entryByResourceId = new Map(input.catalog.map((entry) => [entry.resourceId, entry]))
  const keyByResourceId = new Map(input.catalog.map((entry) => [entry.resourceId, entry.key]))

  // Windows are measured from the newest record the DATA carries. Wall-clock
  // windows silently empty an archived or demo chart.
  const newestRecordDay = input.catalog
    .map((entry) => entry.date)
    .filter((date): date is string => !!date)
    .reduce((max, date) => (date > max ? date : max), '')
    || new Date(nowMs).toISOString().slice(0, 10)
  const admissionWindowStart = dayOffset(newestRecordDay, -ADMISSION_WINDOW_DAYS)

  const problems = collectProblems(input, locale, keyByResourceId)
  const medications = collectMedications(input, nowMs, entryByResourceId)
  const admissionEncounters = selectAdmissions(input, admissionWindowStart)
  const admissions = collectAdmissions(admissionEncounters, locale, entryByResourceId)
  const procedures = collectProcedures(input, locale, entryByResourceId)
  const allDocuments = collectAdmissionDocuments(
    input, admissionEncounters, admissionWindowStart, entryByResourceId,
  )
  const labs = collectLabs(input, keyByResourceId)
  const reports = collectReports(input, entryByResourceId)
  const carePlans = collectCarePlans(input, entryByResourceId)
  const allergies = collectAllergies(input, locale, entryByResourceId)

  const patientLines: string[] = []
  if (input.patient) {
    const age = ageOf(input.patient, newestRecordDay)
    const parts = [
      input.patient.gender && input.patient.gender !== 'unknown' ? input.patient.gender : undefined,
      age === undefined ? undefined : `${age} y`,
    ].filter(Boolean)
    if (parts.length > 0) patientLines.push(parts.join(', '))
  }

  /** Ladder state. Each step is applied only as far as the budget requires. */
  let documentTokens = DOCUMENT_TOKENS
  let documentCount = allDocuments.length
  let historyDocuments = allDocuments.length
  let problemCap = MAX_PROBLEMS
  let procedureCap = MAX_PROCEDURES
  let labDateCap = MAX_LAB_DATES
  let medicationCap = MAX_MEDICATIONS

  const compose = (): { text: string; sections: RenderedSection[] } => {
    const sections = [
      patientLines.length > 0
        ? {
            id: 'patient' as const,
            heading: '## Patient',
            lines: patientLines,
            keys: [],
            kept: 1,
            dropped: 0,
          }
        : null,
      renderItems(
        'problems',
        '## Problems (deduplicated; "primary diagnosis" = the diagnosis code of the counted visits)',
        problems,
        problemCap,
      ),
      renderItems('medications', '## Medicines (current first; "supply ended" = recently dispensed but no longer covered)', medications, medicationCap),
      renderItems('admissions', '## Admissions / ER (last 24 months)', admissions, MAX_ADMISSIONS),
      renderItems(
        'procedures',
        '## Major procedures (operations, radiotherapy, implants, antineoplastic infusions; routine nursing/ancillary billing rows such as 換藥 and 點滴注射 are not listed)',
        procedures,
        procedureCap,
      ),
      renderDocuments(
        allDocuments.slice(0, documentCount),
        documentTokens,
        allDocuments.length - documentCount,
        Math.min(historyDocuments, documentCount),
      ),
      renderLabs(labs, labDateCap),
      renderItems('reports', '## Reports (latest per modality)', reports, MAX_REPORTS),
      renderItems('carePlans', '## Care plans', carePlans, MAX_CARE_PLANS),
      renderItems('allergies', '## Allergies on record', allergies, MAX_ALLERGIES),
    ].filter((section): section is RenderedSection => section !== null)
    return {
      text: sections.map((section) => [section.heading, ...section.lines].join('\n')).join('\n\n'),
      sections,
    }
  }

  let composed = compose()
  // Trim order: the largest, most redundant evidence first. Document narrative
  // is the biggest single item and its diagnoses are already in the problem
  // list; medicines are last because a current prescription is the one thing
  // the overview can never invent.
  const ladder: Array<() => boolean> = [
    () => { if (documentTokens === DOCUMENT_TOKENS && documentCount > 0) { documentTokens = DOCUMENT_TOKENS_TRIMMED; return true } return false },
    // 病史 for the newest note only: the older admission's history restates it.
    () => { if (historyDocuments > 1) { historyDocuments = 1; return true } return false },
    () => { if (documentCount > 1) { documentCount -= 1; return true } return false },
    () => { if (problemCap > MAX_PROBLEMS_TRIMMED) { problemCap = MAX_PROBLEMS_TRIMMED; return true } return false },
    () => { if (procedureCap > MAX_PROCEDURES_TRIMMED) { procedureCap = MAX_PROCEDURES_TRIMMED; return true } return false },
    // Labs give up depth before medicines give up rows: a trend can be read
    // from four points, and a current prescription cannot be inferred at all.
    () => { if (labDateCap > MAX_LAB_DATES_TRIMMED) { labDateCap = MAX_LAB_DATES_TRIMMED; return true } return false },
    () => { if (labDateCap > 1) { labDateCap = 1; return true } return false },
    () => { if (medicationCap > MAX_MEDICATIONS_TRIMMED) { medicationCap = MAX_MEDICATIONS_TRIMMED; return true } return false },
    // Last resort — the trailer then names 病史 among the omitted sections again.
    () => { if (historyDocuments > 0) { historyDocuments = 0; return true } return false },
  ]
  for (const step of ladder) {
    if (estimateTokens(composed.text) <= tokenBudget) break
    if (step()) composed = compose()
  }

  const citedKeys = new Set(composed.sections.flatMap((section) => section.keys))
  return {
    clinicalContext: composed.text,
    catalog: input.catalog.filter((entry) => citedKeys.has(entry.key)),
    estimatedTokens: estimateTokens(composed.text),
    sections: composed.sections.map((section) => ({
      id: section.id,
      tokens: estimateTokens([section.heading, ...section.lines].join('\n')),
      kept: section.kept,
      dropped: section.dropped,
    })),
  }
}
