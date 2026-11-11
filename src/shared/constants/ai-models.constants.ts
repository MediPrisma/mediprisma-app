export type ModelProvider = 'openai' | 'gemini' | 'claude' | 'custom'

/** How a model is allowed to obtain credentials at runtime. */
export type ModelAccess = 'proxy-or-key' | 'key-only' | 'custom-profile'

/** Concrete upstream API contract. Provider and API surface are intentionally
 * separate: OpenAI models can use either Chat Completions or Responses. */
export type ModelApiSurface =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'gemini-generate-content'
  | 'anthropic-messages'
  | 'openai-compatible-chat-completions'

/** Sampling rules that must remain identical in query and streaming paths. */
export type ModelTemperaturePolicy = 'passthrough' | 'fixed-one' | 'omit'

/** Deep models receive Agent tools; standard models receive no tool schema. */
export type ModelConversationMode = 'deep-agent' | 'standard'

export type ModelRole =
  | 'default'
  | 'smart-title'
  | 'medical-summary'
  | 'safety-alerts'
  | 'report-interpretation'
  | 'followup-suggestions'

export type ModelStatus = 'available' | 'disabled'
export type ModelLocale = 'en' | 'zh-TW'

/**
 * The single source of truth for one model.
 *
 * Every behavior that used to be inferred from an id prefix or duplicated in
 * a provider list is explicit here. Adding or replacing a model therefore does
 * not require a new switch/regex in UI or infrastructure code.
 */
export interface ModelDefinition {
  id: string
  label: string
  descriptions: Readonly<Record<ModelLocale, string>>
  provider: ModelProvider
  contextLimit: number
  access: ModelAccess
  apiSurface: ModelApiSurface
  temperaturePolicy: ModelTemperaturePolicy
  conversationMode: ModelConversationMode
  status: ModelStatus
  selectable: boolean
  providerBase: boolean
  autoRunEligible: boolean
  roles: readonly ModelRole[]
}

/** Stable logical id for browser-configured OpenAI-compatible endpoints. */
export const CUSTOM_OPENAI_MODEL_ID = 'openai-compatible-custom' as const

/**
 * Canonical model manifest. Each id appears exactly once, even when the same
 * model is both user-selectable and used by an internal background task.
 *
 * Firebase proxy allowlists remain an independent backend security boundary;
 * any `proxy-or-key` change here must also be intentionally approved there.
 */
export const MODEL_CATALOG = [
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna（院內）',
    descriptions: {
      en: 'Taipei Veterans intranet Azure; shared US$200 monthly budget',
      'zh-TW': '北榮院內 Azure；每月共用 US$200 額度',
    },
    provider: 'openai',
    contextLimit: 900_000,
    access: 'proxy-or-key',
    apiSurface: 'openai-responses',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: false,
    roles: [],
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    descriptions: {
      en: 'Fastest responses, budget friendly',
      'zh-TW': '極速回應，經濟實惠',
    },
    provider: 'openai',
    contextLimit: 120_000,
    access: 'proxy-or-key',
    apiSurface: 'openai-chat-completions',
    temperaturePolicy: 'fixed-one',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: true,
    autoRunEligible: true,
    roles: ['smart-title'],
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    descriptions: {
      en: 'Efficient for high-volume workloads',
      'zh-TW': '適合高用量、重視成本效率的任務',
    },
    provider: 'openai',
    contextLimit: 900_000,
    access: 'proxy-or-key',
    apiSurface: 'openai-responses',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    descriptions: {
      en: 'Balanced intelligence and cost',
      'zh-TW': '平衡智慧能力與成本',
    },
    provider: 'openai',
    contextLimit: 900_000,
    access: 'key-only',
    apiSurface: 'openai-responses',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    descriptions: {
      en: 'Flagship model for complex professional work',
      'zh-TW': '適合複雜專業工作的旗艦模型',
    },
    provider: 'openai',
    contextLimit: 900_000,
    access: 'key-only',
    apiSurface: 'openai-responses',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    descriptions: {
      en: 'Fastest responses, budget friendly',
      'zh-TW': '極速回應，經濟實惠',
    },
    provider: 'gemini',
    contextLimit: 900_000,
    access: 'proxy-or-key',
    apiSurface: 'gemini-generate-content',
    temperaturePolicy: 'passthrough',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: true,
    autoRunEligible: true,
    roles: [
      'medical-summary',
      'safety-alerts',
      'report-interpretation',
      'followup-suggestions',
    ],
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    descriptions: {
      en: 'Fast and accurate',
      'zh-TW': '快速準確',
    },
    provider: 'gemini',
    contextLimit: 900_000,
    access: 'proxy-or-key',
    apiSurface: 'gemini-generate-content',
    temperaturePolicy: 'passthrough',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: false,
    roles: ['default'],
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    descriptions: {
      en: 'Next-gen fast model',
      'zh-TW': '新一代快速模型',
    },
    provider: 'gemini',
    contextLimit: 900_000,
    access: 'proxy-or-key',
    apiSurface: 'gemini-generate-content',
    temperaturePolicy: 'passthrough',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    descriptions: {
      en: 'Newest top-tier model',
      'zh-TW': '最新頂級模型',
    },
    provider: 'gemini',
    contextLimit: 1_800_000,
    access: 'key-only',
    apiSurface: 'gemini-generate-content',
    temperaturePolicy: 'passthrough',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    descriptions: {
      en: 'Fastest responses, budget friendly',
      'zh-TW': '極速回應，經濟實惠',
    },
    provider: 'claude',
    contextLimit: 180_000,
    access: 'proxy-or-key',
    apiSurface: 'anthropic-messages',
    temperaturePolicy: 'passthrough',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: true,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    descriptions: {
      en: 'Best balance of speed and intelligence',
      'zh-TW': '兼顧速度與智慧能力',
    },
    provider: 'claude',
    contextLimit: 900_000,
    access: 'key-only',
    apiSurface: 'anthropic-messages',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    descriptions: {
      en: 'Deep reasoning for complex tasks',
      'zh-TW': '深度推理，複雜任務',
    },
    provider: 'claude',
    contextLimit: 900_000,
    access: 'key-only',
    apiSurface: 'anthropic-messages',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    descriptions: {
      en: 'Newest top-tier model',
      'zh-TW': '最新頂級模型',
    },
    provider: 'claude',
    contextLimit: 1_000_000,
    access: 'key-only',
    apiSurface: 'anthropic-messages',
    temperaturePolicy: 'omit',
    conversationMode: 'deep-agent',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
  {
    id: CUSTOM_OPENAI_MODEL_ID,
    label: 'OpenAI-compatible',
    descriptions: {
      en: 'Connect a hospital, local, or user-owned model',
      'zh-TW': '連接院內、地端或使用者自己的模型',
    },
    provider: 'custom',
    // Conservative floor for local models whose context size is unknown.
    contextLimit: 15_000,
    access: 'custom-profile',
    apiSurface: 'openai-compatible-chat-completions',
    temperaturePolicy: 'passthrough',
    conversationMode: 'standard',
    status: 'available',
    selectable: true,
    providerBase: false,
    autoRunEligible: true,
    roles: [],
  },
] as const satisfies readonly ModelDefinition[]

type CatalogModel = (typeof MODEL_CATALOG)[number]
type CatalogModelForProvider<P extends ModelProvider> = Extract<CatalogModel, { provider: P }>

const CUSTOM_OPENAI_MODEL_ID_PREFIX = `${CUSTOM_OPENAI_MODEL_ID}:` as const

export type CustomOpenAiModelId =
  | typeof CUSTOM_OPENAI_MODEL_ID
  | `${typeof CUSTOM_OPENAI_MODEL_ID}:${string}`

export function customOpenAiModelIdForProfile(profileId: string): CustomOpenAiModelId {
  const normalizedProfileId = profileId.trim()
  if (!normalizedProfileId) throw new Error('OpenAI-compatible profile id is required')
  return normalizedProfileId === 'legacy'
    ? CUSTOM_OPENAI_MODEL_ID
    : `${CUSTOM_OPENAI_MODEL_ID_PREFIX}${normalizedProfileId}`
}

export function isCustomOpenAiModelId(value: string): value is CustomOpenAiModelId {
  return value === CUSTOM_OPENAI_MODEL_ID || (
    value.startsWith(CUSTOM_OPENAI_MODEL_ID_PREFIX) &&
    value.length > CUSTOM_OPENAI_MODEL_ID_PREFIX.length
  )
}

export function openAiCompatibleProfileIdFromModelId(modelId: string): string | null {
  if (modelId === CUSTOM_OPENAI_MODEL_ID) return 'legacy'
  if (!isCustomOpenAiModelId(modelId)) return null
  return modelId.slice(CUSTOM_OPENAI_MODEL_ID_PREFIX.length)
}

function selectableModelsFor<P extends ModelProvider>(provider: P) {
  return MODEL_CATALOG.filter(
    (model) => model.selectable && model.provider === provider,
  ) as unknown as readonly CatalogModelForProvider<P>[]
}

export const GPT_MODELS = selectableModelsFor('openai')
export const GEMINI_MODELS = selectableModelsFor('gemini')
export const CLAUDE_MODELS = selectableModelsFor('claude')
export const CUSTOM_MODELS = selectableModelsFor('custom')
export const INTERNAL_MODELS = MODEL_CATALOG.filter((model) =>
  model.roles.some((role) => role !== 'default'),
)

export type GptModelId = (typeof GPT_MODELS)[number]['id']
export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id']
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']
export type CustomModelId = CustomOpenAiModelId
export type ModelId = GptModelId | GeminiModelId | ClaudeModelId | CustomModelId

/** Unique catalog, including user-selectable and internally assigned models. */
export const ALL_MODELS: readonly ModelDefinition[] = MODEL_CATALOG

const MODEL_BY_ID = new Map<string, ModelDefinition>(
  MODEL_CATALOG.map((model) => [model.id, model]),
)
if (MODEL_BY_ID.size !== MODEL_CATALOG.length) {
  throw new Error('MODEL_CATALOG contains duplicate model ids')
}

export const GPT_MODEL_IDS = new Set<GptModelId>(GPT_MODELS.map((model) => model.id))
export const GEMINI_MODEL_IDS = new Set<GeminiModelId>(GEMINI_MODELS.map((model) => model.id))
export const CLAUDE_MODEL_IDS = new Set<ClaudeModelId>(CLAUDE_MODELS.map((model) => model.id))
export const ALL_MODEL_IDS = new Set<ModelId>(MODEL_CATALOG.map((model) => model.id) as ModelId[])

export function isGptModelId(value: string): value is GptModelId {
  return GPT_MODEL_IDS.has(value as GptModelId)
}

export function isGeminiModelId(value: string): value is GeminiModelId {
  return GEMINI_MODEL_IDS.has(value as GeminiModelId)
}

export function isClaudeModelId(value: string): value is ClaudeModelId {
  return CLAUDE_MODEL_IDS.has(value as ClaudeModelId)
}

export function isModelId(value: string): value is ModelId {
  return isCustomOpenAiModelId(value) || ALL_MODEL_IDS.has(value as ModelId)
}

export function getModelDefinition(modelId: string): ModelDefinition | undefined {
  if (isCustomOpenAiModelId(modelId)) {
    const template = MODEL_BY_ID.get(CUSTOM_OPENAI_MODEL_ID)
    return template && modelId !== CUSTOM_OPENAI_MODEL_ID
      ? { ...template, id: modelId }
      : template
  }
  return MODEL_BY_ID.get(modelId)
}

/** Runtime boundary: unknown/retired ids must fail before any network call. */
export function getModelDefinitionOrThrow(modelId: string): ModelDefinition {
  const definition = getModelDefinition(modelId)
  if (!definition) throw new Error(`Unsupported AI model: ${modelId || '(empty)'}`)
  if (definition.status === 'disabled') throw new Error(`AI model is unavailable: ${modelId}`)
  return definition
}

function modelIdForRole(role: ModelRole): string {
  const matches = MODEL_CATALOG.filter((model) =>
    (model.roles as readonly ModelRole[]).includes(role),
  )
  if (matches.length !== 1) {
    throw new Error(`AI model role "${role}" must be assigned exactly once`)
  }
  return matches[0].id
}

/** Feature defaults are derived from roles on the manifest entries. */
export const MODEL_ROLE_IDS: Readonly<Record<ModelRole, string>> = Object.freeze({
  default: modelIdForRole('default'),
  'smart-title': modelIdForRole('smart-title'),
  'medical-summary': modelIdForRole('medical-summary'),
  'safety-alerts': modelIdForRole('safety-alerts'),
  'report-interpretation': modelIdForRole('report-interpretation'),
  'followup-suggestions': modelIdForRole('followup-suggestions'),
})

export const DEFAULT_MODEL_ID: ModelId = MODEL_ROLE_IDS.default as GeminiModelId
export const SMART_TITLE_MODEL_ID = MODEL_ROLE_IDS['smart-title']

export function modelRequiresUserKey(model: string | ModelDefinition): boolean {
  const definition = typeof model === 'string' ? getModelDefinition(model) : model
  return definition?.access === 'key-only'
}

export function isProxyEligibleModel(model: string | ModelDefinition): boolean {
  const definition = typeof model === 'string' ? getModelDefinition(model) : model
  return definition?.access === 'proxy-or-key' && definition.status === 'available'
}

export function modelUsesStandardChat(model: string | ModelDefinition): boolean {
  const definition = typeof model === 'string' ? getModelDefinition(model) : model
  return definition?.conversationMode === 'standard'
}

export function modelSupportsAgentTools(model: string | ModelDefinition): boolean {
  const definition = typeof model === 'string' ? getModelDefinition(model) : model
  return definition?.conversationMode === 'deep-agent'
}

/** Apply the model's sampling contract without inspecting its id. */
export function resolveModelTemperature(
  model: string | ModelDefinition,
  requested?: number,
): number | undefined {
  const definition = typeof model === 'string'
    ? getModelDefinitionOrThrow(model)
    : model
  if (definition.temperaturePolicy === 'fixed-one') return 1
  if (definition.temperaturePolicy === 'omit') return undefined
  return requested
}

export function getBaseModelIdForProvider(provider: ModelProvider): string | undefined {
  return MODEL_CATALOG.find((model) =>
    model.provider === provider &&
    model.providerBase &&
    model.status === 'available' &&
    model.access === 'proxy-or-key',
  )?.id
}

export function isAutoRunEligibleModel(modelId: string): boolean {
  return getModelDefinition(modelId)?.autoRunEligible === true
}

export function gateModel(
  modelId: string,
  hasProviderKey: boolean,
  fallback: string = DEFAULT_MODEL_ID,
): string {
  const definition = getModelDefinition(modelId)
  if (!definition || definition.status === 'disabled') return fallback
  if (modelRequiresUserKey(definition) && !hasProviderKey) return fallback
  return modelId
}

export function gateModelForKeys(
  modelId: string,
  keys: {
    openAiKey?: string | null
    geminiKey?: string | null
    claudeKey?: string | null
    customAvailable?: boolean
  },
  fallback: string = DEFAULT_MODEL_ID,
): string {
  const definition = getModelDefinition(modelId)
  if (!definition || definition.status === 'disabled') return fallback
  // Custom endpoints fail closed at their runtime/profile boundary and never
  // silently turn into an owner-funded cloud request.
  if (definition.provider === 'custom') return modelId
  const key =
    definition.provider === 'gemini' ? keys.geminiKey :
    definition.provider === 'claude' ? keys.claudeKey :
    keys.openAiKey
  return gateModel(modelId, Boolean(key), fallback)
}

/**
 * Retained for callers that require a deep-agent model. Standard-chat models
 * remain valid because the chat runtime deliberately switches execution mode.
 */
export function gateModelForAgentSupport(
  modelId: string,
  fallback: string = DEFAULT_MODEL_ID,
): string {
  const definition = getModelDefinition(modelId)
  return !definition || definition.status === 'disabled' ? fallback : modelId
}
