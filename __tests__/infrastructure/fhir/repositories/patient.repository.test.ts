// Unit Tests: Patient Repository
import { FhirPatientRepository } from '@/src/infrastructure/fhir/repositories/patient.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { PatientMapper } from '@/src/infrastructure/fhir/mappers/patient.mapper'
import type { PatientEntity } from '@/src/core/entities/patient.entity'

// Mock the dependencies
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/infrastructure/fhir/mappers/patient.mapper')

describe('FhirPatientRepository', () => {
  let repository: FhirPatientRepository
  let mockFhirClient: jest.Mocked<typeof fhirClient>
  let mockPatientMapper: jest.Mocked<typeof PatientMapper>

  beforeEach(() => {
    mockFhirClient = fhirClient as jest.Mocked<typeof fhirClient>
    mockPatientMapper = PatientMapper as jest.Mocked<typeof PatientMapper>
    repository = new FhirPatientRepository()
    jest.clearAllMocks()
  })

  describe('getCurrentPatient', () => {
    it('should fetch and map current patient successfully', async () => {
      // Arrange
      const mockResponse = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: 'patient-123',
              name: [{ given: ['John'], family: 'Doe' }]
            }
          }
        ]
      }
      const mockPatient: PatientEntity = {
        id: 'patient-123',
        resourceType: 'Patient',
        name: [{ given: ['John'], family: 'Doe' }],
        gender: 'male',
        birthDate: '1990-01-15',
        age: 34
      }

      mockFhirClient.request.mockResolvedValue(mockResponse)
      mockPatientMapper.fromBundle.mockReturnValue(mockPatient)

      // Act
      const result = await repository.getCurrentPatient()

      // Assert
      expect(result).toEqual(mockPatient)
      expect(mockFhirClient.request).toHaveBeenCalledWith('Patient')
      expect(mockPatientMapper.fromBundle).toHaveBeenCalledWith(mockResponse)
    })

    it('should return null when mapper returns null', async () => {
      // Arrange
      const mockResponse = { resourceType: 'Bundle', entry: [] }
      mockFhirClient.request.mockResolvedValue(mockResponse)
      mockPatientMapper.fromBundle.mockReturnValue(null)

      // Act
      const result = await repository.getCurrentPatient()

      // Assert
      expect(result).toBeNull()
    })

    it('should throw error when FHIR client fails', async () => {
      // Arrange
      const error = new Error('Network error')
      mockFhirClient.request.mockRejectedValue(error)

      // Act & Assert
      await expect(repository.getCurrentPatient()).rejects.toThrow('Network error')
    })

    it('should log error when fetch fails', async () => {
      // Arrange
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const error = new Error('FHIR error')
      mockFhirClient.request.mockRejectedValue(error)

      // Act
      try {
        await repository.getCurrentPatient()
      } catch {
        // Expected
      }

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Patient Repository] Failed to fetch current patient:', error)
      consoleErrorSpy.mockRestore()
    })
  })

  describe('getPatientById', () => {
    it('should fetch and map patient by ID successfully', async () => {
      // Arrange
      const patientId = 'patient-456'
      const mockResponse = {
        resourceType: 'Patient',
        id: patientId,
        name: [{ given: ['Jane'], family: 'Smith' }],
        gender: 'female',
        birthDate: '1985-06-20'
      }
      const mockPatient: PatientEntity = {
        id: patientId,
        resourceType: 'Patient',
        name: [{ given: ['Jane'], family: 'Smith' }],
        gender: 'female',
        birthDate: '1985-06-20',
        age: 39
      }

      mockFhirClient.request.mockResolvedValue(mockResponse)
      mockPatientMapper.toDomain.mockReturnValue(mockPatient)

      // Act
      const result = await repository.getPatientById(patientId)

      // Assert
      expect(result).toEqual(mockPatient)
      expect(mockFhirClient.request).toHaveBeenCalledWith(`Patient/${patientId}`)
      expect(mockPatientMapper.toDomain).toHaveBeenCalledWith(mockResponse)
    })

    it('should return null when mapper returns null', async () => {
      // Arrange
      const patientId = 'invalid-patient'
      mockFhirClient.request.mockResolvedValue({})
      mockPatientMapper.toDomain.mockReturnValue(null)

      // Act
      const result = await repository.getPatientById(patientId)

      // Assert
      expect(result).toBeNull()
    })

    it('should throw error when FHIR client fails', async () => {
      // Arrange
      const patientId = 'patient-789'
      const error = new Error('Patient not found')
      mockFhirClient.request.mockRejectedValue(error)

      // Act & Assert
      await expect(repository.getPatientById(patientId)).rejects.toThrow('Patient not found')
    })

    it('should log error with patient ID when fetch fails', async () => {
      // Arrange
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const patientId = 'patient-error'
      const error = new Error('Server error')
      mockFhirClient.request.mockRejectedValue(error)

      // Act
      try {
        await repository.getPatientById(patientId)
      } catch {
        // Expected
      }

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith(`[Patient Repository] Failed to fetch patient ${patientId}:`, error)
      consoleErrorSpy.mockRestore()
    })

    it('should handle empty patient ID', async () => {
      // Arrange
      const patientId = ''
      mockFhirClient.request.mockResolvedValue({})
      mockPatientMapper.toDomain.mockReturnValue(null)

      // Act
      const result = await repository.getPatientById(patientId)

      // Assert
      expect(mockFhirClient.request).toHaveBeenCalledWith('Patient/')
      expect(result).toBeNull()
    })
  })
})

describe('shared SMART source capture', () => {
  const { FhirClinicalDataRepository } = jest.requireActual('@/src/infrastructure/fhir/repositories/clinical-data.repository')
  let client: any
  beforeEach(() => {
    jest.resetAllMocks()
    client = { state: { serverUrl: 'https://synthetic.example/fhir' }, patient: { id: 'selected' } }
    ;(fhirClient.getClient as jest.Mock).mockResolvedValue(client)
    ;(PatientMapper.toDomain as jest.Mock).mockImplementation(resource => ({ id: resource.id, resourceType: 'Patient' }))
    ;(PatientMapper.fromBundle as jest.Mock).mockImplementation(bundle => ({ id: bundle.entry.find((entry: any) => entry.resource.resourceType === 'Patient').resource.id }))
  })

  it('captures a pinned raw Patient before its lossy mapper and shares the authenticated session with clinical intake', async () => {
    const clinical = new FhirClinicalDataRepository()
    const raw = { resourceType: 'Patient', id: 'selected', extension: [{ url: 'synthetic-audit', valueString: 'retained' }] }
    ;(fhirClient.request as jest.Mock).mockResolvedValue(raw)
    await new FhirPatientRepository().getCurrentPatient()
    expect(fhirClient.request).toHaveBeenCalledTimes(1)
    const patient = clinical.getClinicalSource('selected').graph.nodes.find((node: any) => node.resource.resourceType === 'Patient')
    expect(patient.resource.extension).toEqual(raw.extension)
    expect(PatientMapper.toDomain).toHaveBeenCalledWith(patient.resource)
    ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [{ resource: { resourceType: 'Observation', id: 'lab', status: 'final', code: { text: 'synthetic' } } }] })
    await clinical.fetchObservations('selected')
    const nodes = clinical.getClinicalSource('selected').graph.nodes
    expect(nodes).toHaveLength(2)
    expect(new Set(nodes.map((node: any) => node.sourceId)).size).toBe(1)
    expect(clinical.getClinicalSource('other-patient').graph.nodes).toEqual([])
  })

  it('isolates unassigned search resources from the selected Patient graph', async () => {
    delete client.patient.id
    ;(fhirClient.request as jest.Mock).mockResolvedValue({ resourceType: 'Bundle', entry: [
      { fullUrl: 'urn:uuid:selected', resource: { resourceType: 'Patient', id: 'selected', extension: [{ url: 'raw', valueString: 'source' }] } },
      { resource: { resourceType: 'UnknownPatientContext', id: 'unknown' } },
      { resource: { resourceType: 'UnknownPatientContext', id: 'related', subject: { reference: 'urn:uuid:selected' } } },
      { resource: { resourceType: 'Patient', id: 'other' } },
    ] })
    expect(await new FhirPatientRepository().getCurrentPatient()).toEqual({ id: 'selected' })
    const clinical = new FhirClinicalDataRepository()
    expect(clinical.getClinicalSource('selected').graph.nodes.map((node: any) => node.resource.id)).toEqual(['selected', 'related'])
    const { knownClinicalSourceSession, readClinicalSource } = jest.requireActual('@/src/infrastructure/fhir/services/clinical-source-session')
    const session = knownClinicalSourceSession(fhirClient)
    expect(readClinicalSource(session, 'unassigned:' + session.sourceId + ':patient-search').graph.nodes.map((node: any) => node.resource.id)).toEqual(['unknown', 'other'])
    expect(clinical.getClinicalSource('other').graph.nodes).toEqual([])
    expect(fhirClient.request).toHaveBeenCalledTimes(1)
  })

  it('replaces a patient read on success, preserves it on failure and isolates a new client session', async () => {
    const patients = new FhirPatientRepository()
    const clinical = new FhirClinicalDataRepository()
    ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Patient', id: 'selected', gender: 'unknown' })
    await patients.getPatientById('selected')
    ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Patient', id: 'selected', gender: 'female' })
    await patients.getPatientById('selected')
    expect(clinical.getClinicalSource('selected').graph.nodes).toHaveLength(1)
    expect(clinical.getClinicalSource('selected').graph.nodes[0].resource.gender).toBe('female')
    ;(fhirClient.request as jest.Mock).mockRejectedValueOnce(new Error('network failure'))
    await expect(patients.getPatientById('selected')).rejects.toThrow('network failure')
    expect(clinical.getClinicalSource('selected').graph.nodes[0].resource.gender).toBe('female')
    client = { state: { serverUrl: 'https://synthetic.example/fhir' }, patient: { id: 'selected' } }
    ;(fhirClient.getClient as jest.Mock).mockResolvedValue(client)
    ;(fhirClient.request as jest.Mock).mockResolvedValue({ resourceType: 'Patient', id: 'selected', gender: 'male' })
    await patients.getPatientById('selected')
    expect(clinical.getClinicalSource('selected').graph.nodes).toHaveLength(1)
    expect(clinical.getClinicalSource('selected').graph.nodes[0].resource.gender).toBe('male')
  })

  it('rejects an in-flight response after the authenticated client changes', async () => {
    const replacement = { state: { serverUrl: 'https://synthetic.example/fhir' } }
    ;(fhirClient.getClient as jest.Mock).mockResolvedValueOnce(client).mockResolvedValue(replacement)
    ;(fhirClient.request as jest.Mock).mockResolvedValue({ resourceType: 'Patient', id: 'selected' })
    await expect(new FhirPatientRepository().getPatientById('selected')).rejects.toThrow('FHIR session changed')
    expect(PatientMapper.toDomain).not.toHaveBeenCalled()
  })
})

it('isolates a changed server base on the same client object', async () => {
  jest.resetAllMocks()
  const client = { state: { serverUrl: 'https://one.example/fhir' }, patient: { id: 'same' } }
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(client)
  ;(PatientMapper.toDomain as jest.Mock).mockImplementation(resource => resource)
  const patients = new FhirPatientRepository()
  const { FhirClinicalDataRepository } = jest.requireActual('@/src/infrastructure/fhir/repositories/clinical-data.repository')
  const clinical = new FhirClinicalDataRepository()
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Patient', id: 'same', gender: 'female' })
  await patients.getPatientById('same')
  const firstSource = clinical.getClinicalSource('same').graph.nodes[0].sourceId
  client.state.serverUrl = 'https://two.example/fhir'
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Patient', id: 'same', gender: 'male' })
  await patients.getPatientById('same')
  const nodes = clinical.getClinicalSource('same').graph.nodes
  expect(nodes).toHaveLength(1)
  expect(nodes[0].sourceId).not.toEqual(firstSource)
  expect(nodes[0].resource.gender).toBe('male')
})

it('clears the previous Patient-search snapshot on a successful empty refresh', async () => {
  jest.resetAllMocks()
  const client = { state: { serverUrl: 'https://empty-refresh.example/fhir' } }
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(client)
  ;(PatientMapper.fromBundle as jest.Mock).mockReturnValue(null)
  const patients = new FhirPatientRepository()
  const { FhirClinicalDataRepository } = jest.requireActual('@/src/infrastructure/fhir/repositories/clinical-data.repository')
  const clinical = new FhirClinicalDataRepository()
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'previous' } }] })
  await patients.getCurrentPatient()
  expect(clinical.getClinicalSource('previous').graph.nodes).toHaveLength(1)
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Bundle', entry: [] })
  await patients.getCurrentPatient()
  expect(clinical.getClinicalSource('previous').graph.nodes).toEqual([])
})

it('replaces the old Patient-search selection instead of retaining its patient graph', async () => {
  jest.resetAllMocks()
  const client = { state: { serverUrl: 'https://selection.example/fhir' } }
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(client)
  ;(PatientMapper.fromBundle as jest.Mock).mockImplementation(bundle => ({ id: bundle.entry[0].resource.id }))
  const patients = new FhirPatientRepository()
  const { FhirClinicalDataRepository } = jest.requireActual('@/src/infrastructure/fhir/repositories/clinical-data.repository')
  const clinical = new FhirClinicalDataRepository()
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'first' } }, { resource: { resourceType: 'Patient', id: 'second' } }] })
  expect(await patients.getCurrentPatient()).toEqual({ id: 'first' })
  ;(fhirClient.request as jest.Mock).mockResolvedValueOnce({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: 'second' } }, { resource: { resourceType: 'Patient', id: 'first' } }] })
  expect(await patients.getCurrentPatient()).toEqual({ id: 'second' })
  expect(clinical.getClinicalSource('first').graph.nodes).toEqual([])
  expect(clinical.getClinicalSource('second').graph.nodes.map((node: any) => node.resource.id)).toEqual(['second'])
})
