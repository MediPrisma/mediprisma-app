'use client'

import { create } from 'zustand'

export type RightFeatureTourStepId =
  | 'overview'
  | 'summary'
  | 'summary-settings'
  | 'custom-summary'
  | 'custom-summary-edit'
  | 'custom-summary-fields'
  | 'custom-summary-prompt'
  | 'custom-summary-behavior'
  | 'custom-summary-share'
  | 'custom-summary-share-form'
  | 'custom-summary-library'
  | 'custom-summary-gallery'
  | 'custom-summary-gallery-search'
  | 'custom-summary-gallery-preview'
  | 'custom-summary-generate'
  | 'custom-summary-read-result'
  | 'custom-summary-finish'
  | 'chat'
  | 'chat-compose'
  | 'chat-template'
  | 'calculator'
  | 'guidance'
  | 'education'
  | 'export'
  | 'settings'
  | 'finish'

export function isCustomSummaryTourStep(step: RightFeatureTourStepId | null): boolean {
  return step?.startsWith('custom-summary') ?? false
}

export function isCustomSummaryEditorTourStep(step: RightFeatureTourStepId | null): boolean {
  return step === 'custom-summary-fields'
    || step === 'custom-summary-prompt'
    || step === 'custom-summary-behavior'
    || step === 'custom-summary-library'
    || step === 'custom-summary-share'
    || step === 'custom-summary-share-form'
    || isCustomSummaryGalleryTourStep(step)
}

export function isCustomSummaryGalleryTourStep(step: RightFeatureTourStepId | null): boolean {
  return step === 'custom-summary-gallery'
    || step === 'custom-summary-gallery-search'
    || step === 'custom-summary-gallery-preview'
}

export const CUSTOM_SUMMARY_CHAPTERS = [
  { step: 'custom-summary', zh: '從頭開始', en: 'Start from the beginning' },
  { step: 'custom-summary-edit', zh: '編輯', en: 'Edit' },
  { step: 'custom-summary-behavior', zh: '啟用與自動產生', en: 'Enable and auto-generate' },
  { step: 'custom-summary-share', zh: '分享模板', en: 'Share a template' },
  { step: 'custom-summary-library', zh: '逛範本庫', en: 'Explore the library' },
  { step: 'custom-summary-generate', zh: '產生與閱讀結果', en: 'Generate and read results' },
] as const

export type CustomSummaryChapter = typeof CUSTOM_SUMMARY_CHAPTERS[number]['step']

/**
 * The right panel's tour channel, and the custom-summary guide's own state.
 * `scene`: the guided-tour engine shows a step id and the right panel opens
 * the matching feature. `custom-summary`: the chaptered guide is running and
 * drives the summary editor's preview itself.
 */
interface RightFeatureTourState {
  active: boolean
  stepId: RightFeatureTourStepId | null
  session: number
  kind: 'scene' | 'custom-summary'
  launcherOpen: boolean
  showScene: (stepId: RightFeatureTourStepId) => void
  openCustomSummaryGuide: () => void
  closeLauncher: () => void
  startCustomSummary: (chapter?: CustomSummaryChapter) => void
  setStep: (stepId: RightFeatureTourStepId) => void
  stop: () => void
}

export const useRightFeatureTourStore = create<RightFeatureTourState>((set) => ({
  active: false,
  stepId: null,
  session: 0,
  kind: 'scene',
  launcherOpen: false,
  showScene: (stepId) => set({ active: true, kind: 'scene', stepId, launcherOpen: false }),
  openCustomSummaryGuide: () => set({ launcherOpen: true, active: false, stepId: null }),
  closeLauncher: () => set({ launcherOpen: false }),
  startCustomSummary: (chapter = 'custom-summary') => set((state) => ({
    active: true,
    launcherOpen: false,
    kind: 'custom-summary',
    stepId: chapter,
    session: state.session + 1,
  })),
  setStep: (stepId) => set({ stepId }),
  stop: () => set({ active: false, stepId: null }),
}))
