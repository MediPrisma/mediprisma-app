// Drug-interaction check against the hospital's DoseCopilot service
// (`POST /api/ddi-check`, rules from the VGH pharmacy interaction database).
//
// The service only knows the hospital formulary. An NHI product code from
// another institution comes back as a `RAW-n` placeholder with no alerts, and
// a name it cannot place is fuzzy-matched to some other drug. So this module
// sends ingredient names, accepts a resolution only when the returned drug
// names that ingredient, and reports every row it could not verify as
// unchecked instead of letting it read as "no interaction".
import type { MedicationRow } from '../types'

export interface InteractionCheckItem {
  /** Ingredient name sent as `drugName`. */
  query: string
  rowIds: string[]
}

export interface InteractionCheckPlan {
  items: InteractionCheckItem[]
  /** Current rows with no ingredient name to send. */
  unnamedRowIds: string[]
}

export type InteractionTier = 'avoid' | 'act' | 'note'

export interface InteractionFinding {
  id: string
  tier: InteractionTier
  rowIdsA: string[]
  rowIdsB: string[]
  action: string
  mechanism: string
  source: string
  /** Both drugs were written at the same visit, so the prescriber chose the
   *  combination; the list shows these collapsed. */
  samePrescription: boolean
}

export interface InteractionReview {
  findings: InteractionFinding[]
  checkedRowIds: string[]
  uncheckedRowIds: string[]
}

// "TRAMADOL HCL 37.5 MG+ACETAMINOPHEN (=PARACETAMOL) 325 MG" and
// "Netupitant / Palonosetron" both name two ingredients.
function ingredientNames(text: string | undefined): string[] {
  if (!text) return []
  return text.split(/\+|\s\/\s/)
    .map(part => part.replace(/\([^)]*\)/g, ' ').replace(/\s\.?\d.*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function rowIngredients(row: MedicationRow): string[] {
  const official = ingredientNames(row.drugTerminology?.ingredientText)
  if (official.length) return official
  const hospital = row.hospitalMedicationName
  return hospital?.status === 'normalized' ? ingredientNames(hospital.ingredientName) : []
}

export function planInteractionCheck(rows: MedicationRow[]): InteractionCheckPlan {
  const byQuery = new Map<string, InteractionCheckItem>()
  const unnamedRowIds: string[] = []
  for (const row of rows) {
    if (row.isInactive) continue
    const names = rowIngredients(row)
    if (!names.length) unnamedRowIds.push(row.id)
    for (const name of names) {
      const key = name.toLowerCase()
      const item = byQuery.get(key) ?? { query: name, rowIds: [] }
      if (!item.rowIds.includes(row.id)) item.rowIds.push(row.id)
      byQuery.set(key, item)
    }
  }
  return { items: [...byQuery.values()], unnamedRowIds }
}

export function interactionCheckBody(plan: InteractionCheckPlan) {
  return { medications: plan.items.map(item => ({ drugName: item.query })) }
}

const words = (text: string) => text.toLowerCase().match(/[a-z][a-z-]+/g) ?? []
// A leading cation names the salt, not the drug: "sodium chloride" must not
// be accepted as "potassium chloride" on the strength of one shared word.
const CATIONS = new Set(['sodium', 'potassium', 'calcium', 'magnesium', 'ferrous', 'ferric', 'zinc', 'aluminum', 'aluminium', 'lithium'])

function resolvesTo(query: string, resolved: Record<string, unknown>): boolean {
  if (String(resolved.udCode ?? '').startsWith('RAW-') || !resolved.udCode) return false
  const known = new Set(words(`${resolved.genericName ?? ''} ${resolved.englishName ?? ''}`))
  const asked = words(query)
  const first = asked[0]
  if (!first) return false
  if (asked.every(word => known.has(word))) return true
  return first.length >= 5 && !CATIONS.has(first) && known.has(first)
}

const AVOID = /不可併用|禁止併用|避免併用|禁忌/

function tierOf(severity: unknown, action: string): InteractionTier {
  // The action text outranks the service's grade: it rates sildenafil with
  // a nitrate "low" while the action reads 絕對不可併用.
  if (AVOID.test(action)) return 'avoid'
  return severity === 'high' || severity === 'moderate' ? 'act' : 'note'
}

const TIER_ORDER: Record<InteractionTier, number> = { avoid: 0, act: 1, note: 2 }
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function interpretInteractionCheck(
  plan: InteractionCheckPlan,
  rows: MedicationRow[],
  response: unknown,
): InteractionReview {
  const body = asRecord(response)
  const rowsByCode = new Map<string, Set<string>>()
  const verified = new Set<number>()
  for (const entry of asList(body.resolvedMedications).map(asRecord)) {
    const index = Number(entry.inputIndex)
    const item = plan.items[index]
    if (!item || !resolvesTo(item.query, entry)) continue
    verified.add(index)
    const code = String(entry.udCode)
    const ids = rowsByCode.get(code) ?? new Set<string>()
    item.rowIds.forEach(id => ids.add(id))
    rowsByCode.set(code, ids)
  }

  const unchecked = new Set(plan.unnamedRowIds)
  plan.items.forEach((item, index) => {
    if (!verified.has(index)) item.rowIds.forEach(id => unchecked.add(id))
  })
  const checked = new Set<string>()
  plan.items.forEach(item => item.rowIds.forEach(id => { if (!unchecked.has(id)) checked.add(id) }))

  const visitOf = new Map(rows.map(row => [row.id, row.encounterReference]))
  const findings = new Map<string, InteractionFinding>()
  for (const alert of asList(body.alerts).map(asRecord)) {
    if (alert.type !== 'DRUG_INTERACTION') continue
    const rowIdsA = [...(rowsByCode.get(String(asRecord(alert.drugA).udCode)) ?? [])]
    const rowIdsB = [...(rowsByCode.get(String(asRecord(alert.drugB).udCode)) ?? [])]
    if (!rowIdsA.length || !rowIdsB.length) continue
    // Two ingredients of one combination product are not a co-prescription.
    if (rowIdsA.length === 1 && rowIdsB.length === 1 && rowIdsA[0] === rowIdsB[0]) continue
    const action = text(alert.nursingAction)
    const id = text(alert.alertId) || [...rowIdsA, '×', ...rowIdsB].join('|')
    if (findings.has(id)) continue
    findings.set(id, {
      id,
      tier: tierOf(alert.severity, action),
      rowIdsA,
      rowIdsB,
      action,
      mechanism: text(alert.mechanism),
      source: text(alert.source),
      samePrescription: rowIdsA.every(x => rowIdsB.every(y => {
        const visit = visitOf.get(x)
        return x === y || (!!visit && visit === visitOf.get(y))
      })),
    })
  }

  return {
    findings: [...findings.values()].sort((x, y) =>
      TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || Number(x.samePrescription) - Number(y.samePrescription)),
    checkedRowIds: [...checked],
    uncheckedRowIds: [...unchecked],
  }
}
