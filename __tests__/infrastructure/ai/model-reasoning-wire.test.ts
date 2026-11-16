/** @jest-environment node */

import { generateText, streamText } from 'ai'
import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'
import { intranetGatewayAvailable } from '@/src/infrastructure/ai/interceptors/intranet-fetch'

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyIdToken: jest.fn().mockResolvedValue('test-firebase-id-token'),
}))
jest.mock('@/src/infrastructure/ai/utils/app-check', () => ({
  getAppCheckToken: jest.fn().mockResolvedValue('test-app-check-token'),
}))
jest.mock('@/src/infrastructure/ai/interceptors/intranet-fetch', () => ({
  INTRANET_LUNA_ID: 'gpt-6-luna',
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
  it.each([true, false])('sends Luna low in query and stream (proxy=%s)', async useProxy => {
    for (const streaming of [false, true]) {
      expect(await sentBody('gpt-6-luna', useProxy, streaming)).toMatchObject({
        model: 'gpt-6-luna', reasoning: { effort: 'low' },
      })
    }
  })

  it.each([true, false])('sends Haiku adaptive low with room for thinking (proxy=%s)', async useProxy => {
    for (const streaming of [false, true]) {
      expect(await sentBody('claude-haiku-5-5', useProxy, streaming)).toMatchObject({
        model: 'claude-haiku-5-5', thinking: { type: 'adaptive' },
        output_config: { effort: 'low' }, max_tokens: 32_768,
      })
    }
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
