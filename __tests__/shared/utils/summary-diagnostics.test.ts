import { TextEncoder } from 'util'
import { buildSummaryReport, redactDiagnosticText, diagnosticUuid, inspectSummaryBlocks, summaryReportOutcomeLabel } from '@/src/shared/utils/summary-diagnostics'
import { retainDiagnostics, useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
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
  expect(redactDiagnosticText('synthetic-secret-value-123 Bearer abc.def.ghi', 'synthetic-secret-value-123')).toBe('[REDACTED] Bearer [REDACTED]')
})
it('evicts complete older runs rather than truncating retries', () => {
  const history = Array.from({ length: 4 }, (_, i) => [record(1), record(2), record(3)].map(r => ({ ...r, technical: { ...r.technical!, run_id: String(i) } }))).flat()
  const kept = retainDiagnostics(history)
  expect(kept).toHaveLength(9)
  expect(kept.some(r => r.technical?.run_id === '0')).toBe(false)
})

it('evicts by last activity so a recently retried run keeps its full history', () => {
  const r = (run_id: string, attempt: number) => ({...record(attempt), technical:{...record(attempt).technical!,run_id}})
  const retained = retainDiagnostics([r('A',1),r('B',1),r('C',1),r('A',2),r('A',3),r('D',1)])
  expect(retained.filter(r=>r.technical?.run_id==='A')).toHaveLength(3)
  expect(retained.some(r=>r.technical?.run_id==='B')).toBe(false)
})

it('correlation IDs work when randomUUID is unavailable in a plain HTTP context', () => {
  const spy = jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {throw new Error('unavailable')})
  try { expect(diagnosticUuid()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/) }
  finally {spy.mockRestore()}
})

it('does not corrupt clinical words when the local model key is a short placeholder',()=>{expect(redactDiagnosticText('Allergies: none; x-ray, Rx','none')).toBe('Allergies: none; x-ray, Rx');expect(redactDiagnosticText('x-ray, Rx','x')).toBe('x-ray, Rx')})

it('reports malformed complete blocks even when another block is missing',()=>{
  const malformed={complete:()=>true,parse:()=>null}
  const missing={complete:()=>false,parse:()=>{throw new Error('must not parse missing card')}}
  const valid={complete:()=>true,parse:()=>({ok:true})}
  expect(inspectSummaryBlocks('synthetic',[malformed,missing])).toBe('invalid')
  expect(inspectSummaryBlocks('synthetic',[valid,missing])).toBe('incomplete')
  expect(inspectSummaryBlocks('synthetic',[valid,valid])).toBe('valid')
})

it('rejects late records from a superseded run and clears patient/scope diagnostic memory',()=>{
  const store=useAiExecutionDiagnosticsStore.getState(), key='PRIVATE-PATIENT-CACHE-KEY'
  const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002'
  store.clearAll();store.setSummaryScope('scope-A');store.beginSummaryRun(key,a);store.addRecord(record(1))
  store.beginSummaryRun(key,b);store.addRecord({...record(2),technical:{...record(2).technical!,run_id:b}})
  store.addRecord(record(3))
  expect(JSON.parse(buildSummaryReport(useAiExecutionDiagnosticsStore.getState().records)).executions.map((e:{technical:{run_id:string}})=>e.technical.run_id)).toEqual([b])
  store.setSummaryScope('scope-B');store.addRecord({...record(4),technical:{...record(4).technical!,run_id:b}})
  expect(useAiExecutionDiagnosticsStore.getState().records).toHaveLength(0)
  store.beginSummaryRun(key,b);store.addRecord({...record(5),technical:{...record(5).technical!,run_id:b}})
  window.dispatchEvent(new Event('pagehide'))
  expect(useAiExecutionDiagnosticsStore.getState().records).toHaveLength(0)
  expect(useAiExecutionDiagnosticsStore.getState().summaryRuns).toEqual({})
})
it('reports excessive retry count explicitly rather than silently dropping attempts',()=>{
  expect(()=>buildSummaryReport(Array.from({length:257},(_,i)=>record(i+1)))).toThrow('report_too_large')
})

it('labels timeout, explicit stop and parse failure distinctly in the full report',()=>{
  const execution=JSON.parse(buildSummaryReport([record(1)])).executions[0]
  expect(summaryReportOutcomeLabel({...execution,outcome:'timeout'})).toBe('逾時')
  expect(summaryReportOutcomeLabel({...execution,outcome:'aborted'})).toBe('已停止')
  expect(summaryReportOutcomeLabel({...execution,outcome:'parse_failed'})).toBe('格式解析失敗')
})
