import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { createHospitalAwareCdssPatientProfile } from '@/features/clinical-decision-support/utils/hospital-medication-profile'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { GenerateClinicalContextUseCase } from '@/src/core/use-cases/clinical-context/generate-clinical-context.use-case'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
const resources = () => [{ resourceType: 'Patient', id: 'a' }, { resourceType: 'MedicationRequest', id: 'request', status: 'active', intent: 'order', medicationReference: { reference: 'Medication/missing' } }]

it.each(['local', 'smart'])('keeps a %s prescription with an ambiguous Medication reference explicitly unknown in profile, tools and AI', async path => {
 jest.resetAllMocks()
 ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
 ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('MedicationRequest?') ? resources().map(resource => ({ resource })) : [] }))
 const data = path === 'local' ? LocalBundleService.parse({ resourceType: 'Bundle', entry: resources().map(resource => ({ resource })) } as any)!.collection : await new FhirClinicalDataRepository().fetchAllClinicalData('a')
 expect(data.medications).toHaveLength(1)
 expect(data.medications[0].clinicalRecordVariant).toBeUndefined()
 expect(data.medications[0].medicationCodeableConcept).toBeUndefined()
 const profile = createHospitalAwareCdssPatientProfile({ ...data, patient: { id: 'a', age: 70, gender: 'male' } })
 const beforeOverview: any = await createFhirTools(() => ({ patient: null, collection: data })).getDataOverview.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect({ inventoryUnknown: !!profile.hospitalMedicationInventoryUnresolved, canConcludeMedicationAbsence: beforeOverview.data.medications.canConcludeAbsence }).toEqual({ inventoryUnknown: true, canConcludeMedicationAbsence: false })
 expect(data.medications[0].clinicalMedicationContentUncertainty).toEqual({ reason: 'unresolved-reference' })
 expect(profile.hospitalMedicationInventoryUnresolved).toBeDefined()
 expect(profile.unresolvedClinicalMedicationContents?.[0].reason).toBe('unresolved-reference')
 expect(beforeOverview.data.medications.count).toBe(1)
 const contexts = Object.values(profile.medicationClassContexts ?? {})
 expect(contexts.length).toBeGreaterThan(0)
 expect(contexts.every(context => context?.state !== 'not-found')).toBe(true)
 expect(profile.facts.medicationInventoryUnresolved.en).toMatch(/content is unavailable/i)
 expect(profile.facts.currentDoac).toBeUndefined()
 expect(profile.facts.currentVitaminKAntagonist).toBeUndefined()
 const overview: any = await createFhirTools(() => ({ patient: null, collection: data })).getDataOverview.execute!({}, { toolCallId: 'synthetic', messages: [] })
 expect(overview.data.medications).toMatchObject({ incomplete: true, canConcludeAbsence: false })
 const context = new GenerateClinicalContextUseCase().execute(null, data, { selection: ALL_DATA_SELECTION, filters: ALL_DATA_FILTERS })
 expect(JSON.stringify(context)).toMatch(/medication content unavailable/i)
 expect(JSON.stringify(context)).not.toMatch(/Apixaban|Warfarin/)
})
