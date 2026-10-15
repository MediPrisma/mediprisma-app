// Shared run body for one structured-AI generation slot: guard against
// double-starting the SAME slot (a different slot MAY run concurrently — each
// writes to its own slot), flip the running flag, run the producer, map an
// unparseable reply to the sentinel 'PARSE_FAILED', surface other failures via
// getUserErrorMessage, and persist a successful result to the encrypted
// session cache so a reload reuses it instead of re-billing.
import { getUserErrorMessage } from '@/src/core/errors'
import { saveEncryptedCache } from '@/src/infrastructure/cache/encrypted-session-cache'
import { isContextOverflowError } from '@/src/shared/utils/context-budget'
import {
  trackEvent,
  type AiOutcome,
  type AiSurface,
  type FedResourceCounts,
  type PatientResourceCounts,
} from '@/src/application/telemetry/usage-analytics'
import { bucketDuration, classifyAiOutcome, nowMs } from '@/src/application/telemetry/ai-outcome'
import type { AiResultStore } from './create-ai-result-store'
import { beginCollectorObservation } from '@/src/application/telemetry/collector'
import type { SummaryCardCounts } from '@/src/shared/contracts/collector-event'

/** Per-run measurements only; never stored in the clinical result/cache. */
export interface AiGenerationMeasurement {
  outcome: AiOutcome
  summaryCards?: SummaryCardCounts
}

/**
 * What a caller opts in with. Every measurement is optional and independent:
 * `contextTokens` is how much went OUT on this call, `counts` is how big the
 * loaded chart IS, `fedCounts` is how much of it survived Data Selection and
 * context fitting. A surface may have any subset — whatever it cannot measure
 * is simply absent from the event, never zero.
 */
export interface AiResultAnalytics {
  surface: AiSurface
  modelId: string
  /** Estimated tokens of clinical context in this request. */
  contextTokens?: number
  contextTrimmed?: boolean
  /** Size of the chart currently loaded. Omitted when none is. */
  counts?: PatientResourceCounts
  /** How much of that chart survived Data Selection + context fitting and
   *  actually reached the model. Omitted where there is no fed context
   *  (agent-mode chat, general-scope chat). Partial: a surface may know some
   *  fields and not others (report interpretation knows only that it fed one
   *  report). */
  fedCounts?: Partial<FedResourceCounts>
}

/**
 * Measurements only the producer can take, read back after it settles. They
 * are separate from `AiResultAnalytics` because the caller cannot know them
 * before `produce()` has streamed: a surface that publishes progressively
 * knows when its FIRST section became visible, and on a slow endpoint that is
 * a different reliability fact from the end-to-end duration.
 */
export interface AiRunMetrics {
  /** Milliseconds from the start of the run to the first published section. */
  firstCardMs?: number
}

export async function runGenerationJob<T>(options: {
  store: AiResultStore<T>
  /** Slot key the result / loading / error land under. */
  key: string
  /** Encrypted-session-cache key — each feature keeps its historical format. */
  cacheKey: string
  /** Streams + parses one reply; null = parse failed (after any internal retry). */
  produce: (measure: (result: AiGenerationMeasurement) => void) => Promise<T | null>
  /** A user cancellation invalidates the run without surfacing an error. */
  shouldCommit?: () => boolean
  /** Opt in to the `ai_result` reliability event. Omit and nothing is sent. */
  analytics?: AiResultAnalytics
  /** Read once, after the run settles, for measurements the producer took. */
  readRunMetrics?: () => AiRunMetrics | undefined
}): Promise<T | null> {
  const {
    store, key, cacheKey, produce, shouldCommit = () => true, analytics, readRunMetrics,
  } = options
  // Never double-start the same slot's generation.
  if (store.getState().running[key]) return null
  const bundleRevision = store.getState().bundleRevision
  const isCurrentBundle = () => store.getState().bundleRevision === bundleRevision
  const {
    setRunning,
    setError,
    setIssue,
    setResult,
  } = store.getState()
  setRunning(key, true)
  setError(key, null)
  setIssue(key, null)
  // Reporting is strictly an observer here: it reads the outcome this function
  // already decides and never changes it. `report` fires at most once.
  const startedAt = nowMs()
  const collector = analytics ? beginCollectorObservation({
    feature: analytics.surface, modelId: analytics.modelId, sampleKind: 'feature', mode: 'structured',
    counts: analytics.counts, fedCounts: analytics.fedCounts, contextTokens: analytics.contextTokens,
    contextTrimmed: analytics.contextTrimmed,
  }) : undefined
  let reported = false
  const report = (outcome: AiOutcome, summaryCards?: SummaryCardCounts) => {
    if (reported || !analytics) return
    reported = true
    collector?.finish({ outcome, phase: outcome === 'parse_failed' ? 'parse' : 'unknown', summaryCards })
    reportAiResult(analytics, outcome, nowMs() - startedAt, readRunMetrics?.())
  }
  try {
    let measurement: AiGenerationMeasurement | undefined
    const parsed = await produce((result) => { measurement = result })
    // A cancelled or superseded run is not a failure of the model.
    if (!isCurrentBundle() || !shouldCommit()) {
      report('aborted')
      return null
    }
    if (!parsed) {
      report('parse_failed')
      setError(key, 'PARSE_FAILED')
      return null
    }
    report(measurement?.outcome ?? 'ok', measurement?.summaryCards)
    // Always commit to THIS run's own slot — even if the user has since
    // switched away, the result is stored and shows when they switch back.
    setResult(key, parsed)
    // Encryption is deliberately outside the visible running lifecycle. The
    // post-encryption guard keeps writes ordered without making the user wait:
    // a later metadata patch/new run replaces the object identity, and a
    // Bundle reset advances the revision, so this stale write becomes a no-op.
    void saveEncryptedCache(cacheKey, parsed, () => (
      isCurrentBundle() && shouldCommit() && store.getState().byKey[key] === parsed
    ))
    return parsed
  } catch (err) {
    report(isCurrentBundle() && shouldCommit() ? classifyAiOutcome(err) : 'aborted')
    if (isCurrentBundle() && shouldCommit()) {
      if (isContextOverflowError(err)) setIssue(key, err.issue)
      setError(key, getUserErrorMessage(err))
    }
    return null
  } finally {
    if (isCurrentBundle()) setRunning(key, false)
  }
}

function reportAiResult(
  analytics: AiResultAnalytics,
  outcome: AiOutcome,
  durationMs: number,
  metrics?: AiRunMetrics,
): void {
  trackEvent('ai_result', {
    surface: analytics.surface,
    outcome,
    model_id: analytics.modelId,
    duration_bucket: bucketDuration(durationMs),
    // Bucketed like every other timing on this event: the same rule that keeps
    // an exact duration off it applies to the time-to-first-section.
    ...(typeof metrics?.firstCardMs === 'number'
      ? { first_card_bucket: bucketDuration(metrics.firstCardMs) }
      : {}),
    // Spread rather than assigned: an absent measurement must leave the key
    // off the event entirely, not sit on it as `undefined` or 0 — "we could
    // not measure" and "we measured nothing" are different findings.
    ...(typeof analytics.contextTokens === 'number'
      ? { context_tokens: analytics.contextTokens }
      : {}),
    ...(analytics.counts ?? {}),
    ...(analytics.fedCounts ?? {}),
  })
}
