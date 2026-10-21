/**
 * The host's reading of the structured questions and the diagnostic summary a
 * recommendation carries.
 *
 * The shapes are the pack's own. `@voho0000/personalized-care` 2.0.0 publishes
 * `CdssPhysicianInputRequest`, `CdssDiagnosticSummary` and the rest, and the
 * names below are aliases of them, so a rename in the pack is a compile error
 * here rather than a control that quietly stops rendering.
 *
 * What is still the host's own work is the reading. `physicianInputRequestsOf`
 * and `diagnosticSummaryOf` validate what arrives rather than casting it: both
 * fields are optional on a recommendation, and the app runs against more than
 * one build of the pack — the published package on `master`, and on `app-hmc`
 * the HMC preview, which overlays the pilot's compiled modules onto the
 * published package and keeps the published declarations. An overlaid module's
 * behaviour reaches the app while a field the pilot added does not reach its
 * types, so what actually arrives is checked. An unrecognised `kind` is
 * dropped, which is how a pack newer than this host renders nothing instead of
 * an empty control.
 *
 * The term constants are the other direction: the ids the host writes back as
 * facts. They are wire identifiers the pack matches on, never clinical
 * wording, and the precedent is `apply-clinic-vitals.ts`, which names the
 * congestion term ids (`pitting-edema`, `orthopnea`, …) the same way. What
 * stays with the pack is what matters clinically: every label on screen is the
 * pack's own wording, carried inside the recommendation.
 */
import type {
  CdssCriterionSummary,
  CdssDiagnosticScore,
  CdssDiagnosticSummary,
  CdssPhysicianInputOption,
  CdssPhysicianInputRequest,
  CdssPhysicianInputRequestKind,
  CdssRecommendation,
} from './types'

export type PhysicianInputRequestKind = CdssPhysicianInputRequestKind

export type PhysicianInputOption = CdssPhysicianInputOption

export type PhysicianInputRequest = CdssPhysicianInputRequest

/**
 * The canonical term each DP-01 answer is written as.
 *
 * These are wire identifiers, not clinical wording: the pack matches on them
 * to read what the physician answered. They must stay identical to
 * `PHYSICIAN_LVEF_PHENOTYPE_TERMS` in the pack's `clinical-modules/
 * hfpef-diagnosis.ts`, which `phenotype-gate-wiring.test.tsx` holds by writing
 * an answer with the copy below and running the real pack over it.
 */
export const PHYSICIAN_LVEF_PHENOTYPE_TERMS = {
  reduced: 'lvef-known-reduced',
  preserved: 'lvef-known-preserved',
  unknown: 'lvef-unknown',
} as const

/**
 * The canonical term each DP-00 answer is written as, matching
 * `PHYSICIAN_HF_SUSPICION_TERMS` in the pack.
 *
 * `undefined` — no fact at all — is what the pack reads as 「還沒問」, which is
 * never 「不懷疑」, so the host writes a term only once someone has answered.
 */
export const PHYSICIAN_HF_SUSPICION_TERMS = {
  suspected: 'hf-suspected',
  'not-suspected': 'hf-not-suspected',
} as const

export type CriterionSummary = CdssCriterionSummary

export type DiagnosticScore = CdssDiagnosticScore

export type DiagnosticSummary = CdssDiagnosticSummary

function toScore(value: unknown): DiagnosticScore | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.source !== 'string') return undefined
  if (typeof record.value !== 'number' || typeof record.maximum !== 'number') return undefined
  if (typeof record.bandLabel !== 'string') return undefined
  const strings = (input: unknown): readonly string[] | undefined => (
    Array.isArray(input) && input.every((item) => typeof item === 'string')
      ? (input as string[])
      : undefined
  )
  const components = Array.isArray(record.components)
    ? record.components
      .filter((item): item is { label: string; detail: string } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).label === 'string'
        && typeof (item as Record<string, unknown>).detail === 'string'
      ))
    : undefined
  const unmeasured = strings(record.unmeasured)
  return {
    name: record.name,
    source: record.source,
    value: record.value,
    maximum: record.maximum,
    bandLabel: record.bandLabel,
    isFloor: record.isFloor === true,
    ...(unmeasured && unmeasured.length > 0 ? { unmeasured } : {}),
    ...(components && components.length > 0 ? { components } : {}),
  }
}

function toCriterion(value: unknown): CriterionSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const state = record.state
  if (typeof record.id !== 'string' || typeof record.label !== 'string') return undefined
  if (state !== 'met' && state !== 'refuted' && state !== 'undetermined') return undefined
  return {
    id: record.id,
    label: record.label,
    state,
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
  }
}

/**
 * The criterion-by-criterion reading a recommendation carries, if any.
 *
 * Validated rather than cast, for the same reason as the input requests: the
 * field is optional, and what fills it has to be checked rather than trusted.
 */
export function diagnosticSummaryOf(
  recommendation: CdssRecommendation,
): DiagnosticSummary | undefined {
  const raw = (recommendation as { diagnosticSummary?: unknown }).diagnosticSummary
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.verdict !== 'string' || typeof record.basis !== 'string') return undefined
  const criteria = Array.isArray(record.criteria)
    ? record.criteria.map(toCriterion).filter((item): item is CriterionSummary => Boolean(item))
    : []
  return {
    verdict: record.verdict,
    basis: record.basis,
    criteria,
    ...(typeof record.supportingParameterCount === 'number'
      ? { supportingParameterCount: record.supportingParameterCount }
      : {}),
    ...(record.confirmedByClinician === true ? { confirmedByClinician: true } : {}),
    ...(Array.isArray(record.scores)
      ? (() => {
        const scores = record.scores
          .map(toScore)
          .filter((item): item is DiagnosticScore => Boolean(item))
        return scores.length > 0 ? { scores } : {}
      })()
      : {}),
  }
}

const REQUEST_KINDS: readonly PhysicianInputRequestKind[] = [
  'hf-suspicion',
  'hf-symptoms',
  'lvef-phenotype',
  'hfpef-diagnosis-confirmation',
]

function isRequestKind(value: unknown): value is PhysicianInputRequestKind {
  return REQUEST_KINDS.some((kind) => kind === value)
}

function toOption(value: unknown): PhysicianInputOption | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.label !== 'string') return undefined
  return {
    id: record.id,
    label: record.label,
    ...(typeof record.valueLabel === 'string' ? { valueLabel: record.valueLabel } : {}),
  }
}

/**
 * The structured questions a recommendation carries, if any.
 *
 * Validating rather than casting: the field is optional, and the pilot overlay
 * on `app-hmc` can put a question on a card the published declarations have
 * not described. An unrecognised `kind` is dropped so a pack newer than this
 * host renders nothing rather than an empty control.
 */
export function physicianInputRequestsOf(
  recommendation: CdssRecommendation,
): readonly PhysicianInputRequest[] {
  const raw = (recommendation as { physicianInputRequests?: unknown }).physicianInputRequests
  if (!Array.isArray(raw)) return []
  const requests: PhysicianInputRequest[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (!isRequestKind(record.kind) || typeof record.label !== 'string') continue
    const options = Array.isArray(record.options)
      ? record.options.map(toOption).filter((option): option is PhysicianInputOption => Boolean(option))
      : undefined
    requests.push({
      kind: record.kind,
      label: record.label,
      ...(typeof record.detail === 'string' && record.detail.trim() ? { detail: record.detail } : {}),
      ...(typeof record.recordedOptionId === 'string' ? { recordedOptionId: record.recordedOptionId } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(record.selection === 'multiple' || record.selection === 'single'
        ? { selection: record.selection }
        : {}),
    })
  }
  return requests
}
