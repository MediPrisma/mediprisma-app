// Vital Signs Context Hook
import { useMemo } from "react"
import type { ClinicalContextSection, DataFilters } from "@/src/core/entities/clinical-context.entity"
import { makeTimeRangeTest } from "@/src/core/utils/date-filter.utils"
import type { ClinicalData, Observation } from "./types"
import { expandObservationValues, observationDisplayValue } from "@/src/core/utils/observation-value.utils"
import { normalizeClinicalStatus } from "@/src/core/utils/clinical-context-selection.utils"
import { isAdultPreventiveHealthExamResource } from "@/src/shared/utils/observation-provenance.utils"

/** A reading from the adult preventive health check. The MediCloud bridge
 *  tags most of them with the program, but its blood pressure arrives with
 *  only the module (imue0140, the HPA check-up feed) — accept either. */
function isCheckupReading(obs: Observation): boolean {
  return isAdultPreventiveHealthExamResource(obs as any) ||
    ((obs as any).meta?.tag ?? []).some((tag: { system?: string; code?: string }) =>
      tag.code === 'imue0140' && /source-module$/.test(tag.system ?? ''))
}

export function useVitalSignsContext(
  includeObservations: boolean,
  clinicalData: ClinicalData | null,
  filters?: DataFilters,
  /** 初診快覽 only: mark adult preventive check-up readings with their
   *  program and place. Other consumers keep the unlabelled lines. */
  labelCheckupReadings = false,
): ClinicalContextSection[] {
  return useMemo(() => {
    if (!includeObservations) return []

    const allVitalSigns = [...(clinicalData?.vitalSigns ?? [])]

    if (allVitalSigns.length === 0) {
      return []
    }

    // Deduplicate only when the FHIR id proves identity. Missing-id records are
    // retained individually; keying all of them by `undefined` silently kept
    // only the last measurement.
    const seenIds = new Set<string>()
    const uniqueVitalSigns = allVitalSigns.filter((v) => {
      if (!v.id) return true
      if (seenIds.has(v.id)) return false
      seenIds.add(v.id)
      return true
    })

    const inWindow = makeTimeRangeTest(
      filters?.vitalSignsTimeRange ?? "all",
      clinicalData as { encounters?: any[] } | null,
    )
    const filteredVitalSigns = uniqueVitalSigns.filter((obs: Observation) =>
      inWindow(obs.effectiveDateTime)
      && normalizeClinicalStatus((obs as any).status) !== 'entered-in-error'
    )

    if (filteredVitalSigns.length === 0) {
      return [{ title: "Vital Signs", items: ["No vital signs found within the selected time range."] }]
    }

    // Group by type and get latest
    const byType = new Map<string, Observation[]>()
    filteredVitalSigns.forEach((obs) => {
      // Try to get a meaningful name from code.text, coding display, or component codes
      let type = obs.code?.text || obs.code?.coding?.[0]?.display
      
      // If still no type and has components, try to infer from component names
      if (!type && Array.isArray(obs.component) && obs.component.length > 0) {
        const componentCodes = obs.component
          .map(c => c.code?.text || c.code?.coding?.[0]?.display)
          .filter(Boolean)
        if (componentCodes.some(c => c?.toLowerCase().includes('blood pressure'))) {
          type = 'Blood Pressure'
        }
      }
      
      type = type || "Vital Sign"
      
      if (!byType.has(type)) byType.set(type, [])
      byType.get(type)!.push(obs)
    })

    const sections: ClinicalContextSection[] = []
    byType.forEach((observations, type) => {
      // Sort by date (newest first)
      const sorted = [...observations].sort((a, b) => 
        (b.effectiveDateTime || "").localeCompare(a.effectiveDateTime || "")
      )
      
      // Get observations based on version filter
      const observationsToShow = filters?.vitalSignsVersion === 'all' 
        ? sorted 
        : [sorted[0]] // latest only
      
      const items: string[] = []
      
      // Process each observation
      observationsToShow.forEach(obs => {
        // Format date
        const date = obs.effectiveDateTime 
          ? new Date(obs.effectiveDateTime).toLocaleString('zh-TW', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })
          : ''
        
        const status = normalizeClinicalStatus((obs as any).status) || 'unknown'
        const statusPart = !['final', 'amended', 'corrected'].includes(status) ? ` [status: ${status}]` : ''
        const values = expandObservationValues(obs).flatMap((valueObservation) => {
          const display = observationDisplayValue(valueObservation)
          if (!display) return []
          const label = valueObservation === obs
            ? ''
            : `${valueObservation.code?.text || valueObservation.code?.coding?.[0]?.display || 'Component'}: `
          return [`${label}${display.value}${display.unit ? ` ${display.unit}` : ''}`]
        })
        // A check-up reading is a screening measurement, often years old: say
        // so, and where it was taken, beside the value.
        const performer = (obs as any).performer?.[0]?.display?.split(/[;；]/)[0]?.trim()
        const sourcePart = labelCheckupReadings && isCheckupReading(obs)
          ? ` [adult preventive health check 成人預防保健${performer ? ` · ${performer}` : ''}]`
          : ''
        if (values.length > 0) items.push(`${values.join(', ')}${date ? ` (${date})` : ''}${sourcePart}${statusPart}`)
      })
      
      if (items.length > 0) {
        sections.push({ title: type, items })
      }
    })

    return sections
  }, [includeObservations, clinicalData, filters, labelCheckupReadings])
}
