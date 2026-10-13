import { render } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

// While a search or class filter is on, a visit header counted only the rows
// left after filtering: a three-drug visit read "1 項". It now reads "1／3 項".

let mockLocale: 'zh-TW' | 'en' = 'zh-TW'
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/application/providers/language.provider', () => {
  const zh = {
    currentlyInUse: '使用中', history: '用藥歷史', historyStopped: '已停用',
    visitHeaderCount: '{n} 項', visitHeaderCountOne: '1 項',
    visitHeaderCountFiltered: '{n}／{total} 項',
    visitHeaderLabel: '{date} 就診，{n} 項用藥', visitHeaderLabelOne: '{date} 就診，1 項用藥',
    visitHeaderLabelFiltered: '{date} 就診，{total} 項用藥中 {n} 項符合',
    refillSummary: '累計 {count} 次',
  }
  const en = {
    ...zh,
    visitHeaderCount: '{n} items', visitHeaderCountOne: '1 item',
    visitHeaderCountFiltered: '{n} of {total} items',
    visitHeaderLabelFiltered: 'Visit {date}, {n} of {total} medications match',
  }
  return {
    useLanguage: () => ({
      locale: mockLocale,
      t: { common: { loading: '載入中' }, medications: mockLocale === 'en' ? en : zh },
    }),
  }
})
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (selector: (s: { pending: null; seq: number }) => unknown) =>
    selector({ pending: null, seq: 0 }),
}))

function med(id: string, iso: string, inactive = false): MedicationRow {
  return {
    id, drugKey: id, title: id, status: inactive ? 'completed' : 'active', isInactive: inactive,
    isChronic: false, searchHaystack: id.toLowerCase(), refillCount: 1,
    startedOn: iso.replace(/-0?/g, '/'), startedOnIso: iso, pharmacy: '馬偕醫院', icdCode: 'J01.90',
  } as unknown as MedicationRow
}

afterEach(() => { mockLocale = 'zh-TW' })

describe('visit header count while filtered', () => {
  const visit = [med('ACETAMINOPHEN', '2026-07-10', true), med('PSEUDOEPHEDRINE', '2026-07-10', true), med('CEFUROXIME', '2026-07-10', true)]
  const current = [med('AMLODIPINE', '2026-10-02'), med('LOSARTAN', '2026-10-02')]

  it('shows matches of the visit total in the history list', () => {
    const { container } = render(
      <MedicationList medications={[visit[0]]} unfilteredMedications={[...visit, ...current]} isLoading={false} error={null} />,
    )
    const header = container.querySelector('[data-visit-header]')!
    expect(header.textContent).toContain('1／3 項')
    expect(header.querySelector('.sr-only')!.textContent).toBe('26/07/10 就診，3 項用藥中 1 項符合')
  })

  it('shows matches of the visit total in 使用中', () => {
    const { container } = render(
      <MedicationList medications={[current[0]]} unfilteredMedications={[...visit, ...current]} isLoading={false} error={null} />,
    )
    expect(container.querySelector('[data-visit-header]')!.textContent).toContain('1／2 項')
  })

  it('keeps the plain count when every drug of the visit is shown', () => {
    const { container } = render(
      <MedicationList medications={visit} unfilteredMedications={[...visit, ...current]} isLoading={false} error={null} />,
    )
    const header = container.querySelector('[data-visit-header]')!
    expect(header.textContent).toContain('3 項')
    expect(header.textContent).not.toContain('／')
  })

  it('keeps the plain count without a filter', () => {
    const { container } = render(<MedicationList medications={[visit[0]]} isLoading={false} error={null} />)
    expect(container.querySelector('[data-visit-header]')!.textContent).toContain('1 項')
  })

  it('reads "1 of 3 items" in English', () => {
    mockLocale = 'en'
    const { container } = render(
      <MedicationList medications={[visit[0]]} unfilteredMedications={[...visit, ...current]} isLoading={false} error={null} />,
    )
    expect(container.querySelector('[data-visit-header]')!.textContent).toContain('1 of 3 items')
  })
})
