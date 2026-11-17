// Shared factory for the persisted per-feature AI preference stores (auto-run
// toggle + model pick, INDEPENDENT of the chat/insights model). Each feature
// keeps its historical storage name AND field names (autoGenerate vs autoScan)
// so already-persisted user preferences stay readable; the factory only owns
// the persist wiring and the model-id rehydration validation.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isSelectableModelId } from '@/src/shared/constants/ai-models.constants'

export function createModelPrefsStore<S extends { modelId: string }>(config: {
  /** localStorage key — MUST NOT change, or existing user prefs are lost. */
  storageName: string
  /** Fallback when the persisted model id no longer exists in the lineup. */
  defaultModelId: string
  initializer: (set: (partial: Partial<S>) => void) => S
}) {
  const { storageName, defaultModelId, initializer } = config
  return create<S>()(
    persist(
      (set) => initializer(set as (partial: Partial<S>) => void),
      {
        name: storageName,
        // The model lineup changes between releases — a persisted id that no
        // longer exists falls back to the default instead of dead-ending.
        onRehydrateStorage: () => (state) => {
          if (state && !isSelectableModelId(state.modelId)) state.modelId = defaultModelId
        },
      },
    ),
  )
}
