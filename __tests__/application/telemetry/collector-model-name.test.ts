// D089: the collector event names the model a user-defined endpoint's profile sets, and a model
// missing from the contract list by its own ID, when the name fits the contract's format.
import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { collectorEventV12Schema } from '@/src/shared/contracts/collector-event'
import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'
import { mockCollectorPermission } from '../../helpers/collector-permissions'
import { rememberLocalBundleVersion } from '@/src/infrastructure/fhir/services/local-bundle-version'

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ saveEncryptedCache: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ trackEvent: jest.fn() }))
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: async () => 'synthetic-token-'.repeat(4) })),
}))

const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const body = () => JSON.parse(jest.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
const profile = (profileId: string, modelId: string) => ({
  profileId, modelId, name: 'Synthetic endpoint SECRET-NAME', baseUrl: 'http://synthetic-host.invalid/v1', apiKey: 'SECRET-KEY',
}) as unknown as OpenAiCompatibleProfile
const send = async (modelId: string) => {
  beginCollectorObservation({ feature: 'chat', modelId, sampleKind: 'request', mode: 'stream' }).finish({ outcome: 'ok' })
  await settle()
  const payload = body()
  expect(collectorEventV12Schema.safeParse(payload).success).toBe(true)
  return payload
}
let permission: ReturnType<typeof mockCollectorPermission>

beforeEach(() => {
  rememberLocalBundleVersion(null)
  cancelCollectorRequests()
  localStorage.clear()
  permission = mockCollectorPermission()
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/?site=vghtpe')
})
afterEach(async () => {
  cancelCollectorRequests(); await settle(); permission.restore()
  useAiConfigStore.setState({ openAiCompatibleProfiles: [] })
})

test('a user-defined endpoint is sent under the model name its profile sets, and nothing else from the profile', async () => {
  useAiConfigStore.setState({ openAiCompatibleProfiles: [profile('synthetic-a', 'llama3.1:8b'), profile('synthetic-b', 'synthetic-org/Model-8B_v2')] })
  expect(await send(customOpenAiModelIdForProfile('synthetic-a'))).toMatchObject({ model: 'llama3.1:8b', provider: 'custom' })
  const payload = await send(customOpenAiModelIdForProfile('synthetic-b'))
  expect(payload).toMatchObject({ model: 'synthetic-org/Model-8B_v2', provider: 'custom' })
  expect(JSON.stringify(payload)).not.toMatch(/SECRET|synthetic-host|synthetic-b/)
})

test.each(['院內模型', 'my model', 'http://synthetic-host.invalid/v1', 'someone@synthetic.invalid', 'a'.repeat(65), '   '])(
  'a profile model name outside the format (%s) is still sent as custom', async (name) => {
    useAiConfigStore.setState({ openAiCompatibleProfiles: [profile('synthetic-a', name)] })
    expect(await send(customOpenAiModelIdForProfile('synthetic-a'))).toMatchObject({ model: 'custom', provider: 'custom' })
  })

test('a deleted profile is sent as custom', async () => {
  expect(await send(customOpenAiModelIdForProfile('synthetic-gone'))).toMatchObject({ model: 'custom', provider: 'custom' })
})

test('the hospital TVGHBrain profile keeps its fixed code, whatever the profile names', async () => {
  useAiConfigStore.setState({ openAiCompatibleProfiles: [profile('vghtpe-tvghbrain', 'synthetic-deployment-name')] })
  expect(await send(customOpenAiModelIdForProfile('vghtpe-tvghbrain'))).toMatchObject({ model: 'tvghbrain3.5', provider: 'custom' })
})

test('a model the contract list lacks is sent by its own ID instead of unknown', async () => {
  expect(await send('gpt-7-synthetic')).toMatchObject({ model: 'gpt-7-synthetic' })
  expect(await send('synthetic model with spaces')).toMatchObject({ model: 'unknown' })
})
