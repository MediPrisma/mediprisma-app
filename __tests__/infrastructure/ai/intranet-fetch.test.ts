/** @jest-environment node */
jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({ getProxyIdToken: jest.fn() }))
import { getProxyIdToken } from '@/src/infrastructure/ai/utils/proxy-auth'
import { createIntranetFetch, intranetGatewayAvailable } from '@/src/infrastructure/ai/interceptors/intranet-fetch'
import { OpenAiService } from '@/src/infrastructure/ai/services/openai.service'
import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'
import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'
import { AiErrorCode, getUserErrorMessage } from '@/src/core/errors'

const origin = 'https://ai-vghtpe.mediprisma.tw'
const href = 'https://mediprisma.tw/app-staging/?site=vghtpe'
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; Reflect.deleteProperty(globalThis, 'window') })
beforeEach(() => {
  process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = 'staging'
  process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = origin
  Object.defineProperty(globalThis, 'window', { value: { location: { href } }, configurable: true })
  jest.mocked(getProxyIdToken).mockResolvedValue('synthetic-firebase-token')
})

test('permits only the staging vghtpe route', () => {
  expect(intranetGatewayAvailable(href)).toBe(true)
  for (const url of [href.replace('/app-staging/', '/app/'), href.replace('vghtpe', 'hmc'), `${href}&site=hmc`]) {
    expect(intranetGatewayAvailable(url)).toBe(false)
  }
  process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = 'production'
  expect(intranetGatewayAvailable(href)).toBe(false)
})

test('uses Firebase auth and preserves the Responses path, body and cancellation', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(new Response('{}'))
  const signal = new AbortController().signal
  const body = JSON.stringify({ model: 'gpt-6-luna', input: 'synthetic' })
  await createIntranetFetch(origin, fetchImpl)(`${origin}/v1/responses`, {
    method: 'POST', body, signal, headers: { Authorization: 'Bearer dummy', 'x-api-key': 'must-not-forward' },
  })
  const [url, init] = fetchImpl.mock.calls[0]
  expect(String(url)).toBe(`${origin}/v1/responses`)
  expect(init.body).toBe(body)
  expect(init.signal).toBe(signal)
  expect(init.headers.get('Authorization')).toBe('Bearer synthetic-firebase-token')
  expect(init.headers.has('x-api-key')).toBe(false)
  expect(init.redirect).toBe('error')
})

test('does not retry budget rejection or network failure through Firebase', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(new Response('{"error":{"code":"monthly_budget_exhausted"}}', { status: 429 }))
  const send = createIntranetFetch(origin, fetchImpl)
  expect((await send(`${origin}/v1/responses`, { method: 'POST', body: '{}' })).status).toBe(429)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  fetchImpl.mockRejectedValue(new TypeError('network unavailable'))
  await expect(send(`${origin}/v1/responses`, { method: 'POST', body: '{}' })).rejects.toThrow('network unavailable')
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

test('missing auth or foreign URL never sends a request', async () => {
  const fetchImpl = jest.fn()
  const send = createIntranetFetch(origin, fetchImpl)
  await expect(send('https://example.com/v1/responses')).rejects.toThrow('路徑')
  jest.mocked(getProxyIdToken).mockResolvedValue(null)
  await expect(send(`${origin}/v1/responses`)).rejects.toThrow('登入')
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('non-streaming service ignores personal keys and stays on the bounded hospital route', async () => {
  const send = jest.fn().mockResolvedValue(Response.json({ model: 'gpt-6-luna', output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer' }] },
  ], usage: { total_tokens: 5 } }))
  globalThis.fetch = send
  const result = await new OpenAiService('synthetic-personal-key').query({
    modelId: 'gpt-6-luna', messages: [{ role: 'user', content: 'Synthetic question' }], maxTokens: 10000,
  })
  expect(result.text).toBe('Synthetic answer')
  const [url, init] = send.mock.calls[0]
  expect(String(url)).toBe(`${origin}/v1/responses`)
  expect(init.headers.get('Authorization')).toBe('Bearer synthetic-firebase-token')
  expect(JSON.parse(init.body)).toMatchObject({ store: false, max_output_tokens: 2048 })
  expect(send).toHaveBeenCalledTimes(1)
  process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = 'production'
  await expect(new OpenAiService('synthetic-personal-key').query({ modelId: 'gpt-6-luna', messages: [] })).rejects.toThrow('app-staging')
  expect(send).toHaveBeenCalledTimes(1)
})

test.each([429, 503])('real stream adapter and SDK send only one request on HTTP %i', async status => {
  const send = jest.fn().mockImplementation(async () => Response.json({ error: { message: 'synthetic rejection' } }, { status }))
  globalThis.fetch = send
  const adapter = new AiSdkStreamAdapter(new AiProviderFactory())
  await expect(adapter.stream({
    model: 'gpt-6-luna', apiKey: null, signal: new AbortController().signal,
    messages: [{ role: 'user', content: 'Synthetic question' }], onChunk: () => {},
  })).rejects.toThrow()
  expect(send).toHaveBeenCalledTimes(1)
  expect(String(send.mock.calls[0][0])).toBe(`${origin}/v1/responses`)
})

test('monthly budget denial gives a specific message instead of suggesting a retry', () => {
  expect(getUserErrorMessage(new Error('429 monthly_budget_exhausted'))).toBe('院內 AI 本月 US$100 額度已用完，本次請求未送往 Azure。')
})

test.each([
  [false, 'Synthetic partial answer', false],
  [true, '', false],
  [true, 'Synthetic partial answer', true],
])('incomplete query: allow partial %s, text %s, succeeds %s', async (allowTruncatedOutput, text, succeeds) => {
  globalThis.fetch = jest.fn().mockResolvedValue(Response.json({
    model: 'gpt-6-luna', status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' }, output_text: text,
  }))
  const query = new OpenAiService().query({ modelId: 'gpt-6-luna', messages: [], allowTruncatedOutput })
  if (succeeds) {
    await expect(query).resolves.toMatchObject({ text, metadata: { outputTruncated: true } })
  } else {
    await expect(query).rejects.toMatchObject({ code: AiErrorCode.OUTPUT_TRUNCATED })
  }
})
