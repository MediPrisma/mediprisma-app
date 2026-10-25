import { create } from 'zustand'
import type { MedicalSummaryResult, SummaryCoverageStats, SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import { resetOnBundleChange } from '@/src/shared/utils/reset-on-bundle-change'
import { useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import { aiResultCacheKey, loadEncryptedCache, saveEncryptedCache } from '@/src/infrastructure/cache/encrypted-session-cache'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { BUNDLE_CHANGE_SETTLED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'

export interface SummaryVersion {
  id: string
  viewKey: string
  runId: string
  slotKey: string
  kind: 'cloud' | 'hospital'
  completedAt: number
  result: MedicalSummaryResult
  coverage: SummaryCoverageStats | null
  catalog: SummarySourceCatalogEntry[]
}

interface SummaryVersionsState {
  epoch: number
  versions: SummaryVersion[]
  selected: Record<string, string>
  running: Record<string, string>
  add: (version: SummaryVersion, epoch: number) => void
  select: (viewKey: string, id: string) => void
  reset: () => void
}

/** Immutable, page-local reading history. Results and their evidence travel
 * together; a new completed result never changes the reader's selection. */
export const useSummaryVersionsStore = create<SummaryVersionsState>((set) => ({
  epoch: 0, versions: [], selected: {}, running: {},
  add: (version, epoch) => set(state => {
    if (state.epoch !== epoch || state.versions.some(v => v.id === version.id)) return state
    return {
      versions: [...state.versions, version],
      selected: state.selected[version.viewKey] ? state.selected : { ...state.selected, [version.viewKey]: version.id },
    }
  }),
  select: (viewKey, id) => set(state => state.versions.some(v => v.viewKey === viewKey && v.id === id)
    ? { selected: { ...state.selected, [viewKey]: id } } : state),
  reset: () => set(state => ({ epoch: state.epoch + 1, versions: [], selected: {}, running: {} })),
}))

resetOnBundleChange(() => useSummaryVersionsStore.getState().reset(), true)
useProgressiveImportStore.subscribe((state, previous) => {
  const current = state.current
  if (current !== previous.current && current && ['cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'].includes(current.phase)) {
    useSummaryVersionsStore.getState().reset()
  }
})

export function summaryVersionViewKey(runId: string, slotKey: string): string {
  // The first three fields are patient, audience and locale. Keep model and
  // input snapshots as version provenance, not as a new reader selection.
  return slotKey ? `${runId}::${slotKey.split('::').slice(0, 3).join('::')}` : ''
}

function persistVersions() {
  const state = useSummaryVersionsStore.getState()
  const importId = LocalBundleService.getActiveImportId()
  if (!importId || !state.versions.length) return
  void saveEncryptedCache(aiResultCacheKey('summary-versions-v1', 'history', importId), {
    versions: state.versions, selected: state.selected,
  }, () => useSummaryVersionsStore.getState().versions === state.versions
    && useSummaryVersionsStore.getState().selected === state.selected
    && LocalBundleService.getActiveImportId() === importId)
}
useSummaryVersionsStore.subscribe(persistVersions)
if (typeof window !== 'undefined') window.addEventListener(BUNDLE_CHANGE_SETTLED_EVENT, persistVersions)

export async function restoreSummaryVersions(runId: string): Promise<void> {
  const importId = LocalBundleService.getActiveImportId()
  const state = useSummaryVersionsStore.getState()
  if (!importId || state.versions.length) return
  const saved = await loadEncryptedCache<Pick<SummaryVersionsState, 'versions' | 'selected'>>(
    aiResultCacheKey('summary-versions-v1', 'history', importId), 12 * 60 * 60 * 1000)
  if (!saved || !Array.isArray(saved.versions) || !saved.selected
    || saved.versions.some(v => v.runId !== runId || !v.result || !Array.isArray(v.catalog))
    || useSummaryVersionsStore.getState().epoch !== state.epoch
    || useSummaryVersionsStore.getState().versions.length
    || LocalBundleService.getActiveImportId() !== importId) return
  useSummaryVersionsStore.setState({ versions: saved.versions, selected: saved.selected })
}
