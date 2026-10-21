import type { ClinicalRecordVariant, MedicationEntity } from '@/src/core/entities/clinical-data.entity'

export const CLINICAL_RECORD_VARIANT_EXTENSION = 'https://mediprisma.app/fhir/StructureDefinition/clinical-record-variant'
export const CLINICAL_MEDICATION_CONTENT_EXTENSION = 'https://mediprisma.app/fhir/StructureDefinition/medication-content-uncertainty'
export interface ImportedClinicalRecordVariant { variant: ClinicalRecordVariant; sourceId?: string; sourceVersionId?: string; sourceResourceType?: string }

/** A recognized modifier must be understood completely before clinical use. */
export function readClinicalRecordVariantModifier(resource: Readonly<Record<string, unknown>>): ImportedClinicalRecordVariant | undefined {
  if (Array.isArray(resource.extension) && resource.extension.some(item => item?.url === CLINICAL_RECORD_VARIANT_EXTENSION)) throw new Error('Clinical record variant modifier cannot be an ordinary extension.')
  if (resource.modifierExtension && !Array.isArray(resource.modifierExtension) && (resource.modifierExtension as { url?: unknown }).url === CLINICAL_RECORD_VARIANT_EXTENSION) throw new Error('Invalid clinical record variant modifier container.')
  const modifiers = Array.isArray(resource.modifierExtension) ? resource.modifierExtension.filter(item => item?.url === CLINICAL_RECORD_VARIANT_EXTENSION) : []
  if (!modifiers.length) return undefined
  const invalid = (): never => { throw new Error('Invalid clinical record variant modifier; manual reconciliation is required before import.') }
  if (modifiers.length !== 1 || !Array.isArray(modifiers[0].extension) || Object.keys(modifiers[0]).some(key => !['url', 'extension', 'id'].includes(key))) return invalid()
  const values = new Map<string, unknown>()
  const fields: Record<string, string> = { groupId: 'valueString', classification: 'valueCode', variantCount: 'valuePositiveInt', reason: 'valueString', sourceId: 'valueString', versionId: 'valueString', sourceResourceType: 'valueCode' }
  for (const field of modifiers[0].extension) {
    if (!field || typeof field !== 'object' || !Object.prototype.hasOwnProperty.call(fields, field.url) || values.has(field.url)) return invalid()
    const valueKey = fields[field.url]
    if (field.extension || Object.keys(field).some(key => !['url', 'id', valueKey].includes(key)) || Object.keys(field).filter(key => key.startsWith('value')).join() !== valueKey) return invalid()
    const value = field[valueKey]
    if (field.url === 'variantCount' ? !Number.isSafeInteger(value) || value < 2 || value > 2147483647 : typeof value !== 'string' || !value.trim()) return invalid()
    values.set(field.url, value)
  }
  if (!['groupId', 'classification', 'variantCount', 'reason'].every(key => values.has(key)) || !['revision', 'conflict'].includes(values.get('classification') as string)) return invalid()
  return { variant: { groupId: values.get('groupId') as string, classification: values.get('classification') as ClinicalRecordVariant['classification'], variantCount: values.get('variantCount') as number, reason: values.get('reason') as string },
    ...(values.has('sourceId') ? { sourceId: values.get('sourceId') as string } : {}), ...(values.has('versionId') ? { sourceVersionId: values.get('versionId') as string } : {}), ...(values.has('sourceResourceType') ? { sourceResourceType: values.get('sourceResourceType') as string } : {}) }
}

/** Independent of record revisions: the prescription exists but its drug is unknown. */
export function readClinicalMedicationContentModifier(resource: Readonly<Record<string, unknown>>): MedicationEntity['clinicalMedicationContentUncertainty'] {
  const invalid = (): never => { throw new Error('Invalid medication content uncertainty modifier; manual reconciliation is required before import.') }
  if (Array.isArray(resource.extension) && resource.extension.some(item => item?.url === CLINICAL_MEDICATION_CONTENT_EXTENSION)) return invalid()
  if (resource.modifierExtension && !Array.isArray(resource.modifierExtension) && (resource.modifierExtension as { url?: unknown }).url === CLINICAL_MEDICATION_CONTENT_EXTENSION) return invalid()
  const modifiers = Array.isArray(resource.modifierExtension) ? resource.modifierExtension.filter(item => item?.url === CLINICAL_MEDICATION_CONTENT_EXTENSION) : []
  if (!modifiers.length) return undefined
  if (!['MedicationRequest', 'MedicationStatement'].includes(String(resource.resourceType))) return invalid()
  const modifier = modifiers[0]
  if (modifiers.length !== 1 || Object.keys(modifier).some(key => !['url', 'extension', 'id'].includes(key)) || !Array.isArray(modifier.extension) || modifier.extension.length !== 1) return invalid()
  const field = modifier.extension[0]
  if (!field || field.url !== 'reason' || field.extension || Object.keys(field).some(key => !['url', 'id', 'valueCode'].includes(key)) || Object.keys(field).filter(key => key.startsWith('value')).join() !== 'valueCode'
    || !['ambiguous-reference', 'unresolved-reference', 'missing-medication-code'].includes(field.valueCode)) return invalid()
  return { reason: field.valueCode }
}

/** Safe quarantine predicate for the two recognized application modifiers only. */
export function hasMalformedClinicalModifier(resource: Readonly<Record<string, unknown>>): boolean {
  try { readClinicalRecordVariantModifier(resource); readClinicalMedicationContentModifier(resource); return false } catch { return true }
}
