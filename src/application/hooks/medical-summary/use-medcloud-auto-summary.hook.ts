'use client'

import { useEffect, useRef, useState } from 'react'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { isProgressiveSummaryRequestCurrent, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { useSummaryVersionsStore, summaryVersionViewKey } from './summary-versions.store'

interface UseMedcloudAutoSummaryOptions {
  authLoading: boolean
  hasPatient: boolean
  summaryModelId: string | null
  dataReady: boolean
  isGenerating: boolean
  isRestoring: boolean
  generationSlotKey: string
  modelId: string
  generate: (signal?: AbortSignal) => Promise<void>
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
  const activeLaunches = useRef(new Set<() => void>())
  const [launchRunning, setLaunchRunning] = useState(false)
  useEffect(() => {
    const launches = activeLaunches.current
    return () => { for (const dispose of launches) dispose() }
  }, [])

  useEffect(() => {
    if (
      !request ||
      launchRunning ||
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
      if (request.progressiveRunId && useSummaryVersionsStore.getState().automaticStoppedRunId === request.progressiveRunId) {
        claimSummary(request.messageId)
        return
      }
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
      if (!request.progressiveRunId) {
        void generate().catch(() => undefined)
        return
      }
      const controller = new AbortController()
      const launchViewKey = summaryVersionViewKey(request.progressiveRunId, generationSlotKey)
      useSummaryVersionsStore.setState({ launchViewKey })
      setLaunchRunning(true)
      const unsubscribe = useProgressiveImportStore.subscribe(() => {
        const current = useProgressiveImportStore.getState().current
        // A validated supplement changes the import id, but the already-started
        // request still owns its immutable cloud snapshot for this same run.
        if (!isProgressiveSummaryRequestCurrent({ ...request,
          progressiveImportId: current && current.runId === request.progressiveRunId ? current.importId : request.progressiveImportId,
        }, LocalBundleService.getActiveImportId())) controller.abort()
      })
      const dispose = () => { unsubscribe(); controller.abort(); activeLaunches.current.delete(dispose) }
      activeLaunches.current.add(dispose)
      void generate(controller.signal).catch(() => undefined).finally(() => {
        if (useSummaryVersionsStore.getState().launchViewKey === launchViewKey) useSummaryVersionsStore.setState({ launchViewKey: null })
        unsubscribe()
        activeLaunches.current.delete(dispose)
        setLaunchRunning(false)
      })
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
    launchRunning,
  ])
}
