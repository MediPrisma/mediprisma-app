import { TextEncoder } from 'util'
import { buildSummaryReport, redactDiagnosticText } from '@/src/shared/utils/summary-diagnostics'
import { retainDiagnostics } from '@/src/application/stores/ai-execution-diagnostics.store'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'

Object.assign(globalThis, { TextEncoder })
const run = '10000000-0000-4000-8000-000000000001'
const record = (attempt: number): AiExecutionDiagnosticRecord => ({ version: 1, id: String(attempt),
  feature: 'medical-summary', operationKey: 'PRIVATE-PATIENT-CACHE-KEY', transport: 'stream',
  modelName: 'custom', modelId: 'custom', timestamp: '2026-10-16T00:00:00.000Z', prompt: 'synthetic clinical context',
  inputData: { apiKey: 'NEVER-EXPORT' }, outputData: 'partial answer', hasError: true, errorMessage: 'sensitive upstream exception', status: 'aborted',
  technical: { run_id: run, request_id: `20000000-0000-4000-8000-${String(attempt).padStart(12, '0')}`, attempt, lane: 'full', output_chars: 14, last_chunk_ms: 200, parse_state: 'incomplete' },
})
it('retains every attempt across interleaved unrelated requests and exports only explicit fields', () => {
  const history = [record(1), record(2), record(3), record(4), { ...record(5), technical: undefined }]
  expect(retainDiagnostics(history)).toHaveLength(5)
  const json = buildSummaryReport(history)
  expect(JSON.parse(json).executions).toHaveLength(4)
  expect(json).not.toMatch(/PRIVATE-PATIENT|NEVER-EXPORT|sensitive upstream/)
  expect(json).toContain('synthetic clinical context')
})
it('removes provider-echoed credentials without treating this as clinical anonymisation', () => {
  expect(redactDiagnosticText('secret-value Bearer abc.def.ghi', 'secret-value')).toBe('[REDACTED] Bearer [REDACTED]')
})
it('evicts complete older runs rather than truncating retries', () => {
  const history = Array.from({ length: 4 }, (_, i) => [record(1), record(2), record(3)].map(r => ({ ...r, technical: { ...r.technical!, run_id: String(i) } }))).flat()
  const kept = retainDiagnostics(history)
  expect(kept).toHaveLength(9)
  expect(kept.some(r => r.technical?.run_id === '0')).toBe(false)
})
