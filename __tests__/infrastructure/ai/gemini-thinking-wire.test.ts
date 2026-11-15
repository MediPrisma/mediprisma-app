/** @jest-environment node */

import { generateText } from 'ai'
import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyIdToken: jest.fn().mockResolvedValue('test-firebase-id-token'),
}))
jest.mock('@/src/infrastructure/ai/utils/app-check', () => ({
  getAppCheckToken: jest.fn().mockResolvedValue('test-app-check-token'),
}))

const geminiReply = () => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
}), { headers: { 'content-type': 'application/json' } })

async function sentGenerationConfig(modelId: string, useProxy: boolean, providerOptions?: Record<string, never>) {
  const fetch = global.fetch as jest.Mock
  fetch.mockReset()
  fetch.mockResolvedValueOnce(geminiReply())
  const { model } = new AiProviderFactory().create({ modelId, useProxy, apiKey: useProxy ? undefined : 'test-key' })
  await generateText({ model, prompt: 'hi', ...(providerOptions ? { providerOptions } : {}) })
  return JSON.parse(fetch.mock.calls[0][1].body).generationConfig ?? {}
}

describe('Gemini thinking level on the wire', () => {
  it.each([true, false])('sends low thinking for Gemini 4 Hydrogen (proxy=%s)', async (useProxy) => {
    expect((await sentGenerationConfig('gemini-4-hydrogen', useProxy)).thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('leaves other Gemini models at their own default', async () => {
    expect((await sentGenerationConfig('gemini-3-flash-preview', true)).thinkingConfig).toBeUndefined()
  })

  it('keeps a level the caller asked for', async () => {
    const config = await sentGenerationConfig('gemini-4-hydrogen', true, {
      google: { thinkingConfig: { thinkingLevel: 'high' } },
    } as never)
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'high' })
  })
})
