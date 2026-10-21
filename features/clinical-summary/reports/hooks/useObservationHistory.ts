import { useMemo } from 'react'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { canonicalTestKeyFromString } from '@voho0000/clinical-lab-normalization/canonical'
import { isInferredObservationUnit } from '@/src/shared/utils/observation-provenance.utils'
import { getCodeableConceptText } from '../utils/fhir-helpers'
import { sharedReportNarrative } from '@/src/shared/utils/shared-report-grouping'
import { getImagingCopySource, getReportDate, getReportInstitution } from '@/src/shared/utils/report-identity'
import { inferReportDisplayGroup } from '@/src/shared/utils/report-grouping-helpers'

export interface ObservationHistoryItem {
  id: string
  date: string
  value: number | string
  unit?: string
  status?: string
  interpretation?: string
  referenceRange?: {
    low?: number
    high?: number
    text?: string
  }
  reportName?: string
  reportId?: string
  unitInferred?: boolean
}

export interface ComponentHistoryItem {
  componentName: string
  data: ObservationHistoryItem[]
  color: string
}

export interface CompositeHistoryItem {
  id: string
  date: string
  compositeValue: string
  unit?: string
  status?: string
  components: Array<{
    name: string
    value: number | string
    unit?: string
  }>
}

// Time-series history of a text-based DiagnosticReport (e.g. imaging, ECG).
export interface ReportHistoryItem {
  id: string
  date: string
  /** Imaging examination day, already projected by the source date policy. */
  calendarDate?: string
  conclusion?: string
  notes: string[]
  status?: string
  institution?: string
}

const COMPONENT_COLORS = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // green
  '#fbbf24', // yellow
  '#a78bfa', // purple
  '#fb923c', // orange
]

export function useCompositeHistory(observationCode?: string, componentNames?: string[]) {
  const { observations = [] } = useClinicalData()

  return useMemo(() => {
    if (!observationCode || !componentNames || componentNames.length === 0) return []

    const compositeItems: CompositeHistoryItem[] = []
    const targetKey = canonicalTestKeyFromString(observationCode)

    // Find all observations with matching code that have components
    observations.forEach((obs) => {
      const obsCodeText = obs.code?.text || obs.code?.coding?.[0]?.display
      const obsCodeCode = obs.code?.coding?.[0]?.code
      const obsKey = canonicalTestKeyFromString(obsCodeText || obsCodeCode || '')

      if (obsKey === targetKey || obsCodeText === observationCode || obsCodeCode === observationCode) {
        const date = obs.effectiveDateTime || ''
        const components: CompositeHistoryItem['components'] = []
        
        // Extract component values in order
        componentNames.forEach((name) => {
          const comp = obs.component?.find((c: any) => {
            const compName = c.code?.text || c.code?.coding?.[0]?.display
            return compName === name
          })
          
          if (comp) {
            components.push({
              name,
              value: comp.valueQuantity?.value ?? comp.valueString ?? '—',
              unit: comp.valueQuantity?.unit
            })
          }
        })

        if (components.length > 0) {
          // Format composite value (e.g., "120/80" for BP)
          const values = components.map(c => 
            typeof c.value === 'number' ? Math.round(c.value) : c.value
          )
          const compositeValue = values.join('/')
          const unit = components[0]?.unit

          compositeItems.push({
            id: obs.id || `composite-${date}`,
            date,
            compositeValue,
            unit,
            status: obs.status,
            components
          })
        }
      }
    })

    // Sort by date (newest first)
    compositeItems.sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateB - dateA
    })

    return compositeItems
  }, [observationCode, componentNames, observations])
}

export function useComponentHistory(observationCode?: string, componentNames?: string[]) {
  const { observations = [] } = useClinicalData()

  return useMemo(() => {
    if (!observationCode || !componentNames || componentNames.length === 0) return []

    const componentHistories: ComponentHistoryItem[] = componentNames.map((name, index) => ({
      componentName: name,
      data: [],
      color: COMPONENT_COLORS[index % COMPONENT_COLORS.length]
    }))

    const targetKey = canonicalTestKeyFromString(observationCode)

    // Find all observations with matching code that have components
    observations.forEach((obs) => {
      const obsCodeText = obs.code?.text || obs.code?.coding?.[0]?.display
      const obsCodeCode = obs.code?.coding?.[0]?.code
      const obsKey = canonicalTestKeyFromString(obsCodeText || obsCodeCode || '')

      if (obsKey === targetKey || obsCodeText === observationCode || obsCodeCode === observationCode) {
        const date = obs.effectiveDateTime || ''
        
        // Extract component values
        obs.component?.forEach((comp: any) => {
          const compName = comp.code?.text || comp.code?.coding?.[0]?.display
          const compIndex = componentNames.findIndex(n => n === compName)
          
          if (compIndex !== -1 && comp.valueQuantity?.value !== undefined) {
            componentHistories[compIndex].data.push({
              id: `${obs.id}-${compName}-${date}`,
              date,
              value: comp.valueQuantity.value,
              unit: comp.valueQuantity.unit,
              status: obs.status,
              interpretation: comp.interpretation?.text || comp.interpretation?.coding?.[0]?.display,
              referenceRange: comp.referenceRange?.[0] ? {
                low: comp.referenceRange[0].low?.value,
                high: comp.referenceRange[0].high?.value,
                text: comp.referenceRange[0].text,
              } : undefined,
            })
          }
        })
      }
    })

    // Sort each component's data by date (newest first)
    componentHistories.forEach(ch => {
      ch.data.sort((a, b) => {
        const dateA = new Date(a.date).getTime()
        const dateB = new Date(b.date).getTime()
        return dateB - dateA
      })
    })

    return componentHistories.filter(ch => ch.data.length > 0)
  }, [observationCode, componentNames, observations])
}

export function useObservationHistory(observationCode?: string, fallbackObservation?: any) {
  const { observations = [], diagnosticReports = [], procedures = [] } = useClinicalData()

  const history = useMemo(() => {
    if (!observationCode) return []

    const items: ObservationHistoryItem[] = []

    // Create a map of report ID to report name
    const reportMap = new Map<string, string>()
    diagnosticReports.forEach((report) => {
      if (report.id && report.code?.text) {
        reportMap.set(report.id, report.code.text)
      }
    })

    // Create a map of observation ID to report ID
    const obsToReportMap = new Map<string, string>()
    diagnosticReports.forEach((report) => {
      report.result?.forEach((ref) => {
        const obsId = ref.reference?.split('/').pop()
        if (obsId && report.id) {
          obsToReportMap.set(obsId, report.id)
        }
      })
    })

    const targetKey = canonicalTestKeyFromString(observationCode)

    // A selected result may be nested inside a DiagnosticReport without being
    // repeated in the bundle's top-level Observation list. Include it once so
    // the history action never opens an empty dialog for the row just clicked.
    const fallbackAlreadyLoaded = fallbackObservation && observations.some((obs: any) => (
      obs === fallbackObservation
      || (!!fallbackObservation.id && obs?.id === fallbackObservation.id)
    ))
    const sourceObservations = fallbackObservation && !fallbackAlreadyLoaded
      ? [...observations, fallbackObservation]
      : observations

    // Find all observations with matching code
    sourceObservations.forEach((obs) => {
      const obsCodeText = obs.code?.text || obs.code?.coding?.[0]?.display
      const obsCodeCode = obs.code?.coding?.[0]?.code
      const obsKey = canonicalTestKeyFromString(obsCodeText || obsCodeCode || '')

      // Match by canonical key (handles cross-institution name variants) or exact string
      if (obsKey === targetKey || obsCodeText === observationCode || obsCodeCode === observationCode) {
        const value = (obs.valueQuantity?.value
          ?? obs.valueString
          ?? getCodeableConceptText(obs.valueCodeableConcept))
          || '—'
        const unit = obs.valueQuantity?.unit
        const date = obs.effectiveDateTime || ''

        // Get interpretation
        const interpText = obs.interpretation?.text || obs.interpretation?.coding?.[0]?.display

        // Get reference range
        const refRange = obs.referenceRange?.[0]
        const referenceRange = refRange
          ? {
              low: refRange.low?.value,
              high: refRange.high?.value,
              text: refRange.text,
            }
          : undefined

        // Get report info
        const reportId = obs.id ? obsToReportMap.get(obs.id) : undefined
        const reportName = reportId ? reportMap.get(reportId) : undefined

        items.push({
          id: obs.id || `obs-${date}`,
          date,
          value,
          unit,
          status: obs.status,
          interpretation: interpText,
          referenceRange,
          reportName,
          reportId,
          unitInferred: isInferredObservationUnit(obs),
        })
      }
    })

    // Find all procedures with matching code
    procedures.forEach((procedure: any) => {
      const procedureCodeText = procedure.code?.text || procedure.code?.coding?.[0]?.display
      const procedureCodeCode = procedure.code?.coding?.[0]?.code

      // Match by text or code
      if (procedureCodeText === observationCode || procedureCodeCode === observationCode) {
        const outcome = procedure.outcome?.text || procedure.outcome?.coding?.[0]?.display
        const notes = Array.isArray(procedure.note)
          ? procedure.note.map((n: any) => n?.text).filter(Boolean).join("; ")
          : undefined
        const value = outcome || notes || procedure.status || '—'
        const date = procedure.performedDateTime || procedure.performedPeriod?.start || ''

        items.push({
          id: procedure.id || `procedure-${date}`,
          date,
          value,
          status: procedure.status,
          interpretation: undefined,
          referenceRange: undefined,
          reportName: 'Procedure',
          reportId: undefined,
        })
      }
    })

    // Sort by date (newest first)
    items.sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateB - dateA
    })

    return items
  }, [observationCode, observations, diagnosticReports, fallbackObservation, procedures])

  return history
}

/**
 * Build a chronological history of text-based DiagnosticReports (imaging, ECG,
 * pathology) that share the same report code/title. Used by the trend dialog
 * when invoked from a report row whose firstObs is a synthetic Report Summary.
 *
 * Exact-match on report title (case-insensitive, trimmed) — different body
 * parts ("CT 腹部" vs "CT 胸部") legitimately have different titles and should
 * NOT merge.
 */
export function useReportHistory(reportCode?: string) {
  const { diagnosticReports = [] } = useClinicalData()

  return useMemo(() => {
    if (!reportCode) return []
    const target = reportCode.trim().toLowerCase()
    if (!target) return []

    const items: ReportHistoryItem[] = []
    diagnosticReports.forEach((dr: any, index: number) => {
      // Derive the match key with the SAME fallback chain getCodeableConceptText
      // uses to build `rawTitle` upstream (text → coding[0].display →
      // coding[0].code). If these diverge, a report carrying only an NHI order
      // code (no human-readable text/display) gets a rawTitle of that code while
      // the lookup key resolves to '' — so the dialog would show "無歷史資料"
      // even though the report exists. Keep both paths identical.
      const drText = (dr.code?.text || dr.code?.coding?.[0]?.display || dr.code?.coding?.[0]?.code || '').trim().toLowerCase()
      if (!drText || drText !== target) return

      const conclusion = dr.conclusion?.trim()
      const notes = Array.isArray(dr.note)
        ? dr.note.map((n: any) => n?.text).filter(Boolean) as string[]
        : []
      // The source history must retain text supplied only as an attachment,
      // just as the report row and shared-source narrative do. Leave binary
      // and HTML attachments to their existing viewers.
      const attachmentText = inferReportDisplayGroup(dr) === 'imaging'
        ? sharedReportNarrative({ presentedForm: dr.presentedForm }) : ''
      if (attachmentText) notes.push(attachmentText)
      if (!conclusion && notes.length === 0) return

      items.push({
        id: dr.id || `dr-${dr.issued || dr.effectiveDateTime || index}`,
        date: getReportDate(dr) || '',
        calendarDate: inferReportDisplayGroup(dr) === 'imaging' ? getReportDate(dr)?.slice(0, 10) : undefined,
        conclusion,
        notes,
        status: dr.status,
        // In-house VGH performers can be legacy DOC physician labels. Use the
        // known source institution rather than presenting a person as a site.
        institution: inferReportDisplayGroup(dr) === 'imaging'
          ? (getImagingCopySource(dr) === 'hospital' ? '臺北榮總' : getReportInstitution(dr))
          : dr.performer?.[0]?.display,
      })
    })

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return items
  }, [reportCode, diagnosticReports])
}
