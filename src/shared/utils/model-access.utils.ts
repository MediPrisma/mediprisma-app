import {
  getModelDefinition,
  getModelDefinitionOrThrow,
  isCustomOpenAiModelId,
} from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleConfig } from '@/src/shared/types/openai-compatible.types'
import { normalizeOpenAiCompatibleContextWindow } from '@/src/shared/types/openai-compatible.types'
import {
  isOpenAiCompatibleRuntimeReady,
  openAiCompatibleCacheIdentity,
} from '@/src/shared/utils/openai-compatible.utils'

export interface ProviderKeys {
  openAiKey?: string | null
  geminiKey?: string | null
  claudeKey?: string | null
}

export function apiKeyForModel(
  modelId: string,
  keys: ProviderKeys,
  customConfig?: OpenAiCompatibleConfig | null,
): string | null {
  const { provider, access } = getModelDefinitionOrThrow(modelId)
  // 院內 Gemini runs in the clinician's own browser tab: no provider key is sent anywhere.
  if (access === 'browser-extension') return null
  if (provider === 'custom') return customConfig?.apiKey?.trim() || null
  if (provider === 'gemini') return keys.geminiKey?.trim() || null
  if (provider === 'claude') return keys.claudeKey?.trim() || null
  return keys.openAiKey?.trim() || null
}

/** Direct access includes a keyless, configured hospital endpoint. */
export function hasDirectModelAccess(
  modelId: string,
  keys: ProviderKeys,
  customConfig?: OpenAiCompatibleConfig | null,
): boolean {
  if (isCustomOpenAiModelId(modelId)) {
    return isOpenAiCompatibleRuntimeReady(customConfig)
  }
  if (getModelDefinition(modelId)?.access === 'browser-extension') return true
  return Boolean(apiKeyForModel(modelId, keys, customConfig))
}

/**
 * Cache/result identity, not the id sent to the provider. Custom endpoint and
 * upstream model changes get a distinct identity while the persisted logical
 * model preference remains stable.
 */
export function modelRuntimeIdentity(
  modelId: string,
  customConfig?: OpenAiCompatibleConfig | null,
): string {
  return isCustomOpenAiModelId(modelId)
    ? `${modelId}:${openAiCompatibleCacheIdentity(customConfig)}`
    : modelId
}

export function modelDisplayLabel(
  modelId: string,
  customConfig?: OpenAiCompatibleConfig | null,
): string {
  if (isCustomOpenAiModelId(modelId) && customConfig?.modelId.trim()) {
    return customConfig.modelId.trim()
  }
  return getModelDefinition(modelId)?.label ?? modelId
}

/** Resolve the budget used by UI meters and preflight guards. A custom
 * endpoint's actual upstream model name is not in the static model catalog, so
 * its user-configured window must override the conservative logical-model
 * fallback. */
export function modelContextLimit(
  modelId: string,
  customConfig?: OpenAiCompatibleConfig | null,
): number {
  if (isCustomOpenAiModelId(modelId)) {
    return normalizeOpenAiCompatibleContextWindow(
      customConfig?.contextWindowTokens,
      customConfig?.modelId,
    )
  }
  return getModelDefinition(modelId)?.contextLimit ?? 15000
}
