import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CumulativeLabReport } from '@/features/clinical-summary/reports/components/CumulativeLabReport'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { useCumulativeReportPrefsStore } from '@/src/application/stores/cumulative-report-prefs.store'
import { DEFAULT_CUMULATIVE_CATEGORY_ORDER } from '@/features/clinical-summary/reports/utils/cumulative-order.utils'

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AudienceProvider>{children}</AudienceProvider>
    </LanguageProvider>
  )
}

// One CRP (chemistry) per day, newest 2026-09-05 — five collection dates, so
// the default 最新三筆 hides two of them.
function crpObservations(dayCount: number) {
  return Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(2026, 8, 5 - index)
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return {
      id: `crp-${index}`,
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }] },
      effectiveDateTime: iso,
      valueQuantity: { value: 1 + index / 10, unit: 'mg/dL' },
    }
  })
}

const section = (id: string) =>
  document.querySelector<HTMLElement>(`[data-cumulative-section="${id}"]`)
const chip = (id: string) =>
  document.querySelector<HTMLElement>(`[data-cumulative-jump-chip="${id}"]`)
const dateRows = (id: string) =>
  section(id)?.querySelectorAll('tbody tr[data-index]') ?? []

describe('CumulativeLabReport 直式 (stacked) layout', () => {
  const scrollIntoView = jest.fn()

  beforeEach(() => {
    localStorage.clear()
    useCumulativeReportPrefsStore.setState({
      layoutMode: 'stacked',
      range: 'latest3',
      categoryOrder: null,
    })
    scrollIntoView.mockClear()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: jest.fn(),
    })
  })

  it('is the default layout and renders every category as a section', () => {
    // A fresh device has no persisted preference — 直式 must be what opens.
    useCumulativeReportPrefsStore.persist?.clearStorage?.()
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    for (const id of DEFAULT_CUMULATIVE_CATEGORY_ORDER) {
      expect(section(id)).not.toBeNull()
    }
    // No category sub-tabs at all in this layout.
    expect(screen.queryByRole('tablist', { name: '累積報告分類' })).not.toBeInTheDocument()
    // hiddenByDefault panels (血氣 / 病毒抗原) are plain sections here, not
    // items behind the 「查看更多」 picker.
    expect(screen.queryByRole('button', { name: '查看更多' })).not.toBeInTheDocument()
    expect(within(section('bloodgas')!).getByRole('heading', { name: /血氣/ })).toBeInTheDocument()
    expect(within(section('serology')!).getByRole('heading', { name: /病毒抗原/ })).toBeInTheDocument()
  })

  it('renders 免疫 as two tables, immunoglobulins then autoantibodies, and no allergen anywhere', () => {
    const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
    const row = (id: string, nhi: string, text: string, value: string | number) => ({
      id,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { text, coding: [{ system: NHI, code: nhi }] },
      effectiveDateTime: '2026-09-30',
      ...(typeof value === 'number' ? { valueQuantity: { value, unit: 'mg/dL' } } : { valueString: value }),
    })
    render(<CumulativeLabReport observations={[
      row('igg', '12025B', 'IGG', 1000),
      row('c3', '12034B', 'C3', 100),
      row('ro52', '12064B', 'Ro52', 'Negative'),
      row('ssa', '12064B', 'SS-A/Ro Ab', '<1'),
      row('mold', '30022C', '混合黴菌', '<0.1'),
    ]} />, { wrapper: TestProviders })

    const immuno = section('immuno')!
    expect(within(immuno).getByRole('heading', { name: /免疫/ })).toBeInTheDocument()
    const tables = immuno.querySelectorAll('table')
    expect(tables).toHaveLength(2)
    expect(tables[0]).toHaveTextContent('免疫球蛋白／補體')
    expect(tables[0]).toHaveTextContent('C3')
    expect(tables[1]).toHaveTextContent('自體抗體')
    expect(tables[1]).toHaveTextContent('SS-A/Ro')
    expect(tables[1]).toHaveTextContent('Ro52')
    // The line-blot Negative does not leak into 尿液, and the 30022C mould
    // allergen is in no section at all.
    expect(section('urine')!.querySelector('table')).toBeNull()
    expect(document.body).not.toHaveTextContent('混合黴菌')
  })

  it('renders a compact expected-columns line for a category with no data', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    const lipid = section('lipid')!
    expect(lipid.querySelector('table')).toBeNull()
    expect(lipid).toHaveTextContent('此分類尚無檢驗資料（預期欄位：')
    // Pinned columns are named so the clinician can tell "not ordered" from
    // "not supported".
    expect(lipid).toHaveTextContent('LDL')
  })

  it('applies 最新三筆 per category and expands one section at a time', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    const chem = section('chem')!
    expect(dateRows('chem')).toHaveLength(3)
    expect(chem).toHaveTextContent('5 個日期')
    expect(chem).toHaveTextContent('顯示最新 3 筆')

    const showMore = within(chem).getByRole('button', { name: /查看更多 · 其餘 2 筆/ })
    fireEvent.click(showMore)

    expect(dateRows('chem')).toHaveLength(5)
    expect(chem).toHaveTextContent('已展開全部 5 筆')
    const collapse = within(chem).getByRole('button', { name: /收合 · 回到最新三筆（3 筆）/ })

    fireEvent.click(collapse)
    expect(dateRows('chem')).toHaveLength(3)
  })

  it('changes how many rows every section shows from the range selector', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    fireEvent.click(screen.getAllByRole('radio', { name: '最新一筆' })[0])

    expect(dateRows('chem')).toHaveLength(1)
    expect(section('chem')).toHaveTextContent('顯示最新 1 筆')
    expect(useCumulativeReportPrefsStore.getState().range).toBe('latest1')
    // A window range labels itself with the window, not with a count of rows.
    fireEvent.click(screen.getAllByRole('radio', { name: '最近一年' })[0])
    expect(section('chem')).toHaveTextContent('最近一年 5 筆')
    expect(dateRows('chem')).toHaveLength(5)
  })

  it('jumps to a section from the chip row', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    fireEvent.click(chip('urine')!)

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(chip('urine')).toHaveAttribute('aria-current', 'true')
  })

  it('reorders categories from a section header and persists the new order', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    const chemHeader = section('chem')!.querySelector('h3')!.parentElement!
    fireEvent.click(within(chemHeader).getByRole('button', { name: '生化 往上移' }))

    const order = useCumulativeReportPrefsStore.getState().categoryOrder
    expect(order?.slice(0, 3)).toEqual(['cbc', 'chem', 'coag'])
    // Both the sections and the chip row follow the same order.
    const sectionIds = [...document.querySelectorAll('[data-cumulative-section]')]
      .map((element) => (element as HTMLElement).dataset.cumulativeSection)
    expect(sectionIds.slice(0, 3)).toEqual(['cbc', 'chem', 'coag'])
    const chipIds = [...document.querySelectorAll('[data-cumulative-jump-chip]')]
      .map((element) => (element as HTMLElement).dataset.cumulativeJumpChip)
    expect(chipIds.slice(0, 3)).toEqual(['cbc', 'chem', 'coag'])
    // 血液 is now first and cannot move up.
    expect(within(section('cbc')!.querySelector('h3')!.parentElement!)
      .getByRole('button', { name: '血液 往上移' })).toBeDisabled()
  })

  it('reorders and resets from the 調整順序 panel', async () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    fireEvent.click(screen.getByRole('button', { name: '調整分類順序' }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('分類順序')).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: '尿液 往上移' }))
    expect(useCumulativeReportPrefsStore.getState().categoryOrder)
      .toEqual(expect.arrayContaining(['urine']))
    const afterMove = useCumulativeReportPrefsStore.getState().categoryOrder!
    expect(afterMove.indexOf('urine')).toBe(afterMove.indexOf('microbio') - 1)

    fireEvent.click(within(panel).getByRole('button', { name: '恢復預設' }))
    expect(useCumulativeReportPrefsStore.getState().categoryOrder).toBeNull()
  })

  it('scrolls the owning section into view and highlights the cited column', async () => {
    const { rerender } = render(
      <CumulativeLabReport
        observations={crpObservations(5)}
        activeCategoryId="chem"
        focusAnalyteKey="CRP"
        focusDate="2026-09-01"
        focusNonce={3}
      />,
      { wrapper: TestProviders },
    )

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const crpHeader = section('chem')!.querySelector('[data-lab-test-key="CRP"]')
    expect(crpHeader).toHaveClass('bg-primary/10', 'border-b-primary')
    const focusedCell = section('chem')!.querySelector('[data-evidence-focus="true"]')
    expect(focusedCell).toHaveAttribute('data-lab-date', '2026-09-01')
    expect(focusedCell).toHaveAttribute('data-lab-test-key', 'CRP')
    expect(focusedCell).toHaveTextContent('1.4')
    // The cited date remains visible even though it is older than the default
    // latest-three range; the rest of the full history stays collapsed.
    expect(dateRows('chem')).toHaveLength(4)
    // Only the cited section highlights: 血液 also carries no CRP column, and
    // no other section may claim the focus key.
    expect(document.querySelectorAll('[data-lab-test-key="CRP"].bg-primary\\/10'))
      .toHaveLength(1)

    scrollIntoView.mockClear()
    rerender(
      <CumulativeLabReport
        observations={crpObservations(5)}
        activeCategoryId="chem"
        focusAnalyteKey="CRP"
        focusDate="2026-09-01"
        focusNonce={4}
      />,
    )
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
  })

  it('scrolls to the owning section when an analyte is picked from the finder', async () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    const finder = screen.getByRole('combobox', { name: '搜尋檢驗項目' })
    fireEvent.change(finder, { target: { value: 'CRP' } })
    const hit = await screen.findByRole('option', { name: /CRP/ })

    scrollIntoView.mockClear()
    fireEvent.click(within(hit).getByRole('button'))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(section('chem')!.querySelector('[data-lab-test-key="CRP"]'))
      .toHaveClass('bg-primary/10')
  })

  it('remembers the layout choice and hands the tabs layout back', () => {
    render(<CumulativeLabReport observations={crpObservations(5)} />, { wrapper: TestProviders })

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: '分頁' }))
    })

    expect(useCumulativeReportPrefsStore.getState().layoutMode).toBe('tabs')
    expect(screen.getByRole('tablist', { name: '累積報告分類' })).toBeInTheDocument()
    expect(document.querySelector('[data-cumulative-section]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('cumulative-report-prefs') ?? '{}'))
      .toMatchObject({ state: { layoutMode: 'tabs' } })
  })

  it('embeds the microbiology grid without its own title bar or scroller', () => {
    render(
      <CumulativeLabReport
        observations={[
          {
            id: 'tb-culture',
            status: 'final',
            effectiveDateTime: '2026-06-12T00:00:00+08:00',
            code: {
              text: 'TB Culture',
              coding: [{
                system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code',
                code: '13026C',
                display: 'TB Culture',
              }],
            },
            specimen: { display: 'Sputum' },
            valueString: 'No Growth for Mycobacterium',
          },
        ]}
      />,
      { wrapper: TestProviders },
    )

    const microbio = section('microbio')!
    expect(within(microbio).getByTestId('microbiology-cumulative-view')).toBeInTheDocument()
    // The section heading already names the panel.
    expect(within(microbio).queryByRole('heading', { name: '微生物累積結果' })).not.toBeInTheDocument()
    expect(within(microbio).getByTestId('microbiology-cumulative-view'))
      .not.toHaveClass('max-h-[60vh]')
  })

  it('renders urine valueRange cells as intervals instead of missing data', () => {
    const makeRange = (id: string, code: string, display: string, low: number, high: number) => ({
      id,
      status: 'final',
      effectiveDateTime: '2026-08-14',
      code: { coding: [{ system: 'http://loinc.org', code, display }] },
      specimen: { display: 'Urine' },
      valueRange: {
        low: { value: low, unit: '/HPF', system: 'http://unitsofmeasure.org', code: '/[HPF]' },
        high: { value: high, unit: '/HPF', system: 'http://unitsofmeasure.org', code: '/[HPF]' },
      },
    })
    render(
      <CumulativeLabReport
        observations={[
          makeRange('wbc-range', '5821-4', 'WBC/HPF', 0, 5),
          makeRange('epith-range', '5787-7', 'EPITH', 0, 5),
          makeRange('rbc-range', '5808-1', 'RBC/HPF', 30, 49),
        ]}
      />,
      { wrapper: TestProviders },
    )

    const urine = section('urine')!
    const rangeCells = [
      ...within(urine).getAllByText('0–5'),
      within(urine).getByText('30–49'),
    ].map((value) => value.closest('td'))

    expect(rangeCells).toHaveLength(3)
    for (const cell of rangeCells) {
      expect(cell).not.toHaveAttribute('aria-label', '無資料')
    }
    expect(urine).toHaveTextContent('/HPF')
    expect(within(urine).queryByRole('button', { name: /WBC.*趨勢/i })).not.toBeInTheDocument()
    expect(within(urine).queryByRole('button', { name: /EPITH.*趨勢/i })).not.toBeInTheDocument()
    expect(within(urine).queryByRole('button', { name: /RBC.*趨勢/i })).not.toBeInTheDocument()
  })

  it('renders LOINC 764-1 as BAND in the differential sequence', () => {
    const band = {
      id: 'band-form',
      status: 'final',
      effectiveDateTime: '2026-08-14',
      code: {
        text: 'Band form 嗜中性帶狀球',
        coding: [
          { system: 'http://loinc.org', code: '764-1' },
          { system: 'urn:oid:nhi.lab.code', code: '08013C', display: '白血球分類計數' },
          { system: 'https://example.org/CodeSystem/his-local-lab', code: 'BAND-FORM', display: 'Band form 嗜中性帶狀球' },
        ],
      },
      specimen: { display: 'Blood' },
      valueQuantity: { value: 2, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
    }
    render(<CumulativeLabReport observations={[band]} />, { wrapper: TestProviders })

    const cbc = section('cbc')!
    const standardizedKeys = [...cbc.querySelectorAll<HTMLElement>('[data-lab-test-key]')]
      .map((element) => element.dataset.labTestKey)
    expect(standardizedKeys.indexOf('BAND')).toBe(standardizedKeys.indexOf('NEU') + 1)
    expect(standardizedKeys.indexOf('LYM')).toBe(standardizedKeys.indexOf('BAND') + 1)
    expect(within(cbc).getByText('2')).toBeInTheDocument()
    expect(cbc).toHaveTextContent('%')
    expect(cbc).not.toHaveTextContent('Band form 嗜中性帶狀球')
  })
})
