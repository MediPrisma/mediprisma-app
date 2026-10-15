// Encounters Context Hook
// Encounter-centric view of patient data. Each visit shows its diagnoses,
// medications, lab tests, and procedures together — matching how clinicians
// actually read charts (per-visit, not per-data-type).
//
// Includes a top-level "currently active medications" summary so the AI gets
// a quick view of what the patient is on right now without having to scan
// every visit.
import { useMemo, useState } from "react"
import type { ClinicalContextSection, DataFilters, TimeRange } from "@/src/core/entities/clinical-context.entity"
import type { ClinicalData } from "./types"
import { buildIcdDictionary, extractEncounterIcds } from "@/src/shared/utils/icd-lookup"
import { useAudience } from "@/src/application/providers/audience.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { pickAiMedicationName, pickLocalizedText } from "@/src/shared/utils/fhir-display-helpers"
import {
  durationToDays,
  filterEncounterRecords,
  filterMedicationRecords,
  filterProcedureRecords,
  normalizeClinicalStatus,
} from "@/src/core/utils/clinical-context-selection.utils"
import { referenceId } from "@/src/core/utils/observation-selectors"

function refId(ref: any): string | undefined {
  return referenceId(ref?.reference)
}

function dateOnly(d: string | undefined): string | undefined {
  return d ? d.slice(0, 10) : undefined
}

function summarizeMedLine(
  m: any,
): string {
  const name = pickAiMedicationName(
    m.medicationCodeableConcept,
    m.medicationReference?.display,
  )
    || 'Unknown'
  const dosage = m.dosageInstruction?.[0]
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity
    ? `${dosage.doseAndRate[0].doseQuantity.value} ${dosage.doseAndRate[0].doseQuantity.unit || ''}`.trim()
    : undefined
  const freq = dosage?.text
  const route = dosage?.route?.text || dosage?.route?.coding?.[0]?.display
  const days = durationToDays(m.dispenseRequest?.expectedSupplyDuration)
  const dosing = [dose, freq, route].filter(Boolean).join(', ')
  const dur = days ? ` × ${days}d` : ''
  const status = normalizeClinicalStatus(m.status) || 'unknown'
  const semantics = status === 'entered-in-error'
    ? '; INVALIDATED—do not treat as a medication'
    : status === 'draft'
      ? '; DRAFT—not an active order'
      : status === 'on-hold'
        ? '; ON HOLD—not currently in use'
        : ''
  return `${name}${dosing ? ` (${dosing})` : ''}${dur} [status: ${status}${semantics}]`
}

function summarizeProcLine(
  p: any,
  audience: 'medical' | 'patient',
  locale: string,
): string {
  const title = pickLocalizedText(p.code, audience, locale)
    || p.code?.text
    || p.code?.coding?.[0]?.display
    || 'Procedure'
  const status = normalizeClinicalStatus(p.status) || 'unknown'
  const semantics = status === 'not-done'
    ? '; NOT PERFORMED'
    : status === 'entered-in-error'
      ? '; INVALIDATED—do not use as a clinical fact'
      : ''
  return `${title} [status: ${status}${semantics}]`
}

function diagnosesFromEncounter(enc: any, dict: Map<string, string>, locale: string): string[] {
  // Handles both new (one entry per diagnosis with English coding[].display)
  // and old (comma-separated codes in reasonCode[0].text) bridge formats.
  return extractEncounterIcds(enc, dict, locale).map((rc) =>
    rc.description ? `${rc.code} - ${rc.description}` : rc.code
  )
}

export function useEncountersContext(
  includeEncounters: boolean,
  clinicalData: ClinicalData | null,
  timeRange: TimeRange = 'all',
  options?: {
    includeMedications?: boolean
    includeProcedures?: boolean
    filters?: Partial<DataFilters>
    nowMs?: number
    /** 'count' names no medicine under a visit, only how many were
     *  prescribed there. NHI cloud visits carry one primary diagnosis, and a
     *  medicine listed under it reads as that diagnosis's treatment (a
     *  furosemide dispensed at a pneumonia visit became "pneumonia
     *  medication"); the medicines stay in 'Patient's Medications'. */
    visitMedications?: 'list' | 'count'
  },
): ClinicalContextSection | null {
  const { audience } = useAudience()
  const { locale } = useLanguage()
  const [fallbackNowMs] = useState(Date.now)
  const nowMs = options?.nowMs ?? fallbackNowMs
  return useMemo(() => {
    if (!includeEncounters || !clinicalData) return null
    const encounters: any[] = (clinicalData as any).encounters ?? []
    if (encounters.length === 0) return null

    const conditions: any[] = (clinicalData.conditions as any[]) ?? []
    const includeMedications = options?.includeMedications ?? true
    const includeProcedures = options?.includeProcedures ?? true
    const medications: any[] = includeMedications
      ? filterMedicationRecords(
          (clinicalData.medications as any[]) ?? [],
          options?.filters,
          clinicalData as { encounters?: any[] },
          options?.nowMs ?? nowMs,
        )
      : []
    const procedures: any[] = includeProcedures
      ? filterProcedureRecords(
          (clinicalData.procedures as any[]) ?? [],
          options?.filters,
          clinicalData as { encounters?: any[] },
        )
      : []

    // ICD descriptions follow UI language only (medical professionals
    // reading in zh-TW UI still get 中文 ICD descriptions because they're
    // descriptive labels, not pharmacology identifiers).
    const icdDict = buildIcdDictionary(conditions, locale)

    // Build encounter → resources map. Lab/observation VALUES are intentionally
    // NOT collected per-visit — measurement-type data lives in its own
    // trend-oriented sections (Lab Reports / Vital Signs / Other Observations)
    // so the time-series isn't fragmented across visits and isn't duplicated.
    const encMap = new Map<string, {
      diagnoses: string[]
      meds: any[]
      procs: any[]
    }>()

    for (const enc of encounters) {
      encMap.set(enc.id, { diagnoses: diagnosesFromEncounter(enc, icdDict, locale), meds: [], procs: [] })
    }

    const push = (encId: string | undefined, key: 'meds' | 'procs', item: any) => {
      if (!encId) return
      const entry = encMap.get(encId)
      if (!entry) return
      entry[key].push(item)
    }

    medications.forEach((m) => push(refId(m.encounter), 'meds', m))
    procedures.forEach((p) => push(refId(p.encounter), 'procs', p))

    // Honour the selected visit window exactly. Undated encounters are retained
    // in all-time mode and labelled explicitly instead of disappearing.
    const visitsToShow = filterEncounterRecords(
      encounters,
      timeRange,
      clinicalData as { encounters?: any[] },
    )

    const items: string[] = []

    // Per-visit details
    // The first-visit summary states its own diagnosis-code rule per data
    // source (a 雲端病歷 visit code IS the primary diagnosis); a note here
    // calling every code "billing, not confirmed" contradicted it, and the
    // 'Problem List' it pointed to is not in that context.
    const summaryVariant = options?.visitMedications === 'count'
    items.push(`Recent visits (showing ${visitsToShow.length} of ${encounters.length}):`)
    items.push(summaryVariant
      ? "Note: weigh the diagnosis codes under each visit by the diagnosis-code rule in the instructions. 'Patient\'s Medications' is the authoritative regimen list. Medication/procedure records may be repeated in their standalone sections; do not double-count them."
      : "Note: ICD codes listed under each visit come from billing/dispensing records and may not represent confirmed diagnoses. See 'Problem List' for clinically confirmed diagnoses. 'Patient\'s Medications' is the authoritative regimen list; visit-linked medication rows below are chronology only. Medication/procedure records may be repeated in their standalone sections; do not double-count them.")
    items.push('')

    for (const enc of visitsToShow) {
      const date = dateOnly(enc.period?.start) || 'Unknown date'
      const dept = enc.type?.[0]?.coding?.[0]?.display || enc.type?.[0]?.text || enc.serviceType?.text || ''
      const physician = enc.participant?.[0]?.individual?.display || enc.participant?.[0]?.actor?.display || ''
      const classText = enc.class?.display || enc.class?.code || ''

      const header = [date, dept, physician ? `Dr. ${physician}` : '', classText]
        .filter(Boolean)
        .join(' · ')
      items.push(`▶ ${header}`)

      const entry = encMap.get(enc.id)
      if (entry?.diagnoses.length) {
        items.push(summaryVariant
          ? `    Diagnosis code(s) on this visit: ${entry.diagnoses.join('; ')}`
          : `    ICD codes on visit record (billing, not confirmed diagnoses): ${entry.diagnoses.join('; ')}`)
      }
      if (entry?.meds.length) {
        if (options?.visitMedications === 'count') {
          items.push(`    Medications prescribed or dispensed at this visit: ${entry.meds.length} (named under 'Patient's Medications'; this visit's diagnosis code does not state any medicine's indication, and medicines dispensed together are not one problem's treatment)`)
        } else {
          items.push(`    Medications:`)
          entry.meds.forEach((m) => items.push(`      • ${summarizeMedLine(m)}`))
        }
      }
      if (entry?.procs.length) {
        items.push(`    Procedures:`)
        entry.procs.forEach((p) => items.push(`      • ${summarizeProcLine(p, audience, locale)}`))
      }
      items.push('')
    }

    return { title: 'Visits & Treatment History', items }
  }, [includeEncounters, clinicalData, timeRange, audience, locale, options, nowMs])
}
