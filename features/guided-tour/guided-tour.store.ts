'use client'

import { create } from 'zustand'
import type { GuidedTourId } from './guided-tour.types'

export type TourOutcome = 'finish' | 'abandon'

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
  openHub: () => set({ hubOpen: true }),
  closeHub: () => set({ hubOpen: false }),
}))
