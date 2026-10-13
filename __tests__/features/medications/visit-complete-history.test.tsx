import { render, within } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

// Owner, 2026-10-13: every visit in 用藥歷史 lists every drug prescribed at
// it. A drug filled again later used to appear only under its newest visit,
// so an older visit read "2 項" for three drugs, with no way to tell which
// one was missing.

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: {
      common: { loading: '載入中' },
      medications: {
        currentlyInUse: '使用中', history: '用藥歷史', historyStopped: '已停用',
        showMedicationHistory: '顯示 {name} 的過往用藥紀錄（{count}）',
        hideMedicationHistory: '收合 {name} 的過往用藥紀錄（{count}）',
        visitHeaderCount: '{n} 項', visitHeaderCountOne: '1 項', visitHeaderCountFiltered: '{n}／{total} 項',
        visitHeaderLabel: '{date} 就診，{n} 項用藥', visitHeaderLabelOne: '{date} 就診，1 項用藥',
        visitHeaderLabelFiltered: '{date} 就診，{total} 項用藥中 {n} 項符合',
        refillSummary: '累計 {count} 次',
      },
    },
  }),
}))
jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({ useResourceAnchor: () => null }))
jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (selector: (s: { pending: null; seq: number }) => unknown) =>
    selector({ pending: null, seq: 0 }),
}))

function fill(id: string, drug: string, iso: string, pharmacy: string, icd: string, inactive = true, refillCount = 1): MedicationRow {
  return {
    id, drugKey: drug, title: drug, status: inactive ? 'completed' : 'active', isInactive: inactive,
    isChronic: false, searchHaystack: drug.toLowerCase(), refillCount,
    startedOn: iso.replace(/-0?/g, '/'), startedOnIso: iso, pharmacy, icdCode: icd,
  } as unknown as MedicationRow
}

const historyList = (container: HTMLElement) =>
  container.querySelectorAll('ul[data-medication-list-surface="grouped"]')[
    container.querySelectorAll('ul[data-medication-list-surface="grouped"]').length - 1
  ] as HTMLElement

const visitRows = (list: HTMLElement, date: string) => {
  const rows = Array.from(list.querySelectorAll(':scope > li'))
  const start = rows.findIndex((li) => li.querySelector('[data-visit-header]')?.textContent?.includes(date))
  const out: Element[] = [rows[start]]
  for (let i = start + 1; i < rows.length && !rows[i].querySelector('[data-visit-header]'); i += 1) out.push(rows[i])
  return out
}

describe('用藥歷史 lists every drug of each visit', () => {
  const aOld = fill('a-0710', 'ACETAMINOPHEN', '2026-07-10', '馬偕醫院', 'J01.90', true, 2)
  const aNew = fill('a-0910', 'ACETAMINOPHEN', '2026-09-10', '某診所', 'R50.9', true, 2)
  const b = fill('b-0710', 'PSEUDOEPHEDRINE', '2026-07-10', '馬偕醫院', 'J01.90')
  const c = fill('c-0710', 'CEFUROXIME', '2026-07-10', '馬偕醫院', 'J01.90')

  it('shows a drug under each visit that prescribed it', () => {
    const { container } = render(<MedicationList medications={[aOld, aNew, b, c]} isLoading={false} error={null} />)
    const list = historyList(container)
    const july = visitRows(list, '26/07/10')
    expect(july).toHaveLength(3)
    expect(july[0].querySelector('[data-visit-header]')!.textContent).toContain('3 項')
    expect(july.map((li) => li.textContent).join(' ')).toMatch(/ACETAMINOPHEN[\s\S]*PSEUDOEPHEDRINE|PSEUDOEPHEDRINE[\s\S]*ACETAMINOPHEN/)
    const sept = visitRows(list, '26/09/10')
    expect(sept).toHaveLength(1)
    expect(sept[0].textContent).toContain('ACETAMINOPHEN')
    // Each row shows its own fill's dates; both keep the drug's refill count.
    expect(within(sept[0] as HTMLElement).getByText(/26\/09\/10/, { selector: '[data-medication-regimen] *' })).toBeInTheDocument()
    expect(sept[0].textContent).toContain('累計 2 次')
    expect(july.find((li) => li.textContent?.includes('ACETAMINOPHEN'))!.textContent).toContain('累計 2 次')
  })

  it('lists a drug still in use at its older visit', () => {
    const current = fill('amlo-1002', 'AMLODIPINE', '2026-10-02', '臺大醫院', 'I10', false, 2)
    const earlier = fill('amlo-0710', 'AMLODIPINE', '2026-07-10', '馬偕醫院', 'J01.90', true, 2)
    const { container } = render(<MedicationList medications={[current, earlier, b, c]} isLoading={false} error={null} />)
    const list = historyList(container)
    const july = visitRows(list, '26/07/10')
    expect(july).toHaveLength(3)
    const amlo = july.find((li) => li.textContent?.includes('AMLODIPINE'))!
    // No 「使用中」 badge (owner, 2026-10-13): 使用中 above already lists the
    // current drugs, and beside this fill's 已結束 it read as a contradiction.
    expect(amlo.querySelector('[data-history-still-in-use]')).toBeNull()
    // Same refill count as the drug's 使用中 row, which counts every fill.
    expect(amlo.textContent).toContain('累計 2 次')
    // ...and it is still the current row in 使用中.
    const currentList = container.querySelectorAll('ul[data-medication-list-surface="grouped"]')[0]
    expect(currentList.textContent).toContain('AMLODIPINE')
  })

  it('reads the same visit total with and without a filter', () => {
    const { container } = render(
      <MedicationList medications={[b]} unfilteredMedications={[aOld, aNew, b, c]} isLoading={false} error={null} />,
    )
    expect(container.querySelector('[data-visit-header]')!.textContent).toContain('1／3 項')
  })
})
