import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useModelSelection } from '@/src/application/hooks/useModelSelection'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import {
  CUSTOM_OPENAI_MODEL_ID,
  customOpenAiModelIdForProfile,
} from '@/src/shared/constants/ai-models.constants'

const wrapper = ({ children }: { children: ReactNode }) => (
  <LanguageProvider>{children}</LanguageProvider>
)

const profile = (
  profileId: string,
  baseUrl: string,
  modelId: string,
  enabled = true,
) => ({
  profileId,
  enabled,
  baseUrl,
  modelId,
  apiKey: null,
  transport: 'direct' as const,
  contextWindowTokens: 32768,
  contextWindowSource: 'manual' as const,
})

describe('useModelSelection', () => {
  it('selects the hospital model without a personal key or Firebase chat proxy', () => {
    const previousChannel = process.env.NEXT_PUBLIC_DEPLOY_CHANNEL
    const previousOrigin = process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
    process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = 'staging'
    process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = 'https://ai-vghtpe.mediprisma.tw'
    window.history.replaceState({}, '', '/app-staging/?site=vghtpe')
    try {
      const setModel = jest.fn()
      const { result } = renderHook(() => useModelSelection(null, null, null, 'gemini-3-flash-preview', setModel), { wrapper })
      act(() => result.current.handleSelectModel('gpt-6-luna'))
      expect(setModel).toHaveBeenCalledWith('gpt-6-luna')
      window.history.replaceState({}, '', '/app/?site=vghtpe')
      setModel.mockClear()
      act(() => result.current.handleSelectModel('gpt-6-luna'))
      expect(setModel).not.toHaveBeenCalled()
    } finally {
      if (previousChannel === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_CHANNEL
      else process.env.NEXT_PUBLIC_DEPLOY_CHANNEL = previousChannel
      if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN
      else process.env.NEXT_PUBLIC_INTRANET_AI_ORIGIN = previousOrigin
      window.history.replaceState({}, '', '/')
    }
  })
  beforeEach(() => {
    localStorage.clear()
    useAiConfigStore.setState({
      credentialsHydrating: false,
      openAiCompatibleProfiles: [],
    })
  })

  it('lists every enabled profile and disambiguates duplicate upstream models by host', () => {
    useAiConfigStore.setState({
      openAiCompatibleProfiles: [
        profile('legacy', 'https://hospital-a.example/v1', 'qwen3:8b'),
        profile('hospital-b', 'https://hospital-b.example/v1', 'qwen3:8b'),
        profile('disabled', 'https://hospital-c.example/v1', 'llama3:8b', false),
      ],
    })
    const setModel = jest.fn()
    const { result } = renderHook(
      () => useModelSelection(null, null, null, CUSTOM_OPENAI_MODEL_ID, setModel),
      { wrapper },
    )

    expect(result.current.customModels).toEqual([
      expect.objectContaining({
        id: CUSTOM_OPENAI_MODEL_ID,
        label: 'qwen3:8b · hospital-a.example',
        isLocked: false,
      }),
      expect.objectContaining({
        id: customOpenAiModelIdForProfile('hospital-b'),
        label: 'qwen3:8b · hospital-b.example',
        isLocked: false,
      }),
    ])

    act(() => result.current.handleSelectModel(
      customOpenAiModelIdForProfile('hospital-b'),
    ))
    expect(setModel).toHaveBeenCalledWith(
      customOpenAiModelIdForProfile('hospital-b'),
    )
  })

  it('keeps one configure entry when no enabled profile is usable', () => {
    useAiConfigStore.setState({
      openAiCompatibleProfiles: [
        profile('disabled', 'https://hospital.example/v1', 'qwen3:8b', false),
      ],
    })
    const { result } = renderHook(
      () => useModelSelection(null, null, null, CUSTOM_OPENAI_MODEL_ID, jest.fn()),
      { wrapper },
    )

    expect(result.current.customModels).toEqual([
      expect.objectContaining({
        id: CUSTOM_OPENAI_MODEL_ID,
        isLocked: true,
        configureInSettings: true,
      }),
    ])
  })

  it('uses endpoint paths and stable ordinals when duplicate models share a host', () => {
    useAiConfigStore.setState({
      openAiCompatibleProfiles: [
        profile('tenant-a', 'https://gateway.example/tenant-a/v1', 'MODEL_NAME'),
        profile('tenant-b', 'https://gateway.example/tenant-b/v1', 'MODEL_NAME'),
        profile('tenant-b-2', 'https://gateway.example/tenant-b/v1', 'MODEL_NAME'),
      ],
    })
    const { result } = renderHook(
      () => useModelSelection(null, null, null, CUSTOM_OPENAI_MODEL_ID, jest.fn()),
      { wrapper },
    )

    expect(result.current.customModels.map((entry) => entry.label)).toEqual([
      'MODEL_NAME · gateway.example/tenant-a/v1',
      'MODEL_NAME · gateway.example/tenant-b/v1 #1',
      'MODEL_NAME · gateway.example/tenant-b/v1 #2',
    ])
  })

  it('allows Claude Fable 5 to be selected when a personal Claude key is present', () => {
    const setModel = jest.fn()
    const { result } = renderHook(
      () => useModelSelection(
        null,
        null,
        'test-claude-key',
        'claude-fable-5',
        setModel,
      ),
      { wrapper },
    )

    expect(result.current.claudeModels.find(
      (entry) => entry.id === 'claude-fable-5',
    )).toMatchObject({
      label: 'Claude Fable 5',
      isLocked: false,
    })

    act(() => result.current.handleSelectModel('claude-fable-5'))
    expect(setModel).toHaveBeenCalledWith('claude-fable-5')
  })

  it('keeps Nano and Luna unlocked without an OpenAI key and unlocks every GPT-5.6 model with one', () => {
    const { result, rerender } = renderHook(
      ({ apiKey }: { apiKey: string | null }) => useModelSelection(
        apiKey,
        null,
        null,
        'gpt-5.4-nano',
        jest.fn(),
      ),
      { wrapper, initialProps: { apiKey: null as string | null } },
    )

    expect(result.current.gptModels.map(({ id, isLocked }) => ({ id, isLocked }))).toEqual([
      { id: 'gpt-5.4-nano', isLocked: false },
      { id: 'gpt-5.6-luna', isLocked: false },
      { id: 'gpt-5.6-terra', isLocked: true },
      { id: 'gpt-5.6-sol', isLocked: true },
    ])

    rerender({ apiKey: 'test-openai-key' })
    expect(result.current.gptModels.every((entry) => !entry.isLocked)).toBe(true)
  })

  it('reads localized model descriptions from the canonical manifest', () => {
    const { result } = renderHook(
      () => useModelSelection(null, null, null, 'gpt-5.4-nano', jest.fn()),
      { wrapper },
    )

    expect(result.current.gptModels.find(
      (entry) => entry.id === 'gpt-5.4-nano',
    )?.description).toBe('極速回應，經濟實惠')
  })
})
