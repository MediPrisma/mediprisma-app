// Builds the public VGH hospital medication index from the local-only hospital
// drug identity table (schema hospital-identity-v2-local). Nothing is added by
// hand: a name the table cannot resolve to one identity stays out of the index.
//
// The index says which drug a complete hospital product name is: its NHI
// drug-master ingredients and amounts, package quantity where that is part of
// the product (liquids, creams, eye products, concentrations), dose form and
// release type, and every NHI code of exactly that identity. A MediCloud
// record whose code is in that set is the same drug (same ingredients and
// amounts; a different strength or package is a different drug).
//
// Output holds only what a public repository may: complete hospital names and
// NHI drug-master facts. Hospital item codes, drug numbers, billing codes,
// candidate lists, evidence paths and local file names are never copied.

import { createHash } from 'node:crypto'
import { hospitalMedicationNameKey } from '../../src/shared/utils/hospital-medication-index'

export const INDEX_SCHEMA_VERSION = 'vghtpe-medication-index-v2'
const SOURCE_SCHEMA_VERSION = 'hospital-identity-v2-local'

export interface VghtpeMedicationIdentity {
  ingredients: Array<{ name: string; amount: string }>
  packageQuantity?: string
  doseFormFamily: string
  releaseType: string
  /** 'lipid' for liposomal and lipid-complex products, which are not
   *  interchangeable with the conventional formulation (AmBisome vs Fungizone). */
  formulation?: string
}

export interface VghtpeMedicationIndexItem {
  names: string[]
  basis: 'dictionary-identity'
  ingredientText: string
  identity: VghtpeMedicationIdentity
  nhiCodes: string[]
}

export interface VghtpeMedicationIndex {
  schemaVersion: typeof INDEX_SCHEMA_VERSION
  sourceSchemaVersion: string
  terminologySnapshotId: string
  sourceSha256: string
  items: VghtpeMedicationIndexItem[]
}

export interface VghtpeMedicationIndexReport {
  included: { dictionary: number }
  excluded: { notUnique: number; nameContradicted: number; nameCollision: number; duplicate: number }
  contradictedNames: string[]
  collidingNames: string[]
}

type MasterRow = readonly string[]
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

// What a hospital name states outright, the identity must not deny. A name
// that lists a second ingredient (Brimonidine+Timolol, Alendronate 70/Vit D3,
// a bare 10/20 strength pair), a modified-release marker (Doxaben XL) or a
// suppository (Domperidone supp) keeps its identity only when the identity
// and every NHI code of it say the same.
const SECOND_INGREDIENT = /[A-Z]\s*\+\s*[A-Z]|\d\s*\/\s*[A-Z]|\d\s*(?:MG|MCG|UG|IU)?\s*\/\s*\d+(?:\.\d+)?(?!\s*(?:ML|GM?|L|%)\b|[\d.])/
const RELEASE_MARKER = /(?<![A-Z])(?:XL|XR|SR|CR|ER|LA|OROS|ZOK|PR|MR|CD|LP|UNO|RETARD|CONTINUS|DURULES)(?![A-Z])/
const MODIFIED_RELEASE_ROW = /持續|緩釋|長效|控釋|延長|徐放|(?<![A-Z])(?:XL|XR|SR|CR|ER|LA|OROS|ZOK|PR|MR|CD|RETARD|CONTINUS|PROLONGED|EXTENDED|SUSTAINED|CONTROLLED|MODIFIED)(?![A-Z])/
const SUPPOSITORY = /(?<![A-Z])SUPP/
// A vaginal soft capsule is what the hospital orders as a vaginal supp (Lomexin).
const SUPPOSITORY_ROW = /栓|陰道/
const ROW_ZH_NAME = 3, ROW_EN_NAME = 4, ROW_DOSE_FORM = 8

export function hospitalNameContradictsIdentity(name: string, identity: VghtpeMedicationIdentity, rows: readonly MasterRow[]): boolean {
  const upper = name.normalize('NFKC').toUpperCase()
  const rowText = (row: MasterRow) => `${row[ROW_ZH_NAME] ?? ''} ${row[ROW_EN_NAME] ?? ''} ${row[ROW_DOSE_FORM] ?? ''}`.toUpperCase()
  if (SECOND_INGREDIENT.test(upper) && identity.ingredients.length < 2) return true
  if (RELEASE_MARKER.test(upper) && !rows.every(row => MODIFIED_RELEASE_ROW.test(rowText(row)))) return true
  if (SUPPOSITORY.test(upper) && !rows.every(row => SUPPOSITORY_ROW.test(String(row[ROW_DOSE_FORM] ?? '')))) return true
  return false
}

export function buildVghtpeMedicationIndex(input: {
  identity: any; identityBytes: Buffer | string
  masterRows: readonly MasterRow[]; terminologySnapshotId: string
}): { index: VghtpeMedicationIndex; report: VghtpeMedicationIndexReport } {
  const { identity, masterRows, terminologySnapshotId } = input
  if (identity?.schemaVersion !== SOURCE_SCHEMA_VERSION) throw new Error(`unexpected identity schema ${identity?.schemaVersion}`)
  if (identity.snapshotId !== terminologySnapshotId) {
    throw new Error(`identity snapshot ${identity.snapshotId} does not match the vendored drug master ${terminologySnapshotId}`)
  }
  if (!Array.isArray(identity.items)) throw new Error('identity has no items')
  const rows = new Map<string, MasterRow>(masterRows.map(row => [String(row[0]), row]))
  const report: VghtpeMedicationIndexReport = {
    included: { dictionary: 0 }, excluded: { notUnique: 0, nameContradicted: 0, nameCollision: 0, duplicate: 0 },
    contradictedNames: [], collidingNames: [],
  }
  const codesOf = (codes: unknown, label: string) => {
    const list = [...new Set((Array.isArray(codes) ? codes : []).map(code => String(code).trim()).filter(Boolean))].sort()
    if (!list.length) throw new Error(`${label}: no NHI codes`)
    for (const code of list) if (!rows.has(code)) throw new Error(`${label}: ${code} is not in the vendored drug master`)
    return list
  }
  const namesOf = (names: unknown) => [...new Set((Array.isArray(names) ? names : []).map(name => String(name ?? '').trim()).filter(Boolean))]

  const candidates: VghtpeMedicationIndexItem[] = []
  // The bridge records a product name per order, so identity is per name: a
  // hospital item whose other alias is unresolved still lends a uniquely
  // resolved name its identity (Lipitor FC * tab 20 mg beside an unresolved
  // generic alias of the same item code).
  for (const source of identity.items) {
    const results = Array.isArray(source.aliasResults) && source.aliasResults.length
      ? source.aliasResults
      : namesOf(source.names).map(name => ({ ...source, name }))
    for (const result of results) {
      const name = String(result.name ?? '').trim()
      if (!name) continue
      if (result.status !== 'unique') { report.excluded.notUnique++; continue }
      const nhiCodes = codesOf(result.nhiCodes, name)
      const id = result.identity ?? {}
      const parsed: VghtpeMedicationIdentity = {
        ingredients: (id.ingredients ?? []).map((part: any) => ({ name: String(part.name), amount: String(part.amount) })),
        ...(id.packageQuantity ? { packageQuantity: String(id.packageQuantity) } : {}),
        doseFormFamily: String(id.doseFormFamily ?? ''), releaseType: String(id.releaseType ?? ''),
        ...(id.formulation ? { formulation: String(id.formulation) } : {}),
      }
      if (hospitalNameContradictsIdentity(name, parsed, nhiCodes.map(code => rows.get(code)!))) {
        report.excluded.nameContradicted++
        report.contradictedNames.push(name)
        continue
      }
      candidates.push({ names: [name], basis: 'dictionary-identity', ingredientText: String(result.ingredientText ?? '').trim(), nhiCodes, identity: parsed })
    }
  }
  // Names of one item with the same identity are listed together.
  const merged = new Map<string, VghtpeMedicationIndexItem>()
  for (const item of candidates.splice(0)) {
    const key = `${item.nhiCodes.join(',')}|${JSON.stringify(item.identity)}`
    const existing = merged.get(key)
    if (existing) existing.names.push(...item.names)
    else merged.set(key, item)
  }
  candidates.push(...merged.values())

  // A name two different identities claim is evidence for neither; both lose it.
  const codeSetsByName = new Map<string, Set<string>>()
  for (const item of candidates) {
    for (const name of item.names) {
      const key = hospitalMedicationNameKey(name)
      codeSetsByName.set(key, (codeSetsByName.get(key) ?? new Set()).add(item.nhiCodes.join(',')))
    }
  }
  const colliding = new Set([...codeSetsByName].filter(([, sets]) => sets.size > 1).map(([key]) => key))
  const seen = new Set<string>()
  const items: VghtpeMedicationIndexItem[] = []
  for (const item of candidates) {
    let collided = false
    const names = item.names.filter((name) => {
      const key = hospitalMedicationNameKey(name)
      if (colliding.has(key)) { report.collidingNames.push(name); collided = true; return false }
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!names.length) { report.excluded[collided ? 'nameCollision' : 'duplicate']++; continue }
    items.push({ ...item, names: names.sort() })
    report.included.dictionary++
  }
  items.sort((a, b) => a.names[0].localeCompare(b.names[0]))
  report.contradictedNames = [...new Set(report.contradictedNames)].sort()
  report.collidingNames = [...new Set(report.collidingNames)].sort()
  return {
    index: { schemaVersion: INDEX_SCHEMA_VERSION, sourceSchemaVersion: identity.schemaVersion, terminologySnapshotId,
      sourceSha256: sha256(input.identityBytes), items },
    report,
  }
}
