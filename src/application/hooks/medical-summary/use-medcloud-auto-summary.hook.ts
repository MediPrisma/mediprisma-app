'use client'

import { useEffect } from 'react'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { isProgressiveSummaryRequestCurrent } from '@/src/application/stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

interface UseMedcloudAutoSummaryOptions {
  authLoading: boolean
  hasPatient: boolean
  summaryModelId: string | null
  dataReady: boolean
  isGenerating: boolean
  isRestoring: boolean
  generationSlotKey: string
  modelId: string
  generate: () => Promise<void>
}

/** Claim and run each successfully received Extension launch exactly once.
 * Keeping the request in a small in-memory store lets it safely arrive before
 * the lazy Medical Summary feature or the complete FHIR dataset is ready. */
export function useMedcloudAutoSummary({
  authLoading,
  hasPatient,
  summaryModelId,
  dataReady,
  isGenerating,
  isRestoring,
  generationSlotKey,
  modelId,
  generate,
}: UseMedcloudAutoSummaryOptions): void {
  const request = useMedcloudLaunchStore((state) => state.pendingSummary)
  const claimSummary = useMedcloudLaunchStore((state) => state.claimSummary)

  useEffect(() => {
    if (
      !request ||
      authLoading ||
      !hasPatient ||
      !dataReady ||
      isRestoring ||
      !generationSlotKey ||
      modelId !== request.modelId
    ) return

    // The small-record adaptive default runs in a sibling passive effect. On a
    // pristine first launch it can switch 初診 -> 全部資料 in the same effect
    // flush that made this request eligible. That changes generationSlotKey.
    // Defer one task so React can publish the final data scope first; a slot
    // change cleans up this timer and leaves the launch request pending for the
    // replacement slot instead of consuming it for a result the UI no longer
    // presents.
    const timer = window.setTimeout(() => {
      if (!isProgressiveSummaryRequestCurrent(request, LocalBundleService.getActiveImportId())) {
        claimSummary(request.messageId)
        return
      }
      if (summaryModelId === request.modelId) {
        claimSummary(request.messageId)
        return
      }
      if (isGenerating) return
      if (!claimSummary(request.messageId)) return
      void generate().catch(() => undefined)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    claimSummary,
    authLoading,
    dataReady,
    generate,
    generationSlotKey,
    hasPatient,
    isGenerating,
    isRestoring,
    modelId,
    request,
    summaryModelId,
  ])
}
