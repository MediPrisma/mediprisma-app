import { AiService } from '@/src/infrastructure/ai/services/ai.service'
import { OpenAiCompatibleService } from '@/src/infrastructure/ai/services/openai-compatible.service'
import { customOpenAiModelIdForProfile } from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'

const profiles: OpenAiCompatibleProfile[] = [
  {
    profileId: 'endpoint-a',
    enabled: true,
    baseUrl: 'https://endpoint-a.example/v1',
    modelId: 'model-a',
    apiKey: 'key-a',
  },
  {
    profileId: 'endpoint-b',
    enabled: true,
    baseUrl: 'https://endpoint-b.example/v1',
    modelId: 'model-b',
    apiKey: 'key-b',
  },
]

const unavailableCloudService = {
  isAvailable: () => false,
  query: jest.fn(async () => { throw new Error('Unexpected cloud query') }),
}

function makeService(activeProfiles = profiles) {
  return new AiService({
    cloudServices: {
      openai: unavailableCloudService,
      gemini: unavailableCloudService,
      claude: unavailableCloudService,
    },
    createCustomService: (profile) => new OpenAiCompatibleService(profile),
  }, activeProfiles)
}

describe('AiService injected provider routing', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([
    ['openai', 'gpt-5.4-nano'],
    ['gemini', 'gemini-3.1-flash-lite'],
    ['claude', 'claude-haiku-5-5'],
  ] as const)('dispatches %s models through the injected provider service', async (provider, modelId) => {
    const queries = {
      openai: jest.fn().mockResolvedValue({ text: 'openai', metadata: { modelId, provider: 'openai' } }),
      gemini: jest.fn().mockResolvedValue({ text: 'gemini', metadata: { modelId, provider: 'gemini' } }),
      claude: jest.fn().mockResolvedValue({ text: 'claude', metadata: { modelId, provider: 'claude' } }),
    }
    const service = new AiService({
      cloudServices: {
        openai: { isAvailable: () => true, query: queries.openai },
        gemini: { isAvailable: () => true, query: queries.gemini },
        claude: { isAvailable: () => true, query: queries.claude },
      },
      createCustomService: () => unavailableCloudService,
    })

    await expect(service.query({
      modelId,
      messages: [{ role: 'user', content: 'hello' }],
    })).resolves.toMatchObject({ text: provider })
    expect(queries[provider]).toHaveBeenCalledTimes(1)
    for (const otherProvider of ['openai', 'gemini', 'claude'] as const) {
      if (otherProvider !== provider) expect(queries[otherProvider]).not.toHaveBeenCalled()
    }
  })

  it('routes a dynamic logical model id to that exact profile', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'from b' } }] }),
    } as Response)
    const service = makeService()

    await expect(service.query({
      modelId: customOpenAiModelIdForProfile('endpoint-b'),
      messages: [{ role: 'user', content: 'hello' }],
    })).resolves.toMatchObject({ text: 'from b' })

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://endpoint-b.example/v1/chat/completions',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'model-b',
    })
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer key-b',
    )
  })

  it('fails closed after the selected profile has been deleted', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const service = makeService()

    await expect(service.query({
      modelId: customOpenAiModelIdForProfile('deleted-endpoint'),
      messages: [{ role: 'user', content: 'clinical data' }],
    })).rejects.toThrow('not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown model before dispatching to a provider', async () => {
    const service = makeService()

    await expect(service.query({
      modelId: 'retired-or-misspelled-model',
      messages: [{ role: 'user', content: 'clinical data' }],
    })).rejects.toThrow('Unsupported AI model')
    expect(unavailableCloudService.query).not.toHaveBeenCalled()
  })
})
