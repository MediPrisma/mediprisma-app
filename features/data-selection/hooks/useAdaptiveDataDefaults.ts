"use client"

// Adaptive default for data-sparse patients: when a patient's WHOLE record is
// small enough to fit comfortably, default to 全部資料 (all categories +
// all-time windows + all documents) so nothing is needlessly hidden. For a
// data-heavy patient (ICU / onco) the factory 初診 window still applies.
//
// Why a TOKEN estimate, not a record count: documents dominate context size —
// a single discharge summary can be ~10k tokens while a chatty outpatient may
// have hundreds of tiny structured rows. Counting records alone would both
// miss a small-but-document-heavy patient and needlessly widen a
// many-visits-but-tiny-notes patient. So we estimate the actual context weight.
//
// Guardrails so this never fights the user:
//  • only when the 初診 template is active AND filters are still pristine
//    factory defaults (the moment the user tweaks anything, we stop);
//  • a 雲端病歷 record that is not small takes its whole year instead of the
//    6-month window (owner decision 2026-10-03), silently;
//  • once per chart (source + per-list count and first/last ids, reset when
//    the data clears), so re-renders don't re-apply and a same-size new chart
//    is still evaluated;
//  • the cloud-record year is reverted only when this rule set it (a marker in
//    localStorage) and the user has not changed it; a year chosen by hand stays;
//  • reversible — 還原範本預設 restores the 6-month factory filters;
//  • a one-time toast tells the user why the whole record was pulled in.
import { useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { useDataSelection } from "@/src/application/providers/data-selection.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useOpenAiCompatibleProfiles } from "@/src/application/stores/ai-config.store"
import { DEFAULT_DATA_FILTERS, MEDCLOUD_YEAR_DATA_FILTERS } from "@/src/shared/constants/data-selection.constants"
import { detectClinicalDataSource, type ClinicalDataSource } from "@/src/core/utils/clinical-data-source.utils"
import { estimateTokens } from "@/src/shared/utils/token-estimator"
import { listClinicalDocuments } from "@/src/core/utils/clinical-documents.utils"
import { clinicalContextTokenTarget } from "@/src/core/utils/adaptive-clinical-context.utils"
import { isOpenAiCompatibleRuntimeReady } from "@/src/shared/utils/openai-compatible.utils"
import { normalizeOpenAiCompatibleContextWindow } from "@/src/shared/types/openai-compatible.types"
import type { DataFilters } from "@/src/core/entities/clinical-context.entity"
import type { ClinicalDataCollection } from "@/src/core/entities/clinical-data.entity"

// Maximum used when every configured model has ample room. Smaller custom
// context windows lower this threshold dynamically.
export const AUTO_SELECT_ALL_TOKENS = 40_000

/** Conservative auto-all threshold for the smallest ready custom endpoint. */
export function autoSelectAllTokenLimit(
  readyContextWindows: readonly number[],
): number {
  return readyContextWindows.reduce(
    (limit, contextWindow) => Math.min(
      limit,
      clinicalContextTokenTarget(contextWindow),
    ),
    AUTO_SELECT_ALL_TOKENS,
  )
}

// Skip the (document-decoding) estimate entirely above this structured-record
// count: such a patient is unambiguously data-heavy, so there's no point
// decoding their documents just to confirm they're over budget.
const HARD_SKIP_STRUCTURED = 600

// Rough tokens-per-structured-record. Deliberately generous (labs fold into
// per-analyte trends, so raw counts over-estimate) — an over-estimate only ever
// makes us MORE conservative about auto-selecting, never less.
const TOKENS_PER_RECORD = 15

const STRUCTURED_KEYS = [
  'observations',
  'diagnosticReports',
  'imagingStudies',
  'medications',
  'procedures',
  'encounters',
  'conditions',
  'vitalSigns',
  'immunizations',
  'allergies',
  'carePlans',
  'devices',
  'consents',
]

function countStructured(data: ClinicalDataCollection): number {
  const d = data as unknown as Record<string, unknown[]>
  return STRUCTURED_KEYS.reduce((sum, k) => sum + (Array.isArray(d[k]) ? d[k].length : 0), 0)
}

/** Estimate the context-token weight of the patient's ENTIRE record. Exported
 *  for testing. */
export function estimateFullRecordTokens(data: ClinicalDataCollection): number {
  const structured = countStructured(data)
  if (structured > HARD_SKIP_STRUCTURED) return Number.POSITIVE_INFINITY
  const structuredTokens = structured * TOKENS_PER_RECORD
  // Documents are the dominant, variable term — decode (cached) every document
  // and sum its real token weight.
  const docTokens = listClinicalDocuments(
    data as unknown as Parameters<typeof listClinicalDocuments>[0],
  ).reduce((sum, doc) => sum + estimateTokens(doc.text), 0)
  return structuredTokens + docTokens
}

const sameFilters = (a: DataFilters, b: DataFilters): boolean =>
  (Object.keys(b) as (keyof DataFilters)[]).every((k) => a[k] === b[k])

export type AdaptiveFiltersAction =
  | { kind: 'select-all' }
  | { kind: 'set-filters'; filters: DataFilters }
  | { kind: 'none' }

/**
 * What the 初診 defaults become for this record, while the user has not
 * touched them: the factory filters, or the cloud-record year this rule set
 * itself (`autoApplied` — the same values chosen by hand are the user's and
 * are never reset). A small record takes everything; a 雲端病歷 record takes
 * its whole year; any other record keeps — or gets back — the factory window.
 * Exported for testing.
 */
export function adaptiveFiltersAction(args: {
  filters: DataFilters
  activePreset: string
  dataSource: ClinicalDataSource
  smallRecord: boolean
  /** The current filters are the cloud-record year this rule applied and the
   *  user has not changed since. */
  autoApplied: boolean
}): AdaptiveFiltersAction {
  if (args.activePreset !== 'newPatient') return { kind: 'none' }
  const factory = sameFilters(args.filters, DEFAULT_DATA_FILTERS)
  const ruleYear = args.autoApplied && sameFilters(args.filters, MEDCLOUD_YEAR_DATA_FILTERS)
  if (!factory && !ruleYear) return { kind: 'none' }
  if (args.smallRecord) return { kind: 'select-all' }
  if (args.dataSource === 'nhi-medcloud') {
    return ruleYear ? { kind: 'none' } : { kind: 'set-filters', filters: { ...MEDCLOUD_YEAR_DATA_FILTERS } }
  }
  return ruleYear ? { kind: 'set-filters', filters: { ...DEFAULT_DATA_FILTERS } } : { kind: 'none' }
}

// Remembers, across reloads, that the current window is the cloud-record year
// this rule applied — not one the user picked. Cleared the moment the filters
// leave that year (a user edit, a reset, another template).
const AUTO_WINDOW_KEY = 'clinicalDataAutoWindow'
const readAutoWindow = (): boolean => {
  try { return globalThis.localStorage?.getItem(AUTO_WINDOW_KEY) === 'medcloud-year' } catch { return false }
}
const writeAutoWindow = (on: boolean): void => {
  try {
    if (on) globalThis.localStorage?.setItem(AUTO_WINDOW_KEY, 'medcloud-year')
    else globalThis.localStorage?.removeItem(AUTO_WINDOW_KEY)
  } catch { /* private mode: the rule just never reverts */ }
}

/** Which chart this is: its source and, per resource list, the count and the
 *  first and last ids. Two charts with the same number of records — a new
 *  patient, another import — still read as different. Exported for testing. */
export function chartSignature(data: ClinicalDataCollection, source: ClinicalDataSource): string {
  const d = data as unknown as Record<string, Array<{ id?: string }> | undefined>
  return [source, ...STRUCTURED_KEYS.map((k) => {
    const list = Array.isArray(d[k]) ? d[k]! : []
    return `${list.length}:${list[0]?.id ?? ''}:${list.at(-1)?.id ?? ''}`
  })].join('|')
}

export function useAdaptiveDataDefaults(clinicalData: ClinicalDataCollection | null): void {
  const { filters, activePreset, selectAllData, setFilters } = useDataSelection()
  const { t } = useLanguage()
  const openAiCompatibleProfiles = useOpenAiCompatibleProfiles()
  const appliedSigRef = useRef<string | null>(null)
  const autoSelectThreshold = useMemo(
    () => autoSelectAllTokenLimit(
      openAiCompatibleProfiles
        .filter((profile) => isOpenAiCompatibleRuntimeReady(profile))
        .map((profile) => normalizeOpenAiCompatibleContextWindow(
          profile.contextWindowTokens,
          profile.modelId,
        )),
    ),
    [openAiCompatibleProfiles],
  )

  // The rule's year stops being the rule's once the filters leave it.
  // Declared first so a mount evaluates against an up-to-date marker.
  useEffect(() => {
    if (!sameFilters(filters, MEDCLOUD_YEAR_DATA_FILTERS)) writeAutoWindow(false)
  }, [filters])

  useEffect(() => {
    if (!clinicalData) {
      // Cleared between charts: the next one is always evaluated.
      appliedSigRef.current = null
      return
    }
    // Entities do not type `meta`; the bridge's provenance is still on them.
    const dataSource = detectClinicalDataSource(clinicalData as unknown as Parameters<typeof detectClinicalDataSource>[0])
    const sig = chartSignature(clinicalData, dataSource)
    if (appliedSigRef.current === sig) return

    const structured = countStructured(clinicalData)
    const action = adaptiveFiltersAction({
      filters,
      activePreset,
      dataSource,
      smallRecord: structured > 0 && estimateFullRecordTokens(clinicalData) <= autoSelectThreshold,
      autoApplied: readAutoWindow(),
    })
    if (action.kind === 'select-all') {
      writeAutoWindow(false)
      selectAllData()
      const ds = t.dataSelection as unknown as Record<string, string>
      toast.info(ds.autoSelectAllToast ?? '因資料量少,已自動帶入全部資料(可在「資料範圍」調整)。')
    } else if (action.kind === 'set-filters') {
      // Silent: 資料範圍 shows the window, and the hospital's Medcloud launch
      // must not raise any prompt.
      writeAutoWindow(sameFilters(action.filters, MEDCLOUD_YEAR_DATA_FILTERS))
      setFilters(action.filters)
    }
    appliedSigRef.current = sig
  }, [clinicalData, filters, activePreset, selectAllData, setFilters, t, autoSelectThreshold])
}
