import { render } from '@testing-library/react'
import {
  MedicationHistoryList,
  assignVisitBands,
  dateSortKey,
  visitKeyOf,
} from '@/features/clinical-summary/medications/components/MedicationHistoryList'
import type { MedicationHistoryGroup } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: { medications: { statusEnded: '已結束', refillSummary: '累計 {count} 次' } },
  }),
}))

jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: () => null,
}))

jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (
    selector: (state: { pending: null; seq: number }) => unknown,
  ) => selector({ pending: null, seq: 0 }),
}))

function group(
  key: string,
  startedOn: string | undefined,
  endDate: string,
  pharmacy: string,
): MedicationHistoryGroup {
  const med = {
    id: key,
    title: key,
    status: 'completed',
    isInactive: true,
    isChronic: false,
    searchHaystack: '',
    refillCount: 1,
    startedOn,
    endDate,
    pharmacy,
  } as unknown as MedicationRow
  return { key, name: key, count: 1, medications: [med] } as MedicationHistoryGroup
}

describe('dateSortKey', () => {
  it('pads display dates so October sorts after September', () => {
    expect(dateSortKey('2026/10/1') > dateSortKey('2026/9/30')).toBe(true)
  })
  it('normalises ROC years', () => {
    expect(dateSortKey('115/8/6')).toBe('2026-08-06')
  })
})

describe('visit bands', () => {
  const ent1 = group('DEXCHLORPHENIRAMINE', '2026/8/6', '2026/8/9', '慈田耳鼻喉')
  const ent2 = group('CEPHALEXIN', '2026/8/6', '2026/8/9', '慈田耳鼻喉')
  const derm = group('ECONAZOLE', '2026/7/20', '2026/7/23', '蕭雨青小兒')
  const ent3 = group('BENPROPERINE', '2026/4/30', '2026/5/3', '慈田耳鼻喉')

  it('keys a visit by start date and institution', () => {
    expect(visitKeyOf(ent1)).toBe(visitKeyOf(ent2))
    expect(visitKeyOf(ent1)).not.toBe(visitKeyOf(ent3))
  })

  it('does not merge same-day visits at different institutions', () => {
    const other = group('X', '2026/8/6', '2026/8/9', '臺北市聯醫')
    expect(visitKeyOf(other)).not.toBe(visitKeyOf(ent1))
  })

  it('never merges undated rows into a neighbour', () => {
    expect(visitKeyOf(group('A', undefined, '', ''))).not.toBe(
      visitKeyOf(group('B', undefined, '', '')),
    )
  })

  it('alternates bands at each visit boundary', () => {
    expect(assignVisitBands([ent1, ent2, derm, ent3])).toEqual([
      { band: 0, visitStart: false },
      { band: 0, visitStart: false },
      { band: 1, visitStart: true },
      { band: 0, visitStart: true },
    ])
  })

  it('renders rows of one visit adjacent with a shared band', () => {
    // Shuffled input; a 7-day drug from the same visit ends later than the
    // other visit's rows but must still stay with its visit.
    const ent7day = group('AMOXICILLIN', '2026/8/6', '2026/8/13', '慈田耳鼻喉')
    const { container } = render(
      <MedicationHistoryList groups={[derm, ent1, ent3, ent7day, ent2]} />,
    )
    const bands = Array.from(container.querySelectorAll('li[data-visit-band]')).map(
      (li) => li.getAttribute('data-visit-band'),
    )
    expect(bands).toEqual(['0', '0', '0', '1', '0'])
    expect(container.querySelectorAll('li[data-visit-start]')).toHaveLength(2)
  })
})
