import { isVghtpeSource } from '@/src/shared/utils/clinical-source-identity'
import {
  hospitalMedicationNameKey,
  VGHTPE_MEDICATION_IDENTITY_URL,
  vghtpeMedicationIdentityExtension,
} from '@/src/shared/utils/hospital-medication-index'

type Resource = Record<string, any>
const HOSPITAL_NAME_SYSTEMS = new Set([
  'urn:oid:vgh.medication.generic', 'urn:oid:vgh.medication.product', 'urn:oid:vgh.medication.name',
])

/**
 * Check each VGH hospital MedicationRequest against the VGH medication index
 * and mark it; the mark carries the NHI codes when its recorded names resolve
 * to exactly one drug identity (the generic and product fields of one row
 * must not name two). Source codings stay untouched; the index is loaded only
 * when the Bundle holds hospital orders, and a previous mark is replaced.
 */
export async function markVghtpeMedicationIdentities(bundle: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entries = Array.isArray(bundle.entry) ? bundle.entry as Array<{ resource?: Resource }> : []
  const orders = entries.flatMap((entry, index) => entry.resource?.resourceType === 'MedicationRequest'
    && isVghtpeSource(entry.resource) ? [index] : [])
  if (!orders.length) return bundle
  const { default: index } = await import('../data/vghtpe-medication-index.generated.json')
  const byName = new Map<string, string[]>()
  for (const item of index.items) for (const name of item.names) byName.set(hospitalMedicationNameKey(name), item.nhiCodes)

  let changed = false
  const nextEntries = [...entries]
  for (const entryIndex of orders) {
    const order = entries[entryIndex].resource!
    const identities = new Map<string, string[]>()
    for (const coding of order.medicationCodeableConcept?.coding ?? []) {
      if (!HOSPITAL_NAME_SYSTEMS.has(coding?.system)) continue
      for (const name of new Set([coding.code, coding.display].filter(value => typeof value === 'string'))) {
        const codes = byName.get(hospitalMedicationNameKey(name))
        if (codes) identities.set(codes.join(','), codes)
      }
    }
    const kept = (order.extension ?? []).filter((extension: any) => extension?.url !== VGHTPE_MEDICATION_IDENTITY_URL)
    const extension = [...kept, vghtpeMedicationIdentityExtension(index.sourceSha256,
      identities.size === 1 ? [...identities.values()][0] : [])]
    if (JSON.stringify(extension) === JSON.stringify(order.extension ?? [])) continue
    nextEntries[entryIndex] = { ...entries[entryIndex], resource: { ...order, extension } }
    changed = true
  }
  return changed ? { ...bundle, entry: nextEntries } : bundle
}
