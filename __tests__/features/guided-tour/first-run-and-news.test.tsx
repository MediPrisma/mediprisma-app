import { act, fireEvent, render, screen } from '@testing-library/react'

jest.mock('@/src/shared/config/firebase.config', () => ({ app: undefined }))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => ({ user: null }) }))
jest.mock('@/src/application/hooks/use-beta-features.hook', () => ({ useBetaFeatures: () => ({ enabled: false }) }))

import { FirstRunTourOffer } from '@/features/guided-tour/FirstRunTourOffer'
import { WhatsNewHint } from '@/features/guided-tour/WhatsNewHint'
import { useGuidedTourStore } from '@/features/guided-tour/guided-tour.store'
import { readTourProgress } from '@/features/guided-tour/guided-tour.progress'
import { WHATS_NEW } from '@/features/guided-tour/guided-tour.news'
import { LEFT_BROWSER_TOUR_STORAGE_KEY } from '@/features/left-browser-tour/left-browser-tour.store'

describe('first-run offer and announcements', () => {
  beforeAll(() => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10, left: 900, right: 980, bottom: 46, width: 80, height: 36, x: 900, y: 10, toJSON: () => ({}),
    } as DOMRect)
  })

  beforeEach(() => {
    jest.useFakeTimers()
    localStorage.clear()
    act(() => useGuidedTourStore.setState({ tourId: null, stepId: null, session: 0, lastOutcome: null, hubOpen: false }))
  })

  afterEach(() => jest.useRealTimers())

  it('offers getting started once and starts it', () => {
    const { unmount } = render(<FirstRunTourOffer eligible />)
    act(() => { jest.advanceTimersByTime(10) })

    expect(screen.getByText('用 1 分鐘走一遍核心流程')).toBeTruthy()
    expect(readTourProgress()).toMatchObject({ offered: true })
    // A new reader has nothing to catch up on.
    expect(readTourProgress().seenNews).toEqual(WHATS_NEW.map((item) => item.id))

    fireEvent.click(screen.getByRole('button', { name: /開始（約 1 分鐘）/ }))
    expect(useGuidedTourStore.getState().tourId).toBe('getting-started')
    unmount()

    render(<FirstRunTourOffer eligible />)
    act(() => { jest.advanceTimersByTime(10) })
    expect(screen.queryByText('用 1 分鐘走一遍核心流程')).toBeNull()
  })

  it('waits until the reader is eligible', () => {
    render(<FirstRunTourOffer eligible={false} />)
    act(() => { jest.advanceTimersByTime(10) })
    expect(screen.queryByText('用 1 分鐘走一遍核心流程')).toBeNull()
    expect(readTourProgress().offered).toBe(false)
  })

  it('announces the new hub beside its button to readers of the previous tours', () => {
    localStorage.setItem(LEFT_BROWSER_TOUR_STORAGE_KEY, '1')
    render(<><button type="button" data-tour="tour-hub-button">導覽</button><WhatsNewHint eligible /></>)
    act(() => { jest.advanceTimersByTime(1600) })

    expect(screen.getByTestId('whats-new-hint').textContent).toContain('導覽改版')
    fireEvent.click(screen.getByRole('button', { name: '打開導覽中心' }))

    expect(useGuidedTourStore.getState().hubOpen).toBe(true)
    expect(readTourProgress().seenNews).toContain('2026-10-tour-hub')
    expect(screen.queryByTestId('whats-new-hint')).toBeNull()
  })

  it('stays quiet while not eligible', () => {
    render(<><button type="button" data-tour="tour-hub-button">導覽</button><WhatsNewHint eligible={false} /></>)
    act(() => { jest.advanceTimersByTime(5000) })
    expect(screen.queryByTestId('whats-new-hint')).toBeNull()
  })
})
