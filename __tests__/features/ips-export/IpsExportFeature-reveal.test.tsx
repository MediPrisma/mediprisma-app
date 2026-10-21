// 總覽 「帶回病歷」 opens 複製 → 帶回紀錄, even when the 複製 tab was last left
// on another sub-tab (it used to open 複製 on whatever sub-tab was showing,
// so on a panel already at 貼給 AI the button seemed to do nothing).
import { fireEvent, render, screen } from '@testing-library/react'
import IpsExportFeature from '@/features/ips-export/Feature'
import { RightPanelProvider, useRightPanel } from '@/src/application/providers/right-panel.provider'

let mockAudience: 'medical' | 'patient' = 'medical'
let mockLoading = false
let mockError: Error | null = null
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: mockAudience }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))
jest.mock('@/features/ips-export/hooks/useIpsBundle', () => ({
  useIpsBundle: () => ({
    bundle: { resourceType: 'Bundle' },
    curatedData: null,
    patient: null,
    labels: {},
    validation: null,
    isLoading: mockLoading,
    error: mockError,
    refetch: jest.fn(),
    hasPatient: true,
    resourceCount: 0,
  }),
}))
jest.mock('@/features/ips-export/hooks/useIpsExport', () => ({
  useIpsExport: () => ({
    downloadJson: jest.fn(),
    downloadMarkdown: jest.fn(),
    copyJson: jest.fn(),
    copyMarkdown: jest.fn(),
    copiedFormat: null,
    copyError: null,
    markdownFilename: 'ips.md',
  }),
}))
jest.mock('@/features/ips-export/hooks/useInferredProblems', () => ({
  useInferredProblems: () => ({ confirmed: [] }),
}))
jest.mock('@/features/ips-export/components/EmrHandoffPanel', () => ({
  EmrHandoffPanel: () => <p>帶回紀錄內容</p>,
}))
jest.mock('@/features/ips-export/components/AiHandoffPanel', () => ({
  AiHandoffPanel: () => <p>貼給 AI 內容</p>,
}))
jest.mock('@/features/ips-export/components/IpsExportPreview', () => ({
  IpsExportPreview: () => <p>下載檔案內容</p>,
}))
jest.mock('@/features/ips-export/components/IpsDataScopePanel', () => ({ IpsDataScopePanel: () => null }))
jest.mock('@/features/import-bundle/components/OriginalFhirDownload', () => ({
  OriginalFhirDownload: () => <p>原始 FHIR 下載</p>,
}))
jest.mock('@/features/ips-export/components/InferredProblemsReview', () => ({ InferredProblemsReview: () => null }))

/** Stands in for 總覽's 「帶回病歷」 and for the tab bar. */
function Harness() {
  const { revealTab, setActiveTab } = useRightPanel()
  return (
    <>
      <button type="button" onClick={() => setActiveTab('medical-summary')}>去醫療摘要</button>
      <button type="button" onClick={() => revealTab('ips-export', { exportTab: 'emr' })}>總覽帶回病歷</button>
      <IpsExportFeature />
    </>
  )
}

const selected = () => screen.getByRole('tab', { selected: true })

beforeEach(() => {
  mockAudience = 'medical'
  mockLoading = false
  mockError = null
})

it('opens 帶回紀錄 from 總覽 even when 複製 was last left on 貼給 AI', () => {
  render(<RightPanelProvider><Harness /></RightPanelProvider>)
  expect(selected()).toHaveTextContent('帶回紀錄')

  fireEvent.mouseDown(screen.getByRole('tab', { name: '貼給 AI' }))
  expect(selected()).toHaveTextContent('貼給 AI')
  expect(screen.getByText('貼給 AI 內容')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '去醫療摘要' }))
  fireEvent.click(screen.getByRole('button', { name: '總覽帶回病歷' }))
  expect(selected()).toHaveTextContent('帶回紀錄')
  expect(screen.getByText('帶回紀錄內容')).toBeInTheDocument()
})

it('keeps the sub-tab the clinician chose when nothing asks for another', () => {
  render(<RightPanelProvider><Harness /></RightPanelProvider>)
  fireEvent.mouseDown(screen.getByRole('tab', { name: '下載檔案' }))
  fireEvent.click(screen.getByRole('button', { name: '去醫療摘要' }))
  expect(selected()).toHaveTextContent('下載檔案')
})

it('lands a 民眾 reader on 貼給 AI — there is no 帶回紀錄 for them', () => {
  mockAudience = 'patient'
  render(<RightPanelProvider><Harness /></RightPanelProvider>)
  expect(screen.queryByRole('tab', { name: '帶回紀錄' })).toBeNull()
  expect(selected()).toHaveTextContent('貼給 AI')
})

it.each(['loading', 'error'])('keeps original downloads reachable when IPS is %s', (state) => {
  mockLoading = state === 'loading'
  mockError = state === 'error' ? new Error('Synthetic IPS failure') : null
  render(<RightPanelProvider><Harness /></RightPanelProvider>)
  fireEvent.mouseDown(screen.getByRole('tab', { name: '下載檔案' }))
  expect(screen.getByText('原始 FHIR 下載')).toBeVisible()
})
