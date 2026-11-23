import { isVghtpeSource } from './clinical-source-identity'
import { complementHospitalFromCloud } from './medication-source-complement'

const CLINICAL_FIELDS = ['status', 'intent', 'authoredOn', 'effectiveDateTime', 'effectivePeriod',
  'dosageInstruction', 'dosage', 'dispenseRequest', 'courseOfTherapyType', 'note', 'extension',
  'requester', 'informationSource', 'reasonCode', 'category', 'identifier'] as const

/** A display-only view of a confirmed source union. Missing hospital clinical
 * facts stay missing; the visit context the MediCloud copy showed (institution
 * with care setting, billing diagnosis, drug class) is kept when the hospital
 * order lacks it. Canonical identity, navigation aliases and original evidence
 * remain attached. The imported graph and export record are never mutated. */
export function hospitalMedicationDisplayRecord<T extends Record<string, any>>(record: T): T {
  const hospital = record._sourcePrescriptionRecords?.find(isVghtpeSource)
  if (!hospital) return record
  return complementHospitalFromCloud({
    ...record, ...hospital,
    ...Object.fromEntries(CLINICAL_FIELDS.map(field => [field, hospital[field]])),
    id: record.id,
    encounter: record.encounter,
    medicationCodeableConcept: hospital._resolvedMedicationCodeableConcept || hospital.medicationCodeableConcept,
    _sourceResourceType: hospital.resourceType || record._sourceResourceType,
    _sourcePrescriptionRecords: record._sourcePrescriptionRecords,
    _sourceRecordComparison: record._sourceRecordComparison,
    _reconciledSourceReferences: record._reconciledSourceReferences,
  }, record._sourcePrescriptionRecords)
}
