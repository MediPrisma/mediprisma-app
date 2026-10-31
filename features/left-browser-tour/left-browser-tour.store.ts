'use client'

import { create } from 'zustand'

export const LEFT_BROWSER_TOUR_STORAGE_KEY = 'medical-note-left-browser-tour-v1'

export type LeftBrowserTourStepId =
  | 'overview'
  | 'patient-overview'
  | 'patient-info'
  | 'visits'
  | 'reports'
  | 'trend'
  | 'imaging-ai'
  | 'medications'
  | 'medication-timeline'
  | 'right-pane'
  | 'documents'
  | 'finish'

/**
 * The left panel's tour channel. The guided-tour engine sets a scene (a step
 * id above) and the left-panel cards respond: open the tab, switch the report
 * view, dock the medication timeline. Inactive means the reader's own layout,
 * which the panels restore when a scene ends.
 */
interface LeftBrowserTourState {
  active: boolean
  stepId: LeftBrowserTourStepId | null
  showScene: (stepId: LeftBrowserTourStepId) => void
  stop: () => void
}

export const useLeftBrowserTourStore = create<LeftBrowserTourState>((set) => ({
  active: false,
  stepId: null,
  showScene: (stepId) => set({ active: true, stepId }),
  stop: () => set({ active: false, stepId: null }),
}))

/** Whether this browser ran the previous, left-panel tour. */
export function hasSeenLeftBrowserTour(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(LEFT_BROWSER_TOUR_STORAGE_KEY) === '1'
  } catch {
    // Storage being unavailable must not trap the user in a recurring tour.
    return true
  }
}
