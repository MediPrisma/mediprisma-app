// 上次門診 — pure selectors behind the tab that gathers every lab and report a
// hospital (院內) outpatient visit ordered.
//
// The hospital bridge links each result to the Encounter whose order produced
// it (Observation/DiagnosticReport.encounter, from the matched outpatient
// order), even when the exam ran days later — an echo booked at the visit and
// read the next week still points back at that visit. Local import also adds
// a date-matched `encounter` to results that had none and marks it
// `_encounterInferred`; that convenience link only says "same day", not
// "ordered here", so it never places a result in this tab.

import { getAnalyteLabel, getAnalyteCanonicalKey } from "@voho0000/clinical-lab-normalization/canonical"
import { getInterpretationTag, getReferenceRangeComparison } from "@voho0000/clinical-lab-normalization/interpretation"
import { isVghtpeSource } from "@/src/shared/utils/clinical-source-identity"
import { getReferenceId } from "@/features/clinical-summary/visit-history/utils/formatters"

const RECONCILIATION_TAG_SYSTEM = 'urn:wildcatch:reconciliation'
const RECONCILED_HOSPITAL_OUTPATIENT = 'cloud-vghtpe-outpatient'

// Same statuses the visit history lists; cancelled, entered-in-error and
// planned encounters never happened.
const LISTED_STATUSES = new Set(['finished', 'in-progress', 'arrived', 'unknown'])

/** A hospital-sourced encounter, including a hospital visit that import merged
 *  into its matching cloud record (the merged record keeps the cloud source
 *  but carries the hospital copy and a reconciliation tag). */
export function isHospitalSourcedEncounter(encounter: any): boolean {
  if (!encounter) return false
  if (isVghtpeSource(encounter)) return true
  if (Array.isArray(encounter._sourceEncounterRecords)
    && encounter._sourceEncounterRecords.some((source: any) => source && isVghtpeSource(source))) return true
  return Array.isArray(encounter.meta?.tag) && encounter.meta.tag.some((tag: any) =>
    tag?.system === RECONCILIATION_TAG_SYSTEM && tag?.code === RECONCILED_HOSPITAL_OUTPATIENT)
}

export function isAmbulatoryEncounter(encounter: any): boolean {
  const classCode = String(encounter?.class?.code ?? '').trim().toUpperCase()
  return classCode === 'AMB'
    && LISTED_STATUSES.has(encounter?.status)
    && typeof encounter?.period?.start === 'string'
    && encounter.period.start.length >= 10
}

export function isHospitalOutpatientEncounter(encounter: any): boolean {
  return isAmbulatoryEncounter(encounter) && isHospitalSourcedEncounter(encounter)
}

/** The tab exists only for a chart that holds at least one hospital
 *  outpatient visit; a cloud-only chart (雲端病歷 / 健康存摺) never shows it. */
export function hasHospitalOutpatientVisit(encounters: readonly any[] | undefined): boolean {
  return Array.isArray(encounters) && encounters.some(isHospitalOutpatientEncounter)
}

/** Names compare after width folding, without spaces and without a trailing
 *  title, so 「王 志明」, 「王志明醫師」 and 「王志明 Dr.」 are one person.
 *  Nothing looser: two different physicians must never match. */
export function normalizeClinicianName(name: string | null | undefined): string {
  if (!name) return ''
  return displayClinicianName(name)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(醫師|医师|醫生|医生|主任|教授)$/u, '')
    .replace(/^(Dr\.?|Prof\.?)/i, '')
    .replace(/(,?M\.?D\.?|Dr\.?)$/i, '')
    .toLowerCase()
}

/** The physician as people say it: HIS appends the staff code, 「王志明 (DOC1234A)」. */
export function displayClinicianName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*[(（]\s*DOC[A-Z0-9]+\s*[)）]\s*$/i, '').trim()
}

export type RecentPhysician = {
  name: string
  departments: string[]
  visits: number
  lastVisit: string
}

/**
 * The physicians of this chart's hospital outpatient visits in the year up to
 * `now`, newest first: the names the clinician can pick as their own. Read
 * from the hospital's copy of each visit (a merged visit keeps it).
 */
export function recentHospitalPhysicians(encounters: readonly any[] | undefined, now: Date = new Date()): RecentPhysician[] {
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const byName = new Map<string, RecentPhysician>()
  for (const encounter of encounters ?? []) {
    if (!isHospitalOutpatientEncounter(encounter)) continue
    const day = encounter.period.start.slice(0, 10)
    if (day < since) continue
    const copy = isVghtpeSource(encounter) ? encounter
      : encounter._sourceEncounterRecords?.find((source: any) => source && isVghtpeSource(source)) ?? encounter
    const name = displayClinicianName(copy.participant?.find((participant: any) => participant?.individual?.display)?.individual?.display)
    const key = normalizeClinicianName(name)
    if (!key) continue
    const department = typeof copy.serviceType?.text === 'string' ? copy.serviceType.text.trim() : ''
    const entry: RecentPhysician = byName.get(key) ?? { name, departments: [], visits: 0, lastVisit: day }
    entry.visits += 1
    if (day > entry.lastVisit) { entry.lastVisit = day; entry.name = name }
    if (department && !entry.departments.includes(department)) entry.departments.push(department)
    byName.set(key, entry)
  }
  return [...byName.values()].sort((a, b) => b.lastVisit.localeCompare(a.lastVisit) || a.name.localeCompare(b.name))
}

export function isSameClinician(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeClinicianName(a)
  return left.length > 0 && left === normalizeClinicianName(b)
}

/** The visits a result was ordered at: the source's own encounter link, plus
 *  the visit of every outpatient order it is basedOn. One request can serve
 *  several same-day visits (a combined draw), so a result may belong to more
 *  than one. Import's same-day inference never counts. */
export function orderingVisitIds(resource: any): string[] {
  const visits = new Set<string>()
  const linked = resource?._encounterInferred === true ? null : getReferenceId(resource?.encounter)
  if (linked) visits.add(linked)
  if (Array.isArray(resource?._orderEncounterIds)) {
    for (const id of resource._orderEncounterIds) if (typeof id === 'string' && id) visits.add(id)
  }
  return [...visits]
}

/**
 * The results ordered at one visit (any of `visitIds`: the visit and the
 * source records it was projected from), each returned with its encounter set
 * to `visitId` so the visit grouping places it there. `shared` holds the ids of
 * those also ordered at another visit.
 */
export function resultsOrderedAt<T>(
  resources: readonly T[] | undefined,
  visitIds: ReadonlySet<string>,
  visitId: string,
): { results: T[]; shared: Set<string> } {
  const results: T[] = []
  const shared = new Set<string>()
  for (const resource of resources ?? []) {
    const visits = orderingVisitIds(resource)
    if (!visits.some((id) => visitIds.has(id))) continue
    const id = (resource as any)?.id
    if (typeof id === 'string' && visits.some((other) => !visitIds.has(other))) shared.add(id)
    results.push({ ...resource, encounter: { reference: `Encounter/${visitId}` }, _encounterInferred: false } as T)
  }
  return { results, shared }
}

export type PriorLabValue = {
  value: string
  date: string
  /** The earlier result's own unit, set only when it differs from this
   *  result's: the figures are then on different scales and are not converted. */
  unit?: string
}

function analyteKey(observation: any): string | null {
  return getAnalyteCanonicalKey(observation) ?? (getAnalyteLabel(observation) || null)
}

function observationWhen(observation: any): string {
  const when = observation?.effectiveDateTime ?? observation?.effectivePeriod?.start ?? observation?.issued
  return typeof when === 'string' ? when : ''
}

function observationDay(observation: any): string {
  return observationWhen(observation).slice(0, 10)
}

function compactValue(observation: any): string {
  const quantity = observation?.valueQuantity
  if (quantity && quantity.value != null) {
    const comparator = typeof quantity.comparator === 'string' ? quantity.comparator : ''
    return `${comparator}${quantity.value}`
  }
  return typeof observation?.valueString === 'string' ? observation.valueString.trim() : ''
}

function quantityUnit(observation: any): string {
  const quantity = observation?.valueQuantity
  const unit = typeof quantity?.unit === 'string' && quantity.unit.trim() ? quantity.unit : quantity?.code
  return typeof unit === 'string' ? unit.trim() : ''
}

function allObservations(observations: readonly any[], reports: readonly any[]): any[] {
  const byId = new Map<string, any>()
  const unnamed: any[] = []
  const add = (observation: any) => {
    if (!observation) return
    if (typeof observation.id === 'string' && observation.id) {
      if (!byId.has(observation.id)) byId.set(observation.id, observation)
    } else unnamed.push(observation)
  }
  observations.forEach(add)
  reports.forEach((report: any) => {
    if (Array.isArray(report?._observations)) report._observations.forEach(add)
  })
  return [...byId.values(), ...unnamed]
}

/**
 * For each observation id, the same analyte's most recent result from an
 * EARLIER day, from any source. A same-day result is not "previous": it is a
 * repeat draw or the other source's copy of this one.
 */
export function buildPriorLabValues(
  observations: readonly any[] | undefined,
  reports: readonly any[] | undefined,
): Map<string, PriorLabValue> {
  const all = allObservations(observations ?? [], reports ?? [])
  const byAnalyte = new Map<string, Array<{ day: string; time: number; observation: any }>>()
  for (const observation of all) {
    if (observation?.status === 'entered-in-error' || observation?.status === 'cancelled') continue
    const key = analyteKey(observation)
    const day = observationDay(observation)
    if (!key || !day || !compactValue(observation)) continue
    const series = byAnalyte.get(key) ?? []
    series.push({ day, time: Date.parse(observationWhen(observation)) || 0, observation })
    byAnalyte.set(key, series)
  }

  const prior = new Map<string, PriorLabValue>()
  for (const series of byAnalyte.values()) {
    // Within a day by draw time: the previous value is that day's latest draw.
    series.sort((a, b) => a.day.localeCompare(b.day) || a.time - b.time)
    let earlier: { day: string; observation: any } | null = null
    let index = 0
    while (index < series.length) {
      const day = series[index].day
      const sameDay: any[] = []
      while (index < series.length && series[index].day === day) sameDay.push(series[index++].observation)
      if (earlier) {
        for (const observation of sameDay) {
          if (typeof observation?.id === 'string' && observation.id) {
            const unit = quantityUnit(earlier.observation)
            prior.set(observation.id, {
              value: compactValue(earlier.observation),
              date: earlier.day,
              ...(unit && unit.toLowerCase() !== quantityUnit(observation).toLowerCase() ? { unit } : {}),
            })
          }
        }
      }
      earlier = { day, observation: sameDay[sameDay.length - 1] }
    }
  }
  return prior
}

/**
 * For a result the source did not flag, whether its value sits above or below
 * the reference range — the same fallback the reports tab badges. Keyed like
 * the visit view's rows: the observation id, or `${observationId}-${index}`
 * for a component without its own id.
 */
export function buildRangeComparisons(
  observations: readonly any[] | undefined,
  reports: readonly any[] | undefined,
): Map<string, 'high' | 'low'> {
  const comparisons = new Map<string, 'high' | 'low'>()
  const record = (id: string | undefined, result: any) => {
    if (!id || getInterpretationTag(result?.interpretation)) return
    const comparison = getReferenceRangeComparison(result)
    if (comparison === 'high' || comparison === 'low') comparisons.set(id, comparison)
  }
  for (const observation of allObservations(observations ?? [], reports ?? [])) {
    record(observation?.id, observation)
    if (Array.isArray(observation?.component)) {
      observation.component.forEach((component: any, index: number) => {
        record(component?.id || `${observation?.id || 'component'}-${index}`, component)
      })
    }
  }
  return comparisons
}
