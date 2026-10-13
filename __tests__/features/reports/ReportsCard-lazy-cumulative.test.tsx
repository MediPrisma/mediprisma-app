import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReportsCard } from '@/features/clinical-summary/reports/ReportsCard'
import { useResourceNavigationStore } from '@/src/application/stores/resource-navigation.store'
import { ClinicalTabActivityProvider } from '@/src/application/providers/clinical-tab-activity.provider'

const mockUseClinicalData = jest.fn()
// ReportsCard gates on the readiness of the four types it renders.
const ALL_TYPES_READY = {
  diagnosticReports: true,
  imagingStudies: true,
  observations: true,
  procedures: true,
}
const mockUseReportsData = jest.fn((_reports: unknown[], _imagingStudies: unknown[], _nameMode: string) => ({
  reportRows: [],
  seenIds: new Set<string>(),
}))
const mockUseReportTabCounts = jest.fn()
const CANCER_SCREENING_OBSERVATION = {
  id: 'obs-1',
  resourceType: 'Observation',
  category: [{
    coding: [{
      system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/medcloud-observation-program',
      code: 'cancer-screening',
    }],
  }],
}

const activeNameSwitches = () => screen.queryAllByRole('switch', { name: '名稱顯示' })
  .filter((element) => !element.closest('[data-slot="tabs-content"][data-state="inactive"]'))

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockUseClinicalData(),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      common: { loading: 'Loading', error: 'Error' },
      errors: { unknown: 'Unknown' },
      reports: {
        title: '診斷報告',
        noData: '在選定的時間範圍內未找到報告。',
        nameDisplay: {
          label: '名稱顯示',
          original: '原始名稱',
          standardized: '標準化名稱',
        },
        tabs: {
          cumulative: '累積報告',
          all: '全部',
          lab: '檢驗',
          imaging: '影像',
          pathology: '病理',
          cancerScreening: '癌篩',
          vitals: '生命徵象',
          procedures: '處置',
        },
        labTable: { abnormalOnly: '只看異常', showing: '顯示 {shown} / 共 {total} 筆' },
      },
    },
  }),
}))

jest.mock('@/features/clinical-summary/reports/hooks/useReportsData', () => ({
  useReportsData: (reports: unknown[], imagingStudies: unknown[], nameMode: string) => (
    mockUseReportsData(reports, imagingStudies, nameMode)
  ),
}))

jest.mock('@/features/clinical-summary/reports/hooks/useReportTabCounts', () => ({
  useReportTabCounts: () => mockUseReportTabCounts(),
}))

jest.mock('@/features/clinical-summary/reports/hooks/useProcedureRows', () => ({
  useProcedureRows: () => [],
}))

jest.mock('@/features/clinical-summary/reports/hooks/useOrphanObservations', () => ({
  useOrphanObservations: () => [],
}))

jest.mock('@/features/clinical-summary/reports/components/CumulativeLabReport', () => ({
  CumulativeLabReport: ({
    observations,
    activeCategoryId,
    focusAnalyteKey,
    focusDate,
    focusNonce,
    nameModeControl,
  }: {
    observations: unknown[]
    activeCategoryId?: string
    focusAnalyteKey?: string
    focusDate?: string
    focusNonce?: number
    nameModeControl?: ReactNode
  }) => (
    <div data-testid="cumulative-report">
      {nameModeControl}
      observations: {observations.length}; category: {activeCategoryId}; focus: {focusAnalyteKey}; date: {focusDate}; nonce: {focusNonce}
    </div>
  ),
}))

jest.mock('@/features/clinical-summary/reports/components/ReportsTabContent', () => ({
  ReportsTabContent: ({
    value,
    isActive,
    isPreparing,
  }: {
    value: string
    isActive: boolean
    isPreparing: boolean
  }) => (
    <div
      data-testid={`raw-report-${value}`}
      data-active={isActive ? 'true' : 'false'}
      data-preparing={isPreparing ? 'true' : 'false'}
    />
  ),
}))

describe('ReportsCard lazy cumulative loading', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseReportTabCounts.mockReturnValue({
      all: 119,
      lab: 31,
      imaging: 7,
      pathology: 2,
      cancerScreening: 3,
      vitals: 10,
      procedures: 2,
    })
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: jest.fn(() => 1),
    })
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: jest.fn(),
    })
    useResourceNavigationStore.setState({
      pending: {
        resourceType: 'Observation',
        resourceId: 'obs-1',
        reportView: 'cumulative',
        cumulativeCategoryId: 'chem',
        cumulativeAnalyteKey: 'CRP',
      },
      seq: 1,
      consumedSeq: 0,
    })
    mockUseClinicalData.mockReturnValue({
      diagnosticReports: [],
      imagingStudies: [],
      observations: [CANCER_SCREENING_OBSERVATION],
      procedures: [{ id: 'proc-1', resourceType: 'Procedure' }],
      resourceReady: ALL_TYPES_READY,
      error: null,
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: undefined,
    })
  })

  it('paints the report shell before cumulative and raw report work begins', async () => {
    const diagnosticReports = [{ id: 'report-1', resourceType: 'DiagnosticReport' }]
    const imagingStudies = [{ id: 'study-1', resourceType: 'ImagingStudy' }]
    mockUseClinicalData.mockReturnValue({
      diagnosticReports,
      imagingStudies,
      observations: [CANCER_SCREENING_OBSERVATION],
      procedures: [{ id: 'proc-1', resourceType: 'Procedure' }],
      resourceReady: ALL_TYPES_READY,
      error: null,
    })

    render(<ReportsCard />)

    expect(screen.queryByTestId('cumulative-report')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(mockUseReportsData).toHaveBeenLastCalledWith([], [], 'standardized')
    expect(mockUseReportsData).not.toHaveBeenCalledWith(
      diagnosticReports,
      imagingStudies,
      'standardized',
    )
    expect(screen.getByRole('tab', { name: '全部 (119)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '檢驗 (31)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '影像 (7)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '病理 (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '癌篩 (3)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '生命徵象 (10)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '處置 (2)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand to fullscreen' })).toHaveClass(
      '@min-[1160px]:px-2',
      'max-md:!min-h-[36px]',
      'max-md:!min-w-[36px]',
    )
    expect(screen.getByText('Fullscreen')).toHaveClass('hidden', '@min-[1160px]:inline')
    const reportTabList = document.querySelector('[data-tour="report-tabs"][role="tablist"]')
    expect(reportTabList).toHaveClass(
      'pr-12',
      '@min-[1160px]:pr-28',
      '!flex',
      'overflow-x-auto',
      'max-md:!min-h-[36px]',
      'max-md:[scrollbar-width:none]',
    )
    expect(reportTabList).not.toHaveClass('hidden', 'md:!flex')
    expect(reportTabList?.closest('[data-slot="card"]')).toHaveClass('pt-1', 'md:pt-3')
    expect(screen.getByRole('tab', { name: '累積報告' })).toHaveClass('max-md:!min-h-[36px]')
    const cumulative = await screen.findByTestId('cumulative-report')
    expect(cumulative).toHaveTextContent('observations: 1')
    expect(cumulative).toHaveTextContent('category: chem')
    expect(cumulative).toHaveTextContent('focus: CRP')
    expect(cumulative).toHaveTextContent('nonce: 1')
    expect(screen.getByRole('switch', { name: '名稱顯示' })).toBeChecked()
    expect(screen.queryByText('在選定的時間範圍內未找到報告。')).not.toBeInTheDocument()
  })

  it('does not prepare the cumulative pivot while the top-level Reports tab is hidden', () => {
    jest.useFakeTimers()
    useResourceNavigationStore.setState({ pending: null, seq: 0, consumedSeq: 0 })

    const view = (active: boolean) => (
      <ClinicalTabActivityProvider active={active}>
        <ReportsCard />
      </ClinicalTabActivityProvider>
    )
    const { rerender } = render(view(false))

    act(() => {
      jest.runOnlyPendingTimers()
    })
    expect(screen.queryByTestId('cumulative-report')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    act(() => {
      rerender(view(true))
    })
    act(() => {
      jest.runAllTimers()
    })
    expect(screen.getByTestId('cumulative-report')).toBeInTheDocument()
  })

  it('keeps cumulative navigation pending until the top-level Reports tab is active', () => {
    jest.useFakeTimers()

    const view = (active: boolean) => (
      <ClinicalTabActivityProvider active={active}>
        <ReportsCard />
      </ClinicalTabActivityProvider>
    )
    const { rerender } = render(view(false))

    act(() => {
      jest.runOnlyPendingTimers()
    })
    expect(useResourceNavigationStore.getState()).toMatchObject({
      pending: expect.objectContaining({
        reportView: 'cumulative',
        cumulativeCategoryId: 'chem',
      }),
      consumedSeq: 0,
    })
    expect(screen.queryByTestId('cumulative-report')).not.toBeInTheDocument()

    rerender(view(true))
    act(() => {
      jest.runAllTimers()
    })

    expect(useResourceNavigationStore.getState()).toMatchObject({
      pending: null,
      consumedSeq: 1,
    })
    expect(screen.getByTestId('cumulative-report')).toHaveTextContent('category: chem')
    expect(screen.getByTestId('cumulative-report')).toHaveTextContent('focus: CRP')
  })

  it('derives an exact cumulative cell from an Observation-only destination', async () => {
    const ldlObservation = {
      id: 'observation-ldl',
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '13457-7', display: 'LDL cholesterol' }] },
      effectiveDateTime: '2026-08-04T08:30:00+08:00',
      valueQuantity: { value: 53, unit: 'mg/dL' },
    }
    useResourceNavigationStore.setState({
      pending: {
        resourceType: 'Observation',
        resourceId: 'observation-ldl',
        reportView: 'cumulative',
      },
      seq: 7,
      consumedSeq: 0,
    })
    mockUseClinicalData.mockReturnValue({
      diagnosticReports: [],
      imagingStudies: [],
      observations: [ldlObservation],
      procedures: [],
      resourceReady: ALL_TYPES_READY,
      error: null,
    })

    render(<ReportsCard />)

    const cumulative = await screen.findByTestId('cumulative-report')
    expect(cumulative).toHaveTextContent('category: lipid')
    expect(cumulative).toHaveTextContent('focus: LDL')
    expect(cumulative).toHaveTextContent('date: 2026-08-04')
    await waitFor(() => expect(useResourceNavigationStore.getState().pending).toBeNull())
  })

  it('performance contract: selects a raw tab before any projection work is enabled', () => {
    jest.useFakeTimers()
    mockUseReportTabCounts.mockReturnValue({
      all: 1,
      lab: 0,
      imaging: 0,
      pathology: 0,
      cancerScreening: 0,
      vitals: 0,
      procedures: 1,
    })
    const frameCallbacks: FrameRequestCallback[] = []
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const diagnosticReports = [{ id: 'report-1', resourceType: 'DiagnosticReport' }]
    mockUseClinicalData.mockReturnValue({
      diagnosticReports,
      imagingStudies: [],
      observations: [{ id: 'obs-1', resourceType: 'Observation' }],
      procedures: [{ id: 'proc-1', resourceType: 'Procedure' }],
      resourceReady: ALL_TYPES_READY,
      error: null,
    })
    useResourceNavigationStore.setState({ pending: null, seq: 0, consumedSeq: 0 })

    render(<ReportsCard />)

    expect(screen.getByRole('tab', { name: '癌篩 (0)' })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: /全部/ }), {
      button: 0,
      ctrlKey: false,
    })

    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-preparing', 'true')
    expect(mockUseReportsData).toHaveBeenLastCalledWith([], [], 'standardized')

    // Even after the browser reaches the next frame, the heavy projection is
    // still behind a timer/transition. This ordering is the performance
    // contract: the selected state gets a paint opportunity first.
    act(() => {
      frameCallbacks.splice(0).forEach((callback) => callback(16))
    })
    expect(mockUseReportsData).toHaveBeenLastCalledWith([], [], 'standardized')
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-preparing', 'true')

    act(() => {
      jest.runOnlyPendingTimers()
    })

    expect(mockUseReportsData).toHaveBeenLastCalledWith(
      diagnosticReports,
      [],
      'standardized',
    )
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-preparing', 'false')

    fireEvent.mouseDown(screen.getByRole('tab', { name: /影像/ }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByRole('tab', { name: /影像/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('raw-report-all')).toBeInTheDocument()
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-active', 'false')

    fireEvent.mouseDown(screen.getByRole('tab', { name: /全部/ }), {
      button: 0,
      ctrlKey: false,
    })
    // Once visited, both raw views stay mounted and switching back requires no
    // preparation phase or repeat projection.
    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('raw-report-all')).toHaveAttribute('data-preparing', 'false')
    expect(screen.getByTestId('raw-report-imaging')).toBeInTheDocument()
  })

  it('shares the name mode across cumulative, all, lab, imaging, pathology, and vitals tabs', async () => {
    useResourceNavigationStore.setState({ pending: null, seq: 0, consumedSeq: 0 })
    render(<ReportsCard />)

    const toggle = screen.getByRole('switch', { name: '名稱顯示' })
    expect(toggle).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '原始名稱' }))
    expect(toggle).not.toBeChecked()

    fireEvent.mouseDown(screen.getByRole('tab', { name: /全部/ }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(activeNameSwitches()).toHaveLength(1))
    expect(activeNameSwitches()[0]).not.toBeChecked()

    fireEvent.mouseDown(screen.getByRole('tab', { name: /影像/ }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(activeNameSwitches()).toHaveLength(1))
    expect(activeNameSwitches()[0]).not.toBeChecked()
    expect(mockUseReportsData).toHaveBeenLastCalledWith([], [], 'original')

    fireEvent.mouseDown(screen.getByRole('tab', { name: /病理/ }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(activeNameSwitches()).toHaveLength(1))
    expect(activeNameSwitches()[0]).not.toBeChecked()

    fireEvent.mouseDown(screen.getByRole('tab', { name: /檢驗/ }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(activeNameSwitches()).toHaveLength(1))
    expect(activeNameSwitches()[0]).not.toBeChecked()

    fireEvent.mouseDown(screen.getByRole('tab', { name: /生命徵象/ }), { button: 0, ctrlKey: false })
    await waitFor(() => expect(activeNameSwitches()).toHaveLength(1))
    expect(activeNameSwitches()[0]).not.toBeChecked()
    await waitFor(() => {
      expect(mockUseReportsData).toHaveBeenLastCalledWith([], [], 'original')
    })
  })
})
