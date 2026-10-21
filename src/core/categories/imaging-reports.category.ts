// Imaging Reports Category
import type { DataCategory, ClinicalContextSection } from '../interfaces/data-category.interface'
import type { DiagnosticReport, ImagingStudy, Observation } from '@/src/shared/types/fhir.types'
import { inferGroupFromDiagnosticReport } from '@/src/shared/utils/report-grouping-helpers'
import { makeTimeRangeTest } from '../utils/date-filter.utils'
import { getLatestByName, getCodeableConceptText } from '../utils/data-grouping.utils'
import { referenceId } from '../utils/observation-selectors'
import {
  formatImagingStudyMetadata,
  imagingStudyTitle,
} from '@/src/shared/utils/imaging-study.utils'
import { expandObservationValues, observationDisplayValue } from '@/src/core/utils/observation-value.utils'
import { decodeBase64, stripHtmlToText } from '@/src/core/utils/clinical-documents.utils'
import { normalizeClinicalStatus } from '@/src/core/utils/clinical-context-selection.utils'
import { reportDisplayGroupingKeys } from '@/src/shared/utils/report-copy-grouping'
import {
  reportSource,
  sharedReportNarrative,
  sharedReportTitle,
} from '@/src/shared/utils/shared-report-grouping'

function presentedFormText(report: ImagingReportData): string[] {
  return (report.presentedForm ?? []).map((attachment: any, index) => {
    const contentType = String(attachment?.contentType || '').toLowerCase()
    const label = attachment?.title || `Presented form ${index + 1}`
    if (attachment?.data && (contentType.includes('text') || contentType.includes('html') || contentType.includes('xml') || !contentType)) {
      const decoded = decodeBase64(attachment.data)
      return decoded.trim()
        ? `${label}: ${stripHtmlToText(decoded)}`
        : `${label}: [base64 report attachment could not be decoded]`
    }
    if (attachment?.data) return `${label}: [binary report attachment not decoded; contentType=${contentType || 'unknown'}]`
    if (attachment?.url) return `${label}: [URL-backed report attachment not resolved; contentType=${contentType || 'unknown'}]`
    return `${label}: [attachment body unavailable]`
  })
}

type ImagingReportData = DiagnosticReport & {
  _imagingStudyText?: string
  _imagingStudyIds?: string[]
}

function isSharedNarrativeAttachment(attachment: any): boolean {
  const contentType = String(attachment?.contentType || '').toLowerCase()
  return Boolean(
    attachment?.data
    && contentType.startsWith('text/')
    && !contentType.includes('html'),
  )
}

/** Report-specific context that must remain beside each source even when the
 * exact narrative is shared by multiple billed procedures. */
function reportSupplementalText(report: ImagingReportData): string[] {
  const sourceSpecificAttachments = (report.presentedForm ?? [])
    .filter((attachment) => !isSharedNarrativeAttachment(attachment))
  const sharedAttachmentLabels = (report.presentedForm ?? []).flatMap((attachment, index) =>
    isSharedNarrativeAttachment(attachment)
      ? [`Text attachment included in shared narrative: ${attachment.title || `Presented form ${index + 1}`}`]
      : [],
  )
  return [
    report._imagingStudyText,
    ...sharedAttachmentLabels,
    ...presentedFormText({ ...report, presentedForm: sourceSpecificAttachments }),
  ].filter((text): text is string => !!text?.trim())
}

function groupedReportCount(reports: ImagingReportData[]): number {
  const groupingKeys = reportDisplayGroupingKeys(reports)
  const seen = new Set<string>()
  let count = 0
  for (const report of reports) {
    const key = groupingKeys.get(report)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    count += 1
  }
  return count
}

// Helper to get latest imaging reports by name
const getLatestImagingReports = (reports: ImagingReportData[]): ImagingReportData[] => {
  return getLatestByName(
    reports,
    (report) => getCodeableConceptText(report.code),
    // Prefer effectiveDateTime (exam date — 檢查日) over issued, consistent with
    // the time-range filter below and the reports display. getMostRecentDate
    // would pick the LATER of the two (issued), keying "latest" dedup off a
    // different date than the range filter.
    (report) => report.effectiveDateTime || report.issued
  )
}

export const imagingReportsCategory: DataCategory<ImagingReportData> = {
  id: 'imagingReports',
  label: 'Imaging Reports',
  labelKey: 'dataSelection.imagingReports',
  description: 'Radiology, imaging study, and pathology reports',
  descriptionKey: 'dataSelection.imagingReportsDesc',
  group: 'reports',
  order: 50,
  
  filters: [
    {
      key: 'imagingReportVersion',
      type: 'select',
      label: 'Report Version',
      options: [
        { value: 'latest', label: 'Latest Only' },
        { value: 'all', label: 'All Reports' }
      ],
      defaultValue: 'latest'
    },
    {
      key: 'imagingReportTimeRange',
      type: 'select',
      label: 'Time Range',
      options: [
        { value: '1w', label: 'Last Week' },
        { value: '1m', label: 'Last Month' },
        { value: '3m', label: 'Last 3 Months' },
        { value: '6m', label: 'Last 6 Months' },
        { value: '1y', label: 'Last Year' },
        { value: 'sinceLastVisit', label: 'Since last visit' },
        { value: 'all', label: 'All Time' }
      ],
      defaultValue: '1y'
    }
  ],
  
  filterComponentKey: 'imagingReport',
  
  extractData: (clinicalData) => {
    const reports = (clinicalData?.diagnosticReports || []) as DiagnosticReport[]
    const studies = (clinicalData?.imagingStudies || []) as ImagingStudy[]
    const studyById = new Map(studies.filter((study) => !!study.id).map((study) => [study.id!, study]))
    const linkedIds = new Set<string>()

    const reportItems = reports
      .filter((report) => inferGroupFromDiagnosticReport(report) === 'imaging')
      .map((report): ImagingReportData => {
        const ids = (report.imagingStudy ?? [])
          .map((ref) => referenceId(ref.reference))
          .filter((id): id is string => !!id)
        ids.forEach((id) => linkedIds.add(id))
        const metadata = ids
          .map((id) => studyById.get(id))
          .filter((study): study is ImagingStudy => !!study)
          .map((study) => formatImagingStudyMetadata(study))
        return {
          ...report,
          _imagingStudyIds: ids,
          _imagingStudyText: metadata.join('\n\n'),
        }
      })

    const standaloneItems = studies
      .filter((study) => !study.id || !linkedIds.has(study.id))
      .map((study): ImagingReportData => ({
        id: study.id,
        resourceType: 'ImagingStudy',
        status: study.status,
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'RAD',
            display: 'Radiology',
          }],
          text: 'Imaging',
        }],
        code: { text: imagingStudyTitle(study) },
        encounter: study.encounter,
        effectiveDateTime: study.started,
        _imagingStudyIds: study.id ? [study.id] : [],
        _imagingStudyText: formatImagingStudyMetadata(study),
      }))

    return [...reportItems, ...standaloneItems]
  },
  
  getCount: (data, filters, allClinicalData) => {
    // Filter out reports without content (matching useReportsData logic)
    let filtered = data.filter(report => {
      if (normalizeClinicalStatus(report.status) === 'entered-in-error') return false
      const hasObservations = report.result && report.result.length > 0
      const hasConclusion = !!report.conclusion
      const hasNotes = Array.isArray((report as any).note) && (report as any).note.length > 0
      const hasAttachment = Array.isArray(report.presentedForm) && report.presentedForm.length > 0
      const hasStudyMetadata = !!report._imagingStudyText || (report._imagingStudyIds?.length ?? 0) > 0
      
      return hasObservations || hasConclusion || hasNotes || hasAttachment || hasStudyMetadata
    })
    
    const timeRange = filters.imagingReportTimeRange as string
    if (timeRange && timeRange !== 'all') {
      const inWindow = makeTimeRangeTest(timeRange, allClinicalData)
      filtered = filtered.filter(report =>
        inWindow(report.effectiveDateTime || report.issued)
      )
    }

    if (filters.imagingReportVersion === 'latest') {
      filtered = getLatestImagingReports(filtered)
    }

    return groupedReportCount(filtered)
  },
  
  getContextSection: (data, filters, allClinicalData): ClinicalContextSection | null => {
    if (data.length === 0) return null
    
    let filtered = data.filter((report) => normalizeClinicalStatus(report.status) !== 'entered-in-error')

    const timeRange = filters.imagingReportTimeRange as string
    if (timeRange && timeRange !== 'all') {
      const inWindow = makeTimeRangeTest(timeRange, allClinicalData)
      filtered = filtered.filter(report =>
        inWindow(report.effectiveDateTime || report.issued)
      )
    }

    if (filtered.length === 0) {
      return { title: 'Imaging Reports', items: ['No imaging reports found within the selected time range.'] }
    }

    if (filters.imagingReportVersion === 'latest') {
      filtered = getLatestImagingReports(filtered)
    }

    const observations = allClinicalData?.observations || []
    
    const items: string[] = []
    const groupingKeys = reportDisplayGroupingKeys(filtered)
    const sharedGroups = new Map<string, ImagingReportData[]>()
    filtered.forEach((report) => {
      const key = groupingKeys.get(report)
      if (!key) return
      const group = sharedGroups.get(key)
      if (group) group.push(report)
      else sharedGroups.set(key, [report])
    })
    const renderedSharedKeys = new Set<string>()

    const appendObservations = (report: ImagingReportData, indent = '  ') => {
      const reportObs: Observation[] = []
      const addObservation = (obs: Observation | undefined) => {
        if (!obs) return
        const isAlreadyIncluded = reportObs.some((existing) =>
          obs.id ? existing.id === obs.id : existing === obs,
        )
        if (!isAlreadyIncluded) reportObs.push(obs)
      }
      for (const obs of (report as any)._observations ?? []) addObservation(obs)
      report.result?.forEach(result => {
        const id = referenceId(result.reference)
        if (id) {
          const obs = observations.find((o: Observation) => o.id === id)
          addObservation(obs)
        }
      })

      reportObs.forEach(obs => {
        expandObservationValues(obs).forEach((valueObservation) => {
          const display = observationDisplayValue(valueObservation)
          if (display) {
            items.push(`${indent}• ${valueObservation.code?.text || valueObservation.code?.coding?.[0]?.display || 'Finding'}: ${display.value}${display.unit ? ` ${display.unit}` : ''} [status: ${normalizeClinicalStatus((obs as any).status) || 'unknown'}]`)
          }
        })
      })
      return reportObs.length > 0
    }

    filtered.forEach(report => {
      const groupingKey = groupingKeys.get(report)
      if (groupingKey) {
        if (renderedSharedKeys.has(groupingKey)) return
        renderedSharedKeys.add(groupingKey)

        const groupedReports = sharedGroups.get(groupingKey) ?? [report]
        const sources = groupedReports.map(reportSource)
        const groupTitle = sharedReportTitle(sources, 'en')
          ?? sources.map((source) => source.title).join(' + ')
        const reportDate = report.effectiveDateTime || report.effectivePeriod?.start
        const datePart = reportDate
          ? ` (${new Date(reportDate).toLocaleDateString()})`
          : ''
        const reportStatus = normalizeClinicalStatus(report.status) || 'unknown'
        items.push(`${groupTitle}${datePart} [status: ${reportStatus}] [shared narrative; count once]`)

        groupedReports.forEach((sourceReport) => {
          const source = reportSource(sourceReport)
          const codes = source.codes.length > 0 ? ` [codes: ${source.codes.join(', ')}]` : ''
          const id = source.reportId ? ` [id: ${source.reportId}]` : ''
          items.push(`  • Source report: ${source.title}${codes}${id}`)
          if (groupingKey.startsWith('cross-source|')) items.push(`    • Original source narrative: ${sharedReportNarrative(sourceReport)}`)
          appendObservations(sourceReport, '    ')
          reportSupplementalText(sourceReport)
            .forEach((text) => items.push(`    • ${text}`))
        })

        items.push(`  • Shared narrative: ${sharedReportNarrative(report)}`)
        return
      }

      const reportObs: Observation[] = []
      report.result?.forEach(result => {
        const id = referenceId(result.reference)
        if (id) {
          const obs = observations.find((o: Observation) => o.id === id)
          if (obs) reportObs.push(obs)
        }
      })

      const datePart = report.effectiveDateTime 
        ? ` (${new Date(report.effectiveDateTime).toLocaleDateString()})` 
        : ''
      
      const reportStatus = normalizeClinicalStatus(report.status) || 'unknown'
      const statusPart = ` [status: ${reportStatus}]`
      const attachmentText = presentedFormText(report)
      if (reportObs.length > 0) {
        items.push(`${report.code?.text || 'Imaging Study'}${datePart}${statusPart}`)
        appendObservations(report)
        const reportText = [
          report.conclusion,
          ...(report.note ?? []).map((note) => note.text),
          report._imagingStudyText,
          ...attachmentText,
        ].filter((text): text is string => !!text?.trim())
        reportText.forEach((text) => items.push(`  • ${text}`))
      } else {
        const narrative = [
          report.conclusion,
          ...(report.note ?? []).map((note) => note.text),
          report._imagingStudyText,
          ...attachmentText,
        ].filter((text): text is string => !!text?.trim()).join('\n')
        if (narrative) {
          items.push(`${report.code?.text || 'Study'}${datePart}${statusPart}: ${narrative}`)
        }
      }
    })
    
    if (items.length === 0) return null

    const title = filters.imagingReportVersion === 'latest'
      ? 'Imaging Reports (Latest Only)'
      : 'Imaging Reports'

    return { title, items }
  }
}
