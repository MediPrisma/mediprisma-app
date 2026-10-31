import {
  isCustomSummaryEditorTourStep,
  isCustomSummaryGalleryTourStep,
  isCustomSummaryTourStep,
  useRightFeatureTourStore,
} from '@/features/right-feature-tour/right-feature-tour.store'

describe('right panel tour channel', () => {
  it('opens the custom view for every custom step and the editor only for its fields', () => {
    for (const step of ['custom-summary', 'custom-summary-edit', 'custom-summary-generate', 'custom-summary-read-result'] as const) {
      expect(isCustomSummaryTourStep(step)).toBe(true)
      expect(isCustomSummaryEditorTourStep(step)).toBe(false)
    }
    for (const step of ['custom-summary-fields', 'custom-summary-prompt', 'custom-summary-behavior', 'custom-summary-library'] as const) {
      expect(isCustomSummaryTourStep(step)).toBe(true)
      expect(isCustomSummaryEditorTourStep(step)).toBe(true)
    }
    for (const step of [null, 'summary-settings', 'chat', 'finish'] as const) {
      expect(isCustomSummaryTourStep(step)).toBe(false)
      expect(isCustomSummaryEditorTourStep(step)).toBe(false)
    }
  })

  beforeEach(() => {
    useRightFeatureTourStore.setState({
      active: false,
      stepId: null,
      session: 0,
      kind: 'scene',
      launcherOpen: false,
    })
  })

  it('shows a scene without starting a tour session', () => {
    useRightFeatureTourStore.getState().showScene('chat-compose')
    expect(useRightFeatureTourStore.getState()).toMatchObject({
      active: true,
      kind: 'scene',
      stepId: 'chat-compose',
      session: 0,
    })

    useRightFeatureTourStore.getState().stop()
    expect(useRightFeatureTourStore.getState()).toMatchObject({
      active: false,
      stepId: null,
    })
  })

  it('opens a chapter catalogue without navigating and starts the selected chapter', () => {
    useRightFeatureTourStore.getState().openCustomSummaryGuide()
    expect(useRightFeatureTourStore.getState()).toMatchObject({ active: false, launcherOpen: true, stepId: null })
    useRightFeatureTourStore.getState().startCustomSummary('custom-summary-library')
    expect(useRightFeatureTourStore.getState()).toMatchObject({
      active: true, launcherOpen: false, kind: 'custom-summary', stepId: 'custom-summary-library', session: 1,
    })
    useRightFeatureTourStore.getState().stop()
    useRightFeatureTourStore.getState().showScene('summary')
    expect(useRightFeatureTourStore.getState()).toMatchObject({ kind: 'scene', stepId: 'summary', session: 1 })
  })

  it('cancels the catalogue without starting a tour', () => {
    useRightFeatureTourStore.getState().openCustomSummaryGuide()
    useRightFeatureTourStore.getState().closeLauncher()
    expect(useRightFeatureTourStore.getState()).toMatchObject({ active: false, launcherOpen: false, session: 0 })
  })

  it('keeps the manager behind gallery steps but closes it before generating', () => {
    for (const step of ['custom-summary-gallery', 'custom-summary-gallery-search', 'custom-summary-gallery-preview'] as const) {
      expect(isCustomSummaryGalleryTourStep(step)).toBe(true)
      expect(isCustomSummaryEditorTourStep(step)).toBe(true)
    }
    expect(isCustomSummaryGalleryTourStep('custom-summary-library')).toBe(false)
    expect(isCustomSummaryEditorTourStep('custom-summary-finish')).toBe(false)
  })
})
