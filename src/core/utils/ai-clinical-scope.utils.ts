import type { DataFilters, DataSelection } from '@/src/core/entities/clinical-context.entity'
import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import {
  inferGroupFromCategory,
  inferGroupFromDiagnosticReport,
} from '@/src/shared/utils/report-grouping-helpers'
import { makeTimeRangeTest } from '@/src/core/utils/date-filter.utils'
import {
  filterEncounterRecords,
  filterMedicationRecords,
  filterProcedureRecords,
  normalizeClinicalStatus,
} from '@/src/core/utils/clinical-context-selection.utils'
import {
  selectLabOrphanObservations,
  selectOtherObservations,
} from '@/src/core/utils/observation-selectors'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { expandObservationValues } from '@/src/core/utils/observation-value.utils'
import { imagingStudyTitle } from '@/src/shared/utils/imaging-study.utils'
import { filterAiExcludedClinicalDomains } from '@/src/core/utils/ai-clinical-domain-filter.utils'
import { floorStartDay, prescribingAnalyteKey } from '@/src/core/utils/first-visit-floors'
import { AI_REPORT_GROUPS, reportModalityClass } from '@/src/core/utils/report-narrative.utils'

const LAB_FALLBACK_SAMPLING_DAYS = 3
const NHI_VIEWER_REQUEST_EXTENSION_URL =
  'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-nhi-viewer-request'

function codeText(value: any): string {
  return value?.text || value?.coding?.[0]?.display || value?.coding?.[0]?.code || ''
}

function problemListCandidate(condition: any): boolean {
  const categories = condition?.category
  if (!Array.isArray(categories) || categories.length === 0) return !condition?.encounter?.reference
  return categories.some((category: any) =>
    category?.coding?.some((coding: any) => coding?.code === 'problem-list-item'),
  )
}

function activeCondition(condition: any): boolean {
  const verification = typeof condition?.verificationStatus === 'string'
    ? condition.verificationStatus.toLowerCase()
    : (condition?.verificationStatus?.coding?.[0]?.code || '').toLowerCase()
  if (['refuted', 'entered-in-error'].includes(verification)) return false
  const clinical = typeof condition?.clinicalStatus === 'string'
    ? condition.clinicalStatus.toLowerCase()
    : (condition?.clinicalStatus?.coding?.[0]?.code || '').toLowerCase()
  return !clinical || ['active', 'recurrence', 'relapse'].includes(clinical)
}

function latestByName<T>(items: T[], name: (item: T) => string, date: (item: T) => string | undefined): T[] {
  const latest = new Map<string, T>()
  for (const item of items) {
    const key = name(item)
    const existing = latest.get(key)
    if (!existing || (date(item) || '') > (date(existing) || '')) latest.set(key, item)
  }
  return [...latest.values()]
}

function observationDate(observation: any): string | undefined {
  return observation?.effectiveDateTime
}

function reportObservations(report: any, observationsById: Map<string, any>): any[] {
  const found = new Map<string, any>()
  const withoutId: any[] = []
  for (const observation of report?._observations ?? []) {
    if (observation?.id) found.set(observation.id, observation)
    else withoutId.push(observation)
  }
  for (const reference of report?.result ?? []) {
    const id = reference?.reference?.split('/').pop()
    const observation = id ? observationsById.get(id) : undefined
    if (observation) found.set(observation.id || id, observation)
  }
  return [...found.values(), ...withoutId]
}

/**
 * Viewer URLs can be bearer-style medical access capabilities, and the live
 * request extension contains patient-bound transport data. Structured AI
 * pipelines need report text and clinical metadata, never either capability,
 * so remove both at the scope boundary before signatures, prompts, or tool data
 * can consume the selected collection.
 */
function stripDiagnosticReportViewerCapabilities(report: any): any {
  const hasAttachmentUrls = Array.isArray(report?.presentedForm)
    && report.presentedForm.some((attachment: any) => attachment && 'url' in attachment)
  const hasViewerRequest = Array.isArray(report?.extension)
    && report.extension.some((extension: any) => extension?.url === NHI_VIEWER_REQUEST_EXTENSION_URL)
  if (!hasAttachmentUrls && !hasViewerRequest) return report

  const safeReport = { ...report }
  if (hasAttachmentUrls) {
    safeReport.presentedForm = report.presentedForm.map((attachment: any) => {
      if (!attachment || typeof attachment !== 'object') return attachment
      const safeAttachment = { ...attachment }
      delete safeAttachment.url
      return safeAttachment
    })
  }
  if (hasViewerRequest) {
    const safeExtensions = report.extension.filter(
      (extension: any) => extension?.url !== NHI_VIEWER_REQUEST_EXTENSION_URL,
    )
    if (safeExtensions.length > 0) safeReport.extension = safeExtensions
    else delete safeReport.extension
  }
  return safeReport
}

interface SelectedLabScope {
  reports: any[]
  observations: any[]
}

/**
 * Select the lab source resources that support the rendered lab section. This
 * mirrors its empty-window fallback and per-analyte depth closely enough that
 * the AI source catalog cannot lose the Observation values shown in context or
 * reintroduce an entirely excluded panel through a metadata side channel.
 */
function selectLabScope(
  input: Partial<ClinicalDataCollection>,
  reports: any[],
  filters: DataFilters,
): SelectedLabScope {
  const observationsById = new Map<string, any>()
  for (const observation of input.observations ?? []) {
    if (observation.id) observationsById.set(observation.id, observation)
  }
  const reportMembers = new Map<any, any[]>()
  const memberIds = new Set<string>()
  for (const report of reports) {
    const members = reportObservations(report, observationsById)
      .filter((observation) => normalizeClinicalStatus(observation?.status) !== 'entered-in-error')
    reportMembers.set(report, members)
    members.forEach((observation) => {
      if (observation?.id) memberIds.add(observation.id)
    })
  }
  const orphanObservations = selectLabOrphanObservations(input)
    .filter((observation) => normalizeClinicalStatus(observation?.status) !== 'entered-in-error')
  const candidateParents = [
    ...[...reportMembers.values()].flat(),
    ...orphanObservations,
  ]
  const expanded = candidateParents.flatMap((parent) =>
    expandObservationValues(parent).map((value) => ({ parent, value })),
  )
  const conclusionReports = reports.filter((report) =>
    report?.conclusion && (reportMembers.get(report) ?? []).flatMap(expandObservationValues).length === 0,
  )

  const inWindow = makeTimeRangeTest(filters.labReportTimeRange, input)
  let dateSelected = (date?: string): boolean => filters.labReportTimeRange === 'all' || inWindow(date)
  const hasInWindowEvidence = expanded.some(({ value }) => dateSelected(observationDate(value)))
    || conclusionReports.some((report) => dateSelected(report.effectiveDateTime || report.issued))
  if (filters.labReportTimeRange !== 'all' && !hasInWindowEvidence) {
    const fallbackDays = [...new Set([
      ...expanded.map(({ value }) => observationDate(value)),
      ...conclusionReports.map((report) => report.effectiveDateTime || report.issued),
    ].filter(Boolean).map((date) => String(date).slice(0, 10)))]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, LAB_FALLBACK_SAMPLING_DAYS)
    const fallbackSet = new Set(fallbackDays)
    dateSelected = (date?: string) => !!date && fallbackSet.has(date.slice(0, 10))
  }

  const panelIds = new Set(filters.labPanelIds.split(',').map((panel) => panel.trim()).filter(Boolean))
  const inSelectedWindow = expanded.filter(({ value }) => dateSelected(observationDate(value)))
  const inSelectedPanels = panelIds.size === 0
    ? inSelectedWindow
    : inSelectedWindow.filter(({ value }) => {
        const panel = categorizeObservation(value)?.id
        return !!panel && panelIds.has(panel)
      })

  const selectedPoints = new Map<string, Array<{ parent: any; value: any }>>()
  for (const point of inSelectedPanels) {
    const display = codeText(point.value?.code) || 'Lab'
    const panel = categorizeObservation(point.value)?.id ?? ''
    const unit = point.value?.valueQuantity?.unit || point.value?.valueQuantity?.code || ''
    const key = filters.labDepth === 'latest' ? display : `${panel}|${display}|${unit}`
    const group = selectedPoints.get(key)
    if (group) group.push(point)
    else selectedPoints.set(key, [point])
  }
  const maxPoints = filters.labDepth === 'all'
    ? Number.POSITIVE_INFINITY
    : filters.labDepth === 'latest'
      ? 1
      : Number(filters.labDepth)
  const selectedParents = new Set<any>()
  for (const points of selectedPoints.values()) {
    [...points]
      .sort((a, b) => (observationDate(b.value) || '').localeCompare(observationDate(a.value) || ''))
      .slice(0, Number.isFinite(maxPoints) ? maxPoints : undefined)
      .forEach(({ parent }) => selectedParents.add(parent))
  }

  // Latest-known floor: a prescribing analyte whose newest value fell outside
  // the saved window (or its panel filter) still contributes that one value
  // when it is within the floor horizon of the newest lab in the chart. A
  // quiet six months must not hide an eight-month-old platelet count.
  const newestLabDay = expanded
    .map(({ value }) => String(observationDate(value) ?? '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1)
  const floorStart = floorStartDay(newestLabDay)
  if (floorStart) {
    const coveredAnalytes = new Set<string>()
    for (const parent of selectedParents) {
      for (const value of expandObservationValues(parent)) {
        const key = prescribingAnalyteKey(value)
        if (key) coveredAnalytes.add(key)
      }
    }
    const latestByAnalyte = new Map<string, { parent: any; date: string }>()
    for (const { parent, value } of expanded) {
      const key = prescribingAnalyteKey(value)
      if (!key || coveredAnalytes.has(key)) continue
      // A panel the user switched off stays off; the floor widens time, not scope.
      if (panelIds.size > 0 && !panelIds.has(categorizeObservation(value)?.id ?? '')) continue
      const date = String(observationDate(value) ?? '').slice(0, 10)
      if (!date || date < floorStart) continue
      const current = latestByAnalyte.get(key)
      if (!current || date > current.date) latestByAnalyte.set(key, { parent, date })
    }
    for (const { parent } of latestByAnalyte.values()) selectedParents.add(parent)
  }

  const selectedReports = reports.filter((report) => {
    if ((reportMembers.get(report) ?? []).some((observation) => selectedParents.has(observation))) return true
    return conclusionReports.includes(report) && dateSelected(report.effectiveDateTime || report.issued)
  })
  return {
    reports: selectedReports,
    observations: [...selectedParents].filter((observation) =>
      !observation?.id || memberIds.has(observation.id) || orphanObservations.includes(observation),
    ),
  }
}

/**
 * The only bundle view allowed to feed structured AI pipelines. It applies the
 * same category switches and coarse filters as the rendered context before a
 * source catalog or longitudinal appendix is built, preventing excluded data
 * from re-entering through metadata-only side channels.
 */
export function scopeClinicalDataForAi(
  input: Partial<ClinicalDataCollection>,
  selection: DataSelection,
  filters: DataFilters,
  includedDocumentIds: string[],
  nowMs = Date.now(),
): Partial<ClinicalDataCollection> {
  // Apply the product-level domain exclusions before any time-window or
  // category scoping. This also keeps excluded records out of citations and
  // structured source catalogs, not only the human-readable prompt text.
  input = filterAiExcludedClinicalDomains(input)

  const encounters = selection.encounters
    ? filterEncounterRecords(input.encounters ?? [], filters.encounterTimeRange, input)
    : []
  const medications = selection.medications
    ? filterMedicationRecords(input.medications ?? [], filters, input, nowMs)
    : []
  const procedures = selection.procedures
    ? filterProcedureRecords(input.procedures ?? [], filters, input)
    : []

  const conditionWindow = makeTimeRangeTest(filters.problemListTimeRange, input)
  const conditions = selection.problemList
    ? (input.conditions ?? [])
        .filter(problemListCandidate)
        .filter((condition) => filters.problemListStatus !== 'active' || activeCondition(condition))
        .filter((condition) => conditionWindow(condition.recordedDate || condition.onsetDateTime))
    : []

  const reportStatusOk = (report: any) => normalizeClinicalStatus(report?.status) !== 'entered-in-error'
  const imagingWindow = makeTimeRangeTest(filters.imagingReportTimeRange, input)
  const availableLabReports = selection.labReports
    ? (input.diagnosticReports ?? []).filter((report) =>
        reportStatusOk(report) && inferGroupFromCategory(report.category) === 'lab',
      )
    : []
  const labScope = selection.labReports
    ? selectLabScope(input, availableLabReports, filters)
    : { reports: [], observations: [] }
  const labReports = labScope.reports
  // Pathology reports ride on the imaging selection: they were reaching no AI
  // surface at all (the scope kept only the lab and imaging groups), yet a
  // biopsy result is the one report an oncology second opinion cannot do
  // without. Same window and same latest-per-name rule as imaging.
  let imagingReports = selection.imagingReports
    ? (input.diagnosticReports ?? []).filter((report) =>
        reportStatusOk(report)
        && AI_REPORT_GROUPS.has(inferGroupFromDiagnosticReport(report))
        && imagingWindow(report.effectiveDateTime || report.issued),
      )
    : []
  const allLinkedImagingStudyIds = new Set(
    (input.diagnosticReports ?? []).flatMap((report) => report.imagingStudy ?? [])
      .map((reference: any) => reference?.reference?.split('/').pop())
      .filter(Boolean),
  )
  let standaloneImagingStudies = selection.imagingReports
    ? (input.imagingStudies ?? []).filter((study) =>
        !allLinkedImagingStudyIds.has(study.id) && imagingWindow(study.started),
      )
    : []
  if (filters.imagingReportVersion === 'latest') {
    const latestImaging = latestByName(
      [
        ...imagingReports.map((report) => ({ kind: 'report' as const, value: report })),
        ...standaloneImagingStudies.map((study) => ({ kind: 'study' as const, value: study })),
      ],
      (item) => item.kind === 'report' ? codeText(item.value.code) : imagingStudyTitle(item.value),
      (item) => item.kind === 'report'
        ? item.value.effectiveDateTime || item.value.issued
        : item.value.started,
    )
    imagingReports = latestImaging.filter((item) => item.kind === 'report').map((item) => item.value as any)
    standaloneImagingStudies = latestImaging.filter((item) => item.kind === 'study').map((item) => item.value as any)
  }
  // Avoid duplicate report objects if a malformed server labels one report as
  // both lab and imaging; the rendered categories use the same classification.
  // Latest-known floor for reports: the newest report of each modality class
  // (pathology, CT, MRI, ultrasound, ECG, X-ray…) within the floor horizon
  // stays in scope even when the saved imaging window is shorter. NHI names
  // every CT alike, so the class — not the report name — is the unit.
  if (selection.imagingReports) {
    const candidates = (input.diagnosticReports ?? []).filter((report) =>
      reportStatusOk(report) && AI_REPORT_GROUPS.has(inferGroupFromDiagnosticReport(report)))
    const newestReportDay = candidates
      .map((report) => String(report.effectiveDateTime || report.issued || '').slice(0, 10))
      .filter(Boolean)
      .sort()
      .at(-1)
    const floorStart = floorStartDay(newestReportDay)
    if (floorStart) {
      const present = new Set(imagingReports)
      const latestByClass = new Map<string, { report: any; date: string }>()
      for (const report of candidates) {
        const date = String(report.effectiveDateTime || report.issued || '').slice(0, 10)
        if (!date || date < floorStart) continue
        const group = inferGroupFromDiagnosticReport(report)
        const { cls } = reportModalityClass(group, codeText(report.code) ?? group)
        const current = latestByClass.get(cls)
        if (!current || date > current.date) latestByClass.set(cls, { report, date })
      }
      for (const { report } of latestByClass.values()) {
        if (!present.has(report)) imagingReports.push(report)
      }
    }
  }

  const reportById = new Map<string, any>()
  const reportsWithoutId: any[] = []
  for (const report of [...labReports, ...imagingReports]) {
    if (report.id) reportById.set(report.id, report)
    else reportsWithoutId.push(report)
  }
  const linkedImagingStudyIds = new Set(
    imagingReports.flatMap((report) => report.imagingStudy ?? [])
      .map((reference: any) => reference?.reference?.split('/').pop())
      .filter(Boolean),
  )

  const selectedObservations: any[] = []
  let selectedVitalSigns: any[] = []
  if (selection.vitalSigns) {
    const inWindow = makeTimeRangeTest(filters.vitalSignsTimeRange, input)
    let vitals = (input.vitalSigns ?? []).filter((obs) =>
      normalizeClinicalStatus(obs.status) !== 'entered-in-error'
      && inWindow(obs.effectiveDateTime),
    )
    if (filters.vitalSignsVersion === 'latest') {
      vitals = latestByName(vitals, (obs) => codeText(obs.code), (obs) => obs.effectiveDateTime)
    }
    selectedVitalSigns = vitals
    selectedObservations.push(...vitals)
  }
  if (selection.labReports) {
    // Includes both DiagnosticReport members and orphan lab observations. The
    // former are required by the longitudinal evidence builder; previously the
    // rendered context contained values that its citable source data lacked.
    selectedObservations.push(...labScope.observations)
  }
  if (selection.observations) {
    const inWindow = makeTimeRangeTest(filters.observationTimeRange, input)
    let others = selectOtherObservations(input).filter((obs) => inWindow(obs.effectiveDateTime))
    if (filters.observationVersion === 'latest') {
      others = latestByName(others, (obs) => codeText(obs.code), (obs) => obs.effectiveDateTime)
    }
    selectedObservations.push(...others)
  }
  const observationIds = new Set<string>()
  const observations = selectedObservations.filter((observation) => {
    if (!observation.id) return true
    if (observationIds.has(observation.id)) return false
    observationIds.add(observation.id)
    return true
  })

  const immunizationWindow = makeTimeRangeTest(filters.immunizationTimeRange, input)
  const documentIds = new Set(includedDocumentIds)

  return {
    encounters,
    medications,
    procedures,
    conditions,
    observations,
    vitalSigns: selectedVitalSigns,
    diagnosticReports: [...reportById.values(), ...reportsWithoutId]
      .map(stripDiagnosticReportViewerCapabilities),
    imagingStudies: selection.imagingReports
      ? (input.imagingStudies ?? []).filter((study) =>
          linkedImagingStudyIds.has(study.id) || standaloneImagingStudies.includes(study),
        )
      : [],
    allergies: selection.allergies ? input.allergies ?? [] : [],
    immunizations: selection.immunizations
      ? (input.immunizations ?? []).filter((record) => immunizationWindow(record.occurrenceDateTime))
      : [],
    consents: selection.advanceDirectives ? input.consents ?? [] : [],
    devices: selection.medicalDevices ? input.devices ?? [] : [],
    carePlans: selection.carePlans
      ? (input.carePlans ?? []).filter((plan) => filters.carePlanStatus !== 'active' || plan.status === 'active')
      : [],
    compositions: selection.documents ? (input.compositions ?? []).filter((document) => documentIds.has(document.id)) : [],
    documentReferences: selection.documents ? (input.documentReferences ?? []).filter((document) => documentIds.has(document.id)) : [],
    resourceQueryStatus: input.resourceQueryStatus,
  }
}
