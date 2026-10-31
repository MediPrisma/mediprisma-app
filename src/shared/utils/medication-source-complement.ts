import {
  MEDCLOUD_ATC_LEVEL_3_URL,
  MEDCLOUD_SOURCE_DRUG_CLASS_URL,
  MEDCLOUD_SOURCE_SETTING_URL,
} from '@/src/shared/constants/medcloud.constants'
import { isMedcloudSource } from './clinical-source-identity'
import { formatOrganizationDisplay } from './organization-display'

// Context the MediCloud copy records and the hospital order usually lacks.
// Clinical facts (status, dates, dosage, supply, quantity, notes, identifiers,
// drug code) are deliberately absent: the hospital order owns them.
export const VISIT_CONTEXT_EXTENSION_URLS: readonly string[] = [MEDCLOUD_SOURCE_SETTING_URL, MEDCLOUD_ATC_LEVEL_3_URL, MEDCLOUD_SOURCE_DRUG_CLASS_URL]

const isEmpty = (value: unknown) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0)

/** The value every cloud copy records identically, else undefined. */
function agreed<V>(cloud: readonly any[], read: (record: any) => V | undefined): V | undefined {
  const values = cloud.map(read)
  if (!values.length || values.some(isEmpty)) return undefined
  const first = JSON.stringify(values[0])
  return values.every(value => JSON.stringify(value) === first) ? values[0] : undefined
}

/**
 * The hospital record that stands for a hospital/MediCloud group, carrying
 * the visit context its MediCloud copies showed: institution with care
 * setting, billing diagnosis, drug class and ATC level-3 class. Folding the
 * duplicate row must not drop what either row showed, and the list, the
 * timeline, AI and CDSS read this same record. Only fields the hospital record
 * lacks are added, only when every cloud copy agrees; nothing is overwritten
 * and the input is not mutated.
 */
export function complementHospitalFromCloud<T extends Record<string, any>>(hospital: T, sources: readonly any[]): T {
  const cloud = sources.filter(source => source && source !== hospital && source.id !== hospital.id && isMedcloudSource(source))
  if (!cloud.length) return hospital
  const patch: Record<string, any> = {}

  const requester = agreed(cloud, record => record.requester?.display ? record.requester : undefined)
  const hospitalInstitution = typeof hospital.requester?.display === 'string' ? formatOrganizationDisplay(hospital.requester.display) : ''
  // Same institution: the cloud display may also carry the care setting
  // ("臺北榮總;門診"). A different institution is never substituted.
  if (requester && (!hospitalInstitution || formatOrganizationDisplay(requester.display) === hospitalInstitution)) {
    patch.requester = requester
  }

  const extensions = VISIT_CONTEXT_EXTENSION_URLS.flatMap((url) => {
    if (hospital.extension?.some((extension: any) => extension?.url === url)) return []
    const extension = agreed(cloud, record => record.extension?.find((item: any) => item?.url === url))
    return extension ? [extension] : []
  })
  if (extensions.length) patch.extension = [...(hospital.extension ?? []), ...extensions]

  if (isEmpty(hospital.reasonCode)) {
    const reasonCode = agreed(cloud, record => record.reasonCode)
    if (reasonCode) patch.reasonCode = reasonCode
  }
  if (isEmpty(hospital.category)) {
    const category = agreed(cloud, record => record.category)
    if (category) patch.category = category
  }
  return Object.keys(patch).length ? { ...hospital, ...patch } : hospital
}
