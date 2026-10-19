import {
  LEFT_BROWSER_TOUR_STORAGE_KEY,
  hasSeenLeftBrowserTour,
  useLeftBrowserTourStore,
} from '@/features/left-browser-tour/left-browser-tour.store'

describe('left panel tour channel', () => {
  beforeEach(() => {
    localStorage.clear()
    useLeftBrowserTourStore.setState({ active: false, stepId: null })
  })

  it('shows a scene and gives the panel back on stop', () => {
    useLeftBrowserTourStore.getState().showScene('patient-overview')
    expect(useLeftBrowserTourStore.getState()).toMatchObject({ active: true, stepId: 'patient-overview' })

    useLeftBrowserTourStore.getState().showScene('documents')
    expect(useLeftBrowserTourStore.getState().stepId).toBe('documents')

    useLeftBrowserTourStore.getState().stop()
    expect(useLeftBrowserTourStore.getState()).toMatchObject({ active: false, stepId: null })
  })

  it('still reads whether this browser ran the previous left tour', () => {
    expect(hasSeenLeftBrowserTour()).toBe(false)
    localStorage.setItem(LEFT_BROWSER_TOUR_STORAGE_KEY, '1')
    expect(hasSeenLeftBrowserTour()).toBe(true)
  })
})
