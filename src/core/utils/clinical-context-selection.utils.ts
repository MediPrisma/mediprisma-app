import type { DataFilters, TimeRange } from '@/src/core/entities/clinical-context.entity'
import { makeTimeRangeTest } from '@/src/core/utils/date-filter.utils'
import { floorStartDay } from '@/src/core/utils/first-visit-floors'

const DAY_MS = 24 * 60 * 60 * 1000

export type MedicationCurrentnessBasis =
  | 'source-status'
  | 'source-status-and-supply-window'
  | 'supply-window'
  | 'insufficient-status-and-supply'

export interface MedicationCurrentnessAssessment {
  current: boolean
  uncertain: boolean
  basis: MedicationCurrentnessBasis
}

export function normalizeClinicalStatus(status: unknown): string {
  return typeof status === 'string' ? status.trim().toLowerCase() : ''
}

export function durationToDays(duration: any): number | undefined {
  const value = Number(duration?.value)
  if (!Number.isFinite(value) || value <= 0) return undefined
  const unit = String(duration?.unit || duration?.code || '').toLowerCase()
  const factor =
    unit.startsWith('d') ? 1 :
    unit.startsWith('w') ? 7 :
    unit.startsWith('mo') || unit === 'month' || unit === 'months' ? 30 :
    unit.startsWith('y') || unit === 'a' ? 365 :
    unit === 'h' || unit.startsWith('hour') ? 1 / 24 :
    1
  return Math.round(value * factor)
}

export function medicationExpectedEnd(medication: any): string | undefined {
  const dosage = medication?.dosageInstruction?.[0] || medication?.dosage?.[0]
  const days = durationToDays(medication?.dispenseRequest?.expectedSupplyDuration)
    ?? durationToDays(dosage?.timing?.repeat?.boundsDuration)
  const started = medication?.authoredOn || medication?.effectiveDateTime
  if (!started || !days) return undefined
  const date = new Date(started)
  if (Number.isNaN(date.getTime())) return undefined
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

// The newest record is picked by string sort, so only dates written the ISO
// way take part: "20240601" sorts after "2024-06-01" and does not parse. A
// malformed date must not break building the context every AI feature reads.
const isParsableDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value))

function isMedicationSupplyWindowOpen(end: string, nowMs: number): boolean {
  const endMs = Date.parse(end)
  return Number.isFinite(endMs) && endMs >= nowMs - DAY_MS
}

/**
 * Resolve currentness from source-authored fields without rewriting status.
 *
 * MediCloud medication records use `unknown` as their normal lifecycle status.
 * When those records carry enough source timing to calculate a supply end, the
 * supply window is authoritative for whether the prescription still covers the
 * current date. Only a missing/unknown status with no computable supply end is
 * genuinely unresolved. Explicit negative statuses always remain not current.
 */
export function assessMedicationCurrentness(
  medication: any,
  nowMs: number,
): MedicationCurrentnessAssessment {
  const status = normalizeClinicalStatus(medication?.status)
  const end = medicationExpectedEnd(medication)

  if (!status || status === 'unknown') {
    if (!end) {
      return {
        current: false,
        uncertain: true,
        basis: 'insufficient-status-and-supply',
      }
    }
    return {
      current: isMedicationSupplyWindowOpen(end, nowMs),
      uncertain: false,
      basis: 'supply-window',
    }
  }

  if (['draft', 'on-hold', 'stopped', 'cancelled', 'entered-in-error', 'ended'].includes(status)) {
    return { current: false, uncertain: false, basis: 'source-status' }
  }
  if (status !== 'active' && status !== 'completed') {
    return { current: false, uncertain: false, basis: 'source-status' }
  }

  if (!end) {
    return {
      current: status === 'active',
      uncertain: false,
      basis: 'source-status',
    }
  }

  return {
    current: isMedicationSupplyWindowOpen(end, nowMs),
    uncertain: false,
    basis: 'source-status-and-supply-window',
  }
}

export function isMedicationCurrentlyInUse(medication: any, nowMs: number): boolean {
  return assessMedicationCurrentness(medication, nowMs).current
}

export function isMedicationCurrentnessUncertain(medication: any, nowMs: number): boolean {
  return assessMedicationCurrentness(medication, nowMs).uncertain
}

export function isChronicMedicationRecord(medication: any): boolean {
  const coding = medication?.courseOfTherapyType?.coding
  return Array.isArray(coding) && coding.some((item: any) => item?.code === 'continuous')
}

/** What the medication scope kept, split into the records the saved filters
 *  selected and the recently-dispensed ones the latest-known floor added.
 *  Consumers that must LABEL the two differently (the AI medication section)
 *  read this; everything else takes the flat list below. */
export interface MedicationSelection {
  /** Records the saved filters selected on their own. */
  selected: any[]
  /** Lapsed records the floor added because too few medicines are current. */
  floor: any[]
}

export function selectMedicationRecords(
  medications: any[],
  filters: Partial<DataFilters> | undefined,
  clinicalData: { encounters?: any[] } | null | undefined,
  nowMs: number,
): MedicationSelection {
  const chronic = filters?.medicationChronic ?? 'all'
  const timeRange = filters?.medicationTimeRange ?? 'all'
  const inWindow = makeTimeRangeTest(timeRange, clinicalData)

  const selected = medications.filter((medication) => {
    if (chronic === 'chronic' && !isChronicMedicationRecord(medication)) return false
    if (chronic === 'acute' && isChronicMedicationRecord(medication)) return false
    const date = medication?.authoredOn || medication?.effectiveDateTime
    if (!inWindow(date)) return false
    if (filters?.medicationStatus === 'active' && !isMedicationCurrentlyInUse(medication, nowMs)) return false
    return true
  })
  if (filters?.medicationStatus !== 'active' || selected.length >= MEDICATION_FLOOR_MIN_CURRENT) {
    return { selected, floor: [] }
  }
  // Latest-known floor: when every supply window has lapsed (a chemotherapy
  // patient between cycles, a quiet half-year) the "使用中" view would hand the
  // AI an empty medicine list, which reads as "takes nothing". Fill up to the
  // floor with the most recently dispensed distinct medicines inside the
  // milestone horizon; both lanes mark them as lapsed.
  const newest = medications
    .map((medication) => String(medication?.authoredOn || medication?.effectiveDateTime || '').slice(0, 10))
    .filter(isParsableDay)
    .sort()
    .at(-1)
  const floorStart = floorStartDay(newest, MILESTONE_ENCOUNTER_FLOOR_DAYS)
  if (!floorStart) return { selected, floor: [] }
  const present = new Set(selected)
  const seenNames = new Set(selected.map(medicationDisplayName))
  // Only what was dispensed and has run out may be presented as lapsed: a
  // current medicine the 急慢性 filter left out stays out, and a record with no
  // supply estimate is unknown, not ended.
  const lapsed = medications
    .filter((medication) => !present.has(medication)
      && !(chronic === 'chronic' && !isChronicMedicationRecord(medication))
      && !(chronic === 'acute' && isChronicMedicationRecord(medication))
      && isLapsedDispensing(medication, nowMs)
      && String(medication?.authoredOn || medication?.effectiveDateTime || '').slice(0, 10) >= floorStart)
    .sort((a, b) => String(b?.authoredOn || b?.effectiveDateTime || '').localeCompare(String(a?.authoredOn || a?.effectiveDateTime || '')))
  const floor: any[] = []
  for (const medication of lapsed) {
    const name = medicationDisplayName(medication)
    if (!name || seenNames.has(name)) continue
    seenNames.add(name)
    floor.push(medication)
    if (floor.length >= MEDICATION_FLOOR_RECENT_COUNT) break
  }
  return { selected, floor }
}

export function filterMedicationRecords(
  medications: any[],
  filters: Partial<DataFilters> | undefined,
  clinicalData: { encounters?: any[] } | null | undefined,
  nowMs: number,
): any[] {
  const { selected, floor } = selectMedicationRecords(medications, filters, clinicalData, nowMs)
  return floor.length > 0 ? [...selected, ...floor] : selected
}

/**
 * Statuses that say the order never actually reached the patient. The floor
 * fills the list with what was most recently DISPENSED, so a draft, a hold, a
 * cancellation or a retraction can never take one of its slots — it would be
 * presented as a medicine the patient had been taking until recently.
 * `stopped`/`completed`/`ended` are absent on purpose: those orders did run.
 */
const NEVER_DISPENSED_STATUSES = new Set(['draft', 'on-hold', 'cancelled', 'entered-in-error'])

/**
 * A record that reached the patient and whose estimated supply has run out —
 * the only kind a latest-known fill may present as "supply ended". A never-
 * dispensed order is not one, and neither is a record with no supply estimate
 * (its state is unknown, not ended).
 */
export function isLapsedDispensing(medication: any, nowMs: number): boolean {
  if (NEVER_DISPENSED_STATUSES.has(normalizeClinicalStatus(medication?.status))) return false
  const end = medicationExpectedEnd(medication)
  return Boolean(end) && !isMedicationSupplyWindowOpen(end!, nowMs)
}

/** Below this many current medicines the recent-medicine floor engages. */
export const MEDICATION_FLOOR_MIN_CURRENT = 5
/** How many recently dispensed (lapsed) medicines the floor adds at most. */
export const MEDICATION_FLOOR_RECENT_COUNT = 10

function medicationDisplayName(medication: any): string {
  const text = medication?.medicationCodeableConcept?.text
    || medication?.medicationCodeableConcept?.coding?.[0]?.display
    || medication?.medicationReference?.display
    || ''
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim()
}

export function procedureDate(procedure: any): string | undefined {
  return procedure?.performedDateTime || procedure?.performedPeriod?.end || procedure?.performedPeriod?.start
}

export function filterProcedureRecords(
  procedures: any[],
  filters: Partial<DataFilters> | undefined,
  clinicalData: { encounters?: any[] } | null | undefined,
): any[] {
  const inWindow = makeTimeRangeTest(filters?.procedureTimeRange ?? 'all', clinicalData)
  let filtered = procedures.filter((procedure) => inWindow(procedureDate(procedure)))
  if (filters?.procedureVersion !== 'latest') return filtered

  const latestByName = new Map<string, any>()
  for (const procedure of filtered) {
    const name = procedure?.code?.text || procedure?.code?.coding?.[0]?.display || 'Procedure'
    const existing = latestByName.get(name)
    if (!existing || (procedureDate(procedure) || '') > (procedureDate(existing) || '')) {
      latestByName.set(name, procedure)
    }
  }
  filtered = [...latestByName.values()]
  return filtered
}

/** Admissions and emergency visits stay citable for this long however narrow
 *  the saved visit window is. The default 6-month window exists to keep routine
 *  outpatient/pharmacy rows out of the prompt; it was silently dropping the
 *  one admission whose claim codes carried the anticoagulant history. */
export const MILESTONE_ENCOUNTER_FLOOR_DAYS = 730

function isMilestoneEncounter(encounter: any): boolean {
  const cls = encounter?.class
  const code = String(cls?.code ?? cls?.coding?.[0]?.code ?? '').trim().toUpperCase()
  const display = `${cls?.display ?? ''} ${cls?.text ?? ''} ${cls?.coding?.[0]?.display ?? ''}`
  if (['IMP', 'ACUTE', 'NONAC', 'SS', 'EMER'].includes(code)) return true
  return /住院|急診|inpatient|emergency/i.test(display)
}

export function filterEncounterRecords(
  encounters: any[],
  range: TimeRange,
  clinicalData: { encounters?: any[] } | null | undefined,
): any[] {
  const inWindow = makeTimeRangeTest(range, clinicalData)
  const inMilestoneFloor = makeTimeRangeTest('all', clinicalData)
  const newest = [...(clinicalData?.encounters ?? encounters)]
    .map((encounter) => String(encounter?.period?.start ?? ''))
    .filter(isParsableDay)
    .sort()
    .at(-1)
  const floorStart = floorStartDay(newest, MILESTONE_ENCOUNTER_FLOOR_DAYS)
  const keptByFloor = (encounter: any): boolean => {
    if (!floorStart || !isMilestoneEncounter(encounter)) return false
    const start = String(encounter?.period?.start ?? '').slice(0, 10)
    return Boolean(start) && start >= floorStart && inMilestoneFloor(encounter?.period?.start)
  }
  return [...encounters]
    .filter((encounter) => range === 'all' || inWindow(encounter?.period?.start) || keptByFloor(encounter))
    .sort((a, b) => (b?.period?.start || '').localeCompare(a?.period?.start || ''))
}
