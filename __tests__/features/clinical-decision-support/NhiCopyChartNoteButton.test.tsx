import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CdssCoverageCheck, CdssCoverageSummary } from '@/features/clinical-decision-support/types'
import { NhiCopyChartNoteButton } from '@/features/clinical-decision-support/renderers/NhiCopyChartNoteButton'

const check = (id: string, origin: CdssCoverageCheck['origin']): CdssCoverageCheck => ({
  id, label: id, value: '', state: 'yes', origin, editable: true,
})

function summary(overrides: Partial<CdssCoverageSummary> = {}): CdssCoverageSummary {
  return {
    documentationNote: '判讀：至少「高風險」\n依據：\n- 糖尿病：符合（病歷資料）',
    factors: [check('age', 'record')],
    metabolicChecks: [],
    diseaseChecks: [check('diabetes', 'record')],
    ...overrides,
  } as CdssCoverageSummary
}

describe('NhiCopyChartNoteButton', () => {
  const writeText = jest.fn()

  beforeEach(() => {
    writeText.mockReset()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('copies the chart note in one click and confirms it', async () => {
    writeText.mockResolvedValue(undefined)
    render(<NhiCopyChartNoteButton summary={summary()} locale="zh-TW" />)
    fireEvent.click(screen.getByRole('button', { name: '複製到病歷' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已複製' })).toBeVisible())
    expect(writeText).toHaveBeenCalledWith('判讀：至少「高風險」\n依據：\n- 糖尿病：符合（病歷資料）')
    expect(screen.queryByText(/AI 預填/)).toBeNull()
  })

  it('says how many unreviewed AI answers the copy leaves out', () => {
    render(<NhiCopyChartNoteButton
      summary={summary({ factors: [check('smoking', 'ai')], diseaseChecks: [check('cad', 'ai'), check('diabetes', 'physician')] })}
      locale="zh-TW"
    />)
    expect(screen.getByText('AI 預填 2 項未經醫師覆核，不放入複製內容')).toBeVisible()
  })

  it('shows the text for manual copying when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<NhiCopyChartNoteButton summary={summary()} locale="zh-TW" />)
    fireEvent.click(screen.getByRole('button', { name: '複製到病歷' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('複製失敗')
    expect(screen.getByRole('textbox', { name: '病歷文字' })).toHaveValue('判讀：至少「高風險」\n依據：\n- 糖尿病：符合（病歷資料）')
  })

  it('renders nothing without a chart note', () => {
    const { container } = render(<NhiCopyChartNoteButton summary={summary({ documentationNote: '' })} locale="zh-TW" />)
    expect(container).toBeEmptyDOMElement()
  })
})
