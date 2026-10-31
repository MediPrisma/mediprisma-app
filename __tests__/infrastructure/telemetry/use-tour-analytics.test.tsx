// Guided-tour analytics — drives the REAL tour stores and asserts what reaches
// the sink. Co-located with the other telemetry suites.
import { render } from '@testing-library/react'
import { act } from 'react'

jest.mock('@/src/shared/config/firebase.config', () => ({ app: undefined }))

jest.mock('@/src/application/telemetry/usage-analytics', () => {
  const actual = jest.requireActual('@/src/application/telemetry/usage-analytics')
  return { ...actual, trackEvent: jest.fn() }
})

import { trackEvent } from '@/src/application/telemetry/usage-analytics'
import { ANALYTICS_TOURS } from '@/src/infrastructure/telemetry/usage-analytics'
import { useTourAnalytics } from '@/src/shared/config/tour-analytics'
import { useGuidedTourStore } from '@/features/guided-tour/guided-tour.store'
import { GUIDED_TOURS } from '@/features/guided-tour/guided-tour.tours'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'

const mockedTrackEvent = trackEvent as jest.MockedFunction<typeof trackEvent>

function Host() {
  useTourAnalytics()
  return null
}

describe('useTourAnalytics', () => {
  beforeEach(() => {
    mockedTrackEvent.mockClear()
    act(() => {
      useGuidedTourStore.setState({ tourId: null, stepId: null, session: 0, lastOutcome: null, hubOpen: false })
      useRightFeatureTourStore.setState({ active: false, stepId: null, session: 0, kind: 'scene', launcherOpen: false })
    })
  })

  it('accepts every tour id as an analytics value', () => {
    for (const tour of GUIDED_TOURS) expect(ANALYTICS_TOURS).toContain(tour.id)
  })

  it('reports a guided tour starting', () => {
    render(<Host />)
    act(() => useGuidedTourStore.getState().start('labs-reports'))
    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent).toHaveBeenCalledWith('tour_start', { tour: 'labs-reports' })
  })

  it('reports "finish" with the last step when the tour is completed', () => {
    render(<Host />)
    act(() => useGuidedTourStore.getState().start('getting-started'))
    act(() => useGuidedTourStore.getState().setStep('hub'))
    mockedTrackEvent.mockClear()

    act(() => useGuidedTourStore.getState().stop('finish'))

    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent).toHaveBeenCalledWith('tour_end', {
      tour: 'getting-started',
      tour_outcome: 'finish',
      step: 'hub',
    })
  })

  it('reports "abandon" with the step the user gave up on', () => {
    render(<Host />)
    act(() => useGuidedTourStore.getState().start('medications'))
    act(() => useGuidedTourStore.getState().setStep('medication-timeline'))
    mockedTrackEvent.mockClear()

    act(() => useGuidedTourStore.getState().stop('abandon'))

    expect(mockedTrackEvent).toHaveBeenCalledWith('tour_end', {
      tour: 'medications',
      tour_outcome: 'abandon',
      step: 'medication-timeline',
    })
  })

  it('ends the running tour as abandoned when another one starts', () => {
    render(<Host />)
    act(() => useGuidedTourStore.getState().start('medications'))
    act(() => useGuidedTourStore.getState().setStep('medication-tabs'))
    mockedTrackEvent.mockClear()

    act(() => useGuidedTourStore.getState().start('labs-reports'))

    expect(mockedTrackEvent.mock.calls).toEqual([
      ['tour_end', { tour: 'medications', tour_outcome: 'abandon', step: 'medication-tabs' }],
      ['tour_start', { tour: 'labs-reports' }],
    ])
  })

  it('reports the custom-summary guide but not the panel scenes', () => {
    render(<Host />)
    act(() => useRightFeatureTourStore.getState().showScene('chat'))
    act(() => useRightFeatureTourStore.getState().stop())
    expect(mockedTrackEvent).not.toHaveBeenCalled()

    act(() => useRightFeatureTourStore.getState().startCustomSummary())
    expect(mockedTrackEvent).toHaveBeenCalledWith('tour_start', { tour: 'custom-summary' })
    act(() => useRightFeatureTourStore.getState().setStep('custom-summary-finish'))
    act(() => useRightFeatureTourStore.getState().stop())
    expect(mockedTrackEvent).toHaveBeenCalledWith('tour_end', {
      tour: 'custom-summary',
      tour_outcome: 'finish',
      step: 'custom-summary-finish',
    })
  })

  it('stops reporting once unmounted', () => {
    const { unmount } = render(<Host />)
    unmount()

    act(() => useGuidedTourStore.getState().start('settings'))
    act(() => useGuidedTourStore.getState().stop('abandon'))
    act(() => useRightFeatureTourStore.getState().startCustomSummary())

    expect(mockedTrackEvent).not.toHaveBeenCalled()
  })
})
