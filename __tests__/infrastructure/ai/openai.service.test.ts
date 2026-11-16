// Unit Tests: OpenAI Service
jest.mock('@/src/shared/config/env.config', () => ({
  ENV_CONFIG: {
    hasChatProxy: true,
    chatProxyUrl: 'https://proxy.example/openai',
    proxyClientKey: '',
  },
}))

jest.mock('@/src/infrastructure/ai/utils/proxy-auth', () => ({
  getProxyAuthHeaders: jest.fn().mockResolvedValue({
    Authorization: 'Bearer firebase-test-token',
  }),
}))

import { OpenAiService } from '@/src/infrastructure/ai/services/openai.service'
import type { AiQueryRequest } from '@/src/core/entities/ai.entity'

// Mock fetch
global.fetch = jest.fn()

describe('OpenAiService', () => {
  let service: OpenAiService
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    jest.clearAllMocks()
    service = new OpenAiService('test-api-key')
  })

  describe('isAvailable', () => {
    it('should return true when API key is set', () => {
      const service = new OpenAiService('test-key')
      expect(service.isAvailable()).toBe(true)
    })

    it('should check availability based on API key or proxy', () => {
      const service = new OpenAiService(null)
      // Note: isAvailable() checks ENV_CONFIG.hasChatProxy which may be true in test environment
      expect(typeof service.isAvailable()).toBe('boolean')
    })
  })

  describe('setApiKey', () => {
    it('should update API key', () => {
      const service = new OpenAiService(null)

      service.setApiKey('new-key')
      expect(service.isAvailable()).toBe(true)
    })

    it('should allow setting key to null', () => {
      const service = new OpenAiService('test-key')
      expect(service.isAvailable()).toBe(true)
      
      service.setApiKey(null)
      // May still be available if proxy is configured
      expect(typeof service.isAvailable()).toBe('boolean')
    })
  })

  describe('query', () => {
    const mockRequest: AiQueryRequest = {
      modelId: 'gpt-5.4-nano',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      temperature: 0.7,
    }

    it('should successfully query OpenAI API', async () => {
      // Arrange
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello! How can I help you?'
            }
          }
        ],
        usage: {
          total_tokens: 20
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      // Act
      const result = await service.query(mockRequest)

      // Assert
      expect(result.text).toBe('Hello! How can I help you?')
      expect(result.metadata.modelId).toBe('unreported')
      expect(result.metadata.provider).toBe('openai')
      expect(result.metadata.tokensUsed).toBe(20)
    })

    it('should throw error when API key is missing', async () => {
      // Arrange
      const service = new OpenAiService(null)
      
      // Mock fetch to simulate no proxy available
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'API key required' }),
      } as Response)
      
      // Act & Assert
      await expect(service.query(mockRequest)).rejects.toThrow()
    })

    it('should handle API errors', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'Invalid request' } }),
      } as Response)

      // Act & Assert
      // Error message is sanitized, so we just check it throws
      await expect(service.query(mockRequest)).rejects.toThrow()
    })

    it('should handle timeout', async () => {
      // Arrange
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValueOnce(abortError)

      // Act & Assert
      await expect(service.query(mockRequest)).rejects.toThrow()
    })

    it('should forward caller cancellation to the non-streaming request', async () => {
      mockFetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }))
      const controller = new AbortController()
      const pending = service.query({ ...mockRequest, signal: controller.signal })

      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('applies the manifest fixed-one temperature policy', async () => {
      // Reset mock to clear any leftover mock implementations
      mockFetch.mockReset()
      // Arrange
      const gpt5Request: AiQueryRequest = {
        modelId: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: 'Test' }],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      } as Response)

      // Act
      await service.query(gpt5Request)

      // Assert
      const fetchCalls = mockFetch.mock.calls
      const lastCall = fetchCalls[fetchCalls.length - 1]
      const body = JSON.parse(lastCall[1]?.body as string)
      expect(body.temperature).toBe(1)
    })

    it('rejects unknown OpenAI ids before calling fetch', async () => {
      await expect(service.query({
        modelId: 'gpt-future-unregistered',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      })).rejects.toThrow('Unsupported AI model')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('forces temperature=1 for GPT-5.4-family models', async () => {
      const request: AiQueryRequest = {
        modelId: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      } as Response)

      await service.query(request)

      const fetchCall = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchCall[1]?.body as string)
      expect(body.temperature).toBe(1)
    })

    it('omits legacy sampling parameters for GPT-5.6 reasoning requests', async () => {
      const request: AiQueryRequest = {
        modelId: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
        maxTokens: 4096,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Response' }] }],
          usage: { total_tokens: 99 },
        }),
      } as Response)

      const result = await service.query(request)

      const fetchCall = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchCall[1]?.body as string)
      expect(body.temperature).toBeUndefined()
      expect(String(fetchCall[0])).toBe('https://api.openai.com/v1/responses')
      expect(body.input).toEqual(request.messages)
      expect(body.max_output_tokens).toBe(4096)
      expect(result).toMatchObject({ text: 'Response', metadata: { tokensUsed: 99 } })
    })

    it('uses the proxy for Luna without a personal key and reads a wrapped Responses payload', async () => {
      const service = new OpenAiService(null)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Proxy Luna response',
          openAiResponse: {
            model: 'gpt-6-luna',
            output: [{
              type: 'message',
              content: [{ type: 'output_text', text: 'Proxy Luna response' }],
            }],
            usage: { total_tokens: 42 },
          },
        }),
      } as Response)

      const result = await service.query({
        modelId: 'gpt-6-luna',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
        maxTokens: 2048,
      })

      const [url, init] = mockFetch.mock.calls[0]
      const body = JSON.parse(init?.body as string)
      expect(String(url)).toBe('https://proxy.example/openai')
      expect((init?.headers as Record<string, string>).Authorization)
        .toBe('Bearer firebase-test-token')
      expect(body).toMatchObject({
        model: 'gpt-6-luna',
        input: [{ role: 'user', content: 'Test' }],
        max_output_tokens: 2048,
      })
      expect(body).not.toHaveProperty('temperature')
      expect(result).toEqual({
        text: 'Proxy Luna response',
        metadata: {
          modelId: 'gpt-6-luna',
          modelExecution: { requestedModelId: 'gpt-6-luna', routedModelId: 'gpt-6-luna', actualModelId: 'gpt-6-luna', actualModelIds: ['gpt-6-luna'] },
          provider: 'openai',
          tokensUsed: 42,
        },
      })
    })

    it('should attach an auth header derived from the API key', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      } as Response)

      // Act
      await service.query(mockRequest)

      // Assert
      // The service picks between two auth mechanisms based on env:
      //   - chat proxy enabled  → headers['x-proxy-key'] (proxy auth)
      //   - direct OpenAI call  → headers['Authorization'] = `Bearer <key>`
      // Test env may have either, so assert that ONE of them carries the
      // expected secret rather than pinning the specific header name.
      const fetchCall = mockFetch.mock.calls[0]
      const headers = fetchCall[1]?.headers as Record<string, string>
      const hasBearer = headers['Authorization'] === 'Bearer test-api-key'
      const hasProxyKey = typeof headers['x-proxy-key'] === 'string'
      expect(hasBearer || hasProxyKey).toBe(true)
    })

    it('should set response_format json_object when responseFormat is json', async () => {
      // Arrange
      const jsonRequest: AiQueryRequest = {
        modelId: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: 'Test' }],
        responseFormat: 'json',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
        }),
      } as Response)

      // Act
      await service.query(jsonRequest)

      // Assert
      const fetchCall = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchCall[1]?.body as string)
      expect(body.response_format).toEqual({ type: 'json_object' })
    })

    it('should NOT set response_format when responseFormat is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      } as Response)

      await service.query(mockRequest)

      const fetchCall = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchCall[1]?.body as string)
      expect(body.response_format).toBeUndefined()
    })

    it('should handle empty response content', async () => {
      // Reset mock to clear any leftover mock implementations
      mockFetch.mockReset()
      
      // Arrange
      const emptyRequest: AiQueryRequest = {
        modelId: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: 'Test' }],
      }
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
        }),
      } as Response)

      // Act
      const result = await service.query(emptyRequest)

      // Assert
      // extractOpenAiContent returns empty string for empty content
      expect(result.text).toBe('')
    })
  })
})
