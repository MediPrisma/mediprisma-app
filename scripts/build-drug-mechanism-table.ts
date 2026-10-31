#!/usr/bin/env tsx
// Builds src/shared/constants/drug-mechanism.generated.ts: what each NHI drug
// ingredient IS, so 開藥注意 reads a medicine's mechanism and anticholinergic
// burden as facts instead of recalling them (an ATC group is not a mechanism:
// G04BD holds both antimuscarinics and the β3 agonist mirabegron).
//
//   npx tsx scripts/build-drug-mechanism-table.ts [--cache path/to/cache.json]
//
// Keys are the WHO ATC level-5 codes of the vendored NHI drug master. For each
// single-ingredient code, in order:
//   e: FDA Established Pharmacologic Class (NLM RxClass, via RxNorm's ATC map)
//   m: mechanism of action (MED-RT / FDA SPL; transporter and CYP entries skipped)
//   c: ChEMBL drug mechanism (covers medicines the US never approved)
//   s: SNOMED CT disposition (NLM RxClass)
//   the same ingredient under another code (Taiwan-local codes ending 9x)
//   g: the class shared by every listed member of its ATC level-4 group
// Combination products are not keyed here: the app reads them ingredient by
// ingredient through ATC_BY_INGREDIENT, because one combination code covers
// products with different ingredients.
// Anticholinergic burden comes from scripts/data/anticholinergic-burden.json.
// Sends only ATC codes and ingredient names; every response is cached.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeIngredient, splitIngredients } from '../src/core/utils/ingredient-name.utils'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TERMINOLOGY_DIR = path.join(ROOT, 'vendor/nhi-fhir-bridge-nhi-drug-terminology/data')
const OUT = path.join(ROOT, 'src/shared/constants/drug-mechanism.generated.ts')
const ACB_FILE = path.join(ROOT, 'scripts/data/anticholinergic-burden.json')
const cacheArg = process.argv.indexOf('--cache')
// Default cache inside the repository's ignored node_modules/.cache — not the
// shared OS temp directory, where a predictable file name could be planted or
// symlinked by another user.
const CACHE = cacheArg > 0
  ? path.resolve(process.argv[cacheArg + 1])
  : path.join(ROOT, 'node_modules', '.cache', 'mediprisma', 'drug-mechanism-cache.json')

type Row = string[]
interface Ingredient {
  atc: string
  name: string
  products: number
  combo: number
  texts: Map<string, number>
  rxcui?: string[]
  epc: string[]
  moa: string[]
  disposition: string[]
  chembl: string[]
}

const cache: Record<string, unknown> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
let unsaved = 0
const saveCache = () => {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true, mode: 0o700 })
  fs.writeFileSync(CACHE, JSON.stringify(cache), { mode: 0o600 })
  unsaved = 0
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson<T>(url: string, tries = 4): Promise<T | undefined> {
  if (cache[url] !== undefined) return cache[url] as T
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      const body = res.status === 404 ? null : await res.json()
      cache[url] = body
      if (++unsaved >= 50) saveCache()
      return body as T
    } catch (error) {
      if (i === tries - 1) throw new Error(`${url}: ${String(error)}`)
      await sleep(1000 * 2 ** i)
    }
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

async function main() {
  // ---- the drug master
  const terminologyFile = fs.readdirSync(TERMINOLOGY_DIR).find((name) => /^nhi-drug-terminology-\d+\.json$/.test(name))
  if (!terminologyFile) throw new Error(`No drug master snapshot in ${TERMINOLOGY_DIR}`)
  const terminology = JSON.parse(fs.readFileSync(path.join(TERMINOLOGY_DIR, terminologyFile), 'utf8')) as {
    manifest: { snapshotId: string }
    rows: Row[]
  }
  const ATC5 = /^[A-Z]\d{2}[A-Z]{2}\d{2}$/
  const byAtc = new Map<string, Ingredient>()
  for (const row of terminology.rows) {
    const atc = row[9]
    if (!atc || !ATC5.test(atc)) continue
    const entry = byAtc.get(atc) ?? { atc, name: row[10] || '', products: 0, combo: 0, texts: new Map(), epc: [], moa: [], disposition: [], chembl: [] }
    entry.products++
    if (row[13] === '複方' || (row[5] ?? '').includes('+')) entry.combo++
    if (row[5]) entry.texts.set(row[5], (entry.texts.get(row[5]) ?? 0) + 1)
    byAtc.set(atc, entry)
  }
  const ingredients = [...byAtc.values()]
  const isCombination = (e: Ingredient) => e.combo > e.products / 2
  const isLocal = (e: Ingredient) => /9\d$/.test(e.atc) || !e.name
  const isTopical = (atc: string) => /^(S|D|R01|A01)/.test(atc)
  console.log(`${terminology.manifest.snapshotId}: ${ingredients.length} ATC level-5 codes`)

  // ---- NLM RxNorm + RxClass
  const RX = 'https://rxnav.nlm.nih.gov/REST'
  // Interaction labels (an inhibitor of CYP3A or P-gp), not what the drug does.
  const INTERACTION_MOA = /cytochrome p450|p-glycoprotein|organic (anion|cation)|udp glucuronosyltransferase|breast cancer resistance protein|bile salt export|multidrug and toxin/i
  interface RxClassInfo { rela?: string; minConcept?: { name?: string }; rxclassMinConceptItem?: { className?: string } }
  console.log('RxNorm + RxClass…')
  await pool(ingredients, 5, async (e) => {
    let ids = (await getJson<{ idGroup?: { rxnormId?: string[] } }>(`${RX}/rxcui.json?idtype=ATC&id=${e.atc}`))?.idGroup?.rxnormId ?? []
    if (!ids.length && e.name) {
      ids = (await getJson<{ idGroup?: { rxnormId?: string[] } }>(`${RX}/rxcui.json?name=${encodeURIComponent(e.name)}&search=2`))?.idGroup?.rxnormId ?? []
    }
    e.rxcui = ids
    const epc = new Set<string>(), moa = new Set<string>(), disposition = new Set<string>()
    for (const id of ids.slice(0, 3)) {
      const info = (await getJson<{ rxclassDrugInfoList?: { rxclassDrugInfo?: RxClassInfo[] } }>(`${RX}/rxclass/class/byRxcui.json?rxcui=${id}`))
        ?.rxclassDrugInfoList?.rxclassDrugInfo ?? []
      for (const x of info) {
        const name = x.rxclassMinConceptItem?.className
        // RxClass answers for every product that contains the ingredient:
        // phenobarbital arrives with a belladonna combination's classes. Keep
        // only what is said of the ingredient alone.
        if (!name || x.minConcept?.name?.includes(' / ')) continue
        if (x.rela === 'has_epc') epc.add(name)
        else if (x.rela === 'has_moa' && !INTERACTION_MOA.test(name)) moa.add(name)
        else if (x.rela === 'isa_disposition') disposition.add(name.replace(/-containing product$/i, ''))
      }
    }
    e.epc = [...epc]
    e.moa = [...moa]
    e.disposition = [...disposition]
  })
  saveCache()

  // ---- EBI ChEMBL (batched by ATC code, then by molecule)
  const CH = 'https://www.ebi.ac.uk/chembl/api/data'
  interface ChemblPage<T> { page_meta?: { next?: string | null }; molecules?: T[]; mechanisms?: T[] }
  console.log('ChEMBL…')
  const moleculesByAtc = new Map<string, Set<string>>()
  const atcBatches: Ingredient[][] = []
  for (let i = 0; i < ingredients.length; i += 40) atcBatches.push(ingredients.slice(i, i + 40))
  await pool(atcBatches, 3, async (batch) => {
    let url: string | null = `${CH}/molecule.json?atc_classifications__level5__in=${batch.map((e) => e.atc).join(',')}&only=molecule_chembl_id,atc_classifications,molecule_hierarchy&limit=1000`
    while (url) {
      const page: ChemblPage<{ molecule_chembl_id: string; atc_classifications?: string[]; molecule_hierarchy?: { parent_chembl_id?: string } }> | undefined = await getJson(url)
      for (const m of page?.molecules ?? []) {
        for (const code of m.atc_classifications ?? []) {
          if (!byAtc.has(code)) continue
          const ids = moleculesByAtc.get(code) ?? new Set<string>()
          ids.add(m.molecule_chembl_id)
          if (m.molecule_hierarchy?.parent_chembl_id) ids.add(m.molecule_hierarchy.parent_chembl_id)
          moleculesByAtc.set(code, ids)
        }
      }
      url = page?.page_meta?.next ? `https://www.ebi.ac.uk${page.page_meta.next}` : null
    }
  })
  const moleculeIds = [...new Set([...moleculesByAtc.values()].flatMap((ids) => [...ids]))]
  const mechanismsById = new Map<string, Set<string>>()
  const idBatches: string[][] = []
  for (let i = 0; i < moleculeIds.length; i += 40) idBatches.push(moleculeIds.slice(i, i + 40))
  await pool(idBatches, 3, async (ids) => {
    let url: string | null = `${CH}/mechanism.json?molecule_chembl_id__in=${ids.join(',')}&only=molecule_chembl_id,parent_molecule_chembl_id,mechanism_of_action,action_type&limit=1000`
    while (url) {
      const page: ChemblPage<{ molecule_chembl_id?: string; parent_molecule_chembl_id?: string; mechanism_of_action?: string }> | undefined = await getJson(url)
      for (const m of page?.mechanisms ?? []) {
        if (!m.mechanism_of_action) continue
        for (const id of [m.molecule_chembl_id, m.parent_molecule_chembl_id]) {
          if (!id) continue
          const set = mechanismsById.get(id) ?? new Set<string>()
          set.add(m.mechanism_of_action)
          mechanismsById.set(id, set)
        }
      }
      url = page?.page_meta?.next ? `https://www.ebi.ac.uk${page.page_meta.next}` : null
    }
  })
  for (const e of ingredients) {
    e.chembl = [...new Set([...(moleculesByAtc.get(e.atc) ?? [])].flatMap((id) => [...(mechanismsById.get(id) ?? [])]))]
  }
  saveCache()

  // ---- mechanism per single-ingredient code
  const two = (list: string[]) => list.slice(0, 2).join('; ')
  const mechanism = new Map<string, string>()
  for (const e of ingredients) {
    if (isCombination(e)) continue
    // MED-RT's "… Transporter Interactions" parents say little (phenobarbital
    // gets "Neurotransmitter Transporter Interactions"); a specific ChEMBL
    // mechanism reads better.
    const specificMoa = e.moa.filter((name) => !/ Interactions$/.test(name))
    if (e.epc.length) mechanism.set(e.atc, `e:${two(e.epc)}`)
    else if (specificMoa.length) mechanism.set(e.atc, `m:${two(specificMoa)}`)
    else if (e.chembl.length) mechanism.set(e.atc, `c:${two(e.chembl)}`)
    else if (e.moa.length) mechanism.set(e.atc, `m:${two(e.moa)}`)
    else if (e.disposition.length) mechanism.set(e.atc, `s:${two(e.disposition)}`)
  }

  // The drug master's own spellings of each single ingredient → every code it
  // is filed under, from single-ingredient products.
  const codesByName = new Map<string, Ingredient[]>()
  for (const e of ingredients) {
    if (isCombination(e)) continue
    const names = new Set([...e.texts.keys()].filter((text) => !text.includes('+')).map(normalizeIngredient))
    if (e.name) names.add(normalizeIngredient(e.name))
    for (const name of names) {
      if (name) codesByName.set(name, [...(codesByName.get(name) ?? []), e])
    }
  }
  // The code to read a name by: one with a mechanism, systemic before topical,
  // WHO before Taiwan-local, then the one with more products.
  const bestCode = (name: string): Ingredient | undefined =>
    [...(codesByName.get(name) ?? [])].sort((a, b) =>
      Number(mechanism.has(b.atc)) - Number(mechanism.has(a.atc))
      || Number(isTopical(a.atc)) - Number(isTopical(b.atc))
      || Number(isLocal(a)) - Number(isLocal(b))
      || b.products - a.products)[0]

  // Taiwan-local codes (and other unlisted codes) borrow the mechanism of the
  // same ingredient filed under a listed code.
  for (const e of ingredients) {
    if (isCombination(e) || mechanism.has(e.atc)) continue
    const top = [...e.texts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const twin = top ? bestCode(normalizeIngredient(top)) : undefined
    if (twin && twin.atc !== e.atc && mechanism.has(twin.atc)) mechanism.set(e.atc, mechanism.get(twin.atc)!)
  }

  // A class every listed member of the ATC level-4 group shares.
  const groups = new Map<string, Ingredient[]>()
  for (const e of ingredients) {
    if (isCombination(e)) continue
    const group = groups.get(e.atc.slice(0, 5)) ?? []
    group.push(e)
    groups.set(e.atc.slice(0, 5), group)
  }
  const shared = (members: Ingredient[], pick: (e: Ingredient) => string[]) => {
    const listed = members.filter((e) => pick(e).length)
    if (listed.length < 2) return undefined
    return pick(listed[0]).find((name) => listed.every((e) => pick(e).includes(name)))
  }
  let inherited = 0
  for (const e of ingredients) {
    if (isCombination(e) || mechanism.has(e.atc)) continue
    const members = groups.get(e.atc.slice(0, 5)) ?? []
    const common = shared(members, (m) => m.epc) ?? shared(members, (m) => m.moa)
    if (common) { mechanism.set(e.atc, `g:${common}`); inherited++ }
  }

  // ---- anticholinergic burden
  // Labels: "ACB 3" (the ACB scale), "Beers strong" (Beers 2023 Table 7
  // without an ACB score), "ACB 2 · Beers strong" / "ACB 1 · Beers strong"
  // when Beers counts a medicine the scale rates lower (cyproheptadine,
  // clidinium), "ACB 2", "ACB 1". The single-medicine rule reads "ACB 3 or
  // Beers strong", so the Beers status must survive a lower ACB score.
  const acbSource = JSON.parse(fs.readFileSync(ACB_FILE, 'utf8')) as {
    entries: Array<{ acb?: 1 | 2 | 3; beers2023?: boolean; names: string[] }>
  }
  const labelOf = (entry: { acb?: number; beers2023?: boolean }) =>
    entry.acb === 3 ? 'ACB 3'
      : entry.beers2023 ? (entry.acb ? `ACB ${entry.acb} · Beers strong` : 'Beers strong')
        : `ACB ${entry.acb}`
  const rank = (label: string) => (/ACB 3|Beers/.test(label) ? 3 : /ACB 2/.test(label) ? 2 : 1)
  // Intestinal-local corticosteroids and haemorrhoid preparations act where
  // they are applied, like the topical codes.
  const LOCAL_ACB = /^(S|D|R01|A01|A07EA|C05)/
  const anticholinergicByAtc = new Map<string, string>()
  const anticholinergicByName = new Map<string, string>()
  const unmatchedAcb: string[] = []
  const nameOnlyMatches: string[] = []
  for (const entry of acbSource.entries) {
    const label = labelOf(entry)
    for (const name of entry.names) anticholinergicByName.set(name, label)
    let matched = false
    for (const e of ingredients) {
      if (isCombination(e) || LOCAL_ACB.test(e.atc)) continue
      // A code is the ingredient most of its products contain, not its ATC
      // name: the drug master files a butylscopolamine injection under A04AD01
      // "scopolamine", and a few 10 mg butylscopolamine tablets under A03BB01
      // as "SCOPOLAMINE HBR".
      const counts = new Map<string, number>()
      for (const [text, n] of e.texts) {
        if (!text.includes('+')) counts.set(normalizeIngredient(text), (counts.get(normalizeIngredient(text)) ?? 0) + n)
      }
      const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
      const hit = main ? entry.names.includes(main) : entry.names.includes(e.name.toLowerCase())
      if (!hit) {
        if (entry.names.includes(e.name.toLowerCase())) nameOnlyMatches.push(`${e.atc} ${e.name}: ${main}`)
        continue
      }
      const current = anticholinergicByAtc.get(e.atc)
      if (!current || rank(label) > rank(current)) anticholinergicByAtc.set(e.atc, label)
      matched = true
    }
    if (!matched) unmatchedAcb.push(entry.names[0])
  }

  // ---- ingredients of combination products → code (only what the app can use)
  // Weighted by the products that contain each ingredient, for the report.
  const componentProducts = new Map<string, number>()
  for (const e of ingredients) {
    for (const [text, n] of e.texts) {
      if (text.includes('+')) splitIngredients(text).forEach((name) => componentProducts.set(name, (componentProducts.get(name) ?? 0) + n))
    }
  }
  const atcByIngredient = new Map<string, string>()
  for (const name of componentProducts.keys()) {
    const codes = codesByName.get(name) ?? []
    // The anticholinergic code wins: "chlorpheniramine" in a cold remedy is
    // the systemic antihistamine, not an eye drop.
    const e = codes.find((c) => anticholinergicByAtc.has(c.atc)) ?? bestCode(name)
    if (e && (mechanism.has(e.atc) || anticholinergicByAtc.has(e.atc))) atcByIngredient.set(name, e.atc)
  }

  // ---- report
  const singles = ingredients.filter((e) => !isCombination(e))
  const products = (list: Ingredient[]) => list.reduce((n, e) => n + e.products, 0)
  const counts: Record<string, number> = { e: 0, m: 0, c: 0, s: 0, g: 0 }
  for (const value of mechanism.values()) counts[value[0]]++
  const unresolved = singles.filter((e) => !mechanism.has(e.atc)).sort((a, b) => b.products - a.products)
  const share = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`
  console.log(`single-ingredient codes: ${singles.length}; with a mechanism: ${mechanism.size} (${share(mechanism.size, singles.length)}), ` +
    `products ${share(products(singles.filter((e) => mechanism.has(e.atc))), products(singles))}`)
  console.log(`  FDA EPC ${counts.e}, MED-RT/SPL MoA ${counts.m}, ChEMBL ${counts.c}, SNOMED ${counts.s}, ATC group ${counts.g} (inherited ${inherited})`)
  const componentTotal = [...componentProducts.values()].reduce((a, b) => a + b, 0)
  const componentResolved = [...componentProducts].filter(([name]) => atcByIngredient.has(name)).reduce((n, [, c]) => n + c, 0)
  console.log(`combination ingredients resolvable: ${atcByIngredient.size}/${componentProducts.size} names, ${share(componentResolved, componentTotal)} of ingredient mentions`)
  console.log(`  most frequent unresolved: ${[...componentProducts].filter(([name]) => !atcByIngredient.has(name)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, n]) => `${name} (${n})`).join(', ')}`)
  console.log(`anticholinergic codes: ${anticholinergicByAtc.size}; list entries with no single-ingredient code in the drug master: ${unmatchedAcb.join(', ') || 'none'}`)
  console.log(`codes named like a listed drug whose products contain something else (not matched):\n  ${nameOnlyMatches.join('\n  ') || 'none'}`)
  console.log(`unresolved single ingredients (most products first):\n  ${unresolved.slice(0, 40).map((e) => `${e.atc} ${e.name || [...e.texts.keys()][0]} (${e.products})`).join('\n  ')}`)

  // ---- write
  const sorted = <T>(map: Map<string, T>) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const record = <T>(map: Map<string, T>) =>
    `{\n${sorted(map).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n}`
  const lines = [
    `// Generated by scripts/build-drug-mechanism-table.ts from ${terminology.manifest.snapshotId} — do not edit.`,
    '// Mechanisms: NLM RxClass (FDA Established Pharmacologic Class, MED-RT, SNOMED CT)',
    '// and ChEMBL (EMBL-EBI, CC BY-SA 3.0, https://www.ebi.ac.uk/chembl/). Anticholinergic',
    '// burden: scripts/data/anticholinergic-burden.json (ACB scale 2012; AGS Beers 2023).',
    `// ${mechanism.size} of ${singles.length} single-ingredient codes have a mechanism; the rest are unknown.`,
    '',
    '/** The drug-master snapshot this table was built from; a test fails when the',
    ' *  vendored snapshot moves on, so the table is regenerated with it. */',
    `export const DRUG_MECHANISM_SNAPSHOT_ID = ${JSON.stringify(terminology.manifest.snapshotId)}`,
    '',
    '/** WHO ATC level-5 code → "e:" FDA EPC, "m:" MED-RT/SPL mechanism, "c:" ChEMBL',
    ' *  mechanism, "s:" SNOMED CT disposition, or "g:" the class every listed member',
    ' *  of its ATC group shares. */',
    `export const MECHANISM_BY_ATC: Readonly<Record<string, string>> = ${record(mechanism)}`,
    '',
    '/** A combination product\'s ingredient, as normalizeIngredient spells it → its',
    ' *  single-ingredient code. */',
    `export const ATC_BY_INGREDIENT: Readonly<Record<string, string>> = ${record(atcByIngredient)}`,
    '',
    '/** Anticholinergic burden by systemic single-ingredient code: "ACB 1"–"ACB 3"',
    ' *  (ACB scale 2012), "Beers strong" (AGS Beers 2023 Table 7), or both. */',
    `export const ANTICHOLINERGIC_BY_ATC: Readonly<Record<string, string>> = ${record(anticholinergicByAtc)}`,
    '',
    '/** The same, by ingredient name, for the ingredients of combination products',
    ' *  (belladonna is only ever one). */',
    `export const ANTICHOLINERGIC_BY_INGREDIENT: Readonly<Record<string, string>> = ${record(anticholinergicByName)}`,
    '',
  ]
  fs.writeFileSync(OUT, lines.join('\n'))
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
