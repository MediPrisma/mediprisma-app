import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import { isVghtpeSource, isMedcloudSource } from '@/src/shared/utils/clinical-source-identity'

export type ExportMedication = MedicationEntity & {
  identifier?: Array<Record<string, unknown>>
  exportSourceLabel?: string
}

/** A confirmed import merge must not make the source prescriptions disappear
 * from the portable summary. Each exported source remains explicitly labelled
 * as a record of the same prescription, not an additional prescription. */
export function medicationSourceRecords(medications: MedicationEntity[]): ExportMedication[] {
  return medications.flatMap((medication) => medication._sourcePrescriptionRecords?.length
    ? medication._sourcePrescriptionRecords.map((source): ExportMedication => ({
      ...source,
      medicationCodeableConcept: source._resolvedMedicationCodeableConcept ?? source.medicationCodeableConcept,
      _sourceRecordComparison: medication._sourceRecordComparison,
      exportSourceLabel: `${isVghtpeSource(source) ? 'Hospital' : isMedcloudSource(source) ? 'MediCloud' : 'Original source'} record: ${source.resourceType}/${source.id}`,
    }))
    : [medication])
}

export function sourceSupplyText(medication: ExportMedication): string | undefined {
  if (!medication.exportSourceLabel || !medication.dispenseRequest) return undefined
  const { quantity, expectedSupplyDuration, validityPeriod } = medication.dispenseRequest
  const quantityText = (value: { value?: number; unit?: string; code?: string } | undefined) =>
    value?.value === undefined ? undefined : [value.value, value.unit || value.code].filter(value => value !== undefined).join(' ')
  return [
    quantityText(quantity) && `Source total quantity: ${quantityText(quantity)}`,
    quantityText(expectedSupplyDuration) && `Source supply duration: ${quantityText(expectedSupplyDuration)}`,
    validityPeriod && `Source dispensing validity (not treatment period): ${validityPeriod.start || '?'} to ${validityPeriod.end || '?'}`,
  ].filter(Boolean).join('; ') || undefined
}
