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
  const names = (patient.name ?? []).map((name) => name.text?.trim()).filter((text): text is string => Boolean(text))

  const mrn = patient.identifier?.find((identifier) =>
    identifier.system?.trim() === HOSPITAL_MRN_SYSTEM && identifier.value?.trim())?.value?.trim()
  if (mrn) return `${HEALTH_APP_ORIGIN}/open#${new URLSearchParams({ chart: mrn })}`

  if (!isVghtpeLaunchUrl(pageUrl)) return null
  const birth = patient.birthDate?.trim() ?? ''
  if (names.length === 1 && !MASKED_NAME.test(names[0]) && BIRTH_DATE.test(birth)) {
    return `${HEALTH_APP_ORIGIN}/open#${new URLSearchParams({ name: names[0], birth })}`
  }
  return `${HEALTH_APP_ORIGIN}/`
}
