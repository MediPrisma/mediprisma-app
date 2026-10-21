// IPS curation — narrows the full ClinicalDataCollection down to the curated
// subset the user has chosen in the 資料選擇 (data-selection) tab.
//
// An IPS is "a coherent snapshot ... a subset of the available information"
// (HL7 IPS IG) — NOT a multi-year data dump. Rather than invent a second set of
// filters, we honor exactly what the user already curated for the AI context:
// the `selectedData` category toggles + `DataFilters`. The per-section semantics
// mirror the existing, tested filtering used elsewhere in the app:
//   - medications  → useMedicationsContext (chronic/acute, time range, dedup by
//                    drug name, "現用藥/慢箋為主" = currently-in-use OR chronic)
//   - problem list → useProblemListContext (problem-list-item + active status)
//   - reports/vitals/procedures → generate-clinical-context.use-case
//     (filterByTimeRange + latest-version dedup)
//
// Pure functions only (no React) so the builder/tests can call this directly.

import type {
  CarePlanEntity,
  ClinicalDataCollection,
  ConditionEntity,
  DiagnosticReportEntity,
  ImmunizationEntity,
  MedicationEntity,
  ObservationEntity,
  ProcedureEntity,
} from '@/src/core/entities/clinical-data.entity'
import type {
  DataFilters,
  DataSelection,
  TimeRange,
} from '@/src/core/entities/clinical-context.entity'
import { isChronicPrescription } from '@/src/shared/utils/fhir-display-helpers'
import { inferGroupFromCategory } from '@/src/shared/utils/report-grouping-helpers'
import { orphanResultObservations } from './ips-helpers'
import { assessMedicationCurrentness } from '@/src/core/utils/clinical-context-selection.utils'

export interface CurateForIpsInput {
  data: ClinicalDataCollection
  selection: DataSelection
  filters: DataFilters
  /** Reference "now" for time-range filtering (injectable for deterministic tests). */
  now?: Date
}

// --- Shared predicates (mirrors useProblemListContext) ---------------------

function isProblemListItem(cond: ConditionEntity): boolean {
  return (cond.category ?? []).some((cat) =>
    (cat.coding ?? []).some((c) => c.code === 'problem-list-item'),
  )
}

function isActiveCondition(cond: ConditionEntity): boolean {
  const s = (cond.clinicalStatus || '').toLowerCase()
  if (!s) return true // no status recorded ⇒ treat as active (matches app)
  return s === 'active' || s === 'recurrence' || s === 'relapse'
}

// --- Time-range filtering (mirrors generate-clinical-context.use-case) ------

function rangeStart(range: TimeRange, now: Date): Date | null {
  if (range === 'all') return null
  const d = new Date(now)
  switch (range) {
    case '24h':
      d.setDate(now.getDate() - 1)
      break
    case '3d':
      d.setDate(now.getDate() - 3)
      break
    case '1w':
      d.setDate(now.getDate() - 7)
      break
    case '1m':
      d.setMonth(now.getMonth() - 1)
      break
    case '3m':
      d.setMonth(now.getMonth() - 3)
      break
    case '6m':
      d.setMonth(now.getMonth() - 6)
      break
    case '1y':
      d.setFullYear(now.getFullYear() - 1)
      break
    case '3y':
      d.setFullYear(now.getFullYear() - 3)
      break
    case '5y':
      d.setFullYear(now.getFullYear() - 5)
      break
  }
  return d
}

function withinRange<T>(
  items: T[],
  range: TimeRange,
  now: Date,
  getDate: (i: T) => string | undefined,
): T[] {
  const start = rangeStart(range, now)
  if (!start) return items
  const startMs = start.getTime()
  return items.filter((i) => {
    const ds = getDate(i)
    if (!ds) return false // undated items drop out of a bounded window
    const t = new Date(ds).getTime()
    return !Number.isNaN(t) && t >= startMs
  })
}

/**
 * Keep only the most recent item per key (panel name / type). Items with no
 * key are passed through untouched (kept distinct), never collapsed together.
 */
function latestPerKey<T>(
  items: T[],
  keyOf: (i: T) => string,
  dateOf: (i: T) => string | undefined,
): T[] {
  return latestKPerKey(items, keyOf, dateOf, 1)
}

// --- IPS Results 檢驗語意(每項目筆數 + 2 年回溯 + 空窗放寬) -----------------
// IPS 是「一份可攜快照」:每個檢驗項目保留最近 K 筆(看得出短期趨勢),K 由使用者
// 的 labDepth 決定(latest→1、'3'/'8'/'16'→K、'all'→不限),且只取最近
// LOOKBACK_YEARS 年內的資料。這裡的「2 年回溯 + 空窗放寬」是 IPS 層的獨立機制,
// 與 depth *值* 解耦 — 不管使用者選哪個 depth,IPS 都套同一個回溯窗;若病人在該
// 時間窗內完全沒有任何檢驗(報告 + 單獨 observations 皆空),自動放寬為
// 「每項目最近 1 筆、不限時間」,讓穩定病人的 IPS 仍帶有最後已知的檢驗值而不是
// 空區段。AI-context 側(lab category)不套這套回溯/放寬,只吃 labDepth 的筆數。

/** 空窗放寬時每個檢驗項目保留的筆數(每項目最近 1 筆)。 */
export const LATEST_PER_ANALYTE_K = 3
/** IPS Results:只納入最近幾年內的檢驗。 */
export const LOOKBACK_YEARS = 2

/**
 * labDepth → 每項目最多保留幾筆(K)。'latest'→1、'3'/'8'/'16'→該數、'all'→不限
 * (Infinity)。缺值(舊資料 / 未設)退回 IPS 預設 K=3。
 */
function depthToK(depth: string | undefined): number {
  if (depth === 'latest') return 1
  if (depth === 'all') return Number.POSITIVE_INFINITY
  const n = Number(depth)
  return Number.isFinite(n) && n > 0 ? n : LATEST_PER_ANALYTE_K
}

function lookbackStart(now: Date): Date {
  const d = new Date(now)
  d.setFullYear(d.getFullYear() - LOOKBACK_YEARS)
  return d
}

/** Keep only items dated within the IPS Results lookback window (LOOKBACK_YEARS). */
function withinLookback<T>(items: T[], now: Date, dateOf: (i: T) => string | undefined): T[] {
  const startMs = lookbackStart(now).getTime()
  return items.filter((i) => {
    const ds = dateOf(i)
    if (!ds) return false // undated items drop out of a bounded window
    const t = new Date(ds).getTime()
    return !Number.isNaN(t) && t >= startMs
  })
}

/**
 * Generalised latestPerKey: keep the most recent `k` items per key, newest
 * first. Items with no key pass through untouched (kept distinct).
 */
function latestKPerKey<T>(
  items: T[],
  keyOf: (i: T) => string,
  dateOf: (i: T) => string | undefined,
  k: number,
): T[] {
  const sorted = [...items].sort((a, b) => (dateOf(b) || '').localeCompare(dateOf(a) || ''))
  const counts = new Map<string, number>()
  const out: T[] = []
  for (const it of sorted) {
    const key = keyOf(it).trim()
    if (!key) {
      out.push(it)
      continue
    }
    const n = counts.get(key) ?? 0
    if (n < k) {
      out.push(it)
      counts.set(key, n + 1)
    }
  }
  return out
}

/** 影像類報告分流判定(P2:接上 imagingReports 開關)。 */
function isImagingReport(r: DiagnosticReportEntity): boolean {
  return inferGroupFromCategory(r.category) === 'imaging'
}

const reportDate = (r: DiagnosticReportEntity) => r.effectiveDateTime
const obsDate = (o: ObservationEntity) => o.effectiveDateTime
const reportKey = (r: DiagnosticReportEntity) => r.code?.text || ''
const obsKey = (o: ObservationEntity) => o.code?.text || ''

/**
 * IPS Results 放寬判定 — 整體 Results(lab 報告 + orphan observations)在
 * 「labReportTimeRange ∩ 最近 LOOKBACK_YEARS 年」的交集時間窗內完全為空時才放寬。
 * 判定必須跨兩個集合一起做:若病人 2 年內只剩 orphan observations,報告區不該
 * 把多年前的舊報告復活。此判定不看 labDepth — 回溯/放寬對所有 depth 一致(IPS 層
 * 機制,與 depth 解耦)。
 */
function shouldRelaxLabWindow(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): boolean {
  if (!selection.labReports) return false
  const labReports = data.diagnosticReports.filter((r) => !isImagingReport(r))
  const windowedReports = withinLookback(
    withinRange(labReports, filters.labReportTimeRange, now, reportDate),
    now,
    reportDate,
  )
  if (windowedReports.length > 0) return false
  const orphans = orphanResultObservations(data.diagnosticReports, data.observations)
  const windowedObs = withinLookback(
    withinRange(orphans, filters.labReportTimeRange, now, obsDate),
    now,
    obsDate,
  )
  return windowedObs.length === 0
}

// --- Per-section curators ---------------------------------------------------

function curateConditions(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): ConditionEntity[] {
  if (!selection.problemList) return []
  const problemItems = data.conditions.filter(isProblemListItem)
  // Prefer the curated problem-list-item set (the app's Problem List view).
  // Fall back to all conditions when the source doesn't tag problem-list-item
  // (e.g. non-bridge FHIR) so the IPS-required Problem List section isn't empty.
  const base = problemItems.length > 0 ? problemItems : data.conditions
  const byStatus = filters.problemListStatus === 'active' ? base.filter(isActiveCondition) : base
  // The problem list is carried through as-is: the app attaches NO SNOMED CT
  // coding. Source codings on Condition.code (ICD-10 etc.) are preserved
  // downstream by the FHIR mapper.
  return withinRange(byStatus, filters.problemListTimeRange, now, (c) => c.recordedDate)
}

function curateMedications(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): MedicationEntity[] {
  if (!selection.medications) return []
  let meds = data.medications

  // Chronic / acute filter.
  if (filters.medicationChronic === 'chronic') {
    meds = meds.filter((m) => isChronicPrescription(m))
  } else if (filters.medicationChronic === 'acute') {
    meds = meds.filter((m) => !isChronicPrescription(m))
  }

  // Time-range filter on authoredOn.
  meds = withinRange(meds, filters.medicationTimeRange, now, (m) => m.authoredOn)

  // Chronic is a property of an individual prescription, not evidence that
  // every historical fill is still current. Use its own supply/status facts.
  if (filters.medicationStatus === 'active') {
    meds = meds.flatMap((m) => {
      const assessment = assessMedicationCurrentness(m, now.getTime())
      if (assessment.current) return [m]
      return assessment.uncertain ? [{ ...m, status: 'unknown', note: [...(m.note ?? []), {
        text: `Current medication use is unconfirmed; original source status: ${m.status || 'unknown'}. Verify source records before prescribing.`,
      }] }] : []
    })
  }

  // Confirmed copies were reconciled at import. Name-only folding loses
  // genuine orders and source comparison evidence in exported records.
  return meds
}

function curateImmunizations(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): ImmunizationEntity[] {
  if (!selection.immunizations) return []
  return withinRange(
    data.immunizations,
    filters.immunizationTimeRange,
    now,
    (im) => im.occurrenceDateTime,
  )
}

function curateLabReports(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
  relaxLabWindow: boolean,
): DiagnosticReportEntity[] {
  if (!selection.labReports) return []
  // 影像類報告由 curateImagingReports 分流處理(P2:imagingReports 開關)。
  const labReports = data.diagnosticReports.filter((r) => !isImagingReport(r))
  // 放寬:時間窗內整體無檢驗 → 每項目最近 1 筆、不限時間。
  if (relaxLabWindow) return latestKPerKey(labReports, reportKey, reportDate, 1)
  // labReportTimeRange ∩ 2 年回溯 → 每項目最近 K 筆(K 由 labDepth 決定)。
  const windowed = withinLookback(
    withinRange(labReports, filters.labReportTimeRange, now, reportDate),
    now,
    reportDate,
  )
  return latestKPerKey(windowed, reportKey, reportDate, depthToK(filters.labDepth))
}

/**
 * P2 快修 — imagingReports 死 toggle:curateForIps 以前從未讀 imagingReports 的
 * selection/filters,影像類 DiagnosticReport 一律跟著 labReports 的開關與時間窗
 * 走。現在依 category(inferGroupFromCategory)分流:影像報告由 imagingReports
 * 開關 + imagingReportTimeRange / imagingReportVersion 控制,和 AI-context 的
 * imaging-reports category 一致。
 */
function curateImagingReports(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): DiagnosticReportEntity[] {
  if (!selection.imagingReports) return []
  const imaging = data.diagnosticReports.filter(isImagingReport)
  let reports = withinRange(imaging, filters.imagingReportTimeRange, now, reportDate)
  if (filters.imagingReportVersion === 'latest') {
    reports = latestPerKey(reports, reportKey, reportDate)
  }
  return reports
}

function curateObservations(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
  relaxLabWindow: boolean,
): ObservationEntity[] {
  // Orphan / standalone lab observations ride WITH the lab Results section (no
  // separate toggle) — so they're in iff that section is, and gone when it's
  // toggled off. They reuse the lab-report time window so they don't bloat it.
  if (!selection.labReports) return []
  // The data layer puts EVERY Observation here — including ones already nested
  // under a DiagnosticReport (`_observations`) and vital-sign observations.
  // Keep only the true orphans so the Results section doesn't show a value row
  // AND a "N observation(s)" report row for the same analyte.
  const orphans = orphanResultObservations(data.diagnosticReports, data.observations)
  if (relaxLabWindow) return latestKPerKey(orphans, obsKey, obsDate, 1)
  const windowed = withinLookback(
    withinRange(orphans, filters.labReportTimeRange, now, obsDate),
    now,
    obsDate,
  )
  return latestKPerKey(windowed, obsKey, obsDate, depthToK(filters.labDepth))
}

function curateVitalSigns(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): ObservationEntity[] {
  if (!selection.vitalSigns) return []
  let vitals = withinRange(
    data.vitalSigns,
    filters.vitalSignsTimeRange,
    now,
    (v) => v.effectiveDateTime,
  )
  if (filters.vitalSignsVersion === 'latest') {
    vitals = latestPerKey(
      vitals,
      (v) => v.code?.text || '',
      (v) => v.effectiveDateTime,
    )
  }
  return vitals
}

function curateProcedures(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
  now: Date,
): ProcedureEntity[] {
  if (!selection.procedures) return []
  const dateOf = (p: ProcedureEntity) =>
    p.performedDateTime || p.performedPeriod?.end || p.performedPeriod?.start
  let procs = withinRange(data.procedures, filters.procedureTimeRange, now, dateOf)
  if (filters.procedureVersion === 'latest') {
    procs = latestPerKey(procs, (p) => p.code?.text || p.code?.coding?.[0]?.display || '', dateOf)
  }
  return procs
}

function curateCarePlans(
  data: ClinicalDataCollection,
  selection: DataSelection,
  filters: DataFilters,
): CarePlanEntity[] {
  if (!selection.carePlans) return []
  return filters.carePlanStatus === 'active'
    ? data.carePlans.filter((cp) => cp.status === 'active')
    : data.carePlans
}

/**
 * Produce a curated ClinicalDataCollection for IPS assembly by honoring the
 * data-selection tab's category toggles + filters. Advance directives, devices
 * and care plans now honor their toggles too; resources the IPS builder doesn't
 * read (encounters, document references, compositions) pass through unchanged.
 * Documents (Composition) are intentionally chat/insights-only — not folded
 * back into the IPS, which is itself a Composition.
 */
export function curateForIps(input: CurateForIpsInput): ClinicalDataCollection {
  const { data, selection, filters } = input
  const now = input.now ?? new Date()
  // Results 空窗放寬判定跨 lab 報告 + orphan observations 一起算一次,兩個 curator
  // 共用同一個結論(見 shouldRelaxLabWindow)。
  const relax = shouldRelaxLabWindow(data, selection, filters, now)
  return {
    ...data,
    conditions: curateConditions(data, selection, filters, now),
    medications: curateMedications(data, selection, filters, now),
    allergies: selection.allergies ? data.allergies : [],
    immunizations: curateImmunizations(data, selection, filters, now),
    diagnosticReports: [
      ...curateLabReports(data, selection, filters, now, relax),
      ...curateImagingReports(data, selection, filters, now),
    ],
    observations: curateObservations(data, selection, filters, now, relax),
    vitalSigns: curateVitalSigns(data, selection, filters, now),
    procedures: curateProcedures(data, selection, filters, now),
    consents: selection.advanceDirectives ? data.consents : [],
    devices: selection.medicalDevices ? data.devices : [],
    carePlans: curateCarePlans(data, selection, filters),
  }
}
