import { render } from '@testing-library/react'
import {
  MedicationHistoryList,
  assignVisitBands,
  dateSortKey,
  visitKeyOf,
} from '@/features/clinical-summary/medications/components/MedicationHistoryList'
import { groupMedications } from '@/features/clinical-summary/medications/hooks/useGroupedMedications'
import { formatDate } from '@/src/shared/utils/fhir-helpers'
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
  it('refuses month/day-first strings instead of guessing', () => {
    expect(dateSortKey('10/1/2026')).toBe('')
    expect(dateSortKey('1/10/2026')).toBe('')
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

  it('does not merge two clinics at the same institution on the same day', () => {
    // One day at 臺大醫院: cardiology (I10) and endocrinology (E11.9) are two
    // visits, even though date and institution match.
    const cardio = group('AMLODIPINE', '2026/8/6', '2026/9/3', '臺大醫院')
    const endo = group('METFORMIN', '2026/8/6', '2026/9/3', '臺大醫院')
    const cardio2 = group('LOSARTAN', '2026/8/6', '2026/9/3', '臺大醫院')
    cardio.medications[0].icdCode = 'I10'
    endo.medications[0].icdCode = 'E11.9'
    cardio2.medications[0].icdCode = 'I10'
    expect(visitKeyOf(cardio)).not.toBe(visitKeyOf(endo))
    expect(visitKeyOf(cardio)).toBe(visitKeyOf(cardio2))

    // Interleaved input: each clinic's drugs stay together, one band each.
    const { container } = render(
      <MedicationHistoryList groups={[cardio, endo, cardio2]} />,
    )
    const rows = Array.from(container.querySelectorAll('li[data-visit-band]'))
    const titles = rows.map((li) => li.textContent ?? '')
    const endoAt = titles.findIndex((t) => t.includes('METFORMIN'))
    expect(endoAt === 0 || endoAt === 2).toBe(true)
    const bands = rows.map((li) => li.getAttribute('data-visit-band'))
    expect(new Set(bands).size).toBe(2)
    expect(container.querySelectorAll('[data-visit-header]')).toHaveLength(2)
  })

  it('never merges undated rows into a neighbour', () => {
    expect(visitKeyOf(group('A', undefined, '', ''))).not.toBe(
      visitKeyOf(group('B', undefined, '', '')),
    )
  })

  it('alternates bands at each visit boundary', () => {
    expect(assignVisitBands([ent1, ent2, derm, ent3])).toEqual([
      { band: 0, visitStart: false, headerCount: 2 },
      { band: 0, visitStart: false, headerCount: 0 },
      { band: 1, visitStart: true, headerCount: 1 },
      { band: 0, visitStart: true, headerCount: 1 },
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
    const headers = Array.from(container.querySelectorAll('[data-visit-header]'))
    expect(headers).toHaveLength(3)
    expect(headers[0].textContent).toContain('慈田耳鼻喉')
    expect(headers[0].textContent).toContain('3 項')
  })
})

// ── Astra round 1 regressions ────────────────────────────────────────────

function row(
  id: string,
  drugKey: string,
  iso: string,
  pharmacy: string,
): MedicationRow {
  return {
    id,
    drugKey,
    title: drugKey,
    status: 'completed',
    isInactive: true,
    isChronic: false,
    searchHaystack: '',
    refillCount: 1,
    // Display strings exactly as useMedicationRows builds them — in whatever
    // locale the runtime has (en-US gives "10/1/2026").
    startedOn: formatDate(iso),
    endDate: formatDate(iso),
    startedOnIso: iso,
    endDateIso: iso,
    pharmacy,
  } as unknown as MedicationRow
}

describe('visit bands — locale-independent dates (Astra r1 #1)', () => {
  const asGroup = (m: MedicationRow): MedicationHistoryGroup =>
    ({ key: m.id, name: m.title, count: 1, medications: [m] }) as MedicationHistoryGroup

  it('keeps the same day in different years as different visits', () => {
    const a = asGroup(row('a', 'A', '2025-10-01', 'Clinic'))
    const b = asGroup(row('b', 'B', '2026-10-01', 'Clinic'))
    expect(visitKeyOf(a)).not.toBe(visitKeyOf(b))
  })

  it.each(['en-US', 'en-GB', 'zh-TW'])('builds the key from the ISO date under %s', (locale) => {
    const spy = jest
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementation(function (this: Date) {
        return Intl.DateTimeFormat(locale).format(this)
      })
    try {
      const m = row('a', 'A', '2026-08-06', 'Clinic')
      expect(visitKeyOf(asGroup(m))).toBe('2026-08-06|Clinic|')
    } finally {
      spy.mockRestore()
    }
  })

  it('never merges rows that only have an ambiguous display date', () => {
    const a = asGroup({ ...row('a', 'A', '2025-10-01', 'Clinic'), startedOnIso: undefined } as MedicationRow)
    const b = asGroup({ ...row('b', 'B', '2026-10-01', 'Clinic'), startedOnIso: undefined } as MedicationRow)
    a.medications[0].startedOn = '10/1/2025'
    b.medications[0].startedOn = '10/1/2026'
    expect(visitKeyOf(a)).not.toBe(visitKeyOf(b))
  })
})

describe('visit bands — representative fill is the newest (Astra r1 #2)', () => {
  it('picks 10/1 over 9/30 inside a group and bands it with the same-visit drug', () => {
    const { inactiveMedicationGroups: history } = groupMedications([
      row('a-old', 'A', '2026-09-30', 'Clinic'),
      row('a-new', 'A', '2026-10-01', 'Clinic'),
      row('b', 'B', '2026-10-01', 'Clinic'),
    ])
    const groupA = history.find((g) => g.key === 'A')!
    expect(groupA.medications.map((m) => m.id)).toEqual(['a-new', 'a-old'])

    const { container } = render(<MedicationHistoryList groups={history} />)
    const bands = Array.from(container.querySelectorAll('li[data-visit-band]')).map(
      (li) => li.getAttribute('data-visit-band'),
    )
    expect(bands).toEqual(['0', '0'])
  })
})

describe('history rows under a visit header', () => {
  it('leave institution and diagnosis to the header', () => {
    const dated = group('CEPHALEXIN', '2026/8/6', '2026/8/9', '慈田耳鼻喉')
    dated.medications[0].startedOnIso = '2026-08-06'
    dated.medications[0].icdCode = 'J01.90'
    const undated = group('FAMOTIDINE', undefined, '', '某診所')
    undated.medications[0].icdCode = 'K21.9'
    const { container } = render(<MedicationHistoryList groups={[dated, undated]} />)
    const rows = Array.from(container.querySelectorAll('li[data-visit-band]'))
    const datedRow = rows.find((li) => li.textContent?.includes('CEPHALEXIN'))!
    const undatedRow = rows.find((li) => li.textContent?.includes('FAMOTIDINE'))!
    expect(datedRow.querySelector('[data-visit-header]')?.textContent).toContain('慈田耳鼻喉')
    expect(datedRow.querySelector('[data-testid="medication-institution"]')).toBeNull()
    expect(datedRow.querySelector('[data-medication-diagnosis] button')).toBeNull()
    expect(undatedRow.querySelector('[data-visit-header]')).toBeNull()
    expect(undatedRow.querySelector('[data-testid="medication-institution"]')?.textContent).toBe('某診所')
    expect(undatedRow.querySelector('[data-medication-diagnosis] button')?.textContent).toContain('K21.9')
  })
})

