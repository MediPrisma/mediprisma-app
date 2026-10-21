/**
 * cdss-decision-timing: how long each decision took, from the moment the
 * decision screen appeared for a patient to the moment the decision was
 * recorded.
 *
 * The point of the decision map is follow-up speed, and a speed nobody measures
 * is a speed nobody keeps. This is the measurement, and nothing more: memory
 * only, never persisted, never sent anywhere, gone on reload. It holds no
 * clinical content — a screen key, a decision key and two clocks.
 */
import { create } from 'zustand'

export interface CdssDecisionTiming {
  /** `<patientId>:<packId>` — which screen the decision was taken on. */
  screen: string
  /** The decision's store key (`visit:<decisionId>`, see `visitDecisionKey`). */
  decision: string
  /** Milliseconds from the screen appearing to the decision. */
  elapsedMs: number
  /** Where on the screen it was taken. */
  surface: 'queue' | 'map'
}

interface DecisionTimingState {
  /** When each screen first appeared, as epoch milliseconds. */
  shownAt: Readonly<Record<string, number>>
  timings: readonly CdssDecisionTiming[]
  /** Marks a screen as shown; a no-op when it already was. */
  screenShown: (screen: string, at?: number) => void
  decisionRecorded: (
    screen: string,
    decision: string,
    surface: CdssDecisionTiming['surface'],
    at?: number,
  ) => void
  reset: () => void
}

/** A clock that does not jump when the wall clock is corrected. */
function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export const useCdssDecisionTimingStore = create<DecisionTimingState>()((set) => ({
  shownAt: {},
  timings: [],
  screenShown: (screen, at = monotonicNow()) => set((state) => (
    state.shownAt[screen] !== undefined ? state : { shownAt: { ...state.shownAt, [screen]: at } }
  )),
  decisionRecorded: (screen, decision, surface, at = monotonicNow()) => set((state) => {
    const start = state.shownAt[screen]
    if (start === undefined) return state
    return {
      timings: [...state.timings, { screen, decision, surface, elapsedMs: Math.max(0, Math.round(at - start)) }],
    }
  }),
  reset: () => set({ shownAt: {}, timings: [] }),
}))

/** Every timing this session has recorded, oldest first. */
export function getCdssDecisionTimings(): readonly CdssDecisionTiming[] {
  return useCdssDecisionTimingStore.getState().timings
}
