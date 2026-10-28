"use client"

import { useMemo } from "react"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { useOutpatientPrefs } from "@/src/application/hooks/use-outpatient-prefs.hook"
import { useProgressiveImportStore } from "@/src/application/stores/progressive-import.store"
import { buildIcdDictionary } from "@/src/shared/utils/icd-lookup"
import { isVghtpeSource } from "@/src/shared/utils/clinical-source-identity"
import { useVisitHistory, type VisitRecord } from "@/features/clinical-summary/visit-history/hooks/useVisitHistory"
import { useEncounterDetails, type EncounterDetails } from "@/features/clinical-summary/visit-history/hooks/useEncounterDetails"
import {
  buildPriorLabValues,
  buildRangeComparisons,
  isHospitalOutpatientEncounter,
  isSameClinician,
  withSourceEncounterLink,
  type PriorLabValue,
} from "../utils/last-outpatient"

export type HospitalOutpatientVisit = {
  id: string
  date: string
  department?: string
  physician?: string
  institution?: string
}

const EMPTY: never[] = []

/** The hospital's own copy of a visit: the record itself, the hospital copy a
 *  confirmed merge kept, or the hospital partner of an unresolved pair. */
function hospitalCopy(visit: VisitRecord, byId: Map<string, any>): any | undefined {
  const own = byId.get(visit.id)
  if (own && isVghtpeSource(own)) return own
  const merged = own?._sourceEncounterRecords?.find((source: any) => source && isVghtpeSource(source))
  if (merged) return merged
  return (visit.sourceIds ?? []).map((id) => byId.get(id)).find((source) => source && isVghtpeSource(source))
}

function toHospitalVisit(visit: VisitRecord, byId: Map<string, any>): HospitalOutpatientVisit {
  const copy = hospitalCopy(visit, byId)
  const physician = copy?.participant?.find((participant: any) => participant?.individual?.display)?.individual?.display
  const department = typeof copy?.serviceType?.text === 'string' ? copy.serviceType.text : undefined
  return {
    id: visit.id,
    date: visit.date,
    department: department || visit.department,
    physician: physician || visit.physician,
    institution: visit.institution,
  }
}

export function useLastOutpatient(selectedVisitId: string | null) {
  const { locale } = useLanguage()
  const { audience } = useAudience()
  const { clinicianName } = useOutpatientPrefs()
  // Read the store, not useProgressiveImportStatus(): that hook also owns the
  // extension's message listener, which the page-level status line mounts once.
  const progressivePhase = useProgressiveImportStore((state) => (state.current ?? state.initialFailure)?.phase)
  const {
    encounters = EMPTY,
    diagnosticReports = EMPTY,
    observations = EMPTY,
    conditions = EMPTY,
    resourceReady,
  } = useClinicalData()

  const isLoading = !resourceReady.encounters
    || !resourceReady.diagnosticReports
    || !resourceReady.observations
    || !resourceReady.conditions

  const icdDict = useMemo(() => buildIcdDictionary(conditions, locale, encounters), [conditions, locale, encounters])
  const visitHistory = useVisitHistory(encounters, icdDict)
  const encounterById = useMemo(() => new Map(encounters.map((encounter: any) => [encounter?.id, encounter])), [encounters])

  const visits = useMemo(() => visitHistory
    .filter((visit) => visit.type === 'outpatient'
      && [visit.id, ...(visit.sourceIds ?? [])].some((id) => isHospitalOutpatientEncounter(encounterById.get(id))))
    .map((visit) => toHospitalVisit(visit, encounterById)), [visitHistory, encounterById])

  const linkedReports = useMemo(() => withSourceEncounterLink(diagnosticReports), [diagnosticReports])
  const linkedObservations = useMemo(() => withSourceEncounterLink(observations), [observations])
  const details = useEncounterDetails(
    EMPTY, linkedReports, linkedObservations, EMPTY, EMPTY, EMPTY,
    locale, audience, EMPTY, icdDict, encounters,
  )
  const priorValues = useMemo(() => buildPriorLabValues(observations, diagnosticReports), [observations, diagnosticReports])
  const rangeComparisons = useMemo(() => buildRangeComparisons(linkedObservations, linkedReports), [linkedObservations, linkedReports])

  const mine = clinicianName ? visits.filter((visit) => isSameClinician(visit.physician, clinicianName)) : []
  const defaultVisit = mine[0] ?? visits[0]
  const visit = (selectedVisitId && visits.find((candidate) => candidate.id === selectedVisitId)) || defaultVisit

  return {
    isLoading,
    reportsPending: progressivePhase === 'reports-pending' || progressivePhase === 'reports-pending-partial',
    clinicianName,
    clinicianMatched: !!clinicianName && mine.length > 0,
    visits,
    visit,
    details: visit ? details.get(visit.id) as EncounterDetails | undefined : undefined,
    priorValues: priorValues as Map<string, PriorLabValue>,
    rangeComparisons,
  }
}
