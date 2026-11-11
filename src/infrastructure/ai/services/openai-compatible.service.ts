import { readTokenUsage } from '@/src/shared/utils/ai-token-usage'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'
import type { AiQueryRequest, AiQueryResponse } from '@/src/core/entities/ai.entity'
import { AiError, AiErrorCode } from '@/src/core/errors'
import type { OpenAiCompatibleConfig } from '@/src/shared/types/openai-compatible.types'
import { normalizeOpenAiCompatibleTransport } from '@/src/shared/types/openai-compatible.types'
import {
  isOpenAiCompatibleRuntimeReady,
  openAiCompatibleEndpointUrl,
} from '@/src/shared/utils/openai-compatible.utils'
import { createConfiguredOpenAiCompatibleFetch } from
  '@/src/infrastructure/ai/openai-compatible/openai-compatible.client'

// Local 7B-class models can spend several minutes evaluating a long clinical
// prompt before returning a non-streaming response. Cloud-provider services
// retain their shorter limits; this longer cap applies only to the user's
// direct OpenAI-compatible endpoint. The caller's AbortSignal still stops it
// immediately when the user cancels or starts a replacement batch.
export const OPENAI_COMPATIBLE_QUERY_TIMEOUT_MS = 10 * 60_000
const LOCAL_MODEL_SLOW_RESPONSE_MS = 4 * 60_000

export class OpenAiCompatibleService {
  readonly name = 'custom'

  constructor(
    private config: OpenAiCompatibleConfig | null = null,
    private readonly queryTimeoutMs = OPENAI_COMPATIBLE_QUERY_TIMEOUT_MS,
  ) {}

  setConfig(config: OpenAiCompatibleConfig | null): void {
    this.config = config
  }

  isAvailable(): boolean {
    return isOpenAiCompatibleRuntimeReady(this.config)
  }

  async query(request: AiQueryRequest): Promise<AiQueryResponse> {
    const config = this.config
    if (!isOpenAiCompatibleRuntimeReady(config)) {
      throw new AiError(
        'OpenAI-compatible endpoint is not configured',
        AiErrorCode.API_KEY_MISSING,
        { modelId: request.modelId },
      )
    }

    const execution = createModelExecution(request.modelId, request.modelId, config.modelId)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

    const body: Record<string, unknown> = {
      model: config.modelId,
      messages: request.messages,
      stream: false,
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    // gpt-oss uses this field to bound hidden CoT. Sending it to other models
    // on the hospital gateway can suppress their final channel or expose raw
    // reasoning, so gate by the configured endpoint model (not the logical UI
    // profile id).
    if (
      request.reasoningEffort !== undefined &&
      /^gpt-oss(?::|-)/i.test(config.modelId.trim())
    ) {
      body.reasoning_effort = request.reasoningEffort
    }
    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' }
    }

    const controller = new AbortController()
    let didTimeout = false
    let receivedResponse = false
    const startedAt = Date.now()
    const timeoutId = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, this.queryTimeoutMs)
    const forwardAbort = () => controller.abort(request.signal?.reason)
    if (request.signal?.aborted) controller.abort(request.signal.reason)
    else request.signal?.addEventListener('abort', forwardAbort, { once: true })

    try {
      const response = await createConfiguredOpenAiCompatibleFetch(config)(
        openAiCompatibleEndpointUrl(config.baseUrl, 'chat/completions'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      )
      receivedResponse = true
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {
          error?: string | { message?: string }
          message?: string
        } | null
        const rawMessage =
          (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) ||
          payload?.message ||
          response.statusText ||
          'OpenAI-compatible API request failed'
        let code = AiErrorCode.UNKNOWN_ERROR
        if (response.status === 401 || response.status === 403) code = AiErrorCode.API_KEY_INVALID
        else if (response.status === 429) code = AiErrorCode.RATE_LIMIT_EXCEEDED
        else if (response.status >= 500) code = AiErrorCode.NETWORK_ERROR
        throw new AiError(
          this.sanitizeErrorMessage(rawMessage, config.apiKey),
          code,
          { modelId: config.modelId, status: response.status },
        )
      }

      const data = await response.json() as {
        model?: string
        choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
        usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
      }
      const choice = data.choices?.[0]
      const outputTruncated = choice?.finish_reason === 'length'
      const text = choice?.message?.content ?? ''
      if (outputTruncated && (!request.allowTruncatedOutput || !text.trim())) {
        throw new AiError(
          'OpenAI-compatible local model output limit reached; response incomplete',
          AiErrorCode.OUTPUT_TRUNCATED,
          { modelId: config.modelId },
        )
      }
      const modelExecution = typeof data.model === 'string'
        ? reportModelExecution(execution, data.model)
        : execution
      return {
        text,
        metadata: {
          modelId: modelExecution.actualModelId ?? 'unreported',
          modelExecution,
          provider: 'custom',
          tokensUsed: data.usage?.total_tokens,
          usage: readTokenUsage(data.usage),
          ...(outputTruncated ? { outputTruncated: true } : {}),
        },
      }
    } catch (error) {
      // Browser/undici abort wording differs (including the opaque "signal is
      // aborted without reason"). Track our timer explicitly so every runtime
      // exposes the same actionable error while a user-initiated stop remains
      // a normal AbortError handled by the caller.
      if (didTimeout) {
        const minutes = Math.max(1, Math.round(this.queryTimeoutMs / 60_000))
        throw new AiError(
          `OpenAI-compatible local model response timed out after ${minutes} minutes`,
          AiErrorCode.TIMEOUT,
          { modelId: config.modelId, timeoutMs: this.queryTimeoutMs },
        )
      }
      // A direct fetch can fail before our ten-minute timer without returning
      // an HTTP response. After a long wait, report the interrupted connection
      // without guessing whether the server, proxy, or network ended it.
      if (
        !receivedResponse &&
        !request.signal?.aborted &&
        error instanceof TypeError &&
        Date.now() - startedAt >= LOCAL_MODEL_SLOW_RESPONSE_MS &&
        normalizeOpenAiCompatibleTransport(config.transport) === 'direct'
      ) {
        throw new AiError(
          'OpenAI-compatible local model connection interrupted after a long wait',
          AiErrorCode.CONNECTION_INTERRUPTED,
          { modelId: config.modelId },
        )
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private sanitizeErrorMessage(message: string, apiKey: string | null): string {
    let sanitized = String(message).slice(0, 500)
    if (apiKey) sanitized = sanitized.split(apiKey).join('[API_KEY_REDACTED]')
    return sanitized
      .replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[API_KEY_REDACTED]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [TOKEN_REDACTED]')
  }
}
