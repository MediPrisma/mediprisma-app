"use client"

// Single source of truth for everything the 總覽 tab renders.
//
// This hook owns NO fetching and NO clinical judgement of its own: it reuses
// the very hooks the 報告 / 用藥 / 就診 tabs use, applies the overview time
// window, and hands back per-section rows plus the counts the header tiles
// show. Tiles and card headers therefore can never disagree — they read the
// same object.
import { useMemo } from 'react'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { buildIcdDictionary } from '@/src/shared/utils/icd-lookup'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { buildLabPivots, primaryCellRecord, type LabCell } from '@/src/shared/utils/lab-pivot.utils'
import { categorizeObservation, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'
import type { DisplayLang } from '@voho0000/clinical-lab-normalization/display'
import { useReportsData } from '@/features/clinical-summary/reports/hooks/useReportsData'
import { groupMultiRegionStudies } from '@/features/clinical-summary/reports/utils/multi-region-grouping'
import { extractReportPreview } from '@/src/shared/utils/report-preview'
import { decodeReportEntities, separateGluedOrderCode } from '@/src/shared/utils/report-text-format'
import type { NhiViewerAction, ReportGroup, Row } from '@/features/clinical-summary/reports/types'
import { useVisitHistory, type VisitRecord } from '@/features/clinical-summary/visit-history/hooks/useVisitHistory'
import { useEncounterDetails, type EncounterDetails } from '@/features/clinical-summary/visit-history/hooks/useEncounterDetails'
import { useClinicalNotes } from '@/features/clinical-summary/visit-history/hooks/useClinicalNotes'
import { useVisitStats } from '@/features/clinical-summary/visit-history/hooks/useVisitStats'
import { useDocumentSummaries } from '@/features/clinical-summary/document-summary/hooks/useDocumentSummaries'
import { useDocumentSummaryStrings } from '@/features/clinical-summary/document-summary/utils/strings'
import type { DocumentEntry } from '@/features/clinical-summary/document-summary/types'
import {
  isOverviewPinnedAnalyte,
  isWithinOverviewWindow,
  overlapsOverviewWindow,
  toDayKey,
  type OverviewWindow,
} from '../utils/overview-selectors'
import { useOverviewMeds, type OverviewMedsData } from './useOverviewMeds'

export type { OverviewMedItem, OverviewMedsData } from './useOverviewMeds'

export interface OverviewLabColumn {
  day: string
  /** Short institution label under the date, when the source named one. */
  institution?: string
}

export interface OverviewLabRow {
  mapKey: string
  categoryId: string
  categoryLabel: string
  testKey: string
  name: string
  unit?: string
  isPinned: boolean
  hasAbnormal: boolean
  cells: (LabCell | undefined)[]
}

export interface OverviewLabsData {
  columns: OverviewLabColumn[]
  rows: OverviewLabRow[]
  pinnedRowCount: number
  /** Collection days inside the window that did not fit the column budget. */
  hiddenDayCount: number
  /** Distinct analyte × day results represented by the pivot. */
  resultCount: number
  abnormalCount: number
  /** In-window results the lab taxonomy could not place in any pivot. */
  unpivotedCount: number
  /** An Observation id used to jump into the 報告 tab. */
  navResourceId?: string
  /** Every loaded Observation, not cut to the window: a trend reads the
   *  whole chart. */
  allObservations?: readonly any[]
}

export interface OverviewReportItem {
  /** Carries images or a viewer request, whether or not it has report text. */
  hasImages?: boolean
  /** 健保影像 requests, exactly as the 報告 tab's imaging rows expose them. */
  viewerActions?: NhiViewerAction[]
  /** >0 when this row stands for a multi-region study the bridge could not
   *  pair (Row.groupedRows). */
  groupedCount?: number
  /** The cluster shares one NHI order code across body parts — the bridge
   *  cannot say which report belongs to which image. */
  hasAmbiguity?: boolean
  /** How many of the cluster's records actually carry report text. */
  narrativeCount?: number
  /** Each member report of a merged cluster, kept apart. */
  reports?: { id: string; text: string }[]
  id: string
  title: string
  group: ReportGroup
  institution?: string
  day?: string
  summary: string
  /** Source heading of the section `summary` previews ("Impression"), when it
   *  is the report's conclusion rather than its opening line. */
  summaryLabel?: string
  fullText: string
  /** Resource the 報告 tab should scroll-flash. */
  navResourceType: 'DiagnosticReport' | 'Procedure' | 'Observation'
  navResourceId: string
}

export interface OverviewReportsData {
  items: OverviewReportItem[]
  /** Report groups actually present in the window, in taxonomy order. */
  groups: ReportGroup[]
  count: number
}


export interface OverviewVisitItem {
  visit: VisitRecord
  details?: EncounterDetails
  documents?: DocumentEntry[]
  abnormalCount: number
  testCount: number
  reportCount: number
  diagnosisCount: number
  medicationCount: number
}

export interface OverviewVisitsData {
  items: OverviewVisitItem[]
  count: number
  emergencyCount: number
  inpatientCount: number
  outpatientCount: number
}

export interface OverviewData {
  isLoading: boolean
  error: Error | null
  labs: OverviewLabsData
  reports: OverviewReportsData
  meds: OverviewMedsData
  visits: OverviewVisitsData
  /** Newest day carrying data of ANY of the four kinds, ignoring the window. */
  latestDataDay?: string
  isEmpty: boolean
}

const REPORT_GROUP_ORDER: ReportGroup[] = [
  'imaging',
  'pathology',
  'procedures',
  'cancer-screening',
  'vitals',
  'other',
]

/** DiagnosticReport / ImagingStudy date, matching the 報告 tab's preference. */
function reportRowDay(row: Row): string | undefined {
  return toDayKey(row.effectiveDate)
}

/** First non-empty line of the report narrative, used as the collapsed summary. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ''
}

function reportNarrative(row: Row): string {
  const summary = row.obs?.find(
    (observation) => observation?.code?.text === 'Report Summary',
  )
  const value = typeof summary?.valueString === 'string' ? summary.valueString.trim() : ''
  return value
}


/**
 * What 影像／檢查報告 shows: exactly the 影像 and 病理 sub-tabs of 報告 — the
 * narrative studies a clinician actually reads.
 *
 * NOT 處置. Those are billed procedure lines (耳垢嵌塞取出, 呼吸運動,
 * 脈動式血氧飽和度監測…) with no report text to read, and they outnumber real
 * imaging by enough to push it out of a bounded card entirely. They remain on
 * the 報告 tab's own 處置 sub-tab and inside each visit's detail.
 */
const REPORT_GROUPS_SHOWN = new Set<ReportGroup>(['imaging', 'pathology'])

export function useOverviewData(window: OverviewWindow): OverviewData {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const {
    encounters = [],
    medications = [],
    diagnosticReports = [],
    imagingStudies = [],
    observations = [],
    procedures = [],
    conditions = [],
    documentReferences = [],
    compositions = [],
    resourceReady,
    error,
  } = useClinicalData()

  // The overview renders all four kinds side by side, so it waits for the
  // union of what each section needs. Types it never draws (allergies,
  // devices, care plans) do not hold it back.
  const isLoading = !resourceReady.encounters
    || !resourceReady.medications
    || !resourceReady.diagnosticReports
    || !resourceReady.observations
    || !resourceReady.procedures
    || !resourceReady.conditions

  const displayLang: DisplayLang = locale === 'zh-TW' ? 'zh-TW' : 'en'

  // ── Window-scoped source slices ──────────────────────────────────────────
  // Filtering before the heavy builders keeps this tab from re-deriving the
  // patient's whole chart on every range change.
  const windowedObservations = useMemo(
    () => (Array.isArray(observations) ? observations : []).filter(
      (observation: any) => isWithinOverviewWindow(observation?.effectiveDateTime, window),
    ),
    [observations, window],
  )
  const windowedReports = useMemo(
    () => (Array.isArray(diagnosticReports) ? diagnosticReports : []).filter(
      (report: any) => isWithinOverviewWindow(report?.effectiveDateTime ?? report?.issued, window),
    ),
    [diagnosticReports, window],
  )
  const windowedStudies = useMemo(
    () => (Array.isArray(imagingStudies) ? imagingStudies : []).filter(
      (study: any) => isWithinOverviewWindow(study?.started, window),
    ),
    [imagingStudies, window],
  )

  // ── 檢驗 ────────────────────────────────────────────────────────────────
  const pivots = useMemo(() => buildLabPivots(windowedObservations), [windowedObservations])
  const categoryLabels = (t.reports as any)?.cumulativeCategories as Record<string, string> | undefined

  const labs = useMemo<OverviewLabsData>(() => {
    // Institution per collection day: the label under the date header. Take the
    // most frequently reported performer so one stray record cannot rename the
    // column. Observation.performer is 0..*; only Reference.display is human
    // readable, so entries without one are skipped rather than guessed at.
    const dayInstitutionCounts = new Map<string, Map<string, number>>()
    let unpivotedCount = 0
    for (const observation of windowedObservations as any[]) {
      const day = toDayKey(observation?.effectiveDateTime)
      if (!day) continue
      if (!categorizeObservation(observation)) {
        unpivotedCount += 1
        continue
      }
      const performers = Array.isArray(observation?.performer) ? observation.performer : []
      for (const performer of performers) {
        const display = typeof performer?.display === 'string' ? performer.display.trim() : ''
        if (!display) continue
        const bucket = dayInstitutionCounts.get(day) ?? new Map<string, number>()
        bucket.set(display, (bucket.get(display) ?? 0) + 1)
        dayInstitutionCounts.set(day, bucket)
        break
      }
    }

    const allDays = new Set<string>()
    for (const category of LAB_CATEGORIES) {
      for (const day of pivots[category.id]?.dates ?? []) allDays.add(day)
    }
    // Keep every collection day for the expanded list. The card applies its
    // own width budget; cutting dates here would also
    // discard older-only analytes and undercount the window's results.
    const shownDays = [...allDays].sort((a, b) => a.localeCompare(b))
    const columns: OverviewLabColumn[] = shownDays.map((day) => {
      const counts = dayInstitutionCounts.get(day)
      let best: string | undefined
      let bestCount = 0
      counts?.forEach((count, name) => {
        if (count > bestCount) {
          best = name
          bestCount = count
        }
      })
      return {
        day,
        institution: best ? formatOrganizationDisplay(best, locale) : undefined,
      }
    })

    const rows: OverviewLabRow[] = []
    let resultCount = 0
    let abnormalCount = 0
    let pinnedRowCount = 0
    let navResourceId: string | undefined

    for (const category of LAB_CATEGORIES) {
      const pivot = pivots[category.id]
      if (!pivot) continue
      for (const row of pivot.rows) {
        // A day whose every record is entered-in-error / cancelled has no
        // result to show, and a cell is abnormal only through a VALID record —
        // judged per record, never from the same-day merge (primaryCellRecord).
        const cells = shownDays.map((day) => {
          const cell = row.values.get(day)
          return cell && primaryCellRecord(cell) ? cell : undefined
        })
        // Pinned stub rows (injected so a standard panel always shows its
        // columns) carry no values — the overview only lists analytes the
        // patient actually has inside the window.
        if (!cells.some(Boolean)) continue
        const cellAbnormal = (cell: LabCell | undefined) =>
          !!cell && !!primaryCellRecord(cell)?.valid.some((record) => record.isAbnormal)
        const hasAbnormal = cells.some(cellAbnormal)
        for (const cell of cells) {
          if (!cell) continue
          resultCount += 1
          if (cellAbnormal(cell)) abnormalCount += 1
        }
        const isPinned = isOverviewPinnedAnalyte(category.id, row.testKey)
        if (isPinned) pinnedRowCount += 1
        const parts = getLabRowDisplayParts(row, audience, displayLang)
        rows.push({
          mapKey: `${category.id}:${row.mapKey}`,
          categoryId: category.id,
          categoryLabel: categoryLabels?.[category.id] ?? category.id,
          testKey: row.testKey,
          name: parts.abbr ? `${parts.name} (${parts.abbr})` : parts.name,
          unit: row.unit,
          isPinned,
          hasAbnormal,
          cells,
        })
      }
    }

    // Any in-window Observation that made it into a pivot is a valid landing
    // point for 「在報告分頁看全部」.
    for (const observation of windowedObservations as any[]) {
      if (typeof observation?.id === 'string' && categorizeObservation(observation)) {
        navResourceId = observation.id
        break
      }
    }

    return {
      columns,
      rows,
      pinnedRowCount,
      hiddenDayCount: 0,
      resultCount,
      abnormalCount,
      unpivotedCount,
      navResourceId,
      allObservations: Array.isArray(observations) ? observations : [],
    }
  }, [audience, categoryLabels, displayLang, locale, observations, pivots, windowedObservations])

  // ── 影像／檢查報告 ───────────────────────────────────────────────────────
  const { reportRows } = useReportsData(windowedReports, windowedStudies)

  const reports = useMemo<OverviewReportsData>(() => {
    const items: OverviewReportItem[] = []
    const push = (row: Row, navResourceType: OverviewReportItem['navResourceType']) => {
      const narrative = separateGluedOrderCode(decodeReportEntities(reportNarrative(row)))
      // The row PREVIEW does not pass through formatReportText, so it decodes
      // the source's XML escaping itself — otherwise a summary line shows
      // "L&apos;t knee" while the opened report shows "L't knee".
      const members = row.groupedRows ?? []
      // A grouped row's narrative lives on its members. Keep them SEPARATE:
      // the cluster is several distinct reports on different body parts that
      // merely share an NHI order code, and running them together into one
      // block reads as a single report about all of them.
      const memberReports = members
        .map((member) => ({
          id: member.id,
          text: separateGluedOrderCode(decodeReportEntities(reportNarrative(member))),
        }))
        .filter((entry) => !!entry.text)
      // 健保影像 requests belong to the individual studies. A merged cluster's
      // synthetic row copies the FIRST member's fields, so reading them off
      // the row would show one member's viewer and silently drop the rest;
      // when there are members they are the only source.
      const viewerActions = members.length
        ? members.flatMap((member) => member.viewerActions ?? [])
        : (row.viewerActions ?? [])
      const previewSource = narrative || memberReports[0]?.text || ''
      const preview = extractReportPreview(previewSource)
      items.push({
        id: `${navResourceType}:${row.id}`,
        title: row.title,
        group: row.group,
        institution: row.institution,
        day: reportRowDay(row),
        summary: preview?.text ?? firstLine(previewSource),
        summaryLabel: preview?.label,
        fullText: narrative,
        reports: memberReports.length ? memberReports : undefined,
        hasImages: !!row.images?.length || viewerActions.length > 0
          || members.some((member) => !!member.images?.length),
        viewerActions: viewerActions.length > 0 ? viewerActions : undefined,
        groupedCount: members.length,
        hasAmbiguity: !!row.hasAmbiguity,
        narrativeCount: members.length ? memberReports.length : (narrative ? 1 : 0),
        navResourceType,
        navResourceId: row.diagnosticReportIds?.[0]
          ?? row.imagingStudyIds?.[0]
          ?? row.id,
      })
    }
    // The 報告 tab merges the multi-region clusters at the display layer
    // (ReportsCard → groupMultiRegionStudies), not inside useReportsData — so
    // reusing only the hook left 總覽 showing the raw members: several rows
    // with the same title, date and institution, some with no report text at
    // all. Same function, same clusters, same 「健保碼共用」 caveat.
    const shownRows = groupMultiRegionStudies(
      reportRows.filter((row) => REPORT_GROUPS_SHOWN.has(row.group)),
    )
    for (const row of shownRows) {
      push(row, row.diagnosticReportIds?.length ? 'DiagnosticReport' : 'Observation')
    }

    items.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
    const present = new Set(items.map((item) => item.group))
    return {
      items,
      groups: REPORT_GROUP_ORDER.filter((group) => present.has(group)),
      count: items.length,
    }
  }, [reportRows])

  // ── 用藥 ────────────────────────────────────────────────────────────────
  // Self-contained, so it lives in its own hook (useOverviewMeds).
  const { meds, medicationRows } = useOverviewMeds(medications, window, audience, locale)

  // ── 就診 ────────────────────────────────────────────────────────────────
  const clinicalNotes = useClinicalNotes(documentReferences, compositions)
  const encounterDetails = useEncounterDetails(
    medications, diagnosticReports, observations, procedures,
    clinicalNotes, conditions, locale, audience, medicationRows,
  )
  const icdDict = useMemo(() => buildIcdDictionary(conditions, locale), [conditions, locale])
  const visitHistory = useVisitHistory(encounters, icdDict)
  const visitStats = useVisitStats(encounterDetails)
  const docStrings = useDocumentSummaryStrings()
  const { entries: documentEntries } = useDocumentSummaries(docStrings.docTypes)
  const docsByEncounter = useMemo(() => {
    const map = new Map<string, DocumentEntry[]>()
    for (const entry of documentEntries) {
      const encounterId = entry.encounterRef?.split('/').pop()
      if (!encounterId) continue
      const bucket = map.get(encounterId) ?? []
      bucket.push(entry)
      map.set(encounterId, bucket)
    }
    return map
  }, [documentEntries])

  const visits = useMemo<OverviewVisitsData>(() => {
    const items: OverviewVisitItem[] = []
    for (const visit of visitHistory) {
      // An admission that began before the window but discharged inside it is
      // still part of this window's story, so periods are matched by overlap.
      if (!overlapsOverviewWindow(visit.date, visit.endDate ?? visit.date, window)) continue
      const details = encounterDetails.get(visit.id)
      const stats = visitStats.get(visit.id)
      items.push({
        visit,
        details,
        documents: docsByEncounter.get(visit.id),
        abnormalCount: stats?.abnormalCount ?? 0,
        testCount: details?.tests.length ?? 0,
        reportCount: details?.reports.length ?? 0,
        diagnosisCount: details?.diagnoses.length ?? 0,
        medicationCount: details?.medications.length ?? 0,
      })
    }
    return {
      items,
      count: items.length,
      emergencyCount: items.filter((item) => item.visit.type === 'emergency').length,
      inpatientCount: items.filter((item) => item.visit.type === 'inpatient').length,
      outpatientCount: items.filter((item) => (
        item.visit.type === 'outpatient' || item.visit.type === 'outpatient-or-emergency'
      )).length,
    }
  }, [docsByEncounter, encounterDetails, visitHistory, visitStats, window])

  // ── Empty-chart fallback ────────────────────────────────────────────────
  const latestDataDay = useMemo(() => {
    let latest: string | undefined
    const consider = (value: unknown) => {
      const day = toDayKey(value)
      if (day && (!latest || day > latest)) latest = day
    }
    for (const observation of observations as any[]) consider(observation?.effectiveDateTime)
    for (const report of diagnosticReports as any[]) consider(report?.effectiveDateTime ?? report?.issued)
    for (const medication of medications as any[]) consider(medication?.authoredOn ?? medication?.effectiveDateTime)
    for (const encounter of encounters as any[]) consider(encounter?.period?.start)
    return latest
  }, [diagnosticReports, encounters, medications, observations])

  const isEmpty = labs.rows.length === 0
    && reports.items.length === 0
    && meds.items.length === 0
    && visits.items.length === 0

  return {
    isLoading,
    error: error ?? null,
    labs,
    reports,
    meds,
    visits,
    latestDataDay,
    isEmpty,
  }
}
