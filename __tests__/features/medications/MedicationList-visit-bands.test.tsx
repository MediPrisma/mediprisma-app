import { render } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

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
        visitHeaderCount: '{n} 項',
        refillSummary: '累計 {count} 次',
      },
    },
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

function active(id: string, iso: string, pharmacy: string, icdCode: string): MedicationRow {
  return {
    id,
    drugKey: id,
    title: id,
    status: 'active',
    isInactive: false,
    isChronic: true,
    searchHaystack: '',
    refillCount: 1,
    startedOn: iso.replace(/-0?/g, '/'),
    startedOnIso: iso,
    pharmacy,
    icdCode,
  } as unknown as MedicationRow
}

describe('current medications — visit bands and headers', () => {
  it('groups drugs from the same visit and labels each visit', () => {
    // Input interleaves the two visits; display must keep each visit together.
    const meds = [
      active('LATANOPROST', '2026-09-20', '南方藥局', 'H40.1110'),
      active('OXYBUTYNIN', '2026-09-15', '長庚嘉義', 'N40.0'),
      active('BRIMONIDINE', '2026-09-20', '南方藥局', 'H40.1110'),
      active('MIRABEGRON', '2026-09-15', '長庚嘉義', 'N40.0'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const rows = Array.from(container.querySelectorAll('li[data-visit-band]'))
    expect(rows.map((li) => li.getAttribute('data-visit-band'))).toEqual(['0', '0', '1', '1'])

    const headers = Array.from(container.querySelectorAll('[data-visit-header]'))
    expect(headers).toHaveLength(2)
    expect(headers[0].textContent).toContain('南方藥局')
    expect(headers[0].textContent).toContain('H40.1110')
    expect(headers[0].textContent).toContain('2 項')
    expect(headers[1].textContent).toContain('長庚嘉義')
  })

  it('omits the diagnosis when drugs of one visit have different ICD codes', () => {
    const meds = [
      active('A', '2026-09-20', 'Clinic', 'H40.1110'),
      active('B', '2026-09-20', 'Clinic', 'N40.0'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const header = container.querySelector('[data-visit-header]')!
    expect(header.textContent).not.toContain('H40')
    expect(header.textContent).toContain('2 項')
  })

  it('lets a long institution name truncate so the visit count stays in the row', () => {
    // At phone width a full hospital name is wider than the row; a rigid
    // (shrink-0) name pushed the count past the clipped edge of the list.
    const longName = '國立臺灣大學醫學院附設醫院新竹臺大分院生醫醫院院區'
    const meds = [
      active('A', '2026-09-25', longName, 'E11.9'),
      active('B', '2026-09-25', longName, 'E78.5'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const header = container.querySelector('[data-visit-header]')!
    const institution = Array.from(header.querySelectorAll('span'))
      .find((span) => span.textContent === longName)!
    expect(institution).toBeDefined()
    expect(institution.className).toContain('truncate')
    expect(institution.className).toContain('min-w-0')
    expect(institution.className).not.toContain('shrink-0')
    expect(institution.getAttribute('title')).toBe(longName)
    const count = Array.from(header.querySelectorAll('span'))
      .find((span) => span.textContent === '2 項')!
    expect(count.className).toContain('shrink-0')
  })
})
