import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { withCollectorOperation } from '@/src/application/telemetry/collector-operation'
import type { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { runGenerationJob } from '@/src/application/hooks/ai-generation/run-generation-job'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { collectorEventV6Schema, MAX_COLLECTOR_REQUEST_DETAILS } from '@/src/shared/contracts/collector-event'
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
  expect(collectorEventV6Schema.safeParse(event).success).toBe(true)
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
  expect(payloads()[2]).toMatchObject({ schema_version: 5, sample_kind: 'request' })
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
    produce: async (measure, operation) => {
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
