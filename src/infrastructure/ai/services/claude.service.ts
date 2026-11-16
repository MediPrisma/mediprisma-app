// Claude Service (non-streaming) — AI-SDK-backed (audit C6 direction).
//
// Same shape as OpenAiService/GeminiService so the unified AiService can
// dispatch by provider, but the implementation delegates to generateText()
// instead of hand-rolled fetch. Proxy routing comes from AiProviderFactory.

import { readTokenUsage } from '@/src/shared/utils/ai-token-usage'
import { createModelExecution, reportModelExecution, markModelExecutionUnreported } from '@/src/shared/utils/ai-model-execution'
import { generateText } from 'ai'
import type { AiQueryRequest, AiQueryResponse } from '@/src/core/entities/ai.entity'
import { ENV_CONFIG } from '@/src/shared/config/env.config'
import {
  getModelDefinitionOrThrow,
  isProxyEligibleModel,
  resolveModelTemperature,
} from '@/src/shared/constants/ai-models.constants'
import type { AiProviderFactory } from '../factories/ai-provider.factory'

export class ClaudeService {
  constructor(
    private apiKey: string | null,
    private readonly providerFactory: Pick<AiProviderFactory, 'create'>,
  ) {}

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey) || ENV_CONFIG.hasClaudeProxy
  }

  async query(request: AiQueryRequest): Promise<AiQueryResponse> {
    const modelDef = getModelDefinitionOrThrow(request.modelId)
    if (modelDef.provider !== 'claude') {
      throw new Error(`Model ${request.modelId} is not a Claude model`)
    }
    const useProxy = !this.apiKey && ENV_CONFIG.hasClaudeProxy && isProxyEligibleModel(modelDef)

    if (!this.apiKey && !useProxy) {
      throw new Error('Claude API key is required for this model. Please add it in Settings.')
    }

    let modelExecution = createModelExecution(request.modelId)
    const { model } = this.providerFactory.create({
      onModelReported: (id) => { modelExecution = reportModelExecution(modelExecution, id) },
      onModelUnreported: () => { modelExecution = markModelExecutionUnreported(modelExecution) },
      modelId: request.modelId,
      apiKey: this.apiKey ?? undefined,
      useProxy,
    })

    const result = await generateText({
      model,
      messages: request.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      ...(resolveModelTemperature(modelDef, request.temperature) !== undefined
        ? { temperature: resolveModelTemperature(modelDef, request.temperature) }
        : {}),
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.signal ? { abortSignal: request.signal } : {}),
    })

    return {
      text: result.text,
      metadata: {
        modelId: modelExecution.actualModelId ?? 'unreported',
        modelExecution,
        provider: 'claude',
        tokensUsed: result.usage?.totalTokens,
        usage: readTokenUsage(result.usage),
      },
    }
  }
}
