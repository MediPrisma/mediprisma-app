import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { withCollectorOperation } from '@/src/application/telemetry/collector-operation'
import type { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { runGenerationJob } from '@/src/application/hooks/ai-generation/run-generation-job'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { collectorEventV10Schema, MAX_COLLECTOR_REQUEST_DETAILS } from '@/src/shared/contracts/collector-event'
import { mockCollectorPermission } from '../../helpers/collector-permissions'

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ saveEncryptedCache: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ trackEvent: jest.fn() }))
const mockCapture = jest.fn(async () => ({ getToken: async () => 'synthetic-token' }))
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({ captureCollectorAuth: () => mockCapture() }))
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const payloads = () => jest.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string))
const parent = (modelId = 'gpt-5.4-nano') => beginCollectorObservation({
  feature: 'summary', modelId, sampleKind: 'feature', mode: 'structured',
  counts: { encounter_count: 23, med_count: 47 },
})
const child = (operation: ReturnType<typeof parent>['operation'], modelId = 'gpt-5.4-nano') =>
  beginCollectorObservation({ feature: 'summary', modelId, sampleKind: 'request', mode: 'stream', operation })
let permission: ReturnType<typeof mockCollectorPermission>
beforeEach(() => {
  cancelCollectorRequests()
  permission = mockCollectorPermission()
  mockCapture.mockClear()
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/?site=vghtpe')
})
afterEach(async () => { cancelCollectorRequests(); await settle(); permission.restore() })

test('one operation sends one row containing ordered failures and retries, no clinical contents', async () => {
  const operation = parent('openai-compatible-custom:SECRET-PROFILE')
  const first = child(operation.operation, 'openai-compatible-custom:SECRET-PROFILE')
  const retry = child(operation.operation)
  retry.firstChunk(); retry.finish({ outcome: 'ok', phase: 'stream', responseComplete: true })
  first.finish({ outcome: 'timeout', phase: 'stream', responseComplete: false })
  first.finish({ outcome: 'ok' }) // terminal callback is idempotent
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  operation.finish({ outcome: 'parse_failed', phase: 'parse', summaryCards: { succeeded: 0, failed: 6 } })
  operation.finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(mockCapture).toHaveBeenCalledTimes(1)
  const event = payloads()[0]
  expect(collectorEventV10Schema.safeParse(event).success).toBe(true)
  expect(event.diagnostics).toMatchObject({ loaded: { encounters: 23, medications: 47 },
    requests: { count: 2, omitted: 0, details: [
      { model: 'custom', status: 'error', error_class: 'timeout', response_complete: false },
      { status: 'completed', response_complete: true },
    ] } })
  expect(JSON.stringify(event)).not.toMatch(/SECRET|prompt|patient|messages|operationKey/)
})

test('concurrent runs and standalone calls cannot cross-associate', async () => {
  const a = parent(), b = parent('gemini-3.1-flash-lite')
  child(b.operation, 'gemini-3.1-flash-lite').finish({ outcome: 'timeout' })
  child(a.operation).finish({ outcome: 'ok' })
  a.finish({ outcome: 'ok' }); b.finish({ outcome: 'error' })
  await settle()
  expect(payloads().map(e => e.diagnostics.requests.details[0].model)).toEqual(['gpt-5.4-nano', 'gemini-3.1-flash-lite'])
  child(undefined).finish({ outcome: 'ok' })
  await settle()
  expect(payloads()[2]).toMatchObject({ schema_version: 10, sample_kind: 'request' })
})

test('unfinished child is explicitly incomplete and late finish does not send or mutate', async () => {
  const operation = parent(), unfinished = child(operation.operation)
  operation.finish({ outcome: 'aborted' })
  await settle()
  const before = payloads()[0]
  expect(before.diagnostics.requests.details[0]).toMatchObject({ status: 'incomplete', error_class: null, response_complete: null })
  unfinished.finish({ outcome: 'ok' })
  child(operation.operation).finish({ outcome: 'ok' })
  await settle()
  expect(payloads()).toEqual([before])
})

test('request details are bounded with an explicit exact omitted count', async () => {
  const operation = parent()
  for (let i = 0; i < MAX_COLLECTOR_REQUEST_DETAILS + 5; i++) child(operation.operation).finish({ outcome: i % 2 ? 'timeout' : 'ok' })
  operation.finish({ outcome: 'error' })
  await settle()
  const requests = payloads()[0].diagnostics.requests
  expect(requests.count).toBe(MAX_COLLECTOR_REQUEST_DETAILS + 5)
  expect(requests.omitted).toBe(5)
  expect(requests.details).toHaveLength(MAX_COLLECTOR_REQUEST_DETAILS)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test.each(['navigation', 'pagehide'])('%s invalidates parent and child without additional transmission', async (cause) => {
  const operation = parent(), request = child(operation.operation)
  if (cause === 'navigation') window.history.replaceState({}, '', '/?site=hmc')
  else cancelCollectorRequests()
  request.finish({ outcome: 'ok' }); operation.finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test.each(['ok', 'parse_failed', 'timeout', 'aborted'] as const)('generation job and scoped AI compose one %s operation without changing results', async (outcome) => {
  const query = jest.fn(async (_messages, options) => {
    child(options.collectorContext.operation).finish({ outcome: 'ok', phase: 'stream', responseComplete: true })
    return 'synthetic-result'
  })
  const ai = { query, stream: query, stop: jest.fn(), isLoading: false, error: null, clearError: jest.fn() } as ReturnType<typeof useUnifiedAi>
  const store = createAiResultStore<{ result: string }>()
  const result = await runGenerationJob({ store, key: 'synthetic-slot', cacheKey: 'synthetic-cache',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' },
    produce: async (measure, _identifySummaryRun, operation) => {
      const scoped = withCollectorOperation(ai, operation)
      expect(scoped.stop).toBe(ai.stop)
      const answer = await scoped.stream([{ role: 'user', content: 'SYNTHETIC-PRIVATE-PROMPT' }], { operationKey: 'SYNTHETIC-PATIENT', throwOnAbort: true })
      expect(query.mock.calls[0][1]).toMatchObject({ operationKey: 'SYNTHETIC-PATIENT', throwOnAbort: true })
      if (outcome === 'timeout' || outcome === 'aborted') {
        const error = new Error('SYNTHETIC-PRIVATE-ERROR'); error.name = outcome === 'aborted' ? 'AbortError' : 'TimeoutError'; throw error
      }
      if (outcome === 'parse_failed') return null
      measure({ outcome: 'ok', summaryCards: { succeeded: 6, failed: 0 } })
      return { result: answer }
    } })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(payloads()[0].diagnostics.requests.count).toBe(1)
  expect(result).toEqual(outcome === 'ok' ? { result: 'synthetic-result' } : null)
  expect(store.getState().running['synthetic-slot']).toBe(false)
  expect(JSON.stringify(payloads())).not.toMatch(/SYNTHETIC-PRIVATE|SYNTHETIC-PATIENT/)
})

test('a summary attempt is still sent on its own and the v8 operation nests it under the same run', async () => {
  const runId = '0b9c6a52-1d1e-4c5e-9f3a-5a1c2d3e4f50'
  const attempt = (n: number, parse: 'valid' | 'incomplete') => ({ run_id: runId, request_id: `0b9c6a52-1d1e-4c5e-9f3a-5a1c2d3e4f5${n}`,
    attempt: n, lane: 'full' as const, output_chars: 10, last_chunk_ms: null, parse_state: parse })
  const operation = parent()
  child(operation.operation).finish({ outcome: 'aborted', phase: 'stream', responseComplete: false, summaryAttempt: attempt(1, 'incomplete') })
  await settle()
  expect(payloads().map(p => p.schema_version)).toEqual([10])
  child(operation.operation).finish({ outcome: 'ok', phase: 'stream', responseComplete: true, summaryAttempt: attempt(2, 'valid') })
  operation.finish({ outcome: 'ok', summaryRunId: runId })
  await settle()
  const sent = payloads()
  expect(sent.map(p => p.schema_version)).toEqual([10, 10, 10])
  expect(sent[0].diagnostics.summary_attempt.run_id).toBe(runId)
  expect(sent[2]).toMatchObject({ sample_kind: 'feature', diagnostics: { summary_run_id: runId, requests: { count: 2, omitted: 0 } } })
  expect(sent[2].diagnostics.requests.details.map((r: { status: string }) => r.status)).toEqual(['aborted', 'completed'])
})

test('past the detail cap a summary attempt is still sent on its own and only counted in the operation', async () => {
  const runId = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const operation = parent()
  for (let i = 0; i < MAX_COLLECTOR_REQUEST_DETAILS; i++) child(operation.operation).finish({ outcome: 'ok' })
  child(operation.operation).finish({ outcome: 'aborted', phase: 'stream', responseComplete: false, summaryAttempt: {
    run_id: runId, request_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e60', attempt: 1, lane: 'full', output_chars: 0, last_chunk_ms: null, parse_state: 'empty' } })
  operation.finish({ outcome: 'ok', summaryRunId: runId })
  await settle()
  const sent = payloads()
  expect(sent.map(p => p.schema_version)).toEqual([10, 10])
  expect(sent[0].diagnostics.summary_attempt.run_id).toBe(runId)
  expect(sent[1].diagnostics.requests).toMatchObject({ count: MAX_COLLECTOR_REQUEST_DETAILS + 1, omitted: 1 })
})

test('the hospital endpoint profile reports its fixed model code; a user-defined endpoint stays custom', async () => {
  const { customOpenAiModelIdForProfile } = await import('@/src/shared/constants/ai-models.constants')
  const { VGTPE_TVGHBRAIN_PROFILE_ID, VGTPE_TVGHBRAIN_MODEL_ID } = await import('@/src/application/launch/medcloud-launch-context')
  const { INSTITUTION_ENDPOINT_MODELS } = await import('@/src/infrastructure/telemetry/collector')
  const { collectorModelSchema } = await import('@/src/shared/contracts/collector-event')
  // The mapping must follow the launch profile; a renamed profile or new model must update both.
  expect(INSTITUTION_ENDPOINT_MODELS[customOpenAiModelIdForProfile(VGTPE_TVGHBRAIN_PROFILE_ID)]).toBe(VGTPE_TVGHBRAIN_MODEL_ID)
  expect(collectorModelSchema.safeParse(VGTPE_TVGHBRAIN_MODEL_ID).success).toBe(true)
  const hospital = parent(customOpenAiModelIdForProfile(VGTPE_TVGHBRAIN_PROFILE_ID))
  child(hospital.operation, customOpenAiModelIdForProfile(VGTPE_TVGHBRAIN_PROFILE_ID)).finish({ outcome: 'ok' })
  hospital.finish({ outcome: 'ok' })
  const own = parent(customOpenAiModelIdForProfile('SYNTHETIC-PRIVATE-PROFILE'))
  own.finish({ outcome: 'ok' })
  await settle()
  const [first, second] = payloads()
  expect(first).toMatchObject({ model: 'tvghbrain3.5', provider: 'custom' })
  expect(first.diagnostics.requests.details[0]).toMatchObject({ model: 'tvghbrain3.5', provider: 'custom' })
  expect(second).toMatchObject({ model: 'custom', provider: 'custom' })
  expect(JSON.stringify(payloads())).not.toMatch(/SYNTHETIC-PRIVATE|vghtpe-tvghbrain/)
})

test('a custom summary request names its template (v10); other features never carry one', async () => {
  window.history.replaceState({}, '', '/app-hmc/?site=vghtpe')
  const { collectorEventV10Schema } = await import('@/src/shared/contracts/collector-event')
  const longTitle = '心'.repeat(150) + '😀'.repeat(60)
  beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
    template: { id: 'changes', title: '  重要\n變化\t模板  ' } }).finish({ outcome: 'timeout', phase: 'stream' })
  beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
    template: { id: 'synthetic-id', title: longTitle } }).finish({ outcome: 'ok' })
  await settle()
  beginCollectorObservation({ feature: 'chat_followup', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'stream',
    template: { id: 'x', title: 'y' } }).finish({ outcome: 'ok' })
  await settle()
  beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query' }).finish({ outcome: 'ok' })
  await settle()
  const [first, second, third, fourth] = payloads()
  expect(first).toMatchObject({ schema_version: 10, app_surface: 'app-hmc', feature: 'insights', status: 'error', diagnostics: { template: { id: 'changes', title: '重要 變化 模板' } } })
  expect(collectorEventV10Schema.safeParse(first).success).toBe(true)
  expect(second.schema_version).toBe(10)
  expect(second.diagnostics.template.title.length).toBeLessThanOrEqual(200)
  expect(second.diagnostics.template.title).not.toMatch(/[\uD800-\uDBFF]$/)
  expect(collectorEventV10Schema.safeParse(second).success).toBe(true)
  expect(third.schema_version).toBe(10)
  expect(third.diagnostics).not.toHaveProperty('template')
  expect(fourth.schema_version).toBe(10)
})

test('template titles drop control, bidi and unpaired surrogate characters; an unusable ID is not rewritten', async () => {
  const { collectorEventV10Schema } = await import('@/src/shared/contracts/collector-event')
  beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
    template: { id: 'changes', title: '甲\u0085乙\uD800丙‮😀' } }).finish({ outcome: 'ok' })
  await settle()
  beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
    template: { id: 'id\u0085x', title: '重要變化' } }).finish({ outcome: 'ok' })
  await settle()
  for (const id of [' changes ', '\nchanges', 'changes‮']) {
    beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
      template: { id, title: '重要變化' } }).finish({ outcome: 'ok' })
    await settle()
  }
  const [cleaned, badId, ...edgeIds] = payloads()
  for (const sent of edgeIds) expect(sent.diagnostics).not.toHaveProperty('template')
  expect(edgeIds).toHaveLength(3)
  expect(cleaned.diagnostics.template).toEqual({ id: 'changes', title: '甲 乙丙😀' })
  expect(collectorEventV10Schema.safeParse(cleaned).success).toBe(true)
  // The ID is how a template is found: one that would need rewriting is left out, never altered.
  expect(badId.schema_version).toBe(10)
  expect(badId.diagnostics).not.toHaveProperty('template')
})

test('custom summary requests (v9) use at most half the retry queue and give way to operation events', async () => {
  const { collectorStatus } = await import('@/src/application/telemetry/collector')
  jest.mocked(fetch).mockReset().mockImplementation(() => new Promise<Response>(() => {}))
  const v9 = () => beginCollectorObservation({ feature: 'insights', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'query',
    template: { id: 'changes', title: '重要變化' } }).finish({ outcome: 'ok' })
  // Two sends stall in flight; everything after them queues or drops.
  v9(); v9()
  for (let i = 0; i < 40; i++) v9()
  expect(collectorStatus().queued).toBe(32)
  for (let i = 0; i < 32; i++) parent().finish({ outcome: 'ok' })
  expect(collectorStatus().queued).toBe(64)
  // A full queue: each further operation event replaces a queued custom summary request.
  for (let i = 0; i < 32; i++) parent().finish({ outcome: 'ok' })
  expect(collectorStatus().queued).toBe(64)
  const dropped = collectorStatus().dropped
  parent().finish({ outcome: 'ok' })
  expect(collectorStatus()).toMatchObject({ queued: 64, dropped: dropped + 1 })
})
