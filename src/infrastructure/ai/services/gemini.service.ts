import { readTokenUsage } from '@/src/shared/utils/ai-token-usage'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'
// Gemini Service Implementation
import type { AiQueryRequest, AiQueryResponse } from '@/src/core/entities/ai.entity'
import { ENV_CONFIG } from '@/src/shared/config/env.config'
import { getProxyAuthHeaders } from '../utils/proxy-auth'
import {
  getModelDefinitionOrThrow,
  isProxyEligibleModel,
  modelRequiresUserKey,
  resolveModelTemperature,
} from '@/src/shared/constants/ai-models.constants'
import { CLOUD_AI_ENDPOINTS } from '@/src/shared/config/cloud-ai-endpoints.config'

export class GeminiService {
  constructor(private apiKey: string | null = null) {}

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey || ENV_CONFIG.hasGeminiProxy)
  }

  async query(request: AiQueryRequest): Promise<AiQueryResponse> {
    const modelDef = getModelDefinitionOrThrow(request.modelId)
    if (modelDef.provider !== 'gemini') {
      throw new Error(`Model ${request.modelId} is not a Gemini model`)
    }
    const shouldUseProxy = !this.apiKey && ENV_CONFIG.hasGeminiProxy && isProxyEligibleModel(modelDef)

    if (!shouldUseProxy && !this.apiKey) {
      throw new Error(modelRequiresUserKey(modelDef)
        ? 'This model requires a personal Gemini API key'
        : 'Gemini API key or proxy is required for this model')
    }

    // Use the absolute Firebase proxy URL (NEXT_PUBLIC_GEMINI_URL), consistent
    // with the streaming adapter and the provider factory. The relative
    // `/api/gemini-proxy` route only exists in a Next.js server runtime; on the
    // static GitHub Pages deployment it 405s, so always target the configured URL.
    const targetUrl = shouldUseProxy ? ENV_CONFIG.geminiProxyUrl : this.buildDirectApiUrl(request.modelId)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const temperature = resolveModelTemperature(modelDef, request.temperature)
    const generationConfig: Record<string, unknown> = {
      ...(request.responseFormat === 'json'
        ? { responseMimeType: 'application/json' }
        : {}),
      ...(request.maxTokens !== undefined
        ? { maxOutputTokens: request.maxTokens }
        : {}),
    }

    // Firebase's Gemini proxy accepts the app-level request contract. Direct
    // generateContent calls must instead use Google's Content schema: system
    // messages become systemInstruction, assistant becomes the `model` role,
    // and sampling settings live inside generationConfig.
    const body: Record<string, unknown> = shouldUseProxy
      ? {
          model: request.modelId,
          messages: request.messages,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
        }
      : this.buildDirectRequestBody(request, temperature, generationConfig)

    if (shouldUseProxy) {
      if (ENV_CONFIG.proxyClientKey) {
        headers['x-proxy-key'] = ENV_CONFIG.proxyClientKey
      }
      Object.assign(headers, await getProxyAuthHeaders())
    } else if (this.apiKey) {
      headers['x-goog-api-key'] = this.apiKey
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)
    const forwardAbort = () => controller.abort()
    if (request.signal?.aborted) controller.abort()
    else request.signal?.addEventListener('abort', forwardAbort, { once: true })

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = this.sanitizeErrorMessage(errorData.error?.message || errorData.error || 'Gemini API request failed')
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const text = this.extractGeminiContent(data, shouldUseProxy)

      const upstreamData = data.geminiResponse ?? data
      const modelExecution = typeof upstreamData.modelVersion === 'string'
        ? reportModelExecution(createModelExecution(request.modelId), upstreamData.modelVersion)
        : createModelExecution(request.modelId)
      return {
        text,
        metadata: {
          modelId: modelExecution.actualModelId ?? 'unreported',
          modelExecution,
          provider: 'gemini',
          tokensUsed: upstreamData.usageMetadata?.totalTokenCount || data.usage?.total_tokens,
          usage: readTokenUsage(upstreamData.usageMetadata) ?? readTokenUsage(data.usage),
        },
      }
    } finally {
      clearTimeout(timeoutId)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private buildDirectApiUrl(modelId: string): string {
    return `${CLOUD_AI_ENDPOINTS.geminiApiBase}/models/${modelId}:generateContent`
  }

  private buildDirectRequestBody(
    request: AiQueryRequest,
    temperature: number | undefined,
    generationConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    const systemInstruction = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')

    const directGenerationConfig = {
      ...generationConfig,
      ...(temperature !== undefined ? { temperature } : {}),
    }

    return {
      contents: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
      ...(systemInstruction
        ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
        : {}),
      ...(Object.keys(directGenerationConfig).length > 0
        ? { generationConfig: directGenerationConfig }
        : {}),
    }
  }

  private extractGeminiContent(data: any, shouldUseProxy: boolean): string {
    if (shouldUseProxy) {
      // Proxy response format may vary
      return data.message || data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }
    // Direct Gemini API response format
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }

  private sanitizeErrorMessage(message: string): string {
    // Remove actual API keys from error messages
    let sanitized = message
    
    // Remove Google API key pattern (AIza...)
    sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]{20,}/g, '[API_KEY_REDACTED]')
    
    // Remove Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer [TOKEN_REDACTED]')
    
    // Check for sensitive keywords that indicate API key exposure
    const hasSensitiveInfo = /api[_-]?key[:\s]*["']?AIza/gi.test(message)
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
