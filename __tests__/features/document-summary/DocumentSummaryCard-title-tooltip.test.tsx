import { render, screen } from '@testing-library/react'

import type { DocumentEntry } from '@/features/clinical-summary/document-summary/types'
const mockEntries: DocumentEntry[] = []

import { DocumentSummaryCard } from '@/features/clinical-summary/document-summary/DocumentSummaryCard'

jest.mock('@/features/clinical-summary/document-summary/hooks/useDocumentSummaries', () => ({
  useDocumentSummaries: () => ({
    entries: mockEntries,
    isLoading: false,
    error: null,
  }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: { documentSummary: {} } }),
}))

describe('DocumentSummaryCard title help', () => {
  it('places a single tooltip icon beside the title without a separate hint row', () => {
    render(<DocumentSummaryCard />)

    const help = screen.getByRole('button', { name: '文件摘要說明' })
    const cardTitle = help.closest('[data-slot="card-title"]')
    const cardContent = help.closest('[data-slot="card"]')?.querySelector('[data-slot="card-content"]')

    expect(cardTitle).toHaveTextContent('文件摘要')
    expect(cardContent).not.toContainElement(help)
    expect(screen.getAllByText('文件摘要')).toHaveLength(1)
  })
})


jest.mock('@/src/application/providers/right-detail.provider', () => ({
  useRightDetail: () => ({ detail: null, showDetail: jest.fn(), toggleDetail: jest.fn() }),
}))
jest.mock('@/features/report-interpretation', () => ({
  ReportInterpretationLauncher: () => null, ReportInterpretationPanel: () => null,
}))

it('keeps department, physician and primary diagnosis visible while SOAP is collapsed', () => {
  mockEntries.push(...['first', 'second'].map((id): DocumentEntry => ({
    id, date: '2026-09-17', typeLabel: '門診 SOAP 與醫囑', typeCode: null,
    sourceKind: 'documentReference', isIps: false, isDischargeSummary: false,
    outpatient: { department: '皮膚科', physician: '測試醫師' },
    primaryDiagnosis: { code: 'B02.9', text: 'Zoster without complications' },
    attachment: { contentType: 'text/plain', data: Buffer.from('Synthetic SOAP body').toString('base64') },
  })))
  try {
    render(<DocumentSummaryCard />)
    expect(screen.getAllByText('科別：皮膚科')[0]).toBeVisible()
    expect(screen.getAllByText('門診醫師：測試醫師')[0]).toBeVisible()
    expect(screen.getAllByText('B02.9')[0]).toBeVisible()
    expect(screen.getAllByText('Zoster without complications')[0]).toBeVisible()
    expect(screen.queryByText('Synthetic SOAP body')).not.toBeInTheDocument()
  } finally { mockEntries.length = 0 }
})
