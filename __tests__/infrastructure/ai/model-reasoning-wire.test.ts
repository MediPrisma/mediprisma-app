/** @jest-environment node */

import { generateText, streamText } from 'ai'
import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'
import { OpenAiService } from '@/src/infrastructure/ai/services/openai.service'
import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'
import { intranetGatewayAvailable } from '@/src/infrastructure/ai/interceptors/intranet-fetch'

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyIdToken: jest.fn().mockResolvedValue('test-firebase-id-token'),
  getProxyAuthHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer synthetic-test-id' }),
}))
jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: { hasChatProxy: true, hasGeminiProxy: true, hasClaudeProxy: true,
    chatProxyUrl: 'https://proxy.example.test/openai',
    geminiProxyUrl: 'https://proxy.example.test/gemini',
    claudeProxyUrl: 'https://proxy.example.test/claude', proxyClientKey: '', streamIdleTimeoutMs: 60_000 },
}))
jest.mock('@/src/infrastructure/ai/utils/app-check', () => ({
  getAppCheckToken: jest.fn().mockResolvedValue('test-app-check-token'),
}))
jest.mock('@/src/infrastructure/ai/interceptors/intranet-fetch', () => ({
  INTRANET_LUNA_ID: 'gpt-6-luna',
  intranetMaxRetries: () => 0,
  intranetGatewayAvailable: jest.fn().mockReturnValue(false),
  createIntranetFetch: () => global.fetch,
}))

async function sentBody(modelId: string, useProxy: boolean, streaming = false, overrides = {}) {
  const fetch = global.fetch as jest.Mock
  fetch.mockReset()
  // Real SDK serialization, no provider traffic or paid calls.
  fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
  const { model } = new AiProviderFactory().create({ modelId, useProxy, apiKey: useProxy ? undefined : 'test-key' })
  const options = { model, prompt: 'Synthetic only.', maxRetries: 0, ...overrides }
  try {
    if (streaming) {
      const result = streamText({ ...options, onError: () => {} })
      for await (const _ of result.textStream) { /* consume the mocked error */ }
    } else {
      await generateText(options)
    }
  } catch { /* response is intentionally a synthetic HTTP 500 */ }
  expect(fetch).toHaveBeenCalledTimes(1)
  return JSON.parse(fetch.mock.calls[0][1].body)
}

describe('Luna and Haiku reasoning defaults on the wire', () => {
  it.each(['proxy', 'direct', 'intranet'])('serializes opt-in Luna verbosity without increasing thinking (%s)', async route => {
    const original = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
    process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = 'https://intranet.example.test'
    jest.mocked(intranetGatewayAvailable).mockReturnValue(route === 'intranet')
    try {
      for (const textVerbosity of [undefined, 'high'] as const) {
        const fetch = global.fetch as jest.Mock
        fetch.mockReset()
        fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
        await expect(new AiSdkStreamAdapter(new AiProviderFactory()).stream({
          model: 'gpt-6-luna', apiKey: route === 'direct' ? 'test-key' : null,
          messages: [{ role: 'user', content: 'Synthetic only.' }],
          signal: new AbortController().signal, onChunk: () => {},
          reasoningEffort: 'low', textVerbosity,
        })).rejects.toThrow()
        expect(fetch).toHaveBeenCalledTimes(1)
        const body = JSON.parse(fetch.mock.calls[0][1].body)
        expect(body.reasoning).toEqual({ effort: 'low' })
        expect(body.text?.verbosity).toBe(textVerbosity)
      }
    } finally {
      jest.mocked(intranetGatewayAvailable).mockReturnValue(false)
      if (original === undefined) delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
      else process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = original
    }
  })

  it.each(['proxy', 'direct', 'intranet'])('sends low through the production OpenAiService query (%s)', async route => {
    const original = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
    process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = 'https://intranet.example.test'
    jest.mocked(intranetGatewayAvailable).mockReturnValue(route === 'intranet')
    const fetch = global.fetch as jest.Mock
    fetch.mockReset()
    fetch.mockResolvedValue(new Response('{}', { status: 500 }))
    try {
      const service = new OpenAiService(route === 'direct' ? 'test-key' : null)
      await expect(service.query({ modelId: 'gpt-6-luna',
        messages: [{ role: 'user', content: 'Synthetic only.' }],
      })).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ reasoning: { effort: 'low' } })
    } finally {
      jest.mocked(intranetGatewayAvailable).mockReturnValue(false)
      if (original === undefined) delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
      else process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = original
    }
  })

  it('preserves an explicit effort in the production query service', async () => {
    const fetch = global.fetch as jest.Mock
    fetch.mockReset()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(new OpenAiService('test-key').query({ modelId: 'gpt-6-luna',
      messages: [{ role: 'user', content: 'Synthetic only.' }], reasoningEffort: 'high',
    })).rejects.toThrow()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ reasoning: { effort: 'high' } })
  })

  it.each([true, false])('sends Luna low in query and stream (proxy=%s)', async useProxy => {
    for (const streaming of [false, true]) {
      expect(await sentBody('gpt-6-luna', useProxy, streaming)).toMatchObject({
        model: 'gpt-6-luna', reasoning: { effort: 'low' },
      })
    }
  })

  it.each([true, false])('sends Haiku low with thinking explicitly disabled (proxy=%s)', async useProxy => {
    for (const streaming of [false, true]) {
      expect(await sentBody('claude-haiku-5-5', useProxy, streaming)).toMatchObject({
        model: 'claude-haiku-5-5', thinking: { type: 'disabled' },
        output_config: { effort: 'low' }, max_tokens: 8_192,
      })
    }
  })

  it.each([null, 'test-key'])('lets one Haiku stream think when the caller asks (apiKey=%s)', async apiKey => {
    const fetch = global.fetch as jest.Mock
    fetch.mockReset()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(new AiSdkStreamAdapter(new AiProviderFactory()).stream({
      model: 'claude-haiku-5-5', apiKey,
      messages: [{ role: 'user', content: 'Synthetic only.' }],
      signal: new AbortController().signal, onChunk: () => {},
      claudeThinkingEffort: 'medium', maxTokens: 16_000,
    })).rejects.toThrow()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, max_tokens: 16_000,
    })
  })

  it('keeps explicit Luna effort and output limits', async () => {
    expect(await sentBody('gpt-6-luna', true, false, {
      maxOutputTokens: 1000, providerOptions: { openai: { reasoningEffort: 'none' } },
    })).toMatchObject({ reasoning: { effort: 'none' }, max_output_tokens: 1000 })
  })

  it('keeps explicit Haiku thinking, effort and output limits', async () => {
    expect(await sentBody('claude-haiku-5-5', false, true, {
      maxOutputTokens: 1000,
      providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'medium' } },
    })).toMatchObject({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' }, max_tokens: 1000 })
  })

  it.each(['gpt-6.1-sol', 'claude-sonnet-5-5'])('leaves %s at the provider default', async modelId => {
    const body = await sentBody(modelId, false)
    expect(body.reasoning?.effort).toBeUndefined()
    expect(body.output_config?.effort).toBeUndefined()
    expect(body.thinking).toBeUndefined()
  })

  it('also applies Luna low to the existing intranet route without contacting it', async () => {
    const original = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
    process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = 'https://intranet.example.test'
    jest.mocked(intranetGatewayAvailable).mockReturnValue(true)
    try {
      expect(await sentBody('gpt-6-luna', true, true)).toMatchObject({ reasoning: { effort: 'low' }, store: false })
    } finally {
      jest.mocked(intranetGatewayAvailable).mockReturnValue(false)
      if (original === undefined) delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
      else process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = original
    }
  })
})
