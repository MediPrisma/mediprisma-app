// Data Selection Constants
// Default selection / filters + clinical scenario presets for the right-side
// Data Selection panel.

import type { DataSelection, DataFilters } from '@/src/core/entities/clinical-context.entity'

// ── 初診 (new patient) — the default profile ────────────────────────────────
// A broad-but-bounded first-look snapshot: the full problem/med/allergy picture
// + recent lab trends/imaging, time-bounded so the AI context stays complete
// without drowning in noise. This is the seed for new profiles and for the
// user's Custom template slot.
/** Discharge summaries sent by default: the latest three admissions. One
 *  admission's note was not enough for a first-visit overview and hid the
 *  previous stay's anticoagulant history; 'all' would flood a 32K window. */
export const DEFAULT_DOCUMENT_MODE = 'recentAdmissions' as const

export const DEFAULT_DATA_SELECTION: DataSelection = {
  // Patient group
  patientInfo: true,
  vitalSigns: true,
  problemList: true,
  advanceDirectives: true, // safety-critical (DNR / AD)
  medicalDevices: true,    // implants matter; sparse, so no noise when empty
  carePlans: true,         // active plans only (filter below)

  // Visit group
  encounters: true,

  // Reports group
  labReports: true,
  imagingReports: true,
  procedures: true,
  observations: false,     // Optional low-signal Observation records outside labs/imaging/vitals

  // Medication group
  medications: true,
  allergies: true,
  immunizations: true,

  // Documents group
  documents: true,         // On by default; DEFAULT_DOCUMENT_MODE keeps
                           // it to just the most recent 出院病摘 (bounded).
}

export const DEFAULT_DATA_FILTERS: DataFilters = {
  problemListStatus: 'active',
  // Problem list defaults to all time (a problem list is the standing set of
  // active problems, not a recent-events window); the range is offered so it can
  // be narrowed when desired.
  problemListTimeRange: 'all',
  // Visits default to the last 6 months (初診 snapshot). Unlike labs, visits do
  // not silently widen an empty bounded window; the coverage manifest retains
  // the distinction between no selected visits and unavailable data.
  encounterTimeRange: '6m',
  medicationStatus: 'active',
  medicationChronic: 'all',
  // Meds default to the last 6 months; the hook dedups by drug name so chronic
  // refills still collapse to one current row.
  medicationTimeRange: '6m',
  // 每項目筆數 — 8 筆的樞紐趨勢,讓 AI 看得到走勢(Cr 1.2 → 1.5 → 2.0 = 惡化),
  // 由 6 個月窗界定。8 平衡趨勢與量;renal/HbA1c 長期趨勢可調高,token 吃緊可調
  // 低或用「最新」。窗內為空時(穩定病人上一次 panel 早於窗)lab category 退回最近
  // 採檢日而非空區段 — 見 applyLabWindow。
  labDepth: '8',
  labReportTimeRange: '6m',
  // Empty = include every lab panel. Narrow (e.g. 'cbc,chem') only for
  // analyte-dense patients where the full panel set overwhelms the context.
  labPanelIds: '',
  // All versions, not latest-per-name: NHI cloud records give every CT the
  // same order name (33071B 電腦斷層造影) whatever the body part, so
  // latest-per-name collapsed a year of serial studies into one report and
  // the 影像與病理重點 section lost every comparison. Same-study duplicates
  // are still collapsed by the report digest (modality + day + accession).
  imagingReportVersion: 'all',
  imagingReportTimeRange: '1y',
  // Vitals / procedures / immunizations: `latest`-version filter already dedups
  // by name, so volume isn't a concern. Keep `all` so historical data for
  // elderly / stable patients still surfaces.
  vitalSignsVersion: 'latest',
  vitalSignsTimeRange: 'all',
  // Procedures: no latest/all dedup filter (removed from the UI) — show every
  // procedure within the time range.
  procedureVersion: 'all',
  procedureTimeRange: 'all',
  // Optional standalone-observation filters.
  observationVersion: 'latest',
  observationTimeRange: 'all',
  immunizationTimeRange: 'all',
  carePlanStatus: 'active',
}

// ── IPS 匯出 — 專屬預設 filters ──────────────────────────────────────────────
// IPS 是「一份可攜帶的快照」，不是完整趨勢 dump：Results 區預設 labDepth '3'
// （每個檢驗項目最近 3 筆）。IPS curation 另外套 2 年回溯 + 空窗放寬（病人 2 年內
// 無檢驗時自動放寬為每項目最近 1 筆、不限時間 — 見 ips-curation.ts），此回溯/放寬
// 與 depth 值解耦、是 IPS 層獨立機制。
// 只影響 'ips' consumer profile 的種子值；chat/insights 的 DEFAULT_DATA_FILTERS 不變。
// 雲端病歷 (NHI MediCloud) holds about one year of visits. The 6-month 初診
// window dropped a cancer diagnosis whose follow-up runs every six months
// (owner decision 2026-10-03: use the cloud record's whole year). Applied by
// the adaptive defaults only while the 初診 filters are untouched, and shown
// as such in 資料範圍.
export const MEDCLOUD_YEAR_DATA_FILTERS: DataFilters = {
  ...DEFAULT_DATA_FILTERS,
  encounterTimeRange: '1y',
  medicationTimeRange: '1y',
  labReportTimeRange: '1y',
  imagingReportTimeRange: '1y',
}

export const IPS_DEFAULT_DATA_FILTERS: DataFilters = {
  ...DEFAULT_DATA_FILTERS,
  labDepth: '3',
  // A portable snapshot keeps the newest report per name, as before.
  imagingReportVersion: 'latest',
}

// ── 全部資料 (everything) — for the 全選 button ──────────────────────────────
// One-click "include everything": every category on, every time window opened
// to all-time, every version at full detail, all lab panels, all documents.
// Pairs with the token meter — when a patient's context is small, the user can
// take the whole record in a single click instead of widening each filter.
export const ALL_DATA_SELECTION: DataSelection = {
  patientInfo: true,
  vitalSigns: true,
  problemList: true,
  advanceDirectives: true,
  medicalDevices: true,
  carePlans: true,
  encounters: true,
  labReports: true,
  imagingReports: true,
  procedures: true,
  observations: true,  // every leftover Observation not owned by labs/imaging/vitals
  medications: true,
  allergies: true,
  immunizations: true,
  documents: true,
}

export const ALL_DATA_FILTERS: DataFilters = {
  ...DEFAULT_DATA_FILTERS,
  problemListStatus: 'all',
  problemListTimeRange: 'all',
  encounterTimeRange: 'all',
  medicationStatus: 'all',
  medicationChronic: 'all',
  medicationTimeRange: 'all',
  labDepth: 'all',      // every reading per test — a complete history
  labReportTimeRange: 'all',
  labPanelIds: '',      // all panels
  imagingReportVersion: 'all',
  imagingReportTimeRange: 'all',
  vitalSignsVersion: 'all',
  vitalSignsTimeRange: 'all',
  procedureVersion: 'all',
  procedureTimeRange: 'all',
  observationVersion: 'all',
  observationTimeRange: 'all',
  immunizationTimeRange: 'all',
  carePlanStatus: 'all',
}

// ── 追蹤 (follow-up) — focused profile ──────────────────────────────────────
// For an established patient: what changed since the previous visit. Active
// problems + active meds + labs/vitals/imaging/procedures/visits scoped to the
// patient's own visit cadence (not a fixed wall-clock window — a patient seen
// every 6 months would otherwise show an empty "last 3 months"); stable history
// (vaccines, devices, care plans) trimmed away.
const FOLLOW_UP_SELECTION: DataSelection = {
  patientInfo: true,
  vitalSigns: true,
  problemList: true,
  advanceDirectives: false,
  medicalDevices: false,
  carePlans: false,
  encounters: true,
  labReports: true,
  imagingReports: true,
  procedures: true,
  observations: false,
  medications: true,
  allergies: true,
  immunizations: false,
  documents: false,
}

const FOLLOW_UP_FILTERS: DataFilters = {
  ...DEFAULT_DATA_FILTERS,
  // Event-based window: everything since the previous distinct visit day, so
  // the follow-up scope tracks the patient's real cadence instead of a fixed
  // 3-month window that empties out for anyone seen less often. The lab
  // fallback still guarantees a non-empty trend if even that window is empty.
  labReportTimeRange: 'sinceLastVisit',
  vitalSignsTimeRange: 'sinceLastVisit',
  encounterTimeRange: 'sinceLastVisit',
  imagingReportTimeRange: 'sinceLastVisit',
  procedureTimeRange: 'sinceLastVisit',
}

// ── 初診 (new patient) — comprehensive first-visit profile ───────────────────
const NEW_PATIENT_SELECTION: DataSelection = {
  ...DEFAULT_DATA_SELECTION,
  // documents是 sticky 設定（不受 preset 控制），所以不在這裡開關。
}

const NEW_PATIENT_FILTERS: DataFilters = {
  ...DEFAULT_DATA_FILTERS,
}

export type BuiltInPresetId = 'newPatient' | 'followUp'
export type PresetId = BuiltInPresetId | 'custom'

export interface DataSelectionPreset {
  id: BuiltInPresetId
  labelKey: string
  selection: DataSelection
  filters: DataFilters
}

export interface DataSelectionTemplate {
  selection: DataSelection
  filters: DataFilters
}

export const DATA_SELECTION_PRESETS: Record<BuiltInPresetId, DataSelectionPreset> = {
  newPatient: {
    id: 'newPatient',
    labelKey: 'dataSelection.presetNewPatient',
    selection: NEW_PATIENT_SELECTION,
    filters: NEW_PATIENT_FILTERS,
  },
  followUp: {
    id: 'followUp',
    labelKey: 'dataSelection.presetFollowUp',
    selection: FOLLOW_UP_SELECTION,
    filters: FOLLOW_UP_FILTERS,
  },
}

export const CUSTOM_TEMPLATE_DEFAULT: DataSelectionTemplate = {
  selection: NEW_PATIENT_SELECTION,
  filters: NEW_PATIENT_FILTERS,
}

// Fallback only, used when migrating old storage that predates the explicit
// active-template state. Runtime activePreset is stored in the provider.
export function resolveActivePreset(selection: DataSelection, filters: DataFilters): PresetId {
  const sel = selection as unknown as Record<string, unknown>
  const fil = filters as unknown as Record<string, unknown>
  const matches = (id: BuiltInPresetId): boolean => {
    const preset = DATA_SELECTION_PRESETS[id]
    const pSel = preset.selection as unknown as Record<string, unknown>
    const pFil = preset.filters as unknown as Record<string, unknown>
    return (
      // `documents` is sticky and `observations` is a hidden legacy key, so
      // neither should affect template migration/highlighting.
      Object.keys(pSel).filter((k) => k !== 'documents' && k !== 'observations').every((k) => sel[k] === pSel[k]) &&
      Object.keys(pFil).every((k) => fil[k] === pFil[k])
    )
  }
  if (matches('followUp')) return 'followUp'
  if (matches('newPatient')) return 'newPatient'
  return 'custom'
}

export const STORAGE_KEYS = {
  DATA_SELECTION: 'clinicalDataSelection',
  DATA_FILTERS: 'clinicalDataFilters',
  DATA_PROFILES: 'clinicalDataProfiles',
  DATA_ACTIVE_PRESET: 'clinicalDataActivePreset',
  DATA_CUSTOM_PRESET: 'clinicalDataCustomPreset',
  MODEL_SELECTION: 'clinical-note:model',
  API_KEY: 'clinical-note:openai-key',
  GEMINI_KEY: 'clinical-note:gemini-key',
  PERPLEXITY_KEY: 'clinical-note:perplexity-key',
  PROMPT_TEMPLATES: 'medical-chat-prompt-templates',
  CLINICAL_INSIGHTS_AUTO_GENERATE: 'clinical-insights-auto-generate'
} as const
