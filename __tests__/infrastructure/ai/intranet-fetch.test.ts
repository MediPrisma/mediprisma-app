/** @jest-environment node */
jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({ getProxyIdToken: jest.fn() }))
import { getProxyIdToken } from '@/src/infrastructure/ai/utils/proxy-auth'
import { createIntranetFetch, intranetGatewayAvailable } from '@/src/infrastructure/ai/interceptors/intranet-fetch'

const origin = 'https://ai-vghtpe.mediprisma.tw'
const href = 'https://mediprisma.tw/app-staging/?site=vghtpe'
const originalEnv = { ...process.env }
afterEach(() => { process.env = { ...originalEnv }; Reflect.deleteProperty(globalThis, 'window') })
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
