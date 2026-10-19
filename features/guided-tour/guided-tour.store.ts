'use client'

import { create } from 'zustand'
import type { GuidedTourId } from './guided-tour.types'

export type TourOutcome = 'finish' | 'abandon'

// Where focus was when the hub opened, read when it closes. Captured in the
// action itself: by the time any effect runs, the dialog has taken focus.
let hubOpener: HTMLElement | null = null
export function takeHubOpener(): HTMLElement | null {
  const opener = hubOpener
  hubOpener = null
  return opener
}

interface GuidedTourState {
  /** The running tour, or null. */
  tourId: GuidedTourId | null
  stepId: string | null
  /** Bumped on every start, so a restart of the same tour is a new run. */
  session: number
  /** How the most recent run ended; read when `tourId` turns null. */
  lastOutcome: TourOutcome | null
  hubOpen: boolean
  start: (tourId: GuidedTourId, stepId?: string) => void
  setStep: (stepId: string) => void
  stop: (outcome: TourOutcome) => void
  openHub: () => void
  closeHub: () => void
}

export const useGuidedTourStore = create<GuidedTourState>((set) => ({
  tourId: null,
  stepId: null,
  session: 0,
  lastOutcome: null,
  hubOpen: false,
  start: (tourId, stepId) => set((state) => ({
    tourId,
    stepId: stepId ?? null,
    session: state.session + 1,
    lastOutcome: null,
    hubOpen: false,
  })),
  setStep: (stepId) => set({ stepId }),
  stop: (outcome) => set({ tourId: null, stepId: null, lastOutcome: outcome }),
  openHub: () => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement
      hubOpener = active instanceof HTMLElement && active !== document.body ? active : null
    }
    set({ hubOpen: true })
  },
  closeHub: () => set({ hubOpen: false }),
}))
