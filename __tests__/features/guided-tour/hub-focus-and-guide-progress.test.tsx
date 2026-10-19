import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@/src/shared/config/firebase.config', () => ({ app: undefined }))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical', setAudience: jest.fn() }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => ({ user: null }) }))
jest.mock('@/src/application/hooks/use-beta-features.hook', () => ({ useBetaFeatures: () => ({ enabled: false }) }))

import { TourHub } from '@/features/guided-tour/TourHub'
import { TourHubButton } from '@/features/guided-tour/TourHubButton'
import { useGuidedTourStore } from '@/features/guided-tour/guided-tour.store'
import { readTourProgress } from '@/features/guided-tour/guided-tour.progress'
import { RightFeatureTour } from '@/features/right-feature-tour/RightFeatureTour'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  localStorage.clear()
  act(() => {
    useGuidedTourStore.setState({ tourId: null, stepId: null, session: 0, lastOutcome: null, hubOpen: false })
    useRightFeatureTourStore.setState({ active: false, stepId: null, session: 0, kind: 'scene', launcherOpen: false })
  })
})

describe('tour hub focus', () => {
  function openFromHeader() {
    render(<><TourHubButton /><TourHub /></>)
    const entry = screen.getByRole('button', { name: '導覽中心' })
    entry.focus()
    fireEvent.click(entry)
    expect(screen.getByTestId('tour-hub')).toBeTruthy()
    return entry
  }

  it('returns focus to the header entry on Escape', async () => {
    const entry = openFromHeader()
    fireEvent.keyDown(screen.getByTestId('tour-hub'), { key: 'Escape' })
    expect(screen.queryByTestId('tour-hub')).toBeNull()
    // Radix hands focus back a tick after the dialog unmounts.
    await waitFor(() => expect(document.activeElement).toBe(entry))
  })

  it('returns focus to the header entry on Close', async () => {
    const entry = openFromHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('tour-hub')).toBeNull()
    // Radix hands focus back a tick after the dialog unmounts.
    await waitFor(() => expect(document.activeElement).toBe(entry))
  })

  it('leaves focus to the tour it starts', async () => {
    const entry = openFromHeader()
    fireEvent.click(screen.getByTestId('tour-hub').querySelector('[data-tour-hub-item="medications"]')!)
    expect(useGuidedTourStore.getState().tourId).toBe('medications')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.activeElement).not.toBe(entry)
  })
})

describe('custom-summary guide progress', () => {
  function runLastStep() {
    render(<RightFeatureTour />)
    act(() => useRightFeatureTourStore.getState().startCustomSummary('custom-summary-finish'))
  }

  it('ticks the guide in the hub when finished on its last step', () => {
    runLastStep()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(useRightFeatureTourStore.getState().active).toBe(false)
    expect(readTourProgress().completed).toContain('custom-summary')
  })

  it('leaves it unticked when skipped or closed', () => {
    runLastStep()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useRightFeatureTourStore.getState().active).toBe(false)
    expect(readTourProgress().completed).not.toContain('custom-summary')
  })
})
