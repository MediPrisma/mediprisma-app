/** @jest-environment node */
jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({ getProxyIdToken: jest.fn() }))
import { getProxyIdToken } from '@/src/infrastructure/ai/utils/proxy-auth'
import { createIntranetFetch, intranetGatewayAvailable, intranetLunaIsLaunchDefault } from '@/src/infrastructure/ai/interceptors/intranet-fetch'
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

test('permits staging and HMC only, excluding production even with the hospital site parameter', () => {
  expect(intranetGatewayAvailable(href)).toBe(true)
  expect(intranetGatewayAvailable(href.replace('/app-staging/', '/app-hmc/'))).toBe(true)
  for (const url of [href.replace('/app-staging/', '/app-other/'), href.replace('vghtpe', 'hmc'), `${href}&site=hmc`, `${href}&site=vghtpe`, href.split('?')[0]]) {
    expect(intranetGatewayAvailable(url)).toBe(false)
  }
  process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = 'production'
  for (const path of ['/app/', '/app', '/app/workspace', '/app-staging-other/', '/app-hmc-other/']) {
    expect(intranetGatewayAvailable(href.replace('/app-staging/', path))).toBe(false)
  }
  expect(intranetGatewayAvailable(href)).toBe(true)
  expect(intranetGatewayAvailable(href.replace('/app-staging/', '/app-hmc/'))).toBe(true)
  delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
  expect(intranetGatewayAvailable(href)).toBe(false)
})

test('production cannot send an authenticated request to the hospital gateway', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { href: href.replace('/app-staging/', '/app/') } }, configurable: true,
  })
  const send = jest.fn()
  await expect(createIntranetFetch(origin, send)(`${origin}/v1/responses`, {
    method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', input: 'Synthetic only.' }),
  })).rejects.toThrow('院內 GPT')
  expect(send).not.toHaveBeenCalled()
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

test.each(['/app-hmc/', '/app-staging/'])('real SDK sends low thinking and high verbosity on %s', async path => {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { href: href.replace('/app-staging/', path) } }, configurable: true,
  })
  const send = jest.fn().mockResolvedValue(Response.json({ error: { message: 'synthetic rejection' } }, { status: 400 }))
  globalThis.fetch = send
  await expect(new AiSdkStreamAdapter(new AiProviderFactory()).stream({
    model: 'gpt-6-luna', apiKey: null, signal: new AbortController().signal,
    messages: [{ role: 'user', content: 'Synthetic question' }], onChunk: () => {},
    reasoningEffort: 'low', textVerbosity: 'high',
  })).rejects.toThrow()
  expect(send).toHaveBeenCalledTimes(1)
  expect(String(send.mock.calls[0][0])).toBe(`${origin}/v1/responses`)
  expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({
    model: 'gpt-6-luna', reasoning: { effort: 'low' }, text: { verbosity: 'high' }, store: false,
  })
  expect(send.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer synthetic-firebase-token')
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
  expect(JSON.parse(init.body)).toMatchObject({ store: false, max_output_tokens: 10000 })
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
  expect(getUserErrorMessage(new Error('429 monthly_budget_exhausted'))).toBe('院內 AI 本月 US$200 額度已用完，本次請求未送往 Azure。')
})

test.each([true, false])('actual SDK stream preserves text and reports length truncation: %s', async truncated => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm1' } },
    { type: 'response.output_text.delta', item_id: 'm1', delta: 'Synthetic partial answer' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm1' } },
    { type: truncated ? 'response.incomplete' : 'response.completed', response: {
      incomplete_details: truncated ? { reason: 'max_output_tokens' } : null,
      usage: { input_tokens: 5, output_tokens: 2048, total_tokens: 2053 },
    } },
  ]
  const send = jest.fn().mockResolvedValue(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  }))
  globalThis.fetch = send
  const onChunk = jest.fn()
  const stream = new AiSdkStreamAdapter(new AiProviderFactory()).stream({
    model: 'gpt-6-luna', apiKey: null, signal: new AbortController().signal,
    messages: [{ role: 'user', content: 'Synthetic question' }], onChunk,
  })
  if (truncated) await expect(stream).rejects.toMatchObject({ code: AiErrorCode.OUTPUT_TRUNCATED })
  else await expect(stream).resolves.toBeUndefined()
  expect(onChunk).toHaveBeenLastCalledWith('Synthetic partial answer')
  expect(send).toHaveBeenCalledTimes(1)
  expect(JSON.parse(send.mock.calls[0][1].body).max_output_tokens).toBeUndefined()
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

test('only the HMC preview starts a hospital launch on the intranet Luna', () => {
  const hmc = 'https://mediprisma.tw/app-hmc/?medcloud2=auto&site=vghtpe'
  expect(intranetLunaIsLaunchDefault(hmc)).toBe(true)
  expect(intranetLunaIsLaunchDefault(hmc.replace('/app-hmc/', '/app/'))).toBe(false)
  expect(intranetLunaIsLaunchDefault(hmc.replace('/app-hmc/', '/app-staging/'))).toBe(false)
  expect(intranetLunaIsLaunchDefault(hmc.replace('&site=vghtpe', ''))).toBe(false)
  delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
  expect(intranetLunaIsLaunchDefault(hmc)).toBe(false)
})
