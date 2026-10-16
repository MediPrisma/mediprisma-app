import { captureCollectorAuth } from '@/src/infrastructure/telemetry/collector-auth'
import { TextEncoder } from 'util'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SummaryProblemReport } from '@/features/medical-summary/components/SummaryProblemReport'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'
Object.assign(globalThis, { TextEncoder })
jest.mock('@/src/infrastructure/telemetry/collector', () => ({
  isCollectorSite: () => true, configuredEndpoint: () => 'https://collector.example/collector/v1/events',
}))
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: async () => 'synthetic-token' })),
}))
const records: AiExecutionDiagnosticRecord[] = [1, 2, 3].map(attempt => ({
  version: 1, id: String(attempt), feature: 'medical-summary', operationKey: 'private-cache-key', transport: 'stream', modelName: 'custom', modelId: 'custom', timestamp: '2026-10-16T00:00:00.000Z',
  prompt: 'SYNTHETIC PROMPT', inputData: {}, outputData: 'SYNTHETIC OUTPUT', hasError: true, errorMessage: null, status: 'aborted',
  technical: { run_id: '10000000-0000-4000-8000-000000000001', request_id: `20000000-0000-4000-8000-${String(attempt).padStart(12, '0')}`, attempt, lane: 'full', output_chars: 16, last_chunk_ms: 30, parse_state: 'incomplete' },
}))
it('never uploads on failure or preview; sends the frozen preview only after explicit confirmation', async () => {
  jest.mocked(fetch).mockClear()
  jest.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({ success: true, reportId: '30000000-0000-4000-8000-000000000001' }) } as Response)
  const view = render(<SummaryProblemReport records={records} busy={false} />)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '回報問題' }))
  const preview = screen.getByLabelText('完整回報預覽').textContent
  expect(screen.getByRole('button', { name: '確認送出回報' })).toBeDisabled()
  expect(fetch).not.toHaveBeenCalled()
  view.rerender(<SummaryProblemReport records={[...records, { ...records[0], prompt: 'LATER DATA' }]} busy={false} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(jest.mocked(fetch).mock.calls[0][1]?.body).toBe(preview)
  expect(preview).not.toContain('private-cache-key')
  expect(JSON.parse(preview!).executions).toHaveLength(3)
  await screen.findByText(/回報已收到/)
})

it('retains the frozen report after failed upload and reuses the same submission on retry', async () => {
  jest.mocked(fetch).mockClear()
  jest.mocked(fetch).mockResolvedValueOnce({status:503} as Response).mockResolvedValueOnce({status:201,json:async()=>({success:true,reportId:'30000000-0000-4000-8000-000000000001'})} as Response)
  render(<SummaryProblemReport records={records} busy={false}/>)
  fireEvent.click(screen.getByRole('button',{name:'回報問題'}))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByText(/尚未確認收件成功/)
  fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByText(/回報已收到/)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(jest.mocked(fetch).mock.calls[1][1]?.body).toBe(jest.mocked(fetch).mock.calls[0][1]?.body)
})

it.each([429,413])('explains permanent rejection %s and offers download instead of immediate retry',async status=>{
  jest.mocked(fetch).mockClear();jest.mocked(fetch).mockResolvedValue({status} as Response)
  render(<SummaryProblemReport records={records} busy={false}/>)
  fireEvent.click(screen.getByRole('button',{name:'回報問題'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByRole('button',{name:'暫時無法送出'})
  expect(screen.getByRole('button',{name:'暫時無法送出'})).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('請下載這份回報')
  expect(screen.getByRole('button',{name:'下載這份回報'})).toBeEnabled()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('reopening an unconfirmed report preserves its submission and body even when newer records exist',async()=>{
  jest.mocked(fetch).mockClear();jest.mocked(fetch).mockResolvedValueOnce({status:503} as Response).mockResolvedValueOnce({status:201,json:async()=>({success:true,reportId:'30000000-0000-4000-8000-000000000001'})} as Response)
  const view=render(<SummaryProblemReport records={records} busy={false}/>)
  fireEvent.click(screen.getByRole('button',{name:'回報問題'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByText(/尚未確認收件成功/)
  fireEvent.click(screen.getByRole('button',{name:'關閉'}))
  expect(screen.queryByText(/尚未確認收件成功/)).not.toBeInTheDocument()
  view.rerender(<SummaryProblemReport records={[...records,{...records[0],prompt:'NEW SYNTHETIC DATA'}]} busy={false}/>)
  fireEvent.click(screen.getByRole('button',{name:'回報問題'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByText(/回報已收到/)
  expect(jest.mocked(fetch).mock.calls[1][1]?.body).toBe(jest.mocked(fetch).mock.calls[0][1]?.body)
})
it('missing authentication makes no upload and gives sign-in guidance rather than retry advice',async()=>{
  jest.mocked(fetch).mockClear();jest.mocked(captureCollectorAuth).mockResolvedValueOnce(null)
  render(<SummaryProblemReport records={records} busy={false}/>)
  fireEvent.click(screen.getByRole('button',{name:'回報問題'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'確認送出回報'}))
  await screen.findByText(/重新登入後再開啟回報/)
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'暫時無法送出'})).toBeDisabled()
})
