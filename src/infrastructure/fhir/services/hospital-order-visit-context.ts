import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { MEDCLOUD_SOURCE_SETTING_URL } from '@/src/shared/constants/medcloud.constants'

type Resource = Record<string, any>

/**
 * A VGH hospital order records no institution or billing diagnosis of its own;
 * its outpatient visit does. Without them a hospital-only order (one MediCloud
 * has no copy of, such as a self-paid drug) is listed apart from the other
 * orders of its own visit, as if it came from another clinic. Complement only
 * the visit context the order lacks — institution with care setting and the
 * visit's primary diagnosis — from its visit, preferring the same-day
 * 臺北榮總 MediCloud visit it was paired with, which is what the merged orders
 * of that visit show. Clinical facts of the order are never touched.
 * Operates on the reconciled import graph, never on the stored source Bundle.
 */
export function complementHospitalOrderVisitContext(resources: Resource[]): Resource[] {
  const encounters = new Map(resources.filter(resource => resource.resourceType === 'Encounter')
    .map(resource => [`Encounter/${resource.id}`, resource]))
  for (const order of resources) {
    if (order.resourceType !== 'MedicationRequest' || !isVghtpeSource(order)) continue
    // An order paired with a MediCloud copy shows that copy's context
    // (complementHospitalFromCloud); only an order with no copy reads its visit.
    if (order._sourceRecordComparison || order._sourcePrescriptionRecords?.length) continue
    const visit = encounters.get(order.encounter?.reference)
    if (!visit || visit.class?.code !== 'AMB') continue
    // The paired cloud visit, when the pairing named exactly one.
    const partners = (visit._sourceRecordComparison?.references ?? [])
      .map((reference: string) => encounters.get(reference))
      .filter((other: Resource | undefined) => other && other !== visit && isMedcloudSource(other))
    const context = partners.length === 1 ? partners[0] : visit
    if (!order.requester?.display?.trim()) {
      const institution = String(context.serviceProvider?.display ?? visit.serviceProvider?.display ?? '').trim()
      // The institution's name as MediCloud orders resolve to it, and the visit's
      // outpatient setting in the same setting field those orders carry.
      const name = formatOrganizationDisplay(institution)
      if (name) {
        order.requester = { ...order.requester, display: name }
        if (!order.extension?.some((extension: Resource) => extension?.url === MEDCLOUD_SOURCE_SETTING_URL)) {
          order.extension = [...(order.extension ?? []), { url: MEDCLOUD_SOURCE_SETTING_URL, valueString: '門診' }]
        }
      }
    }
    if (!order.reasonCode?.length) {
      const reason = context.reasonCode?.[0] ?? visit.reasonCode?.[0]
      if (reason) order.reasonCode = [JSON.parse(JSON.stringify(reason))]
    }
  }
  return resources
}
