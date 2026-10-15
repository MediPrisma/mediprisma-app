import { act, renderHook, waitFor } from '@testing-library/react'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { useAiSlotGeneration } from '@/src/application/hooks/ai-generation/use-ai-slot-generation.hook'
import { ContextOverflowError, type ContextOverflowIssue } from '@/src/shared/utils/context-budget'
import {
  loadEncryptedCache,
  saveEncryptedCache,
} from '@/src/infrastructure/cache/encrypted-session-cache'
import {
  CUSTOM_OPENAI_MODEL_ID,
  customOpenAiModelIdForProfile,
} from '@/src/shared/constants/ai-models.constants'
import type {
  OpenAiCompatibleConfig,
  OpenAiCompatibleProfile,
} from '@/src/shared/types/openai-compatible.types'
import {
  BUNDLE_CHANGED_EVENT,
  BUNDLE_CHANGE_SETTLED_EVENT,
} from '@/src/shared/utils/reset-on-bundle-change'

let mockOpenAiKey: string | null = 'user-openai-key'
let mockPatientId = 'demo-patient-1'
let mockClinicalContext = 'demo context'
let mockClinicalContextForProfile:
  | ((profile: { filters?: { labDepth?: string } } | undefined) => string)
  | null = null
let mockClinicalData: Record<string, unknown> = {
  isLoading: false,
  isFetching: false,
  error: null,
  encounters: [{ id: 'demo-encounter-1' }],
}
let mockCachedResult: { headline: string } | null = null
let mockOpenAiCompatible: OpenAiCompatibleConfig | null = null
let mockOpenAiCompatibleProfiles: OpenAiCompatibleProfile[] | null = null
let mockLocale: 'zh-TW' | 'en' = 'zh-TW'
let mockAudience: 'medical' | 'patient' = 'patient'
const mockStopAi = jest.fn()

jest.mock('@/src/application/hooks/patient/use-patient-query.hook', () => ({
  usePatient: () => ({ patient: { id: mockPatientId } }),
}))
jest.mock('@/src/application/hooks/use-clinical-context.hook', () => ({
  useClinicalContext: (
    _consumer: unknown,
    options?: { profile?: { filters?: { labDepth?: string } } },
  ) => ({
    getFullClinicalContext: () => (
      mockClinicalContextForProfile
        ? mockClinicalContextForProfile(options?.profile)
        : mockClinicalContext
    ),
    getFormattedClinicalContext: () => (
      mockClinicalContextForProfile
        ? mockClinicalContextForProfile(options?.profile)
        : mockClinicalContext
    ),
    includedDocumentIds: [],
  }),
}))
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockClinicalData,
}))
jest.mock('@/src/application/hooks/ai/use-unified-ai.hook', () => ({
  useUnifiedAi: () => ({ stop: mockStopAi }),
}))
jest.mock('@/src/application/providers/data-selection.provider', () => {
  const constants = jest.requireActual('@/src/shared/constants/data-selection.constants')
  return {
    useDataSelection: () => ({
      getProfile: () => ({
        selection: constants.ALL_DATA_SELECTION,
        filters: constants.ALL_DATA_FILTERS,
      }),
    }),
  }
})
jest.mock('@/src/application/stores/ai-config.store', () => ({
  useAllApiKeys: () => ({
    apiKey: mockOpenAiKey,
    geminiKey: '',
    claudeKey: '',
    openAiCompatible: mockOpenAiCompatible,
    openAiCompatibleProfiles: mockOpenAiCompatibleProfiles ?? (mockOpenAiCompatible
      ? [{ ...mockOpenAiCompatible, profileId: 'legacy' }]
      : []),
  }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: mockLocale }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: mockAudience }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ loading: false, user: { uid: 'user-1' }, isAnonymous: false }),
}))
jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({
  ...jest.requireActual('@/src/infrastructure/cache/encrypted-session-cache'),
  loadEncryptedCache: jest.fn(async () => mockCachedResult),
  saveEncryptedCache: jest.fn(async () => undefined),
}))
jest.mock('@/src/core/use-cases/medical-summary/generate-medical-summary.use-case', () => ({
  getSourceCatalog: (input: { encounters?: unknown[] }) => !input.encounters?.length
    ? []
    : [{
        key: 'E1',
        resourceType: 'Encounter',
        resourceId: 'demo-encounter-1',
        display: 'Demo encounter',
      }],
  scopeDocumentSources: (catalog: unknown) => catalog,
}))

describe('useAiSlotGeneration demo snapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOpenAiKey = 'user-openai-key'
    mockPatientId = 'demo-patient-1'
    mockClinicalContext = 'demo context'
    mockClinicalContextForProfile = null
    mockClinicalData = {
      isLoading: false,
      isFetching: false,
      error: null,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    mockCachedResult = null
    mockOpenAiCompatible = null
    mockOpenAiCompatibleProfiles = null
    mockLocale = 'zh-TW'
    mockAudience = 'patient'
  })

  it('blocks an unavailable selected model only when the feature opts out of fallback', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiKey = null
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'selected model result' }))
    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gpt-5.6-terra',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (key) => `test:${key}`,
      cacheMaxAgeMs: 60_000,
      run,
      blockUnavailableSelectedModel: true,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    expect(result.current.resolvedModelId).toBe('gpt-5.6-terra')
    expect(result.current.modelUnavailable).toBe(true)
    expect(result.current.error).toContain('本次未送出任何資料')
    await act(async () => result.current.generate())
    expect(run).not.toHaveBeenCalled()

    mockOpenAiKey = 'restored-test-key'
    rerender()
    await act(async () => result.current.generate())
    expect(result.current.modelUnavailable).toBe(false)
    expect(result.current.error).toBeNull()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'gpt-5.6-terra' }))
  })

  it('keeps the shared fallback behaviour for features that do not opt in', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiKey = null
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'fallback result' }))
    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gpt-5.6-terra',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (key) => `test:${key}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    expect(result.current.resolvedModelId).toBe('gemini-3.1-flash-lite')
    expect(result.current.modelUnavailable).toBe(false)
    await act(async () => result.current.generate())
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'gemini-3.1-flash-lite' }))
  })

  it('keeps overflow structured and blocks the result from being stored or persisted', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    const issue: ContextOverflowIssue = {
      kind: 'context-overflow',
      requestTokens: 120_000,
      selectedTokens: 6_400,
      usable: 116_000,
      limit: 120_000,
      reserve: 4_000,
      overBy: 4_000,
      suggestedSelectedMax: 2_400,
    }
    const run = jest.fn(async () => {
      throw new ContextOverflowError(issue, 'zh-TW')
    })

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    expect(result.current.issue).toEqual(issue)
    expect(result.current.error).toContain('本次未送出')
    expect(result.current.isRunning).toBe(false)
    expect(result.current.result).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
    expect(store.getState().byKey).toEqual({})
    expect(saveEncryptedCache).not.toHaveBeenCalled()
  })

  it('aborts the pipeline and rejects a late result without surfacing an error', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    let finishRun!: () => void
    const run = jest.fn()
      .mockImplementationOnce(() => new Promise<{ headline: string }>((resolve) => {
        finishRun = () => resolve({ headline: 'late cancelled result' })
      }))
      .mockResolvedValueOnce({ headline: 'successful retry' })

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))

    act(() => result.current.cancel())
    expect(mockStopAi).toHaveBeenCalledTimes(1)
    expect(mockStopAi).toHaveBeenCalledWith(result.current.slotKey)

    await act(async () => {
      finishRun()
      await generation
    })

    expect(result.current.isRunning).toBe(false)
    expect(result.current.result).toBeUndefined()
    expect(result.current.error).toBeNull()
    expect(result.current.issue).toBeNull()
    expect(saveEncryptedCache).not.toHaveBeenCalled()

    await act(async () => result.current.generate())

    expect(run).toHaveBeenCalledTimes(2)
    expect(result.current.result).toEqual({ headline: 'successful retry' })
    expect(result.current.error).toBeNull()
    expect(saveEncryptedCache).toHaveBeenCalledTimes(1)
  })

  it('prevents a cancelled auto pipeline from starting after delayed hydration', async () => {
    mockPatientId = 'smart-patient-1'
    let finishHydration!: () => void
    jest.mocked(loadEncryptedCache).mockImplementationOnce(() => new Promise((resolve) => {
      finishHydration = () => resolve(null)
    }))
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'must not start' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(loadEncryptedCache).toHaveBeenCalledTimes(1))
    act(() => result.current.cancel())
    await act(async () => {
      finishHydration()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.isHydrated).toBe(true))

    expect(run).not.toHaveBeenCalled()
    expect(result.current.result).toBeUndefined()
  })

  it('restores the captured slot and encrypted cache after a companion is cancelled', async () => {
    mockPatientId = 'smart-patient-1'
    const previous = { headline: 'previous complete batch' }
    const store = createAiResultStore<{ headline: string }>()
    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run: async () => ({ headline: 'unused' }),
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    const slotKey = result.current.slotKey
    const cacheKey = `test:${slotKey}`
    window.localStorage.setItem(cacheKey, 'encrypted cancelled half')
    jest.mocked(saveEncryptedCache).mockImplementationOnce(
      () => new Promise<void>(() => undefined),
    )
    act(() => store.getState().setResult(slotKey, { headline: 'cancelled half' }))
    act(() => result.current.restoreSlot(slotKey, previous))

    expect(window.localStorage.getItem(cacheKey)).toBeNull()
    expect(store.getState().byKey[slotKey]).toBe(previous)
    expect(store.getState().errors[slotKey]).toBeNull()
    expect(store.getState().issues[slotKey]).toBeNull()
    expect(saveEncryptedCache).toHaveBeenCalledWith(
      cacheKey,
      previous,
      expect.any(Function),
    )
    const shouldCommit = jest.mocked(saveEncryptedCache).mock.calls.at(-1)?.[2]
    expect(shouldCommit?.()).toBe(true)
  })

  it('releases the blocked state after the custom endpoint window is corrected', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiCompatible = {
      enabled: true,
      baseUrl: 'https://hospital.example/v1',
      modelId: 'local-7b',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens: 15_000,
      contextWindowSource: 'manual',
    }
    const issue: ContextOverflowIssue = {
      kind: 'context-overflow',
      requestTokens: 15_000,
      selectedTokens: 6_400,
      usable: 11_000,
      limit: 15_000,
      reserve: 4_000,
      overBy: 4_000,
      suggestedSelectedMax: 2_399,
    }
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: { contextLimit: number; modelName: string }) => {
      if (ctx.contextLimit === 15_000) {
        throw new ContextOverflowError(issue, 'zh-TW')
      }
      return { headline: 'fits corrected window' }
    })

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: CUSTOM_OPENAI_MODEL_ID,
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    expect(result.current.issue).toEqual(issue)

    mockOpenAiCompatible = {
      ...mockOpenAiCompatible,
      contextWindowTokens: 32_768,
    }
    rerender()

    await waitFor(() => {
      expect(result.current.contextLimit).toBe(32_768)
      expect(result.current.issue).toBeNull()
      expect(result.current.error).toBeNull()
    })

    await act(async () => result.current.generate())

    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.map(([ctx]) => ctx.contextLimit)).toEqual([15_000, 32_768])
    expect(run.mock.calls.map(([ctx]) => ctx.modelName)).toEqual(['local-7b', 'local-7b'])
    expect(result.current.issue).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.result).toEqual({ headline: 'fits corrected window' })
  })

  it('presents the audited snapshot without filing it under another model preference', async () => {
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'live AI result' }))
    const demoSeed = jest.fn(() => ({ headline: 'pre-generated demo result' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gpt-5.6-terra',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      demoSeed,
    }))

    await waitFor(() => {
      expect(result.current.resolvedModelId).toBe('gpt-5.6-terra')
      expect(result.current.result).toEqual({ headline: 'pre-generated demo result' })
    })
    expect(store.getState().byKey[result.current.slotKey]).toBeUndefined()
    expect(demoSeed).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('restores each model version, uses the current result for empty slots, and keeps demo ownership canonical', async () => {
    mockOpenAiCompatible = {
      enabled: true,
      baseUrl: 'https://hospital.example/v1',
      modelId: 'local-7b',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens: 32_768,
      contextWindowSource: 'manual',
    }
    type VersionedResult = {
      headline: string
      generation?: { modelId: string }
    }
    const store = createAiResultStore<VersionedResult>()
    let failPreview = true
    const run = jest.fn(async (ctx: { modelId: string }) => {
      if (ctx.modelId === 'gemini-3-flash-preview' && failPreview) return null
      return {
        headline: `live result from ${ctx.modelId}`,
        generation: { modelId: ctx.modelId },
      }
    })
    const demoSeed = jest.fn(() => ({
      headline: 'pre-generated demo result',
      generation: { modelId: 'gemini-3.1-flash-lite' },
    }))

    const { result, rerender } = renderHook(
      ({ selectedModelId }: { selectedModelId: string }) => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId,
        autoRunEnabled: true,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
        demoSeed,
        resultModelId: (candidate) => candidate.generation?.modelId,
        retainResultOnModelChange: true,
      }),
      { initialProps: { selectedModelId: CUSTOM_OPENAI_MODEL_ID as string } },
    )

    await waitFor(() => {
      expect(result.current.result?.headline).toBe('pre-generated demo result')
    })
    const customSlotKey = result.current.slotKey
    // Flash-Lite's bundled result may fill an initially blank screen, but it
    // is not a custom-model result and must not pollute that slot.
    expect(store.getState().byKey[customSlotKey]).toBeUndefined()

    await act(async () => result.current.generate())
    await waitFor(() => {
      expect(result.current.result?.headline).toBe(
        `live result from ${CUSTOM_OPENAI_MODEL_ID}`,
      )
    })

    // Reproduce the reported failure precisely: this target model slot was
    // polluted by the old policy with a Flash-Lite demo snapshot. Selecting
    // the model must not make that older slot replace the visible live result.
    const previewSlotParts = result.current.slotKey.split('::')
    previewSlotParts[3] = 'gemini-3-flash-preview'
    act(() => {
      store.getState().setResult(previewSlotParts.join('::'), {
        headline: 'old Flash-Lite snapshot in preview slot',
      })
    })

    rerender({ selectedModelId: 'gemini-3-flash-preview' })

    await waitFor(() => {
      expect(result.current.resolvedModelId).toBe('gemini-3-flash-preview')
      expect(result.current.isHydrated).toBe(true)
    })
    expect(result.current.result?.headline).toBe(
      `live result from ${CUSTOM_OPENAI_MODEL_ID}`,
    )
    expect(demoSeed).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)

    await act(async () => result.current.generate())

    expect(result.current.result?.headline).toBe(
      `live result from ${CUSTOM_OPENAI_MODEL_ID}`,
    )
    expect(result.current.error).toBe('PARSE_FAILED')

    failPreview = false
    await act(async () => result.current.generate())

    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      modelId: 'gemini-3-flash-preview',
    }))
    expect(result.current.result?.headline).toBe('live result from gemini-3-flash-preview')
    expect(result.current.error).toBeNull()
    expect(demoSeed).toHaveBeenCalledTimes(1)

    // The canonical Flash-Lite slot is empty so the audited demo version is
    // installed there after hydration and immediately becomes visible.
    rerender({ selectedModelId: 'gemini-3.1-flash-lite' })
    await waitFor(() => {
      expect(result.current.resolvedModelId).toBe('gemini-3.1-flash-lite')
      expect(result.current.result?.headline).toBe('pre-generated demo result')
      expect(result.current.result?.generation?.modelId).toBe('gemini-3.1-flash-lite')
    })
    expect(store.getState().byKey[result.current.slotKey]?.headline).toBe(
      'pre-generated demo result',
    )

    // Switching back restores the custom model's own last successful result;
    // no regeneration is required and provenance follows the displayed data.
    rerender({ selectedModelId: CUSTOM_OPENAI_MODEL_ID })
    await waitFor(() => {
      expect(result.current.slotKey).toBe(customSlotKey)
      expect(result.current.result?.headline).toBe(
        `live result from ${CUSTOM_OPENAI_MODEL_ID}`,
      )
      expect(result.current.result?.generation?.modelId).toBe(CUSTOM_OPENAI_MODEL_ID)
    })
    expect(demoSeed).toHaveBeenCalledTimes(2)
  })

  it('keeps the current version visible until the selected model cache finishes restoring', async () => {
    mockPatientId = 'smart-patient-1'
    type VersionedResult = {
      headline: string
      generation: { modelId: string; modelName: string }
    }
    const store = createAiResultStore<VersionedResult>()
    let resolveModelBCache!: (value: VersionedResult) => void
    const loadCached = jest.fn((slotKey: string) => {
      if (slotKey.includes('::gpt-5.6-terra::')) {
        return new Promise<VersionedResult>((resolve) => {
          resolveModelBCache = resolve
        })
      }
      return Promise.resolve(null)
    })
    const run = jest.fn(async (ctx: { modelId: string; modelName: string }) => ({
      headline: `live ${ctx.modelId}`,
      generation: { modelId: ctx.modelId, modelName: ctx.modelName },
    }))

    const { result, rerender } = renderHook(
      ({ selectedModelId }: { selectedModelId: string }) => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId,
        autoRunEnabled: false,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        loadCached,
        run,
        resultModelId: (candidate) => candidate.generation.modelId,
        retainResultOnModelChange: true,
      }),
      { initialProps: { selectedModelId: 'gpt-5.4-nano' } },
    )

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    expect(result.current.result?.headline).toBe('live gpt-5.4-nano')

    rerender({ selectedModelId: 'gpt-5.6-terra' })
    await waitFor(() => expect(loadCached.mock.calls.some(
      ([slotKey]) => slotKey.includes('::gpt-5.6-terra::'),
    )).toBe(true))
    expect(result.current.result?.headline).toBe('live gpt-5.4-nano')

    await act(async () => {
      resolveModelBCache({
        headline: 'cached model B',
        generation: { modelId: 'gpt-5.6-terra', modelName: 'GPT-5.6 Terra' },
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.result?.headline).toBe('cached model B')
      expect(result.current.result?.generation.modelId).toBe('gpt-5.6-terra')
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('distinguishes result ownership when a custom endpoint runtime changes', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiCompatible = {
      enabled: true,
      baseUrl: 'https://gateway-a.example/v1',
      modelId: 'local-model-a',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens: 32_768,
      contextWindowSource: 'manual',
    }
    type VersionedResult = {
      headline: string
      generation: { modelId: string }
    }
    const store = createAiResultStore<VersionedResult>()
    const run = jest.fn(async (ctx: { modelId: string; modelName: string }) => ({
      headline: ctx.modelName,
      generation: { modelId: ctx.modelId },
    }))
    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: CUSTOM_OPENAI_MODEL_ID,
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      resultModelId: (candidate) => candidate.generation.modelId,
      retainResultOnModelChange: true,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    const endpointASlot = result.current.slotKey
    const endpointARuntime = result.current.resultOwnerRuntimeId
    expect(result.current.result?.headline).toBe('local-model-a')
    expect(result.current.resultOwnerModelId).toBe(CUSTOM_OPENAI_MODEL_ID)
    expect(endpointARuntime).toContain(`${CUSTOM_OPENAI_MODEL_ID}:custom-`)

    mockOpenAiCompatible = {
      ...mockOpenAiCompatible,
      baseUrl: 'https://gateway-b.example/v1',
      modelId: 'local-model-b',
    }
    rerender()

    expect(result.current.slotKey).not.toBe(endpointASlot)
    expect(result.current.result?.headline).toBe('local-model-a')
    expect(result.current.resultOwnerRuntimeId).toBe(endpointARuntime)

    await act(async () => result.current.generate())

    expect(result.current.result?.headline).toBe('local-model-b')
    expect(result.current.resultOwnerModelId).toBe(CUSTOM_OPENAI_MODEL_ID)
    expect(result.current.resultOwnerRuntimeId).not.toBe(endpointARuntime)
  })

  it('routes each dynamic custom model to its own profile and result slot', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiCompatibleProfiles = [
      {
        profileId: 'endpoint-a',
        enabled: true,
        baseUrl: 'https://gateway-a.example/v1',
        modelId: 'local-model-a',
        apiKey: null,
        contextWindowTokens: 32_768,
      },
      {
        profileId: 'endpoint-b',
        enabled: true,
        baseUrl: 'https://gateway-b.example/v1',
        modelId: 'local-model-b',
        apiKey: null,
        contextWindowTokens: 65_536,
      },
    ]
    const modelA = customOpenAiModelIdForProfile('endpoint-a')
    const modelB = customOpenAiModelIdForProfile('endpoint-b')
    type VersionedResult = {
      headline: string
      generation: { modelId: string }
    }
    const store = createAiResultStore<VersionedResult>()
    const run = jest.fn(async (ctx: {
      modelId: string
      modelName: string
      contextLimit: number
    }) => ({
      headline: `${ctx.modelName}:${ctx.contextLimit}`,
      generation: { modelId: ctx.modelId },
    }))
    const { result, rerender } = renderHook(
      ({ selectedModelId }: { selectedModelId: string }) => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId,
        autoRunEnabled: false,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
        resultModelId: (candidate) => candidate.generation.modelId,
        retainResultOnModelChange: true,
      }),
      { initialProps: { selectedModelId: modelA as string } },
    )

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    const slotA = result.current.slotKey
    expect(result.current.result?.headline).toBe('local-model-a:32768')
    expect(result.current.resultOwnerModelId).toBe(modelA)

    rerender({ selectedModelId: modelB })
    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    expect(result.current.slotKey).not.toBe(slotA)
    expect(result.current.result?.headline).toBe('local-model-a:32768')

    await act(async () => result.current.generate())
    expect(result.current.result?.headline).toBe('local-model-b:65536')
    expect(result.current.resultOwnerModelId).toBe(modelB)

    rerender({ selectedModelId: modelA })
    expect(result.current.result?.headline).toBe('local-model-a:32768')
  })

  describe('contextTokenBudget (local latency budget)', () => {
    const onPremEndpoint = (contextWindowTokens: number): OpenAiCompatibleConfig => ({
      enabled: true,
      baseUrl: 'https://gateway.example/v1',
      modelId: 'qwen-standin-local',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens,
      contextWindowSource: 'manual',
    })
    type BudgetRunContext = {
      clinicalContext: string
      catalog: Array<{ key: string }>
      clinicalData: unknown
      contextAdaptation: {
        tier: string
        reason: string
        targetTokens: number
        originalTokens: number
        adaptedTokens: number
      } | null
      clinicalContextScope?: { clinicalData: unknown; catalog: Array<{ key: string }> }
    }
    const renderBudgetedSlot = (contextTokenBudget?: (limit: number) => number | undefined) => {
      const store = createAiResultStore<{ headline: string }>()
      const run = jest.fn(async (ctx: BudgetRunContext) => ({
        headline: `${ctx.contextAdaptation?.reason ?? 'none'}:${ctx.clinicalContext.slice(0, 7)}`,
      }))
      const hook = renderHook(() => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId: CUSTOM_OPENAI_MODEL_ID,
        autoRunEnabled: false,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
        ...(contextTokenBudget ? { contextTokenBudget } : {}),
      }))
      return { ...hook, run }
    }
    const generateOnce = async (result: { current: { dataReady: boolean; isHydrated: boolean; generate: () => Promise<void> } }) => {
      await waitFor(() => expect(result.current.dataReady).toBe(true))
      await waitFor(() => expect(result.current.isHydrated).toBe(true))
      await act(async () => result.current.generate())
    }

    beforeEach(() => {
      mockPatientId = 'smart-patient-1'
      // A recent encounter survives every fitting tier; it is E1 in both the
      // saved and the narrowed catalog.
      mockClinicalData = {
        isLoading: false,
        isFetching: false,
        error: null,
        encounters: [{ id: 'demo-encounter-1', period: { start: new Date().toISOString() } }],
      }
      // ~52K tokens in full; the six-month view is ~1.8K.
      mockClinicalContextForProfile = (profile) => (
        profile?.filters?.labDepth === '3'
          ? `compact-${'record '.repeat(1_000)}`
          : `full-${'record '.repeat(30_000)}`
      )
    })

    it('narrows a chart the 262K window would hold, and reports local-latency', async () => {
      mockOpenAiCompatible = onPremEndpoint(262_144)
      const budget = jest.fn((limit: number) => (limit < 500_000 ? 24_000 : undefined))
      const { result, run } = renderBudgetedSlot(budget)
      await generateOnce(result)

      expect(budget).toHaveBeenCalledWith(262_144, { selfHosted: true })
      const ctx = run.mock.calls[0][0]
      expect(ctx.clinicalContext.startsWith('compact-')).toBe(true)
      expect(ctx.contextAdaptation).toMatchObject({
        tier: 'compact',
        reason: 'local-latency',
        contextLimit: 262_144,
        targetTokens: 24_000,
      })
      expect(ctx.contextAdaptation!.adaptedTokens).toBeLessThanOrEqual(24_000)
      // The narrowed records ride beside the saved scope; the catalog the
      // result is finalised against is the saved scope's.
      expect(ctx.clinicalContextScope).toBeDefined()
      expect(ctx.catalog.map((entry) => entry.key)).toEqual(['E1'])
      expect(ctx.clinicalContextScope!.catalog.map((entry) => entry.key)).toEqual(['E1'])
      expect(ctx.clinicalContextScope!.clinicalData).not.toBe(ctx.clinicalData)
      expect(ctx.catalog).toEqual(result.current.catalog)
      expect(ctx.clinicalData).toEqual(result.current.clinicalData)
      expect(result.current.contextAdaptation?.reason).toBe('local-latency')
      expect(result.current.result?.headline).toBe('local-latency:compact')
    })

    it('changes nothing when the budget returns undefined', async () => {
      mockOpenAiCompatible = onPremEndpoint(262_144)
      const { result, run } = renderBudgetedSlot(() => undefined)
      await generateOnce(result)

      const ctx = run.mock.calls[0][0]
      expect(ctx.clinicalContext.startsWith('full-')).toBe(true)
      expect(ctx.contextAdaptation).toBeNull()
      expect(ctx.clinicalContextScope).toBeUndefined()
      expect(result.current.contextAdaptation).toBeNull()
    })

    it('keeps the window as the reason when the window is the tighter limit', async () => {
      mockOpenAiCompatible = onPremEndpoint(32_768)
      const { result, run } = renderBudgetedSlot(() => 24_000)
      await generateOnce(result)

      const ctx = run.mock.calls[0][0]
      expect(ctx.clinicalContext.startsWith('compact-')).toBe(true)
      expect(ctx.contextAdaptation).toMatchObject({
        tier: 'compact',
        reason: 'context-window',
        targetTokens: 20_768,
      })
      expect(ctx.clinicalContextScope).toBeUndefined()
    })

    it('hands the run an abort signal that cancel() aborts', async () => {
      mockOpenAiCompatible = onPremEndpoint(262_144)
      const store = createAiResultStore<{ headline: string }>()
      let seenSignal: AbortSignal | undefined
      const run = jest.fn((ctx: { signal?: AbortSignal }) => new Promise<{ headline: string } | null>((resolve) => {
        seenSignal = ctx.signal
        ctx.signal?.addEventListener('abort', () => resolve(null))
      }))
      const { result } = renderHook(() => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId: CUSTOM_OPENAI_MODEL_ID,
        autoRunEnabled: false,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
      }))
      await waitFor(() => expect(result.current.dataReady).toBe(true))
      await waitFor(() => expect(result.current.isHydrated).toBe(true))
      let pending!: Promise<void>
      act(() => { pending = result.current.generate() })
      await waitFor(() => expect(seenSignal).toBeDefined())
      expect(seenSignal!.aborted).toBe(false)
      act(() => result.current.cancel())
      expect(seenSignal!.aborted).toBe(true)
      await act(async () => { await pending })
    })
  })

  it('progressively reaches the six-month tier before any text fallback', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiCompatible = {
      enabled: true,
      baseUrl: 'https://gateway.example/v1',
      modelId: 'small-local-model',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens: 32_768,
      contextWindowSource: 'manual',
    }
    mockClinicalContextForProfile = (profile) => (
      profile?.filters?.labDepth === '3'
        ? `compact-${'record '.repeat(1_000)}`
        : `full-${'record '.repeat(30_000)}`
    )
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: {
      clinicalContext: string
      contextAdaptation: {
        tier: string
        originalTokens: number
        adaptedTokens: number
      } | null
    }) => ({
      headline: `${ctx.contextAdaptation?.tier}:${ctx.clinicalContext.slice(0, 7)}`,
    }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: CUSTOM_OPENAI_MODEL_ID,
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.dataReady).toBe(true))
    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())

    expect(run).toHaveBeenCalledTimes(1)
    const context = run.mock.calls[0][0]
    expect(context.clinicalContext.startsWith('compact-')).toBe(true)
    expect(context.clinicalContext).not.toContain('omitted to fit the selected model')
    expect(context.contextAdaptation?.tier).toBe('compact')
    expect(context.contextAdaptation?.adaptedTokens)
      .toBeLessThan(context.contextAdaptation?.originalTokens ?? 0)
    expect(result.current.contextAdaptation?.tier).toBe('compact')
    expect(result.current.result?.headline).toBe('compact:compact')
  })

  it('reduces a modest 105k overage toward the 98.6k target instead of collapsing it', async () => {
    mockPatientId = 'smart-patient-1'
    mockClinicalContextForProfile = (profile) => (
      profile?.filters?.labDepth === '8'
        ? `trimmed-${'record '.repeat(56_000)}`
        : profile?.filters?.labDepth === '3'
          ? `compact-${'record '.repeat(3_800)}`
          : `full-${'record '.repeat(60_000)}`
    )
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: {
      clinicalContext: string
      contextAdaptation: {
        tier: string
        originalTokens: number
        adaptedTokens: number
        targetTokens: number
      } | null
    }) => ({ headline: ctx.contextAdaptation?.tier ?? 'full' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.dataReady).toBe(true))
    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())

    const adaptation = run.mock.calls[0][0].contextAdaptation
    expect(adaptation?.tier).toBe('trimmed')
    expect(adaptation?.originalTokens).toBeGreaterThan(100_000)
    expect(adaptation?.targetTokens).toBe(98_600)
    expect(adaptation?.adaptedTokens).toBeGreaterThan(97_000)
    expect(adaptation?.adaptedTokens).toBeLessThanOrEqual(98_600)
    expect(result.current.result?.headline).toBe('trimmed')
  })

  it('applies the TVGHBrain tokenizer reserve through structured reduction before generation', async () => {
    mockPatientId = 'smart-patient-1'
    mockOpenAiCompatible = {
      enabled: true,
      baseUrl: 'https://hospital.example/v1',
      modelId: 'tvghbrain3.5',
      apiKey: null,
      transport: 'direct',
      contextWindowTokens: 262_144,
      contextWindowSource: 'manual',
    }
    mockClinicalContextForProfile = (profile) => (
      profile?.filters?.labDepth === '8'
        ? `trimmed-${'病歷'.repeat(105_000)}`
        : `full-${'病歷'.repeat(135_000)}`
    )
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: {
      clinicalContext: string
      contextAdaptation: {
        tier: string
        targetTokens: number
        originalTokens: number
        adaptedTokens: number
      } | null
    }) => ({ headline: ctx.contextAdaptation?.tier ?? 'full' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: CUSTOM_OPENAI_MODEL_ID,
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.dataReady).toBe(true))
    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())

    const context = run.mock.calls[0][0]
    expect(context.clinicalContext.startsWith('trimmed-')).toBe(true)
    expect(context.clinicalContext).not.toContain('omitted to fit the selected model')
    expect(context.contextAdaptation).toMatchObject({
      tier: 'trimmed',
      targetTokens: 146_993,
    })
    expect(context.contextAdaptation?.adaptedTokens)
      .toBeLessThan(context.contextAdaptation?.originalTokens ?? 0)
  })

  it('keeps a 74k clinical input intact for a 120k model', async () => {
    mockPatientId = 'smart-patient-1'
    mockClinicalContextForProfile = (profile) => (
      profile?.filters?.labDepth === '3'
        ? `compact-${'record '.repeat(1_000)}`
        : `full-${'record '.repeat(42_285)}`
    )
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: {
      clinicalContext: string
      contextAdaptation: { tier: string } | null
    }) => ({
      headline: ctx.clinicalContext.slice(0, 4),
    }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gpt-5.4-nano',
      selectedModelId: 'gpt-5.4-nano',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.dataReady).toBe(true))
    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].clinicalContext.startsWith('full-')).toBe(true)
    expect(run.mock.calls[0][0].contextAdaptation).toBeNull()
    expect(result.current.contextAdaptation).toBeNull()
    expect(result.current.result?.headline).toBe('full')
  })

  it('keeps any-model busy state inside the exact Bundle and clinical-input scope', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    let finishRun!: (value: { headline: string }) => void
    const run = jest.fn(() => new Promise<{ headline: string }>((resolve) => {
      finishRun = resolve
    }))
    const { result, rerender } = renderHook(
      ({ selectedModelId }: { selectedModelId: string }) => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId,
        autoRunEnabled: false,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
      }),
      { initialProps: { selectedModelId: 'gemini-3.1-flash-lite' } },
    )

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    const originalScope = result.current.scopeKey
    act(() => { void result.current.generate() })
    await waitFor(() => expect(result.current.isAnyRunning).toBe(true))

    // The picker is model-independent presentation state: moving to another
    // model must retain the active timer for this same exact input scope.
    rerender({ selectedModelId: 'gpt-5.4-nano' })
    expect(result.current.scopeKey).toBe(originalScope)
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isAnyRunning).toBe(true)

    mockAudience = 'medical'
    rerender({ selectedModelId: 'gpt-5.6-terra' })
    expect(result.current.scopeKey).not.toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(false)

    mockAudience = 'patient'
    mockLocale = 'en'
    rerender({ selectedModelId: 'gpt-5.6-terra' })
    expect(result.current.scopeKey).not.toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(false)

    mockLocale = 'zh-TW'
    mockClinicalContext = 'different selected clinical input'
    mockClinicalData = {
      ...mockClinicalData,
      encounters: [
        { id: 'demo-encounter-1' },
        { id: 'changed-encounter' },
      ],
    }
    rerender({ selectedModelId: 'gpt-5.6-terra' })
    expect(result.current.scopeKey).not.toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(false)

    mockClinicalContext = 'demo context'
    mockClinicalData = {
      ...mockClinicalData,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    mockPatientId = 'smart-patient-2'
    rerender({ selectedModelId: 'gpt-5.6-terra' })
    expect(result.current.scopeKey).not.toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(false)

    mockPatientId = 'smart-patient-1'
    rerender({ selectedModelId: 'gpt-5.6-terra' })
    expect(result.current.scopeKey).toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(true)

    act(() => window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT)))
    expect(result.current.scopeKey).not.toBe(originalScope)
    expect(result.current.isAnyRunning).toBe(false)

    await act(async () => {
      finishRun({ headline: 'obsolete scope result' })
    })
  })

  it('does not auto-run a second model when the picker changes mid-generation', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    let finishFirstRun!: (value: { headline: string }) => void
    const run = jest.fn(() => new Promise<{ headline: string }>((resolve) => {
      finishFirstRun = resolve
    }))

    const { result, rerender } = renderHook(
      ({ selectedModelId }: { selectedModelId: string }) => useAiSlotGeneration({
        defaultModelId: 'gemini-3.1-flash-lite',
        selectedModelId,
        autoRunEnabled: true,
        requireDataReadyToGenerate: true,
        store,
        cacheKeyFor: (slotKey) => `test:${slotKey}`,
        cacheMaxAgeMs: 60_000,
        run,
        retainResultOnModelChange: true,
      }),
      { initialProps: { selectedModelId: 'gemini-3.1-flash-lite' } },
    )

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(result.current.isAnyRunning).toBe(true)

    rerender({ selectedModelId: 'gpt-5.4-nano' })
    await act(async () => Promise.resolve())

    expect(result.current.resolvedModelId).toBe('gpt-5.4-nano')
    expect(result.current.isAnyRunning).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)

    await act(async () => finishFirstRun({ headline: 'model A result' }))
    await waitFor(() => expect(result.current.isAnyRunning).toBe(false))

    expect(run).toHaveBeenCalledTimes(1)
    expect(result.current.result).toEqual({ headline: 'model A result' })
  })

  it('never carries a retained result across a Bundle revision', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'current patient result' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3-flash-preview',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      retainResultOnModelChange: true,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    expect(result.current.result).toEqual({ headline: 'current patient result' })

    await act(async () => {
      window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT))
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.result).toBeUndefined())
  })

  it('does not let a late cache read overwrite a newer manual result', async () => {
    mockPatientId = 'smart-patient-1'
    let resolveCache!: (value: { headline: string }) => void
    jest.mocked(loadEncryptedCache).mockImplementationOnce(() => new Promise((resolve) => {
      resolveCache = resolve
    }))
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'new manual result' }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3-flash-preview',
      autoRunEnabled: false,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      retainResultOnModelChange: true,
    }))

    await waitFor(() => expect(loadEncryptedCache).toHaveBeenCalled())
    await act(async () => result.current.generate())
    expect(result.current.result).toEqual({ headline: 'new manual result' })

    await act(async () => {
      resolveCache({ headline: 'older cached result' })
      await Promise.resolve()
    })

    expect(result.current.result).toEqual({ headline: 'new manual result' })
  })

  it('waits for the demo catalog instead of auto-running AI against transient empty data', async () => {
    mockClinicalData = { isLoading: false, error: null, encounters: [] }
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'live AI result from empty data' }))
    const demoSeed = jest.fn(() => ({ headline: 'pre-generated demo result' }))

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      demoSeed,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    expect(result.current.result).toBeUndefined()
    expect(run).not.toHaveBeenCalled()

    mockClinicalData = {
      isLoading: false,
      isFetching: false,
      error: null,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    rerender()

    await waitFor(() => {
      expect(result.current.result).toEqual({ headline: 'pre-generated demo result' })
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('does not restart AI for the previous patient while a bundle switch is in progress', async () => {
    mockPatientId = 'local-patient'
    mockCachedResult = { headline: 'existing local result' }
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'unexpected live AI result' }))
    const demoSeed = jest.fn(() => ({ headline: 'pre-generated demo result' }))

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
      demoSeed,
    }))

    await waitFor(() => {
      expect(result.current.result).toEqual({ headline: 'existing local result' })
    })

    // persistBundle() dispatches this reset before React Query publishes the
    // newly imported patient/data. The old patient must not become auto-run
    // eligible in that transition window merely because its store was cleared.
    act(() => window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT)))
    expect(run).not.toHaveBeenCalled()

    mockCachedResult = null
    mockPatientId = 'demo-patient-1'
    mockClinicalData = {
      isLoading: false,
      error: null,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    rerender()

    await waitFor(() => {
      expect(result.current.result).toEqual({ headline: 'pre-generated demo result' })
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('does not expose a generation slot while clinical data is background-fetching', async () => {
    mockPatientId = 'smart-patient-1'
    mockClinicalData = {
      isLoading: false,
      isFetching: true,
      error: null,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async () => ({ headline: 'full-data result' }))

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    expect(result.current.dataReady).toBe(false)
    expect(result.current.slotKey).toBe('')
    expect(run).not.toHaveBeenCalled()

    mockClinicalData = {
      isLoading: false,
      isFetching: false,
      error: null,
      encounters: [{ id: 'demo-encounter-1' }],
    }
    rerender()

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(result.current.dataReady).toBe(true)
    expect(result.current.slotKey).toContain('::ctx-')
  })

  it('never sends a partial clinical snapshot and forwards every settled resource to AI', async () => {
    mockPatientId = 'smart-patient-completeness'
    mockClinicalContext = 'PARTIAL INPUT — first page only'
    mockClinicalData = {
      isLoading: false,
      isFetching: true,
      error: null,
      encounters: [{ id: 'encounter-first' }],
      medications: [{ id: 'medication-first' }],
      diagnosticReports: [],
      observations: [],
    }
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (_input: unknown) => ({ headline: 'complete-data result' }))

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(result.current.isHydrated).toBe(true))
    await act(async () => result.current.generate())
    expect(result.current.dataReady).toBe(false)
    expect(result.current.slotKey).toBe('')
    expect(run).not.toHaveBeenCalled()

    mockClinicalContext = [
      'COMPLETE INPUT',
      'encounter-first',
      'encounter-last',
      'medication-first',
      'medication-last',
      'report-last',
      'observation-last',
      'FINAL-RESOURCE-MARKER',
    ].join('\n')
    mockClinicalData = {
      isLoading: false,
      isFetching: false,
      error: null,
      encounters: [
        { id: 'encounter-first' },
        { id: 'encounter-last' },
      ],
      medications: [
        { id: 'medication-first' },
        { id: 'medication-last' },
      ],
      diagnosticReports: [{
        id: 'report-last',
        status: 'final',
        category: [{ coding: [{ code: 'LAB' }] }],
        code: { text: 'Complete panel' },
        effectiveDateTime: '2026-08-18',
        result: [{ reference: 'Observation/observation-last' }],
      }],
      observations: [{
        id: 'observation-last',
        status: 'final',
        code: { text: 'Complete analyte' },
        effectiveDateTime: '2026-08-18',
        valueQuantity: { value: 42, unit: 'mg/dL' },
      }],
    }
    rerender()

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const input = run.mock.calls[0][0] as {
      clinicalContext: string
      clinicalData: {
        encounters?: Array<{ id?: string }>
        medications?: Array<{ id?: string }>
        diagnosticReports?: Array<{ id?: string }>
        observations?: Array<{ id?: string }>
      }
    }
    expect(input.clinicalContext).toContain('FINAL-RESOURCE-MARKER')
    expect(input.clinicalContext).not.toContain('PARTIAL INPUT')
    expect(input.clinicalData.encounters?.map((resource) => resource.id)).toEqual([
      'encounter-first',
      'encounter-last',
    ])
    expect(input.clinicalData.medications?.map((resource) => resource.id)).toEqual([
      'medication-first',
      'medication-last',
    ])
    expect(input.clinicalData.diagnosticReports?.map((resource) => resource.id)).toEqual([
      'report-last',
    ])
    expect(input.clinicalData.observations?.map((resource) => resource.id)).toEqual([
      'observation-last',
    ])
  })

  it('uses a new slot and does not reuse the old result when clinical input changes', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    const run = jest.fn(async (ctx: { clinicalContext: string }) => ({
      headline: `result for ${ctx.clinicalContext}`,
    }))

    const { result, rerender } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => {
      expect(result.current.result).toEqual({ headline: 'result for demo context' })
    })
    const firstSlot = result.current.slotKey

    mockClinicalContext = 'complete visits, reports, and medications'
    mockClinicalData = {
      ...mockClinicalData,
      encounters: [
        { id: 'demo-encounter-1' },
        { id: 'demo-encounter-2' },
      ],
    }
    rerender()

    await waitFor(() => {
      expect(result.current.result).toEqual({
        headline: 'result for complete visits, reports, and medications',
      })
    })
    expect(result.current.slotKey).not.toBe(firstSlot)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('auto-runs again when the same patient and content are re-imported', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    let runCount = 0
    const run = jest.fn(async () => ({ headline: `result ${++runCount}` }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.result).toEqual({ headline: 'result 1' }))

    act(() => {
      window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT))
      window.dispatchEvent(new Event(BUNDLE_CHANGE_SETTLED_EVENT))
    })

    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.result).toEqual({ headline: 'result 2' }))
  })

  it('drops a late reply from the Bundle that was replaced mid-generation', async () => {
    mockPatientId = 'smart-patient-1'
    const store = createAiResultStore<{ headline: string }>()
    let resolveRun!: (value: { headline: string }) => void
    const run = jest.fn(() => new Promise<{ headline: string }>((resolve) => {
      resolveRun = resolve
    }))

    const { result } = renderHook(() => useAiSlotGeneration({
      defaultModelId: 'gemini-3.1-flash-lite',
      selectedModelId: 'gemini-3.1-flash-lite',
      autoRunEnabled: true,
      requireDataReadyToGenerate: true,
      store,
      cacheKeyFor: (slotKey) => `test:${slotKey}`,
      cacheMaxAgeMs: 60_000,
      run,
    }))

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    act(() => window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT)))
    await act(async () => { resolveRun({ headline: 'stale patient result' }) })

    expect(result.current.result).toBeUndefined()
    expect(store.getState().byKey).toEqual({})
    expect(store.getState().running).toEqual({})
  })
})
