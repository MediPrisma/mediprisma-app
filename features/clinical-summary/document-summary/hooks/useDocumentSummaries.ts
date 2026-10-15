// useDocumentSummaries
// Reads parsed Composition + DocumentReference resources from the clinical
// data store and adapts them into a unified DocumentEntry list (newest first)
// for DocumentSummaryCard.
//
// Source coverage:
// - Composition: IPS bundles and any other document-type bundle that ships
//   narrative-bearing sections.
// - DocumentReference: 健保存摺 discharge summaries (bridge v0.17.0+) and
//   other clinical-note attachments with inline HTML / text content. PDF /
//   image attachments are intentionally NOT included — they have dedicated
//   viewers elsewhere.
//
// Bridge data that only carries structured resources still returns `[]` here,
// so DocumentSummaryCard hides itself via FeatureCard's `isEmpty` path.
import { useMemo } from 'react'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useLanguage } from '@/src/application/providers/language.provider'
import type { DocumentEntry } from '../types'
import { buildDocumentEntries } from '../utils/document-adapter'

export interface UseDocumentSummariesReturn {
  entries: DocumentEntry[]
  isLoading: boolean
  error: Error | null
}

export function useDocumentSummaries(
  docTypeStrings: Record<string, string>,
): UseDocumentSummariesReturn {
  const {
    compositions,
    documentReferences,
    encounters,
    conditions,
    resourceReady,
    error,
  } = useClinicalData()
  // Visit context and diagnosis names require linked encounters and conditions.
  const isLoading = !resourceReady.compositions
    || !resourceReady.documentReferences
    || !resourceReady.encounters
    || !resourceReady.conditions
  // `locale` drives the primary-diagnosis text picked from the linked
  // Encounter — zh-TW uses the Chinese `text` field, en uses coding[].display.
  const { locale } = useLanguage()

  const entries = useMemo(
    () => buildDocumentEntries(compositions, documentReferences, docTypeStrings, encounters, locale, conditions),
    [compositions, documentReferences, encounters, conditions, docTypeStrings, locale],
  )

  return { entries, isLoading, error }
}
