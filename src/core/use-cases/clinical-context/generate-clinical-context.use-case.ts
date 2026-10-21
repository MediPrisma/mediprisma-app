import { excludeUnresolvedDecisionVariants, formatClinicalVariantExclusions } from '@/src/core/utils/clinical-variant-inputs'
// Use Case: Generate Clinical Context
import type { PatientEntity } from '@/src/core/entities/patient.entity'
import type {
  ClinicalDataCollection,
  ObservationEntity,
  DiagnosticReportEntity
} from '@/src/core/entities/clinical-data.entity'
import type {
  ClinicalContextSection,
  ClinicalContextOptions,
  TimeRange
} from '@/src/core/entities/clinical-context.entity'
import { pickAiMedicationName } from '@/src/shared/utils/fhir-display-helpers'

export class GenerateClinicalContextUseCase {
  execute(
    patient: PatientEntity | null,
    clinicalData: ClinicalDataCollection,
    options: ClinicalContextOptions
  ): ClinicalContextSection[] {
    clinicalData = excludeUnresolvedDecisionVariants(clinicalData, options.selection)
    const { selection, filters } = options
    const context: ClinicalContextSection[] = []

    // Patient Information
    if (selection.patientInfo && patient) {
      const items: string[] = []
      if (patient.gender) {
        const gender = patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)
        items.push(`Gender: ${gender}`)
      }
      if (patient.age !== undefined && patient.age !== null) {
        items.push(`Age: ${patient.age}`)
      }
      if (items.length > 0) {
        context.push({ title: 'Patient Information', items })
      }
    }

    // Medications
    if (selection.medications && clinicalData.medications.length > 0) {
      const filtered = clinicalData.medications
        .filter(m => filters.medicationStatus === 'all' || m.status === 'active')
      
      if (filtered.length > 0) {
        
        // Separate active and stopped medications
        // Active statuses: active, completed
        // Stopped statuses: stopped, cancelled, entered-in-error, on-hold
        const activeMeds = filtered.filter(m => 
          m.status === 'active' || m.status === 'completed'
        )
        const stoppedMeds = filtered.filter(m => 
          m.status !== 'active' && m.status !== 'completed'
        )
        
        const items: string[] = []
        
        // Add active medications
        if (activeMeds.length > 0) {
          items.push('Active Medications:')
          activeMeds.forEach(m => {
            const name = pickAiMedicationName(
              m.medicationCodeableConcept,
              m.medicationReference?.display,
            ) || 'Unknown medication'
            const date = m.authoredOn ? ` (started: ${new Date(m.authoredOn).toLocaleDateString()})` : ''
            items.push(`  • ${name}${date}`)
          })
        }
        
        // Add stopped medications
        if (stoppedMeds.length > 0) {
          if (items.length > 0) items.push('') // Add blank line separator
          items.push('Stopped Medications:')
          stoppedMeds.forEach(m => {
            const name = pickAiMedicationName(
              m.medicationCodeableConcept,
              m.medicationReference?.display,
            ) || 'Unknown medication'
            const date = m.authoredOn ? ` (${new Date(m.authoredOn).toLocaleDateString()})` : ''
            const status = m.status ? ` [${m.status}]` : ''
            items.push(`  • ${name}${date}${status}`)
          })
        }
        
        if (items.length > 0) {
          context.push({ title: "Patient's Medications", items })
        }
      }
    }

    // Allergies
    if (selection.allergies && clinicalData.allergies.length > 0) {
      const items = clinicalData.allergies
        .map(a => a.code?.text || 'Unknown allergy')
        .filter(Boolean)
      if (items.length > 0) {
        context.push({ title: "Patient's Allergies", items })
      }
    }

    // Diagnostic Reports (driven by labReports toggle in the new schema)
    if (selection.labReports && clinicalData.diagnosticReports.length > 0) {
      const filtered = this.filterByTimeRange(
        clinicalData.diagnosticReports,
        filters.labReportTimeRange,
        r => r.effectiveDateTime
      )

      if (filtered.length === 0) {
        context.push({
          title: 'Diagnostic Reports',
          items: ['No reports found within the selected time range.']
        })
      } else {
        const items = this.formatDiagnosticReports(filtered, filters.labDepth === 'latest')
        if (items.length > 0) {
          context.push({
            title: `Diagnostic Reports${filters.labDepth === 'latest' ? ' (Latest Versions Only)' : ''}`,
            items
          })
        }
      }
    }

    // Procedures
    if (selection.procedures && clinicalData.procedures.length > 0) {
      const items = clinicalData.procedures.map(p => {
        const name = p.code?.text || p.code?.coding?.[0]?.display || 'Procedure'
        const performed = p.performedDateTime || p.performedPeriod?.end || p.performedPeriod?.start
        const datePart = performed ? ` (${new Date(performed).toLocaleDateString()})` : ''
        const status = p.status ? ` – ${p.status}` : ''
        return `${name}${datePart}${status}`.trim()
      })
      if (items.length > 0) {
        context.push({ title: 'Procedures', items })
      }
    }

    // Vital Signs
    if (selection.vitalSigns) {
      const vitalItems = this.formatVitalSigns(
        clinicalData.vitalSigns,
        filters.vitalSignsTimeRange
      )
      context.push(...vitalItems)
    }

    const exclusions = formatClinicalVariantExclusions(clinicalData)
    if (exclusions) context.push({ title: 'Unresolved source-record variants', items: exclusions.split('\n') })
    return context
  }

  formatSections(sections: ClinicalContextSection[]): string {
    if (!sections || sections.length === 0) return 'No clinical data available.'

    return sections
      .filter(section => section?.items?.length > 0)
      .map(section => {
        const title = section.title || 'Untitled'
        const items = section.items
          .map(item => item.trim().length === 0 ? '' : `- ${item}`)
          .join('\n')
        return `${title}:\n${items}`
      })
      .filter(Boolean)
      .join('\n\n')
  }

  private filterByTimeRange<T>(
    items: T[],
    range: TimeRange,
    getDate: (item: T) => string | undefined
  ): T[] {
    if (range === 'all') return items

    const now = new Date()
    const startDate = new Date(now)

    switch (range) {
      case '24h':
        startDate.setDate(now.getDate() - 1)
        break
      case '3d':
        startDate.setDate(now.getDate() - 3)
        break
      case '1w':
        startDate.setDate(now.getDate() - 7)
        break
      case '1m':
        startDate.setMonth(now.getMonth() - 1)
        break
      case '3m':
        startDate.setMonth(now.getMonth() - 3)
        break
      case '6m':
        startDate.setMonth(now.getMonth() - 6)
        break
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1)
        break
    }

    return items.filter(item => {
      const dateStr = getDate(item)
      if (!dateStr) return false
      const date = new Date(dateStr)
      return !isNaN(date.getTime()) && date >= startDate
    })
  }

  private formatDiagnosticReports(reports: DiagnosticReportEntity[], latestOnly: boolean): string[] {
    if (latestOnly) {
      const reportsByPanel = new Map<string, DiagnosticReportEntity>()
      const sorted = [...reports].sort((a, b) =>
        (b.effectiveDateTime || '').localeCompare(a.effectiveDateTime || '')
      )

      sorted.forEach(report => {
        const panelName = report.code?.text
        if (panelName && !reportsByPanel.has(panelName)) {
          reportsByPanel.set(panelName, report)
        }
      })

      reports = Array.from(reportsByPanel.values())
    }

    const items: string[] = []
    reports.forEach(report => {
      const observations = report._observations || []
      const observationTexts = observations
        .map(obs => {
          const value = obs.valueQuantity?.value ?? obs.valueString
          const unit = obs.valueQuantity?.unit ? ` ${obs.valueQuantity.unit}` : ''
          return value !== undefined && value !== null
            ? `${obs.code?.text || 'Test'}: ${value}${unit}`
            : null
        })
        .filter(Boolean) as string[]

      const datePart = report.effectiveDateTime
        ? ` (${new Date(report.effectiveDateTime).toLocaleDateString()})`
        : ''

      if (observationTexts.length > 0) {
        items.push(`${report.code?.text}${datePart}`)
        observationTexts.forEach(t => items.push(`  • ${t}`))
      } else if (report.conclusion) {
        items.push(`${report.code?.text || 'Report'}: ${report.conclusion}${datePart}`)
      }
    })

    return items
  }

  private formatVitalSigns(
    vitalSigns: ObservationEntity[],
    timeRange: TimeRange
  ): ClinicalContextSection[] {
    if (vitalSigns.length === 0) {
      return []
    }

    const filtered = this.filterByTimeRange(vitalSigns, timeRange, v => v.effectiveDateTime)

    if (filtered.length === 0) {
      return [{ title: 'Vital Signs', items: ['No vital signs found within the selected time range.'] }]
    }

    const byType = new Map<string, ObservationEntity[]>()
    filtered.forEach(obs => {
      const type = obs.code?.text || 'Unknown'
      if (!byType.has(type)) byType.set(type, [])
      byType.get(type)!.push(obs)
    })

    const sections: ClinicalContextSection[] = []
    byType.forEach((observations, type) => {
      const latest = [...observations].sort((a, b) =>
        (b.effectiveDateTime || '').localeCompare(a.effectiveDateTime || '')
      )[0]
      const value = latest.valueQuantity?.value ?? latest.valueString
      const unit = latest.valueQuantity?.unit ?? ''
      if (value !== undefined && value !== null) {
        sections.push({ title: type, items: [`${String(value)} ${unit}`.trim()] })
      }
    })

    return sections
  }
}
