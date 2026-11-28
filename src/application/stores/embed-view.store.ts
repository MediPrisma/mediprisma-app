// What the page framing this app (the 門診 AI 助理) asked it to show, and what
// it shows now (features/import-bundle/services/embedded-import.ts).
//
// `compact` is the frame's 精簡 mode: the page draws the patient and its own
// tabs around the frame, so this app leaves out its brand, its patient line,
// its 臨床摘要／功能 switch and its clinical tab row. Only an allowlisted
// parent's message turns it on; it lasts for the frame's life, never persisted.
//
// The left panel owns its tab; the page asks for one through `requestLeftTab`
// (the same shape as resource navigation) and the panel says which tab is
// open and which are listed for this patient, so the frame can answer and
// report the page it shows. Session-only state.
import { create } from 'zustand'

interface EmbedViewState {
  compact: boolean
  setCompact: (compact: boolean) => void
  /** A clinical tab asked for from outside the left panel; `seq` re-fires it. */
  leftRequest: { tab: string; seq: number } | null
  requestLeftTab: (tab: string) => void
  /** Written by the left panel. */
  leftTab: string | null
  listedLeftTabs: readonly string[]
  setLeftTabs: (leftTab: string, listed: readonly string[]) => void
  /** Written by the right panel: its open tab and the tabs it has now. */
  rightTab: string | null
  listedRightTabs: readonly string[]
  setRightTabs: (rightTab: string, listed: readonly string[]) => void
  /** The phone layout's visible panel, and whether a record detail (a visit,
   *  a trend) is drawn over the right panel; written by the page. */
  panel: 'left' | 'right'
  setPanel: (panel: 'left' | 'right') => void
  detailOpen: boolean
  setDetailOpen: (detailOpen: boolean) => void
}

export const useEmbedViewStore = create<EmbedViewState>((set) => ({
  compact: false,
  setCompact: (compact) => set({ compact }),
  leftRequest: null,
  requestLeftTab: (tab) => set((state) => ({ leftRequest: { tab, seq: (state.leftRequest?.seq ?? 0) + 1 } })),
  leftTab: null,
  listedLeftTabs: [],
  setLeftTabs: (leftTab, listed) => set((state) => (
    state.leftTab === leftTab && state.listedLeftTabs.join() === listed.join()
      ? state
      : { leftTab, listedLeftTabs: listed }
  )),
  rightTab: null,
  listedRightTabs: [],
  setRightTabs: (rightTab, listed) => set((state) => (
    state.rightTab === rightTab && state.listedRightTabs.join() === listed.join()
      ? state
      : { rightTab, listedRightTabs: listed }
  )),
  panel: 'left',
  setPanel: (panel) => set({ panel }),
  detailOpen: false,
  setDetailOpen: (detailOpen) => set({ detailOpen }),
}))
