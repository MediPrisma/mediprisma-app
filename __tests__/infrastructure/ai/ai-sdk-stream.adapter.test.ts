const mockStreamText = jest.fn()
const mockJsonOutput = jest.fn(() => ({ kind: 'json-output' }))

jest.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  Output: { json: () => mockJsonOutput() },
}))

jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: {
    hasChatProxy: true,
    hasGeminiProxy: true,
    hasClaudeProxy: false,
    streamIdleTimeoutMs: 60_000,
  },
}))

import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'

function textStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
}

describe('AiSdkStreamAdapter manifest request policy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStreamText.mockReturnValue({ textStream: textStream('hello') })
  })

  it('uses manifest policy for Responses models and forwards structured options', async () => {
    const create = jest.fn(() => ({ model: { kind: 'responses' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)
    const onChunk = jest.fn()

    await adapter.stream({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'personal-key',
      signal: new AbortController().signal,
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: 'json',
      onChunk,
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gpt-5.6-terra',
      apiKey: 'personal-key',
      useProxy: false,
    }))
    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
      model: { kind: 'responses' },
      maxOutputTokens: 2048,
      output: { kind: 'json-output' },
    }))
    expect(mockStreamText.mock.calls[0][0]).not.toHaveProperty('temperature')
    expect(onChunk).toHaveBeenCalledWith('hello')
  })

  it('keeps Luna selected and uses the proxy when no personal key is present', async () => {
    const create = jest.fn(() => ({ model: { kind: 'responses' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: null,
      signal: new AbortController().signal,
      onChunk: jest.fn(),
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gpt-5.6-luna',
      apiKey: undefined,
      useProxy: true,
    }))
  })

  it.each([
    [null, true],
    ['personal-gemini-key', false],
  ] as const)('keeps Gemini 3.8 selected with personal key %s', async (apiKey, useProxy) => {
    const create = jest.fn(() => ({ model: { kind: 'gemini' }, isGemini: true }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey,
      signal: new AbortController().signal,
      onChunk: jest.fn(),
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gemini-3.8-flash',
      apiKey: apiKey ?? undefined,
      useProxy,
    }))
  })

  it('forwards reasoning effort only for a configured custom gpt-oss model', async () => {
    const create = jest.fn(() => ({ model: { kind: 'chat' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'openai-compatible-custom:test-profile',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: null,
      openAiCompatible: {
        enabled: true,
        baseUrl: 'https://hospital.example/v1',
        modelId: 'gpt-oss:20b',
        apiKey: null,
      },
      signal: new AbortController().signal,
      reasoningEffort: 'low',
      onChunk: jest.fn(),
    })

    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
      providerOptions: { openai: { reasoningEffort: 'low' } },
    }))
  })

  it('forwards reasoning effort to the intranet Luna and to no other built-in model', async () => {
    const create = jest.fn(() => ({ model: { kind: 'responses' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)
    const request = {
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'personal-key',
      signal: new AbortController().signal,
      reasoningEffort: 'low' as const,
      onChunk: jest.fn(),
    }

    await adapter.stream({ ...request, model: 'gpt-6-luna' })
    expect(mockStreamText.mock.calls[0][0]).toMatchObject({
      providerOptions: { openai: { reasoningEffort: 'low', forceReasoning: true } },
    })

    await adapter.stream({ ...request, model: 'gpt-5.6-terra' })
    expect(mockStreamText.mock.calls[1][0]).not.toHaveProperty('providerOptions')
  })

  it('omits reasoning effort for non-gpt-oss custom models', async () => {
    const create = jest.fn(() => ({ model: { kind: 'chat' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'openai-compatible-custom:test-profile',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: null,
      openAiCompatible: {
        enabled: true,
        baseUrl: 'https://hospital.example/v1',
        modelId: 'gemma4:31b',
        apiKey: null,
      },
      signal: new AbortController().signal,
      reasoningEffort: 'low',
      onChunk: jest.fn(),
    })

    expect(mockStreamText.mock.calls[0][0]).not.toHaveProperty('providerOptions')
  })

  it('applies fixed-one sampling without inspecting a model prefix', async () => {
    const create = jest.fn(() => ({ model: { kind: 'chat' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'gpt-5.4-nano',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'personal-key',
      signal: new AbortController().signal,
      temperature: 0.2,
      onChunk: jest.fn(),
    })

    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({ temperature: 1 }))
  })

  it('omits sampling parameters for Claude 5 adaptive-thinking models', async () => {
    const create = jest.fn(() => ({ model: { kind: 'claude' }, isGemini: false }))
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await adapter.stream({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'personal-key',
      signal: new AbortController().signal,
      temperature: 0.2,
      onChunk: jest.fn(),
    })

    expect(mockStreamText.mock.calls[0][0]).not.toHaveProperty('temperature')
  })

  it('fails before provider creation for an unregistered model', async () => {
    const create = jest.fn()
    const adapter = new AiSdkStreamAdapter({ create } as any)

    await expect(adapter.stream({
      model: 'unregistered-future-model',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'personal-key',
      signal: new AbortController().signal,
      onChunk: jest.fn(),
    })).rejects.toThrow('Unsupported AI model')
    expect(create).not.toHaveBeenCalled()
    expect(mockStreamText).not.toHaveBeenCalled()
  })
})
