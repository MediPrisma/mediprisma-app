jest.mock('@/src/infrastructure/ai/streaming/model-reporting.middleware', () => ({
  withModelReporting: (model: unknown) => model,
}))

jest.mock('@/src/infrastructure/ai/streaming/openai-stateless.middleware', () => ({
  withOpenAiStatelessResponses: (model: object) => ({ ...model, stateless: true }),
}))

const mockChat = jest.fn((modelId: string) => ({ kind: 'chat-model', modelId }))
const mockResponses = jest.fn((modelId: string) => ({ kind: 'responses-model', modelId }))
const mockCreateOpenAI = jest.fn((_config: unknown) => ({
  chat: mockChat,
  responses: mockResponses,
}))
const mockOpenRouterChat = jest.fn((modelId: string) => ({
  kind: 'openrouter-chat-model',
  modelId,
}))
const mockCreateOpenRouter = jest.fn((_config: unknown) => ({
  chat: mockOpenRouterChat,
}))

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (config: unknown) => mockCreateOpenAI(config),
}))

jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: (config: unknown) => mockCreateOpenRouter(config),
}))

import { AiProviderFactory } from '@/src/infrastructure/ai/factories/ai-provider.factory'
import {
  CUSTOM_OPENAI_MODEL_ID,
  MODEL_CATALOG,
  customOpenAiModelIdForProfile,
} from '@/src/shared/constants/ai-models.constants'

describe('AiProviderFactory routing', () => {
  beforeEach(() => {
    mockChat.mockClear()
    mockResponses.mockClear()
    mockCreateOpenAI.mockClear()
    mockOpenRouterChat.mockClear()
    mockCreateOpenRouter.mockClear()
  })

  it.each(MODEL_CATALOG.filter((model) => model.apiSurface === 'openai-responses' && model.id !== 'gpt-6-luna'))(
    'routes $id through the manifest-declared Responses API',
    ({ id: modelId }) => {
      const factory = new AiProviderFactory()
      const result = factory.create({
        modelId,
        apiKey: 'test-openai-key',
        useProxy: false,
      })

      expect(mockResponses).toHaveBeenCalledWith(modelId)
      expect(mockChat).not.toHaveBeenCalled()
      expect(result.model).toEqual({ kind: 'responses-model', modelId })
    },
  )

  it('keeps the free Nano proxy on Chat Completions', () => {
    const factory = new AiProviderFactory()
    const result = factory.create({
      modelId: 'gpt-5.4-nano',
      useProxy: true,
    })

    expect(mockChat).toHaveBeenCalledWith('gpt-5.4-nano')
    expect(mockResponses).not.toHaveBeenCalled()
    expect(result.model).toEqual({ kind: 'chat-model', modelId: 'gpt-5.4-nano' })
  })

  it('routes the free Luna proxy through the Responses API', () => {
    const factory = new AiProviderFactory()
    const result = factory.create({
      modelId: 'gpt-5.6-luna',
      useProxy: true,
    })

    expect(mockResponses).toHaveBeenCalledWith('gpt-5.6-luna')
    expect(mockChat).not.toHaveBeenCalled()
    expect(result.model).toEqual({
      kind: 'responses-model',
      modelId: 'gpt-5.6-luna',
      stateless: true,
    })
  })

  it('fails closed for an unknown model before creating an SDK provider', () => {
    const factory = new AiProviderFactory()

    expect(() => factory.create({
      modelId: 'future-model-not-in-manifest',
      apiKey: 'test-key',
      useProxy: false,
    })).toThrow('Unsupported AI model')
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
  })

  it('never lets a key-only model use the owner-funded proxy', () => {
    const keyOnly = MODEL_CATALOG.find((model) => model.access === 'key-only')!
    const factory = new AiProviderFactory()

    expect(() => factory.create({
      modelId: keyOnly.id,
      useProxy: true,
    })).toThrow('not eligible')
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
  })

  it('always creates a direct provider with the configured base URL and actual upstream model', () => {
    const factory = new AiProviderFactory()
    const result = factory.create({
      modelId: CUSTOM_OPENAI_MODEL_ID,
      // Even a mistaken caller cannot send this logical model to owner proxy.
      useProxy: true,
      openAiCompatible: {
        enabled: true,
        baseUrl: 'https://llm.intra.example/v1/chat/completions',
        modelId: 'hospital-model-v2',
        apiKey: null,
      },
    })

    expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
    expect(mockCreateOpenAI.mock.calls[0][0]).toMatchObject({
      baseURL: 'https://llm.intra.example/v1',
      apiKey: 'local-endpoint-no-auth',
      fetch: expect.any(Function),
    })
    expect(mockChat).toHaveBeenCalledWith('hospital-model-v2')
    expect(result.model).toEqual({ kind: 'chat-model', modelId: 'hospital-model-v2' })
  })

  it('uses the native OpenRouter adapter for official endpoints', () => {
    const factory = new AiProviderFactory()
    const result = factory.create({
      modelId: CUSTOM_OPENAI_MODEL_ID,
      useProxy: false,
      openAiCompatible: {
        enabled: true,
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'qwen/qwen3.6-35b-a3b',
        apiKey: 'openrouter-test-key',
      },
    })

    expect(mockCreateOpenRouter).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-test-key',
      fetch: expect.any(Function),
      compatibility: 'strict',
    }))
    expect(mockOpenRouterChat).toHaveBeenCalledWith('qwen/qwen3.6-35b-a3b')
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
    expect(result.model).toEqual({
      kind: 'openrouter-chat-model',
      modelId: 'qwen/qwen3.6-35b-a3b',
    })
  })

  it('fails closed instead of creating any provider when the profile is disabled', () => {
    const factory = new AiProviderFactory()
    expect(() => factory.create({
      modelId: CUSTOM_OPENAI_MODEL_ID,
      useProxy: false,
      openAiCompatible: {
        enabled: false,
        baseUrl: 'https://llm.intra.example/v1',
        modelId: 'hospital-model',
        apiKey: null,
      },
    })).toThrow('not configured')
    expect(mockCreateOpenAI).not.toHaveBeenCalled()
  })

  it('recognizes a profile-scoped logical model as custom', () => {
    const factory = new AiProviderFactory()
    factory.create({
      modelId: customOpenAiModelIdForProfile('endpoint-b'),
      useProxy: true,
      openAiCompatible: {
        enabled: true,
        baseUrl: 'https://endpoint-b.example/v1',
        modelId: 'upstream-b',
        apiKey: null,
      },
    })

    expect(mockChat).toHaveBeenCalledWith('upstream-b')
  })
})
