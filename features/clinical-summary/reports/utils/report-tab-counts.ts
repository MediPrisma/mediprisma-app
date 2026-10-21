import { getReportInstitution as reportInstitution } from '@/src/shared/utils/report-institution'
import { isAdultPreventiveHealthExamResource } from '@/src/shared/utils/observation-provenance.utils'
import { collectAdultPreventiveObservationIds } from './adult-preventive-source'
import { collectReportMemberIds, referenceId } from '@/src/core/utils/observation-selectors'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getAnalyteCanonicalKey } from '@voho0000/clinical-lab-normalization/canonical'
import {
  inferGroupFromObservation,
  inferReportDisplayGroup,
  type ReportDisplayGroup,
} from '@/src/shared/utils/report-grouping-helpers'
import { getCodeableConceptText } from '@/src/shared/utils/fhir-helpers'
import {
  imagingStudyInstitution,
  imagingStudyTitle,
} from '@/src/shared/utils/imaging-study.utils'
import { cancerScreeningProgramKey } from './cancer-screening-grouping'
import { compareImagingCopies, imagingCopyInstitution, reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'

/**
 * Lightweight counts for the ReportsCard primary tabs.
 *
 * This intentionally builds only the small identity/category projection needed
 * to count clickable rows. It must stay independent of the display Row pipeline:
 * no attachment decoding, narrative rendering, terminology translation, trend
 * preparation, or React component mounting belongs here.
 */
export interface ReportTabCounts {
  all: number
  lab: number
  imaging: number
  pathology: number
  cancerScreening: number
  vitals: number
  procedures: number
}

interface CountRow {
  adultPreventive?: boolean
  group: ReportDisplayGroup
  rawTitle: string
  effectiveDate?: string
  institution?: string
  observations: any[]
}

const GLUCOSE_KEEP_SEPARATE = new Set(['C-PEPTIDE'])

function reportDate(report: any): string | undefined {
  return report?.effectiveDateTime || report?.effectivePeriod?.start || report?.issued
}

function reportObservations(reports: any[]): any[] {
  return reports.flatMap((report) => (
    Array.isArray(report?._observations)
      ? report._observations.filter(Boolean)
      : []
  ))
}

function isAdultReport(report: any): boolean {
  return isAdultPreventiveHealthExamResource(report)
    || (report?._observations ?? []).some(isAdultPreventiveHealthExamResource)
}

function reportNaturalKey(report: any): string {
  const title = (getCodeableConceptText(report?.code) || '').trim()
  const date = (reportDate(report) || '').slice(0, 10)
  const institution = (reportInstitution(report) || '').trim()
  return `${title}|${date}|${institution}|${isAdultReport(report) ? 'adult-preventive' : ''}`
}

function isCtReport(report: any): boolean {
  const text = (
    report?.code?.text
    || report?.code?.coding?.[0]?.display
    || ''
  ).toLowerCase()
  return text.includes('電腦斷層')
    || text.includes('computed tomography')
    || /\bct\b/.test(text)
}

/**
 * The CT split decision mirrors useReportsData without inspecting attachments.
 * A strict-prefix narrative is treated as a duplicate/truncated copy; genuinely
 * divergent narratives remain separate rows in the All tab.
 */
function reportNarrative(report: any): string {
  const parts: string[] = []
  if (typeof report?.conclusion === 'string' && report.conclusion.trim()) {
    parts.push(report.conclusion)
  }
  if (Array.isArray(report?.note)) {
    for (const note of report.note) {
      if (typeof note?.text === 'string' && note.text.trim()) parts.push(note.text)
    }
  }
  for (const observation of report?._observations ?? []) {
    if (
      typeof observation?.valueString === 'string'
      && observation.valueString.trim().length > 30
    ) {
      parts.push(observation.valueString)
    }
  }
  return parts.join('\n').trim()
}

function normalizeNarrative(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function hasDistinctCtNarratives(reports: any[]): boolean {
  const narratives = reports
    .map(reportNarrative)
    .filter(Boolean)
    .map(normalizeNarrative)
    .sort((a, b) => b.length - a.length)
  if (narratives.length < 2) return false
  const longest = narratives[0]
  return narratives.slice(1).some((value) => !longest.startsWith(value))
}

function linkedStudyIds(reports: any[]): Set<string> {
  const ids = new Set<string>()
  for (const report of reports) {
    for (const reference of report?.imagingStudy ?? []) {
      const id = referenceId(reference?.reference)
      if (id) ids.add(id)
    }
  }
  return ids
}

function createDiagnosticReportRows(
  diagnosticReports: any[],
  imagingStudies: any[],
): CountRow[] {
  const studiesById = new Map<string, any>()
  for (const study of imagingStudies) {
    if (study?.id) studiesById.set(study.id, study)
  }

  const groups = new Map<string, any[]>()
  const sharedKeys = reportDisplayGroupingKeys(diagnosticReports)
  for (const report of diagnosticReports) {
    if (!report) continue
    const sharedKey = sharedKeys.get(report)
    const key = sharedKey
      ? `shared-report|${sharedKey}`
      : reportNaturalKey(report)
    const group = groups.get(key)
    if (group) group.push(report)
    else groups.set(key, [report])
  }

  const toCountRow = (reports: any[]): CountRow => {
    const isCrossSource = sharedKeys.get(reports[0])?.startsWith('cross-source|')
    const head = isCrossSource ? [...reports].sort(compareImagingCopies)[0] : reports[0]
    const study = (head?.imagingStudy ?? [])
      .map((entry: any) => studiesById.get(referenceId(entry?.reference) || ''))
      .find(Boolean)
    const rawTitle = (getCodeableConceptText(head?.code) || '').trim()
      || (study ? imagingStudyTitle(study) : '')
    return {
      adultPreventive: reports.some(isAdultReport),
      group: inferReportDisplayGroup(head),
      rawTitle,
      effectiveDate: reportDate(head) || study?.started,
      institution: (isCrossSource ? imagingCopyInstitution(head) : undefined) || reportInstitution(head)
        || (study ? imagingStudyInstitution(study) : undefined),
      observations: reportObservations(reports),
    }
  }

  const rows: CountRow[] = []
  for (const reports of groups.values()) {
    const isSharedReport = reports.length > 1 && sharedKeys.has(reports[0])
    if (
      !isSharedReport
      &&
      reports.length > 1
      && isCtReport(reports[0])
      && hasDistinctCtNarratives(reports)
    ) {
      for (const report of reports) rows.push(toCountRow([report]))
    } else {
      rows.push(toCountRow(reports))
    }
  }
  return rows
}

function orphanGroupDay(value?: string): string {
  if (!value) return 'unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10)
}

function createOrphanObservationRows(
  observations: any[],
  diagnosticReports: any[],
  compositions: any[],
): CountRow[] {
  // Union standard result references and enriched _observations so a report
  // member cannot be counted again as a standalone Observation row.
  const adultIds = collectAdultPreventiveObservationIds(compositions)
  const isAdultObservation = (observation: any) => isAdultPreventiveHealthExamResource(observation) || adultIds.has(observation.id)
  const reportMemberIds = collectReportMemberIds(diagnosticReports)
  const groups = new Map<string, any[]>()

  for (const observation of observations) {
    if (!observation) continue
    if (observation.id && reportMemberIds.has(observation.id)) continue
    const hasDisplayableResult = (
      (Array.isArray(observation.component) && observation.component.length > 0)
      || (Array.isArray(observation.hasMember) && observation.hasMember.length > 0)
      || observation.valueQuantity != null
      || observation.valueString != null
      || observation.valueCodeableConcept != null
    )
    if (!hasDisplayableResult) continue

    const key = [
      observation.encounter?.reference || '',
      orphanGroupDay(observation.effectiveDateTime),
      getCodeableConceptText(observation.code) || 'Observation',
      isAdultObservation(observation) ? 'adult-preventive' : '',
    ].join('|')
    const group = groups.get(key)
    if (group) group.push(observation)
    else groups.set(key, [observation])
  }

  return [...groups.values()].map((group) => {
    const first = group[0]
    return {
      adultPreventive: group.some(isAdultObservation),
      group: inferGroupFromObservation(first),
      rawTitle: getCodeableConceptText(first?.code),
      effectiveDate: first?.effectiveDateTime,
      institution: first?.performer?.[0]?.display,
      observations: group,
    }
  })
}

function resolvedProcedureParentId(procedure: any, procedureIds: Set<string>): string | undefined {
  if (!Array.isArray(procedure?.partOf)) return undefined
  for (const parent of procedure.partOf) {
    const id = referenceId(parent?.reference)
    if (id && procedureIds.has(id)) return id
  }
  return undefined
}

function createProcedureRows(procedures: any[]): CountRow[] {
  const procedureIds = new Set<string>(
    procedures.flatMap((procedure) => procedure?.id ? [procedure.id] : []),
  )
  return procedures
    .filter(Boolean)
    .filter((procedure) => !resolvedProcedureParentId(procedure, procedureIds))
    .map((procedure) => ({
      group: 'procedures' as const,
      rawTitle: getCodeableConceptText(procedure?.code),
      effectiveDate: procedure?.performedDateTime || procedure?.performedPeriod?.start,
      institution: procedure?.performer?.[0]?.actor?.display,
      observations: [],
    }))
}

function createStandaloneImagingStudyRows(
  imagingStudies: any[],
  diagnosticReports: any[],
): CountRow[] {
  const linkedIds = linkedStudyIds(diagnosticReports)
  return imagingStudies
    .filter(Boolean)
    .filter((study) => !study.id || !linkedIds.has(study.id))
    .map((study) => ({
      group: 'imaging' as const,
      rawTitle: imagingStudyTitle(study),
      effectiveDate: study.started,
      institution: imagingStudyInstitution(study),
      observations: [],
    }))
}

/** Local calendar day, matching the Lab tab's collection-day grouping. */
function localDay(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function labCategoryId(row: CountRow): string {
  let categoryId: string | undefined
  for (const observation of row.observations) {
    const category = categorizeObservation(observation)
    if (category) {
      categoryId = category.id
      break
    }
  }
  if (categoryId === 'glucose') {
    const firstKey = getAnalyteCanonicalKey(row.observations[0])
    if (!firstKey || !GLUCOSE_KEEP_SEPARATE.has(firstKey)) return 'chem'
  }
  return categoryId ?? 'other'
}

/** Count the default Lab view: one card per local day × institution × category. */
function countLabDayRows(rows: CountRow[]): number {
  const datedGroups = new Set<string>()
  let undated = 0
  for (const row of rows) {
    const day = localDay(row.effectiveDate)
    if (!day) {
      undated += 1
      continue
    }
    datedGroups.add(`${day}|${(row.institution || '').trim()}|${labCategoryId(row)}`)
  }
  return datedGroups.size + undated
}

/** Count report cards after same-title/day/institution display grouping. */
function countReportRows(rows: CountRow[]): number {
  const groups = new Set<string>()
  for (const row of rows) {
    groups.add([
      row.rawTitle.trim(),
      (row.effectiveDate || '').slice(0, 10),
      (row.institution || '').trim(),
    ].join('|'))
  }
  return groups.size
}

export function calculateReportTabCounts(
  diagnosticReports: any[] = [],
  imagingStudies: any[] = [],
  observations: any[] = [],
  procedures: any[] = [],
  compositions: any[] = [],
): ReportTabCounts {
  const reports = Array.isArray(diagnosticReports) ? diagnosticReports : []
  const studies = Array.isArray(imagingStudies) ? imagingStudies : []
  const standaloneObservations = Array.isArray(observations) ? observations : []
  const procedureResources = Array.isArray(procedures) ? procedures : []

  const rows = [
    ...createDiagnosticReportRows(reports, studies),
    ...createOrphanObservationRows(standaloneObservations, reports, compositions),
    ...createProcedureRows(procedureResources),
    ...createStandaloneImagingStudyRows(studies, reports),
  ]
  const labRows = rows.filter((row) => row.group === 'lab')
  const imagingRows = rows.filter((row) => row.group === 'imaging')
  const pathologyRows = rows.filter((row) => row.group === 'pathology')
  const cancerScreeningRows = rows.filter((row) => row.group === 'cancer-screening')
  const cancerScreeningPrograms = new Set(
    cancerScreeningRows.map((row) => cancerScreeningProgramKey(row.rawTitle)),
  ).size

  // Match the All tab's adult-exam display units without rendering documents.
  const adultGroups = new Set<string>()
  let all = 0
  for (const row of rows) {
    const day = row.effectiveDate?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    if (row.adultPreventive && day) {
      const key = `${day}|${(row.institution ?? '').normalize('NFKC').trim().toLocaleLowerCase()}`
      if (adultGroups.has(key)) continue
      adultGroups.add(key)
    }
    all++
  }

  return {
    all: all - cancerScreeningRows.length + cancerScreeningPrograms,
    lab: countLabDayRows(labRows),
    imaging: countReportRows(imagingRows),
    pathology: countReportRows(pathologyRows),
    cancerScreening: cancerScreeningPrograms,
    vitals: rows.filter((row) => row.group === 'vitals').length,
    procedures: rows.filter((row) => row.group === 'procedures').length,
  }
}
