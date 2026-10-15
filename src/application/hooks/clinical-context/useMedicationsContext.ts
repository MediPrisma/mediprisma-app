// Medications Context Hook
// Matches the left panel "Currently in use" logic shared with the FHIR tools.
// Explicit lifecycle status is respected; MediCloud unknown/missing status uses
// a computable source supply window, if present, to resolve currentness.
import { useMemo, useState } from "react"
import type { ClinicalContextSection } from "@/src/core/entities/clinical-context.entity"
import type { ClinicalData } from "./types"
import type { DataFilters } from "@/src/core/entities/clinical-context.entity"
import type { MedicationEntity } from "@/src/core/entities/clinical-data.entity"
import {
  medicationSourceCode,
  pickAiMedicationName,
} from "@/src/shared/utils/fhir-display-helpers"
import { routeAbbr } from "@/src/shared/utils/route-display"
import {
  durationToDays,
  isChronicMedicationRecord,
  isMedicationCurrentlyInUse,
  MILESTONE_ENCOUNTER_FLOOR_DAYS,
  normalizeClinicalStatus,
  selectMedicationRecords,
} from "@/src/core/utils/clinical-context-selection.utils"

const RECENTLY_ENDED_WINDOW_DAYS = 90

/** The floor's horizon, stated in the months the section heading uses. */
const FLOOR_WINDOW_MONTHS = Math.round(MILESTONE_ENCOUNTER_FLOOR_DAYS / 30)

interface MedSummary {
  name: string
  dose?: string
  route?: string
  frequency?: string
  startedOn?: string
  endDate?: string
  daysRemaining?: number
  /** Days supply the source recorded, when it recorded one. */
  supplyDays?: number
  state: 'current' | 'ended' | 'other'
  status: string
  isChronic: boolean
  /** Exact source product code used to resolve the adjacent governed
   * terminology. Kept on the same summary row so A/B/C medicines cannot pick
   * up one another's ingredient or ATC classification. */
  drugCode?: string
  drugTerminology?: MedicationEntity['drugTerminology']
  /** Number of refill cycles collapsed into this row (>=1, only set when >1) */
  refillCount?: number
  /** Prescribing / dispensing facility (MedicationRequest.requester.display).
   *  A 藥局/藥房 here is a pharmacy that DISPENSED a script, not a prescriber —
   *  formatLine marks it so the AI never counts it as a duplicate source. */
  org?: string
}

function summarize(
  med: any,
  nowMs: number,
): MedSummary {
  const name = pickAiMedicationName(
    med.medicationCodeableConcept,
    med.medicationReference?.display,
  )
    || 'Unknown medication'

  const dosage = med.dosageInstruction?.[0] || med.dosage?.[0]
  const frequency = dosage?.text || undefined
  // Bare SNOMED route codings (no text/display) resolve to the canonical
  // clinical abbreviation (PO / SC / …) — the AI context always speaks
  // canonical English regardless of UI audience/language.
  const route =
    dosage?.route?.text || dosage?.route?.coding?.[0]?.display || routeAbbr(dosage?.route) || undefined
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity
    ? `${dosage.doseAndRate[0].doseQuantity.value} ${dosage.doseAndRate[0].doseQuantity.unit || ''}`.trim()
    : undefined

  const startedRaw = med.authoredOn || med.effectiveDateTime
  const days = durationToDays(med.dispenseRequest?.expectedSupplyDuration)
    ?? durationToDays(dosage?.timing?.repeat?.boundsDuration)

  let endDate: string | undefined
  let daysRemaining: number | undefined
  if (startedRaw && days) {
    const start = new Date(startedRaw)
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start)
      end.setDate(end.getDate() + days)
      endDate = end.toISOString().slice(0, 10)
      daysRemaining = Math.ceil((end.getTime() - nowMs) / (1000 * 60 * 60 * 24))
    }
  }

  const status = normalizeClinicalStatus(med.status) || 'unknown'
  const current = isMedicationCurrentlyInUse(med, nowMs)
  const endedByStatus = ['stopped', 'completed', 'cancelled', 'ended'].includes(status)
  const state: MedSummary['state'] = current
    ? 'current'
    : endedByStatus || (daysRemaining !== undefined && daysRemaining < 0)
      ? 'ended'
      : 'other'

  return {
    name,
    dose,
    route,
    frequency,
    startedOn: startedRaw ? String(startedRaw).slice(0, 10) : undefined,
    endDate,
    daysRemaining,
    supplyDays: days,
    state,
    status,
    isChronic: isChronicMedicationRecord(med),
    drugCode: medicationSourceCode(med) || undefined,
    drugTerminology: med.drugTerminology,
    org: med.requester?.display,
  }
}

/** A facility whose name is a pharmacy (社區藥局 / 藥房) — it DISPENSES a
 *  script, it does not prescribe, so it can never be a duplicate-therapy
 *  source. */
function isPharmacyOrg(org?: string): boolean {
  return /藥局|藥房/.test(org ?? '')
}

function formatNhiTerminology(m: MedSummary): string | undefined {
  const terminology = m.drugTerminology
  if (!terminology) return undefined

  const atcNames = [terminology.atcNameEn, terminology.atcNameZh]
    .filter((value, index, values): value is string =>
      Boolean(value?.trim()) && values.indexOf(value) === index,
    )
  const subgroupNames = [
    terminology.atcLevel2NameEn,
    terminology.atcLevel2NameZh,
  ].filter((value, index, values): value is string =>
    Boolean(value?.trim()) && values.indexOf(value) === index,
  )
  const fields = [
    m.drugCode ? `NHI code=${m.drugCode}` : undefined,
    terminology.ingredientText
      ? `ingredient/strength=${terminology.ingredientText}`
      : undefined,
    terminology.officialNameZh
      ? `official product zh=${terminology.officialNameZh}`
      : undefined,
    terminology.officialNameEn
      ? `official product en=${terminology.officialNameEn}`
      : undefined,
    terminology.doseForm ? `dose form=${terminology.doseForm}` : undefined,
    terminology.atcCode
      ? `ATC=${terminology.atcCode}${atcNames.length > 0 ? ` · ${atcNames.join(' / ')}` : ''}`
      : undefined,
    terminology.atcLevel2Code
      ? `ATC therapeutic subgroup=${terminology.atcLevel2Code}${subgroupNames.length > 0 ? ` · ${subgroupNames.join(' / ')}` : ''}`
      : undefined,
    `source=${terminology.source}@${terminology.snapshotId}`,
  ].filter((value): value is string => Boolean(value))

  return `[NHI terminology matched to this exact medication record: ${fields.join('; ')}]`
}

function formatLine(m: MedSummary, mode: 'active' | 'recent' | 'other' | 'lapsed', neutral = false): string {
  const parts: string[] = [m.isChronic ? `${m.name} [慢箋]` : m.name]
  const dosing = [m.dose, m.frequency, m.route].filter(Boolean).join(', ')
  if (dosing) parts.push(`(${dosing})`)
  if (mode === 'active') {
    if (m.daysRemaining !== undefined && m.endDate) {
      parts.push(`— until ${m.endDate} (${m.daysRemaining}d left)`)
    } else if (m.startedOn) {
      parts.push(`— since ${m.startedOn}`)
    }
  } else if (mode === 'recent') {
    if (neutral) {
      if (m.startedOn) parts.push(`— last dispensed ${m.startedOn}`)
      if (m.endDate) parts.push(`(estimated supply to ${m.endDate})`)
    } else if (m.endDate) parts.push(`— last ended ${m.endDate}`)
    else if (m.startedOn) parts.push(`— ${m.startedOn}`)
  } else if (mode === 'lapsed') {
    if (m.startedOn) parts.push(`— last dispensed ${m.startedOn}`)
    if (m.supplyDays) {
      parts.push(neutral
        ? `(${m.supplyDays}d supply${m.endDate ? `, estimated to ${m.endDate}` : ''})`
        : `(${m.supplyDays}d supply${m.endDate ? `, ended ${m.endDate}` : ''})`)
    }
  } else {
    if (m.startedOn) parts.push(`— recorded ${m.startedOn}`)
    if (m.endDate) parts.push(`(calculated supply end ${m.endDate})`)
  }
  if (m.refillCount && m.refillCount > 1) {
    parts.push(`(${m.refillCount} refills)`)
  }
  const terminology = formatNhiTerminology(m)
  if (terminology) parts.push(terminology)
  const statusSemantics = m.status === 'entered-in-error'
    ? '; INVALIDATED—do not treat as a medication'
    : m.status === 'draft'
      ? '; DRAFT—not an active order'
      : m.status === 'on-hold'
        ? '; ON HOLD—not currently in use'
        : ''
  parts.push(`[status: ${m.status}${statusSemantics}]`)
  // Mark the source so the model can apply the duplicate rule: a pharmacy row
  // is a DISPENSING of an existing script, NOT a separate prescription.
  if (m.org) {
    parts.push(isPharmacyOrg(m.org) ? `[藥局領藥 · dispensing, NOT a prescriber: ${m.org}]` : `[開立 by ${m.org}]`)
  }
  return parts.join(' ')
}

/**
 * Collapse refill cycles of the same drug into one row. NHI 慢箋 medications
 * generate a new MedicationRequest every ~28 days, so a single chronic drug
 * can appear 5-6× in the same 90-day window — looks like the patient is
 * "starting and stopping" when they're actually on a stable regimen.
 *
 * Dedup key: drug + dose + route + schedule + organization + lifecycle status.
 * Keep the latest endDate / daysRemaining; track total refill count to surface
 * as `(N refills)` in the prompt.
 */
function dedupByDrug(meds: MedSummary[]): MedSummary[] {
  const byName = new Map<string, MedSummary>()
  for (const m of meds) {
    // Same display name is not enough: different strengths, routes, schedules,
    // facilities or lifecycle statuses may represent a real regimen change.
    const key = [m.name, m.dose, m.route, m.frequency, m.org, m.status].join('|')
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, { ...m, refillCount: 1 })
      continue
    }
    existing.refillCount = (existing.refillCount ?? 1) + 1
    // Prefer the row with the most recent endDate.
    if (m.endDate && (!existing.endDate || m.endDate > existing.endDate)) {
      existing.endDate = m.endDate
      existing.daysRemaining = m.daysRemaining
      existing.dose = m.dose ?? existing.dose
      existing.frequency = m.frequency ?? existing.frequency
      existing.route = m.route ?? existing.route
      existing.drugCode = m.drugCode ?? existing.drugCode
      existing.drugTerminology = m.drugTerminology ?? existing.drugTerminology
    }
    // Keep earliest startedOn so "since" stays meaningful.
    if (m.startedOn && (!existing.startedOn || m.startedOn < existing.startedOn)) {
      existing.startedOn = m.startedOn
    }
  }
  return Array.from(byName.values())
}

export function useMedicationsContext(
  includeMedications: boolean,
  clinicalData: ClinicalData | null,
  filters?: DataFilters,
  // Retained for API compatibility. The medication section remains
  // authoritative even when visit-linked records are repeated chronologically.
  _encountersShown: boolean = false,
  sharedNowMs?: number,
  /** 'neutral' (初診快覽): a passed supply estimate is not a stop. The cloud
   *  record holds dispensings, not stop orders, so the section says when a
   *  medicine was last dispensed and when its supply was estimated to run out
   *  — never that it is "NOT currently in use". */
  supplyWording: 'default' | 'neutral' = 'default',
): ClinicalContextSection | null {
  // The production clinical-context owner passes the shared day clock. Direct
  // experiment/test consumers keep one mount-time snapshot instead of adding
  // another focus listener or changing memo keys on every render.
  const [fallbackNowMs] = useState(Date.now)
  const neutral = supplyWording === 'neutral'
  const nowMs = sharedNowMs ?? fallbackNowMs
  return useMemo(() => {
    if (!includeMedications || !clinicalData?.medications?.length) return null

    // The medication section is the authoritative, filter-faithful list. Visit-
    // linked records may also be repeated under their encounter for chronology;
    // never remove them here, because the encounter and medication windows can
    // differ and cross-section "dedup" previously made records disappear.
    // `floor` are the recently dispensed medicines the latest-known floor added
    // because too few are current. They are NOT current, so the buckets below
    // would classify them as ended/other — and under the default 使用中 filter
    // those buckets are cleared, which is how a whole lapsed DM regimen used to
    // reach no AI module at all. They get their own labelled subsection instead.
    const { selected: meds, floor } = selectMedicationRecords(
      clinicalData.medications,
      filters,
      clinicalData as { encounters?: any[] },
      nowMs,
    )
    if (meds.length === 0 && floor.length === 0) return null

    const summaries = meds.map((m: any) => summarize(m, nowMs))
    const lapsed = dedupByDrug(floor.map((m: any) => summarize(m, nowMs)))

    const now = nowMs
    const recentThreshold = now - RECENTLY_ENDED_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const activeRaw: MedSummary[] = []
    const recentRaw: MedSummary[] = []
    const pastRaw: MedSummary[] = []
    const otherRaw: MedSummary[] = []

    for (const s of summaries) {
      if (s.state === 'current') {
        activeRaw.push(s)
      } else if (s.state === 'other') {
        otherRaw.push(s)
      } else if (s.endDate && new Date(s.endDate).getTime() >= recentThreshold) {
        recentRaw.push(s)
      } else {
        pastRaw.push(s)
      }
    }

    // Collapse refill cycles of the same drug — NHI 慢箋 produces a new
    // MedicationRequest every ~28 days; without dedup a single chronic drug
    // shows up 5-6× and the AI misreads it as frequent regimen changes.
    const active = dedupByDrug(activeRaw)
    const recent = dedupByDrug(recentRaw)
    const pastUnique = dedupByDrug(pastRaw)
    const other = dedupByDrug(otherRaw)

    if (filters?.medicationStatus === 'active') {
      recent.length = 0
      pastUnique.length = 0
      other.length = 0
    }

    const items: string[] = []

    if (active.length > 0) {
      items.push(`Currently in use (${active.length}):`)
      active.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity))
      active.forEach((m) => items.push(`  • ${formatLine(m, 'active', neutral)}`))
    }

    if (lapsed.length > 0) {
      if (items.length > 0) items.push('')
      items.push(neutral
        ? `Dispensed in the last ${FLOOR_WINDOW_MONTHS} months, estimated supply already passed (${lapsed.length}) — current use is not known from these records:`
        : `Recently dispensed, supply ended (last ${FLOOR_WINDOW_MONTHS} months, ${lapsed.length}) — NOT currently in use:`)
      lapsed.sort((a, b) => (b.startedOn || '').localeCompare(a.startedOn || ''))
      lapsed.forEach((m) => items.push(`  • ${formatLine(m, 'lapsed', neutral)}`))
    }

    if (recent.length > 0) {
      if (items.length > 0) items.push('')
      items.push(neutral
        ? `Estimated supply passed in the last ${RECENTLY_ENDED_WINDOW_DAYS} days (${recent.length}) — current use is not known from these records:`
        : `Recently ended (last ${RECENTLY_ENDED_WINDOW_DAYS} days, ${recent.length}):`)
      recent.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))
      recent.forEach((m) => items.push(`  • ${formatLine(m, 'recent', neutral)}`))
    }

    if (pastUnique.length > 0) {
      if (items.length > 0) items.push('')
      items.push(neutral
        ? `Older dispensings (estimated supply passed more than ${RECENTLY_ENDED_WINDOW_DAYS} days ago, ${pastUnique.length}):`
        : `Past medications (older than ${RECENTLY_ENDED_WINDOW_DAYS} days, ${pastUnique.length}):`)
      pastUnique.sort((a, b) => (b.endDate || b.startedOn || '').localeCompare(a.endDate || a.startedOn || ''))
      pastUnique.forEach((m) => items.push(`  • ${formatLine(m, 'recent', neutral)}`))
    }

    if (other.length > 0) {
      if (items.length > 0) items.push('')
      items.push(`Other medication records — not active (${other.length}):`)
      other
        .sort((a, b) => (b.startedOn || '').localeCompare(a.startedOn || ''))
        .forEach((m) => items.push(`  • ${formatLine(m, 'other')}`))
    }

    if (items.length === 0) return null
    items.push(
      '',
      'Record-fidelity note: visit-linked medication records may also appear under their visit; do not count repeated records as separate prescriptions.',
      'Terminology note: each NHI terminology block belongs only to the medication row that contains it. It can establish that product\'s ingredient/strength, dose form, and ATC classification, but it does not establish why this patient received it, actual use/adherence, or clinical outcome.',
      ...(neutral
        ? ['Supply note: these are dispensing records, not stop orders. A passed supply estimate does not show a medicine was stopped, and a long-acting injection (a depot dosed every one to six months) records a one-day supply while acting for its whole dosing interval.']
        : []),
    )
    return { title: "Patient's Medications", items }
  }, [includeMedications, clinicalData, filters, nowMs, neutral])
}
