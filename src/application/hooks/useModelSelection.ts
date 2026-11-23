// Custom Hook: Model Selection Logic
import { useMemo } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/src/application/providers/language.provider'
import {
  GPT_MODELS,
  GEMINI_MODELS,
  CLAUDE_MODELS,
  HOSPITAL_GEMINI_MODEL_ID,
  CUSTOM_OPENAI_MODEL_ID,
  customOpenAiModelIdForProfile,
  getModelDefinition,
  isModelId,
  isProxyEligibleModel,
  modelRequiresUserKey,
  openAiCompatibleProfileIdFromModelId,
  ModelDefinition,
} from "@/src/shared/constants/ai-models.constants"
import { ENV_CONFIG, hasChatProxy, hasGeminiProxy, hasClaudeProxy } from "@/src/shared/config/env.config"
import { useOpenAiCompatibleProfiles } from '@/src/application/stores/ai-config.store'
import { isOpenAiCompatibleReady, isOpenAiCompatibleRuntimeReady } from '@/src/shared/utils/openai-compatible.utils'
import { normalizeOpenAiCompatibleTransport } from '@/src/shared/types/openai-compatible.types'
import { INTRANET_LUNA_ID, intranetGatewayAvailable } from '@/src/infrastructure/ai/interceptors/intranet-fetch'
import { useHospitalGeminiStatus } from '@/src/application/hooks/use-hospital-gemini-status.hook'
import { HOSPITAL_GEMINI_SIGN_IN_URL } from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-bridge'

export const HOSPITAL_GEMINI_SIGN_IN_HINT = '請先開啟並登入院內 Gemini'

export interface ModelEntry {
  id: string
  label: string
  description: string
  isLocked: boolean
  configureInSettings?: boolean
  /** Shown under a locked entry: what the clinician has to do first. */
  hint?: string
  /** A page that resolves the lock (院內 Gemini sign-in), opened in a new tab. */
  signInUrl?: string
}

function endpointParts(baseUrl: string): { host: string; full: string } {
  if (baseUrl.startsWith('/')) return { host: baseUrl, full: baseUrl }
  try {
    const url = new URL(baseUrl)
    const pathname = url.pathname.replace(/\/+$/, '')
    return {
      host: url.host,
      full: `${url.host}${pathname && pathname !== '/' ? pathname : ''}`,
    }
  } catch {
    return { host: baseUrl, full: baseUrl }
  }
}

export function useModelSelection(
  apiKey: string | null,
  geminiKey: string | null,
  claudeKey: string | null,
  model: string,
  setModel: (model: string) => void
) {
  const { locale, t } = useLanguage()
  const openAiCompatibleProfiles = useOpenAiCompatibleProfiles()
  const hospitalGeminiStatus = useHospitalGeminiStatus()
  const gptModels = useMemo(() => {
    return GPT_MODELS.map((entry): ModelEntry => {
      const definition = getModelDefinition(entry.id)
      const isLocked = definition?.status === 'disabled' || (modelRequiresUserKey(entry.id) && !apiKey)
      return {
        id: entry.id,
        label: entry.id === INTRANET_LUNA_ID && intranetGatewayAvailable() ? 'GPT-6 Luna（院內）' : entry.label,
        description: entry.descriptions[locale],
        isLocked: isLocked || false
      }
    })
  }, [apiKey, locale])

  const geminiModels = useMemo(() => {
    return GEMINI_MODELS.flatMap((entry): ModelEntry[] => {
      if (entry.id === HOSPITAL_GEMINI_MODEL_ID) {
        // Without the extension, or with its switch off, the source does not exist here.
        if (hospitalGeminiStatus === 'unavailable' || hospitalGeminiStatus === 'disabled') return []
        const ready = hospitalGeminiStatus === 'ready'
        return [{
          id: entry.id,
          label: entry.label,
          description: entry.descriptions[locale],
          isLocked: !ready,
          ...(ready ? {} : { hint: HOSPITAL_GEMINI_SIGN_IN_HINT, signInUrl: HOSPITAL_GEMINI_SIGN_IN_URL }),
        }]
      }
      const definition = getModelDefinition(entry.id)
      const isLocked = definition?.status === 'disabled' || (modelRequiresUserKey(entry.id) && !geminiKey)
      return [{
        id: entry.id,
        label: entry.label,
        description: entry.descriptions[locale],
        isLocked: isLocked || false
      }]
    })
  }, [geminiKey, hospitalGeminiStatus, locale])

  const claudeModels = useMemo(() => {
    return CLAUDE_MODELS.map((entry): ModelEntry => {
      const definition = getModelDefinition(entry.id)
      const isLocked = definition?.status === 'disabled' || (modelRequiresUserKey(entry.id) && !claudeKey)
      return {
        id: entry.id,
        label: entry.label,
        description: entry.descriptions[locale],
        isLocked: isLocked || false
      }
    })
  }, [claudeKey, locale])

  const customModels = useMemo((): ModelEntry[] => {
    const enabledProfiles = openAiCompatibleProfiles.filter((profile) => profile.enabled)
    if (enabledProfiles.length === 0) {
      return [{
        id: CUSTOM_OPENAI_MODEL_ID,
        label: t.settings.openAiCompatibleModelLabel,
        description: t.settings.openAiCompatibleNotConfigured,
        isLocked: true,
        configureInSettings: true,
      }]
    }

    const modelNameCounts = new Map<string, number>()
    const modelHostCounts = new Map<string, number>()
    for (const profile of enabledProfiles) {
      const upstreamModelId = profile.modelId.trim()
      modelNameCounts.set(upstreamModelId, (modelNameCounts.get(upstreamModelId) ?? 0) + 1)
      const hostIdentity = `${upstreamModelId}\u0000${endpointParts(profile.baseUrl).host}`
      modelHostCounts.set(hostIdentity, (modelHostCounts.get(hostIdentity) ?? 0) + 1)
    }

    const displayEndpoints = enabledProfiles.map((profile) => {
      const upstreamModelId = profile.modelId.trim()
      const endpoint = endpointParts(profile.baseUrl)
      const hostIdentity = `${upstreamModelId}\u0000${endpoint.host}`
      return (modelHostCounts.get(hostIdentity) ?? 0) > 1 ? endpoint.full : endpoint.host
    })
    const modelEndpointCounts = new Map<string, number>()
    enabledProfiles.forEach((profile, index) => {
      const identity = `${profile.modelId.trim()}\u0000${displayEndpoints[index]}`
      modelEndpointCounts.set(identity, (modelEndpointCounts.get(identity) ?? 0) + 1)
    })
    const seenModelEndpoints = new Map<string, number>()
    return enabledProfiles.map((profile, index) => {
      const upstreamModelId = profile.modelId.trim()
      const duplicateModelName = (modelNameCounts.get(upstreamModelId) ?? 0) > 1
      const endpoint = displayEndpoints[index]
      const identity = `${upstreamModelId}\u0000${endpoint}`
      const ordinal = (seenModelEndpoints.get(identity) ?? 0) + 1
      seenModelEndpoints.set(identity, ordinal)
      const duplicateEndpoint = (modelEndpointCounts.get(identity) ?? 0) > 1
      const ready = isOpenAiCompatibleRuntimeReady(profile)
      return {
        id: customOpenAiModelIdForProfile(profile.profileId),
        label: duplicateModelName && endpoint
          ? `${upstreamModelId} · ${endpoint}${duplicateEndpoint ? ` #${ordinal}` : ''}`
          : upstreamModelId || t.settings.openAiCompatibleModelLabel,
        description: profile.baseUrl || t.settings.openAiCompatibleNotConfigured,
        isLocked: !ready,
        configureInSettings: !ready,
      }
    })
  }, [
    openAiCompatibleProfiles,
    t.settings.openAiCompatibleModelLabel,
    t.settings.openAiCompatibleNotConfigured,
  ])

  const customProfileForModel = (candidate: string) => {
    const profileId = openAiCompatibleProfileIdFromModelId(candidate)
    if (profileId === null) return undefined
    return openAiCompatibleProfiles.find((profile) => profile.profileId === profileId)
  }

  const handleSelectModel = (candidate: string) => {
    if (!isModelId(candidate)) return
    const definition = getModelDefinition(candidate)
    if (!definition) return

    if (candidate === INTRANET_LUNA_ID && intranetGatewayAvailable()) {
      setModel(candidate)
      return
    }

    if (candidate === HOSPITAL_GEMINI_MODEL_ID) {
      if (hospitalGeminiStatus === 'ready') setModel(candidate)
      else toast.error(HOSPITAL_GEMINI_SIGN_IN_HINT)
      return
    }

    if (definition.provider === 'custom') {
      const customProfile = customProfileForModel(candidate)
      if (!isOpenAiCompatibleRuntimeReady(customProfile)) {
        const gatewayUnavailable = isOpenAiCompatibleReady(customProfile) &&
          normalizeOpenAiCompatibleTransport(customProfile.transport) === 'mediprisma-gateway' &&
          !ENV_CONFIG.hasOpenAiCompatibleGateway
        toast.error(gatewayUnavailable
          ? t.settings.openAiCompatibleGatewayUnavailable
          : t.settings.openAiCompatibleNotConfigured)
        return
      }
      setModel(candidate)
      return
    }

    if (definition.status === 'disabled') {
      toast.error(t.settings.modelUnavailable)
      return
    }

    if (definition.provider === "openai" && modelRequiresUserKey(definition) && !apiKey) {
      toast.error(t.settings.requiresOpenAiKey)
      return
    }

    if (definition.provider === "openai" && isProxyEligibleModel(definition) && !apiKey && !hasChatProxy) {
      toast.error(t.settings.requiresProxyOrOpenAiKey)
      return
    }

    if (definition.provider === "gemini" && modelRequiresUserKey(definition) && !geminiKey) {
      toast.error(t.settings.requiresGeminiKey)
      return
    }

    if (definition.provider === "gemini" && isProxyEligibleModel(definition) && !geminiKey && !hasGeminiProxy) {
      toast.error(t.settings.requiresGeminiKeyOrProxy)
      return
    }

    if (definition.provider === "claude" && modelRequiresUserKey(definition) && !claudeKey) {
      toast.error(t.settings.requiresClaudeKey)
      return
    }

    if (definition.provider === "claude" && isProxyEligibleModel(definition) && !claudeKey && !hasClaudeProxy) {
      toast.error(t.settings.requiresClaudeKeyOrProxy)
      return
    }

    setModel(candidate)
  }

  const getModelStatus = (definition: ModelDefinition) => {
    if (definition.id === INTRANET_LUNA_ID && intranetGatewayAvailable()) return '北榮院內 Azure；每月共用 US$200 額度'
    if (definition.id === HOSPITAL_GEMINI_MODEL_ID) {
      return hospitalGeminiStatus === 'ready' ? '透過北榮懷爾抓抓，在您已登入的院內 Gemini 分頁回答' : HOSPITAL_GEMINI_SIGN_IN_HINT
    }
    if (definition.status === 'disabled') return t.settings.modelUnavailable

    if (definition.provider === 'custom') {
      const customProfile = customProfileForModel(definition.id)
      return isOpenAiCompatibleRuntimeReady(customProfile)
        ? normalizeOpenAiCompatibleTransport(customProfile.transport) === 'mediprisma-gateway'
          ? t.settings.openAiCompatibleGatewayStatus
          : t.settings.openAiCompatibleDirectStatus
        : t.settings.openAiCompatibleNotConfigured
    }

    if (definition.provider === "openai") {
      if (modelRequiresUserKey(definition)) {
        return apiKey ? t.settings.usingPersonalOpenAiKey : t.settings.requiresOpenAiKey
      }
      if (apiKey) return t.settings.willUsePersonalOpenAiKey
      if (hasChatProxy) return t.settings.routedViaProxy
      return t.settings.requiresProxyOrOpenAiKey
    }

    if (definition.provider === "gemini") {
      if (modelRequiresUserKey(definition)) {
        return geminiKey ? t.settings.usingPersonalGeminiKey : t.settings.requiresGeminiKey
      }
      if (geminiKey) return t.settings.usingPersonalGeminiKey
      if (hasGeminiProxy) return t.settings.routedViaProxy
      return t.settings.requiresGeminiKeyOrProxy
    }

    if (definition.provider === "claude") {
      if (modelRequiresUserKey(definition)) {
        return claudeKey ? t.settings.usingPersonalClaudeKey : t.settings.requiresClaudeKey
      }
      if (claudeKey) return t.settings.usingPersonalClaudeKey
      if (hasClaudeProxy) return t.settings.routedViaProxy
      return t.settings.requiresClaudeKeyOrProxy
    }

    return ""
  }

  return {
    gptModels,
    geminiModels,
    claudeModels,
    customModels,
    handleSelectModel,
    getModelStatus,
  }
}
