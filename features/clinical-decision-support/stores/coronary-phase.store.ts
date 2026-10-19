/**
 * The clinician's CAD DP-01 answer — which phase the patient is in — for the
 * chart in front of them.
 *
 * One answer per chart, kept as the AF answers are: encrypted under this tab's
 * session key so a reload keeps it, and carried into the next visit by a saved
 * record. The pack ages it itself (an 「ACS 1 年內」 given 14 months ago reads
 * as chronic), so the store keeps exactly what was pressed and when.
 */
import { create } from 'zustand'
import { createHydrationGuard } from '@/src/application/services/encrypted-answer-cache.service'
import { patientAnswerBacking } from './patient-answer-backing'
import type { CdssPatientProfile } from '../types'

export type CoronaryPhaseAnswer = NonNullable<CdssPatientProfile['coronaryPhaseAnswer']>

const PHASES: ReadonlySet<string> = new Set(['acs-recent', 'pci-recent', 'chronic-mi', 'chronic-stable', 'unsure'])

/** Only a known phase with a calendar answer day survives a read; anything else is 「沒答」. */
export function toCoronaryPhaseAnswer(parsed: unknown): CoronaryPhaseAnswer | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const { phase, answeredOn, eventMonth } = parsed as Record<string, unknown>
  if (typeof phase !== 'string' || !PHASES.has(phase)) return undefined
  if (typeof answeredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(answeredOn)) return undefined
  return {
    phase: phase as CoronaryPhaseAnswer['phase'],
    answeredOn,
    ...(typeof eventMonth === 'string' && /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(eventMonth) ? { eventMonth } : {}),
  }
}

function writeStored(patientId: string, answer: CoronaryPhaseAnswer | undefined): void {
  if (!answer) patientAnswerBacking().discard('coronary-phase', patientId)
  else patientAnswerBacking().save('coronary-phase', patientId, answer)
}

const hydration = createHydrationGuard()

interface State {
  patientId?: string
  answer?: CoronaryPhaseAnswer
  /** The chart whose stored answer has been read back. */
  hydratedPatientId?: string
  setPatient: (patientId: string | undefined) => void
  setAnswer: (patientId: string, answer: CoronaryPhaseAnswer | undefined) => void
  /** 「恢復本頁預設」: the answer goes, and so does its sealed copy. */
  clear: (patientId: string) => void
}

export const useCoronaryPhaseStore = create<State>((set, get) => ({
  setPatient: (patientId) => {
    const current = get()
    if (current.patientId === patientId && (!patientId || current.hydratedPatientId === patientId || hydration.isPending(patientId))) return
    const kept = current.patientId === patientId ? current.answer : undefined
    if (!patientId || !patientAnswerBacking().has('coronary-phase', patientId)) {
      set({ patientId, answer: kept, hydratedPatientId: patientId })
      return
    }
    set({ patientId, answer: kept, hydratedPatientId: undefined })
    const settle = hydration.begin(patientId)
    const apply = (stored: CoronaryPhaseAnswer | undefined) => {
      if (!settle()) return
      set((state) => {
        if (state.patientId !== patientId) return state
        // An answer given while the read was in flight is newer than storage.
        if (state.answer) {
          writeStored(patientId, state.answer)
          return { hydratedPatientId: patientId }
        }
        return { answer: stored, hydratedPatientId: patientId }
      })
    }
    void patientAnswerBacking().load('coronary-phase', patientId)
      .then((stored) => apply(toCoronaryPhaseAnswer(stored)))
      .catch(() => apply(undefined))
  },
  setAnswer: (patientId, answer) =>
    set((state) => {
      if (state.hydratedPatientId === patientId) writeStored(patientId, answer)
      return { patientId, answer }
    }),
  clear: (patientId) => {
    if (!patientId) return
    patientAnswerBacking().discard('coronary-phase', patientId)
    if (hydration.isPending(patientId)) hydration.invalidate()
    set((state) => (state.patientId === patientId ? { answer: undefined, hydratedPatientId: patientId } : state))
  },
}))

export function useCoronaryPhaseAnswer(patientId?: string): CoronaryPhaseAnswer | undefined {
  return useCoronaryPhaseStore((state) => (patientId && state.patientId === patientId ? state.answer : undefined))
}

/** Whether this chart's stored answer has been read back yet. */
export function useCoronaryPhaseHydrated(patientId?: string): boolean {
  return useCoronaryPhaseStore((state) => !patientId || state.hydratedPatientId === patientId)
}
