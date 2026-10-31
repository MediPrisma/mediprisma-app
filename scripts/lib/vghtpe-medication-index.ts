// Builds the public VGH hospital medication index from the local-only
// hospital/cloud drug linkage (schema hospital-cloud-drug-linkage-v1).
//
// Output contains only what a public repository may hold: complete hospital
// product names and the NHI drug-master ingredient (and, for verified items,
// the official product). Hospital item codes, drug numbers, billing codes,
// candidate code lists, evidence filenames and local paths are never copied.
//
// An item enters the index when
//   - verified_product_identity: its verified product, or
//   - review_required: every review candidate names the same ingredients and
//     amounts (salt and hydrate spellings aside), e.g. CLINDAMYCIN HCL 150 MG
//     and CLINDAMYCIN (HCL HYDRATE) 150 MG.
// insufficient_compatible_evidence items, disagreeing candidates and names
// claimed by items of different identities are left out and reported.

import { createHash } from 'node:crypto'
import { hospitalMedicationNameKey, ingredientIdentityKey } from '../../src/shared/utils/hospital-medication-index'

export const INDEX_SCHEMA_VERSION = 'vghtpe-medication-index-v1'
const SOURCE_SCHEMA_VERSION = 'hospital-cloud-drug-linkage-v1'

export interface VghtpeMedicationIndexItem {
  names: string[]
  basis: 'verified-product' | 'single-candidate-ingredient'
  ingredientText: string
  product?: { licenseId: string; officialProductUrl: string; doseForm: string; nhiCodes: string[] }
}

export interface VghtpeMedicationIndex {
  schemaVersion: typeof INDEX_SCHEMA_VERSION
  sourceSchemaVersion: string
  terminologySnapshotId: string
  sourceSha256: string
  items: VghtpeMedicationIndexItem[]
}

export interface VghtpeMedicationIndexReport {
  included: { verified: number; singleCandidate: number }
  excluded: { insufficient: number; noCandidate: number; disagreeingCandidates: number; unreadableIngredient: number; nameCollision: number; duplicate: number }
  collidingNames: string[]
}

type Ingredient = string | { text?: string; ingredientText?: string }
const ingredientText = (value: Ingredient) => (typeof value === 'string' ? value : value?.ingredientText ?? value?.text ?? '').trim()

export function buildVghtpeMedicationIndex(linkage: any, sourceBytes: Buffer | string, terminologySnapshotId: string):
  { index: VghtpeMedicationIndex; report: VghtpeMedicationIndexReport } {
  if (linkage?.schemaVersion !== SOURCE_SCHEMA_VERSION) throw new Error(`unexpected linkage schema ${linkage?.schemaVersion}`)
  if (linkage.snapshotId !== terminologySnapshotId) {
    throw new Error(`linkage snapshot ${linkage.snapshotId} does not match the vendored drug master ${terminologySnapshotId}`)
  }
  if (!Array.isArray(linkage.items)) throw new Error('linkage has no items')
  const products = new Map<string, any>((linkage.verifiedProducts ?? []).map((product: any) => [product.productKey, product]))
  const report: VghtpeMedicationIndexReport = {
    included: { verified: 0, singleCandidate: 0 },
    excluded: { insufficient: 0, noCandidate: 0, disagreeingCandidates: 0, unreadableIngredient: 0, nameCollision: 0, duplicate: 0 },
    collidingNames: [],
  }

  const candidates: Array<{ item: VghtpeMedicationIndexItem; identity: string }> = []
  for (const source of linkage.items) {
    const names = [...new Set<string>((source.names ?? []).map((name: unknown) => String(name ?? '').trim()).filter(Boolean))]
    if (!names.length) continue
    if (source.status === 'verified_product_identity') {
      const product = products.get(source.verifiedProductKey)
      if (!product || product.evidenceStatus !== 'verified_product_identity') throw new Error(`verified item without its verified product: ${names[0]}`)
      const identity = ingredientIdentityKey(product.ingredientText ?? '')
      if (!identity) { report.excluded.unreadableIngredient++; continue }
      candidates.push({ identity, item: { names, basis: 'verified-product', ingredientText: product.ingredientText.trim(), product: {
        licenseId: String(product.licenseId), officialProductUrl: String(product.officialProductUrl), doseForm: String(product.doseForm),
        nhiCodes: [...new Set<string>(product.nhiCodes ?? [])].sort(),
      } } })
      continue
    }
    if (source.status !== 'review_required') { report.excluded.insufficient++; continue }
    const texts = [...new Set((source.reviewCandidateIngredients ?? []).map(ingredientText).filter(Boolean))] as string[]
    if (!texts.length) { report.excluded.noCandidate++; continue }
    const identities = texts.map(ingredientIdentityKey)
    if (identities.some(identity => !identity)) { report.excluded.unreadableIngredient++; continue }
    if (new Set(identities).size !== 1) { report.excluded.disagreeingCandidates++; continue }
    // The shortest spelling is the plainest one ("CLINDAMYCIN HCL 150 MG").
    const text = [...texts].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
    candidates.push({ identity: identities[0]!, item: { names, basis: 'single-candidate-ingredient', ingredientText: text } })
  }

  // A name that two items of different identity claim is not evidence of
  // either; both lose that name. Items of the same identity may share it.
  const identitiesByName = new Map<string, Set<string>>()
  for (const { item, identity } of candidates) {
    for (const name of item.names) {
      const key = hospitalMedicationNameKey(name)
      identitiesByName.set(key, (identitiesByName.get(key) ?? new Set()).add(identity))
    }
  }
  const colliding = new Set([...identitiesByName].filter(([, identities]) => identities.size > 1).map(([key]) => key))
  const seen = new Set<string>()
  const items: VghtpeMedicationIndexItem[] = []
  for (const { item } of candidates) {
    let collided = false
    const names = item.names.filter((name) => {
      const key = hospitalMedicationNameKey(name)
      if (colliding.has(key)) { report.collidingNames.push(name); collided = true; return false }
      // The same name on another item of the same identity is listed once.
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!names.length) { report.excluded[collided ? 'nameCollision' : 'duplicate']++; continue }
    items.push({ ...item, names: names.sort() })
    if (item.basis === 'verified-product') report.included.verified++
    else report.included.singleCandidate++
  }
  items.sort((a, b) => a.names[0].localeCompare(b.names[0]) || a.ingredientText.localeCompare(b.ingredientText))
  report.collidingNames = [...new Set(report.collidingNames)].sort()

  return {
    index: {
      schemaVersion: INDEX_SCHEMA_VERSION,
      sourceSchemaVersion: linkage.schemaVersion,
      terminologySnapshotId,
      sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
      items,
    },
    report,
  }
}
