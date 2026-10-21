/**
 * @jest-environment jsdom
 */
import {
  AF_SWITCHABLE_LAYOUTS,
  CDSS_LAYOUT_STORAGE_KEY,
  CDSS_SWITCHABLE_LAYOUTS,
  LIPID_SWITCHABLE_LAYOUTS,
  defaultLayoutFor,
  useCdssLayoutStore,
} from '@/features/clinical-decision-support/stores/layout-preference.store'

describe('guidance layout preference', () => {
  beforeEach(() => {
    localStorage.clear()
    useCdssLayoutStore.setState({ layout: null })
  })

  it('holds no choice until one is made, then remembers it in this browser', () => {
    expect(useCdssLayoutStore.getState().layout).toBeNull()
    useCdssLayoutStore.getState().setLayout('board')
    expect(useCdssLayoutStore.getState().layout).toBe('board')
    expect(JSON.parse(localStorage.getItem(CDSS_LAYOUT_STORAGE_KEY) ?? '{}'))
      .toMatchObject({ state: { layout: 'board' } })
  })

  it('opens heart failure and atrial fibrillation on the decision map, every other pack on sections', () => {
    expect(defaultLayoutFor('heart-failure-cdss')).toBe('map')
    expect(defaultLayoutFor('atrial-fibrillation-cdss')).toBe('map')
    expect(defaultLayoutFor('hyperlipidemia-cdss')).toBe('sections')
    expect(defaultLayoutFor('some-future-pack')).toBe('sections')
  })

  it('offers only 決策地圖 v2 and 三區塊 (lipid: 三區塊 and 健保表一)', () => {
    // `flow`, `board`, `c` and `classic` stay in the type and in the view for
    // what still reads them; none is a face a pilot user can be sent back to.
    // The first decision map is retired: `map` draws v2 (owner, 2026-10-01).
    expect(CDSS_SWITCHABLE_LAYOUTS).toEqual(['map', 'sections'])
    expect(AF_SWITCHABLE_LAYOUTS).toEqual(['map', 'sections'])
    expect(LIPID_SWITCHABLE_LAYOUTS).toEqual(['sections', 'nhi'])
  })

  it('reads a browser that stored 新版流程 or 原版看板 as no choice', () => {
    for (const retired of ['flow', 'board']) {
      localStorage.setItem(CDSS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: retired }, version: 0 }))
      useCdssLayoutStore.persist.rehydrate()
      expect(useCdssLayoutStore.getState().layout).toBeNull()
    }
  })

  it('keeps a browser that stored a layout on it, and one that stored nothing on the default', () => {
    localStorage.setItem(CDSS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: 'sections' }, version: 0 }))
    useCdssLayoutStore.persist.rehydrate()
    expect(useCdssLayoutStore.getState().layout).toBe('sections')

    useCdssLayoutStore.setState({ layout: 'flow' })
    localStorage.removeItem(CDSS_LAYOUT_STORAGE_KEY)
    useCdssLayoutStore.persist.rehydrate()
    expect(useCdssLayoutStore.getState().layout).toBeNull()
  })

  it('reads a browser that stored 決策地圖 v2 (`book`) as the decision map, which v2 now is', () => {
    localStorage.setItem(CDSS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: 'book' }, version: 0 }))
    useCdssLayoutStore.persist.rehydrate()
    expect(useCdssLayoutStore.getState().layout).toBe('map')

    localStorage.setItem(CDSS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: 'map' }, version: 0 }))
    useCdssLayoutStore.persist.rehydrate()
    expect(useCdssLayoutStore.getState().layout).toBe('map')
  })

  it('reads a browser that stored the retired direction C as three sections', () => {
    localStorage.setItem(CDSS_LAYOUT_STORAGE_KEY, JSON.stringify({ state: { layout: 'c' }, version: 0 }))
    useCdssLayoutStore.persist.rehydrate()
    expect(useCdssLayoutStore.getState().layout).toBe('sections')
  })
})
