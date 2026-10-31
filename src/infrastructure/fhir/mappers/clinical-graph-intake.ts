import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'
import { selectClinicalSourceNodes, type ClinicalReconciliationResult } from '@/src/core/services/clinical-reconciliation'
import { isSmartClinicalSource, mutableClinicalProjection } from '../services/clinical-source-session'
import { FhirMapper, isMedicationRemainingSummaryBasic } from './fhir.mapper'

// These are the same explicit domain adapters used by repository searches.
// Supporting Medication/Patient/Organization and unknown Basic resources stay graph-only.
const adapters: Record<string, [keyof ClinicalDataCollection, (resource: any) => any]> = {
  Condition: ['conditions', FhirMapper.toCondition],
  MedicationRequest: ['medications', resource => FhirMapper.toMedication({ ...resource, _sourceResourceType: 'MedicationRequest' })],
  MedicationStatement: ['medications', resource => FhirMapper.toMedication({ ...resource, _sourceResourceType: 'MedicationStatement' })],
  AllergyIntolerance: ['allergies', FhirMapper.toAllergy],
  DiagnosticReport: ['diagnosticReports', resource => FhirMapper.toDiagnosticReport(resource, [])],
  ImagingStudy: ['imagingStudies', FhirMapper.toImagingStudy],
  Procedure: ['procedures', FhirMapper.toProcedure],
  Encounter: ['encounters', FhirMapper.toEncounter],
  DocumentReference: ['documentReferences', FhirMapper.toDocumentReference],
  Composition: ['compositions', FhirMapper.toComposition],
  Immunization: ['immunizations', FhirMapper.toImmunization],
  Consent: ['consents', FhirMapper.toConsent],
  Device: ['devices', FhirMapper.toDevice],
  CarePlan: ['carePlans', FhirMapper.toCarePlan],
  Basic: ['medicationRemainingSummaries', resource => isMedicationRemainingSummaryBasic(resource) ? FhirMapper.toMedicationRemainingSummary(resource) : undefined],
}
const mappedSources = new WeakMap<ClinicalReconciliationResult, Map<string, any>>()
/** Fill SMART search includes before common projection. Local imports already
 * apply domain reconciliation to the complete bundle; never undo that disposition. */
export function includeCapturedClinicalRows<T extends Partial<ClinicalDataCollection>>(input: T, source: ClinicalReconciliationResult): T {
  if (!isSmartClinicalSource(source)) return input
  let next = input
  let cache = mappedSources.get(source)
  if (!cache) { cache = new Map(); mappedSources.set(source, cache) }
  const existing = new Set(Object.values(input).filter(Array.isArray).flatMap(rows => rows.map((row: any) => row?.clinicalSourceNodeKey)))
  for (const node of selectClinicalSourceNodes(source)) {
    if (existing.has(node.key)) continue
    const adapter = adapters[node.resource.resourceType]
    if (!adapter) continue
    const [key, map] = adapter
    if (!cache.has(node.key)) {
      const mapped = map(mutableClinicalProjection(node.resource))
      cache.set(node.key, mapped && { ...mapped, sourceId: node.resource.id, sourceVersionId: (node.resource.meta as any)?.versionId, clinicalSourceNodeKey: node.key })
    }
    const row = cache.get(node.key)
    if (!row) continue
    if (next === input) next = { ...input }
    ;(next as any)[key] = [...((next as any)[key] ?? []), row]
  }
  return next
}
