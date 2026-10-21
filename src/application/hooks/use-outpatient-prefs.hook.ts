'use client'

// The current visitor's 門診偏好 — pinned analytes and copy formats — with the
// storage key resolved the same way as the Beta switch: signed-in account,
// then the anonymous session, then one shared guest key. A signed-in account's
// copy is kept in step with the account by outpatient-prefs-sync.ts.

import { useCallback, useMemo } from 'react'
import { useAuth } from '@/src/application/providers/auth.provider'
import {
  EMPTY_OUTPATIENT_PREFS,
  resolveOutpatientPrefsKey,
  useOutpatientPrefsStore,
  type EmrCustomFormat,
  type EmrHandoffMode,
  type MedCopyFormat,
  type OutpatientPrefs,
  type OverviewLabMode,
} from '@/src/application/stores/outpatient-prefs.store'

export interface OutpatientPrefsApi extends OutpatientPrefs {
  setPinnedLabs: (ids: string[] | null) => void
  setLabMode: (mode: OverviewLabMode) => void
  saveFormat: (format: EmrCustomFormat) => void
  deleteFormat: (id: string) => void
  setActiveFormat: (id: string) => void
  setHandoffMode: (mode: EmrHandoffMode) => void
  /** Saves the one 用藥 copy format. */
  saveMedFormat: (format: MedCopyFormat) => void
  /** Back to the default (緊湊) built-in. */
  resetMedFormat: () => void
}

export function useOutpatientPrefs(): OutpatientPrefsApi {
  const { user, anonymousUid } = useAuth()
  const key = resolveOutpatientPrefsKey(user?.uid, anonymousUid)
  const prefs = useOutpatientPrefsStore((state) => state.byUser[key]) ?? EMPTY_OUTPATIENT_PREFS
  const update = useOutpatientPrefsStore((state) => state.update)

  const setPinnedLabs = useCallback((ids: string[] | null) => update(key, { pinnedLabs: ids }), [key, update])
  const setLabMode = useCallback((mode: OverviewLabMode) => update(key, { labMode: mode }), [key, update])
  const setHandoffMode = useCallback((mode: EmrHandoffMode) => update(key, { handoffMode: mode }), [key, update])
  const setActiveFormat = useCallback((id: string) => update(key, { activeFormatId: id }), [key, update])

  const saveFormat = useCallback((format: EmrCustomFormat) => {
    const current = useOutpatientPrefsStore.getState().byUser[key] ?? EMPTY_OUTPATIENT_PREFS
    const exists = current.formats.some((f) => f.id === format.id)
    const formats = exists
      ? current.formats.map((f) => (f.id === format.id ? format : f))
      : [...current.formats, format]
    update(key, { formats, activeFormatId: format.id })
  }, [key, update])

  const deleteFormat = useCallback((id: string) => {
    const current = useOutpatientPrefsStore.getState().byUser[key] ?? EMPTY_OUTPATIENT_PREFS
    const formats = current.formats.filter((f) => f.id !== id)
    update(key, {
      formats,
      activeFormatId: current.activeFormatId === id ? formats[0]?.id ?? null : current.activeFormatId,
    })
  }, [key, update])

  const saveMedFormat = useCallback((format: MedCopyFormat) => update(key, { medFormat: format }), [key, update])
  const resetMedFormat = useCallback(() => update(key, { medFormat: null }), [key, update])

  return useMemo(() => ({
    ...prefs,
    setPinnedLabs,
    setLabMode,
    saveFormat,
    deleteFormat,
    setActiveFormat,
    setHandoffMode,
    saveMedFormat,
    resetMedFormat,
  }), [prefs, setPinnedLabs, setLabMode, saveFormat, deleteFormat, setActiveFormat, setHandoffMode, saveMedFormat, resetMedFormat])
}
