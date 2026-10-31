// Unified streaming adapter (audit C6).
//
// One AI-SDK-backed adapter for ALL providers, replacing the three
// hand-rolled SSE adapters (OpenAI/Gemini parsed proxy responses by hand;
// Claude already rode the SDK). Proxy-vs-direct routing and the Firebase ID
// token live in AiProviderFactory / the fetch interceptor; every proxy now
// forwards the SDK's native body verbatim (passthrough), so chat and agent
// mode share one path.

import type { AiModelExecution } from "@/src/core/entities/ai-model-execution.entity"
import { createModelExecution, reportModelExecution, markModelExecutionUnreported } from "@/src/shared/utils/ai-model-execution"
import { Output, streamText, type ModelMessage } from "ai"
import { ENV_CONFIG } from "@/src/shared/config/env.config"
import {
  getModelDefinitionOrThrow,
  gateModel,
  isProxyEligibleModel,
  isCustomOpenAiModelId,
  resolveModelTemperature,
} from "@/src/shared/constants/ai-models.constants"
import type { OpenAiCompatibleConfig } from "@/src/shared/types/openai-compatible.types"
import { isOpenAiCompatibleRuntimeReady } from "@/src/shared/utils/openai-compatible.utils"
import type { AiProviderFactory } from "../factories/ai-provider.factory"
import { OPENAI_COMPATIBLE_QUERY_TIMEOUT_MS } from "../services/openai-compatible.service"
import { AiError, AiErrorCode } from "@/src/core/errors"
import {
  StreamIdleTimeoutError,
  withIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from "./stream-idle-timeout"

export interface StreamConfig {
  messages: { role: string; content: string; images?: { data: string }[] }[]
  model: string
  apiKey: string | null
  openAiCompatible?: OpenAiCompatibleConfig | null
  signal: AbortSignal
  onChunk: (content: string) => void
  requestedModelId?: string
  onModelExecution?: (execution: AiModelExecution) => void
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** CUSTOM endpoints only: suppress the model's hidden reasoning for this one
   *  request. The dialect (vLLM `chat_template_kwargs`, gpt-oss's bounded
   *  `reasoning_effort`, OpenRouter's `reasoning.enabled`) is resolved at the
   *  transport, because it is a property of the endpoint, not of the caller. */
  hiddenReasoning?: 'off'
  responseFormat?: 'json'
  /** Optional per-request idle window. Slow local models need longer for the
   *  first token after evaluating a large selected clinical context. */
  idleTimeoutMs?: number
}

export class AiSdkStreamAdapter {
  constructor(
    private readonly providerFactory: Pick<AiProviderFactory, 'create'>,
  ) {}

  async stream(config: StreamConfig): Promise<void> {
    // Central safety net: every AI feature streams through here. If the picked
    // model needs the user's own key but none was supplied, downgrade to the
    // provider's free, proxy-eligible base model so the call rides the proxy
    // instead of dead-ending on a missing key (e.g. a model that used to be free
    // and became key-gated). No caller can bypass this.
    const isCustom = isCustomOpenAiModelId(config.model)
    getModelDefinitionOrThrow(config.model)
    if (isCustom && !isOpenAiCompatibleRuntimeReady(config.openAiCompatible)) {
      throw new Error('OpenAI-compatible endpoint is not configured')
    }
    const modelId = isCustom
      ? config.model
      : gateModel(config.model, !!config.apiKey)
    const definition = getModelDefinitionOrThrow(modelId)
    const useProxy = this.shouldUseProxy(config.apiKey, modelId)
    let modelExecution = createModelExecution(config.requestedModelId ?? config.model, modelId, config.openAiCompatible?.modelId)
    config.onModelExecution?.(modelExecution)
    const { model } = this.providerFactory.create({
      modelId,
      onModelUnreported: () => {
        modelExecution = markModelExecutionUnreported(modelExecution)
        config.onModelExecution?.(modelExecution)
      },
      onModelReported: (actualModelId) => {
        modelExecution = reportModelExecution(modelExecution, actualModelId)
        config.onModelExecution?.(modelExecution)
      },
      apiKey: config.apiKey ?? undefined,
      useProxy,
      openAiCompatible: config.openAiCompatible,
      hiddenReasoning: config.hiddenReasoning,
    })

    // Drive the SDK off our OWN controller so the idle watchdog can abort a
    // stalled stream independently of the user's stop (config.signal).
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (config.signal.aborted) controller.abort()
    else config.signal.addEventListener("abort", onExternalAbort, { once: true })

    // The AI SDK does NOT throw request/stream errors out of `textStream`; it
    // forwards them to `onError` (whose default just console.errors) and then
    // ends the stream. Without capturing here, a failed call (e.g. a proxy 401
    // when the user isn't signed in) would end silently → empty output, no error
    // surfaced ("spinner for a second, then nothing"). Capture it and rethrow
    // after the loop so callers can show a real error.
    let streamError: unknown = null
    const temperature = resolveModelTemperature(definition, config.temperature)
    const result = streamText({
      model,
      messages: this.toSdkMessages(config.messages),
      abortSignal: controller.signal,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(config.maxTokens !== undefined ? { maxOutputTokens: config.maxTokens } : {}),
      ...(isCustom && config.reasoningEffort !== undefined &&
        /^gpt-oss(?::|-)/i.test(config.openAiCompatible?.modelId.trim() ?? '')
        ? { providerOptions: { openai: { reasoningEffort: config.reasoningEffort } } }
        : {}),
      ...(config.responseFormat === 'json' ? { output: Output.json() } : {}),
      onError: ({ error }) => { streamError = error },
    })

    // withIdleTimeout aborts + throws StreamIdleTimeoutError if no token arrives
    // for streamIdleTimeoutMs — so a stalled upstream surfaces a timeout error
    // (getUserErrorMessage maps it) instead of hanging the UI forever.
    // Local 7B-class models can need more than the cloud default just to load
    // and evaluate a clinical prompt before their first token. Every custom
    // streaming feature (summary, safety scan, insights and chat) therefore
    // receives the same ten-minute local-model window by default.
    const idleTimeoutMs = config.idleTimeoutMs ?? (
      isCustom
        ? OPENAI_COMPATIBLE_QUERY_TIMEOUT_MS
        : resolveStreamIdleTimeoutMs()
    )
    let fullText = ""
    try {
      for await (const delta of withIdleTimeout(
        result.textStream,
        idleTimeoutMs,
        () => controller.abort(),
        config.signal,
      )) {
        fullText += delta
        config.onChunk(fullText)
      }
    } catch (error) {
      // User pressed stop → end cleanly (the old adapters swallowed abort too).
      // A StreamIdleTimeoutError is NOT a user abort, so it propagates.
      if (config.signal.aborted) return
      if (isCustom && error instanceof StreamIdleTimeoutError) {
        const minutes = Math.max(1, Math.round(idleTimeoutMs / 60_000))
        throw new AiError(
          `OpenAI-compatible local model response timed out after ${minutes} minutes`,
          AiErrorCode.TIMEOUT,
          { modelId: config.openAiCompatible?.modelId, timeoutMs: idleTimeoutMs },
        )
      }
      throw error
    } finally {
      config.signal.removeEventListener("abort", onExternalAbort)
    }

    // Surface an error the SDK reported via onError (the textStream itself ended
    // without throwing). Aborts are intentional and stay silent.
    if (streamError && !config.signal.aborted) {
      throw streamError
    }
  }

  private shouldUseProxy(apiKey: string | null, model: string): boolean {
    if (isCustomOpenAiModelId(model)) return false
    if (apiKey) return false
    const definition = getModelDefinitionOrThrow(model)
    const provider = definition.provider
    const hasProxy =
      provider === "gemini" ? ENV_CONFIG.hasGeminiProxy :
      provider === "claude" ? ENV_CONFIG.hasClaudeProxy :
      ENV_CONFIG.hasChatProxy
    if (!hasProxy) return false
    return isProxyEligibleModel(definition)
  }

  private toSdkMessages(messages: StreamConfig["messages"]): ModelMessage[] {
    return messages.map((m): ModelMessage => {
      if (m.role === "system") {
        return { role: "system", content: m.content }
      }
      if (m.role === "assistant") {
        return { role: "assistant", content: m.content }
      }
      // user message — images ride along as multimodal parts
      if (m.images && m.images.length > 0) {
        return {
          role: "user",
          content: [
            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ...m.images.map((img) => ({
              type: "image" as const,
              image: img.data, // base64 data URL — the SDK handles the conversion
            })),
          ],
        }
      }
      return { role: "user", content: m.content }
    })
  }
}
