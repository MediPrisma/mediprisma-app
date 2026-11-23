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

/** The drug-master ingredient text when the identity's products share one
 * wording; when they word the salt differently ("BISOPROLOL FUMARATE … |
 * BISOPROLOL HEMIFUMARATE …"), the identity's own ingredient and strength,
 * so no one salt is claimed for the order. */
function identityIngredientText(item: { ingredientText?: string; identity?: { ingredients?: Array<{ name?: string; amount?: string }> } }): string | undefined {
  const text = item.ingredientText?.trim()
  if (text && !text.includes('|')) return text
  const parts = (item.identity?.ingredients ?? []).filter(part => part.name && part.amount)
    .map(part => `${part.name} ${part.amount!.replace(/^([\d.]+)/, '$1 ')}`)
  return parts.length ? parts.join('+') : undefined
}

/**
 * Check each VGH hospital MedicationRequest against the VGH medication index
 * and mark it; the mark carries the NHI codes and ingredient text when its
 * recorded names resolve to exactly one drug identity (the generic and product fields of one row
 * must not name two). Source codings stay untouched; the index is loaded only
 * when the Bundle holds hospital orders, and a previous mark is replaced.
 */
export async function markVghtpeMedicationIdentities(bundle: Record<string, unknown>): Promise<Record<string, unknown>> {
  const entries = Array.isArray(bundle.entry) ? bundle.entry as Array<{ resource?: Resource }> : []
  const orders = entries.flatMap((entry, index) => entry.resource?.resourceType === 'MedicationRequest'
    && isVghtpeSource(entry.resource) ? [index] : [])
  if (!orders.length) return bundle
  const { default: index } = await import('../data/vghtpe-medication-index.generated.json')
  type Identity = { nhiCodes: string[]; ingredientText?: string }
  const byName = new Map<string, Identity>()
  for (const item of index.items) {
    const identity = { nhiCodes: item.nhiCodes, ingredientText: identityIngredientText(item) }
    for (const name of item.names) byName.set(hospitalMedicationNameKey(name), identity)
  }

  let changed = false
  const nextEntries = [...entries]
  for (const entryIndex of orders) {
    const order = entries[entryIndex].resource!
    const identities = new Map<string, Identity>()
    for (const coding of order.medicationCodeableConcept?.coding ?? []) {
      if (!HOSPITAL_NAME_SYSTEMS.has(coding?.system)) continue
      for (const name of new Set([coding.code, coding.display].filter(value => typeof value === 'string'))) {
        const identity = byName.get(hospitalMedicationNameKey(name))
        if (identity) identities.set(identity.nhiCodes.join(','), identity)
      }
    }
    const kept = (order.extension ?? []).filter((extension: any) => extension?.url !== VGHTPE_MEDICATION_IDENTITY_URL)
    const identity = identities.size === 1 ? [...identities.values()][0] : undefined
    const extension = [...kept, vghtpeMedicationIdentityExtension(index.sourceSha256,
      identity?.nhiCodes ?? [], identity?.ingredientText)]
    if (JSON.stringify(extension) === JSON.stringify(order.extension ?? [])) continue
    nextEntries[entryIndex] = { ...entries[entryIndex], resource: { ...order, extension } }
    changed = true
  }
  return changed ? { ...bundle, entry: nextEntries } : bundle
}
