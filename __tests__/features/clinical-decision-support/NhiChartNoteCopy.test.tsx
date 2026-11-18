import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CdssCoverageCheck, CdssCoverageSummary } from '@/features/clinical-decision-support/types'
import { useNhiChartNoteCopy } from '@/features/clinical-decision-support/renderers/NhiChartNoteCopy'

const NOTE = '判讀：至少「高風險」\n依據：\n- 糖尿病：符合（病歷資料）'

const check = (id: string, origin: CdssCoverageCheck['origin']): CdssCoverageCheck => ({
  id, label: id, value: '', state: 'yes', origin, editable: true,
})

function summary(overrides: Partial<CdssCoverageSummary> = {}): CdssCoverageSummary {
  return {
    documentationNote: NOTE,
    factors: [check('age', 'record')],
    metabolicChecks: [],
    diseaseChecks: [check('diabetes', 'record')],
    ...overrides,
  } as CdssCoverageSummary
}

function Harness({ value }: { value: CdssCoverageSummary }) {
  const { button, copiedNote } = useNhiChartNoteCopy(value, 'zh-TW')
  return <div data-testid="harness">{button}{copiedNote}</div>
}

describe('useNhiChartNoteCopy', () => {
  const writeText = jest.fn()

  beforeEach(() => {
    writeText.mockReset()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('copies in one click, then shows exactly what was copied until closed', async () => {
    writeText.mockResolvedValue(undefined)
    render(<Harness value={summary()} />)
    expect(screen.queryByTestId('nhi-table1-copied-note')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '複製到病歷' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已複製' })).toBeVisible())
    expect(writeText).toHaveBeenCalledWith(NOTE)
    expect(screen.getByText('已複製以下內容，可直接貼到病歷')).toBeVisible()
    expect(screen.getByLabelText('已複製的內容').textContent).toBe(NOTE)
    expect(screen.queryByText(/AI 預填/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '收合' }))
    expect(screen.queryByTestId('nhi-table1-copied-note')).toBeNull()
  })

  it('says how many unreviewed AI answers the copy leaves out', async () => {
    writeText.mockResolvedValue(undefined)
    render(<Harness value={summary({ factors: [check('smoking', 'ai')], diseaseChecks: [check('cad', 'ai'), check('diabetes', 'physician')] })} />)
    fireEvent.click(screen.getByRole('button', { name: '複製到病歷' }))
    expect(await screen.findByText('AI 預填 2 項尚未經醫師覆核，未放入；覆核後再複製即會納入。')).toBeVisible()
  })

  it('shows the text for manual copying when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<Harness value={summary()} />)
    fireEvent.click(screen.getByRole('button', { name: '複製到病歷' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('複製失敗')
    expect(screen.getByRole('textbox', { name: '病歷文字' })).toHaveValue(NOTE)
  })

  it('renders nothing without a chart note', () => {
    render(<Harness value={summary({ documentationNote: '' })} />)
    expect(screen.getByTestId('harness')).toBeEmptyDOMElement()
  })
})
