import { sendSummaryFailureReport } from '@/src/infrastructure/telemetry/ai-failure-report'
import { aiReportSchema } from '@/src/shared/contracts/collector-event'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'
import { mockCollectorPermission } from '../../helpers/collector-permissions'

const TOKEN = 'synthetic-token-'.repeat(4)
const mockGetToken = jest.fn()
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: mockGetToken })),
}))

const RUN = '11111111-1111-4111-8111-111111111111'
const OTHER_RUN = '22222222-2222-4222-8222-222222222222'
// Synthetic only.
const record = (runId: string, attempt: number, prompt: string): AiExecutionDiagnosticRecord => ({
  version: 1, id: `r${attempt}`, feature: 'medical-summary', operationKey: 'op', transport: 'stream',
  modelName: 'synthetic', modelId: 'synthetic', timestamp: new Date().toISOString(),
  prompt, inputData: null, outputData: `OUTPUT-${attempt}`, hasError: true, errorMessage: 'x', status: 'error',
  outcome: 'timeout',
  technical: { run_id: runId, request_id: crypto.randomUUID(), attempt, lane: 'full', output_chars: 8, last_chunk_ms: 10, parse_state: 'incomplete' },
})
const records = [record(OTHER_RUN, 1, 'EARLIER-RUN'), record(RUN, 1, 'PROMPT-1'), record(RUN, 2, 'PROMPT-2')]
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
let permission: ReturnType<typeof mockCollectorPermission>

beforeEach(() => {
  permission = mockCollectorPermission()
  mockGetToken.mockReset().mockResolvedValue(TOKEN)
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  delete process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN
})
afterEach(() => permission.restore())

test.each(['/app/?site=vghtpe', '/app-hmc/?site=vghtpe'])('%s sends the failed run, and only that run, as an automatic report', async (url) => {
  window.history.replaceState({}, '', url)
  sendSummaryFailureReport(records, RUN)
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  const [endpoint, init] = jest.mocked(fetch).mock.calls[0]
  expect(endpoint).toBe('http://127.0.0.1:8787/collector/v1/ai-reports')
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
  expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  const report = aiReportSchema.parse(JSON.parse(init!.body as string))
  expect(report.source).toBe('auto_failure')
  expect(report.executions.map(e => [e.prompt, e.output])).toEqual([['PROMPT-1', 'OUTPUT-1'], ['PROMPT-2', 'OUTPUT-2']])
})

test('sends nothing off the 北榮 entry, without network permission or sign-in, or with no record of the run', async () => {
  window.history.replaceState({}, '', '/app/')
  sendSummaryFailureReport(records, RUN)
  window.history.replaceState({}, '', '/app-hmc/?site=other')
  sendSummaryFailureReport(records, RUN)
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  sendSummaryFailureReport(records, undefined)
  sendSummaryFailureReport(records, '33333333-3333-4333-8333-333333333333')
  permission.status.state = 'prompt'
  sendSummaryFailureReport(records, RUN)
  await settle()
  permission.status.state = 'granted'
  mockGetToken.mockResolvedValue(null)
  sendSummaryFailureReport(records, RUN)
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test('a failed send is dropped quietly', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error('offline'))
  expect(() => sendSummaryFailureReport(records, RUN)).not.toThrow()
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
})
