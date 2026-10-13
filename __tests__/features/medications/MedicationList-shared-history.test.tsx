import { fireEvent, render, screen, within } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

// Two clinics currently prescribe the same drug. Both rows show the drug's
// refill count, so both must be able to open the prior fills it counts.

const mockAnchorIds: string[][] = []

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: {
      common: { loading: '載入中' },
      medications: {
        currentlyInUse: '使用中',
        showMedicationHistory: '顯示 {name} 的過往用藥紀錄（{count}）',
        hideMedicationHistory: '收合 {name} 的過往用藥紀錄（{count}）',
        visitHeaderCount: '{n} 項',
        visitHeaderCountOne: '1 項',
        visitHeaderLabel: '{date} 就診，{n} 項用藥',
        visitHeaderLabelOne: '{date} 就診，1 項用藥',
        refillSummary: '累計 {count} 次',
      },
    },
  }),
}))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: (_types: string[], ids?: string | string[]) => {
    mockAnchorIds.push(Array.isArray(ids) ? ids : ids ? [ids] : [])
    return null
  },
}))
jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (
    selector: (state: { pending: null; seq: number }) => unknown,
  ) => selector({ pending: null, seq: 0 }),
}))

function med(id: string, iso: string, pharmacy: string, isInactive: boolean): MedicationRow {
  return {
    id,
    drugKey: 'NHI-METFORMIN',
    title: 'Metformin 500mg',
    status: isInactive ? 'completed' : 'active',
    isInactive,
    isChronic: false,
    searchHaystack: '',
    refillCount: 4,
    startedOn: iso.replace(/-0?/g, '/'),
    startedOnIso: iso,
    pharmacy,
    icdCode: 'E11.9',
  } as unknown as MedicationRow
}

const mackay = med('active-mackay', '2026-10-01', '馬偕醫院', false)
const ntuh = med('active-ntuh', '2026-09-25', '臺大醫院', false)
const priorMackay = med('prior-mackay', '2026-07-01', '馬偕醫院', true)
const priorClinic = med('prior-clinic', '2026-05-02', '某診所', true)

beforeEach(() => { mockAnchorIds.length = 0 })

describe('same drug current at two clinics', () => {
  const renderList = () => render(
    // Input order puts 臺大 first; the list shows 馬偕 (newer visit) first.
    <MedicationList medications={[ntuh, mackay, priorMackay, priorClinic]} isLoading={false} error={null} />,
  )

  it('lets both rows open the prior fills', () => {
    renderList()
    const toggles = screen.getAllByRole('button', { name: /顯示 Metformin 500mg 的過往用藥紀錄（2）/ })
    expect(toggles).toHaveLength(2)

    // The second row (臺大) opens its own copy of the shared history.
    fireEvent.click(toggles[1])
    const rows = Array.from(document.querySelectorAll('li[data-visit-band]'))
    const ntuhRow = rows.find((li) => li.textContent?.includes('臺大醫院'))!
    expect(within(ntuhRow as HTMLElement).getByText(/26\/07\/01/)).toBeInTheDocument()
    expect(within(ntuhRow as HTMLElement).getByText(/某診所/)).toBeInTheDocument()
    const mackayRow = rows.find((li) => li.textContent?.includes('馬偕醫院') && li !== ntuhRow)!
    expect(within(mackayRow as HTMLElement).queryByText(/26\/07\/01/)).toBeNull()
  })

  it('keeps one navigation owner for the prior fills: the first row shown', () => {
    renderList()
    const owners = mockAnchorIds.filter((ids) => ids.includes('prior-mackay'))
    // Every render repeats the same registration; all of them belong to one row.
    expect(owners.length).toBeGreaterThan(0)
    expect(new Set(owners.map((ids) => ids[0]))).toEqual(new Set(['active-mackay']))
    expect(mockAnchorIds.some((ids) => ids[0] === 'active-ntuh' && ids.length === 1)).toBe(true)
  })
})
