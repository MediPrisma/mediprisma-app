import { act, fireEvent, render, screen } from '@testing-library/react'
import ClinicalSummaryFeature from '@/src/layouts/LeftPanelLayout'

let mockHasHospitalOutpatientVisit = false
const mockClearDetail = jest.fn()

jest.mock('@/features/clinical-summary/last-outpatient', () => ({
  useHasHospitalOutpatientVisit: () => mockHasHospitalOutpatientVisit,
}))

jest.mock('@/src/shared/config/feature-registry', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const tabs = [
    { id: 'overview', labelKey: 'overview', order: -1, enabled: true },
    { id: 'last-outpatient', labelKey: 'lastOutpatient', order: -0.5, enabled: true, requires: 'hospital-outpatient' },
    { id: 'patient', labelKey: 'patient', order: 0, enabled: true },
  ]
  return {
    // Mirrors the registry rule; the rule itself is covered by its own test.
    getEnabledTabs: (options: { hasHospitalOutpatientVisit?: boolean } = {}) =>
      tabs.filter((tab) => tab.requires !== 'hospital-outpatient' || options.hasHospitalOutpatientVisit === true),
    getFeaturesForTab: (tabId: string) => [{
      id: tabId,
      component: () => React.createElement('div', { 'data-testid': `${tabId}-shell` }),
    }],
  }
})

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      common: { loading: '載入中...' },
      tabs: { overview: '總覽', lastOutpatient: '上次門診', patient: '病人資訊' },
    },
  }),
}))

jest.mock('@/src/application/providers/right-detail.provider', () => ({
  useRightDetail: () => ({ clearDetail: mockClearDetail }),
}))

jest.mock('@/features/left-browser-tour', () => ({
  useLeftBrowserTourStore: (selector: (state: { active: boolean; stepId: null }) => unknown) => (
    selector({ active: false, stepId: null })
  ),
}))

jest.mock('@/features/clinical-summary/components/FhirDataIssuesBanner', () => ({
  FhirDataIssuesBanner: () => null,
}))

jest.mock('@/features/clinical-summary/components/SdkSourceLimitationsBanner', () => ({
  SdkSourceLimitationsBanner: () => null,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('LeftPanelLayout 上次門診 tab', () => {
  beforeEach(() => {
    mockHasHospitalOutpatientVisit = false
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('is not listed for a cloud-only chart', () => {
    render(<ClinicalSummaryFeature />)
    expect(screen.queryByRole('tab', { name: '上次門診' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '總覽' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '病人資訊' })).toBeInTheDocument()
  })

  it('is listed after 總覽 when the chart holds a hospital outpatient visit', () => {
    mockHasHospitalOutpatientVisit = true
    render(<ClinicalSummaryFeature />)
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['總覽', '上次門診', '病人資訊'])
  })

  it('returns to the landing tab when the next chart has no hospital outpatient visit', () => {
    mockHasHospitalOutpatientVisit = true
    const { rerender } = render(<ClinicalSummaryFeature />)
    const tab = screen.getByRole('tab', { name: '上次門診' })
    act(() => {
      fireEvent.mouseDown(tab)
      fireEvent.click(tab)
    })
    expect(screen.getByRole('tab', { name: '上次門診' })).toHaveAttribute('aria-selected', 'true')

    mockHasHospitalOutpatientVisit = false
    rerender(<ClinicalSummaryFeature />)
    expect(screen.queryByRole('tab', { name: '上次門診' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '總覽' })).toHaveAttribute('aria-selected', 'true')
  })
})
