import { projectClinicalMedicationContents } from '@/src/infrastructure/fhir/mappers/clinical-medication-projection'
import { excludeUnresolvedDecisionVariants } from '@/src/core/utils/clinical-variant-inputs'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileMedicationRequests } from '@/src/infrastructure/fhir/services/medication-reconciliation'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
const ATC = 'http://www.whocc.no/atc'
function fixture() {
 const base = { resourceType: 'MedicationRequest', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/one' }, authoredOn: '2026-09-17', intent: 'order', identifier: [{ system: 'urn:oid:vgh.medication.order', value: 'confirmed-order', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC' }] } }], medicationCodeableConcept: { text: 'Synthetic product 5 mg', coding: [{ system: NHI, code: 'SYNTHETIC1' }] } }
 const cloud = { ...base, id: 'cloud-med', meta: { source: 'https://medcloud2.nhi.gov.tw/' }, status: 'unknown', medicationCodeableConcept: { ...base.medicationCodeableConcept, coding: [...base.medicationCodeableConcept.coding, { system: ATC, code: 'B01AF02' }] }, dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } }, extension: [{ url: 'https://synthetic.example/source-module', valueString: 'IMUE0008' }] }
 const hospital = { ...base, id: 'hospital-med', meta: { source: 'ehr-fhir-bridge/scraper' }, status: 'active', dosageInstruction: [{ text: '1 TAB PO QD', doseAndRate: [{ doseQuantity: { value: 1, unit: 'TAB' } }] }] }
 return { cloud, hospital }
}
it('preserves the existing verified cross-source code union through Local parse and aggregate projection', () => {
 const expected = fixture()
 const reconciled = reconcileMedicationRequests([expected.cloud, expected.hospital])
 expect(reconciled).toHaveLength(1)
 expect(reconciled[0].medicationCodeableConcept.coding).toContainEqual({ system: ATC, code: 'B01AF02' })
 const { cloud, hospital } = fixture()
 const collection = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'synthetic' } }, { resource: { resourceType: 'Encounter', id: 'one', subject: { reference: 'Patient/synthetic' } } }, { resource: cloud }, { resource: hospital }] } as any)!.collection
 expect(collection.medications).toHaveLength(1)
 expect(collection.medications[0].medicationCodeableConcept?.coding).toContainEqual({ system: ATC, code: 'B01AF02' })
 const projected = projectClinicalAggregate(collection)
 expect(projected.medications[0].medicationCodeableConcept?.coding).toContainEqual({ system: ATC, code: 'B01AF02' })
 expect(projected.medications[0]._sourcePrescriptionRecords).toHaveLength(2)
 expect(projected.clinicalSource!.graph.nodes.find(node => node.resource.id === 'hospital-med')!.resource.medicationCodeableConcept).toEqual(hospital.medicationCodeableConcept)
})

it('does not promote an unknown code provenance into AI/tool decision facts', async () => {
 const collection = LocalBundleService.parse({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'synthetic' } }, { resource: { resourceType: 'MedicationRequest', id: 'unresolved', status: 'active', medicationReference: { reference: 'Medication/missing' } } }] } as any)!.collection
 const original = { ...collection.medications[0], medicationCodeableConcept: { text: 'Unproven drug', coding: [{ system: ATC, code: 'UNPROVEN' }] }, medicationReference: { reference: 'Medication/missing', display: 'Unproven drug' }, drugTerminology: { ingredientText: 'Unproven ingredient' } } as any
 const projected = projectClinicalMedicationContents([original], collection.clinicalSource!)
 expect(projected[0].medicationCodeableConcept?.text).toBe('Unproven drug')
 expect(projected[0].clinicalMedicationCodeProvenance).toBeUndefined()
 expect(projected[0].clinicalMedicationContentUncertainty?.reason).toBe('unresolved-reference')
 const data = { ...collection, medications: projected }
 const decision = excludeUnresolvedDecisionVariants(data)
 expect(decision.medications).toHaveLength(1)
 expect(JSON.stringify(decision.medications)).not.toMatch(/Unproven|UNPROVEN/)
 const tool: any = await createFhirTools(() => ({ patient: null, collection: data })).queryMedications.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(JSON.stringify(tool)).not.toMatch(/Unproven|UNPROVEN/)
 expect(tool).toMatchObject({ incomplete: true, canConcludeAbsence: false })
 expect(stripClinicalCaptureMetadata({ clinicalMedicationCodeProvenance: 'mapped-policy', id: 'stable' })).toEqual({ id: 'stable' })
})
