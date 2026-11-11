import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { collectorEventV11Schema } from '@/src/shared/contracts/collector-event'
import { readTokenUsage } from '@/src/shared/utils/ai-token-usage'
import { mockCollectorPermission } from '../../helpers/collector-permissions'

jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: async () => ({ getToken: async () => 'synthetic-token' }),
}))
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const payloads = () => jest.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string))
let permission: ReturnType<typeof mockCollectorPermission>
beforeEach(() => {
  cancelCollectorRequests()
  permission = mockCollectorPermission()
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/?site=vghtpe')
})
afterEach(async () => { cancelCollectorRequests(); await settle(); permission.restore() })

test('reads the reported counts from every dialect and never invents a missing side', () => {
  expect(readTokenUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })).toEqual({ inputTokens: 100, outputTokens: 20 })
  expect(readTokenUsage({ input_tokens: 300, output_tokens: 40 })).toEqual({ inputTokens: 300, outputTokens: 40 })
  expect(readTokenUsage({ inputTokens: 5, outputTokens: 0, totalTokens: 5 })).toEqual({ inputTokens: 5, outputTokens: 0 })
  expect(readTokenUsage({ promptTokenCount: 900, candidatesTokenCount: 50, thoughtsTokenCount: 30 })).toEqual({ inputTokens: 900, outputTokens: 80 })
  expect(readTokenUsage({ promptTokenCount: 900 })).toEqual({ inputTokens: 900 })
  for (const none of [undefined, null, 'x', {}, { total_tokens: 120 }, { input_tokens: -1 }, { input_tokens: 1.5 }, { input_tokens: '12' }, { inputTokens: Number.NaN }])
    expect(readTokenUsage(none)).toBeUndefined()
})

test('a standalone request carries its token counts; one without a report sends none', async () => {
  const start = () => beginCollectorObservation({ feature: 'chat', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'stream' })
  // One at a time: standalone requests beyond the in-flight limit are dropped, not queued.
  for (const usage of [{ inputTokens: 12345, outputTokens: 678 }, undefined, { inputTokens: -5, outputTokens: 1.5 }, { inputTokens: 40 }]) {
    start().finish({ outcome: 'ok', phase: 'stream', responseComplete: true, usage })
    await settle()
  }
  const sent = payloads()
  expect(sent).toHaveLength(4)
  for (const event of sent) expect(collectorEventV11Schema.safeParse(event).success).toBe(true)
  expect(sent.map(e => e.diagnostics.usage)).toEqual([{ input_tokens: 12345, output_tokens: 678 }, undefined, undefined, { input_tokens: 40 }])
})

test('an operation lists the token counts of each of its requests', async () => {
  const operation = beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'feature', mode: 'structured' })
  const child = () => beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'request', mode: 'stream', operation: operation.operation })
  child().finish({ outcome: 'ok', phase: 'stream', responseComplete: true, usage: { inputTokens: 9000, outputTokens: 400 } })
  child().finish({ outcome: 'timeout', phase: 'stream', responseComplete: false })
  child().finish({ outcome: 'ok', phase: 'stream', responseComplete: true, usage: { inputTokens: 1000, outputTokens: 100 } })
  operation.finish({ outcome: 'ok', phase: 'unknown' })
  await settle()
  const [event] = payloads()
  expect(collectorEventV11Schema.safeParse(event).success).toBe(true)
  expect(event.diagnostics.usage).toBeUndefined()
  expect(event.diagnostics.requests.details.map((d: { usage?: unknown }) => d.usage)).toEqual([
    { input_tokens: 9000, output_tokens: 400 }, undefined, { input_tokens: 1000, output_tokens: 100 }])
})
