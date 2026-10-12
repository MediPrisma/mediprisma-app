import { render } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

const zhMedications = {
  currentlyInUse: '使用中',
  visitHeaderCount: '{n} 項',
  visitHeaderCountOne: '1 項',
  visitHeaderLabel: '{date} {institution} 就診，{n} 項用藥',
  visitHeaderLabelOne: '{date} {institution} 就診，1 項用藥',
  refillSummary: '累計 {count} 次',
}
const enMedications = {
  currentlyInUse: 'Active',
  visitHeaderCount: '{n} items',
  visitHeaderCountOne: '1 item',
  visitHeaderLabel: 'Visit {date} at {institution}, {n} medications',
  visitHeaderLabelOne: 'Visit {date} at {institution}, 1 medication',
  refillSummary: '{count} fills',
}
let mockLocale: 'zh-TW' | 'en' = 'zh-TW'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: mockLocale,
    t: {
      common: { loading: 'loading' },
      medications: mockLocale === 'en' ? enMedications : zhMedications,
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
  if (!iso) {
    return {
      ...active(id, '2026-01-01', pharmacy, icdCode),
      startedOn: undefined,
      startedOnIso: undefined,
    } as MedicationRow
  }
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
  afterEach(() => { mockLocale = 'zh-TW' })

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

  it('splits one day at one institution into separate visits by diagnosis', () => {
    // Same day, same hospital, two clinics: each is its own visit with its
    // own header and diagnosis, and the drugs of each stay together.
    const meds = [
      active('AMLODIPINE', '2026-09-20', '臺大醫院', 'I10'),
      active('METFORMIN', '2026-09-20', '臺大醫院', 'E11.9'),
      active('LOSARTAN', '2026-09-20', '臺大醫院', 'I10'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const headers = Array.from(container.querySelectorAll('[data-visit-header]'))
    expect(headers).toHaveLength(2)
    const byIcd = (code: string) => headers.find((h) => h.textContent?.includes(code))!
    expect(byIcd('I10').textContent).toContain('2 項')
    expect(byIcd('E11.9').textContent).toContain('1 項')
    const rows = Array.from(container.querySelectorAll('li[data-visit-band]'))
    const order = rows.map((li) => (li.textContent ?? '').match(/AMLODIPINE|METFORMIN|LOSARTAN/)![0])
    const metforminAt = order.indexOf('METFORMIN')
    expect(metforminAt === 0 || metforminAt === 2).toBe(true)
  })

  it('lets a long institution name truncate so the visit count stays in the row', () => {
    // At phone width a full hospital name is wider than the row; a rigid
    // (shrink-0) name pushed the count past the clipped edge of the list.
    const longName = '國立臺灣大學醫學院附設醫院新竹臺大分院生醫醫院院區'
    const meds = [
      active('A', '2026-09-25', longName, 'E11.9'),
      active('B', '2026-09-25', longName, 'E11.9'),
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

  it('shows no visit header for a drug whose start day is unknown', () => {
    // An undated row is its own "visit"; a header without a date only
    // repeats the institution the row already shows.
    const meds = [
      active('DATED', '2026-09-20', 'Clinic', 'I10'),
      active('UNDATED', '', 'Other clinic', 'I10'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const headers = Array.from(container.querySelectorAll('[data-visit-header]'))
    expect(headers).toHaveLength(1)
    expect(headers[0].textContent).toContain('Clinic')
    // The undated row still starts its own band.
    const rows = Array.from(container.querySelectorAll('li[data-visit-band]'))
    expect(rows.map((li) => li.getAttribute('data-visit-band'))).toEqual(['0', '1'])
  })

  it('uses the singular count for a one-drug visit in English', () => {
    mockLocale = 'en'
    const meds = [
      active('A', '2026-09-20', 'Clinic', 'I10'),
      active('B', '2026-09-15', 'Clinic', 'I10'),
      active('C', '2026-09-15', 'Clinic', 'I10'),
    ]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const headers = Array.from(container.querySelectorAll('[data-visit-header]'))
    expect(headers[0].textContent).toContain('1 item')
    expect(headers[0].textContent).not.toContain('1 items')
    expect(headers[0].textContent).toContain('1 medication')
    expect(headers[0].textContent).not.toContain('1 medications')
    expect(headers[1].textContent).toContain('2 items')
    expect(headers[1].textContent).toContain('2 medications')
  })

  it('gives screen readers the visit summary as text, not an aria-label on a plain div', () => {
    // aria-label is not allowed on a generic element and is ignored there.
    const meds = [active('A', '2026-09-20', '南方藥局', 'H40.1110')]
    const { container } = render(
      <MedicationList medications={meds} isLoading={false} error={null} />,
    )
    const header = container.querySelector('[data-visit-header]')!
    expect(header.hasAttribute('aria-label')).toBe(false)
    const srOnly = header.querySelector('.sr-only')!
    // The shared diagnosis is hidden visually-only above, so it must be here.
    expect(srOnly.textContent).toBe('26/09/20 南方藥局 就診，1 項用藥 · H40.1110')
    // Everything visible is hidden from the accessibility tree, so the summary
    // is read once rather than twice.
    const visible = Array.from(header.children).filter((child) => child !== srOnly)
    expect(visible.length).toBeGreaterThan(0)
    for (const child of visible) expect(child.getAttribute('aria-hidden')).toBe('true')
  })
})
