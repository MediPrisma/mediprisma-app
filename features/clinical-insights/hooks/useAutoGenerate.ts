// Custom Hook: Auto-generate Insights
import { useEffect, useRef } from 'react'
import { getUserErrorMessage } from '@/src/core/errors'
import { isAutoRunEligibleModel } from '@/src/shared/constants/ai-models.constants'
import { MAX_AUTO_INSIGHT_MODULES } from '@/src/shared/constants/clinical-insights.constants'
import { isProgressiveAutoSummaryBlocked, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'

interface Panel {
  id: string
  prompt?: string
  showInSummary?: boolean
  autoGenerate?: boolean
}

interface UseAutoGenerateProps {
  panels: Panel[]
  canGenerate: boolean
  context: string
  modelId: string
  runPanels: (panelIds: string[], options?: { automatic?: boolean }) => Promise<void>
  /** Current responses — a panel that already has output (this session OR
   *  restored from cache on reload) is NOT auto-run again. */
  responses?: Record<string, { text?: string } | undefined>
  panelStatus?: Record<string, { error?: unknown } | undefined>
  /** Changes when anonymous/sign-in/own-key access changes. A failed run is
   *  eligible once in the new access context, but never loops within one. */
  runScope: string
}

export function selectAutoGeneratePanelIds({
  panels,
  modelId,
  autoRunPanels,
  responses,
  failedPanelIds,
  limit = MAX_AUTO_INSIGHT_MODULES,
}: {
  panels: Panel[]
  modelId: string
  autoRunPanels: Set<string>
  responses?: Record<string, { text?: string } | undefined>
  failedPanelIds?: ReadonlySet<string>
  limit?: number
}): string[] {
  if (!isAutoRunEligibleModel(modelId)) return []
  return panels
    .filter((panel) => (
      panel.showInSummary === true &&
      panel.autoGenerate === true &&
      !autoRunPanels.has(panel.id) &&
      (!responses?.[panel.id]?.text?.trim() || failedPanelIds?.has(panel.id) === true)
    ))
    .slice(0, limit)
    .map((panel) => panel.id)
}

export function useAutoGenerate({
  panels,
  canGenerate,
  context,
  modelId,
  runPanels,
  responses,
  panelStatus,
  runScope,
}: UseAutoGenerateProps) {
  const autoRunPanels = useRef<Set<string>>(new Set())
  const ownerContext = useRef("")
  const progressiveBlocked = useProgressiveImportStore(() => isProgressiveAutoSummaryBlocked())

  // Auto-run panels with autoGenerate enabled when conditions are met
  useEffect(() => {
    if (progressiveBlocked || !canGenerate || !context.trim() || panels.length === 0) {
      return
    }

    const runIdentity = `${context}\u0000${modelId}\u0000${runScope}\u0000${panels.map((panel) => `${panel.id}:${panel.prompt ?? ""}`).join("|")}`
    if (ownerContext.current !== runIdentity) {
      ownerContext.current = runIdentity
      autoRunPanels.current.clear()
    }
    const failedPanelIds = new Set(
      panels.filter((panel) => panelStatus?.[panel.id]?.error).map((panel) => panel.id),
    )
    const panelIds = selectAutoGeneratePanelIds({
      panels,
      modelId,
      autoRunPanels: autoRunPanels.current,
      responses,
      failedPanelIds,
    })
    if (panelIds.length === 0) {
      return
    }

    // Mark these panels as auto-run
    panelIds.forEach((panelId) => autoRunPanels.current.add(panelId))

    // The generation hook keeps requests sequential internally, then publishes
    // every completed module in one atomic batch after all calls settle.
    const autoRun = async () => runPanels(panelIds, { automatic: true })

    autoRun().catch((error) => {
      const errorMessage = getUserErrorMessage(error)
      console.error("Failed to auto-run clinical insights:", errorMessage, error)
      // Remove failed panels from the set so they can be retried
      panelIds.forEach((panelId) => autoRunPanels.current.delete(panelId))
    })
  }, [progressiveBlocked, canGenerate, context, modelId, panelStatus, panels, runPanels, responses, runScope])

  return { autoRunPanels }
}
