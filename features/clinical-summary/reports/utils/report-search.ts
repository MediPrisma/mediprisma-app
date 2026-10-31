import { observationDisplayValue } from '@/src/core/utils/observation-value.utils'
import { getAnalyteLabel } from '@voho0000/clinical-lab-normalization/canonical'
import { dateSearchTokens } from '@/src/shared/utils/date.utils'
import type { Row } from '../types'

// Match both the raw FHIR name and the canonical analyte label rendered by the
// reports UI (for example, a bridge-sent「鈉」observation is displayed as Na).
function nameMatch(obsOrComponent: any, query: string): boolean {
  const raw = (
    obsOrComponent?.code?.text
    || obsOrComponent?.code?.coding?.[0]?.display
    || ''
  ).toLowerCase()
  if (raw.includes(query)) return true

  const canonical = getAnalyteLabel(obsOrComponent)
  return canonical !== '—' && canonical.toLowerCase().includes(query)
}

/** Match the value exactly as a user sees it: comparator + result + unit. */
function resultMatch(obsOrComponent: any, query: string): boolean {
  const display = observationDisplayValue(obsOrComponent)
  if (!display) return false

  const comparator = obsOrComponent?.valueQuantity?.comparator ?? ''
  const searchableResult = `${comparator}${display.value}${display.unit ? ` ${display.unit}` : ''}`
  return searchableResult.toLowerCase().includes(query)
}

/**
 * Search observations nested inside a report row by analyte name or result.
 * Components are included because panel observations (blood pressure, CBC,
 * etc.) store their individual values there instead of on the parent.
 */
export function rowInnerMatch(row: Row, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return false

  return row.obs.some((observation: any) => {
    if (nameMatch(observation, query) || resultMatch(observation, query)) return true

    return Array.isArray(observation?.component)
      && observation.component.some((component: any) => (
        nameMatch(component, query) || resultMatch(component, query)
      ))
  })
}

/** Search a rendered report row, including members folded into display groups. */
export function rowMatchesSearch(row: Row, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return false

  const ownMatch = (
    row.title.toLowerCase().includes(query)
    || (row.rawTitle ?? '').toLowerCase().includes(query)
    || row.meta.toLowerCase().includes(query)
    || (row.institution ?? '').toLowerCase().includes(query)
    || (row.sharedReportSources?.some((source) => (
      source.title.toLowerCase().includes(query)
      || source.codes.some((code) => code.toLowerCase().includes(query))
      || source.codings.some((coding) => (
        (coding.display ?? '').toLowerCase().includes(query)
        || (coding.system ?? '').toLowerCase().includes(query)
      ))
      || (source.reportId ?? '').toLowerCase().includes(query)
      || (source.sourceRecordId ?? '').toLowerCase().includes(query)
    )) ?? false)
    || dateSearchTokens(row.effectiveDate).some((value) => value.toLowerCase().includes(query))
    || rowInnerMatch(row, query)
  )
  if (ownMatch) return true

  return row.groupedRows?.some((member) => rowMatchesSearch(member, query)) ?? false
}
