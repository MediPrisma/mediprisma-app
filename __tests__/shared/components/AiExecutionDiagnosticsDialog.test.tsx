/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { AiExecutionDiagnosticsDialog } from '@/src/shared/components/AiExecutionDiagnosticsDialog'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { createModelExecution } from '@/src/shared/utils/ai-model-execution'

const labels = {
  title: 'Diagnostics preview',
  description: 'Review before download',
  privacyNotice: 'Contains clinical data',
  execution: 'Execution',
  model: 'Model name',
  modelId: 'Model ID',
  timestamp: 'Timestamp',
  status: 'Status',
  prompt: 'Prompt',
  input: 'Input data',
  output: 'Output data',
  error: 'Error information',
  noError: 'No error',
  completed: 'Completed',
  failed: 'Error',
  aborted: 'Aborted',
  close: 'Close',
  downloadAll: 'Download all records JSON',
  downloadThis: 'Download this record JSON',
}

describe('AiExecutionDiagnosticsDialog', () => {
  it('previews execution data and downloads only after explicit confirmation', () => {
    const onDownloadAll = jest.fn()
    const onDownloadRecord = jest.fn()
    render(
      <LanguageProvider><AiExecutionDiagnosticsDialog
        open
        onOpenChange={jest.fn()}
        labels={labels}
        onDownloadAll={onDownloadAll}
        onDownloadRecord={onDownloadRecord}
        records={[{
          id: 'execution-1',
          modelName: 'Actual model not reported',
          modelId: 'unreported',
          modelExecution: createModelExecution('gemini-4-hydrogen'),
          timestamp: '2026-08-05T02:51:53.866Z',
          prompt: 'SYSTEM PROMPT',
          inputData: { patient: 'masked' },
          outputData: 'MODEL OUTPUT',
          hasError: false,
          errorMessage: null,
          status: 'completed',
        }]}
      /></LanguageProvider>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('SYSTEM PROMPT')).toBeInTheDocument()
    expect(screen.getByText(/"patient": "masked"/)).toBeInTheDocument()
    expect(screen.getByText('MODEL OUTPUT')).toBeInTheDocument()
    expect(screen.getByText('gemini-4-hydrogen')).toBeInTheDocument()
    expect(screen.queryByText('unreported')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' })).toBeInTheDocument()
    expect(screen.getByTitle('2026-08-05T02:51:53.866Z')).toHaveTextContent(/\([^)]+\)$/)
    expect(screen.queryByText('2026-08-05T02:51:53.866Z')).not.toBeInTheDocument()
    expect(onDownloadAll).not.toHaveBeenCalled()
    expect(onDownloadRecord).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Download this record JSON' }))
    expect(onDownloadRecord).toHaveBeenCalledTimes(1)
    expect(onDownloadRecord).toHaveBeenCalledWith(0)

    fireEvent.click(screen.getByRole('button', { name: 'Download all records JSON' }))
    expect(onDownloadAll).toHaveBeenCalledTimes(1)
  })

  it('surfaces an application validation failure in the collapsed record list', () => {
    render(
      <AiExecutionDiagnosticsDialog
        open
        onOpenChange={jest.fn()}
        labels={labels}
        onDownloadAll={jest.fn()}
        onDownloadRecord={jest.fn()}
        records={[{
          id: 'execution-1',
          modelName: 'tvghbrain3.5',
          modelId: 'custom-openai:vghtpe-tvghbrain',
          timestamp: '2026-08-05T02:51:53.866Z',
          prompt: 'SYSTEM PROMPT',
          inputData: {},
          outputData: 'MODEL OUTPUT',
          hasError: true,
          errorMessage: 'investigations: PARSE_FAILED',
          status: 'error',
        }]}
      />,
    )

    expect(screen.getAllByText('Error').length).toBeGreaterThan(0)
    expect(screen.getAllByText(
      'investigations: PARSE_FAILED',
    ).length).toBeGreaterThan(0)
  })
})
