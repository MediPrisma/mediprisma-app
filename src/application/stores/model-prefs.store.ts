/**
 * Per-feature Model Preferences (Zustand)
 *
 * Chat and Clinical Insights each remember their own model, picked in-panel
 * via the shared ModelPicker (medical-summary / safety-alerts keep their own
 * older stores). Replaces the single global `model` that used to live in
 * ai-config.store.
 *
 * The persisted value is the RAW pick — it may need a user key the browser no
 * longer holds (keys default to sessionStorage and die with the window).
 * Everything that runs or displays a model must therefore go through
 * `useEffectiveModel`, which applies the same key-gate as the stream adapter.
 * Keeping the raw pick means re-entering the key revives the premium choice.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCallback } from 'react'
import {
  DEFAULT_MODEL_ID,
  gateModelForAgentSupport,
  gateModelForKeys,
  isSelectableModelId,
} from '@/src/shared/constants/ai-models.constants'
import { useAllApiKeys } from './ai-config.store'
import {
  isOpenAiCompatibleRuntimeReady,
  resolveOpenAiCompatibleProfile,
} from '@/src/shared/utils/openai-compatible.utils'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'

export type ModelPrefConsumer = 'chat' | 'insights'

export const MODEL_PREF_DEFAULTS: Record<ModelPrefConsumer, string> = {
  chat: DEFAULT_MODEL_ID,
  insights: DEFAULT_MODEL_ID,
}

interface ModelPrefsState {
  prefs: Record<ModelPrefConsumer, string>
  setModelFor: (consumer: ModelPrefConsumer, id: string) => void
}

/** Legacy global model (ai-config.store used to persist one model for chat +
 *  insights, key 'ai-config-storage'). Used as the INITIAL state so an
 *  existing user's pick survives the split — persisted model-prefs (once any
 *  pick is made here) override it on rehydrate. Validated only for existence;
 *  key-gating stays a read-time concern (useEffectiveModel). */
function initialPrefs(): Record<ModelPrefConsumer, string> {
  if (typeof window === 'undefined') return { ...MODEL_PREF_DEFAULTS }
  try {
    const raw = window.localStorage.getItem('ai-config-storage')
    if (!raw) return { ...MODEL_PREF_DEFAULTS }
    const model = (JSON.parse(raw) as { state?: { model?: unknown } }).state?.model
    return typeof model === 'string' && isSelectableModelId(model)
      ? { chat: model, insights: model }
      : { ...MODEL_PREF_DEFAULTS }
  } catch {
    return { ...MODEL_PREF_DEFAULTS }
  }
}

export const useModelPrefsStore = create<ModelPrefsState>()(
  persist(
    (set) => ({
      prefs: initialPrefs(),
      setModelFor: (consumer, id) => {
        set((state) => ({ prefs: { ...state.prefs, [consumer]: id } }))
      },
    }),
    {
      name: 'model-prefs',
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // The lineup changes between releases — an id that no longer exists
        // (or a consumer added later, absent from persisted state) falls back
        // to that consumer's default instead of dead-ending.
        for (const consumer of Object.keys(MODEL_PREF_DEFAULTS) as ModelPrefConsumer[]) {
          if (!isSelectableModelId(state.prefs[consumer])) {
            state.prefs[consumer] = MODEL_PREF_DEFAULTS[consumer]
          }
        }
      },
    },
  ),
)

export const useModelPref = (consumer: ModelPrefConsumer) => {
  const persistedModelId = useModelPrefsStore((s) => s.prefs[consumer])
  const runtimeModelId = useMedcloudLaunchStore((s) => s.runtimeModelId)
  return runtimeModelId ?? persistedModelId
}

export const useSetModelFor = () => {
  const setModelFor = useModelPrefsStore((s) => s.setModelFor)
  return useCallback((consumer: ModelPrefConsumer, id: string) => {
    // A launch model is only the initial Medcloud choice. Once the user
    // explicitly picks a model, release that override so the picker and the
    // next request both use the newly saved selection immediately.
    useMedcloudLaunchStore.getState().setRuntimeModelId(null)
    setModelFor(consumer, id)
  }, [setModelFor])
}

/**
 * The model a call will ACTUALLY run on (and the only thing UI should
 * display): the raw pref key-gated exactly like the stream adapter gates it.
 * Covers session-expired keys — a stranded premium pick renders and runs as
 * the consumer's free default.
 */
export function useEffectiveModel(consumer: ModelPrefConsumer): string {
  const pref = useModelPref(consumer)
  const { apiKey, geminiKey, claudeKey, openAiCompatibleProfiles } = useAllApiKeys()
  const openAiCompatible = resolveOpenAiCompatibleProfile(
    pref,
    openAiCompatibleProfiles,
  )
  const keyGatedModel = gateModelForKeys(
    pref,
    {
      openAiKey: apiKey,
      geminiKey,
      claudeKey,
      customAvailable: isOpenAiCompatibleRuntimeReady(openAiCompatible),
    },
    MODEL_PREF_DEFAULTS[consumer],
  )
  return consumer === 'chat'
    ? gateModelForAgentSupport(keyGatedModel, MODEL_PREF_DEFAULTS.chat)
    : keyGatedModel
}
