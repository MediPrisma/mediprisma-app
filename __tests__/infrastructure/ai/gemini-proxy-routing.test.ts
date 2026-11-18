/** @jest-environment node */

import { ProxyFetchInterceptor } from '@/src/infrastructure/ai/interceptors/proxy-fetch.interceptor'

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyIdToken: jest.fn().mockResolvedValue('test-firebase-id-token'),
}))
jest.mock('@/src/infrastructure/ai/utils/app-check', () => ({
  getAppCheckToken: jest.fn().mockResolvedValue('test-app-check-token'),
}))

describe('Gemini proxy model routing', () => {
  it.each([
    ['streamGenerateContent', true],
    ['generateContent', false],
  ] as const)('preserves the selected model and native tool parts for %s', async (endpoint, streaming) => {
    const response = new Response('ok')
    const fetch = global.fetch as jest.Mock
    fetch.mockResolvedValueOnce(response)
    const proxyFetch = new ProxyFetchInterceptor().createProxyFetch({
      proxyUrl: 'https://proxy.example.com/gemini',
      proxyClientKey: 'test-client-key',
      isGemini: true,
      modelId: 'gemini-4-hydrogen',
    })
    const nativeBody = {
      contents: [
        { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} }, thoughtSignature: 'test-signature' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { result: 'ok' } } }] },
      ],
      generationConfig: { temperature: 1 },
    }

    const result = await proxyFetch(
      `https://sdk.example.com/models/gemini-4-hydrogen:${endpoint}`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': 'proxy-dummy-key' },
        body: JSON.stringify(nativeBody),
      },
    )

    expect(result).toBe(response)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://proxy.example.com/gemini')
    expect(JSON.parse(init.body)).toEqual({
      ...nativeBody,
      model: 'gemini-4-hydrogen',
      __proxyStreaming: streaming,
    })
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer test-firebase-id-token')
    expect(headers.get('x-firebase-appcheck')).toBe('test-app-check-token')
    expect(headers.get('x-goog-api-key')).toBeNull()
  })
})

describe('OpenAI Responses proxy stream guarding', () => {
  it('normalizes a bare proxy error only on the Responses endpoint', async () => {
    const fetch = global.fetch as jest.Mock
    fetch.mockResolvedValueOnce(new Response('data: {"error":"Upstream request failed"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }))
    const proxyFetch = new ProxyFetchInterceptor().createProxyFetch({
      proxyUrl: 'https://proxy.example.com/openai',
      proxyClientKey: 'test-client-key',
      isGemini: false,
      modelId: 'gpt-6.1-terra',
    })

    const result = await proxyFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6.1-terra', input: 'hello' }),
    })

    const body = await result.text()
    expect(JSON.parse(body.replace(/^data: /, '').trim())).toMatchObject({
      type: 'error',
      error: { code: 'upstream_error', message: 'Upstream request failed' },
    })
  })

  it('leaves a chat-completions SSE response untouched', async () => {
    const event = 'data: {"error":"Upstream request failed"}\n\n'
    const response = new Response(event, { headers: { 'content-type': 'text/event-stream' } })
    const fetch = global.fetch as jest.Mock
    fetch.mockResolvedValueOnce(response)
    const proxyFetch = new ProxyFetchInterceptor().createProxyFetch({
      proxyUrl: 'https://proxy.example.com/openai',
      isGemini: false,
      modelId: 'gpt-4.1-mini',
    })

    const result = await proxyFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    })

    expect(result).toBe(response)
    await expect(result.text()).resolves.toBe(event)
  })
})
