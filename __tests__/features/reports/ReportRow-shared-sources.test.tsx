import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReportRow } from '@/features/clinical-summary/reports/components/ReportRow'
import type { Row } from '@/features/clinical-summary/reports/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { RightDetailProvider, useRightDetail } from '@/src/application/providers/right-detail.provider'
import { toast } from 'sonner'

jest.mock('@/features/report-interpretation', () => ({
  ReportInterpretationButton: () => null,
  ReportInterpretationLauncher: ({ asDiv }: { asDiv?: boolean }) => asDiv
    ? <div role="button" tabIndex={0}>AI 翻譯解讀</div>
    : <button type="button">AI 翻譯解讀</button>,
  ReportInterpretationPanel: () => null,
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}))

function RightDetailTitleProbe() {
  const { detail } = useRightDetail()
  return detail ? <><div data-testid="right-detail-title">{detail.title}</div><div data-testid="right-detail-node">{detail.node}</div></> : null
}

function renderRow(row: Row) {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          <RightDetailTitleProbe />
          <ReportRow row={row} defaultOpen={[]} />
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

function sharedRow(structured = false): Row {
  return {
    id: 'echo-report',
    title: '心臟超音波（含杜卜勒血流）',
    rawTitle: '超音波心臟圖',
    meta: 'Imaging • final',
    group: 'imaging',
    institution: '示範醫院',
    effectiveDate: '2024-09-09T09:00:00+08:00',
    obs: [
      {
        id: 'echo-summary',
        code: { text: 'Report Summary' },
        valueString: 'Normal wall motion with adequate LV systolic function.',
      },
      ...(structured ? [{
        id: 'ef',
        code: { text: 'EF' },
        valueQuantity: { value: 72.6, unit: '%' },
      }] : []),
    ],
    sharedReportSources: [
      {
        reportId: 'echo-source',
        title: '超音波心臟圖',
        codes: ['18005C'],
        codings: [{ code: '18005C' }],
      },
      {
        reportId: 'doppler-source',
        title: '杜卜勒氏彩色心臟血流圖',
        codes: ['18007C'],
        codings: [{ code: '18007C' }],
      },
    ],
  }
}

describe('ReportRow shared report source disclosure', () => {
  it('keeps different observations sharing an id visible without reusing React keys', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const row = sharedRow(true)
      row.obs.push({ ...row.obs[1], valueQuantity: { value: 69, unit: '%' } })
      renderRow(row)
      fireEvent.click(screen.getByText(row.title))
      fireEvent.click(screen.getByRole('button', { name: '在右側面板展開細項' }))
      const detail = screen.getByTestId('right-detail-node')
      expect(detail).toHaveTextContent('72.6')
      expect(detail).toHaveTextContent('69')
      expect(errors.mock.calls.filter(args => String(args[0]).includes('same key'))).toHaveLength(0)
    } finally {
      errors.mockRestore()
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    })
  })

  it('supports keyboard title copy and keeps the report collapsed', async () => {
    const row = sharedRow()
    renderRow(row)
    const titleCopy = screen.getByRole('button', { name: '複製報告標題' })
    const reportToggle = screen.getByText(row.title).closest('[role="button"][aria-expanded]')

    fireEvent.keyDown(titleCopy, { key: 'Enter' })

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(row.title))
    expect(reportToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('reports clipboard failures without expanding the report', async () => {
    const row = sharedRow()
    const writeText = jest.fn().mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderRow(row)
    const reportToggle = screen.getByText(row.title).closest('[role="button"][aria-expanded]')

    fireEvent.click(screen.getByRole('button', { name: '複製報告標題' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.any(String)))
    expect(reportToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('copies the full visible title without expanding the narrative row', async () => {
    const row = sharedRow()
    renderRow(row)

    const titleCopy = screen.getByRole('button', { name: '複製報告標題' })
    const reportToggle = screen.getByText(row.title).closest('[role="button"][aria-expanded]')
    expect(screen.getByText(row.title)).toHaveClass('select-text')
    expect(reportToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(titleCopy)

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(row.title))
    expect(reportToggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '報告標題已複製' })).toBeInTheDocument()
    })
  })

  it('does not toggle after selecting title text, but a simple title click still expands', () => {
    const row = sharedRow()
    renderRow(row)
    const title = screen.getByText(row.title)
    const reportToggle = title.closest('[role="button"][aria-expanded]')!
    const range = document.createRange()
    range.selectNodeContents(title)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.click(title)
    expect(reportToggle).toHaveAttribute('aria-expanded', 'false')

    window.getSelection()?.removeAllRanges()
    fireEvent.click(title)
    expect(reportToggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers the same exact-title copy action in the right detail header', async () => {
    const row = sharedRow()
    renderRow(row)
    fireEvent.click(screen.getByRole('button', { name: '在右側面板展開全文' }))
    const detailTitle = screen.getByTestId('right-detail-title')

    fireEvent.click(within(detailTitle).getByRole('button', { name: '複製報告標題' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(row.title))
    expect(within(detailTitle).getByText(row.title)).toHaveClass('select-text')
  })

  it('shows one compact note and reveals every source procedure from a narrative row', () => {
    const row = sharedRow()
    renderRow(row)

    expect(screen.getByTestId('shared-report-summary'))
      .toHaveTextContent('2 個檢查項目共用相同報告')
    expect(screen.getAllByText(row.obs[0].valueString!)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'AI 翻譯解讀' })).toHaveLength(1)

    fireEvent.click(screen.getByText(row.title))
    const disclosure = screen.getByTestId('shared-report-sources')
    const summary = within(disclosure).getByText('查看來源檢查項目')
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(summary)
    expect(disclosure).toHaveAttribute('open')
    expect(within(disclosure).getByText('超音波心臟圖')).toBeInTheDocument()
    expect(within(disclosure).getByText(/醫令碼: 18007C/)).toBeInTheDocument()
    expect(within(disclosure).getByText(/來源紀錄: doppler-source/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '複製報告全文' })).toHaveLength(1)
  })

  it('keeps the source note and disclosure when structured results use the accordion layout', () => {
    const row = sharedRow(true)
    renderRow(row)

    expect(screen.getByTestId('shared-report-summary')).toBeInTheDocument()
    fireEvent.click(screen.getByText(row.title))
    expect(screen.getByTestId('shared-report-sources')).toBeInTheDocument()
  })

  it('copies an accordion title without opening its structured results', async () => {
    const row = sharedRow(true)
    renderRow(row)
    const trigger = document.querySelector('[data-slot="accordion-trigger"]')!

    fireEvent.click(screen.getByRole('button', { name: '複製報告標題' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(row.title))
    expect(trigger).toHaveAttribute('data-state', 'closed')
  })
})
