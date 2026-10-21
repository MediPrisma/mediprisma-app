/**
 * What the physician answered on the AF page, for the chart in front of them.
 *
 * One chart at a time: changing the patient discards the previous patient's
 * answers from memory. Each chart's answers are kept encrypted under this
 * tab's session key, as the heart-failure phenotype answer is, so they survive
 * a reload of this tab — the diagnosis confirmed on DP-01 stands beside the
 * DP-01 decision it was recorded with, instead of the decision surviving and
 * the diagnosis quietly going back to the record's.
 */
import { create } from 'zustand'
import {
  createHydrationGuard,
} from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking, patientAnswerStorageKey } from './patient-answer-backing'
import type { CdssPatientProfile } from '../types'

export type AfAnswers = NonNullable<CdssPatientProfile['afClinicalAnswers']>
const EMPTY: AfAnswers = Object.freeze({})

/** The key one patient's encrypted answers are kept under. */
export function afAnswersStorageKey(patientId: string): string {
  return patientAnswerStorageKey('af-answers', patientId)
}

/** Only true and false survive a read; anything else is 「沒答」. */
function toAfAnswers(parsed: unknown): AfAnswers {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
  const answers: Record<string, boolean> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'boolean') answers[id] = value
  }
  return answers
}

function writeStored(patientId: string, answers: AfAnswers): void {
  if (Object.keys(answers).length === 0) patientAnswerBacking().discard('af-answers', patientId)
  else patientAnswerBacking().save('af-answers', patientId, answers)
}

const hydration = createHydrationGuard()

interface State {
  patientId?: string
  answers: AfAnswers
  /** The chart whose stored answers have been read back. */
  hydratedPatientId?: string
  setPatient: (patientId: string | undefined) => void
  answer: (patientId: string, id: string, value: boolean | undefined) => void
  /**
   * 「恢復本頁預設」: this chart's answers go, and so does their sealed copy —
   * else DP-01's 「AFL（醫師確認）」 outlives the reset and a reload brings it
   * back (#177 review).
   */
  clear: (patientId: string) => void
}

export const useAfAnswersStore = create<State>((set, get) => ({
  answers: EMPTY,
  setPatient: (patientId) => {
    const current = get()
    if (current.patientId === patientId && (!patientId || current.hydratedPatientId === patientId || hydration.isPending(patientId))) return
    // This chart's answers already in memory are this session's own and stay.
    const kept = current.patientId === patientId ? current.answers : EMPTY
    // A chart with nothing stored is read in the same tick: a first visit
    // never waits on a decryption with nothing to decrypt.
    if (!patientId || !patientAnswerBacking().has('af-answers', patientId)) {
      set({ patientId, answers: kept, hydratedPatientId: patientId })
      return
    }
    set({ patientId, answers: kept, hydratedPatientId: undefined })
    const settle = hydration.begin(patientId)
    const apply = (stored: AfAnswers) => {
      if (!settle()) return
      set((state) => {
        if (state.patientId !== patientId) return state
        // An answer given while the read was in flight is newer than storage.
        const merged = { ...stored, ...state.answers }
        if (Object.keys(state.answers).length > 0) writeStored(patientId, merged)
        return { answers: merged, hydratedPatientId: patientId }
      })
    }
    void patientAnswerBacking().load('af-answers', patientId)
      .then((stored) => apply(toAfAnswers(stored)))
      // What cannot be read is a first visit's reading.
      .catch(() => apply(EMPTY))
  },
  answer: (patientId, id, value) =>
    set((state) => {
      const answers: Record<string, boolean | undefined> = { ...(state.patientId === patientId ? state.answers : EMPTY) }
      if (value === undefined) delete answers[id]
      else answers[id] = value
      // Before the stored answers are back, writing now would drop them; the
      // read merges this answer in and writes the whole when it lands.
      if (state.hydratedPatientId === patientId) writeStored(patientId, answers)
      return { patientId, answers }
    }),
  clear: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('af-answers', patientId)
    // A read still in flight would bring the discarded answers back.
    if (hydration.isPending(patientId)) hydration.invalidate()
    set((state) => (state.patientId === patientId ? { answers: EMPTY, hydratedPatientId: patientId } : state))
  },
}))

export function useAfAnswers(patientId?: string): AfAnswers {
  return useAfAnswersStore((state) => (patientId && state.patientId === patientId ? state.answers : EMPTY))
}

/** Whether this chart's stored AF answers have been read back yet. */
export function useAfAnswersHydrated(patientId?: string): boolean {
  return useAfAnswersStore((state) => !patientId || state.hydratedPatientId === patientId)
}
