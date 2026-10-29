import { fireEvent, render, screen, within } from '@testing-library/react'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { LastOutpatientCard } from '@/features/clinical-summary/last-outpatient'

const mockRevealTab = jest.fn()
let mockClinicianName: string | null = null
let mockClinicalData: Record<string, unknown> = {}

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: mockRevealTab }),
}))

jest.mock('@/src/application/hooks/use-outpatient-prefs.hook', () => ({
  useOutpatientPrefs: () => ({ clinicianName: mockClinicianName }),
}))

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockClinicalData,
}))

// The report row is the reports tab's own component; here it only has to show
// which report landed under the visit.
jest.mock('@/features/clinical-summary/reports/components/ReportRow', () => ({
  ReportRow: ({ row }: { row: { title: string } }) => <div data-testid="report-row">{row.title}</div>,
}))

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
    mockRevealTab.mockClear()
  })

  it('opens on the latest hospital outpatient visit, never a newer cloud visit', () => {
    render(<LastOutpatientCard />)
    const card = screen.getByTestId('last-outpatient')
    expect(within(card).getByText('2026/10/20')).toBeInTheDocument()
    expect(within(card).getByText('腎臟內科')).toBeInTheDocument()
    expect(screen.queryByText('2026/10/25')).not.toBeInTheDocument()
    expect(rowWith('4.6')).toBeTruthy()
    // The shared result is under this visit too.
    expect(rowWith('2.2')).toBeTruthy()
  })

  it('opens on the clinician’s own last visit and shows what it ordered, including a later echo', () => {
    mockClinicianName = '陳怡君 醫師'
    render(<LastOutpatientCard />)

    expect(within(screen.getByTestId('last-outpatient')).getByText('2026/10/09')).toBeInTheDocument()
    expect(screen.getByText('陳怡君（您）')).toBeInTheDocument()
    expect(rowWith('1.26')).toBeTruthy()
    expect(rowWith('1.26')?.textContent).toMatch(/1\.12\s*07\/10/)
    expect(screen.getByTestId('report-row')).toHaveTextContent('Echocardiography')
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
    fireEvent.click(screen.getByRole('button', { name: '異常' }))

    expect(screen.getByRole('button', { name: '異常' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowWith('1.26')).toBeUndefined()
    expect(rowWith('12.6')).toBeTruthy()
    expect(rowWith('612')).toBeTruthy()
    expect(screen.getByLabelText(zhTW.reports.referenceComparison.above)).toHaveTextContent('↑')
    expect(screen.getByTestId('report-row')).toBeInTheDocument()
  })

  it('says when the clinician has no hospital visit with this patient', () => {
    mockClinicianName = '王志明'
    render(<LastOutpatientCard />)
    expect(screen.getByText(zhTW.lastOutpatient.noMatch.replace('{name}', '王志明'))).toBeInTheDocument()
    expect(within(screen.getByTestId('last-outpatient')).getByText('2026/10/20')).toBeInTheDocument()
  })

  it('lets a clinician with a saved name change it from the tab', () => {
    mockClinicianName = '陳怡君'
    render(<LastOutpatientCard />)
    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.changeName }))
    expect(mockRevealTab).toHaveBeenCalledWith('settings', { settingsTab: 'display' })
  })

  it('sends a clinician without a saved name to the setting', () => {
    render(<LastOutpatientCard />)
    fireEvent.click(screen.getByRole('button', { name: zhTW.lastOutpatient.setName }))
    expect(mockRevealTab).toHaveBeenCalledWith('settings', { settingsTab: 'display' })
  })

  it('says reports are still loading rather than that nothing was ordered', () => {
    const { useProgressiveImportStore } = jest.requireActual('@/src/application/stores/progressive-import.store')
    useProgressiveImportStore.setState({ current: { phase: 'reports-pending' } })
    mockClinicalData = { ...chart(), observations: [], diagnosticReports: [] }
    render(<LastOutpatientCard />)
    expect(screen.getByRole('status')).toHaveTextContent(zhTW.lastOutpatient.reportsPending)
    useProgressiveImportStore.setState({ current: null })
  })
})
