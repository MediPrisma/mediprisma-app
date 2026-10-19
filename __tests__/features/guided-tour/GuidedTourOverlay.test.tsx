import { act, fireEvent, render, screen } from '@testing-library/react'

jest.mock('@/src/shared/config/firebase.config', () => ({ app: undefined }))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW' }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => ({ user: null }) }))
jest.mock('@/src/application/hooks/use-beta-features.hook', () => ({ useBetaFeatures: () => ({ enabled: false }) }))

import { GuidedTourOverlay } from '@/features/guided-tour/GuidedTourOverlay'
import { useGuidedTourStore } from '@/features/guided-tour/guided-tour.store'
import { readTourProgress } from '@/features/guided-tour/guided-tour.progress'
import { useLeftBrowserTourStore } from '@/features/left-browser-tour/left-browser-tour.store'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Page() {
  return (
    <div>
      <div data-tour="left-tabs">tabs</div>
      <div data-tour="overview-card">overview</div>
      <div data-tour="right-content-medical-summary">
        {/* No [data-source-link]: the summary has not been generated. */}
        <section data-tour="medical-summary-overview">summary</section>
      </div>
      <button type="button" data-tour="tour-hub-button">導覽</button>
    </div>
  )
}

const title = () => document.getElementById('guided-tour-title')?.textContent

describe('GuidedTourOverlay', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver
    Element.prototype.scrollIntoView = jest.fn()
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}),
    } as DOMRect)
  })

  beforeEach(() => {
    jest.useFakeTimers()
    localStorage.clear()
    act(() => {
      useGuidedTourStore.setState({ tourId: null, stepId: null, session: 0, lastOutcome: null, hubOpen: false })
      useLeftBrowserTourStore.setState({ active: false, stepId: null })
      useRightFeatureTourStore.setState({ active: false, stepId: null, session: 0, kind: 'scene', launcherOpen: false })
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('walks getting started, sets each screen, skips what is not there and records the finish', () => {
    render(<><Page /><GuidedTourOverlay /></>)
    act(() => useGuidedTourStore.getState().start('getting-started'))
    act(() => { jest.advanceTimersByTime(10) })

    expect(title()).toBe('先看總覽')
    expect(useLeftBrowserTourStore.getState()).toMatchObject({ active: true, stepId: 'patient-overview' })

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    act(() => { jest.advanceTimersByTime(10) })
    expect(title()).toBe('原始病歷在左側分頁')
    // A step without its own scene keeps the previous screen.
    expect(useLeftBrowserTourStore.getState().stepId).toBe('patient-overview')

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    act(() => { jest.advanceTimersByTime(10) })
    expect(title()).toBe('右側醫療摘要整理重點')
    expect(useLeftBrowserTourStore.getState().active).toBe(false)
    expect(useRightFeatureTourStore.getState()).toMatchObject({ active: true, kind: 'scene', stepId: 'summary' })

    // The source-link step has nothing to point at, so it is skipped.
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }))
    act(() => { jest.advanceTimersByTime(3000) })
    expect(title()).toBe('其他功能，到導覽中心挑著學')
    expect(useRightFeatureTourStore.getState().active).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(useGuidedTourStore.getState()).toMatchObject({ tourId: null, lastOutcome: 'finish' })
    expect(readTourProgress().completed).toContain('getting-started')
    expect(title()).toBeUndefined()
  })

  it('abandons on Escape without marking the tour as viewed', () => {
    render(<><Page /><GuidedTourOverlay /></>)
    act(() => useGuidedTourStore.getState().start('getting-started'))
    act(() => { jest.advanceTimersByTime(10) })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useGuidedTourStore.getState()).toMatchObject({ tourId: null, lastOutcome: 'abandon' })
    expect(readTourProgress().completed).not.toContain('getting-started')
    expect(useLeftBrowserTourStore.getState().active).toBe(false)
  })

  it('returns to the hub from a task tour', () => {
    render(<><Page /><GuidedTourOverlay /></>)
    act(() => useGuidedTourStore.getState().start('know-patient'))
    act(() => { jest.advanceTimersByTime(10) })

    fireEvent.click(screen.getByRole('button', { name: /導覽中心/ }))

    expect(useGuidedTourStore.getState()).toMatchObject({ tourId: null, hubOpen: true })
  })
})
