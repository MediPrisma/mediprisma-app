// Medical Summary result store + cache-key scheme, extracted from
// use-medical-summary.hook.ts so read-only consumers (IPS export's
// 帶入醫療摘要 path) can peek at generated summaries without importing the
// full generation hook graph (providers, unified AI, toasts…).
//
// Slot key format (owned by use-ai-slot-generation):
// patientId::audience::locale::model::ctx-<selected-clinical-input-signature>.
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { aiResultCacheKey } from '@/src/infrastructure/cache/encrypted-session-cache'
import type { MedicalSummaryResult } from '@/src/core/entities/medical-summary.entity'

export const SUMMARY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000

// v17: 初診快覽 — overview (headline) / problems / organ-grouped 影像與病理重點.
// A v16 entry carries 開藥前必看, 就診主因, 最近 90 天 and the per-report
// highlight list, none of which renders any more, so it must not be restored;
// older entries intentionally regenerate.
// v18: problem rows carry medicationReviewKeys (a medicine whose class does
// not treat the row, tagged 待核對), written at finalize; a v17 entry lacks it.
// medsummary35: SOURCE LIST lines carry each medicine's mechanism and
// anticholinergic burden, and alerts carry propertyReviewKeys.
// medsummary36: the anticholinergic label is printed only for a medicine
// supplied in the last 90 days.
// medsummary37: problem rows carry shortSpanChronic.
export const summaryCacheKey = (scanKey: string) => aiResultCacheKey('medsummary37', scanKey)

// Module-level per-slot result cache (survives tab switches; wiped on bundle
// import so nothing stale renders against fresh clinical data).
export const medicalSummaryStore = createAiResultStore<MedicalSummaryResult>()
