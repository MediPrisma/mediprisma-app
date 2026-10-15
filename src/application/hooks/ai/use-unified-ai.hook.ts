/**
 * Unified AI Hook
 * Provides a consistent interface for AI operations across all features
 * Following Single Responsibility Principle
 */

import type { AiModelExecution } from '@/src/core/entities/ai-model-execution.entity'
import { createModelExecution, modelExecutionLabel } from '@/src/shared/utils/ai-model-execution'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import {
  captureAiRuntimeConfig,
  createAiStreamOrchestrator,
  createQueryAiUseCase,
} from '@/src/application/composition.ai'
import { getUserErrorMessage } from '@/src/core/errors'
import {
  DEFAULT_MODEL_ID,
  isCustomOpenAiModelId,
} from '@/src/shared/constants/ai-models.constants'
import type { AiMessage } from '@/src/core/entities/ai.entity'
import { apiKeyForModel } from '@/src/shared/utils/model-access.utils'
import {
  isOpenAiCompatibleRuntimeReady,
  resolveOpenAiCompatibleProfile,
} from '@/src/shared/utils/openai-compatible.utils'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'
import {
  useAiExecutionDiagnosticsStore,
  type AiExecutionStatus,
} from '@/src/application/stores/ai-execution-diagnostics.store'

import { beginCollectorObservation, collectorFeature, collectorError, type CollectorContext } from '@/src/application/telemetry/collector'

interface UseUnifiedAiOptions {
  defaultModel?: string
  onSuccess?: (text: string) => void
  onError?: (error: string) => void
}

interface QueryOptions {
  requestedModelId?: string
  onModelExecution?: (execution: AiModelExecution) => void
  modelId?: string
  temperature?: number
  maxTokens?: number
  /** Only callers that visibly mark partial text should enable this. */
  allowTruncatedOutput?: boolean
  onOutputTruncated?: (truncated: boolean) => void
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** Ask a user-configured (CUSTOM) endpoint to skip hidden reasoning for this
   *  request. Frontier providers ignore it. Used by the 醫療摘要 fast lane,
   *  where the measured cost of the first section is the model's thinking. */
  hiddenReasoning?: 'off'
  responseFormat?: 'json'
  /** Optional owner identity for cancelling one structured generation slot
   * without aborting background work from another patient/input scope. */
  operationKey?: string
  /** Human-readable owner included in the downloaded diagnostics bundle. */
  diagnosticFeature?: string
  /** Only aggregate measurements; never pass diagnostics records or operationKey. */
  collectorContext?: CollectorContext
}

interface StreamOptions extends QueryOptions {
  onChunk?: (chunk: string) => void
  onComplete?: (fullText: string) => void
  /** Optional caller-owned signal for aborting only this transport attempt.
   * Operation-level stop() remains responsible for cancelling the full job. */
  signal?: AbortSignal
  /** Structured generators must not parse or persist a partial response after
   * an explicit user stop. Other callers keep the historical partial-text
   * behaviour by leaving this false. */
  throwOnAbort?: boolean
}

interface ActiveAiRequest {
  operationKey?: string
  modelId: string
  /** Object identity is intentional: every saved edit creates a replacement
   * profile, so an in-flight request can be aborted without retaining or
   * serialising a second copy of its API key. */
  openAiCompatible: OpenAiCompatibleProfile | null
}

function diagnosticPrompt(messages: AiMessage[]): string {
  return messages
    .map((message) => `[${message.role}]\n${message.content}`)
    .join('\n\n')
}

/**
 * Unified AI Hook
 * Consolidates AI query and streaming functionality
 */
export function useUnifiedAi(options: UseUnifiedAiOptions = {}) {
  // Callers with a model preference pass modelId explicitly (chat/insights/
  // summary/safety); the rest (e.g. IPS problem inference) land on the free
  // default. The former global picked-model no longer exists.
  const defaultModel = DEFAULT_MODEL_ID
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A keyed Map, not a single ref: one hook instance can have requests from
  // several model/input slots in flight. stop(key) aborts only that owner;
  // stop() without a key remains the global teardown used on Bundle changes.
  const abortControllersRef = useRef<Map<AbortController, ActiveAiRequest>>(new Map())

  // Cache stream orchestrator instance
  const streamOrchestrator = useMemo(
    () => createAiStreamOrchestrator(),
    []
  )

  // A saved edit replaces the profile object in the store. Abort every request
  // that still owns the previous object, including requests kept alive while a
  // different Settings screen is open. Deleted and disabled profiles also fail
  // this check. This prevents a stale endpoint/key snapshot from continuing to
  // receive clinical data after the user changes that connection.
  useEffect(() => {
    const abortControllers = abortControllersRef.current
    const unsubscribe = useAiConfigStore.subscribe((state, previousState) => {
      if (state.openAiCompatibleProfiles === previousState.openAiCompatibleProfiles) return
      for (const [controller, request] of abortControllers) {
        if (!isCustomOpenAiModelId(request.modelId)) continue
        const liveProfile = resolveOpenAiCompatibleProfile(
          request.modelId,
          state.openAiCompatibleProfiles,
        )
        if (
          liveProfile !== request.openAiCompatible ||
          !isOpenAiCompatibleRuntimeReady(liveProfile)
        ) {
          controller.abort()
        }
      }
    })

    return () => {
      unsubscribe()
      for (const controller of abortControllers.keys()) controller.abort()
      abortControllers.clear()
    }
  }, [])

  /**
   * Query AI (non-streaming)
   */
  const query = useCallback(
    async (messages: AiMessage[], queryOptions?: QueryOptions): Promise<string> => {
      setIsLoading(true)
      setError(null)
      const modelId = queryOptions?.modelId || options.defaultModel || defaultModel
      const liveConfig = captureAiRuntimeConfig()
      const openAiCompatible = resolveOpenAiCompatibleProfile(
        modelId,
        liveConfig.openAiCompatibleProfiles,
      )
      const abortController = new AbortController()
      abortControllersRef.current.set(abortController, {
        operationKey: queryOptions?.operationKey,
        modelId,
        openAiCompatible,
      })
      const timestamp = new Date().toISOString()
      let modelExecution = createModelExecution(queryOptions?.requestedModelId ?? modelId, modelId, openAiCompatible?.modelId)
      let outputData = ''
      const collector = beginCollectorObservation({
        ...queryOptions?.collectorContext, feature: collectorFeature(queryOptions?.diagnosticFeature),
        modelId, sampleKind: 'request', mode: 'query',
      })
      const record = (status: AiExecutionStatus, errorMessage: string | null = null) => {
        useAiExecutionDiagnosticsStore.getState().addRecord({
          version: 1,
          id: `${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
          feature: queryOptions?.diagnosticFeature || 'ai',
          operationKey: queryOptions?.operationKey ?? null,
          transport: 'query',
          modelName: modelExecutionLabel(modelExecution),
          modelId: modelExecution.actualModelId ?? 'unreported',
          modelExecution,
          timestamp,
          prompt: diagnosticPrompt(messages),
          inputData: {
            messages,
            temperature: queryOptions?.temperature ?? null,
            maxTokens: queryOptions?.maxTokens ?? null,
            responseFormat: queryOptions?.responseFormat ?? null,
          },
          outputData,
          hasError: status === 'error',
          errorMessage,
          status,
        })
      }

      try {
        const queryUseCase = createQueryAiUseCase(liveConfig)
        const result = await queryUseCase.execute({
          messages,
          modelId,
          temperature: queryOptions?.temperature,
          maxTokens: queryOptions?.maxTokens,
          allowTruncatedOutput: queryOptions?.allowTruncatedOutput,
          reasoningEffort: queryOptions?.reasoningEffort,
          responseFormat: queryOptions?.responseFormat,
          signal: abortController.signal,
        })

        modelExecution = result.metadata.modelExecution
          ? { ...modelExecution, ...result.metadata.modelExecution, requestedModelId: queryOptions?.requestedModelId ?? modelId }
          : modelExecution
        queryOptions?.onModelExecution?.(modelExecution)
        queryOptions?.onOutputTruncated?.(result.metadata.outputTruncated === true)
        outputData = result.text
        collector.finish({ outcome: 'ok', phase: 'request', responseComplete: result.metadata.outputTruncated !== true,
          modelId: modelExecution.actualModelId ?? modelId,
          modelSource: modelExecution.actualModelId ? 'reported' : 'configured' })
        record('completed')
        options.onSuccess?.(outputData)
        return outputData
      } catch (err) {
        collector.finish({ outcome: collectorError(err), phase: 'request', responseComplete: false })
        if (err instanceof Error && err.name === 'AbortError') {
          record('aborted', err.message)
          throw err
        }
        const errorMessage = getUserErrorMessage(err)
        record('error', errorMessage)
        setError(errorMessage)
        options.onError?.(errorMessage)
        throw err
      } finally {
        abortControllersRef.current.delete(abortController)
        setIsLoading(abortControllersRef.current.size > 0)
      }
    },
    [defaultModel, options]
  )

  /**
   * Stream AI response
   */
  const stream = useCallback(
    async (messages: AiMessage[], streamOptions?: StreamOptions): Promise<string> => {
      setIsLoading(true)
      setError(null)
      const modelId = streamOptions?.modelId || options.defaultModel || defaultModel
      const liveConfig = captureAiRuntimeConfig()
      const openAiCompatible = resolveOpenAiCompatibleProfile(
        modelId,
        liveConfig.openAiCompatibleProfiles,
      )
      const abortController = new AbortController()
      const onAttemptAbort = () => abortController.abort(streamOptions?.signal?.reason)
      if (streamOptions?.signal?.aborted) abortController.abort(streamOptions.signal.reason)
      else streamOptions?.signal?.addEventListener('abort', onAttemptAbort, { once: true })
      abortControllersRef.current.set(abortController, {
        operationKey: streamOptions?.operationKey,
        modelId,
        openAiCompatible,
      })
      const apiKey = apiKeyForModel(
        modelId,
        {
          openAiKey: liveConfig.openAiApiKey,
          geminiKey: liveConfig.geminiApiKey,
          claudeKey: liveConfig.claudeApiKey,
        },
        openAiCompatible,
      )

      let modelExecution = createModelExecution(streamOptions?.requestedModelId ?? modelId, modelId, openAiCompatible?.modelId)
      let fullText = ''
      const collector = beginCollectorObservation({
        ...streamOptions?.collectorContext, feature: collectorFeature(streamOptions?.diagnosticFeature),
        modelId, sampleKind: 'request', mode: 'stream',
      })
      const timestamp = new Date().toISOString()
      let recorded = false
      const record = (status: AiExecutionStatus, errorMessage: string | null = null) => {
        if (recorded) return
        recorded = true
        useAiExecutionDiagnosticsStore.getState().addRecord({
          version: 1,
          id: `${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
          feature: streamOptions?.diagnosticFeature || 'ai',
          operationKey: streamOptions?.operationKey ?? null,
          transport: 'stream',
          modelName: modelExecutionLabel(modelExecution),
          modelId: modelExecution.actualModelId ?? 'unreported',
          modelExecution,
          timestamp,
          prompt: diagnosticPrompt(messages),
          inputData: {
            messages,
            temperature: streamOptions?.temperature ?? null,
            maxTokens: streamOptions?.maxTokens ?? null,
            responseFormat: streamOptions?.responseFormat ?? null,
          },
          outputData: fullText,
          hasError: status === 'error',
          errorMessage,
          status,
        })
      }

      try {
        // A custom model id must resolve to the exact enabled profile at the
        // instant the request starts. Never let the adapter infer a different
        // endpoint or cloud fallback from a deleted/stale selection.
        if (
          isCustomOpenAiModelId(modelId) &&
          !isOpenAiCompatibleRuntimeReady(openAiCompatible)
        ) {
          throw new Error('OpenAI-compatible endpoint is not configured')
        }
        await streamOrchestrator.stream({
          messages,
          model: modelId,
          apiKey,
          openAiCompatible,
          signal: abortController.signal,
          temperature: streamOptions?.temperature,
          maxTokens: streamOptions?.maxTokens,
          reasoningEffort: streamOptions?.reasoningEffort,
          hiddenReasoning: streamOptions?.hiddenReasoning,
          responseFormat: streamOptions?.responseFormat,
          requestedModelId: streamOptions?.requestedModelId,
          onModelExecution: (execution) => {
            modelExecution = { ...modelExecution, ...execution }
            streamOptions?.onModelExecution?.(modelExecution)
          },
          onChunk: (chunk: string) => {
            if (chunk.length > 0) collector.firstChunk()
            fullText = chunk
            streamOptions?.onChunk?.(chunk)
          },
        })

        // Some streaming adapters resolve normally after forwarding an abort
        // instead of rejecting. Structured callers still need a hard stop so
        // they neither parse buffered text nor launch their parse-retry pass.
        if (abortController.signal.aborted) {
          collector.finish({ outcome: 'aborted', phase: 'stream', responseComplete: false })
          record('aborted', 'The operation was aborted')
          if (streamOptions?.throwOnAbort) {
            const abortError = new Error('The operation was aborted')
            abortError.name = 'AbortError'
            throw abortError
          }
          return fullText
        }

        streamOptions?.onComplete?.(fullText)
        collector.finish({ outcome: 'ok', phase: 'stream', responseComplete: true,
          modelId: modelExecution.actualModelId ?? modelId,
          modelSource: modelExecution.actualModelId ? 'reported' : 'configured' })
        record('completed')
        options.onSuccess?.(fullText)
        return fullText
      } catch (err) {
        collector.finish({ outcome: abortController.signal.aborted ? 'aborted' : collectorError(err), phase: 'stream', responseComplete: false })
        if (abortController.signal.aborted) {
          const abortReason = abortController.signal.reason
          record(
            'aborted',
            abortReason instanceof Error
              ? abortReason.message
              : err instanceof Error
                ? err.message
                : 'The operation was aborted',
          )
          if (streamOptions?.throwOnAbort) {
            if (err instanceof Error && err.name === 'AbortError') throw err
            const abortError = new Error('The operation was aborted')
            abortError.name = 'AbortError'
            throw abortError
          }
          return fullText
        }
        if (err instanceof Error && err.name === 'AbortError') {
          record('aborted', err.message)
          if (streamOptions?.throwOnAbort) throw err
          return fullText
        }

        const errorMessage = getUserErrorMessage(err)
        record('error', errorMessage)
        setError(errorMessage)
        options.onError?.(errorMessage)
        throw err
      } finally {
        streamOptions?.signal?.removeEventListener('abort', onAttemptAbort)
        abortControllersRef.current.delete(abortController)
        setIsLoading(abortControllersRef.current.size > 0)
      }
    },
    [streamOrchestrator, defaultModel, options]
  )

  /** Stop one owned operation, or every in-flight request when no key is given. */
  const stop = useCallback((operationKey?: string) => {
    let stoppedAny = false
    for (const [controller, request] of abortControllersRef.current) {
      if (operationKey !== undefined && request.operationKey !== operationKey) continue
      controller.abort()
      abortControllersRef.current.delete(controller)
      stoppedAny = true
    }
    if (stoppedAny) setIsLoading(abortControllersRef.current.size > 0)
  }, [])

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    query,
    stream,
    stop,
    isLoading,
    error,
    clearError,
  }
}
