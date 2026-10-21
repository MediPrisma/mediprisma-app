import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('marks resolved contained Patient ownership unresolved without interpreting its local id as a foreign REST id', async () => {
  const client = { state: { serverUrl: 'https://contained-scope.example/fhir' } }
  jest.mocked(fhirClient.getClient).mockResolvedValue(client as any)
  jest.mocked(fhirClient.requestAllPages).mockResolvedValue({ entry: [
    { resource: { resourceType: 'Observation', id: 'contained-owner', subject: { reference: '#local-patient' }, contained: [{ resourceType: 'Patient', id: 'local-patient' }], valueQuantity: { value: 99 } } },
    { resource: { resourceType: 'Observation', id: 'unresolved-reference', subject: { reference: '#missing' }, contained: [{ resourceType: 'Patient', id: 'other' }], valueQuantity: { value: 7 } } },
  ] } as any)
  const repository = new FhirClinicalDataRepository()
  const observations = await repository.fetchObservations('current')
  expect(observations.map(row => row.valueQuantity?.value)).toEqual([7])
  expect(repository.getQueryStatus('Observation')).toMatchObject({ state: 'error', count: 1, excludedCount: 1,
    exclusionReason: 'unresolved-patient-reference', exclusionCounts: { 'unresolved-patient-reference': 1 } })
  expect(repository.getQueryStatus('Observation')?.message).not.toContain('different patient')
  expect(repository.getClinicalSource('current').graph.nodes.some(node => node.resource.id === 'contained-owner')).toBe(true)
})

it('reports excluded clinical rows as domain incompleteness without blocking domains containing only foreign support nodes', async () => {
  const client = { state: { serverUrl: 'https://scope.example/fhir' } }
  jest.mocked(fhirClient.getClient).mockResolvedValue(client as any)
  jest.mocked(fhirClient.requestAllPages).mockImplementation(async (url: any) => {
    const type = String(url).split('?')[0]
    return { entry: [
      { resource: { resourceType: 'Patient', id: 'other' }, fullUrl: 'https://foreign.example/fhir/Patient/other' },
      ...(type === 'Condition' ? [{ resource: { resourceType: 'Condition', id: 'foreign-condition', subject: { reference: 'Patient/other' }, code: { text: 'Foreign diagnosis' } } }] : []),
      ...(type === 'Observation' ? [
        { resource: { resourceType: 'Observation', id: 'foreign-lab', subject: { reference: 'Patient/other' }, code: { text: 'Foreign lab' }, valueQuantity: { value: 99 } } },
        { resource: { resourceType: 'Observation', id: 'own-lab', subject: { reference: 'Patient/current' }, code: { text: 'Own lab' }, valueQuantity: { value: 7 } } },
      ] : []),
    ] } as any
  })
  const repository = new FhirClinicalDataRepository()
  const collection = await repository.fetchAllClinicalData('current')
  expect(collection.conditions).toEqual([])
  expect(collection.observations.map(row => row.valueQuantity?.value)).toEqual([7])
  expect(collection.resourceQueryStatus?.Condition).toMatchObject({ state: 'error', count: 0, excludedCount: 1, exclusionReason: 'foreign-patient-reference' })
  expect(collection.resourceQueryStatus?.Observation).toMatchObject({ state: 'error', count: 1, excludedCount: 1 })
  expect(collection.resourceQueryStatus?.AllergyIntolerance).toMatchObject({ state: 'empty', count: 0 })
  expect(collection.clinicalSource!.graph.nodes.some(node => node.resource.id === 'foreign-condition')).toBe(true)
  const tools = createFhirTools(() => ({ patient: null, collection }))
  const overview = await (tools.getDataOverview as any).execute({})
  expect(overview).toMatchObject({ incomplete: true, canConcludeAbsence: false })
  expect(overview.data.conditions).toMatchObject({ count: 0, incomplete: true, canConcludeAbsence: false })
  expect(overview.data.observations).toMatchObject({ count: 1, incomplete: true, canConcludeAbsence: false })
  expect(overview.data.allergies).toMatchObject({ count: 0, incomplete: false, canConcludeAbsence: true })
})
