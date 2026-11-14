import { act, renderHook } from '@testing-library/react'
import { useTourTarget, type TourTargetSpec } from '@/features/guided-tour/spotlight/use-tour-target'

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

function placeTarget(name: string) {
  const element = document.createElement('div')
  element.dataset.tour = name
  element.getBoundingClientRect = () => ({
    top: 10, left: 20, right: 220, bottom: 60, width: 200, height: 50, x: 20, y: 10, toJSON: () => ({}),
  })
  element.scrollIntoView = () => {}
  document.body.appendChild(element)
}

describe('useTourTarget', () => {
  beforeAll(() => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('never places a new step on the previous step\'s target while its own search runs', () => {
    placeTarget('first')
    const first: TourTargetSpec = { target: '[data-tour="first"]' }
    const optional: TourTargetSpec = { target: '[data-tour="not-on-screen"]', optional: true }

    const seen: Array<{ spec: TourTargetSpec; placed: boolean }> = []
    const { result, rerender } = renderHook(({ spec }) => {
      const state = useTourTarget(spec)
      seen.push({ spec, placed: state.targetRect !== null })
      return state
    }, { initialProps: { spec: first } })
    expect(result.current.targetRect).toMatchObject({ width: 200, height: 50 })

    act(() => rerender({ spec: optional }))
    // Every render of the optional step — including the one before its search
    // starts — reports no target, so the card is never "placed" for it.
    expect(seen.filter((entry) => entry.spec === optional).every((entry) => !entry.placed)).toBe(true)
    expect(result.current.targetRect).toBeNull()
  })
})
