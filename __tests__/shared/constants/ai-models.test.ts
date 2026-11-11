import {
  ALL_MODELS,
  CLAUDE_MODELS,
  CUSTOM_MODELS,
  CUSTOM_OPENAI_MODEL_ID,
  DEFAULT_MODEL_ID,
  GEMINI_MODELS,
  GPT_MODELS,
  INTERNAL_MODELS,
  MODEL_CATALOG,
  MODEL_ROLE_IDS,
  customOpenAiModelIdForProfile,
  getBaseModelIdForProvider,
  getModelDefinition,
  getModelDefinitionOrThrow,
  isCustomOpenAiModelId,
  isGeminiModelId,
  isGptModelId,
  isModelId,
  isProxyEligibleModel,
  modelRequiresUserKey,
  openAiCompatibleProfileIdFromModelId,
  resolveModelTemperature,
  type ModelProvider,
  type ModelRole,
} from '@/src/shared/constants/ai-models.constants'

describe('MODEL_CATALOG contract', () => {
  it('contains each model id exactly once', () => {
    const ids = MODEL_CATALOG.map((model) => model.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ALL_MODELS).toBe(MODEL_CATALOG)
  })

  it.each(MODEL_CATALOG)('$id has a complete, valid runtime definition', (model) => {
    expect(model.label.trim()).not.toBe('')
    expect(model.descriptions.en.trim()).not.toBe('')
    expect(model.descriptions['zh-TW'].trim()).not.toBe('')
    expect(Number.isInteger(model.contextLimit)).toBe(true)
    expect(model.contextLimit).toBeGreaterThan(0)
    expect(['proxy-or-key', 'key-only', 'custom-profile']).toContain(model.access)
    expect(['passthrough', 'fixed-one', 'omit']).toContain(model.temperaturePolicy)
    expect(['deep-agent', 'standard']).toContain(model.conversationMode)
    expect(['available', 'disabled']).toContain(model.status)
  })

  it('derives provider lists and internal uses from the unique catalog', () => {
    expect(GPT_MODELS).toEqual(MODEL_CATALOG.filter((model) => model.selectable && model.provider === 'openai'))
    expect(GEMINI_MODELS).toEqual(MODEL_CATALOG.filter((model) => model.selectable && model.provider === 'gemini'))
    expect(CLAUDE_MODELS).toEqual(MODEL_CATALOG.filter((model) => model.selectable && model.provider === 'claude'))
    expect(CUSTOM_MODELS).toEqual(MODEL_CATALOG.filter((model) => model.selectable && model.provider === 'custom'))
    expect(INTERNAL_MODELS).toEqual(MODEL_CATALOG.filter((model) =>
      model.roles.some((role) => role !== 'default')))
  })

  it.each(['openai', 'gemini', 'claude'] as const)(
    '%s has exactly one explicit, proxy-eligible provider base',
    (provider) => {
      const bases = MODEL_CATALOG.filter((model) => model.provider === provider && model.providerBase)
      expect(bases).toHaveLength(1)
      expect(isProxyEligibleModel(bases[0])).toBe(true)
      expect(getBaseModelIdForProvider(provider)).toBe(bases[0].id)
    },
  )

  it('assigns every feature role exactly once', () => {
    const roles: ModelRole[] = [
      'default',
      'smart-title',
      'medical-summary',
      'safety-alerts',
      'report-interpretation',
      'followup-suggestions',
    ]
    for (const role of roles) {
      const assigned = MODEL_CATALOG.filter((model) =>
        (model.roles as readonly ModelRole[]).includes(role))
      expect(assigned).toHaveLength(1)
      expect(MODEL_ROLE_IDS[role]).toBe(assigned[0].id)
    }
    expect(DEFAULT_MODEL_ID).toBe(MODEL_ROLE_IDS.default)
  })

  it('uses API surfaces compatible with each provider', () => {
    const allowed: Record<ModelProvider, readonly string[]> = {
      openai: ['openai-chat-completions', 'openai-responses'],
      gemini: ['gemini-generate-content'],
      claude: ['anthropic-messages'],
      custom: ['openai-compatible-chat-completions'],
    }
    for (const model of MODEL_CATALOG) {
      expect(allowed[model.provider]).toContain(model.apiSurface)
      expect(model.access === 'key-only').toBe(modelRequiresUserKey(model))
      expect(model.access === 'proxy-or-key').toBe(isProxyEligibleModel(model))
    }
  })

  it('keeps the requested GPT rollout, free Luna access, and Fable availability', () => {
    expect(GPT_MODELS.map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-5.4-nano',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-sol',
    ])
    expect(GPT_MODELS.filter(modelRequiresUserKey).map((model) => model.id)).toEqual([
      'gpt-5.6-terra',
      'gpt-5.6-sol',
    ])
    expect(getModelDefinition('gpt-5.6-luna')).toMatchObject({
      provider: 'openai',
      access: 'proxy-or-key',
      apiSurface: 'openai-responses',
      status: 'available',
    })
    expect(getModelDefinition('claude-fable-5')).toMatchObject({
      provider: 'claude',
      access: 'key-only',
      status: 'available',
      contextLimit: 1_000_000,
    })
  })

  it('keeps the current user-key Gemini and Claude lineup', () => {
    expect(GEMINI_MODELS.filter(modelRequiresUserKey).map((model) => model.id)).toEqual([
      'gemini-3.1-pro-preview',
    ])
    expect(getModelDefinition('gemini-3.8-flash')).toMatchObject({
      provider: 'gemini',
      access: 'proxy-or-key',
      apiSurface: 'gemini-generate-content',
      status: 'available',
    })
    expect(CLAUDE_MODELS.filter(modelRequiresUserKey).map((model) => model.id)).toEqual([
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-fable-5',
    ])
    expect(getModelDefinition('claude-sonnet-5')).toMatchObject({
      contextLimit: 900_000,
      temperaturePolicy: 'omit',
    })
    expect(getModelDefinition('claude-opus-5')).toMatchObject({
      contextLimit: 900_000,
      temperaturePolicy: 'omit',
    })
    expect(getModelDefinition('claude-fable-5')).toMatchObject({
      temperaturePolicy: 'omit',
    })
  })
})

describe('model catalog selectors', () => {
  it('recognizes every registered provider id and rejects retired/unknown ids', () => {
    GPT_MODELS.forEach((model) => expect(isGptModelId(model.id)).toBe(true))
    GEMINI_MODELS.forEach((model) => expect(isGeminiModelId(model.id)).toBe(true))
    MODEL_CATALOG.forEach((model) => expect(isModelId(model.id)).toBe(true))
    expect(isModelId('gpt-5.4-mini')).toBe(false)
    expect(isModelId('gpt-5.4')).toBe(false)
    expect(isModelId('gpt-5.5')).toBe(false)
    expect(isModelId('gemini-3.5-flash')).toBe(false)
    expect(isModelId('claude-sonnet-4-6')).toBe(false)
    expect(isModelId('claude-opus-4-8')).toBe(false)
    expect(() => getModelDefinitionOrThrow('unknown-model')).toThrow('Unsupported AI model')
  })

  it('resolves profile-scoped custom ids from the custom template', () => {
    const dynamicId = customOpenAiModelIdForProfile('hospital-a')
    expect(customOpenAiModelIdForProfile('legacy')).toBe(CUSTOM_OPENAI_MODEL_ID)
    expect(() => customOpenAiModelIdForProfile('  ')).toThrow('OpenAI-compatible profile id is required')
    expect(isCustomOpenAiModelId(dynamicId)).toBe(true)
    expect(isModelId(dynamicId)).toBe(true)
    expect(openAiCompatibleProfileIdFromModelId(dynamicId)).toBe('hospital-a')
    expect(getModelDefinition(dynamicId)).toMatchObject({
      id: dynamicId,
      provider: 'custom',
      conversationMode: 'standard',
    })
  })

  it('applies sampling policy without model-name checks', () => {
    const fixed = MODEL_CATALOG.find((model) => model.temperaturePolicy === 'fixed-one')!
    const omitted = MODEL_CATALOG.find((model) => model.temperaturePolicy === 'omit')!
    const passthrough = MODEL_CATALOG.find((model) => model.temperaturePolicy === 'passthrough')!
    expect(resolveModelTemperature(fixed, 0.2)).toBe(1)
    expect(resolveModelTemperature(omitted, 0.2)).toBeUndefined()
    expect(resolveModelTemperature(passthrough, 0.2)).toBe(0.2)
  })
})
