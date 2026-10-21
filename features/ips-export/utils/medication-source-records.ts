import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'

export type ExportMedication = MedicationEntity & {
  identifier?: Array<Record<string, unknown>>
  exportSourceLabel?: string
  exportOriginalDosage?: boolean
  exportCurrentnessUnconfirmed?: boolean
  exportIntegrated?: boolean
}

/** A confirmed import merge must not make the source prescriptions disappear
 * from the portable summary. Each exported source remains explicitly labelled
 * as a record of the same prescription, not an additional prescription. */
export function medicationSourceRecords(medications: MedicationEntity[]): ExportMedication[] {
  return medications.flatMap((medication) => {
    const sources: ExportMedication[] = medication._sourcePrescriptionRecords?.length
      ? medication._sourcePrescriptionRecords.map((source): ExportMedication => ({
      ...source,
      medicationCodeableConcept: source._resolvedMedicationCodeableConcept ?? source.medicationCodeableConcept,
      _sourceRecordComparison: medication._sourceRecordComparison,
      exportOriginalDosage: true,
    }))
      : [medication]
    return sources.map(source => {
      const reference = `${source._sourceResourceType || 'MedicationRequest'}/${source.id}`
      const origin = source._sourceRecordComparison?.sourceStatuses?.find(record => record.reference === reference)?.origin
      const sourceMeta = source as ExportMedication & { meta?: { source?: string } }
      return { ...source, exportSourceLabel: `${origin === 'hospital' || isVghtpeSource(sourceMeta) ? 'Hospital'
        : origin === 'medcloud' || isMedcloudSource(sourceMeta) ? 'MediCloud' : 'Original source'} record: ${reference}` }
    })
  })
}

export function sourceSupplyText(medication: ExportMedication): string | undefined {
  if (medication.exportIntegrated || !medication.exportSourceLabel || !medication.dispenseRequest) return undefined
  const { quantity, expectedSupplyDuration, validityPeriod } = medication.dispenseRequest
  const quantityText = (value: { value?: number; unit?: string; code?: string } | undefined) =>
    value?.value === undefined ? undefined : [value.value, value.unit || value.code].filter(value => value !== undefined).join(' ')
  return [
    quantityText(quantity) && `Source total quantity: ${quantityText(quantity)}`,
    quantityText(expectedSupplyDuration) && `Source supply duration: ${quantityText(expectedSupplyDuration)}`,
    validityPeriod && `Source dispensing validity (not treatment period): ${validityPeriod.start || '?'} to ${validityPeriod.end || '?'}`,
  ].filter(Boolean).join('; ') || undefined
}

export function medicationExportUnit(medication: MedicationEntity) {
  const [canonical] = medicationSourceRecords([{ ...medication, _sourcePrescriptionRecords: undefined }])
  const sources = medication._sourcePrescriptionRecords?.length ? medicationSourceRecords([medication]) : []
  if (sources.length) {
    canonical.exportIntegrated = true
    canonical.exportSourceLabel = `Integrated prescription; original source records retained: ${medication._reconciledSourceReferences?.join(' + ') || sources.map(source => source.exportSourceLabel).join(' + ')}`
  }
  return { canonical, sources }
}
