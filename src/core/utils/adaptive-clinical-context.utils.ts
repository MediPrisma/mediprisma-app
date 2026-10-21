import { DEFAULT_DOCUMENT_MODE } from '@/src/shared/constants/data-selection.constants'
import type {
  DataFilters,
  DataSelection,
  TimeRange,
} from '@/src/core/entities/clinical-context.entity'
import type { DocumentMode } from '@/src/core/utils/clinical-documents.utils'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import {
  DEFAULT_RESPONSE_RESERVE,
  formatApproxTokenCount,
} from '@/src/shared/utils/context-budget'
import { estimateTokens } from '@/src/shared/utils/token-estimator'

export type ClinicalContextFitTier = 'full' | 'prioritized' | 'trimmed' | 'compact' | 'tight'

/** Structural counterpart of the application-layer ConsumerProfile. Keeping
 * this core utility independent of React/provider code makes it reusable in
 * tests and non-UI pipelines. */
export interface ClinicalContextProfile {
  selection: DataSelection
  filters: DataFilters
  documentMode: DocumentMode
  documentIds: string[]
}

export interface ClinicalContextFitCandidate {
  tier: ClinicalContextFitTier
  profile: ClinicalContextProfile
  /** Shared budget for the selected document bodies. Undefined means full text. */
  documentTokenBudget?: number
}

/** Which limit made this request smaller than the saved scope.
 *  - `context-window`: the model's window (every caller).
 *  - `local-latency`: a caller-supplied latency budget that is tighter than
 *    the window — the request would have fit, but its prefill would not finish
 *    in a usable time on a slow (on-prem) model. */
export type ClinicalContextAdaptationReason = 'context-window' | 'local-latency'

export interface ClinicalContextAdaptation {
  tier: Exclude<ClinicalContextFitTier, 'full'>
  reason: ClinicalContextAdaptationReason
  contextLimit: number
  targetTokens: number
  originalTokens: number
  adaptedTokens: number
}

/**
 * The token target one fitted request walks the tiers toward, and which limit
 * set it. A latency budget only ever LOWERS the window-derived target; when it
 * is absent, invalid, or not tighter than the window, the window decides
 * exactly as before.
 */
export function resolveClinicalContextTarget(
  windowTargetTokens: number,
  latencyBudgetTokens?: number,
): { targetTokens: number; reason: ClinicalContextAdaptationReason } {
  if (
    typeof latencyBudgetTokens !== 'number' ||
    !Number.isFinite(latencyBudgetTokens) ||
    latencyBudgetTokens <= 0
  ) {
    return { targetTokens: windowTargetTokens, reason: 'context-window' }
  }
  const budget = Math.max(1, Math.floor(latencyBudgetTokens))
  return budget < windowTargetTokens
    ? { targetTokens: budget, reason: 'local-latency' }
    : { targetTokens: windowTargetTokens, reason: 'context-window' }
}

/**
 * The entries of `scopeCatalog` (the saved scope's catalog, whose keys the
 * result and the UI resolve against) for the records a narrower fitted view
 * kept. Catalog keys are positional per scope, so the narrower view's own
 * catalog cannot be shown to the model beside a result that is finalised
 * against the wider one: a key is never renumbered here, exactly as the
 * overview snapshot keeps its subset of the caller's keys.
 */
export function catalogSubsetForFittedScope(
  scopeCatalog: readonly SummarySourceCatalogEntry[],
  fittedCatalog: readonly SummarySourceCatalogEntry[],
): SummarySourceCatalogEntry[] {
  const kept = new Set(fittedCatalog.map((entry) => `${entry.resourceType}\u0000${entry.resourceId}`))
  return scopeCatalog.filter((entry) => kept.has(`${entry.resourceType}\u0000${entry.resourceId}`))
}

const TIME_RANGE_ORDER: TimeRange[] = [
  '24h',
  '3d',
  '1w',
  '1m',
  '3m',
  '6m',
  '1y',
  '3y',
  '5y',
  'all',
]

function capTimeRange(value: TimeRange, maximum: TimeRange): TimeRange {
  // This event-based range is already patient-specific and normally narrower
  // than a fixed wall-clock cap. Preserve it instead of guessing its width.
  if (value === 'sinceLastVisit') return value
  const valueIndex = TIME_RANGE_ORDER.indexOf(value)
  const maximumIndex = TIME_RANGE_ORDER.indexOf(maximum)
  return valueIndex <= maximumIndex ? value : maximum
}

function capLabDepth(
  value: DataFilters['labDepth'],
  maximum: 'latest' | '3' | '8',
): DataFilters['labDepth'] {
  if (maximum === 'latest') return 'latest'
  const order: DataFilters['labDepth'][] = ['latest', '3', '8', '16', 'all']
  return order.indexOf(value) <= order.indexOf(maximum) ? value : maximum
}

const MIN_REQUEST_OVERHEAD_RESERVE = 8_000
const MAX_REQUEST_OVERHEAD_RESERVE = 32_000
const REQUEST_OVERHEAD_RESERVE_FRACTION = 0.15

/**
 * Reserve a bounded amount for system instructions, output contracts and the
 * source catalog instead of limiting every model to a fixed fraction of its
 * window. Small windows keep at least 8K of headroom; larger windows reserve
 * 15%, capped at 32K so a large model can use the capacity it actually has.
 * The complete assembled request is still checked against the hard usable
 * limit immediately before generation.
 */
export function clinicalContextTokenTarget(contextLimit: number): number {
  const usable = Math.max(1, Math.round(contextLimit) - DEFAULT_RESPONSE_RESERVE)
  const requestOverheadReserve = Math.min(
    MAX_REQUEST_OVERHEAD_RESERVE,
    Math.max(
      MIN_REQUEST_OVERHEAD_RESERVE,
      Math.ceil(usable * REQUEST_OVERHEAD_RESERVE_FRACTION),
    ),
  )
  return Math.max(1, usable - requestOverheadReserve)
}

/**
 * Build a transient, progressively smaller view over the saved Data Selection
 * profile. Nothing here mutates or persists the user's profile.
 */
export function buildClinicalContextFitCandidate(
  base: ClinicalContextProfile,
  tier: ClinicalContextFitTier,
  targetTokens: number,
): ClinicalContextFitCandidate {
  const normalizedBase: ClinicalContextProfile = {
    // Preserve immutable provider references so document-only changes do not
    // invalidate unrelated laboratory, encounter and medication calculations.
    selection: base.selection,
    filters: base.filters,
    documentMode: base.documentMode ?? DEFAULT_DOCUMENT_MODE,
    documentIds: base.documentIds ?? [],
  }
  if (tier === 'full' || tier === 'prioritized') {
    return { tier, profile: normalizedBase }
  }

  const trimmed = tier === 'trimmed'
  const compact = tier === 'compact'
  const filters: DataFilters = {
    ...normalizedBase.filters,
    // Keep the saved categories, but narrow their histories in visible,
    // deterministic steps before considering record-by-record selection.
    // Active problems remain available at every tier.
    problemListStatus: trimmed
      ? normalizedBase.filters.problemListStatus
      : 'active',
    encounterTimeRange: capTimeRange(
      normalizedBase.filters.encounterTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    medicationStatus: trimmed || compact
      ? normalizedBase.filters.medicationStatus
      : 'active',
    medicationTimeRange: capTimeRange(
      normalizedBase.filters.medicationTimeRange,
      // The tight tier keeps every currently active medication even when its
      // original order is older than three months.
      trimmed ? '1y' : compact ? '6m' : 'all',
    ),
    labDepth: capLabDepth(
      normalizedBase.filters.labDepth,
      trimmed ? '8' : compact ? '3' : 'latest',
    ),
    labReportTimeRange: capTimeRange(
      normalizedBase.filters.labReportTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    imagingReportVersion: trimmed
      ? normalizedBase.filters.imagingReportVersion
      : 'latest',
    imagingReportTimeRange: capTimeRange(
      normalizedBase.filters.imagingReportTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    vitalSignsVersion: trimmed
      ? normalizedBase.filters.vitalSignsVersion
      : 'latest',
    vitalSignsTimeRange: capTimeRange(
      normalizedBase.filters.vitalSignsTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    procedureTimeRange: capTimeRange(
      normalizedBase.filters.procedureTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    observationVersion: trimmed
      ? normalizedBase.filters.observationVersion
      : 'latest',
    observationTimeRange: capTimeRange(
      normalizedBase.filters.observationTimeRange,
      trimmed ? '1y' : compact ? '6m' : '3m',
    ),
    carePlanStatus: trimmed
      ? normalizedBase.filters.carePlanStatus
      : 'active',
  }

  return {
    tier,
    profile: {
      selection: {
        ...normalizedBase.selection,
        // Standalone observations are the lowest-signal, highest-duplication
        // category once the tight tier is required. Labs, imaging and vitals
        // remain selected independently.
        observations: trimmed || compact
          ? normalizedBase.selection.observations
          : false,
      },
      filters,
      // A bounded context includes one clinically meaningful document rather
      // than silently dropping all discharge evidence.
      documentMode: 'latestAdmission',
      documentIds: [],
    },
    // Full discharge summaries can dominate a 32k window. Keep their beginning
    // and end under a shared sub-budget; shorter notes remain untouched.
    documentTokenBudget: Math.max(
      1,
      Math.min(
        targetTokens,
        Math.max(
          2_500,
          Math.floor(targetTokens * (trimmed ? 0.6 : compact ? 0.45 : 0.35)),
        ),
      ),
    ),
  }
}

export function nextClinicalContextFitTier(
  tier: ClinicalContextFitTier,
): ClinicalContextFitTier {
  if (tier === 'full') return 'trimmed'
  if (tier === 'trimmed') return 'compact'
  if (tier === 'compact') return 'tight'
  if (tier === 'tight') return 'prioritized'
  return 'prioritized'
}

const CONTEXT_OMISSION_MARKER =
  '\n\n[... older or lower-priority clinical context omitted to fit the selected model ...]\n\n'

/**
 * Last-resort bound after semantic filtering has reached the tight tier.
 * Preserve both the high-priority opening sections and the newest coverage /
 * document tail rather than relying on a provider to truncate the request at
 * an arbitrary byte boundary.
 */
export function fitClinicalContextTextToTokenBudget(
  text: string,
  maxTokens: number,
): string {
  if (!text || estimateTokens(text) <= maxTokens) return text
  const markerTokens = estimateTokens(CONTEXT_OMISSION_MARKER)
  if (maxTokens <= markerTokens) {
    let prefix = CONTEXT_OMISSION_MARKER.trim()
    while (prefix && estimateTokens(prefix) > maxTokens) {
      prefix = prefix.slice(0, Math.floor(prefix.length * 0.75))
    }
    return prefix
  }

  let low = 0
  let high = text.length
  let best = CONTEXT_OMISSION_MARKER.trim()
  while (low <= high) {
    const keptCharacters = Math.floor((low + high) / 2)
    // The opening contains patient/problems/active therapy and is slightly
    // more valuable than the tail, so retain a 60/40 split.
    const headCharacters = Math.ceil(keptCharacters * 0.6)
    const tailCharacters = keptCharacters - headCharacters
    const candidate = `${text.slice(0, headCharacters)}${CONTEXT_OMISSION_MARKER}${
      tailCharacters > 0 ? text.slice(-tailCharacters) : ''
    }`
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate
      low = keptCharacters + 1
    } else {
      high = keptCharacters - 1
    }
  }
  return best
}

function adaptationScopeDescription(
  tier: ClinicalContextAdaptation['tier'],
  zh: boolean,
): string {
  if (tier === 'trimmed') {
    return zh
      ? '最多最近 1 年的主要病歷、每項最多 8 筆檢驗，以及最近一次出院病摘'
      : 'up to 1 year of key records, up to 8 results per lab, and the latest discharge summary'
  }
  if (tier === 'compact') {
    return zh
      ? '最多最近 6 個月的主要病歷、每項最多 3 筆檢驗，以及最近一次出院病摘'
      : 'up to 6 months of key records, up to 3 results per lab, and the latest discharge summary'
  }
  return zh
    ? '最多最近 3 個月的主要病歷、每項最新檢驗，以及精簡後的最近一次出院病摘'
    : 'up to 3 months of key records, the latest result per lab, and a condensed latest discharge summary'
}

/**
 * Latency wording: the request would have fit the window, so naming the
 * window would misstate why the scope shrank. The source index is NOT said to
 * be rebuilt — under a latency budget the result keeps the saved scope's
 * source list; only this request's clinical text is narrower.
 */
function formatLatencyAdaptationNotice(
  adaptation: ClinicalContextAdaptation,
  locale: string,
): string {
  const zh = locale === 'zh-TW'
  const adaptedLabel = formatApproxTokenCount(adaptation.adaptedTokens)
  if (adaptation.tier === 'prioritized') {
    return zh
      ? `為了讓模型在合理時間內回覆，本次逐筆保留活動中問題、過敏、目前用藥、異常與最新檢驗及近期重要紀錄，再從最舊且低優先的資料開始暫時縮減（約 ${adaptedLabel} tokens）。你儲存的資料範圍沒有變更。`
      : `To keep this model's reply time reasonable, this run retained active problems, allergies, current medications, abnormal/latest tests, and recent important records first, then temporarily removed older low-priority records (about ${adaptedLabel} tokens). Your saved data scope was not changed.`
  }
  const scope = adaptationScopeDescription(adaptation.tier, zh)
  return zh
    ? `為了讓模型在合理時間內回覆，本次暫時使用${scope}（約 ${adaptedLabel} tokens）。你儲存的資料範圍沒有變更。`
    : `To keep this model's reply time reasonable, this run is temporarily using ${scope} (about ${adaptedLabel} tokens). Your saved data scope was not changed.`
}

export function formatClinicalContextAdaptationNotice(
  adaptation: ClinicalContextAdaptation,
  locale: string,
): string {
  if (adaptation.reason === 'local-latency') {
    return formatLatencyAdaptationNotice(adaptation, locale)
  }
  const contextLabel = formatApproxTokenCount(adaptation.contextLimit)
  if (adaptation.tier === 'prioritized') {
    const adaptedLabel = formatApproxTokenCount(adaptation.adaptedTokens)
    return locale === 'zh-TW'
      ? `已依模型 ${contextLabel} 內容視窗，逐筆保留活動中問題、過敏、目前用藥、異常與最新檢驗及近期重要紀錄，再從最舊且低優先的資料開始縮減至約 ${adaptedLabel} tokens。來源索引已依實際保留內容重建；你儲存的資料範圍沒有變更。`
      : `For this model's ${contextLabel}-token context window, active problems, allergies, current medications, abnormal/latest tests, and recent important records were retained first; older low-priority records were then removed record by record to about ${adaptedLabel} tokens. The source index was rebuilt from the retained content, and your saved data scope was not changed.`
  }
  if (adaptation.tier === 'trimmed') {
    return locale === 'zh-TW'
      ? `已依模型 ${contextLabel} 內容視窗，暫時使用最多最近 1 年的主要病歷、每項最多 8 筆檢驗，以及最近一次出院病摘。來源索引已依實際保留內容重建；你儲存的資料範圍沒有變更。`
      : `For this model's ${contextLabel}-token context window, this run temporarily uses up to 1 year of key records, up to 8 results per lab, and the latest discharge summary. The source index was rebuilt from retained content, and your saved data scope was not changed.`
  }
  const scopeDescription = adaptationScopeDescription(adaptation.tier, locale === 'zh-TW')
  return locale === 'zh-TW'
    ? `已依模型 ${contextLabel} 內容視窗，暫時使用${scopeDescription}。你儲存的資料範圍沒有變更。`
    : `For this model's ${contextLabel}-token context window, this run is temporarily using ${scopeDescription}. Your saved data scope was not changed.`
}
