export const MEDICAL_SUMMARY_CARD_PROGRESS_TIMEOUT_MS = 45_000

/**
 * How long a local model may take before its FIRST output token. Reading the
 * prompt (prefill) scales with its size on an on-prem GPU — about 10.7 s for
 * 5K tokens and 23.8 s for 13K on the hospital endpoint
 * (docs/FHIR-context-stability-optimization.txt) — so a 45 s card window that
 * starts at the request kills a healthy request before it has written a word.
 * The card window starts once output starts; this bound only catches an
 * endpoint that never answers.
 */
export const MEDICAL_SUMMARY_FIRST_OUTPUT_TIMEOUT_MS = 150_000

export class MedicalSummaryCardProgressTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Medical summary card progress timed out after ${Math.round(timeoutMs / 1_000)} seconds`)
    this.name = 'MedicalSummaryCardProgressTimeoutError'
  }
}

interface StreamWithCardProgressTimeoutInput {
  stream: (
    signal: AbortSignal,
    onChunk: (streamedText: string) => void,
  ) => Promise<string>
  /** Return true only when this chunk produced at least one newly valid card. */
  onChunk: (streamedText: string) => boolean
  /** null disables the watchdog for providers outside this policy. */
  timeoutMs?: number | null
  /** When set, the window before the first streamed text uses this bound
   *  instead of `timeoutMs` (prefill is not a stall). */
  firstOutputTimeoutMs?: number
}

export interface StreamWithCardProgressTimeoutResult {
  fullText: string
  timedOut: boolean
}

/**
 * Abort one transport attempt when it stops producing newly valid cards.
 * Token-only activity deliberately does not reset the timer: the user-facing
 * unit of progress is a parsed card, not an upstream SSE heartbeat.
 */
export async function streamWithCardProgressTimeout({
  stream,
  onChunk,
  timeoutMs = MEDICAL_SUMMARY_CARD_PROGRESS_TIMEOUT_MS,
  firstOutputTimeoutMs,
}: StreamWithCardProgressTimeoutInput): Promise<StreamWithCardProgressTimeoutResult> {
  const controller = new AbortController()
  let latestText = ''
  let timedOut = false
  let active = true
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const clearWatchdog = () => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    timeoutHandle = undefined
  }
  let outputStarted = false
  const armWatchdog = () => {
    clearWatchdog()
    if (timeoutMs === null) return
    const windowMs = !outputStarted && firstOutputTimeoutMs !== undefined
      ? firstOutputTimeoutMs
      : timeoutMs
    timeoutHandle = setTimeout(() => {
      // One last synchronous parse protects a closing marker received just
      // before the timer callback. It cannot extend the deadline unless it
      // actually publishes a new valid card.
      const madeProgress = latestText ? onChunk(latestText) : false
      if (madeProgress) {
        armWatchdog()
        return
      }
      timedOut = true
      active = false
      controller.abort(new MedicalSummaryCardProgressTimeoutError(windowMs))
    }, windowMs)
  }

  armWatchdog()
  try {
    const fullText = await stream(controller.signal, (streamedText) => {
      if (!active) return
      latestText = streamedText
      const madeProgress = onChunk(streamedText)
      if (!outputStarted && streamedText.length > 0) {
        outputStarted = true
        // Output has begun: from here on, progress is measured in cards.
        // Without a separate first-output bound nothing changes.
        if (!madeProgress && firstOutputTimeoutMs !== undefined) armWatchdog()
      }
      if (madeProgress) armWatchdog()
    })
    if (!timedOut) latestText = fullText
    return { fullText: latestText, timedOut }
  } catch (error) {
    // Only swallow the AbortError created by this watchdog. A user stop or
    // scope change aborts the operation-owned controller instead and must
    // still terminate the whole generation pipeline.
    if (!timedOut) throw error
    return { fullText: latestText, timedOut: true }
  } finally {
    active = false
    clearWatchdog()
  }
}
