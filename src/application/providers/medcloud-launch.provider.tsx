'use client'

import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createVghtpeTvghbrainRuntimeProfile,
  decryptVghtpeMedcloudCredential,
  MEDCLOUD_LAUNCH_CONTEXT_ACK_TYPE,
  parseMedcloudLaunchOptions,
  parseMedcloudLaunchContext,
  type MedcloudLaunchContext,
  VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
  VGTPE_TVGHBRAIN_PROFILE_ID,
} from '@/src/application/launch/medcloud-launch-context'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import {
  MODEL_PREF_DEFAULTS,
  useModelPrefsStore,
} from '@/src/application/stores/model-prefs.store'
import { useSummaryPrefsStore } from '@/src/application/stores/medical-summary-prefs.store'
import { useSafetyPrefsStore } from '@/src/application/stores/safety-prefs.store'
import { MEDICAL_SUMMARY_MODEL_ID } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { SAFETY_ALERTS_MODEL_ID } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'
import { BUNDLE_CHANGE_SETTLED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { PROGRESSIVE_IMPORT_EVENT, isProgressiveAutoSummaryBlocked, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

interface MedcloudLaunchProviderProps {
  children: ReactNode
  /** Test seam only; production always reads the current page URL. */
  launchHref?: string
}

const MAX_PROCESSED_MESSAGE_IDS = 32

/** A Medcloud model preference can outlive its runtime-only credential/profile
 * in persisted Zustand storage. Clear only that reserved profile id; ordinary
 * custom endpoints and user model choices remain untouched. */
function resetVghtpeRuntimeModelPreferences(): void {
  const modelPrefs = useModelPrefsStore.getState()
  if (modelPrefs.prefs.chat === VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID) {
    modelPrefs.setModelFor('chat', MODEL_PREF_DEFAULTS.chat)
  }
  if (modelPrefs.prefs.insights === VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID) {
    modelPrefs.setModelFor('insights', MODEL_PREF_DEFAULTS.insights)
  }

  const summaryPrefs = useSummaryPrefsStore.getState()
  if (summaryPrefs.modelId === VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID) {
    summaryPrefs.setModelId(MEDICAL_SUMMARY_MODEL_ID)
  }
  const safetyPrefs = useSafetyPrefsStore.getState()
  if (safetyPrefs.modelId === VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID) {
    safetyPrefs.setModelId(SAFETY_ALERTS_MODEL_ID)
  }
}

export function MedcloudLaunchProvider({
  children,
  launchHref,
}: MedcloudLaunchProviderProps) {
  const credentialsHydrating = useAiConfigStore((state) => state.credentialsHydrating)
  const chatModelId = useModelPrefsStore((state) => state.prefs.chat)
  const insightsModelId = useModelPrefsStore((state) => state.prefs.insights)
  const summaryModelId = useSummaryPrefsStore((state) => state.modelId)
  const safetyModelId = useSafetyPrefsStore((state) => state.modelId)
  const pendingContextRef = useRef<MedcloudLaunchContext | null>(null)
  const processedMessageIdsRef = useRef(new Set<string>())
  const processingMessageIdsRef = useRef(new Set<string>())
  const activationEpochRef = useRef(0)
  const bundleSettledRef = useRef(false)
  const launchSummaryModelIdRef = useRef<string | null>(null)
  const launchMessageIdRef = useRef<string | null>(null)
  const autoSummaryQueuedRef = useRef(false)
  const autoLaunchStoppedRef = useRef(false)
  const lastSupplementImportRef = useRef<string | null>(null)
  const resolvedLaunchHref = launchHref ?? (
    typeof window === 'undefined' ? '' : window.location.href
  )
  const launchOptions = useMemo(
    () => parseMedcloudLaunchOptions(resolvedLaunchHref),
    [resolvedLaunchHref],
  )
  const launchOrigin = useMemo(() => {
    if (!launchOptions || (!launchOptions.auto && !launchOptions.site)) return null
    return new URL(resolvedLaunchHref).origin
  }, [launchOptions, resolvedLaunchHref])

  // A terminal launch must never migrate onto a later manual/demo chart, even
  // if the stop arrives before the first snapshot or before its credential.
  const retireStoppedAutoLaunch = useCallback(() => {
    const { stoppedRuns } = useProgressiveImportStore.getState()
    if (isProgressiveAutoSummaryBlocked()
      || (!LocalBundleService.hasData() && Object.values(stoppedRuns).some(reason => reason !== 'failed'))) {
      autoLaunchStoppedRef.current = true
      autoSummaryQueuedRef.current = true
      const messageId = launchMessageIdRef.current
      if (messageId) useMedcloudLaunchStore.getState().claimSummary(messageId)
      launchMessageIdRef.current = null
    }
    return autoLaunchStoppedRef.current
  }, [])

  const queueAutoSummaryIfReady = useCallback(() => {
    const modelId = launchSummaryModelIdRef.current
    if (
      !launchOptions?.auto ||
      retireStoppedAutoLaunch() ||
      !bundleSettledRef.current ||
      !modelId ||
      autoSummaryQueuedRef.current
    ) return
    const messageId = launchMessageIdRef.current ?? (
      globalThis.crypto?.randomUUID?.() ?? `medcloud-auto-${Date.now()}`
    )
    launchMessageIdRef.current = messageId
    autoSummaryQueuedRef.current = true
    const progressive = useProgressiveImportStore.getState()
    const runId = progressive.pendingRunId ?? progressive.current?.runId
    const importId = LocalBundleService.getActiveImportId()
    useMedcloudLaunchStore.getState().queueSummary({ messageId, modelId,
      ...(runId && importId ? { progressiveRunId: runId, progressiveImportId: importId } : {}),
    })
  }, [launchOptions, retireStoppedAutoLaunch])

  // Persist hydration can finish after this provider mounts. Watching all four
  // preferences makes a later non-parameter Extension launch recover as soon
  // as the stale runtime-only selection appears.
  useEffect(() => {
    if (launchOrigin) return
    resetVghtpeRuntimeModelPreferences()
  }, [chatModelId, insightsModelId, launchOrigin, safetyModelId, summaryModelId])

  // The no-site route receives no launch-context message. Its URL selects the
  // ordinary defaults, while the import-settled event below is the only signal
  // allowed to queue a summary for the newly published Bundle.
  useEffect(() => {
    if (
      credentialsHydrating ||
      !launchOptions?.auto ||
      launchOptions.site !== null
    ) return
    useAiConfigStore.getState().clearRuntimeOpenAiCompatibleProfile(
      VGTPE_TVGHBRAIN_PROFILE_ID,
    )
    useMedcloudLaunchStore.getState().setRuntimeModelId(MEDICAL_SUMMARY_MODEL_ID)
    launchSummaryModelIdRef.current = MEDICAL_SUMMARY_MODEL_ID
    queueAutoSummaryIfReady()
  }, [credentialsHydrating, launchOptions, queueAutoSummaryIfReady])

  useEffect(() => {
    if (!launchOptions?.auto || typeof window === 'undefined') return
    retireStoppedAutoLaunch()
    const unsubscribe = useProgressiveImportStore.subscribe((state, previous) => {
      retireStoppedAutoLaunch()
      const current = state.current
      // A transport failure after accepted visits also closes that round.
      // Restoring a status on reload is not authorization to run again.
      if (current && previous.current?.runId === current.runId
        && previous.current.phase !== current.phase
        && ['reports-failed', 'update-failed'].includes(current.phase)
        && ['reports-pending', 'reports-pending-partial'].includes(previous.current.phase)
        && current.importId === LocalBundleService.getActiveImportId()
        && current.importId !== lastSupplementImportRef.current) {
        lastSupplementImportRef.current = current.importId
        launchMessageIdRef.current = `final-${current.importId}`
        autoSummaryQueuedRef.current = false
        bundleSettledRef.current = true
        queueAutoSummaryIfReady()
      }
    })
    const handleBundleSettled = () => {
      bundleSettledRef.current = true
      queueAutoSummaryIfReady()
    }
    window.addEventListener(BUNDLE_CHANGE_SETTLED_EVENT, handleBundleSettled)
    const handleSupplement = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.version !== 1 || !detail.ok || detail.stopped
        || !['hospital', 'hospital-reports-failed'].includes(detail.stage)
        || detail.importId !== LocalBundleService.getActiveImportId()
        || detail.importId === lastSupplementImportRef.current) return
      lastSupplementImportRef.current = detail.importId
      launchMessageIdRef.current = detail.requestId
      autoSummaryQueuedRef.current = false
      bundleSettledRef.current = true
      queueAutoSummaryIfReady()
    }
    window.addEventListener(PROGRESSIVE_IMPORT_EVENT, handleSupplement)
    return () => {
      unsubscribe()
      window.removeEventListener(BUNDLE_CHANGE_SETTLED_EVENT, handleBundleSettled)
      window.removeEventListener(PROGRESSIVE_IMPORT_EVENT, handleSupplement)
    }
  }, [launchOptions, queueAutoSummaryIfReady, retireStoppedAutoLaunch])

  const acknowledge = useCallback((messageId: string) => {
    if (!launchOrigin || typeof window === 'undefined') return
    window.postMessage({
      source: 'mediprisma',
      type: MEDCLOUD_LAUNCH_CONTEXT_ACK_TYPE,
      version: 1,
      messageId,
    }, launchOrigin)
  }, [launchOrigin])

  const activate = useCallback((context: MedcloudLaunchContext, apiKey?: string) => {
    if (!launchOptions) return

    let summaryModelId = MEDICAL_SUMMARY_MODEL_ID
    if (launchOptions.site === 'vghtpe') {
      if (!apiKey) return
      useAiConfigStore.getState().setRuntimeOpenAiCompatibleProfile(
        createVghtpeTvghbrainRuntimeProfile(apiKey),
      )
      const modelId = VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID
      useMedcloudLaunchStore.getState().setRuntimeModelId(modelId)
      summaryModelId = modelId
    } else {
      // The external-site route contains no VGH credential and must never
      // install or call the VGH local endpoint.
      useAiConfigStore.getState().clearRuntimeOpenAiCompatibleProfile(
        VGTPE_TVGHBRAIN_PROFILE_ID,
      )
      useMedcloudLaunchStore.getState().setRuntimeModelId(MEDICAL_SUMMARY_MODEL_ID)
    }

    launchSummaryModelIdRef.current = summaryModelId
    launchMessageIdRef.current = context.messageId
    queueAutoSummaryIfReady()

    const processed = processedMessageIdsRef.current
    processed.add(context.messageId)
    while (processed.size > MAX_PROCESSED_MESSAGE_IDS) {
      const oldest = processed.values().next().value as string | undefined
      if (!oldest) break
      processed.delete(oldest)
    }
    acknowledge(context.messageId)
  }, [acknowledge, launchOptions, queueAutoSummaryIfReady])

  const processContext = useCallback(async (context: MedcloudLaunchContext) => {
    if (processedMessageIdsRef.current.has(context.messageId)) {
      acknowledge(context.messageId)
      return
    }
    const processing = processingMessageIdsRef.current
    if (processing.has(context.messageId)) return
    processing.add(context.messageId)
    const activationEpoch = activationEpochRef.current
    try {
      if (context.site === 'vghtpe') {
        const apiKey = await decryptVghtpeMedcloudCredential(context.credential)
        if (!apiKey || activationEpoch !== activationEpochRef.current) return
        activate(context, apiKey)
      } else if (activationEpoch === activationEpochRef.current) {
        activate(context)
      }
    } catch {
      // Fail closed without exposing the credential through an exception or
      // leaving a partially installed runtime connection behind.
      useMedcloudLaunchStore.getState().clear()
      useAiConfigStore.getState().clearRuntimeOpenAiCompatibleProfile(
        VGTPE_TVGHBRAIN_PROFILE_ID,
      )
      resetVghtpeRuntimeModelPreferences()
    } finally {
      processing.delete(context.messageId)
    }
  }, [acknowledge, activate])

  useEffect(() => {
    if (!launchOrigin || typeof window === 'undefined') return

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        event.source !== window ||
        event.origin !== launchOrigin
      ) return
      const context = parseMedcloudLaunchContext(event.data)
      if (!context) return
      if (!launchOptions || (context.site ?? null) !== launchOptions.site) return
      if (processedMessageIdsRef.current.has(context.messageId)) {
        acknowledge(context.messageId)
        return
      }
      if (credentialsHydrating) {
        pendingContextRef.current = context
        return
      }
      void processContext(context)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [acknowledge, credentialsHydrating, launchOptions, launchOrigin, processContext])

  useEffect(() => {
    if (credentialsHydrating || !launchOrigin) return
    const pending = pendingContextRef.current
    if (!pending) return
    pendingContextRef.current = null
    void processContext(pending)
  }, [credentialsHydrating, launchOrigin, processContext])

  useEffect(() => {
    if (!launchOrigin) return
    const processedMessageIds = processedMessageIdsRef.current
    const processingMessageIds = processingMessageIdsRef.current
    const clearSensitiveLaunchState = () => {
      activationEpochRef.current += 1
      lastSupplementImportRef.current = null
      bundleSettledRef.current = false
      launchSummaryModelIdRef.current = null
      launchMessageIdRef.current = null
      autoSummaryQueuedRef.current = false
      pendingContextRef.current = null
      processedMessageIds.clear()
      processingMessageIds.clear()
      useMedcloudLaunchStore.getState().clear()
      useAiConfigStore.getState().clearRuntimeOpenAiCompatibleProfile(
        VGTPE_TVGHBRAIN_PROFILE_ID,
      )
      resetVghtpeRuntimeModelPreferences()
    }
    window.addEventListener('pagehide', clearSensitiveLaunchState)
    return () => {
      window.removeEventListener('pagehide', clearSensitiveLaunchState)
      clearSensitiveLaunchState()
    }
  }, [launchOrigin])

  return children
}
