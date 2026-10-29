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
  displayClinicianName,
  isHospitalOutpatientEncounter,
  isSameClinician,
  orderingVisitIds,
  resultsOrderedAt,
  type PriorLabValue,
} from "../utils/last-outpatient"

export type HospitalOutpatientVisit = {
  id: string
  /** The visit and the source records it was projected from. */
  encounterIds: string[]
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
    encounterIds: [visit.id, ...(visit.sourceIds ?? [])],
    date: visit.date,
    department: department || visit.department,
    physician: displayClinicianName(physician || visit.physician) || undefined,
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

  // Visits with at least one result of their own, for the visit list.
  const withResults = useMemo(() => {
    const ordered = new Set<string>()
    for (const resource of [...diagnosticReports, ...observations] as any[]) {
      for (const id of orderingVisitIds(resource)) ordered.add(id)
    }
    return new Set(visits.filter((visit) => visit.encounterIds.some((id) => ordered.has(id))).map((visit) => visit.id))
  }, [visits, diagnosticReports, observations])

  const mine = clinicianName ? visits.filter((visit) => isSameClinician(visit.physician, clinicianName)) : []
  const defaultVisit = mine[0] ?? visits[0]
  const visit = (selectedVisitId && visits.find((candidate) => candidate.id === selectedVisitId)) || defaultVisit

  // Only this visit's results, each placed under it: its own source link or an
  // order of this visit in basedOn (a combined draw belongs to every visit
  // whose order it served). Import's same-day inference never counts.
  const ordered = useMemo(() => {
    if (!visit) return { reports: EMPTY, observations: EMPTY, sharedIds: new Set<string>() }
    const ids = new Set(visit.encounterIds)
    const reports = resultsOrderedAt(diagnosticReports, ids, visit.id)
    const standalone = resultsOrderedAt(observations, ids, visit.id)
    const sharedIds = new Set([...reports.shared, ...standalone.shared])
    // A shared panel's results are shared with it.
    for (const report of reports.results as any[]) {
      if (!sharedIds.has(report.id)) continue
      for (const member of report._observations ?? []) if (member?.id) sharedIds.add(member.id)
    }
    return { reports: reports.results, observations: standalone.results, sharedIds }
  }, [visit, diagnosticReports, observations])

  const details = useEncounterDetails(
    EMPTY, ordered.reports, ordered.observations, EMPTY, EMPTY, EMPTY,
    locale, audience, EMPTY, icdDict, encounters,
  )
  const priorValues = useMemo(() => buildPriorLabValues(observations, diagnosticReports), [observations, diagnosticReports])
  // The source Observation behind each row, for the shared trend / history pane.
  const sourceObservations = useMemo(() => {
    const byId = new Map<string, any>()
    for (const observation of observations as any[]) if (observation?.id) byId.set(observation.id, observation)
    for (const report of diagnosticReports as any[]) {
      for (const member of report?._observations ?? []) if (member?.id && !byId.has(member.id)) byId.set(member.id, member)
    }
    return byId
  }, [observations, diagnosticReports])
  const rangeComparisons = useMemo(() => buildRangeComparisons(ordered.observations, ordered.reports), [ordered])
  const visitDetails = visit ? details.get(visit.id) as EncounterDetails | undefined : undefined
  const sharedCount = visitDetails
    ? visitDetails.tests.filter((test) => ordered.sharedIds.has(test.id)).length
      + visitDetails.reports.filter((report) => report.row.diagnosticReportIds?.some((id) => ordered.sharedIds.has(id))).length
    : 0

  return {
    isLoading,
    reportsPending: progressivePhase === 'reports-pending' || progressivePhase === 'reports-pending-partial',
    clinicianName,
    clinicianMatched: !!clinicianName && mine.length > 0,
    visits,
    withResults,
    visit,
    details: visitDetails,
    sharedCount,
    priorValues: priorValues as Map<string, PriorLabValue>,
    rangeComparisons,
    sourceObservations,
  }
}
