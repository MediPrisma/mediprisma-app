/**
 * visit-calculator-notes: what the clinician attached from a medical
 * calculator to a decision point on the decision map — MAGGIC's 1-year
 * mortality beside DP-19, say.
 *
 * A note is an annotation, never an input: the pack does not read it and no
 * recommendation changes because of it (owner decision 2026-10-19: 「預後只當
 * 附註就好」). It reaches 今天的計畫 and the text 複製到病歷 copies, and
 * nothing else. Memory only, as the decision timing is: never persisted,
 * never sent anywhere, gone on reload — so no clinical value about a named
 * person sits in this browser's storage.
 */
import { useMemo } from 'react'
import { create } from 'zustand'

export interface VisitCalculatorNote {
  calculatorId: string
  /** The decision point the note sits beside (`DP-19`) and its page (`hf`). */
  dp: string
  source: string
  /** The line as written to the plan: the calculator's name and its result. */
  text: string
  /** When it was attached, as an ISO timestamp. */
  at: string
}

interface VisitCalculatorNotesState {
  /** By screen — `<patientId>:<packId>` — the notes in the order attached. */
  notes: Readonly<Record<string, readonly VisitCalculatorNote[]>>
  /** Attaches a note; one per calculator, so a second replaces the first. */
  attach: (screen: string, note: VisitCalculatorNote) => void
  remove: (screen: string, calculatorId: string) => void
}

export const useVisitCalculatorNotesStore = create<VisitCalculatorNotesState>()((set) => ({
  notes: {},
  attach: (screen, note) => set((state) => ({
    notes: {
      ...state.notes,
      [screen]: [...(state.notes[screen] ?? []).filter((item) => item.calculatorId !== note.calculatorId), note],
    },
  })),
  remove: (screen, calculatorId) => set((state) => ({
    notes: {
      ...state.notes,
      [screen]: (state.notes[screen] ?? []).filter((item) => item.calculatorId !== calculatorId),
    },
  })),
}))

const NO_NOTES: readonly VisitCalculatorNote[] = Object.freeze([])

/** The screen's notes attached on `now`'s local day: the plan is today's. */
export function useVisitCalculatorNotes(screen: string, now: Date): readonly VisitCalculatorNote[] {
  const notes = useVisitCalculatorNotesStore((state) => state.notes[screen] ?? NO_NOTES)
  const day = now.toDateString()
  return useMemo(() => notes.filter((note) => new Date(note.at).toDateString() === day), [day, notes])
}
