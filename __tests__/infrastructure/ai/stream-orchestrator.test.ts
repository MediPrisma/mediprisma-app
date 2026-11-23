import { StreamOrchestrator } from '@/src/infrastructure/ai/streaming/stream-orchestrator'

describe('StreamOrchestrator dependency injection', () => {
  it('delegates the unchanged request to its injected adapter', async () => {
    const stream = jest.fn().mockResolvedValue(undefined)
    const orchestrator = new StreamOrchestrator({ stream })
    const config = {
      model: 'gpt-6.1-terra',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'key',
      signal: new AbortController().signal,
      temperature: 0.2,
      maxTokens: 1234,
      responseFormat: 'json' as const,
      onChunk: jest.fn(),
    }

    await orchestrator.stream(config)

    expect(stream).toHaveBeenCalledTimes(1)
    expect(stream).toHaveBeenCalledWith(config)
  })
})
