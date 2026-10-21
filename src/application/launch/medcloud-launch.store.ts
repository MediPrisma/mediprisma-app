import { create } from 'zustand'

export interface MedcloudSummaryRequest {
  /** Non-secret Extension delivery id. */
  messageId: string
  /** Exact model selected by the independent site-routing decision. */
  modelId: string
  /** Ownership of a queued progressive snapshot; absent for ordinary launches. */
  progressiveRunId?: string
  progressiveImportId?: string
}

interface MedcloudLaunchState {
  /** Page-local model override selected by a trusted launch. This must never
   * be persisted into the user's ordinary model preferences. */
  runtimeModelId: string | null
  setRuntimeModelId: (modelId: string | null) => void
  /** Request waiting for the Medical Summary feature to become data-ready.
   * The decrypted credential lives only in ai-config when the VGH site is
   * active and is never copied into this queue. */
  pendingSummary: MedcloudSummaryRequest | null
  queueSummary: (request: MedcloudSummaryRequest) => void
  claimSummary: (messageId: string) => boolean
  clear: () => void
}

export const useMedcloudLaunchStore = create<MedcloudLaunchState>((set, get) => ({
  runtimeModelId: null,
  setRuntimeModelId: (runtimeModelId) => set({ runtimeModelId }),
  pendingSummary: null,
  queueSummary: (request) => {
    if (!request.messageId || !request.modelId) return
    set({ pendingSummary: request })
  },
  claimSummary: (messageId) => {
    if (get().pendingSummary?.messageId !== messageId) return false
    set({ pendingSummary: null })
    return true
  },
  clear: () => set({ pendingSummary: null, runtimeModelId: null }),
}))
