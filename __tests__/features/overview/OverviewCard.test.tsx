/**
 * 總覽 rendered against the real demo bundle.
 *
 * The point of this suite is the contract the design brief insists on: the
 * four header tiles and the four card headers must always report the SAME
 * numbers, and narrowing the range must narrow them together. The clock is
 * pinned so the assertions do not decay as the demo bundle ages.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import bundle from '@/public/demo/demo-bundle.json'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { OverviewCard } from '@/features/clinical-summary/overview'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'

// 2026-06-15 — the one anchor where the demo bundle has all four data kinds
// inside the default 3-month window AND strictly fewer inside the 1-month one.
// Pinned so these assertions do not decay as real time moves past the fixture.
const FIXED_NOW = new Date('2026-06-15T09:00:00+08:00').getTime()

jest.mock('@/src/shared/hooks/use-now.hook', () => ({
  useNow: () => new Date('2026-06-15T09:00:00+08:00').getTime(),
}))

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null, anonymousUid: null }),
}))

jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ setActiveTab: jest.fn(), revealTab: jest.fn() }),
}))

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

const mockUseClinicalData = jest.fn()
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockUseClinicalData(),
}))

const resources: any[] = (bundle as any).entry.map((entry: any) => entry.resource)
const byType = (type: string) => resources.filter((resource) => resource.resourceType === type)
const observations = byType('Observation')
// The live hook re-attaches member Observations when `_include` came back
// empty; mirror that so report rows carry their results here too.
const diagnosticReports = byType('DiagnosticReport').map((report: any) => ({
  ...report,
  _observations: (report.result ?? [])
    .map((reference: any) => observations.find((o: any) => `Observation/${o.id}` === reference.reference))
    .filter(Boolean),
}))

const clinicalData = {
  encounters: byType('Encounter'),
  medications: byType('MedicationRequest'),
  diagnosticReports,
  imagingStudies: [],
  observations,
  procedures: byType('Procedure'),
  conditions: byType('Condition'),
  documentReferences: byType('DocumentReference'),
  compositions: byType('Composition'),
  resourceReady: new Proxy({}, { get: () => true }) as Record<string, boolean>,
  error: null,
}

/** Number carried by a header tile (e.g. 42 in "42 項 · 異常 6"). */
function tileValue(section: string): number {
  const tile = document.querySelector(`[data-overview-tile="${section}"]`)
  expect(tile).toBeTruthy()
  const digits = tile!.textContent?.match(/\d+/)
  return digits ? Number(digits[0]) : Number.NaN
}

/** First number in a section card's header count (e.g. 42 in "42 項 · 5 次採檢"). */
function sectionHeaderValue(sectionId: string): number {
  const card = document.getElementById(`overview-section-${sectionId}`)
  expect(card).toBeTruthy()
  const header = card!.querySelector('[data-slot="card-title"]')
  const digits = header?.textContent?.match(/\d+/)
  return digits ? Number(digits[0]) : Number.NaN
}

describe('OverviewCard (demo bundle)', () => {
  const originalResizeObserver = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })
  afterAll(() => { globalThis.ResizeObserver = originalResizeObserver })
  beforeEach(() => {
    mockUseClinicalData.mockReturnValue(clinicalData)
    // The lab mode is a remembered preference; each test starts from none.
    useOutpatientPrefsStore.setState({ byUser: {} })
  })

  it('shows ongoing medication before finished medication in card and dialog', () => {
    const medication = (id: string, title: string, start: string, days: number) => ({
      resourceType: 'MedicationRequest', id, status: 'active', intent: 'order',
      authoredOn: start,
      medicationCodeableConcept: { text: title },
      dispenseRequest: { expectedSupplyDuration: { value: days, unit: 'days', code: 'd' } },
    })
    mockUseClinicalData.mockReturnValue({ ...clinicalData, medications: [
      medication('finished', 'Synthetic finished medication', '2026-06-01', 7),
      medication('ongoing', 'Synthetic ongoing medication', '2026-06-01', 28),
    ] })
    render(<OverviewCard />)
    const card = document.getElementById('overview-section-meds')!
    const expectOngoingFirst = (container: HTMLElement) => {
      const ongoing = within(container).getByText('Synthetic ongoing medication')
      const finished = within(container).getByText('Synthetic finished medication')
      expect(ongoing.compareDocumentPosition(finished) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expectOngoingFirst(card)
    expect(within(card).getByText('已用完 8 天')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: zhTW.overview.expandList }))
    expectOngoingFirst(screen.getByRole('dialog'))
  })

  it('does not call an ingredient-equivalent brand switch a new therapy', () => {
    const medication = (id: string, code: string, title: string, start: string) => ({
      resourceType: 'MedicationRequest', id, status: 'active', intent: 'order', authoredOn: start,
      medicationCodeableConcept: { text: title, coding: [
        { system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code', code },
        { system: 'http://www.whocc.no/atc', code: 'M04AA03', display: 'febuxostat' },
      ] },
      drugTerminology: { ingredientText: ' Febuxostat ' },
      dispenseRequest: { expectedSupplyDuration: { value: 28, unit: 'days', code: 'd' } },
    })
    mockUseClinicalData.mockReturnValue({ ...clinicalData, medications: [
      medication('old-brand', 'BC25427100', 'Feburic 80 mg', '2026-03-01'),
      medication('new-brand', 'AC61850100', 'Fekuton 80 mg', '2026-06-01'),
    ] })
    render(<OverviewCard />)
    const card = document.getElementById('overview-section-meds')!
    expect(within(card).getByText('Febuxostat')).toBeInTheDocument()
    expect(within(card).queryByText(zhTW.overview.meds.added)).not.toBeInTheDocument()
  })

  it('keeps all seven collection days and an older-only analyte in the expanded list', () => {
    const days = ['2026-04-01', '2026-04-08', '2026-04-15', '2026-05-01', '2026-05-08', '2026-06-01', '2026-06-08']
    const draws = days.map((day, index) => ({
      resourceType: 'Observation', id: `seven-days-${index}`, status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
      effectiveDateTime: `${day}T09:00:00+08:00`,
      valueQuantity: { value: 11 + index / 10, unit: 'g/dL' },
    }))
    mockUseClinicalData.mockReturnValue({ ...clinicalData, observations: [
      ...draws,
      { ...draws[0], id: 'culture-only-day', effectiveDateTime: '2026-04-02T09:00:00+08:00',
        code: { coding: [{ system: 'http://loinc.org', code: '600-7', display: 'Blood culture' }] },
        valueQuantity: undefined, valueString: 'No growth',
      },
      { ...draws[0], id: 'older-only-potassium',
        code: { coding: [{ system: 'http://loinc.org', code: '2823-3', display: 'Potassium' }] },
        valueQuantity: { value: 6.7, unit: 'mmol/L' },
      },
    ] })
    render(<OverviewCard />)
    expect(sectionHeaderValue('labs')).toBe(9)
    const card = document.getElementById('overview-section-labs')!
    fireEvent.click(within(card).getByRole('button', { name: zhTW.overview.expandList }))
    const dialog = within(screen.getByRole('dialog'))
    for (const day of days) expect(dialog.getByText(day.slice(5).replace('-', '/'))).toBeInTheDocument()
    expect(dialog.getByText('6.7')).toBeInTheDocument()
    expect(dialog.queryByText('04/02')).not.toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '全部' }))
    expect(dialog.getByText('04/02')).toBeInTheDocument()
    expect(dialog.getByText('No growth')).toBeInTheDocument()
  })

  it('shows abnormal non-common analytes when switching from 常用 to 異常', () => {
    const lab = ({
      id,
      code,
      display,
      value,
      interpretation,
      day = '2026-06-01',
    }: {
      id: string
      code: string
      display: string
      value: number
      interpretation?: string
      day?: string
    }) => ({
      resourceType: 'Observation', id, status: 'final',
      category: [{ coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'laboratory',
      }] }],
      code: { coding: [{ system: 'http://loinc.org', code, display }] },
      effectiveDateTime: `${day}T09:00:00+08:00`,
      valueQuantity: { value, unit: code === '6690-2' ? 'K/uL' : 'U/L' },
      interpretation: interpretation
        ? [{ coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          code: interpretation,
        }] }]
        : undefined,
    })
    mockUseClinicalData.mockReturnValue({
      ...clinicalData,
      observations: [
        // A newer normal WBC belongs to 常用. The older AST is outside 常用
        // but abnormal, and must not be displaced by the empty newer date.
        lab({ id: 'normal-common-wbc', code: '6690-2', display: 'Leukocytes', value: 5.5, day: '2026-06-08' }),
        lab({ id: 'abnormal-non-common-ast', code: '1920-8', display: 'Aspartate aminotransferase', value: 987, interpretation: 'H' }),
      ],
    })

    render(<OverviewCard />)

    const card = document.getElementById('overview-section-labs')!
    const labs = within(card)
    expect(labs.getByRole('button', { name: zhTW.overview.labs.pinned })).toHaveAttribute('aria-pressed', 'true')
    expect(labs.getByText('5.5')).toBeInTheDocument()
    expect(labs.queryByText('987 ↑')).not.toBeInTheDocument()

    fireEvent.click(labs.getByRole('button', { name: zhTW.overview.labs.abnormalOnly }))

    expect(labs.getByRole('button', { name: zhTW.overview.labs.abnormalOnly })).toHaveAttribute('aria-pressed', 'true')
    expect(labs.getByRole('button', { name: zhTW.overview.labs.pinned })).toHaveAttribute('aria-pressed', 'false')
    expect(labs.getByText('06/01')).toBeInTheDocument()
    expect(labs.queryByText('06/08')).not.toBeInTheDocument()
    expect(labs.getByText('987 ↑')).toBeInTheDocument()
    expect(labs.queryByText('5.5')).not.toBeInTheDocument()
  })

  it('exposes the complete narrative laboratory result on click', async () => {
    const narrative = 'Synthetic culture result\n' + 'Organism and susceptibility details. '.repeat(30)
    mockUseClinicalData.mockReturnValue({ ...clinicalData, observations: [{
      resourceType: 'Observation', id: 'synthetic-culture', status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '600-7', display: 'Blood culture' }] },
      effectiveDateTime: '2026-06-01T09:00:00+08:00', valueString: narrative,
    }] })
    render(<OverviewCard />)
    const card = document.getElementById('overview-section-labs')!
    fireEvent.click(within(card).getByRole('button', { name: zhTW.overview.expandList }))
    const dialog = screen.getByRole('dialog')
    const trigger = [...dialog.querySelectorAll('span[tabindex="0"]')].find(element => element.textContent === narrative)!
    expect(trigger).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Organism and susceptibility details.')
  })

  it('keeps a prescription started before the window when its supply extends into it', () => {
    mockUseClinicalData.mockReturnValue({ ...clinicalData, medications: [{
      resourceType: 'MedicationRequest', id: 'long-supply', status: 'active', intent: 'order',
      authoredOn: '2026-03-01',
      medicationCodeableConcept: { text: 'Synthetic long supply medication' },
      dispenseRequest: { expectedSupplyDuration: { value: 120, unit: 'days', code: 'd' } },
    }] })
    render(<OverviewCard />)
    const card = document.getElementById('overview-section-meds')!
    expect(within(card).getByText('Synthetic long supply medication')).toBeInTheDocument()
  })

  it('renders the four sections with the default 3-month window', () => {
    render(<OverviewCard />)

    expect(screen.getByText('近3個月總覽')).toBeInTheDocument()
    // 2026/03/15 – 2026/06/15 in the zh-TW Intl format.
    expect(screen.getByText(/2026\/03\/15/)).toBeInTheDocument()

    for (const section of ['labs', 'reports', 'meds', 'visits']) {
      expect(document.getElementById(`overview-section-${section}`)).toBeInTheDocument()
    }
    for (const title of [
      zhTW.overview.sections.labs,
      zhTW.overview.sections.reports,
      zhTW.overview.sections.meds,
      zhTW.overview.sections.visits,
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
    // No ResizeObserver in jsdom, so the card stays in its stacked, scrollable
    // presentation and every row renders.
    expect(screen.getByTestId('overview-card')).toHaveAttribute('data-overview-layout', 'stacked')
  })

  it('starts at 6 months when the first 3 months contain no common lab result', async () => {
    const lab = (id: string, day: string, code: string, display: string, value: number) => ({
      resourceType: 'Observation', id, status: 'final',
      category: [{ coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'laboratory',
      }] }],
      code: { coding: [{ system: 'http://loinc.org', code, display }] },
      effectiveDateTime: `${day}T09:00:00+08:00`,
      valueQuantity: { value, unit: code === '6690-2' ? 'K/uL' : 'U/L' },
    })
    mockUseClinicalData.mockReturnValue({
      ...clinicalData,
      observations: [
        // AST is in range but is not part of the 常用 short list.
        lab('recent-ast', '2026-06-01', '1920-8', 'Aspartate aminotransferase', 24),
        // WBC is a 常用 analyte, just outside 3 months and inside 6 months.
        lab('older-wbc', '2026-02-15', '6690-2', 'Leukocytes', 5.5),
      ],
    })

    render(<OverviewCard />)

    await waitFor(() => expect(screen.getByText('近6個月總覽')).toBeInTheDocument())
    expect(screen.getByText(/2025\/12\/15/)).toBeInTheDocument()
    expect(screen.getByText('5.5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.ranges[3] }))
    await waitFor(() => expect(screen.getByText('近3個月總覽')).toBeInTheDocument())
    expect(screen.queryByText('近6個月總覽')).not.toBeInTheDocument()
  })

  it('continues to 1 year when 6 months still contain no common lab result', async () => {
    const lab = (id: string, day: string, code: string, display: string, value: number) => ({
      resourceType: 'Observation', id, status: 'final',
      category: [{ coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'laboratory',
      }] }],
      code: { coding: [{ system: 'http://loinc.org', code, display }] },
      effectiveDateTime: `${day}T09:00:00+08:00`,
      valueQuantity: { value, unit: code === '6690-2' ? 'K/uL' : 'U/L' },
    })
    mockUseClinicalData.mockReturnValue({
      ...clinicalData,
      observations: [
        lab('recent-ast', '2026-05-01', '1920-8', 'Aspartate aminotransferase', 24),
        // Ten months old: outside 6 months, but inside the one-year fallback.
        lab('older-wbc', '2025-08-15', '6690-2', 'Leukocytes', 4.8),
      ],
    })

    render(<OverviewCard />)

    await waitFor(() => expect(screen.getByText('近1年總覽')).toBeInTheDocument())
    expect(screen.getByText(/2025\/06\/15/)).toBeInTheDocument()
    expect(screen.getByText('4.8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: zhTW.overview.ranges[12] })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.ranges[6] }))
    await waitFor(() => expect(screen.getByText('近6個月總覽')).toBeInTheDocument())
    expect(screen.queryByText('近1年總覽')).not.toBeInTheDocument()
  })

  it('reports the same counts on the jump tiles and the card headers', () => {
    render(<OverviewCard />)

    for (const section of ['labs', 'reports', 'meds', 'visits']) {
      expect(tileValue(section)).toBe(sectionHeaderValue(section))
    }
  })

  it('finds real data in this window rather than rendering four empty cards', () => {
    render(<OverviewCard />)

    expect(tileValue('visits')).toBeGreaterThan(0)
    expect(tileValue('meds')).toBeGreaterThan(0)
    expect(tileValue('labs')).toBeGreaterThan(0)
    expect(tileValue('reports')).toBeGreaterThan(0)
  })

  it('narrows every count when the range chip drops to 1 month', () => {
    render(<OverviewCard />)

    const before = {
      labs: tileValue('labs'),
      reports: tileValue('reports'),
      meds: tileValue('meds'),
      visits: tileValue('visits'),
    }

    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.ranges[1] }))

    expect(screen.getByText('近1個月總覽')).toBeInTheDocument()
    for (const section of ['labs', 'reports', 'meds', 'visits'] as const) {
      expect(tileValue(section)).toBeLessThanOrEqual(before[section])
      // Tiles and headers stay in lockstep after a range change too.
      expect(tileValue(section)).toBe(sectionHeaderValue(section))
    }
    // A narrower window must actually remove something from this bundle.
    expect(tileValue('visits')).toBeLessThan(before.visits)
  })

  it('keeps every section anchored while the chart holds no data at all', () => {
    mockUseClinicalData.mockReturnValue({
      ...clinicalData,
      encounters: [],
      medications: [],
      diagnosticReports: [],
      observations: [],
      procedures: [],
      conditions: [],
      documentReferences: [],
      compositions: [],
    })
    render(<OverviewCard />)

    for (const section of ['labs', 'reports', 'meds', 'visits']) {
      const card = document.getElementById(`overview-section-${section}`)
      expect(card).toBeInTheDocument()
      expect(within(card as HTMLElement).getByText(zhTW.overview.emptyWindow)).toBeInTheDocument()
    }
  })

  it('pins the clock used by the window so the assertions above are stable', () => {
    // Guards the fixture assumption rather than the component: if the demo
    // bundle stops carrying labs around this date, this test says so first.
    const labDays = observations
      .map((observation: any) => observation.effectiveDateTime)
      .filter(Boolean)
      .map((value: string) => new Date(value).getTime())
    expect(labDays.some((time: number) => time <= FIXED_NOW)).toBe(true)
  })
})
