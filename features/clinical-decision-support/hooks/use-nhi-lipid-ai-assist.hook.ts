'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { beginCollectorObservation, collectorError } from '@/src/application/telemetry/collector'
import { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { useClinicalAiInput } from '@/src/application/hooks/ai-generation/use-clinical-ai-input.hook'
import { useAllApiKeys } from '@/src/application/stores/ai-config.store'
import {
  MODEL_PREF_DEFAULTS,
  useEffectiveModel,
  useModelPref,
  useSetModelFor,
} from '@/src/application/stores/model-prefs.store'
import { getUserErrorMessage } from '@/src/core/errors'
import { modelExecutionLabel } from '@/src/shared/utils/ai-model-execution'
import {
  modelContextLimit,
  modelDisplayLabel,
} from '@/src/shared/utils/model-access.utils'
import { resolveOpenAiCompatibleProfile } from '@/src/shared/utils/openai-compatible.utils'
import type { CdssCoverageCheck } from '../types'
import {
  buildNhiLipidAiMessages,
  NHI_LIPID_AI_PROMPT_VERSION,
  parseNhiLipidAiResponse,
  type NhiLipidAiDecision,
  type NhiLipidAiSuggestion,
} from '../ai/nhi-lipid-ai-assist'
import {
  useNhiLipidAiReview,
  useNhiLipidReviewStore,
  type NhiLipidAiRunMetadata,
} from '../stores/nhi-lipid-review.store'

export interface NhiLipidAiAssist {
  suggestions: Readonly<Record<string, NhiLipidAiSuggestion>>
  decisions: Readonly<Record<string, NhiLipidAiDecision>>
  isRunning: boolean
  isDataReady: boolean
  error: string | null
  lastCompleted?: NhiLipidAiRunMetadata
  latestAttempt?: NhiLipidAiRunMetadata
  modelId: string
  modelName: string
  /** Raw feature preference; the shared picker applies the same credential gate as runtime. */
  selectedModelId?: string
  fallbackModelId?: string
  selectModel?: (modelId: string) => void
  run: () => Promise<void>
  decide: (criterionId: string, decision: NhiLipidAiDecision) => void
}

let runSequence = 0

/**
 * Manual, patient-scoped AI extraction for NHI Table 1. Results intentionally
 * live only in the patient-scoped memory store: they are not browser-persisted,
 * never run on chart load, survive panel remounts, and clear on patient change.
 *
 * The visible AI action is the network entry point. The app's entry flow owns
 * disclosure of AI data use, so this review does not interrupt clinicians with
 * a second confirmation dialog.
 */
export function useNhiLipidAiAssist(input: {
  patientId?: string
  criteria: readonly CdssCoverageCheck[]
  locale: string
}): NhiLipidAiAssist {
  const selectedModelId = useModelPref('insights')
  const setModelFor = useSetModelFor()
  const modelId = useEffectiveModel('insights')
  const { openAiCompatibleProfiles } = useAllApiKeys()
  const openAiCompatible = useMemo(
    () => resolveOpenAiCompatibleProfile(modelId, openAiCompatibleProfiles),
    [modelId, openAiCompatibleProfiles],
  )
  const contextLimit = useMemo(
    () => modelContextLimit(modelId, openAiCompatible),
    [modelId, openAiCompatible],
  )
  const modelName = useMemo(
    () => modelDisplayLabel(modelId, openAiCompatible),
    [modelId, openAiCompatible],
  )
  const selectModel = useCallback(
    (nextModelId: string) => setModelFor('insights', nextModelId),
    [setModelFor],
  )
  // Leave headroom for the criteria, source catalog, JSON reply and provider
  // envelope. The shared input hook progressively reduces large records rather
  // than silently cutting a note or a laboratory series in half.
  const clinicalInput = useClinicalAiInput(contextLimit, 'nhiLipid', 0.62)
  const ai = useUnifiedAi()
  const stopAi = ai.stop
  const review = useNhiLipidAiReview(input.patientId)
  const operationKey = `nhi-lipid-ai:${input.patientId ?? 'none'}`
  const currentScopeRef = useRef({
    patientId: input.patientId,
    inputSignature: clinicalInput.inputSignature,
    sourceScopeSignature: clinicalInput.sourceScopeSignature,
  })
  useEffect(() => {
    currentScopeRef.current = {
      patientId: input.patientId,
      inputSignature: clinicalInput.inputSignature,
      sourceScopeSignature: clinicalInput.sourceScopeSignature,
    }
  }, [
    clinicalInput.inputSignature,
    clinicalInput.sourceScopeSignature,
    input.patientId,
  ])

  const isDataReady = Boolean(
    input.patientId
      && clinicalInput.patientId === input.patientId
      && clinicalInput.dataReady
      && clinicalInput.clinicalContext.trim()
      && clinicalInput.inputSignature
      && clinicalInput.sourceScopeSignature,
  )

  useEffect(() => {
    if (!input.patientId || !clinicalInput.dataReady) return
    useNhiLipidReviewStore.getState().invalidateAiReview(
      input.patientId,
      clinicalInput.inputSignature,
      clinicalInput.sourceScopeSignature,
    )
  }, [
    clinicalInput.dataReady,
    clinicalInput.inputSignature,
    clinicalInput.sourceScopeSignature,
    input.patientId,
  ])

  const run = useCallback(async () => {
    if (!input.patientId || !isDataReady || input.criteria.length === 0 || review.isRunning) return

    const runId = `${input.patientId}:${Date.now().toString(36)}:${++runSequence}`
    const patientId = input.patientId
    const criteria = input.criteria
    const clinicalContext = clinicalInput.clinicalContext
    const catalog = clinicalInput.catalog
    const inputSignature = clinicalInput.inputSignature
    const sourceScopeSignature = clinicalInput.sourceScopeSignature
    const metadata: NhiLipidAiRunMetadata = {
      runId,
      inputSignature,
      sourceScopeSignature,
      promptVersion: NHI_LIPID_AI_PROMPT_VERSION,
      inputSummary: {
        criteriaCount: criteria.length,
        sourceCount: catalog.length,
        sourceCounts: catalog.reduce<Record<string, number>>((counts, source) => {
          counts[source.resourceType] = (counts[source.resourceType] ?? 0) + 1
          return counts
        }, {}),
        earliestDate: catalog.map(source => source.date).filter((date): date is string => Boolean(date)).sort()[0],
        latestDate: catalog.map(source => source.date).filter((date): date is string => Boolean(date)).sort().at(-1),
      },
      startedAt: new Date().toISOString(),
      modelId,
      modelName,
    }
    stopAi(operationKey)
    useNhiLipidReviewStore.getState().beginAiRun(patientId, metadata)
    const collector = beginCollectorObservation({ feature: 'nhi_lipid', modelId, sampleKind: 'feature', mode: 'structured' })
    let collectorPhase: 'request' | 'validation' = 'request'
    let collectorComplete = false

    try {
      let completedModelId = modelId
      let completedModelName = modelName
      const messages = buildNhiLipidAiMessages({
        criteria,
        clinicalContext,
        catalog,
        locale: input.locale,
      })
      const raw = await ai.query(messages, {
        modelId,
        requestedModelId: selectedModelId,
        maxTokens: 8_000,
        responseFormat: 'json',
        operationKey,
        diagnosticFeature: 'nhi-lipid-ai-assist',
        collectorContext: { operation: collector.operation },
        onModelExecution: (execution) => {
          completedModelId = execution.actualModelId ?? execution.routedModelId
          completedModelName = modelExecutionLabel(execution)
        },
      })
      const latestScope = currentScopeRef.current
      collectorComplete = true
      if (
        latestScope.patientId !== patientId
        || latestScope.inputSignature !== inputSignature
        || latestScope.sourceScopeSignature !== sourceScopeSignature
      ) {
        collector.finish({ outcome: 'aborted', phase: 'validation', responseComplete: true })
        useNhiLipidReviewStore.getState().failAiRun(
          patientId,
          runId,
          input.locale === 'en'
            ? 'The selected clinical data changed during review. Run the AI review again.'
            : '判讀期間病歷資料已更新，請重新執行 AI 判讀。',
        )
        return
      }
      collectorPhase = 'validation'
      const parsed = parseNhiLipidAiResponse({
        raw,
        criteria,
        clinicalContext,
        catalog,
        modelId: completedModelId,
        modelName: completedModelName,
      })
      if (!parsed) {
        collector.finish({ outcome: 'validation_failed', phase: 'validation', responseComplete: true })
        useNhiLipidReviewStore.getState().failAiRun(
          patientId,
          runId,
          input.locale === 'en'
            ? 'The AI reply could not be verified. No Table 1 answers were changed.'
            : 'AI 回覆無法通過格式與證據核對；表一未做任何變更。',
        )
        return
      }
      const recordStates = Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion.state]))
      collector.finish({ outcome: 'ok', phase: 'validation', responseComplete: true })
      useNhiLipidReviewStore.getState().completeAiRun(
        patientId,
        runId,
        parsed,
        recordStates,
        new Date().toISOString(),
        { modelId: completedModelId, modelName: completedModelName },
      )
    } catch (caught) {
      collector.finish({ outcome: collectorError(caught), phase: collectorPhase, responseComplete: collectorComplete })
      const activeRun = useNhiLipidReviewStore.getState().aiReview.latestAttempt?.runId
      if (activeRun !== runId) return
      if (caught instanceof Error && caught.name === 'AbortError') {
        useNhiLipidReviewStore.getState().settleAiRun(patientId, runId)
        return
      }
      useNhiLipidReviewStore.getState().failAiRun(patientId, runId, getUserErrorMessage(caught))
    }
  }, [
    ai,
    clinicalInput.catalog,
    clinicalInput.clinicalContext,
    clinicalInput.inputSignature,
    clinicalInput.sourceScopeSignature,
    input.criteria,
    input.locale,
    input.patientId,
    isDataReady,
    review.isRunning,
    modelId,
    modelName,
    operationKey,
    selectedModelId,
    stopAi,
  ])

  const decide = useCallback((criterionId: string, decision: NhiLipidAiDecision) => {
    // Production completions apply and mark the full AI layer atomically. The
    // callback remains for injected development/review assists.
    void criterionId
    void decision
  }, [])

  return {
    suggestions: review.suggestions,
    decisions: review.decisions,
    isRunning: review.isRunning,
    isDataReady,
    error: review.error,
    lastCompleted: review.lastCompleted,
    latestAttempt: review.latestAttempt,
    modelId,
    modelName,
    selectedModelId,
    fallbackModelId: MODEL_PREF_DEFAULTS.insights,
    selectModel,
    run,
    decide,
  }
}
