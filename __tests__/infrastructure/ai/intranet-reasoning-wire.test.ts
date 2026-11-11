/**
 * Wire-level check with the real AI SDK: the SDK drops `reasoningEffort` for a
 * model id it does not recognise, so a mocked `streamText` cannot show that the
 * intranet Luna request actually carries it.
 */
jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: { hasChatProxy: true, hasGeminiProxy: true, hasClaudeProxy: false, streamIdleTimeoutMs: 60_000 },
}))

import { createOpenAI } from '@ai-sdk/openai'
import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'

async function sentBody(reasoningEffort?: 'low') {
  let body: Record<string, unknown> = {}
  const sdk = createOpenAI({
    baseURL: 'https://ai.example/v1',
    apiKey: 'test',
    fetch: (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body))
      return new Response('{}', { status: 500 })
    }) as typeof fetch,
  })
  const adapter = new AiSdkStreamAdapter({
    create: () => ({ model: sdk.responses('gpt-6-luna'), isGemini: false }),
  } as any)
  await adapter.stream({
    model: 'gpt-6-luna',
    messages: [{ role: 'user', content: 'Synthetic only.' }],
    apiKey: 'test',
    signal: new AbortController().signal,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    onChunk: () => {},
  }).catch(() => {})
  return body
}

test('a low-reasoning request to the intranet Luna reaches the wire as reasoning.effort', async () => {
  expect(await sentBody('low')).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'low' } })
})

test('without a requested effort the intranet Luna request carries no reasoning field', async () => {
  const body = await sentBody()
  expect(body.model).toBe('gpt-6-luna')
  expect(body).not.toHaveProperty('reasoning')
})
