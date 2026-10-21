jest.mock('fhirclient', () => ({ __esModule: true, default: { oauth2: { ready: jest.fn() } } }))
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirPatientRepository } from '@/src/infrastructure/fhir/repositories/patient.repository'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { knownClinicalSourceSession, captureClinicalSource } from '@/src/infrastructure/fhir/services/clinical-source-session'

const patient = { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic' }] }
const observation = { resourceType: 'Observation', id: 'synthetic-lab', status: 'final', code: { text: 'Synthetic' }, valueQuantity: { value: 7 } }

beforeEach(() => {
  jest.restoreAllMocks()
  fhirClient.clearClient()
  ;(fhirClient as any).client = { patient: { id: 'synthetic' }, state: { serverUrl: 'https://logout.example/fhir' } }
})
afterEach(() => { jest.restoreAllMocks(); fhirClient.clearClient(); window.history.replaceState({}, '', '/') })

it('clearClient immediately purges Patient and clinical captures, caches and repository-held sessions', async () => {
  jest.spyOn(fhirClient, 'request').mockResolvedValue(patient)
  jest.spyOn(fhirClient, 'requestAllPages').mockResolvedValue({ entry: [{ resource: observation }] })
  await new FhirPatientRepository().getCurrentPatient()
  const repository = new FhirClinicalDataRepository()
  await repository.fetchObservations('synthetic')
  expect(repository.getClinicalSource('synthetic').graph.nodes).toHaveLength(2)
  const session = knownClinicalSourceSession(fhirClient)!
  expect(session.successfulResponses.size).toBeGreaterThan(0)
  fhirClient.clearClient()
  expect(knownClinicalSourceSession(fhirClient)).toBeUndefined()
  expect(session.revoked).toBe(true)
  expect(session.captures.size).toBe(0)
  expect(session.successfulResponses.size).toBe(0)
  expect(session.results.size).toBe(0)
  expect(repository.getClinicalSource('synthetic').graph.nodes).toEqual([])
  expect(new FhirClinicalDataRepository().getClinicalSource('synthetic').graph.nodes).toEqual([])
  expect(() => captureClinicalSource(session, 'late', 'synthetic', [patient])).toThrow('FHIR session changed')
})

it('does not restore a Patient capture after logout during its request', async () => {
  let finish!: (value: any) => void
  let started!: () => void
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const response = new Promise<any>(resolve => { finish = resolve })
  jest.spyOn(fhirClient, 'request').mockImplementation(async () => { started(); return response })
  const pending = new FhirPatientRepository().getCurrentPatient()
  await requestStarted
  const session = knownClinicalSourceSession(fhirClient)!
  fhirClient.clearClient()
  finish(patient)
  await expect(pending).rejects.toThrow('FHIR session changed')
  expect(session.captures.size).toBe(0)
  expect(knownClinicalSourceSession(fhirClient)).toBeUndefined()
})

it('does not restore clinical captures after logout during a search', async () => {
  let finish!: (value: any) => void
  let started!: () => void
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const response = new Promise<any>(resolve => { finish = resolve })
  jest.spyOn(fhirClient, 'requestAllPages').mockImplementation(async () => { started(); return response })
  const repository = new FhirClinicalDataRepository()
  const pending = repository.fetchObservations('synthetic')
  await requestStarted
  const session = knownClinicalSourceSession(fhirClient)!
  fhirClient.clearClient()
  finish({ entry: [{ resource: observation }] })
  expect(await pending).toEqual([])
  expect(session.captures.size).toBe(0)
  expect(repository.getClinicalSource('synthetic').graph.nodes).toEqual([])
  expect(knownClinicalSourceSession(fhirClient)).toBeUndefined()
})

it('does not restore a SMART client when OAuth initialization completes after clearClient', async () => {
  fhirClient.clearClient()
  window.history.replaceState({}, '', '/?state=synthetic-test')
  let finish!: (value: any) => void
  let started!: () => void
  const readyStarted = new Promise<void>(resolve => { started = resolve })
  const response = new Promise<any>(resolve => { finish = resolve })
  const { default: FHIR } = jest.requireMock('fhirclient')
  FHIR.oauth2.ready.mockImplementation(async () => { started(); return response })
  const pending = fhirClient.getClient()
  await readyStarted
  fhirClient.clearClient()
  finish({ state: { serverUrl: 'https://logout.example/fhir' } })
  await expect(pending).rejects.toThrow('local-bundle mode')
  expect((fhirClient as any).client).toBeNull()
})
