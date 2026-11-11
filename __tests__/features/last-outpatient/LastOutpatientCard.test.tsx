import { fireEvent, render, screen, within } from '@testing-library/react'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { LastOutpatientCard } from '@/features/clinical-summary/last-outpatient'

const mockSetClinicianName = jest.fn((name: string) => { mockClinicianName = name || null })
const mockShowDetail = jest.fn()
let mockClinicianName: string | null = null
let mockClinicalData: Record<string, unknown> = {}

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/right-detail.provider', () => ({
  useOptionalRightDetail: () => ({ detail: null, showDetail: mockShowDetail }),
}))

jest.mock('@/src/application/hooks/use-outpatient-prefs.hook', () => ({
  useOutpatientPrefs: () => ({ clinicianName: mockClinicianName, setClinicianName: mockSetClinicianName }),
}))

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockClinicalData,
}))

// The report row is the reports tab's own component; here it only has to show
// which report landed under the visit and whether it starts open.
jest.mock('@/features/clinical-summary/reports/components/ReportRow', () => ({
  ReportRow: ({ row, defaultOpen }: { row: { id: string; title: string }; defaultOpen: string[] }) => (
    <div data-testid="report-row" data-open={String(defaultOpen.includes(row.id))}>{row.title}</div>
  ),
}))

// Days show their year only when it is not this year; pin "today" so the
// fixture's 2026 days read as this year. Only Date is faked.
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-11-07T12:00:00+08:00'),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
      'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
      'cancelIdleCallback', 'hrtime', 'performance'],
  })
})
afterAll(() => jest.useRealTimers())

// Radix Select needs these in jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})
const openSelect = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: 'Enter' })

// The visit the list has selected.
const shownVisit = () => within(screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })).getByRole('button', { pressed: true })

// Pick a visit from the list by its day.
const openVisit = (day: string) => fireEvent.click(
  within(screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })).getByRole('button', { name: new RegExp(day) }),
)

// The physician filter above the visit list.
const physicianFilter = () => screen.getByRole('combobox', { name: zhTW.lastOutpatient.physicianFilter })

// A lab row of the results table, found by the figure it shows.
const rowWith = (figure: string) => screen.queryAllByRole('row').find((row) => row.textContent?.includes(figure))

const HOSPITAL_META = {
  source: 'https://web9.vghtpe.gov.tw/emr/qemr/',
  tag: [{ system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }],
}
const CLOUD_META = { source: 'https://medcloud2.nhi.gov.tw/imme0008/IMME0008S01' }

const encounter = (id: string, meta: any, date: string, department?: string, physician?: string) => ({
  resourceType: 'Encounter',
  id,
  meta,
  status: 'finished',
  class: { code: 'AMB' },
  subject: { reference: 'Patient/p1' },
  period: { start: `${date}T09:00:00+08:00` },
  ...(department ? { serviceType: { text: department } } : {}),
  ...(physician ? { participant: [{ individual: { display: physician } }] } : {}),
})

const lab = (
  id: string,
  loinc: string,
  text: string,
  value: number,
  unit: string,
  date: string,
  encounterId: string,
  extra: Record<string, unknown> = {},
) => ({
  resourceType: 'Observation',
  id,
  meta: HOSPITAL_META,
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { coding: [{ system: 'http://loinc.org', code: loinc, display: text }], text },
  valueQuantity: { value, unit },
  effectiveDateTime: `${date}T09:40:00+08:00`,
  encounter: { reference: `Encounter/${encounterId}` },
  ...extra,
})

function chart() {
  return {
    encounters: [
      encounter('h-old', HOSPITAL_META, '2026-07-10', '心臟內科', '陳怡君'),
      encounter('h-mine', HOSPITAL_META, '2026-10-09', '心臟內科', '陳怡君'),
      encounter('h-other', HOSPITAL_META, '2026-10-20', '腎臟內科', '李建國'),
      encounter('cloud-newest', CLOUD_META, '2026-10-25', '家醫科'),
    ],
    observations: [
      lab('cr-old', '2160-0', 'Creatinine', 1.12, 'mg/dL', '2026-07-10', 'h-old'),
      lab('cr-now', '2160-0', 'Creatinine', 1.26, 'mg/dL', '2026-10-09', 'h-mine', {
        referenceRange: [{ low: { value: 0.7, unit: 'mg/dL' }, high: { value: 1.3, unit: 'mg/dL' } }],
      }),
      lab('hb-now', '718-7', 'Hemoglobin', 12.6, 'g/dL', '2026-10-09', 'h-mine', {
        referenceRange: [{ low: { value: 13.5, unit: 'g/dL' }, high: { value: 17.5, unit: 'g/dL' } }],
        interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'L' }] }],
      }),
      // No source flag: abnormal only by its reference range.
      lab('bnp-now', '33762-6', 'NT-proBNP', 612, 'pg/mL', '2026-10-09', 'h-mine', {
        referenceRange: [{ high: { value: 125, unit: 'pg/mL' } }],
      }),
      // Same day, but import only inferred the link: not ordered at this visit.
      lab('glu-inferred', '1558-6', 'Glucose AC', 108, 'mg/dL', '2026-10-09', 'h-mine', { _encounterInferred: true }),
      lab('k-other', '2823-3', 'Potassium', 4.6, 'mmol/L', '2026-10-20', 'h-other'),
      // A combined draw: one request served both clinics' orders, so the
      // result carries no single encounter, only its orders' visits.
      { ...lab('tsh-shared', '3016-3', 'TSH', 2.2, 'uIU/mL', '2026-10-20', 'h-other'), encounter: undefined, _orderEncounterIds: ['h-other', 'h-mine'] },
    ],
    diagnosticReports: [{
      resourceType: 'DiagnosticReport',
      id: 'echo-1',
      meta: HOSPITAL_META,
      status: 'final',
      code: { text: 'Echocardiography' },
      conclusion: 'Mildly reduced LV systolic function, LVEF 48%.',
      effectiveDateTime: '2026-10-14T10:00:00+08:00',
      encounter: { reference: 'Encounter/h-mine' },
    }],
    conditions: [],
    resourceReady: { encounters: true, diagnosticReports: true, observations: true, conditions: true },
  }
}

describe('LastOutpatientCard', () => {
  beforeEach(() => {
    mockClinicianName = null
    mockClinicalData = chart()
    mockSetClinicianName.mockClear()
    mockShowDetail.mockClear()
  })

  it('opens on the latest hospital outpatient visit, never a newer cloud visit', () => {
    render(<LastOutpatientCard />)
    const card = screen.getByTestId('last-outpatient')
    expect(shownVisit()).toHaveTextContent('2026/10/20')
    expect(within(card).getByText('腎臟內科')).toBeInTheDocument()
    expect(screen.queryByText('2026/10/25')).not.toBeInTheDocument()
    expect(rowWith('4.6')).toBeTruthy()
    // The shared result is under this visit too.
    expect(rowWith('2.2')).toBeTruthy()
  })

  it('shows what the picked visit ordered, including a later echo, and marks the clinician’s own visit', () => {
    mockClinicianName = '陳怡君 醫師'
    render(<LastOutpatientCard />)
    // Still the newest visit first, whoever saw the patient.
    expect(shownVisit()).toHaveTextContent('2026/10/20')
    openVisit('2026/10/09')

    expect(shownVisit()).toHaveTextContent('2026/10/09')
    expect(screen.getByText('陳怡君（您）')).toBeInTheDocument()
    expect(rowWith('1.26')).toBeTruthy()
    expect(rowWith('1.26')?.textContent).toMatch(/1\.12/)
    expect(screen.getByTestId('report-row')).toHaveTextContent('Echocardiography')
    expect(screen.getByTestId('report-row')).toHaveAttribute('data-open', 'true')
    // Ordered elsewhere, or only date-matched: not part of this visit.
    expect(rowWith('4.6')).toBeUndefined()
    expect(rowWith('108')).toBeUndefined()
    expect(screen.getByText(/開立 5 項/)).toBeInTheDocument()
    expect(screen.getByText(/1 項與其他門診合併採檢/)).toBeInTheDocument()
    expect(rowWith('2.2')).toBeTruthy()
    // Hb is flagged L by the source: abnormal by its flag, with the code shown.
    expect(screen.getByText('異常 2')).toBeInTheDocument()
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('filters labs to abnormal results and keeps the free-text reports', () => {
    mockClinicianName = '陳怡君'
    render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    fireEvent.click(screen.getByRole('button', { name: '異常' }))

    expect(screen.getByRole('button', { name: '異常' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowWith('1.26')).toBeUndefined()
    expect(rowWith('12.6')).toBeTruthy()
    expect(rowWith('612')).toBeTruthy()
    expect(screen.getByLabelText(zhTW.reports.referenceComparison.above)).toHaveTextContent('↑')
    expect(screen.getByTestId('report-row')).toBeInTheDocument()
  })

  it('lists every physician by default and narrows the list to one physician', () => {
    render(<LastOutpatientCard />)
    expect(physicianFilter()).toHaveTextContent(zhTW.lastOutpatient.physicianFilterAll)
    // The tab no longer asks for the clinician's name.
    expect(screen.queryByRole('combobox', { name: zhTW.settings.clinicianNameLabel })).not.toBeInTheDocument()

    openSelect(physicianFilter())
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([`${zhTW.lastOutpatient.physicianFilterAll}3`, '陳怡君2', '李建國1'])
    fireEvent.click(screen.getByRole('option', { name: /陳怡君/ }))

    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringMatching(/2026\/10\/09/),
      expect.stringMatching(/2026\/07\/10/),
    ])
    // The shown visit moves to that physician's latest.
    expect(shownVisit()).toHaveTextContent('2026/10/09')
    expect(rowWith('1.26')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.physicianFilterClear }))
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    expect(physicianFilter()).toHaveTextContent(zhTW.lastOutpatient.physicianFilterAll)
  })

  it('keeps the picked visit when the filter still lists it', () => {
    render(<LastOutpatientCard />)
    openVisit('2026/07/10')
    openSelect(physicianFilter())
    fireEvent.click(screen.getByRole('option', { name: /陳怡君/ }))
    expect(shownVisit()).toHaveTextContent('2026/07/10')
  })

  it('follows the shown visit across filter changes, not an earlier pick', () => {
    render(<LastOutpatientCard />)
    openVisit('2026/07/10')
    openSelect(physicianFilter())
    fireEvent.click(screen.getByRole('option', { name: /李建國/ }))
    expect(shownVisit()).toHaveTextContent('2026/10/20')

    // The 07/10 pick is gone: back on 陳怡君, her latest visit opens.
    openSelect(physicianFilter())
    fireEvent.click(screen.getByRole('option', { name: /陳怡君/ }))
    expect(shownVisit()).toHaveTextContent('2026/10/09')

    // Clearing the filter keeps the visit on screen.
    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.physicianFilterClear }))
    expect(shownVisit()).toHaveTextContent('2026/10/09')
  })

  it('lists the clinician first in the filter, marked as theirs', () => {
    mockClinicianName = '李建國'
    render(<LastOutpatientCard />)
    openSelect(physicianFilter())
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options.slice(1)).toEqual(['李建國（您）1', '陳怡君2'])
  })

  it('hides the filter when every visit has the same physician', () => {
    const data = chart()
    mockClinicalData = { ...data, encounters: data.encounters.filter((e: any) => e.id !== 'h-other') }
    render(<LastOutpatientCard />)
    expect(screen.queryByRole('combobox', { name: zhTW.lastOutpatient.physicianFilter })).not.toBeInTheDocument()
  })

  it('opens the shared trend pane for a lab result', () => {
    render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    const row = rowWith('1.26')!
    fireEvent.click(within(row).getByRole('button', { name: '查看趨勢' }))
    expect(mockShowDetail).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'last-outpatient:observation-longitudinal:cr-now',
    }))
  })

  it('names the usual 本次 and 前次 days in the column headings, and dates only a result from another day', () => {
    const { unmount } = render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    const headers = () => screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers()).toEqual(expect.arrayContaining(['本次10/09', '前次07/10']))
    expect(within(rowWith('1.26')!).getAllByRole('cell')[1]).not.toHaveTextContent('10/09')
    expect(within(rowWith('1.26')!).getAllByRole('cell')[3]).toHaveTextContent(/^1\.12$/)
    unmount()

    const data = chart()
    mockClinicalData = {
      ...data,
      observations: data.observations.map((o: any) => o.id === 'cr-now' ? { ...o, effectiveDateTime: '2026-10-12T08:10:00+08:00' } : o),
    }
    render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    expect(headers()).toEqual(expect.arrayContaining(['本次10/09']))
    expect(within(rowWith('1.26')!).getAllByRole('cell')[1]).toHaveTextContent(/1\.26.*10\/12/)
    expect(within(rowWith('12.6')!).getAllByRole('cell')[1]).not.toHaveTextContent('10/09')
  })

  it('adds the year to a day from another year', () => {
    const data = chart()
    mockClinicalData = {
      ...data,
      observations: data.observations.map((o: any) => o.id === 'cr-old' ? { ...o, effectiveDateTime: '2025-12-10T08:10:00+08:00' } : o),
    }
    render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(expect.arrayContaining(['前次25/12/10']))
  })

  it('lists every hospital visit, any physician, and switches to one', () => {
    mockClinicianName = '陳怡君'
    render(<LastOutpatientCard />)
    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    const visits = within(list).getAllByRole('button').map((button) => button.textContent)
    expect(visits).toHaveLength(3)
    expect(visits[0]).toMatch(/2026\/10\/20.*腎臟內科.*李建國/)
    expect(visits[1]).toMatch(/2026\/10\/09.*陳怡君（您）/)
    // A visit with no linked result says so.
    expect(visits[2]).toMatch(/2026\/07\/10/)
    expect(visits.some((text) => text?.includes('2026/10/25'))).toBe(false)
    expect(shownVisit()).toHaveTextContent('2026/10/20')

    fireEvent.click(within(list).getByRole('button', { name: /2026\/10\/09/ }))
    expect(shownVisit()).toHaveTextContent('2026/10/09')
    expect(rowWith('1.26')).toBeTruthy()
    expect(rowWith('4.6')).toBeUndefined()
  })

  it('names only the clinic in the visit list and keeps the room code and session in the header', () => {
    const data = chart()
    mockClinicalData = {
      ...data,
      encounters: data.encounters.map((e: any) => e.id === 'h-other' ? { ...e, serviceType: { text: '003(心臟內科上午)' } } : e),
    }
    render(<LastOutpatientCard />)
    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    const chip = within(list).getByRole('button', { name: /2026\/10\/20/ })
    expect(chip).toHaveTextContent('心臟內科 · 李建國')
    expect(chip).not.toHaveTextContent('003')
    expect(chip).toHaveAttribute('title', '2026/10/20 · 003(心臟內科上午) · 李建國')

    fireEvent.click(chip)
    expect(screen.getAllByText('003(心臟內科上午)').length).toBeGreaterThan(0)
  })

  it('mutes a visit with nothing linked yet', () => {
    mockClinicalData = { ...chart(), observations: chart().observations.filter((o: any) => o.id !== 'cr-old') }
    render(<LastOutpatientCard />)
    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    expect(within(list).getByRole('button', { name: /2026\/07\/10/ })).toHaveTextContent(zhTW.lastOutpatient.noResults)
    expect(within(list).getByRole('button', { name: /2026\/10\/09/ })).not.toHaveTextContent(zhTW.lastOutpatient.noResults)
  })

  it('counts each visit’s items the way the summary does, and groups visits by year', () => {
    render(<LastOutpatientCard />)
    openVisit('2026/10/09')
    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    const mine = within(list).getByRole('button', { name: /2026\/10\/09/ })
    // 開立 5 項 in the summary is the same count the list shows.
    expect(screen.getByText(/開立 5 項/)).toBeInTheDocument()
    expect(mine).toHaveTextContent(zhTW.lastOutpatient.visitItemCount.replace('{count}', '5'))
    expect(within(list).getAllByText('2026')).toHaveLength(1)
  })

  it('folds the visit list and remembers it', () => {
    window.localStorage.removeItem('mediprisma:last-outpatient:visit-list-collapsed')
    const { unmount } = render(<LastOutpatientCard />)
    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.collapseVisits }))
    expect(screen.getByRole('button', { name: zhTW.lastOutpatient.expandVisits })).toBeInTheDocument()
    expect(window.localStorage.getItem('mediprisma:last-outpatient:visit-list-collapsed')).toBe('1')
    unmount()

    render(<LastOutpatientCard />)
    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.expandVisits }))
    expect(window.localStorage.getItem('mediprisma:last-outpatient:visit-list-collapsed')).toBe('0')
    expect(screen.queryByRole('button', { name: zhTW.lastOutpatient.expandVisits })).not.toBeInTheDocument()
  })

  it('says reports are still loading rather than that nothing was ordered', () => {
    const { useProgressiveImportStore } = jest.requireActual('@/src/application/stores/progressive-import.store')
    useProgressiveImportStore.setState({ current: { phase: 'reports-pending' } })
    mockClinicalData = { ...chart(), observations: [], diagnosticReports: [] }
    render(<LastOutpatientCard />)
    expect(screen.getByRole('status')).toHaveTextContent(zhTW.lastOutpatient.reportsPending)
    // Nor does the visit list call any visit empty yet.
    expect(screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })).not.toHaveTextContent(zhTW.lastOutpatient.noResults)
    useProgressiveImportStore.setState({ current: null })
  })

  it('breaks a multi-clause reference range at its own separators, not mid-token', () => {
    mockClinicalData = {
      ...chart(),
      observations: [
        ...chart().observations,
        // Fictional values; text shaped like a hospital urine ACR range.
        lab('acr', '9318-7', 'Malb/Ucre', 0.05, '', '2026-10-20', 'h-other', {
          referenceRange: [{ text: '<0.03:normal;0.03~0.3:microalbuminuria;>0.3:overt proteinuria' }],
        }),
        lab('alt', '1742-6', 'ALT', 20, 'U/L', '2026-10-20', 'h-other', {
          referenceRange: [{ text: 'M:&lt;41; F:&lt;33 U/L' }],
        }),
        lab('a1c', '4548-4', 'HbA1c', 6.1, '%', '2026-10-20', 'h-other', {
          referenceRange: [{ text: 'Healthy: 4.8~5.9% , Prediabetes: 5.7-6.4% , Diabetes: >=6.5%' }],
        }),
      ],
    }
    render(<LastOutpatientCard />)
    for (const clause of ['<0.03:normal', '0.03~0.3:microalbuminuria', '>0.3:overt proteinuria', 'Healthy: 4.8~5.9%', 'Prediabetes: 5.7-6.4%', 'Diabetes: >=6.5%', 'M:&lt;41', 'F:&lt;33 U/L']) {
      const shown = screen.getAllByText(clause)
      expect(shown.length).toBeGreaterThan(0)
      shown.forEach((el) => expect(el).toHaveClass('block'))
    }
  })

  it('lists the orders a visit wrote that have no report yet, and marks a booked examination', () => {
    const data = chart()
    data.encounters = data.encounters.map((visit: any) => visit.id === 'h-other' ? {
      ...visit,
      _awaitingOrders: [
        { id: 'o-bnp', label: 'NT-pro-BNP', appointment: false },
        { id: 'o-echo', label: 'COLOR, ECHOCARDIOGRAM', appointment: true },
      ],
    } : visit)
    mockClinicalData = data
    render(<LastOutpatientCard />)
    const section = screen.getByTestId('last-outpatient-awaiting')
    expect(section).toHaveTextContent(zhTW.lastOutpatient.awaitingTitle)
    expect(section).toHaveTextContent('2 項')
    expect(within(section).getByText('NT-pro-BNP').closest('li')).not.toHaveTextContent(zhTW.lastOutpatient.awaitingAppointment)
    expect(within(section).getByText('COLOR, ECHOCARDIOGRAM').closest('li')).toHaveTextContent(zhTW.lastOutpatient.awaitingAppointment)
    expect(section).toHaveTextContent(zhTW.lastOutpatient.awaitingNote)
    // Another visit's orders stay with that visit.
    openVisit('2026/10/09')
    expect(screen.queryByTestId('last-outpatient-awaiting')).not.toBeInTheDocument()
  })

  it('says a visit with only unreported orders is awaiting reports, not empty', () => {
    const data = chart()
    data.observations = data.observations.filter((o: any) => o.id !== 'cr-old')
    data.encounters = data.encounters.map((visit: any) => visit.id === 'h-old'
      ? { ...visit, _awaitingOrders: [{ id: 'o-cbc', label: 'CBC', appointment: false }] } : visit)
    mockClinicalData = data
    render(<LastOutpatientCard />)
    const list = screen.getByRole('group', { name: zhTW.lastOutpatient.visitPicker })
    const chip = within(list).getByRole('button', { name: /2026\/07\/10/ })
    expect(chip).toHaveTextContent('待報告 1 項')
    expect(chip).not.toHaveTextContent(zhTW.lastOutpatient.noResults)
    openVisit('2026/07/10')
    expect(screen.getByTestId('last-outpatient-awaiting')).toHaveTextContent('CBC')
    expect(screen.queryByText(zhTW.lastOutpatient.empty)).not.toBeInTheDocument()
  })
})
