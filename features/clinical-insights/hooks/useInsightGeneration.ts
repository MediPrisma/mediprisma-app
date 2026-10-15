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
import {
  buildIcdCodeReference,
  extractBilledIcd10Codes,
  templateRequestsIcd9,
} from '@/src/core/utils/icd-code-reference.utils'
import { loadIcdCrosswalk } from '@/src/infrastructure/terminology/icd-crosswalk.loader'

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
  runPanels: (panelIds: string[], options?: { force?: boolean }) => Promise<void>
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
  // Incremented for every new batch and cancellation. A superseded request may
  // still finish at the transport layer, but it can never publish stale data.
  const runIdRef = useRef(0)

  const runPanels = useCallback(
    async (panelIds: string[], options?: { force?: boolean }) => {
      const force = options?.force ?? false
      const uniquePanelIds = [...new Set(panelIds)]
      const selected = uniquePanelIds.flatMap((panelId) => {
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
        return [{ panel, input }]
      })
      if (selected.length === 0) return
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
      // Custom summaries are intentionally single-batch. Starting another run
      // cancels the prior transport and invalidates every pending write. The
      // run is claimed before anything is awaited, so a stop, a patient switch
      // or a newer batch during the first await is never overwritten by it.
      ai.stop()
      const runId = ++runIdRef.current
      const isStale = () => runIdRef.current !== runId || ownerChanged()
      const activePanelIds = selected.map(({ panel }) => panel.id)
      useAiExecutionDiagnosticsStore.getState().clearFeature('clinical-insights')

      // Keep any previous complete result in place while regenerating. For a
      // first run the cards show only a loading state. No partial response is
      // written at any point.
      setPanelStatus((prev) => ({
        ...Object.fromEntries(
          Object.entries(prev).map(([id, status]) => [
            id,
            status.isLoading ? { ...status, isLoading: false } : status,
          ]),
        ),
        ...Object.fromEntries(
          activePanelIds.map((panelId) => [panelId, { isLoading: true, error: null }]),
        ),
      }))

      // Local models given an ICD-9 template (HMC SOAP) but only ICD-10 billing
      // codes enumerate ICD-9 codes from memory until truncation. Translate
      // the billed codes instead; see icd-code-reference.utils.ts.
      let icdCodeReference = ''
      if (
        isCustomOpenAiModelId(model) &&
        selected.some(({ input }) => templateRequestsIcd9(input.prompt)) &&
        extractBilledIcd10Codes(context).size > 0
      ) {
        try {
          icdCodeReference = buildIcdCodeReference(context, await loadIcdCrosswalk())
        } catch (error) {
          console.warn('ICD code reference unavailable; generating without it.', error)
        }
        // The first use downloads the crosswalk. This run may have been
        // stopped, superseded or left behind by a patient switch meanwhile.
        if (isStale()) return
      }
      const prepared = selected.map(({ panel, input }) => ({
        panel,
        messages: generateInsight.buildMessages(
          icdCodeReference && templateRequestsIcd9(input.prompt) ? { ...input, icdCodeReference } : input,
        ),
      }))

      const entries: Record<string, ResponseEntry> = {}
      const errors: Record<string, Error> = {}

      // Keep calls sequential to avoid a burst of simultaneous model requests,
      // but stage every completed result locally. completeBatch publishes the
      // whole set through one store update only after the final call settles.
      for (const { panel, messages } of prepared) {
        if (isStale()) return
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
            operationKey: `clinical-insight:${owner}:${panel.id}`,
            diagnosticFeature: 'clinical-insights',
          })
          if (isStale()) return
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
          if (isStale()) return
          const errorMessage = getUserErrorMessage(error)
          console.error(`Failed to generate custom summary for ${panel.title}:`, errorMessage, error)
          // No text is available for this failure; keep its original type for
          // the localized error message instead of publishing an empty result.
          errors[panel.id] = error instanceof Error ? error : new Error(errorMessage)
        } finally {
          if (!isStale()) {
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

      if (isStale()) return
      completeBatch(activePanelIds, entries, errors)
    },
    [ai, completeBatch, context, contextAdaptation, contextLimit, generateInsight, inputSignature, locale, model, modelName, panels, piiLiterals, prompts, setPanelStatus],
  )

  const runPanel = useCallback(
    (panelId: string, options?: { force?: boolean }) => runPanels([panelId], options),
    [runPanels],
  )

  const stopPanel = useCallback(
    (_panelId: string) => {
      // Unified AI cancellation is batch-wide; invalidate every pending write
      // and clear every loading indicator together.
      runIdRef.current += 1
      ai.stop()
      setPanelStatus((prev) => Object.fromEntries(
        Object.entries(prev).map(([id, status]) => [
          id,
          status.isLoading ? { isLoading: false, error: null } : status,
        ]),
      ))
    },
    [ai, setPanelStatus]
  )

  // Abort every in-flight request (patient switch: its output must not reach
  // the next patient's panels, and the tokens are wasted anyway).
  const stopAll = useCallback(() => {
    runIdRef.current += 1
    ai.stop()
  }, [ai])

  return { runPanel, runPanels, stopPanel, stopAll, responses, panelStatus, setResponses }
}
