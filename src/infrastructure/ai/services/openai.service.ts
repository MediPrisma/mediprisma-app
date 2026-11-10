import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'
// OpenAI Service Implementation
import type { AiQueryRequest, AiQueryResponse } from '@/src/core/entities/ai.entity'
import { ENV_CONFIG } from '@/src/shared/config/env.config'
import { getProxyAuthHeaders } from '../utils/proxy-auth'
import {
  getModelDefinitionOrThrow,
  isProxyEligibleModel,
  modelRequiresUserKey,
  resolveModelTemperature,
} from '@/src/shared/constants/ai-models.constants'
import { AiError, AiErrorCode } from '@/src/core/errors'
import { CLOUD_AI_ENDPOINTS } from '@/src/shared/config/cloud-ai-endpoints.config'
import { INTRANET_LUNA_ID, createIntranetFetch, intranetGatewayAvailable } from '../interceptors/intranet-fetch'

export class OpenAiService {
  readonly name = 'openai'

  constructor(private apiKey: string | null = null) {}

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey || ENV_CONFIG.hasChatProxy || intranetGatewayAvailable())
  }

  async query(request: AiQueryRequest): Promise<AiQueryResponse> {
    const intranet = request.modelId === INTRANET_LUNA_ID
    if (intranet && !intranetGatewayAvailable()) throw new Error('院內 GPT 僅供北榮 app-staging 使用')
    const modelDef = getModelDefinitionOrThrow(request.modelId)
    if (modelDef.provider !== 'openai') {
      throw new Error(`Model ${request.modelId} is not an OpenAI model`)
    }
    if (
      modelDef.apiSurface !== 'openai-chat-completions' &&
      modelDef.apiSurface !== 'openai-responses'
    ) {
      throw new Error(`OpenAI model ${request.modelId} has incompatible API surface ${modelDef.apiSurface}`)
    }
    const shouldUseProxy = !intranet && !this.apiKey && isProxyEligibleModel(modelDef) && ENV_CONFIG.hasChatProxy

    if (!intranet && !shouldUseProxy && !this.apiKey) {
      if (modelRequiresUserKey(modelDef)) {
        throw new AiError(
          'This model requires a personal OpenAI API key',
          AiErrorCode.API_KEY_MISSING,
          { modelId: request.modelId }
        )
      }
      throw new AiError(
        'OpenAI API key or proxy is required',
        AiErrorCode.API_KEY_MISSING,
        { modelId: request.modelId }
      )
    }

    // The API surface comes from the manifest. This keeps non-streaming calls
    // aligned with the SDK factory used by streaming and Agent chat.
    const targetUrl = intranet ? `${process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN}/v1/responses` : shouldUseProxy
      ? ENV_CONFIG.chatProxyUrl
      : modelDef.apiSurface === 'openai-responses'
        ? CLOUD_AI_ENDPOINTS.openAiResponses
        : CLOUD_AI_ENDPOINTS.openAiChatCompletions
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const temperature = resolveModelTemperature(modelDef, request.temperature)
    const isResponsesApi = modelDef.apiSurface === 'openai-responses'
    const body: Record<string, unknown> = isResponsesApi
      ? {
          model: request.modelId,
          input: request.messages,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_output_tokens: request.maxTokens } : {}),
          ...(request.responseFormat === 'json'
            ? { text: { format: { type: 'json_object' } } }
            : {}),
        }
      : {
          model: request.modelId,
          messages: request.messages,
          stream: false,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.responseFormat === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }

    if (intranet) {
      body.store = false
      body.max_output_tokens = Math.min(request.maxTokens ?? 2048, 2048)
    }

    if (shouldUseProxy) {
      if (ENV_CONFIG.proxyClientKey) {
        headers['x-proxy-key'] = ENV_CONFIG.proxyClientKey
      }
      // Proxy requires a signed-in user — Authorization carries the Firebase
      // ID token here (the user's own OpenAI key is the direct branch below)
      Object.assign(headers, await getProxyAuthHeaders())
    } else if (!intranet && this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    const forwardAbort = () => controller.abort()
    if (request.signal?.aborted) controller.abort()
    else request.signal?.addEventListener('abort', forwardAbort, { once: true })

    try {
      const send = intranet ? createIntranetFetch(process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN!) : fetch
      const response = await send(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = errorData.error?.message || errorData.error || 'OpenAI API request failed'
        
        // Determine error code based on status
        let errorCode = AiErrorCode.UNKNOWN_ERROR
        if (response.status === 401) {
          errorCode = AiErrorCode.API_KEY_INVALID
        } else if (response.status === 429) {
          errorCode = AiErrorCode.RATE_LIMIT_EXCEEDED
        } else if (response.status >= 500) {
          errorCode = AiErrorCode.NETWORK_ERROR
        }
        
        throw new AiError(
          this.sanitizeErrorMessage(errorMessage),
          errorCode,
          { modelId: request.modelId, status: response.status }
        )
      }

      const data = await response.json()
      const upstreamData = shouldUseProxy && data.openAiResponse
        ? data.openAiResponse
        : data
      const text = this.extractOpenAiContent(data, shouldUseProxy, isResponsesApi)

      const modelExecution = typeof upstreamData.model === 'string'
        ? reportModelExecution(createModelExecution(request.modelId), upstreamData.model)
        : createModelExecution(request.modelId)
      return {
        text,
        metadata: {
          modelId: modelExecution.actualModelId ?? 'unreported',
          modelExecution,
          provider: 'openai',
          tokensUsed: upstreamData.usage?.total_tokens,
        },
      }
    } finally {
      clearTimeout(timeoutId)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private extractOpenAiContent(data: any, shouldUseProxy: boolean, isResponsesApi: boolean): string {
    // Non-streaming proxy responses may wrap the native upstream response so
    // callers can use one endpoint for both Chat Completions and Responses.
    const upstreamData = shouldUseProxy && data.openAiResponse
      ? data.openAiResponse
      : data
    if (isResponsesApi) {
      if (shouldUseProxy && typeof data.message === 'string') return data.message
      if (typeof upstreamData.output_text === 'string') return upstreamData.output_text
      return (upstreamData.output ?? [])
        .filter((item: any) => item?.type === 'message')
        .flatMap((item: any) => item.content ?? [])
        .filter((part: any) => part?.type === 'output_text')
        .map((part: any) => part.text ?? '')
        .join('')
    }
    if (shouldUseProxy) {
      // Chat Completions proxy response: { message, openAiResponse }
      return data.message || data.text || upstreamData.choices?.[0]?.message?.content || ''
    }
    return upstreamData.choices?.[0]?.message?.content || ''
  }

  private sanitizeErrorMessage(message: string): string {
    // Remove actual API keys from error messages
    let sanitized = message
    
    // Remove OpenAI API key pattern (sk-...)
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[API_KEY_REDACTED]')
    
    // Remove Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer [TOKEN_REDACTED]')
    
    // Check for sensitive keywords that indicate API key exposure
    const hasSensitiveInfo = /api[_-]?key[:\s]*["']?sk-/gi.test(message)
    if (hasSensitiveInfo) {
      return 'Authentication failed. Please check your API key.'
    }

    // Map common error codes to user-friendly messages
    if (sanitized.includes('401') || sanitized.includes('Unauthorized')) {
      return 'Authentication failed. Please check your API key.'
    }
    if (sanitized.includes('429') || sanitized.includes('rate limit')) {
      return 'Rate limit exceeded. Please try again later.'
    }
    if (sanitized.includes('500') || sanitized.includes('Internal Server Error')) {
      return 'Service temporarily unavailable. Please try again later.'
    }
    if (sanitized.includes('timeout')) {
      return 'Request timed out. Please try again.'
    }

    return sanitized
  }
}
