// Which prompt/orchestration harness one medical-summary run uses.
//
// The decision is the model's CONTEXT WINDOW, not its provider. What the
// compact harness compensates for — a short module-scoped contract, overview
// first, a separate small fast lane — is what a model with a small window and
// a slow prefill needs, and an on-prem endpoint is not the only model in that
// class: GPT-nano (120K), Haiku (180K) and the conservative 15K fallback all
// behave the same way on a multi-year cross-hospital chart. Anything at or
// above the frontier threshold keeps the established full prompt.
import type { MedicalSummaryHarnessProfile } from './generate-medical-summary.use-case'

/** Below this window a run is treated as compact-harness. Frontier providers
 *  that carry the long prompt comfortably (Gemini/GPT/Claude long-context
 *  tiers) all declare 1M-class windows, so the boundary separates the two
 *  classes without naming a single vendor. */
export const FRONTIER_HARNESS_MIN_CONTEXT_TOKENS = 500_000

/** True when this run should use the compact, module-scoped harness. An
 *  unknown/unusable limit is treated as small: the compact contract is the
 *  safe default, and the full prompt on a small window fails outright. */
export function usesCompactSummaryHarness(contextLimit: number | undefined): boolean {
  if (typeof contextLimit !== 'number' || !Number.isFinite(contextLimit)) return true
  return contextLimit < FRONTIER_HARNESS_MIN_CONTEXT_TOKENS
}

/**
 * Latency budget, in tokens, for the clinical context of the full-context
 * request (focus / problems / recent / safety) on a compact-harness model.
 * It is independent of the window: a 262K on-prem window holds a multi-year
 * chart, but the hospital GPU reads a prompt at roughly 10.7 s per 5K tokens
 * and 23.8 s per 13K (docs/FHIR-context-stability-optimization.txt), i.e.
 * ~1.6 s per further 1K. At 24K of clinical context that is already ~40-45 s
 * of prefill once the instructions and source list are added, before the
 * model writes the first card — and the 2026-10-01 live run sent ~430K
 * characters, minutes of prefill, and was rejected outright. Above this the
 * request is narrowed through the same tiers as a window fit, and the summary
 * says so. Only the full-context request is bounded by it: the overview
 * snapshot and the report digest already have their own fixed caps.
 */
export const LOCAL_MODEL_FULL_CONTEXT_TOKEN_BUDGET = 24_000

/** The full-context latency budget for one run, or undefined when the model
 *  is frontier-class and only its window bounds the request. */
/** The latency budget applies to self-hosted (OpenAI-compatible custom)
 *  endpoints only: a cloud model with a small window (GPT nano, Haiku) still
 *  reads a long prompt in seconds, so trimming it would only lose data. */
export function medicalSummaryContextTokenBudget(
  contextLimit: number | undefined,
  options: { selfHosted: boolean },
): number | undefined {
  return options.selfHosted && usesCompactSummaryHarness(contextLimit)
    ? LOCAL_MODEL_FULL_CONTEXT_TOKEN_BUDGET
    : undefined
}

export function medicalSummaryHarnessProfile(
  contextLimit: number | undefined,
): MedicalSummaryHarnessProfile {
  return usesCompactSummaryHarness(contextLimit) ? 'local-small' : 'frontier'
}
