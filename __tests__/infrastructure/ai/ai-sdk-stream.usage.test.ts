const mockStreamText = jest.fn()

jest.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  Output: { json: () => ({}) },
}))
jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: { hasChatProxy: true, hasGeminiProxy: true, hasClaudeProxy: false, streamIdleTimeoutMs: 60_000 },
}))

import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'

const textStream = (...chunks: string[]) => (async function* () { for (const chunk of chunks) yield chunk })()
const adapter = () => new AiSdkStreamAdapter({ create: jest.fn(() => ({ model: { kind: 'responses' } })) } as never)
const config = (onUsage: jest.Mock, signal = new AbortController().signal) => ({
  model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }], apiKey: 'personal-key', signal, onChunk: jest.fn(), onUsage,
})

describe('AiSdkStreamAdapter token usage', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reports the usage the service returned once the stream completes', async () => {
    mockStreamText.mockReturnValue({ textStream: textStream('he', 'llo'), usage: Promise.resolve({ inputTokens: 1200, outputTokens: 34, totalTokens: 1234 }) })
    const onUsage = jest.fn()
    await adapter().stream(config(onUsage))
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1200, outputTokens: 34 })
  })

  it('completes normally when the service reports no usage or the usage report fails', async () => {
    const onUsage = jest.fn()
    mockStreamText.mockReturnValue({ textStream: textStream('hello'), usage: Promise.resolve({ inputTokens: undefined, outputTokens: undefined }) })
    await expect(adapter().stream(config(onUsage))).resolves.toBeUndefined()
    const failed = Promise.reject(new Error('synthetic usage failure'))
    failed.catch(() => {})
    mockStreamText.mockReturnValue({ textStream: textStream('hello'), usage: failed })
    await expect(adapter().stream(config(onUsage))).resolves.toBeUndefined()
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('does not report usage for a stream that failed', async () => {
    mockStreamText.mockImplementation(({ onError }: { onError: (event: { error: unknown }) => void }) => {
      onError({ error: new Error('synthetic upstream failure') })
      return { textStream: textStream(), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }) }
    })
    const onUsage = jest.fn()
    await expect(adapter().stream(config(onUsage))).rejects.toThrow('synthetic upstream failure')
    expect(onUsage).not.toHaveBeenCalled()
  })
})
