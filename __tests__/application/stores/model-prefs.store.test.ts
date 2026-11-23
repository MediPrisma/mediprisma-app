/**
 * model-prefs.store — per-feature model preferences (chat / insights).
 *
 * The regression that motivated this store: the old global `model` persisted
 * in localStorage while API keys default to sessionStorage, so a premium pick
 * outlived its key across browser sessions and the UI kept DISPLAYING the
 * premium model while calls silently ran the free fallback. The store keeps
 * the raw pick, and `gateModelForKeys` (used by useEffectiveModel for both
 * display and execution) lands stranded picks on the consumer's default.
 */
import {
  DEFAULT_MODEL_ID,
  gateModelForKeys,
} from '@/src/shared/constants/ai-models.constants'
import { act, renderHook } from '@testing-library/react'
import {
  useModelPref,
  useModelPrefsStore,
  useSetModelFor,
} from '@/src/application/stores/model-prefs.store'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID } from '@/src/application/launch/medcloud-launch-context'

const loadStore = () => {
  let mod!: typeof import('@/src/application/stores/model-prefs.store')
  jest.isolateModules(() => {
    mod = jest.requireActual('@/src/application/stores/model-prefs.store')
  })
  return mod
}

describe('model-prefs.store', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('defaults both consumers to the free default model', () => {
    const { useModelPrefsStore } = loadStore()
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: DEFAULT_MODEL_ID,
      insights: DEFAULT_MODEL_ID,
    })
  })

  it('setModelFor updates only the given consumer', () => {
    const { useModelPrefsStore } = loadStore()
    useModelPrefsStore.getState().setModelFor('insights', 'gemini-3.1-flash-lite')

    const { prefs } = useModelPrefsStore.getState()
    expect(prefs.insights).toBe('gemini-3.1-flash-lite')
    expect(prefs.chat).toBe(DEFAULT_MODEL_ID)
  })

  it('seeds both consumers from the legacy global model on first run', () => {
    localStorage.setItem(
      'ai-config-storage',
      JSON.stringify({ state: { model: 'claude-opus-5-5' }, version: 0 }),
    )
    const { useModelPrefsStore } = loadStore()
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: 'claude-opus-5-5',
      insights: 'claude-opus-5-5',
    })
  })

  it('ignores a legacy model id that no longer exists in the lineup', () => {
    localStorage.setItem(
      'ai-config-storage',
      JSON.stringify({ state: { model: 'gpt-4o-mini-retired' }, version: 0 }),
    )
    const { useModelPrefsStore } = loadStore()
    expect(useModelPrefsStore.getState().prefs.chat).toBe(DEFAULT_MODEL_ID)
  })

  it.each(['legacy', 'per-feature'])('migrates internal Nano %s preferences to the display/run defaults', (source) => {
    localStorage.setItem(source === 'legacy' ? 'ai-config-storage' : 'model-prefs', JSON.stringify({
      state: source === 'legacy' ? { model: 'gpt-5.4-nano' } : { prefs: { chat: 'gpt-5.4-nano', insights: 'gpt-5.4-nano' } },
      version: 0,
    }))
    const { useModelPrefsStore } = loadStore()
    expect(useModelPrefsStore.getState().prefs).toEqual({ chat: DEFAULT_MODEL_ID, insights: DEFAULT_MODEL_ID })
  })

  it('persisted prefs win over the legacy global model', () => {
    localStorage.setItem(
      'ai-config-storage',
      JSON.stringify({ state: { model: 'claude-opus-5-5' }, version: 0 }),
    )
    localStorage.setItem(
      'model-prefs',
      JSON.stringify({
        state: { prefs: { chat: 'gpt-6-luna', insights: 'gemini-3.1-flash-lite' } },
        version: 0,
      }),
    )
    const { useModelPrefsStore } = loadStore()
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: 'gpt-6-luna',
      insights: 'gemini-3.1-flash-lite',
    })
  })

  it('rehydrate replaces a retired GPT pick with the consumer default', () => {
    localStorage.setItem(
      'model-prefs',
      JSON.stringify({
        state: { prefs: { chat: 'gpt-5.5', insights: 'gpt-6-luna' } },
        version: 0,
      }),
    )
    const { useModelPrefsStore } = loadStore()
    const { prefs } = useModelPrefsStore.getState()
    expect(prefs.chat).toBe(DEFAULT_MODEL_ID)
    expect(prefs.insights).toBe('gpt-6-luna')
  })

  it('temporarily presents the Medcloud model without changing the saved preference', () => {
    act(() => {
      useModelPrefsStore.setState({
        prefs: { chat: 'gpt-5.4-nano', insights: 'gemini-3.1-flash-lite' },
      })
      useMedcloudLaunchStore.getState().clear()
    })
    const { result } = renderHook(() => useModelPref('chat'))
    expect(result.current).toBe('gpt-5.4-nano')

    act(() => useMedcloudLaunchStore.getState().setRuntimeModelId(
      VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    ))

    expect(result.current).toBe(VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID)
    expect(useModelPrefsStore.getState().prefs.chat).toBe('gpt-5.4-nano')

    act(() => useMedcloudLaunchStore.getState().clear())
    expect(result.current).toBe('gpt-5.4-nano')
  })

  it('releases the Medcloud override when the user explicitly selects a model', () => {
    act(() => {
      useModelPrefsStore.setState({
        prefs: { chat: 'gpt-5.4-nano', insights: 'gpt-5.4-nano' },
      })
      useMedcloudLaunchStore.getState().setRuntimeModelId(
        VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
      )
    })
    const { result } = renderHook(() => ({
      model: useModelPref('chat'),
      setModelFor: useSetModelFor(),
    }))
    expect(result.current.model).toBe(VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID)

    act(() => result.current.setModelFor('chat', 'gemini-3.1-flash-lite'))

    expect(result.current.model).toBe('gemini-3.1-flash-lite')
    expect(useMedcloudLaunchStore.getState().runtimeModelId).toBeNull()
    expect(useModelPrefsStore.getState().prefs.chat).toBe('gemini-3.1-flash-lite')
  })

  describe('effective model (the gate every display/run must use)', () => {
    const noKeys = { openAiKey: null, geminiKey: null, claudeKey: null }

    it('REGRESSION: a stranded premium pick runs (and shows) as the free default', () => {
      // Picked Opus while holding a Claude key; key died with the session.
      expect(gateModelForKeys('claude-opus-5-5', noKeys, DEFAULT_MODEL_ID)).toBe(DEFAULT_MODEL_ID)
    })

    it('a premium pick with its provider key present stays picked', () => {
      expect(
        gateModelForKeys('claude-opus-5-5', { ...noKeys, claudeKey: 'sk-ant-x' }, DEFAULT_MODEL_ID),
      ).toBe('claude-opus-5-5')
    })

    it("a key for a DIFFERENT provider does not keep a stranded pick alive", () => {
      expect(
        gateModelForKeys('claude-opus-5-5', { ...noKeys, geminiKey: 'AIza-x' }, DEFAULT_MODEL_ID),
      ).toBe(DEFAULT_MODEL_ID)
    })

    it('free models pass through untouched without any key', () => {
      expect(gateModelForKeys('gemini-3.1-flash-lite', noKeys, DEFAULT_MODEL_ID)).toBe(
        'gemini-3.1-flash-lite',
      )
    })
  })
})
