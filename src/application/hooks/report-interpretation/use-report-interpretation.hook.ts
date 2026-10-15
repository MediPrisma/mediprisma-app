// Report Interpretation hook. Runs the pure-AI translate+interpret task for ONE
// report on its dedicated cloud-model preference (Gemini Flash-Lite by default),
// parses the structured reply,
// and caches the result per report so re-expanding / switching tabs doesn't
// re-run / re-bill. Purely ON-DEMAND — unlike the safety scan there is NO
// auto-run: a patient may have dozens of reports, so we never spend quota until
// the user presses the button on a specific report. (That's why this hook uses
// only the store + run-body pieces of the shared ai-generation machinery, not
// the patient-slot engine: its cache key is content-based, not patient-based.)
'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import {
  loadEncryptedCache,
  aiResultCacheKey,
} from '@/src/infrastructure/cache/encrypted-session-cache'
import {
  generateReportInterpretationUseCase,
  prepareReportText,
} from '@/src/core/use-cases/report-interpretation/generate-report-interpretation.use-case'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { runGenerationJob } from '@/src/application/hooks/ai-generation/run-generation-job'
import { buildReportInterpretationCompositeKey } from './report-interpretation-cache-key'
import type {
  ReportInterpretation,
  ReportInterpretationMode,
} from '@/src/core/entities/report-interpretation.entity'
import {
  useApiKey,
  useClaudeKey,
  useGeminiKey,
  useOpenAiCompatibleProfiles,
} from '@/src/application/stores/ai-config.store'
import {
  resolveReportInterpretationModel,
  resolveReportInterpretationPrompt,
  useReportInterpretationPrefsStore,
} from '@/src/application/stores/report-interpretation-prefs.store'
import { usePatient } from '@/src/application/hooks/patient/use-patient-query.hook'
import { buildPatientTextLiterals } from '@/src/shared/utils/pii-text-scrub'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
import { modelRuntimeIdentity } from '@/src/shared/utils/model-access.utils'
import { estimateTokens } from '@/src/shared/utils/token-estimator'
import {
  SINGLE_REPORT_FED_COUNTS,
  useLoadedPatientCounts,
} from '@/src/application/telemetry/patient-resource-counts'
import { resolveOpenAiCompatibleProfile } from '@/src/shared/utils/openai-compatible.utils'
import { withReportInterpretationTimeout } from './report-interpretation-timeout'

// Persist a completed interpretation so a page reload reuses it instead of
// re-billing. Same lifecycle/key discipline as the safety scan cache.
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000
const cacheKey = (compositeKey: string) => aiResultCacheKey('report-interp', compositeKey)
const REPORT_INTERPRETATION_AI_OPTIONS = Object.freeze({})

// Bound output as well as wall-clock time. Standard reports need room for a
// faithful translation; long documents ask for a digest and should stay much
// shorter. Without a cap, a provider that ignores the concise-output request
// can stream continuously for several minutes and never trip the idle timeout.
const STANDARD_REPORT_MAX_OUTPUT_TOKENS = 8192
const LONG_DOCUMENT_MAX_OUTPUT_TOKENS = 4096

// Module-level cache (survives tab switches / accordion collapse within a
// session; wiped when a new bundle is imported — the cache key already includes
// a content signature, but a full reset keeps re-import behaviour uniform with
// the summary/safety stores). Keyed by compositeKey =
// mode::audience::locale::contentSig, so the same narrative reuses one result
// across report and visit-history entry points even if their row ids differ,
// while text changes still invalidate it.
const useStore = createAiResultStore<ReportInterpretation>()

export interface UseReportInterpretationArgs {
  /** Stable host id for UI/debug identity. The AI cache is content-based so the
   *  same narrative can be reused across report and visit-history entry points
   *  even when those hosts build different row ids. */
  reportId: string
  /** Raw report text (already HTML-stripped by the caller). */
  reportText: string
  /** Human-readable title, passed to the model for context. */
  reportTitle?: string
  /** Standard reports get faithful translation; long documents get digest mode. */
  mode?: ReportInterpretationMode
}

export interface UseReportInterpretationReturn {
  result: ReportInterpretation | undefined
  isGenerating: boolean
  error: string | null
  /** Exact model/audience/locale/content identity for one automatic attempt. */
  generationKey: string
  /** False when there's no text worth interpreting (button should be hidden). */
  hasText: boolean
  /** True after the persisted cache has been checked for this report key. */
  isHydrated: boolean
  /** Generate if not already cached / in-flight. Safe to call repeatedly. */
  generate: () => Promise<void>
  /** Force a fresh run (clears the cached slot first). */
  regenerate: () => Promise<void>
}

export function useReportInterpretation(
  args: UseReportInterpretationArgs,
): UseReportInterpretationReturn {
  const { reportText, reportTitle, mode = 'standard' } = args
  // A stable options object keeps the stream callback stable across the
  // running/error store updates produced by this same request.
  const { stream: streamAi } = useUnifiedAi(REPORT_INTERPRETATION_AI_OPTIONS)
  const { locale } = useLanguage()
  const { audience } = useAudience()
  const { patient } = usePatient()
  const piiLiterals = useMemo(() => buildPatientTextLiterals(patient), [patient])
  // Usage analytics only: how big the chart behind this report is. Read here
  // rather than threaded in from the report row — the hook already sits in
  // the React Query tree via usePatient, so it costs no new plumbing.
  const patientCounts = useLoadedPatientCounts()
  const preferredModelId = useReportInterpretationPrefsStore((state) => state.modelId)
  const promptOverride = useReportInterpretationPrefsStore((state) => state.customPrompt)
  const openAiKey = useApiKey()
  const geminiKey = useGeminiKey()
  const claudeKey = useClaudeKey()
  const openAiCompatibleProfiles = useOpenAiCompatibleProfiles()
  // Keep Gemini as the default while allowing the same explicit model choices
  // as Medical Summary, including a specific configured custom endpoint.
  const effectiveModelId = resolveReportInterpretationModel(preferredModelId, {
    openAiKey,
    geminiKey,
    claudeKey,
  })
  const openAiCompatible = useMemo(
    () => resolveOpenAiCompatibleProfile(effectiveModelId, openAiCompatibleProfiles),
    [effectiveModelId, openAiCompatibleProfiles],
  )
  const runtimeModelId = useMemo(
    () => modelRuntimeIdentity(effectiveModelId, openAiCompatible),
    [effectiveModelId, openAiCompatible],
  )

  const targetLocale: 'en' | 'zh-TW' = locale === 'zh-TW' ? 'zh-TW' : 'en'
  const targetAudience: 'medical' | 'patient' = audience === 'patient' ? 'patient' : 'medical'
  const customPrompt = resolveReportInterpretationPrompt(promptOverride, targetLocale)

  const clean = (reportText ?? '').trim()
  const hasText = clean.length > 0

  // Signature over the clamped text — invalidates the cache if the source report
  // text changes, and keeps the key bounded for huge documents.
  const compositeKey = useMemo(() => {
    if (!hasText) return ''
    const { text } = prepareReportText(clean, mode, piiLiterals)
    const contentKey = buildReportInterpretationCompositeKey({
      mode,
      audience: targetAudience,
      locale: targetLocale,
      preparedText: text,
      customPrompt,
    })
    return `${runtimeModelId}::${contentKey}`
  }, [hasText, clean, mode, targetAudience, targetLocale, runtimeModelId, piiLiterals, customPrompt])

  const result = useStore((s) => (compositeKey ? s.byKey[compositeKey] : undefined))
  const setResult = useStore((s) => s.setResult)
  const clearSlot = useStore((s) => s.clear)
  const isGenerating = useStore((s) => (compositeKey ? !!s.running[compositeKey] : false))
  const error = useStore((s) => (compositeKey ? s.errors[compositeKey] ?? null : null))
  const isHydrated = useStore((s) => (compositeKey ? !!s.hydrated[compositeKey] : false))
  const setHydrated = useStore((s) => s.setHydrated)

  // Restore a persisted result on (re)load before the user re-presses. Only read
  // the cache when the module store is empty for this key (i.e. after a reload).
  useEffect(() => {
    if (!compositeKey) return
    if (useStore.getState().byKey[compositeKey]) {
      setHydrated(compositeKey, true)
      return
    }
    if (useStore.getState().hydrated[compositeKey]) return
    let cancelled = false
    void loadEncryptedCache<ReportInterpretation>(cacheKey(compositeKey), CACHE_MAX_AGE_MS).then(
      (cached) => {
        if (cancelled) return
        if (cached) setResult(compositeKey, cached)
        setHydrated(compositeKey, true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [compositeKey, setHydrated, setResult])

  const run = useCallback(
    async (force: boolean) => {
      if (!compositeKey || !hasText) return
      if (!useStore.getState().hydrated[compositeKey]) return
      if (!force && useStore.getState().byKey[compositeKey]) return
      // Never double-start the same slot; a different report may run concurrently.
      // (Checked here too so a forced re-run doesn't clear a slot mid-flight.)
      if (useStore.getState().running[compositeKey]) return
      const myKey = compositeKey
      if (force) clearSlot(myKey)
      useAiExecutionDiagnosticsStore.getState().clearOperation(myKey)
      // Prepared once for the run: `produce` needs its truncation metadata and
      // the analytics estimate needs its size. The clamped, PII-scrubbed text
      // is what actually leaves the browser, so that is what gets measured —
      // the raw report would overstate a long document that was clipped.
      const prepared = prepareReportText(clean, mode, piiLiterals)
      await runGenerationJob({
        store: useStore,
        key: myKey,
        cacheKey: cacheKey(myKey),
        analytics: {
          surface: 'report_interp',
          modelId: effectiveModelId,
          contextTokens: estimateTokens(prepared.text),
          contextTrimmed: prepared.truncated,
          counts: patientCounts,
          // This surface never receives a chart — the fed set is exactly the
          // one report the user pressed the button on.
          fedCounts: SINGLE_REPORT_FED_COUNTS,
        },
        produce: async (_measure, operation) => {
          const messages = generateReportInterpretationUseCase.buildMessages({
            reportText: clean,
            reportTitle,
            locale: targetLocale,
            audience: targetAudience,
            mode,
            piiLiterals,
            customPrompt,
          })
          const full = await withReportInterpretationTimeout(async (signal) => {
            let streamedText = ''
            await streamAi(messages, {
              modelId: effectiveModelId,
              operationKey: myKey,
              diagnosticFeature: 'report-interpretation',
              collectorContext: { operation },
              signal,
              throwOnAbort: true,
              maxTokens: mode === 'long-document'
                ? LONG_DOCUMENT_MAX_OUTPUT_TOKENS
                : STANDARD_REPORT_MAX_OUTPUT_TOKENS,
              onChunk: (chunk: string) => {
                streamedText = chunk
              },
            })
            return streamedText
          })
          return generateReportInterpretationUseCase.parseResult(full, {
            truncated: prepared.truncated,
            coverage: prepared.coverage,
            mode: prepared.mode,
          })
        },
      })
    },
    [compositeKey, hasText, clean, mode, reportTitle, targetLocale, targetAudience, streamAi, clearSlot, effectiveModelId, piiLiterals, customPrompt, patientCounts],
  )

  const generate = useCallback(() => run(false), [run])
  const regenerate = useCallback(() => run(true), [run])

  return {
    result,
    isGenerating,
    error,
    generationKey: compositeKey,
    hasText,
    isHydrated,
    generate,
    regenerate,
  }
}
