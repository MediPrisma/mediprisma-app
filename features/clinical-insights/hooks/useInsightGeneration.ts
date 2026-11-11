// Custom Hook: Insight Generation State Management
// Business logic delegated to Use Case
import { createModelExecution, modelExecutionLabel } from '@/src/shared/utils/ai-model-execution'
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { getUserErrorMessage } from '@/src/core/errors'
import { useGenerateInsight } from '@/src/application/hooks/clinical-insights/use-generate-insight.hook'
import { useInsightResponsesStore } from './useInsightResponsesStore'
import type { ResponseEntry, PanelStatus } from '../types'
import { preflightContextWarning } from '@/src/shared/utils/context-budget'
import { useLanguage } from '@/src/application/providers/language.provider'
import {
  formatClinicalContextAdaptationNotice,
  type ClinicalContextAdaptation,
} from '@/src/core/utils/adaptive-clinical-context.utils'
import { isCustomOpenAiModelId } from '@/src/shared/constants/ai-models.constants'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
import type {
  InsightLanguagePolicy,
  InsightOutputFormat,
} from '@/src/shared/constants/clinical-insights.constants'
import { LOCAL_INSIGHT_MAX_OUTPUT_TOKENS } from '@/src/shared/constants/clinical-insights.constants'
import { isProgressiveAutoSummaryBlocked, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'

interface Panel {
  id: string
  title: string
  prompt: string
  outputFormat: InsightOutputFormat
  languagePolicy: InsightLanguagePolicy
}

interface UseInsightGenerationProps {
  panels: Panel[]
  prompts: Record<string, string>
  context: string
  piiLiterals: string[]
  model: string
  modelName: string
  contextLimit: number
  contextAdaptation: ClinicalContextAdaptation | null
  inputSignature: string
}

interface UseInsightGenerationReturn {
  runPanel: (panelId: string, options?: { force?: boolean }) => Promise<void>
  runPanels: (panelIds: string[], options?: { force?: boolean; automatic?: boolean }) => Promise<void>
  stopPanel: (panelId: string) => void
  stopAll: () => void
  responses: Record<string, ResponseEntry>
  panelStatus: Record<string, PanelStatus>
  setResponses: React.Dispatch<React.SetStateAction<Record<string, ResponseEntry>>>
}

export function useInsightGeneration({
  panels,
  prompts,
  context,
  piiLiterals,
  model,
  modelName,
  contextLimit,
  contextAdaptation,
  inputSignature,
}: UseInsightGenerationProps): UseInsightGenerationReturn {
  const ai = useUnifiedAi()
  const { locale } = useLanguage()
  const generateInsight = useGenerateInsight()
  // Responses/status live in a module-level store so they survive the panel
  // unmounting on tab switches (see useInsightResponsesStore).
  const responses = useInsightResponsesStore((s) => s.responses)
  const setResponses = useInsightResponsesStore((s) => s.setResponses)
  const panelStatus = useInsightResponsesStore((s) => s.panelStatus)
  const setPanelStatus = useInsightResponsesStore((s) => s.setPanelStatus)
  const completeBatch = useInsightResponsesStore((s) => s.completeBatch)
  const runIdRef = useRef(0)
  // Which run owns each module right now. Modules are independent: starting or
  // stopping one never touches another module's request. A run that no longer
  // owns a module may still finish at the transport layer, but it can never
  // publish stale data for it.
  const panelOwnersRef = useRef(new Map<string, number>())

  const runPanels = useCallback(
    async (panelIds: string[], options?: { force?: boolean; automatic?: boolean }) => {
      if (options?.automatic && isProgressiveAutoSummaryBlocked()) return
      const force = options?.force ?? false
      const uniquePanelIds = [...new Set(panelIds)]
      const prepared = uniquePanelIds.flatMap((panelId) => {
        const panel = panels.find((item) => item.id === panelId)
        if (!panel) return []

        // Read through the store so this callback does not depend on every
        // completed result. Edited modules remain protected unless forced.
        const responseEntry = useInsightResponsesStore.getState().responses[panelId]
        if (!force && responseEntry?.isEdited) return []

        const input = {
          prompt: prompts[panelId] ?? panel.prompt,
          clinicalContext: context,
          piiLiterals,
          modelId: model,
          locale: locale === 'zh-TW' ? 'zh-TW' as const : 'en' as const,
          outputFormat: panel.outputFormat,
          languagePolicy: panel.languagePolicy,
        }
        const validation = generateInsight.validate(input)
        if (!validation.valid) {
          console.warn(`Validation failed: ${validation.error}`)
          return []
        }
        return [{ panel, messages: generateInsight.buildMessages(input) }]
      })
      if (prepared.length === 0) return
      if (contextAdaptation) {
        toast.info(
          formatClinicalContextAdaptationNotice(contextAdaptation, locale),
          {
            id: `clinical-context-fit:insights:${inputSignature}:${contextAdaptation.tier}`,
          },
        )
      }

      // The responses store + ai instance survive patient switches (module
      // store, forceMounted tab), but panel ids are stable across patients — a
      // request still running when the patient changes could write the OLD
      // patient's text into the NEW patient's panel (and it would then be
      // persisted into the new patient's cache). Remember who this run belongs
      // to and drop every write once the owner changes.
      const owner = useInsightResponsesStore.getState().ownerPatientId
      const ownerChanged = () => useInsightResponsesStore.getState().ownerPatientId !== owner
      const runId = ++runIdRef.current
      const activePanelIds = prepared.map(({ panel }) => panel.id)
      const owners = panelOwnersRef.current
      const operationKey = (panelId: string) => `clinical-insight:${owner}:${panelId}`
      const ownedByThisRun = (panelId: string) => owners.get(panelId) === runId
      const owns = (panelId: string) => ownedByThisRun(panelId) && !ownerChanged()
      if (owners.size === 0) {
        useAiExecutionDiagnosticsStore.getState().clearFeature('clinical-insights')
      }
      // A new run replaces only an earlier run of the SAME module. Modules the
      // user started separately keep generating side by side.
      for (const panelId of activePanelIds) {
        if (owners.has(panelId)) ai.stop(operationKey(panelId))
        owners.set(panelId, runId)
      }

      // Keep any previous complete result in place while regenerating. For a
      // first run the cards show only a loading state. No partial response is
      // written at any point.
      setPanelStatus((prev) => ({
        ...prev,
        ...Object.fromEntries(
          activePanelIds.map((panelId) => [panelId, { isLoading: true, error: null }]),
        ),
      }))

      const entries: Record<string, ResponseEntry> = {}
      const errors: Record<string, Error> = {}
      let inFlightPanelId: string | null = null

      const unsubscribe = options?.automatic ? useProgressiveImportStore.subscribe(() => {
        if (!isProgressiveAutoSummaryBlocked()) return
        const mine = activePanelIds.filter(ownedByThisRun)
        if (mine.length === 0) return
        for (const panelId of mine) owners.delete(panelId)
        if (inFlightPanelId && mine.includes(inFlightPanelId)) ai.stop(operationKey(inFlightPanelId))
        setPanelStatus(prev => ({ ...prev, ...Object.fromEntries(mine.map(id => [id, { isLoading: false, error: null }])) }))
      }) : undefined
      try {
        // Keep the calls of ONE batch sequential to avoid a burst of
        // simultaneous model requests, but stage every completed result
        // locally. completeBatch publishes the whole set through one store
        // update only after the final call settles.
        for (const { panel, messages } of prepared) {
          if (!owns(panel.id)) continue
          inFlightPanelId = panel.id
          const startedAt = Date.now()
          const activeGenerationId = `${runId}:${panel.id}`
          setPanelStatus((prev) => ({
            ...prev,
            [panel.id]: {
              isLoading: true,
              error: null,
              activeGeneration: {
                id: activeGenerationId,
                modelName,
                startedAt,
                isLocalModel: isCustomOpenAiModelId(model),
              },
            },
          }))
          try {
            const overflow = preflightContextWarning(
              messages.map((message) => message.content).join('\n\n'),
              model,
              locale,
              { selectedContext: context, contextLimit },
            )
            if (overflow) throw new Error(overflow)
            let modelExecution = createModelExecution(model, model, modelName)
            let outputTruncated = false
            const fullText = await ai.query(messages, {
              onModelExecution: (execution) => { modelExecution = { ...modelExecution, ...execution } },
              onOutputTruncated: (truncated) => { outputTruncated = truncated },
              modelId: model,
              // Apply the documented local-summary output guard. The 262K
              // context window is input capacity, not a safe output budget;
              // frontier-provider defaults remain unchanged.
              ...(isCustomOpenAiModelId(model)
                ? {
                  temperature: 0,
                  maxTokens: LOCAL_INSIGHT_MAX_OUTPUT_TOKENS,
                  allowTruncatedOutput: true,
                  reasoningEffort: 'low' as const,
                }
                : {}),
              operationKey: operationKey(panel.id),
              diagnosticFeature: 'clinical-insights',
              collectorContext: { template: { id: panel.id, title: panel.title } },
            })
            if (!owns(panel.id)) continue
            const generatedAt = Date.now()
            entries[panel.id] = {
              text: fullText,
              isEdited: false,
              metadata: {
                source: 'live',
                ...generateInsight.buildMetadata(model),
                modelName: modelExecutionLabel(modelExecution),
                modelExecution,
                ...(outputTruncated ? { outputTruncated: true } : {}),
                generatedAt,
                durationMs: Math.max(0, generatedAt - startedAt),
                outputFormat: panel.outputFormat,
                languagePolicy: panel.languagePolicy,
              },
            }
          } catch (error) {
            if (!owns(panel.id)) continue
            const errorMessage = getUserErrorMessage(error)
            console.error(`Failed to generate custom summary for ${panel.title}:`, errorMessage, error)
            // No text is available for this failure; keep its original type for
            // the localized error message instead of publishing an empty result.
            errors[panel.id] = error instanceof Error ? error : new Error(errorMessage)
          } finally {
            inFlightPanelId = null
            if (owns(panel.id)) {
              setPanelStatus((prev) => {
                const status = prev[panel.id]
                if (status?.activeGeneration?.id !== activeGenerationId) return prev
                return {
                  ...prev,
                  [panel.id]: { isLoading: true, error: null },
                }
              })
            }
          }
        }

        const finished = activePanelIds.filter(owns)
        if (finished.length > 0) completeBatch(finished, entries, errors)
      } finally {
        unsubscribe?.()
        for (const panelId of activePanelIds) {
          if (ownedByThisRun(panelId)) owners.delete(panelId)
        }
      }
    },
    [ai, completeBatch, context, contextAdaptation, contextLimit, generateInsight, inputSignature, locale, model, modelName, panels, piiLiterals, prompts, setPanelStatus],
  )

  const runPanel = useCallback(
    (panelId: string, options?: { force?: boolean }) => runPanels([panelId], options),
    [runPanels],
  )

  const stopPanel = useCallback(
    (panelId: string) => {
      // Stop only this module: drop its pending write, abort its request and
      // clear its loading indicator. Other modules keep generating.
      panelOwnersRef.current.delete(panelId)
      const owner = useInsightResponsesStore.getState().ownerPatientId
      ai.stop(`clinical-insight:${owner}:${panelId}`)
      setPanelStatus((prev) => (
        prev[panelId]?.isLoading
          ? { ...prev, [panelId]: { isLoading: false, error: null } }
          : prev
      ))
    },
    [ai, setPanelStatus]
  )

  // Abort every in-flight request (patient switch: its output must not reach
  // the next patient's panels, and the tokens are wasted anyway).
  const stopAll = useCallback(() => {
    panelOwnersRef.current.clear()
    ai.stop()
  }, [ai])

  return { runPanel, runPanels, stopPanel, stopAll, responses, panelStatus, setResponses }
}
