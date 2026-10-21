// Which bridge produced the clinical data. The summary harness describes the
// data and weighs its diagnosis codes differently per source: the NHI cloud
// record (雲端病歷) carries one primary diagnosis per visit and names a
// pharmacy as the requester of a refill, while 健康存摺 keeps primary and
// secondary codes. Read from each resource's own provenance, never guessed
// from content.

import { MEDCLOUD_FHIR_BASE } from '@/src/shared/constants/medcloud.constants'

export type ClinicalDataSource = 'nhi-medcloud' | 'nhi-health-bank' | 'other'

type ProvenancedResource = {
  meta?: { source?: string; tag?: Array<{ system?: string }> }
}

interface ClinicalDataSourceInput {
  observations?: ProvenancedResource[]
  diagnosticReports?: ProvenancedResource[]
  medications?: ProvenancedResource[]
  encounters?: ProvenancedResource[]
}

const MEDCLOUD_HOST = 'medcloud2.nhi.gov.tw'

/** The host a provenance string names, with or without a scheme. */
function sourceHost(source: string): string {
  try {
    return new URL(source).hostname.toLowerCase()
  } catch {
    return source.split('/')[0].toLowerCase()
  }
}

const isMedcloud = (resource: ProvenancedResource): boolean =>
  sourceHost(resource.meta?.source ?? '') === MEDCLOUD_HOST ||
  (resource.meta?.tag ?? []).some((tag) => (tag.system ?? '').startsWith(`${MEDCLOUD_FHIR_BASE}/`))

const HEALTH_BANK_HOST = 'nhi-fhir-bridge.github.io'

/** The 健康存摺 scraper ("nhi-fhir-bridge/scraper") or its SDK-JSON importer
 *  ("https://nhi-fhir-bridge.github.io/source/…"). */
const isHealthBank = (resource: ProvenancedResource): boolean => {
  const source = resource.meta?.source ?? ''
  return (/^nhi-fhir-bridge(?:\/|$)/.test(source) || sourceHost(source) === HEALTH_BANK_HOST) && !isMedcloud(resource)
}

/** The bridge behind the data; a chart mixing both NHI bridges, or neither,
 *  is 'other' and gets the neutral description. */
export function detectClinicalDataSource(data: ClinicalDataSourceInput | null | undefined): ClinicalDataSource {
  if (!data) return 'other'
  const resources = [
    ...(data.observations ?? []),
    ...(data.diagnosticReports ?? []),
    ...(data.medications ?? []),
    ...(data.encounters ?? []),
  ]
  const medcloud = resources.some(isMedcloud)
  const healthBank = resources.some(isHealthBank)
  if (medcloud && !healthBank) return 'nhi-medcloud'
  if (healthBank && !medcloud) return 'nhi-health-bank'
  return 'other'
}
