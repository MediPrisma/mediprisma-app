import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
import { GenerateClinicalContextUseCase } from '@/src/core/use-cases/clinical-context/generate-clinical-context.use-case'
import { buildSourceCatalog, GenerateMedicalSummaryUseCase } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { mapMedications, mapProblemList, mapAllergies, mapImmunizations, mapProcedures, mapDevices, mapCarePlans, mapAdvanceDirectives, CLINICAL_RECORD_VARIANT_EXTENSION } from '@/features/ips-export/utils/ips-fhir-mappers'

function parsed() {
  const resources: any[] = [{ resourceType: 'Patient', id: 'synthetic' }]
  for (const version of ['1', '2']) {
    resources.push({ resourceType: 'MedicationRequest', id: 'same-medication', meta: { versionId: version }, status: 'active', intent: 'order', subject: { reference: 'Patient/synthetic' }, medicationCodeableConcept: { text: 'Meitifen SR FC * tab 75 mg', coding: [{ system: 'urn:oid:vgh.medication.product', display: 'Meitifen SR FC * tab 75 mg', code: 'Meitifen SR FC * tab 75 mg' }] }, authoredOn: '2026-10-01', dosageInstruction: [{ text: version + ' tablets' }] })
    resources.push({ resourceType: 'Condition', id: 'same-condition', meta: { versionId: version }, subject: { reference: 'Patient/synthetic' }, code: { text: version === '1' ? 'Hypertension' : 'Diabetes' }, clinicalStatus: { coding: [{ code: 'active' }] } })
    resources.push({ resourceType: 'ResearchStudy', id: 'unknown', meta: { versionId: version }, status: 'active', title: 'Synthetic unknown version ' + version })
  }
  resources.push({ ...resources[1], id: 'normal-medication', meta: undefined, medicationCodeableConcept: { text: 'Meitifen SR FC * tab 75 mg', coding: [{ system: 'urn:oid:vgh.medication.product', display: 'Meitifen SR FC * tab 75 mg', code: 'Meitifen SR FC * tab 75 mg' }] } })
  resources.push({ resourceType: 'Condition', id: 'normal-condition', subject: { reference: 'Patient/synthetic' }, code: { text: 'Unrelated condition' } })
  return LocalBundleService.parse({ resourceType: 'Bundle', entry: resources.map(resource => ({ resource })) } as any)!.collection
}

it('carries actual local MedicationRequest and Condition versions through policy mapping and decision boundaries', () => {
  const data = parsed()
  for (const rows of [data.medications.filter(row => row.sourceId === 'same-medication'), data.conditions.filter(row => row.sourceId === 'same-condition')]) {
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.clinicalRecordVariant?.variantCount === 2)).toBe(true)
    expect(rows.map(row => row.sourceVersionId).sort()).toEqual(['1', '2'])
  }
  expect(data.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'ResearchStudy')).toHaveLength(2)
  expect(Object.keys(data)).not.toContain('researchStudies')
  const selected = selectCdssClinicalInputs(data)
  expect(selected.input.medications.map(row => row.sourceId)).toEqual(['normal-medication'])
  expect(selected.input.conditions.map(row => row.sourceId)).toEqual(['normal-condition'])
  const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'synthetic', age: 70 }, now: new Date('2026-10-02') })
  expect(profile.hospitalMedicationEvidence).toHaveLength(1)
  expect(profile.hospitalMedicationEvidence![0].source.resourceId).toBe(data.medications.find(row => row.sourceId === 'normal-medication')!.id)
  expect(profile.excludedClinicalRecordVariants?.map(row => row.resourceType).sort()).toEqual(['Condition', 'Condition', 'MedicationRequest', 'MedicationRequest'])
  expect(profile.excludedClinicalRecordVariants?.every(row => row.reason && row.sourceId && row.versionId)).toBe(true)
  const scoped = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  expect(scoped.medications!.map(row => row.sourceId)).toEqual(['normal-medication'])
  expect(scoped.conditions!.map(row => row.sourceId)).toEqual(['normal-condition'])
  expect(scoped.clinicalRecordVariantExclusions).toHaveLength(4)
  const directCatalog = buildSourceCatalog(data)
  expect(directCatalog.filter(entry => entry.resourceType.startsWith('Medication'))).toHaveLength(1)
  expect(directCatalog.filter(entry => entry.resourceType === 'Condition')).toHaveLength(1)
  const formatter = new GenerateClinicalContextUseCase()
  const context = formatter.formatSections(formatter.execute(null, data, { selection: ALL_DATA_SELECTION, filters: ALL_DATA_FILTERS }))
  const messages = new GenerateMedicalSummaryUseCase().buildMessages({ clinicalContext: context, catalog: buildSourceCatalog(scoped), locale: 'en' })
  const prompt = messages.map(message => message.content).join('\n')
  expect(prompt).toContain('These records exist but their versions or conflicts are unresolved')
  expect(prompt).toContain('Do not infer absent disease, negative history, no medication')
  expect(prompt).toContain('MedicationRequest record 1 version=1')
  expect(prompt).not.toContain('same-medication')
  expect(prompt).not.toContain('clinicalSourceNodeKey')
  const exports = [...mapMedications(data.medications, 'Patient/synthetic').entries, ...mapProblemList(data.conditions, 'Patient/synthetic').entries].map(entry => entry.resource)
  const variants = exports.filter(resource => (resource.extension as any[])?.some(extension => extension.url === CLINICAL_RECORD_VARIANT_EXTENSION))
  expect(variants).toHaveLength(4)
  expect(variants.every(resource => !('clinicalRecordVariant' in resource))).toBe(true)
})

it('quarantines all ten actual CDSS input array contracts independently without changing normal rows', () => {
  const annotation = parsed().medications.find(row => row.clinicalRecordVariant)!.clinicalRecordVariant!
  const fields = ['conditions', 'encounters', 'observations', 'medications', 'allergies', 'carePlans', 'procedures', 'immunizations', 'diagnosticReports', 'documentReferences']
  const input: any = Object.fromEntries(fields.map(field => [field, [{ id: field + '-variant', clinicalRecordVariant: annotation }, { id: field + '-normal' }]]))
  const selected = selectCdssClinicalInputs(input)
  for (const field of fields) expect(selected.input[field]).toEqual([input[field][1]])
  expect(selected.excluded).toHaveLength(10)
  for (const field of fields) expect(input[field]).toHaveLength(2)
})

it('adds only legal extensions to every remaining IPS resource mapper', () => {
  const annotation = parsed().medications.find(row => row.clinicalRecordVariant)!.clinicalRecordVariant!
  const mappers: Record<string, any> = { mapAllergies, mapImmunizations, mapProcedures, mapDevices, mapCarePlans, mapAdvanceDirectives }
  for (const name of ['mapAllergies', 'mapImmunizations', 'mapProcedures', 'mapDevices', 'mapCarePlans', 'mapAdvanceDirectives']) {
    const result = mappers[name]([{ id: 'synthetic', clinicalRecordVariant: annotation, sourceId: 'original', sourceVersionId: '1' }], 'Patient/synthetic')
    const resources = [...result.entries, ...result.referencedOnly].map(entry => entry.resource)
    expect(resources.length).toBeGreaterThan(0)
    for (const resource of resources) {
      expect(resource).not.toHaveProperty('clinicalRecordVariant')
      expect(resource.extension).toContainEqual(expect.objectContaining({ url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: expect.arrayContaining([{ url: 'sourceId', valueString: 'original' }, { url: 'versionId', valueString: '1' }]) }))
    }
  }
})
