// Application Provider: Data Selection
//
// Per-consumer profiles. Each clinical-data consumer owns its own {selection,
// filters, documentMode, documentIds}. Profiles are seeded identically (the 初診
// default), then the user can fine-tune the main summary/insights selection or
// the independent IPS and external-AI export selections.
//
// The data-selection UI uses the convenience getters/setters below; consumers
// read their resolved profile via getProfile(consumer).
"use client"

import { DEFAULT_DOCUMENT_MODE } from '@/src/shared/constants/data-selection.constants'
import { createContext, useContext, useEffect, useState, useMemo, useCallback, type ReactNode } from 'react'
import { StorageService } from '@/src/shared/utils/storage.utils'
import {
  DEFAULT_DATA_SELECTION,
  DEFAULT_DATA_FILTERS,
  IPS_DEFAULT_DATA_FILTERS,
  ALL_DATA_SELECTION,
  ALL_DATA_FILTERS,
  CUSTOM_TEMPLATE_DEFAULT,
  DATA_SELECTION_PRESETS,
  STORAGE_KEYS,
  resolveActivePreset,
  type PresetId,
  type BuiltInPresetId,
  type DataSelectionTemplate,
} from '@/src/shared/constants/data-selection.constants'
import type { DataSelection, DataFilters } from '@/src/core/entities/clinical-context.entity'
import type { DocumentMode } from '@/src/core/utils/clinical-documents.utils'
import { ensureCategoriesInitialized } from '@/src/core/categories/init'

ensureCategoriesInitialized()

type DataType = keyof DataSelection
export type DataConsumer = 'chat' | 'insights' | 'nhiLipid' | 'ips' | 'aiExport'
// Standard summary/insights use `insights`. The mirrored `chat` profile is kept
// for stored-profile compatibility and the shared token meter; agent chat does
// not preload either profile and queries FHIR tools on demand. IPS is configured
// independently on its own tab. NHI lipid review has a separate clinical scope
// because its evidence needs differ from general summaries. External AI export
// owns another profile so
// preparing a handoff never changes summary generation or IPS curation.
const MAIN_TARGETS: DataConsumer[] = ['chat', 'insights']

export interface ConsumerProfile {
  selection: DataSelection
  filters: DataFilters
  /** Documents are picked per-document, not via scalar filters. */
  documentMode: DocumentMode
  documentIds: string[]
}

interface DataSelectionContextValue {
  // ── 資料選擇 panel convenience — edit the mirrored main AI profile ──
  selectedData: DataSelection
  setSelectedData: (next: DataSelection) => void
  updateSelection: (dataType: DataType, isSelected: boolean) => void
  resetToDefaults: () => void
  applyPreset: (presetId: PresetId) => void
  /** One-click "include everything": all categories + all-time windows + all
   *  documents. Pairs with the token meter for small-context patients. */
  selectAllData: () => void
  /** Selected template mode for the main Data Selection panel. */
  activePreset: PresetId
  filters: DataFilters
  setFilters: (next: DataFilters) => void
  isAnySelected: boolean

  // Documents (per-document selection on the main target)
  documentMode: DocumentMode
  documentIds: string[]
  setDocumentMode: (mode: DocumentMode) => void
  setDocumentIds: (ids: string[]) => void

  // ── Per-consumer accessors — the real consumers read these; the IPS tab uses
  //    the *For setters to edit ONLY the 'ips' profile, decoupled from the panel.
  getProfile: (consumer: DataConsumer) => ConsumerProfile
  setSelectionFor: (consumer: DataConsumer, next: DataSelection) => void
  updateSelectionFor: (consumer: DataConsumer, dataType: DataType, value: boolean) => void
  setFiltersFor: (consumer: DataConsumer, next: DataFilters) => void
  setDocumentModeFor: (consumer: DataConsumer, mode: DocumentMode) => void
  setDocumentIdsFor: (consumer: DataConsumer, ids: string[]) => void
  resetProfileFor: (consumer: DataConsumer) => void
  selectAllDataFor: (consumer: DataConsumer) => void
}

const DataSelectionContext = createContext<DataSelectionContextValue | null>(null)

const storage = new StorageService('localStorage')

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object'
}

function isPresetId(x: unknown): x is PresetId {
  return x === 'newPatient' || x === 'followUp' || x === 'custom'
}

function isBuiltInPresetId(x: PresetId): x is BuiltInPresetId {
  return x === 'newPatient' || x === 'followUp'
}

function cloneTemplate(template: DataSelectionTemplate): DataSelectionTemplate {
  return {
    selection: { ...template.selection },
    filters: { ...template.filters },
  }
}

function makeDefaultProfile(defaultFilters: DataFilters = DEFAULT_DATA_FILTERS): ConsumerProfile {
  return {
    selection: { ...DEFAULT_DATA_SELECTION },
    filters: { ...defaultFilters },
    // Default is the last three admissions, not one: a 初診 overview needs the
    // previous stay's diagnoses as much as the latest, and the drawer label
    // (最近三次住院) states exactly what the AI receives.
    documentMode: DEFAULT_DOCUMENT_MODE,
    documentIds: [],
  }
}

// Migrate the two legacy lab filters (labReportVersion + labTrendPoints) into the
// merged single `labDepth` key. Returns the migrated depth, or undefined when the
// stored filters already use labDepth (or carry neither legacy key) — in which case
// the caller keeps whatever is already there / the seeded default.
//   latest          → 'latest' (每項目 1 筆)
//   latestPerAnalyte → '3'      (IPS 每項目 3 筆)
//   all / other      → 舊 labTrendPoints ('8'/'16');'4' 併入最接近的 '3';無則 '8'
function migrateLabDepth(rawFilters: Record<string, unknown>): string | undefined {
  if (rawFilters.labDepth !== undefined) return undefined
  if (!('labReportVersion' in rawFilters) && !('labTrendPoints' in rawFilters)) return undefined
  const version = rawFilters.labReportVersion
  if (version === 'latest') return 'latest'
  if (version === 'latestPerAnalyte') return '3'
  const tp = String(rawFilters.labTrendPoints ?? '')
  if (tp === '8' || tp === '16') return tp
  if (tp === '4') return '3'
  return '8'
}

function coerceTemplate(saved: Partial<DataSelectionTemplate> | null | undefined): DataSelectionTemplate {
  const base = cloneTemplate(CUSTOM_TEMPLATE_DEFAULT)
  if (!saved) return base
  return {
    selection: { ...base.selection, ...(isObject(saved.selection) ? saved.selection : {}) } as DataSelection,
    filters: { ...base.filters, ...(isObject(saved.filters) ? saved.filters : {}) } as DataFilters,
  }
}

// Exported for testing: merges a (possibly stale / partial) stored profile over
// the current defaults without discarding the user's existing choices.
// `defaultFilters` lets a consumer seed different factory filters (IPS 匯出用
// IPS_DEFAULT_DATA_FILTERS — labDepth:'3');已存檔的使用者選擇一律優先於預設值。
export function coerceProfile(
  saved: Partial<ConsumerProfile> | undefined,
  defaultFilters: DataFilters = DEFAULT_DATA_FILTERS,
): ConsumerProfile {
  const base = makeDefaultProfile(defaultFilters)
  if (!saved) return base
  const mode = saved.documentMode
  // MERGE over defaults — a newly-added schema key gets its default while the
  // user's existing choices are preserved. (Previously a single missing key
  // discarded the whole selection/filters → every toggle silently reset to
  // default after any schema change.)
  const selection = { ...DEFAULT_DATA_SELECTION, ...(isObject(saved.selection) ? saved.selection : {}) } as DataSelection
  // Migrate the legacy labReportVersion + labTrendPoints pair into the merged
  // `labDepth` key before merging over defaults, then strip the old keys so a
  // migrated profile carries only labDepth.
  const rawFilters = isObject(saved.filters) ? saved.filters : {}
  const migratedDepth = migrateLabDepth(rawFilters)
  const merged: Record<string, unknown> = {
    ...defaultFilters,
    ...rawFilters,
    ...(migratedDepth ? { labDepth: migratedDepth } : {}),
  }
  delete merged.labReportVersion
  delete merged.labTrendPoints
  const filters = merged as unknown as DataFilters
  return {
    selection,
    filters,
    // activePreset/presetMemory are no longer stored — the active-template
    // highlight is derived live from selection/filters. Any such keys on an old
    // stored profile are simply ignored here. Legacy supplementaryNotes and
    // editedClinicalContext keys are also intentionally dropped.
    documentMode: mode === 'all' || mode === 'custom' || mode === 'latestAdmission' || mode === 'recentAdmissions' ? mode : DEFAULT_DOCUMENT_MODE,
    documentIds: Array.isArray(saved.documentIds) ? saved.documentIds.filter((x): x is string => typeof x === 'string') : [],
  }
}

type ProfilesState = Record<DataConsumer, ConsumerProfile>

function getInitialProfiles(): ProfilesState {
  const saved = storage.get<Partial<Record<DataConsumer, Partial<ConsumerProfile>>>>(STORAGE_KEYS.DATA_PROFILES)
  return {
    chat: coerceProfile(saved?.chat),
    insights: coerceProfile(saved?.insights),
    nhiLipid: coerceProfile(saved?.nhiLipid),
    ips: coerceProfile(saved?.ips, IPS_DEFAULT_DATA_FILTERS),
    aiExport: coerceProfile(saved?.aiExport),
  }
}

function getInitialCustomTemplate(): DataSelectionTemplate {
  return coerceTemplate(storage.get<Partial<DataSelectionTemplate>>(STORAGE_KEYS.DATA_CUSTOM_PRESET))
}

function getInitialActivePreset(): PresetId {
  const saved = storage.get<unknown>(STORAGE_KEYS.DATA_ACTIVE_PRESET)
  if (isPresetId(saved)) return saved
  const profiles = getInitialProfiles()
  return resolveActivePreset(profiles.chat.selection, profiles.chat.filters)
}

export function DataSelectionProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<ProfilesState>(getInitialProfiles)
  const [activePreset, setActivePreset] = useState<PresetId>(getInitialActivePreset)
  const [customTemplate, setCustomTemplate] = useState<DataSelectionTemplate>(getInitialCustomTemplate)

  useEffect(() => {
    storage.set(STORAGE_KEYS.DATA_PROFILES, profiles)
  }, [profiles])

  useEffect(() => {
    storage.set(STORAGE_KEYS.DATA_ACTIVE_PRESET, activePreset)
  }, [activePreset])

  useEffect(() => {
    storage.set(STORAGE_KEYS.DATA_CUSTOM_PRESET, customTemplate)
  }, [customTemplate])

  const patchProfile = useCallback(
    (consumer: DataConsumer, patch: Partial<ConsumerProfile>) => {
      setProfiles((prev) => ({ ...prev, [consumer]: { ...prev[consumer], ...patch } }))
    },
    [],
  )

  // Patch the MAIN target (chat + insights) together. The patch may be a value or
  // a per-consumer fn (so a template load can read each profile's own state).
  const patchTargets = useCallback(
    (patch: Partial<ConsumerProfile> | ((p: ConsumerProfile) => Partial<ConsumerProfile>)) => {
      setProfiles((prev) => {
        const out = { ...prev }
        for (const c of MAIN_TARGETS) {
          out[c] = { ...prev[c], ...(typeof patch === 'function' ? patch(prev[c]) : patch) }
        }
        return out
      })
    },
    [],
  )

  // The panel displays the 對話 profile as the shared base (chat === insights,
  // since both are always edited together).
  const current = profiles.chat

  const setSelectedData = useCallback(
    (next: DataSelection) => {
      patchTargets({ selection: next })
      if (activePreset === 'custom') {
        setCustomTemplate((prev) => ({ ...prev, selection: { ...next } }))
      }
    },
    [activePreset, patchTargets],
  )

  const updateSelection = useCallback(
    (dataType: DataType, isSelected: boolean) => {
      patchTargets((p) => ({ selection: { ...p.selection, [dataType]: isSelected } }))
      if (activePreset === 'custom') {
        setCustomTemplate((prev) => ({ ...prev, selection: { ...prev.selection, [dataType]: isSelected } }))
      }
    },
    [activePreset, patchTargets],
  )

  const setFilters = useCallback(
    (next: DataFilters) => {
      patchTargets({ filters: next })
      if (activePreset === 'custom') {
        setCustomTemplate((prev) => ({ ...prev, filters: { ...next } }))
      }
    },
    [activePreset, patchTargets],
  )

  const templateForPreset = useCallback(
    (presetId: PresetId): DataSelectionTemplate =>
      isBuiltInPresetId(presetId)
        ? DATA_SELECTION_PRESETS[presetId]
        : customTemplate,
    [customTemplate],
  )

  // Reset the currently selected template mode back to its factory baseline.
  const resetToDefaults = useCallback(() => {
    const template = activePreset === 'custom'
      ? CUSTOM_TEMPLATE_DEFAULT
      : DATA_SELECTION_PRESETS[activePreset]

    if (activePreset === 'custom') {
      setCustomTemplate(cloneTemplate(CUSTOM_TEMPLATE_DEFAULT))
    }

    patchTargets({
      selection: { ...template.selection },
      filters: { ...template.filters },
    })
  }, [activePreset, patchTargets])

  // Apply a template (one-tap fill): load the preset's factory selection+filters
  // as a starting point. `documents` is sticky, so the user's picked documents
  // survive switching between 初診 / 追蹤 / 自訂.
  const applyPreset = useCallback(
    (presetId: PresetId) => {
      const template = templateForPreset(presetId)
      setActivePreset(presetId)
      patchTargets((cur) => ({
        selection: { ...template.selection, documents: cur.selection.documents },
        filters: { ...template.filters },
      }))
    },
    [patchTargets, templateForPreset],
  )

  // Include everything: all categories on, all-time windows, all documents.
  // Documents switch to 'all' mode (not the sticky latestAdmission) so 全選
  // really means every discharge summary too. Mirrors into the custom template
  // when that's the active slot, like the other bulk edits.
  const selectAllData = useCallback(() => {
    patchTargets({
      selection: { ...ALL_DATA_SELECTION },
      filters: { ...ALL_DATA_FILTERS },
      documentMode: 'all',
    })
    if (activePreset === 'custom') {
      setCustomTemplate({
        selection: { ...ALL_DATA_SELECTION },
        filters: { ...ALL_DATA_FILTERS },
      })
    }
  }, [activePreset, patchTargets])

  const setDocumentMode = useCallback(
    (mode: DocumentMode) => patchTargets({ documentMode: mode }),
    [patchTargets],
  )

  const setDocumentIds = useCallback(
    (ids: string[]) => patchTargets({ documentIds: ids }),
    [patchTargets],
  )

  // Per-consumer editing — used by the IPS tab to edit ONLY the 'ips' profile,
  // independent of the panel (which drives chat + insights).
  const updateSelectionFor = useCallback(
    (consumer: DataConsumer, dataType: DataType, value: boolean) =>
      setProfiles((prev) => ({
        ...prev,
        [consumer]: { ...prev[consumer], selection: { ...prev[consumer].selection, [dataType]: value } },
      })),
    [],
  )

  const setFiltersFor = useCallback(
    (consumer: DataConsumer, next: DataFilters) => patchProfile(consumer, { filters: next }),
    [patchProfile],
  )

  const setSelectionFor = useCallback(
    (consumer: DataConsumer, next: DataSelection) => patchProfile(consumer, { selection: { ...next } }),
    [patchProfile],
  )

  const setDocumentModeFor = useCallback(
    (consumer: DataConsumer, mode: DocumentMode) => patchProfile(consumer, { documentMode: mode }),
    [patchProfile],
  )

  const setDocumentIdsFor = useCallback(
    (consumer: DataConsumer, ids: string[]) => patchProfile(consumer, { documentIds: [...ids] }),
    [patchProfile],
  )

  const resetProfileFor = useCallback(
    (consumer: DataConsumer) => patchProfile(
      consumer,
      makeDefaultProfile(consumer === 'ips' ? IPS_DEFAULT_DATA_FILTERS : DEFAULT_DATA_FILTERS),
    ),
    [patchProfile],
  )

  const selectAllDataFor = useCallback(
    (consumer: DataConsumer) => patchProfile(consumer, {
      selection: { ...ALL_DATA_SELECTION },
      filters: { ...ALL_DATA_FILTERS },
      documentMode: 'all',
      documentIds: [],
    }),
    [patchProfile],
  )

  const getProfile = useCallback((consumer: DataConsumer): ConsumerProfile => profiles[consumer], [profiles])

  const value = useMemo<DataSelectionContextValue>(
    () => ({
      selectedData: current.selection,
      setSelectedData,
      updateSelection,
      resetToDefaults,
      applyPreset,
      selectAllData,
      activePreset,
      filters: current.filters,
      setFilters,
      isAnySelected: Object.values(current.selection).some(Boolean),
      documentMode: current.documentMode,
      documentIds: current.documentIds,
      setDocumentMode,
      setDocumentIds,
      getProfile,
      setSelectionFor,
      updateSelectionFor,
      setFiltersFor,
      setDocumentModeFor,
      setDocumentIdsFor,
      resetProfileFor,
      selectAllDataFor,
    }),
    [
      current, setSelectedData, updateSelection, resetToDefaults, applyPreset, selectAllData, activePreset,
      setFilters, setDocumentMode, setDocumentIds, getProfile, setSelectionFor, updateSelectionFor, setFiltersFor,
      setDocumentModeFor, setDocumentIdsFor, resetProfileFor, selectAllDataFor,
    ],
  )

  return <DataSelectionContext.Provider value={value}>{children}</DataSelectionContext.Provider>
}

export function useDataSelection() {
  const context = useContext(DataSelectionContext)
  if (!context) {
    throw new Error('useDataSelection must be used within DataSelectionProvider')
  }
  return context
}
