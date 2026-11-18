// Drug-interaction check against the hospital's DoseCopilot service
// (`POST /api/ddi-check`, rules from the VGH pharmacy interaction database).
//
// The service only knows the hospital formulary, and a name it cannot place
// exactly is fuzzy-matched to some other drug. So each row is sent by an
// identity the service can confirm, looked up by the service at run time
// rather than from a table in this repository (owner decision 2026-11-18):
// - a hospital order by its hospital product name, accepted when the product
//   returned carries one of the NHI codes of the order's indexed identity, or
//   is that very name;
// - a row with a recorded NHI code by that code, accepted when the product
//   returned carries it; a code the hospital never filed falls back to the
//   ingredient name sent alongside;
// - otherwise by ingredient name, accepted only when the returned drug names
//   that ingredient.
// Every row it could not verify is reported as unchecked instead of letting it
// read as "no interaction".
import { medicationClinicalDay, medicationSupplyEndDay } from '@/src/shared/utils/medication-calendar'
import type { MedicationRow } from '../types'

export interface InteractionCheckItem {
  /** Sent as `drugName`: a hospital product name or an ingredient name. */
  query: string
  /** Sent as `nhiCode`: the row's recorded NHI product code. */
  nhiCode?: string
  /** A product carrying any of these NHI codes is this item's drug. */
  codes?: string[]
  /** `query` is a hospital product name, accepted only as that exact name. */
  productName?: boolean
  rowIds: string[]
}

export interface InteractionCheckPlan {
  items: InteractionCheckItem[]
  /** Current rows with no ingredient name to send. */
  unnamedRowIds: string[]
  /** Current skin and ear preparations, left out of the check. */
  localRowIds: string[]
  /** Rows no longer current that are still checked: see stillCoveredUntil. */
  endedRowIds: string[]
  /** For each of those, the last day its prescription may still supply. */
  coveredUntil: Record<string, string>
}

export type InteractionTier = 'avoid' | 'act' | 'note'
/** The service's own grade, shown as given; `unknown` when it sends none. */
export type InteractionSeverity = 'high' | 'moderate' | 'low' | 'unknown'

export interface InteractionFinding {
  id: string
  tier: InteractionTier
  severity: InteractionSeverity
  rowIdsA: string[]
  rowIdsB: string[]
  action: string
  mechanism: string
  source: string
  /** Both drugs were written at the same visit, so the prescriber chose the
   *  combination; the list shows these collapsed. */
  samePrescription: boolean
  /** One side is only drugs whose supply has run out (see stillCoveredUntil):
   *  the patient may have stopped them, or be back to renew them. */
  involvesEnded: boolean
}

export interface InteractionReview {
  findings: InteractionFinding[]
  checkedRowIds: string[]
  uncheckedRowIds: string[]
  /** Skin and ear preparations, not sent: see isLocalPreparation. */
  localRowIds: string[]
  endedRowIds: string[]
  coveredUntil: Record<string, string>
}

// A strength is a number with a unit. A number inside the name stays:
// "ISOSORBIDE 5-MONONITRATE 20 MG" is not "ISOSORBIDE".
const STRENGTH = /\s\.?\d[\d.,]*\s*(?:mg|mcg|ug|gm?|ml|l|iu|u|units?|meq|mmol|%)(?![a-z]).*$/i

// "TRAMADOL HCL 37.5 MG+ACETAMINOPHEN (=PARACETAMOL) 325 MG" and
// "Netupitant / Palonosetron" both name two ingredients. The terminology text
// is cut at a fixed length, so a parenthesis may never close: "OXYBUTYNIN
// CHLORIDE (=OXIBUTININA HCL=OXYBUTYNIN H 5 MG" — the aside runs to the end.
// "SACUBITRIL/VALSARTAN AS SACUBITRIL VALSARTAN SODIUM SAL 100 MG" (Entresto):
// what follows AS describes the salt form, not another ingredient, and its
// words never appear in the name the service returns.
const SALT_FORM = /\sAS\s.*$/i

function ingredientNames(text: string | undefined): string[] {
  if (!text) return []
  return text.split(/\+|\s\/\s/)
    .map(part => part.replace(/\([^)]*(?:\)|$)/g, ' ').replace(STRENGTH, '').replace(SALT_FORM, '')
      .replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

type Entry = Omit<InteractionCheckItem, 'rowIds'>

// The one product name the hospital recorded ("Isormol * tab 20 mg").
function hospitalProductName(row: MedicationRow): string | undefined {
  const name = row.hospitalMedicationName
  const recorded = name?.recordedProductName ?? name?.recordedName
  return recorded && !recorded.includes(' / ') ? recorded : undefined
}

function rowEntries(row: MedicationRow): Entry[] {
  const product = hospitalProductName(row)
  if (product && row.hospitalNhiCodes?.length) return [{ query: product, codes: row.hospitalNhiCodes, productName: true }]
  const names = rowIngredients(row)
  const code = row.nhiDrugCode?.trim().toUpperCase()
  if (!code) return names.map(query => ({ query }))
  return (names.length ? names : ['']).map(query => ({ query, nhiCode: code, codes: [code] }))
}

function rowIngredients(row: MedicationRow): string[] {
  const official = ingredientNames(row.drugTerminology?.ingredientText)
  if (official.length) return official
  const hospital = row.hospitalMedicationName
  return hospital?.status === 'normalized' ? ingredientNames(hospital.ingredientName) : []
}

// Skin and ear preparations (owner decision 2026-11-16): the service matches
// an ingredient to the hospital's systemic product, so a neomycin ointment
// reads as neomycin capsules and draws their kidney warning. Eye preparations,
// inhalers, suppositories and patches stay in — timolol drops and fentanyl
// patches act systemically — so an eye gel or eye ointment is checked although
// its form says gel or ointment. 「gel」 as a word only: a gelatin capsule is
// oral. TOP is the route code route-display gives SNOMED 6064005 (topical).
const EYE = /ophthalmic|\beye\b|\bOPH\b|眼/i
const LOCAL = /cream|ointment|\bgel\b|lotion|shampoo|topical|\bTOP\b|\botic\b|ear\s*drop|乳膏|軟膏|凝膠|洗髮|外用|耳用|耳滴/i

export function isLocalPreparation(row: MedicationRow): boolean {
  const text = [row.secondaryTitle, row.title, row.drugTerminology?.doseForm, row.drugTerminology?.officialNameEn, row.route]
    .filter(Boolean).join(' ')
  return !EYE.test(text) && LOCAL.test(text)
}

// A patient often comes back once the last supply has run out, to renew it.
// Long-term drugs stay in the check (owner decision 2026-11-17): a 「慢簽」
// slip for its whole length, since the later fills can be collected at a
// community pharmacy that the hospital record never shows, and any supply of
// 28 days or more until it ends; both for 14 more days. Short courses and
// orders the source marks stopped count only while current.
const ENDED_GRACE_DAYS = 14
const LONG_TERM_DAYS = 28
const STOPPED = new Set(['stopped', 'cancelled', 'entered-in-error', 'draft', 'on-hold'])

/** Last day (YYYY-MM-DD) of supply a row that is no longer current may still
 *  cover: the slip's later fills included, before the 14-day grace. */
export function stillCoveredUntil(row: MedicationRow): string | undefined {
  const days = row.durationDays ?? 0
  if (STOPPED.has(row.status) || !row.endDateIso || (!row.isChronic && days < LONG_TERM_DAYS)) return undefined
  const laterFills = row.chronicFills && days ? (row.chronicFills - 1) * days : 0
  return medicationSupplyEndDay(row.endDateIso, laterFills + 1)
}

const withinGrace = (covered: string | undefined, today: string) => {
  const last = covered && medicationSupplyEndDay(covered, ENDED_GRACE_DAYS + 1)
  return !!last && today <= last
}

export function planInteractionCheck(rows: MedicationRow[], nowMs = Date.now()): InteractionCheckPlan {
  const byQuery = new Map<string, InteractionCheckItem>()
  const unnamedRowIds: string[] = []
  const localRowIds: string[] = []
  const endedRowIds: string[] = []
  const coveredUntil: Record<string, string> = {}
  const today = medicationClinicalDay(nowMs) ?? ''
  // A newer record of the same drug — the renewal, or a later fill, which keeps
  // the visit's date and has its own dispense day — replaces an older one,
  // which would otherwise make a same-visit pair look cross-visit. An order
  // that was cancelled or never issued replaces nothing.
  const supplyStart = (row: MedicationRow) => row.dispensedOnIso ?? row.startedOnIso ?? ''
  // A later fill carries no fill count; its slip still covers as far as the
  // visit's record says, with the remaining fills perhaps from a pharmacy.
  const newest = new Map<string, string>()
  const slipCover = new Map<string, string>()
  const slip = (row: MedicationRow) => `${row.drugKey ?? row.title}|${row.startedOnIso ?? ''}`
  for (const row of rows) {
    const key = row.drugKey ?? row.title
    if (STOPPED.has(row.status)) continue
    if (supplyStart(row) > (newest.get(key) ?? '')) newest.set(key, supplyStart(row))
    const covered = stillCoveredUntil(row)
    if (covered && covered > (slipCover.get(slip(row)) ?? '')) slipCover.set(slip(row), covered)
  }
  for (const row of rows) {
    const covered = stillCoveredUntil(row) && slipCover.get(slip(row))
    if (row.isInactive
      && (supplyStart(row) < (newest.get(row.drugKey ?? row.title) ?? '') || !withinGrace(covered, today))) continue
    if (isLocalPreparation(row)) {
      if (!row.isInactive) localRowIds.push(row.id)
      continue
    }
    if (row.isInactive && covered) {
      endedRowIds.push(row.id)
      coveredUntil[row.id] = covered
    }
    const entries = rowEntries(row)
    if (!entries.length) unnamedRowIds.push(row.id)
    for (const entry of entries) {
      const key = [entry.query.toLowerCase(), entry.nhiCode ?? '', entry.productName ? 'product' : ''].join('|')
      const item = byQuery.get(key) ?? { ...entry, rowIds: [] }
      if (!item.rowIds.includes(row.id)) item.rowIds.push(row.id)
      byQuery.set(key, item)
    }
  }
  return { items: [...byQuery.values()], unnamedRowIds, localRowIds, endedRowIds, coveredUntil }
}

export function interactionCheckBody(plan: InteractionCheckPlan) {
  return {
    medications: plan.items.map(item => ({
      ...(item.query ? { drugName: item.query } : {}),
      ...(item.nhiCode ? { nhiCode: item.nhiCode } : {}),
    })),
  }
}

const words = (text: string) => text.toLowerCase().match(/[a-z][a-z-]+/g) ?? []
// Salt and hydrate words that may follow the drug's own name. Only these may
// be missing from the service's name, and never the first word: "trastuzumab
// emtansine" is not "trastuzumab", "sodium chloride" is not "potassium chloride".
const SALT_SUFFIXES = new Set(['hcl', 'hydrochloride', 'hbr', 'hydrobromide', 'sodium', 'potassium', 'calcium',
  'magnesium', 'maleate', 'citrate', 'sulfate', 'sulphate', 'phosphate', 'acetate', 'besylate', 'besilate',
  'mesylate', 'tartrate', 'fumarate', 'succinate', 'bromide', 'chloride', 'nitrate', 'anhydrous', 'hydrate',
  'monohydrate', 'dihydrate', 'trihydrate', 'hemihydrate', 'sesquihydrate'])

// When the name itself starts with an ion, the salt words are the drug:
// "SODIUM CHLORIDE" must not resolve to Diclofenac sodium by dropping
// "chloride". Suffixes may be left out only after a drug's own name.
const IONS = new Set(['sodium', 'potassium', 'calcium', 'magnesium', 'zinc', 'ferrous', 'ferric', 'lithium', 'aluminium',
  'aluminum', 'ammonium'])

// Spellings the service abbreviates. Unlike a salt suffix, the word itself must
// still be there: "sodium chloride" is not "diclofenac sodium".
const ABBREVIATIONS: Record<string, string> = { chloride: 'cl' }

const sameName = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/** Whether the product the service returned is this item's drug. */
function confirms(item: InteractionCheckItem, resolved: Record<string, unknown>): boolean {
  if (String(resolved.udCode ?? '').startsWith('RAW-') || !resolved.udCode) return false
  const carried = new Set(asList(resolved.allNhiCodes).map(code => String(code).trim().toUpperCase()))
  if (item.codes?.some(code => carried.has(code.trim().toUpperCase()))) return true
  if (item.productName) return sameName(item.query, text(resolved.englishName))
  return !!item.query && resolvesTo(item.query, resolved)
}

function resolvesTo(query: string, resolved: Record<string, unknown>): boolean {
  const known = new Set(words(`${resolved.genericName ?? ''} ${resolved.englishName ?? ''}`))
  const asked = words(query)
  return asked.length > 0
    && asked.every((word, index) => known.has(word) || known.has(ABBREVIATIONS[word] ?? '')
      || (index > 0 && !IONS.has(asked[0] ?? '') && SALT_SUFFIXES.has(word)))
}

const AVOID = /不可併用|禁止併用|避免併用|不宜併用|不建議併用|禁忌/

function tierOf(severity: unknown, action: string, mechanism: string): InteractionTier {
  // The text outranks the service's grade: it rates sildenafil with a nitrate
  // "low" while the action reads 絕對不可併用. The warning is sometimes only
  // in the mechanism.
  if (AVOID.test(action) || AVOID.test(mechanism)) return 'avoid'
  return severity === 'high' || severity === 'moderate' ? 'act' : 'note'
}

const SEVERITIES: readonly string[] = ['high', 'moderate', 'low']
const severityOf = (value: unknown): InteractionSeverity =>
  SEVERITIES.includes(String(value)) ? value as InteractionSeverity : 'unknown'

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
  // Products of one ingredient (warfarin 1 mg and 5 mg) are one drug here, so
  // an interaction the service reports for each is listed once.
  const groupOf = new Map<string, string>()
  const rowsByGroup = new Map<string, Set<string>>()
  const verified = new Set<number>()
  for (const entry of asList(body.resolvedMedications).map(asRecord)) {
    const index = Number(entry.inputIndex)
    const item = plan.items[index]
    if (!item || !confirms(item, entry)) continue
    verified.add(index)
    const group = text(entry.genericName).toLowerCase().replace(/\s+/g, ' ') || String(entry.udCode)
    groupOf.set(String(entry.udCode), group)
    const ids = rowsByGroup.get(group) ?? new Set<string>()
    item.rowIds.forEach(id => ids.add(id))
    rowsByGroup.set(group, ids)
  }
  const groupOfDrug = (drug: unknown) => groupOf.get(String(asRecord(drug).udCode))
  const rowsOf = (drug: unknown) => [...(rowsByGroup.get(groupOfDrug(drug) ?? '') ?? [])]

  const unchecked = new Set(plan.unnamedRowIds)
  plan.items.forEach((item, index) => {
    if (!verified.has(index)) item.rowIds.forEach(id => unchecked.add(id))
  })
  const checked = new Set<string>()
  plan.items.forEach(item => item.rowIds.forEach(id => { if (!unchecked.has(id)) checked.add(id) }))

  const visitOf = new Map(rows.map(row => [row.id, row.encounterReference]))
  const ended = new Set(plan.endedRowIds)
  const findings = new Map<string, InteractionFinding>()
  for (const alert of asList(body.alerts).map(asRecord)) {
    if (alert.type !== 'DRUG_INTERACTION') continue
    const rowIdsA = rowsOf(alert.drugA)
    const rowIdsB = rowsOf(alert.drugB)
    if (!rowIdsA.length || !rowIdsB.length) continue
    // Two ingredients of one combination product are not a co-prescription.
    if (rowIdsA.length === 1 && rowIdsB.length === 1 && rowIdsA[0] === rowIdsB[0]) continue
    const action = text(alert.nursingAction)
    const mechanism = text(alert.mechanism)
    const id = [groupOfDrug(alert.drugA), groupOfDrug(alert.drugB)].sort().join('×')
    if (findings.has(id)) continue
    findings.set(id, {
      id,
      tier: tierOf(alert.severity, action, mechanism),
      severity: severityOf(alert.severity),
      rowIdsA,
      rowIdsB,
      action,
      mechanism,
      source: text(alert.source),
      samePrescription: rowIdsA.every(x => rowIdsB.every(y => {
        const visit = visitOf.get(x)
        return x === y || (!!visit && visit === visitOf.get(y))
      })),
      involvesEnded: rowIdsA.every(id => ended.has(id)) || rowIdsB.every(id => ended.has(id)),
    })
  }

  return {
    findings: [...findings.values()].sort((x, y) =>
      TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || Number(x.involvesEnded) - Number(y.involvesEnded)
        || Number(x.samePrescription) - Number(y.samePrescription)),
    checkedRowIds: [...checked],
    uncheckedRowIds: [...unchecked],
    localRowIds: plan.localRowIds,
    endedRowIds: plan.endedRowIds.filter(id => checked.has(id)),
    coveredUntil: plan.coveredUntil,
  }
}

/**
 * Pairs that need the clinician's attention: every pair across visits — the
 * service's grade is not reliable enough to fold a "low" away — and an avoid
 * pair even when one prescriber wrote both. Same-visit pairs below avoid were
 * the prescriber's own choice.
 */
export function attentionFindings(review: InteractionReview): InteractionFinding[] {
  return review.findings.filter(f => !f.samePrescription || f.tier === 'avoid')
}
