// AI composition root. This is the only application-layer module that wires
// concrete AI transports. Hooks/features depend on these factories/facades,
// while credentials are captured fresh at each request boundary.
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import { QueryAiUseCase } from '@/src/core/use-cases/ai/query-ai.use-case'
import { GenerateSmartTitleUseCase } from '@/src/core/use-cases/chat/generate-smart-title.use-case'
import {
  AiProviderFactory,
  type ProviderConfig,
  type ProviderResult,
} from '@/src/infrastructure/ai/factories/ai-provider.factory'
import {
  testOpenAiCompatibleAgentCapability as testDirectOpenAiCompatibleAgentCapability,
  testOpenAiCompatibleConnection as testDirectOpenAiCompatibleConnection,
  type OpenAiCompatibleAgentCapabilityResult,
  type OpenAiCompatibleConnectionResult,
} from '@/src/infrastructure/ai/openai-compatible/openai-compatible.client'
import { AiService } from '@/src/infrastructure/ai/services/ai.service'
import { ClaudeService } from '@/src/infrastructure/ai/services/claude.service'
import { GeminiService } from '@/src/infrastructure/ai/services/gemini.service'
import { OpenAiCompatibleService } from '@/src/infrastructure/ai/services/openai-compatible.service'
import { OpenAiService } from '@/src/infrastructure/ai/services/openai.service'
import { AiSdkStreamAdapter } from '@/src/infrastructure/ai/streaming/ai-sdk-stream.adapter'
import { StreamOrchestrator } from '@/src/infrastructure/ai/streaming/stream-orchestrator'
import {
  setHospitalGeminiFailureListener,
  type HospitalGeminiFailure,
} from '@/src/infrastructure/ai/hospital-gemini/hospital-gemini-stream'
import { toast } from 'sonner'
import type {
  OpenAiCompatibleConfig,
  OpenAiCompatibleProfile,
} from '@/src/shared/types/openai-compatible.types'

export interface AiRuntimeConfig {
  openAiApiKey: string | null
  geminiApiKey: string | null
  claudeApiKey: string | null
  openAiCompatibleProfiles: readonly OpenAiCompatibleProfile[]
}

/** Never cache this result: browser keys and endpoint profiles are mutable. */
export function captureAiRuntimeConfig(): AiRuntimeConfig {
  const state = useAiConfigStore.getState()
  return {
    openAiApiKey: state.apiKey,
    geminiApiKey: state.geminiKey,
    claudeApiKey: state.claudeKey,
    openAiCompatibleProfiles: state.openAiCompatibleProfiles,
  }
}

export function createAiService(config: AiRuntimeConfig): AiService {
  const providerFactory = new AiProviderFactory()
  return new AiService(
    {
      cloudServices: {
        openai: new OpenAiService(config.openAiApiKey),
        gemini: new GeminiService(config.geminiApiKey),
        claude: new ClaudeService(config.claudeApiKey, providerFactory),
      },
      createCustomService: (profile) => new OpenAiCompatibleService(profile),
    },
    config.openAiCompatibleProfiles,
  )
}

export function createQueryAiUseCase(config: AiRuntimeConfig): QueryAiUseCase {
  return new QueryAiUseCase(createAiService(config))
}

export function createSmartTitleUseCase(config: AiRuntimeConfig): GenerateSmartTitleUseCase {
  return new GenerateSmartTitleUseCase(createAiService(config))
}

/** A failed 院內 Gemini request keeps its prompt one click away, to paste by hand. */
export function showHospitalGeminiFailure({ message, prompt }: HospitalGeminiFailure): void {
  toast.error(message, {
    id: 'hospital-gemini-failure',
    duration: 15_000,
    action: {
      label: '複製提示',
      onClick: () => {
        void Promise.resolve().then(() => navigator.clipboard.writeText(prompt)).then(
          () => toast.success('已複製提示，可貼到院內 Gemini'),
          () => toast.error('無法複製提示，請確認瀏覽器允許剪貼簿'),
        )
      },
    },
  })
}
setHospitalGeminiFailureListener(showHospitalGeminiFailure)

export function createAiStreamOrchestrator(): StreamOrchestrator {
  const providerFactory = new AiProviderFactory()
  return new StreamOrchestrator(new AiSdkStreamAdapter(providerFactory))
}

/** Agent-chat facade: features never construct/import the provider factory. */
export function createAiProvider(config: ProviderConfig): ProviderResult {
  return new AiProviderFactory().create(config)
}

export function validateAiProxyAvailability(
  modelId: string,
): { available: boolean; error?: string } {
  return new AiProviderFactory().validateProxyAvailability(modelId)
}

/** Test the configured endpoint directly from the current browser. */
export function testOpenAiCompatibleConnection(
  config: OpenAiCompatibleConfig,
): Promise<OpenAiCompatibleConnectionResult> {
  return testDirectOpenAiCompatibleConnection(config)
}

/** Patient-free two-step tool-call probe through the profile's configured path. */
export function testOpenAiCompatibleAgentCapability(
  config: OpenAiCompatibleConfig,
): Promise<OpenAiCompatibleAgentCapabilityResult> {
  return testDirectOpenAiCompatibleAgentCapability(config)
}
