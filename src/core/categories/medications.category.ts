// Medications Category
import type { DataCategory, ClinicalContextSection } from '../interfaces/data-category.interface'
import type { MedicationRequest } from '@/src/shared/types/fhir.types'
import { isWithinTimeRange } from '../utils/date-filter.utils'
import { pickAiMedicationName } from '@/src/shared/utils/fhir-display-helpers'

const isActiveMedication = (med: MedicationRequest): boolean => {
  return med.status === 'active' || med.status === 'completed'
}

const isChronicMedication = (med: any): boolean => {
  const coding = med?.courseOfTherapyType?.coding
  if (!Array.isArray(coding)) return false
  return coding.some((c: any) => c?.code === 'continuous')
}

const applyMedicationFilters = (
  meds: MedicationRequest[],
  filters: Record<string, any>
): MedicationRequest[] => {
  let filtered = meds

  if ((filters?.medicationStatus ?? 'active') === 'active') {
    filtered = filtered.filter(isActiveMedication)
  }

  const chronic = (filters?.medicationChronic as string) || 'all'
  if (chronic === 'chronic') {
    filtered = filtered.filter(isChronicMedication)
  } else if (chronic === 'acute') {
    filtered = filtered.filter((m) => !isChronicMedication(m))
  }

  const timeRange = (filters?.medicationTimeRange as string) || 'all'
  if (timeRange !== 'all') {
    filtered = filtered.filter((m: any) => isWithinTimeRange(m.authoredOn, timeRange))
  }

  return filtered
}

export const medicationsCategory: DataCategory<MedicationRequest> = {
  id: 'medications',
  label: 'Medications',
  labelKey: 'dataSelection.medications',
  description: 'Current and past medications',
  descriptionKey: 'dataSelection.medicationsDesc',
  group: 'medication',
  order: 20,

  filters: [
    {
      key: 'medicationStatus',
      type: 'select',
      label: 'Medication Status',
      options: [
        { value: 'active', label: 'Active Only' },
        { value: 'all', label: 'All Medications' }
      ],
      defaultValue: 'active'
    },
    {
      key: 'medicationChronic',
      type: 'select',
      label: 'Chronic / Acute',
      options: [
        { value: 'all', label: 'All' },
        { value: 'chronic', label: 'Chronic (慢箋) Only' },
        { value: 'acute', label: 'Acute Only' }
      ],
      defaultValue: 'all'
    },
    {
      key: 'medicationTimeRange',
      type: 'select',
      label: 'Time Range',
      options: [
        { value: '1m', label: 'Last Month' },
        { value: '3m', label: 'Last 3 Months' },
        { value: '6m', label: 'Last 6 Months' },
        { value: '1y', label: 'Last Year' },
        { value: 'all', label: 'All Time' }
      ],
      // Default to the last 6 months — long med histories otherwise flood the
      // AI context with stopped/old prescriptions; the user can widen to 全部.
      defaultValue: '6m'
    }
  ],

  filterComponentKey: 'medication',

  extractData: (clinicalData) => clinicalData?.medications || [],

  getCount: (data, filters) => applyMedicationFilters(data, filters).length,

  getContextSection: (data, filters): ClinicalContextSection | null => {
    if (data.length === 0) return null

    const filtered = applyMedicationFilters(data, filters)
    if (filtered.length === 0) return null

    const activeMeds = filtered.filter(isActiveMedication)
    const stoppedMeds = filtered.filter((m) => !isActiveMedication(m))

    const items: string[] = []

    if (activeMeds.length > 0) {
      items.push('Active Medications:')
      activeMeds.forEach((m: any) => {
        const name = m.clinicalMedicationContentUncertainty
          ? 'Medication content unavailable; prescription recorded, drug identity, dose and medication absence are not inferred'
          : pickAiMedicationName(
          m.medicationCodeableConcept,
          m.medicationReference?.display,
        ) || 'Unknown medication'
        const chronicBadge = isChronicMedication(m) ? ' [慢箋]' : ''
        const date = m.authoredOn
          ? ` (started: ${new Date(m.authoredOn).toLocaleDateString()})`
          : ''
        items.push(`  • ${name}${chronicBadge}${date}`)
      })
    }

    if (stoppedMeds.length > 0) {
      if (items.length > 0) items.push('')
      items.push('Stopped Medications:')
      stoppedMeds.forEach((m: any) => {
        const name = m.clinicalMedicationContentUncertainty
          ? 'Medication content unavailable; prescription recorded, drug identity, dose and medication absence are not inferred'
          : pickAiMedicationName(
          m.medicationCodeableConcept,
          m.medicationReference?.display,
        ) || 'Unknown medication'
        const chronicBadge = isChronicMedication(m) ? ' [慢箋]' : ''
        const date = m.authoredOn
          ? ` (${new Date(m.authoredOn).toLocaleDateString()})`
          : ''
        const status = m.status ? ` [${m.status}]` : ''
        items.push(`  • ${name}${chronicBadge}${date}${status}`)
      })
    }

    if (items.length === 0) return null

    return { title: "Patient's Medications", items }
  }
}
