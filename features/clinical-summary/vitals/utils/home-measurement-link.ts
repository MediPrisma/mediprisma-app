// Link from the vitals card to the hospital's home-measurement service
// (mediprisma-health-app-bridge), which only the hospital network reaches.
//
// The patient travels after "#": the browser never sends it to that server or
// its logs, and the service looks the patient up with a POST.
import { isVghtpeLaunchUrl } from '@/src/application/launch/medcloud-launch-context'
import type { PatientEntity } from '@/src/core/entities/patient.entity'

export const HEALTH_APP_ORIGIN = 'https://health-app.mediprisma.tw'

/** The North VGH exporter (懷爾抓抓) writes the 病歷號 under this system. */
const HOSPITAL_MRN_SYSTEM = 'urn:oid:his.patient.mrn'
const MASKED_NAME = /[Xx*＊○〇●Ｏ◯]/u
const BIRTH_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Hospital data (a 病歷號): open that patient. Cloud data only, in the
 * hospital's own launch (`site=vghtpe`): name and birth date, which the
 * service only offers as candidates to confirm; without a usable name and
 * birth date, the service's home page. Another site without a 病歷號 gets no
 * link. De-identification is not considered: it matters only for what is sent
 * to AI, and the doctor opening this service sees the hospital's own records.
 */
export function homeMeasurementLink(patient: PatientEntity | null, pageUrl: string): string | null {
  if (!patient) return null
  const query = homeLookupQuery(patient, pageUrl)
  if (query && 'chart' in query) return `${HEALTH_APP_ORIGIN}/open#${new URLSearchParams({ chart: query.chart })}`
  // The service's page offers name matches only with a birth date to check them by.
  if (query?.birthDate) return `${HEALTH_APP_ORIGIN}/open#${new URLSearchParams({ name: query.name, birth: query.birthDate })}`
  return isVghtpeLaunchUrl(pageUrl) ? `${HEALTH_APP_ORIGIN}/` : null
}

/** Who to ask the service about: the 病歷號, or the name with the birth date when there is one. */
export type HomeLookupQuery = { chart: string; birthDate?: undefined } | { name: string; birthDate?: string }

/**
 * The 病歷號 when the hospital's records are in. Before they are (they arrive
 * after the cloud data, often after the visit has started), in the hospital's
 * own launch only: an unmasked single name, and the birth date if any. The
 * service answers a name with readings only when it leads to one 病歷號 on its
 * lists; a repeated name is left to the doctor (user, 2026-11-10).
 */
export function homeLookupQuery(patient: PatientEntity | null, pageUrl: string): HomeLookupQuery | null {
  if (!patient) return null
  const mrn = hospitalChart(patient)
  if (mrn) return { chart: mrn }
  if (!isVghtpeLaunchUrl(pageUrl)) return null
  const names = (patient.name ?? []).map((name) => name.text?.trim()).filter((text): text is string => Boolean(text))
  const birth = patient.birthDate?.trim() ?? ''
  if (names.length !== 1 || MASKED_NAME.test(names[0])) return null
  return BIRTH_DATE.test(birth) ? { name: names[0], birthDate: birth } : { name: names[0] }
}

/** The hospital 病歷號, when the patient came from the hospital's own records. */
export function hospitalChart(patient: PatientEntity | null): string | null {
  return patient?.identifier?.find((identifier) =>
    identifier.system?.trim() === HOSPITAL_MRN_SYSTEM && identifier.value?.trim())?.value?.trim() ?? null
}
