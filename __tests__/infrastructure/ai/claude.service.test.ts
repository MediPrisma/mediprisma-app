import { createAnthropic } from '@ai-sdk/anthropic'
import { ClaudeService } from '@/src/infrastructure/ai/services/claude.service'
import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'
import { ENV_CONFIG } from '@/src/shared/config/env.config'

jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: {
    hasClaudeProxy: false,
    claudeProxyUrl: '',
    proxyClientKey: '',
  },
}))

const mutableEnv = ENV_CONFIG as unknown as {
  hasClaudeProxy: boolean
  claudeProxyUrl: string
  proxyClientKey: string
}

function successfulClaudeResponse(model: string): Response {
  const body = JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Clinical summary' }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
  })

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    text: async () => body,
  } as unknown as Response
}

function requestHeaders(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(
    Object.entries(init?.headers as Record<string, string>)
      .map(([name, value]) => [name.toLowerCase(), value]),
  )
}

describe('ClaudeService', () => {
  const originalFetch = global.fetch
  const originalStructuredClone = global.structuredClone
  let mockFetch: jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    mutableEnv.hasClaudeProxy = false
    mutableEnv.claudeProxyUrl = ''
    mutableEnv.proxyClientKey = ''
    mockFetch = jest.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      return successfulClaudeResponse(body.model)
    })
    global.fetch = mockFetch
    global.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.structuredClone = originalStructuredClone
  })

  it('serializes a personal-key Claude 5 request through the native Messages API contract', async () => {
    const service = new ClaudeService('test-personal-key', new AiProviderFactory())

    const result = await service.query({
      modelId: 'claude-opus-5-5',
      messages: [
        { role: 'system', content: 'Follow clinical safety rules.' },
        { role: 'user', content: 'Summarize the record.' },
        { role: 'assistant', content: 'What time range?' },
        { role: 'user', content: 'The past year.' },
      ],
      temperature: 0.2,
      maxTokens: 2048,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]
    const headers = requestHeaders(init)
    const body = JSON.parse(String(init?.body))

    expect(headers['x-api-key']).toBe('test-personal-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 2048,
      system: [
        { type: 'text', text: 'Follow clinical safety rules.' },
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Summarize the record.' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'What time range?' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'The past year.' }],
        },
      ],
    })
    expect(body).not.toHaveProperty('temperature')
    expect(result).toMatchObject({
      text: 'Clinical summary',
      metadata: {
        modelId: 'claude-opus-5-5',
        provider: 'claude',
        tokensUsed: 12,
      },
    })
  })

  it('omits sampling parameters for Claude Haiku 5.5', async () => {
    const service = new ClaudeService('test-personal-key', new AiProviderFactory())

    await service.query({
      modelId: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'Summarize the record.' }],
      temperature: 0.2,
    })

    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body))
    expect(body.temperature).toBeUndefined()
  })

  it('uses the owner proxy only for the proxy-eligible Claude base model', async () => {
    mutableEnv.hasClaudeProxy = true
    mutableEnv.claudeProxyUrl = 'https://proxy.example.com/claude'
    const provider = createAnthropic({ apiKey: 'proxy', fetch: mockFetch })
    const create = jest.fn(() => ({
      model: provider('claude-haiku-5-5'),
      isGemini: false,
    }))
    const service = new ClaudeService(null, { create })

    await service.query({
      modelId: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'Summarize the record.' }],
    })

    expect(create).toHaveBeenCalledWith({
      modelId: 'claude-haiku-5-5',
      apiKey: undefined,
      onModelReported: expect.any(Function),
      onModelUnreported: expect.any(Function),
      useProxy: true,
    })
  })

  it('rejects a key-only Claude model before provider creation when no key exists', async () => {
    mutableEnv.hasClaudeProxy = true
    const create = jest.fn()
    const service = new ClaudeService(null, { create })

    await expect(service.query({
      modelId: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'Summarize the record.' }],
    })).rejects.toThrow('Claude API key is required')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a non-Claude model before provider creation', async () => {
    const create = jest.fn()
    const service = new ClaudeService('test-personal-key', { create })

    await expect(service.query({
      modelId: 'gemini-4-hydrogen',
      messages: [{ role: 'user', content: 'Summarize the record.' }],
    })).rejects.toThrow('is not a Claude model')
    expect(create).not.toHaveBeenCalled()
  })
})
