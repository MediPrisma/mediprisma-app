// Feature Registry - Central configuration for all clinical summary features
// Contributors can easily add/remove/replace features by modifying this registry
import { ComponentType } from 'react'
import { PatientInfoCard } from '@/features/clinical-summary/patient-info/PatientInfoCard'
import { VitalsCard } from '@/features/clinical-summary/vitals/VitalsCard'
import { MedListCard } from '@/features/clinical-summary/medications/MedListCard'
import { AllergiesCard } from '@/features/clinical-summary/allergies/AllergiesCard'
import { DiagnosesCard } from '@/features/clinical-summary/diagnosis/DiagnosisCard'
import { ProblemListCard } from '@/features/clinical-summary/problem-list/ProblemListCard'
import { AdvanceDirectivesCard } from '@/features/clinical-summary/advance-directives/AdvanceDirectivesCard'
import { DevicesCard } from '@/features/clinical-summary/devices/DevicesCard'
import { CarePlansCard } from '@/features/clinical-summary/care-plans/CarePlansCard'
import { DocumentSummaryCard } from '@/features/clinical-summary/document-summary'
import { ReportsCard } from '@/features/clinical-summary/reports/ReportsCard'
import { VisitHistoryCard } from '@/features/clinical-summary/visit-history'
import { OverviewCard } from '@/features/clinical-summary/overview'
import { LastOutpatientCard } from '@/features/clinical-summary/last-outpatient'

// ============================================================================
// TAB CONFIGURATION - Define available tabs in the left panel
// ============================================================================
export interface TabConfig {
  id: string
  /** i18n key for tab label */
  labelKey: string
  /** Display order (lower = first) */
  order: number
  /** Whether this tab is enabled */
  enabled: boolean
  /**
   * Hand the tab its own full height instead of the shared vertical scroller.
   * Only for a tab whose feature lays itself out against the available height
   * (總覽's wide 2×2 grid must not scroll); every other tab keeps the
   * ScrollArea it has always had.
   */
  fillHeight?: boolean
  /**
   * Show the tab only when the loaded chart holds this kind of data.
   * 'hospital-outpatient': at least one hospital (院內) outpatient visit; a
   * cloud-only chart (雲端病歷 / 健康存摺) never shows the tab.
   */
  requires?: 'hospital-outpatient'
}

export interface TabVisibilityOptions {
  /** The chart holds a hospital (院內) outpatient visit. */
  hasHospitalOutpatientVisit?: boolean
}

export const LEFT_PANEL_TABS: TabConfig[] = [
  // 總覽 sits first and is therefore the tab a loaded patient opens on. To keep
  // 病人資訊 as the landing tab instead, change this order to 0.5.
  { id: 'overview',  labelKey: 'overview',    order: -1, enabled: true, fillHeight: true },
  // 上次門診: everything the latest hospital outpatient visit ordered, on one
  // page. Owner request in chat 2026-10-28: only for charts with hospital
  // (院內) data and a hospital outpatient visit; cloud-only charts never see it.
  { id: 'last-outpatient', labelKey: 'lastOutpatient', order: -0.5, enabled: true, requires: 'hospital-outpatient' },
  { id: 'patient',   labelKey: 'patient',     order: 0, enabled: true },
  { id: 'visits',    labelKey: 'visits',      order: 1, enabled: true },
  { id: 'reports',   labelKey: 'reports',     order: 2, enabled: true },
  { id: 'meds',      labelKey: 'medications', order: 3, enabled: true },
  // 文件分頁：放 IPS / 出院病摘等 Composition narrative。永遠顯示，無資料時
  // 由 DocumentSummaryCard.isEmpty 顯示友善空狀態，告知使用者此功能存在。
  { id: 'documents', labelKey: 'documents',   order: 4, enabled: true },
]

// ============================================================================
// FEATURE CONFIGURATION - Define features and which tab they belong to
// ============================================================================
export interface FeatureConfig {
  id: string
  name: string
  component: ComponentType
  /** Which tab this feature belongs to */
  tab: string
  /** Display order within the tab (lower = first) */
  order: number
  /** Whether this feature is enabled */
  enabled: boolean
}

export const CLINICAL_SUMMARY_FEATURES: FeatureConfig[] = [
  // Overview Tab — one page gathering the last N months of labs, narrative
  // reports, medications and visits. Owns its own layout (no FeatureCard
  // frame) because it switches between a stacked and a 2×2 presentation.
  {
    id: 'overview',
    name: 'Overview',
    component: OverviewCard,
    tab: 'overview',
    order: 0,
    enabled: true,
  },
  {
    id: 'last-outpatient',
    name: 'Last Outpatient Visit',
    component: LastOutpatientCard,
    tab: 'last-outpatient',
    order: 0,
    enabled: true,
  },
  // Patient Tab Features — display order:
  // 病人資訊 → 生命徵象 → 問題清單 → 預立醫療決定 → 醫療器材 → 照護計畫
  {
    id: 'patient-info',
    name: 'Patient Information',
    component: PatientInfoCard,
    tab: 'patient',
    order: 0,
    enabled: true,
  },
  {
    id: 'vitals',
    name: 'Vital Signs',
    component: VitalsCard,
    tab: 'patient',
    order: 1,
    enabled: true,
  },
  {
    id: 'problem-list',
    name: 'Problem List',
    component: ProblemListCard,
    tab: 'patient',
    order: 2,
    enabled: true,
  },
  {
    id: 'advance-directives',
    name: 'Advance Directives',
    component: AdvanceDirectivesCard,
    tab: 'patient',
    order: 3,
    enabled: true,
  },
  {
    id: 'devices',
    name: 'Medical Devices',
    component: DevicesCard,
    tab: 'patient',
    order: 4,
    enabled: true,
  },
  {
    id: 'care-plans',
    name: 'Care Plans',
    component: CarePlansCard,
    tab: 'patient',
    order: 5,
    enabled: true,
  },
  // Document Summary — renders the human-readable narratives carried inside
  // FHIR Composition resources (IPS imports today; 健保存摺 discharge
  // summaries once the bridge ships them). Lives in its own 文件 tab so the
  // long narrative content has dedicated reading space and doesn't crowd the
  // dense patient tab. Tab is always visible; empty state explains the
  // feature so bridge-only sessions still know it exists.
  {
    id: 'document-summary',
    name: 'Document Summary',
    component: DocumentSummaryCard,
    tab: 'documents',
    order: 0,
    enabled: true,
  },
  {
    id: 'diagnosis',
    name: 'Diagnosis / Problem List',
    component: DiagnosesCard,
    tab: 'patient',
    order: 98,  // disabled; kept out of the way of the active ordering
    enabled: false,
  },
  // Reports Tab Features
  {
    id: 'reports',
    name: 'Reports',
    component: ReportsCard,
    tab: 'reports',
    order: 0,
    enabled: true,
  },
  // Medications Tab Features
  // AllergiesCard is now embedded as the "過敏" sub-tab inside MedListCard
  // (medications / allergies / vaccines top tabs). Disabled here so it
  // doesn't double-render. Re-enable only if reverting the consolidation.
  {
    id: 'allergies',
    name: 'Allergies & Intolerances',
    component: AllergiesCard,
    tab: 'meds',
    order: 0,
    enabled: false,
  },
  {
    id: 'medications',
    name: 'Medications',
    component: MedListCard,
    tab: 'meds',
    order: 1,
    enabled: true,
  },
  // Visits Tab Features
  {
    id: 'visit-history',
    name: 'Visit History',
    component: VisitHistoryCard,
    tab: 'visits',
    order: 0,
    enabled: true,
  },
]

/**
 * Get enabled tabs sorted by order. A tab with `requires` is listed only when
 * the chart holds that data.
 */
export function getEnabledTabs(options: TabVisibilityOptions = {}): TabConfig[] {
  return LEFT_PANEL_TABS
    .filter(tab => tab.enabled)
    .filter(tab => tab.requires !== 'hospital-outpatient' || options.hasHospitalOutpatientVisit === true)
    .sort((a, b) => a.order - b.order)
}

/**
 * Get enabled features sorted by order
 */
export function getEnabledFeatures(): FeatureConfig[] {
  return CLINICAL_SUMMARY_FEATURES
    .filter(feature => feature.enabled)
    .sort((a, b) => a.order - b.order)
}

/**
 * Get enabled features for a specific tab
 */
export function getFeaturesForTab(tabId: string): FeatureConfig[] {
  return CLINICAL_SUMMARY_FEATURES
    .filter(feature => feature.enabled && feature.tab === tabId)
    .sort((a, b) => a.order - b.order)
}

/**
 * Get feature by ID
 */
export function getFeatureById(id: string): FeatureConfig | undefined {
  return CLINICAL_SUMMARY_FEATURES.find(feature => feature.id === id)
}

/**
 * Register a new feature dynamically
 */
export function registerFeature(feature: FeatureConfig): void {
  const existingIndex = CLINICAL_SUMMARY_FEATURES.findIndex(f => f.id === feature.id)
  if (existingIndex >= 0) {
    CLINICAL_SUMMARY_FEATURES[existingIndex] = feature
  } else {
    CLINICAL_SUMMARY_FEATURES.push(feature)
  }
}

/**
 * Disable a feature by ID
 */
export function disableFeature(id: string): void {
  const feature = CLINICAL_SUMMARY_FEATURES.find(f => f.id === id)
  if (feature) {
    feature.enabled = false
  }
}
