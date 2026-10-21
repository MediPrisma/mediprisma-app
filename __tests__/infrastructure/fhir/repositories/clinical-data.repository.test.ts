// Unit Tests: Clinical Data Repository
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'
import { readClinicalSource } from '@/src/infrastructure/fhir/services/clinical-source-session'

// Mock the dependencies
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')
jest.mock('@/src/infrastructure/fhir/mappers/fhir.mapper')

describe('FhirClinicalDataRepository', () => {
  let repository: FhirClinicalDataRepository
  let mockFhirClient: jest.Mocked<typeof fhirClient>
  let mockMapper: jest.Mocked<typeof FhirMapper>

  beforeEach(() => {
    mockFhirClient = fhirClient as jest.Mocked<typeof fhirClient>
    mockMapper = FhirMapper as jest.Mocked<typeof FhirMapper>
    repository = new FhirClinicalDataRepository()
    jest.clearAllMocks()
    mockFhirClient.getClient.mockResolvedValue(undefined as any)
  })

  describe('fetchAllClinicalData', () => {
    it('projects Patient/a query observations only when an explicit subject does not name another patient', async () => {
      const client = { state: { serverUrl: 'https://ehr.example/fhir' } }
      mockFhirClient.getClient.mockResolvedValue(client as any)
      mockFhirClient.requestAllPages.mockResolvedValue({ entry: [
        { fullUrl: 'urn:uuid:patient-a', resource: { resourceType: 'Patient', id: 'a' } },
        { fullUrl: 'urn:uuid:patient-b', resource: { resourceType: 'Patient', id: 'b' } },
        { resource: { resourceType: 'Observation', id: 'foreign', status: 'final', subject: { reference: 'Patient/b' }, valueInteger: 1 } },
        { resource: { resourceType: 'Observation', id: 'urn-foreign', status: 'final', subject: { reference: 'urn:uuid:patient-b' }, valueInteger: 4 } },
        { resource: { resourceType: 'Observation', id: 'urn-matching', status: 'final', subject: { reference: 'urn:uuid:patient-a' }, valueInteger: 5 } },
        { resource: { resourceType: 'Observation', id: 'matching', status: 'final', subject: { reference: 'Patient/a' }, valueInteger: 2 } },
        { resource: { resourceType: 'Observation', id: 'missing-subject', status: 'final', valueInteger: 3 } },
      ] })
      mockMapper.toObservation.mockImplementation((resource: any) => ({ ...resource }))

      const observations = await repository.fetchObservations('a')

      expect(observations.map(row => row.sourceId)).toEqual(['urn-matching', 'matching', 'missing-subject'])
      const source = readClinicalSource((repository as any).session, 'a')
      expect(source.graph.nodes.map(node => node.resource.id)).toEqual(['a', 'b', 'foreign', 'urn-foreign', 'urn-matching', 'matching', 'missing-subject'])
    })

    it('should fetch all clinical data types', async () => {
      // Mock all fetch methods
      const mockCondition = { id: 'cond-1', code: { text: 'Diabetes' } }
      const mockMedication = { id: 'med-1', medicationCodeableConcept: { text: 'Metformin' }, status: 'active', intent: 'order' }
      const mockAllergy = { id: 'allergy-1', code: { text: 'Penicillin' } }
      // Carries the vital-signs category because vitalSigns is now derived from
      // the Observation result rather than fetched by a second search.
      const mockObservation = {
        id: 'obs-1',
        code: { text: 'Glucose' },
        status: 'final',
        category: [{ coding: [{ code: 'vital-signs' }] }],
      }
      const mockReport = { id: 'report-1', code: { text: 'CBC' }, status: 'final' }
      const mockImagingStudy = { id: 'study-1', description: 'Chest CT', status: 'available' }
      const mockProcedure = { id: 'proc-1', code: { text: 'Surgery' }, status: 'completed' }
      const mockEncounter = { id: 'enc-1', status: 'finished' }

      mockFhirClient.requestAllPages.mockImplementation((url: string) => {
        if (url.startsWith('Condition')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('MedicationRequest')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('AllergyIntolerance')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('Observation') && url.includes('vital-signs')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('Observation') && !url.includes('vital-signs')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('DiagnosticReport')) return Promise.resolve({ entry: [{ resource: { resourceType: 'DiagnosticReport' } }] })
        if (url.startsWith('ImagingStudy')) return Promise.resolve({ entry: [{ resource: { resourceType: 'ImagingStudy' } }] })
        if (url.startsWith('Procedure')) return Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] })
        if (url.startsWith('Encounter')) return Promise.resolve({ entry: [{ resource: { resourceType: 'Encounter' } }] })
        if (url.startsWith('DocumentReference')) return Promise.resolve({ entry: [] })
        if (url.startsWith('Composition')) return Promise.resolve({ entry: [] })
        return Promise.resolve({ entry: [] })
      })

      mockMapper.toCondition.mockReturnValue(mockCondition)
      mockMapper.toMedication.mockReturnValue(mockMedication)
      mockMapper.toAllergy.mockReturnValue(mockAllergy)
      mockMapper.toObservation.mockReturnValue(mockObservation)
      mockMapper.toDiagnosticReport.mockReturnValue(mockReport)
      mockMapper.toImagingStudy.mockReturnValue(mockImagingStudy)
      mockMapper.toProcedure.mockReturnValue(mockProcedure)
      mockMapper.toEncounter.mockReturnValue(mockEncounter)

      const result = await repository.fetchAllClinicalData('patient-123')

      expect(result.conditions).toHaveLength(1)
      expect(result.medications).toHaveLength(1)
      expect(result.allergies).toHaveLength(1)
      expect(result.observations).toHaveLength(1)
      expect(result.vitalSigns).toHaveLength(1)
      expect(result.diagnosticReports).toHaveLength(1)
      expect(result.imagingStudies).toHaveLength(1)
      expect(result.procedures).toHaveLength(1)
      expect(result.encounters).toHaveLength(1)
    })

    // Regression: vitals used to be a second `category=vital-signs` search that
    // re-downloaded rows the unfiltered Observation search had already
    // returned. They are filtered out of that result instead.
    it('derives vital signs from the Observation result without a second search', async () => {
      mockFhirClient.requestAllPages.mockImplementation((url: string) => Promise.resolve({ entry: [{ resource: { resourceType: url.split('?')[0] } }] }))
      mockMapper.toObservation.mockReturnValue({
        id: 'vital-1',
        status: 'final',
        category: [{ coding: [{ code: 'vital-signs' }] }],
      })

      const result = await repository.fetchAllClinicalData('patient-123')

      expect(result.vitalSigns).toEqual(result.observations)
      expect(mockFhirClient.requestAllPages).not.toHaveBeenCalledWith(
        expect.stringContaining('category=vital-signs'),
      )
      expect(result.resourceQueryStatus?.['Observation:vital-signs']).toMatchObject({
        resourceType: 'Observation',
        state: 'ok',
        count: 1,
      })
    })

    it('reports a failed Observation search under the vital-signs key too', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockImplementation((url: string) => {
        if (url.startsWith('Observation')) {
          return Promise.reject({ status: 403, message: 'Forbidden' })
        }
        return Promise.resolve({ entry: [] })
      })

      const result = await repository.fetchAllClinicalData('patient-123')

      // A refused search must not read as "no vitals recorded".
      expect(result.vitalSigns).toEqual([])
      expect(result.resourceQueryStatus?.['Observation:vital-signs']).toMatchObject({
        resourceType: 'Observation',
        state: 'forbidden',
        httpStatus: 403,
      })
      consoleErrorSpy.mockRestore()
    })

    it('should handle empty responses', async () => {
      mockFhirClient.requestAllPages.mockResolvedValue({ entry: [] })

      const result = await repository.fetchAllClinicalData('patient-123')

      expect(result.conditions).toHaveLength(0)
      expect(result.medications).toHaveLength(0)
      expect(result.allergies).toHaveLength(0)
      expect(result.resourceQueryStatus?.Condition).toMatchObject({ state: 'empty', count: 0 })
      expect(result.resourceQueryStatus?.MedicationStatement).toMatchObject({ state: 'empty', count: 0 })
    })

    it('distinguishes a forbidden resource search from an empty result', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockImplementation((url: string) => {
        if (url.startsWith('AllergyIntolerance')) {
          return Promise.reject({ status: 403, message: 'Forbidden' })
        }
        return Promise.resolve({ entry: [] })
      })

      const result = await repository.fetchAllClinicalData('patient-123')

      expect(result.allergies).toEqual([])
      expect(result.resourceQueryStatus?.AllergyIntolerance).toMatchObject({
        resourceType: 'AllergyIntolerance',
        state: 'forbidden',
        httpStatus: 403,
      })
      consoleErrorSpy.mockRestore()
    })
  })

  describe('fetchConditions', () => {
    it('should fetch conditions successfully', async () => {
      const mockResponse = {
        entry: [
          { resource: { resourceType: 'Condition', id: 'cond-1', code: { text: 'Diabetes' } } },
          { resource: { resourceType: 'Condition', id: 'cond-2', code: { text: 'Hypertension' } } }
        ]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toCondition.mockImplementation((r: any) => ({ id: r.id, code: r.code }))

      const result = await repository.fetchConditions('patient-123')

      expect(result).toHaveLength(2)
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledWith(
        expect.stringContaining('Condition?patient=patient-123')
      )
    })

    it('should fallback when sort fails', async () => {
      const mockResponse = { entry: [{ resource: { resourceType: 'Condition', id: 'cond-1' } }] }
      mockFhirClient.requestAllPages
        .mockRejectedValueOnce(new Error('Sort not supported'))
        .mockResolvedValueOnce(mockResponse)
      mockMapper.toCondition.mockReturnValue({ id: 'cond-1', code: { text: 'Test' } })

      const result = await repository.fetchConditions('patient-123')

      expect(result).toHaveLength(1)
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledTimes(2)
    })

    it('should return empty array on complete failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('Network error'))

      const result = await repository.fetchConditions('patient-123')

      expect(result).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('should handle missing entry field', async () => {
      mockFhirClient.requestAllPages.mockResolvedValue({})

      const result = await repository.fetchConditions('patient-123')

      expect(result).toEqual([])
    })
  })

  describe('fetchMedications', () => {
    it('should fetch medications successfully', async () => {
      const mockResponse = {
        entry: [{ resource: { resourceType: 'MedicationRequest', id: 'med-1', medicationCodeableConcept: { text: 'Aspirin' } } }]
      }
      mockFhirClient.requestAllPages.mockImplementation((url: string) =>
        Promise.resolve(url.startsWith('MedicationStatement') ? { entry: [] } : mockResponse),
      )
      mockMapper.toMedication.mockReturnValue({ id: 'med-1', medicationCodeableConcept: { text: 'Aspirin' }, status: 'active', intent: 'order' })

      const result = await repository.fetchMedications('patient-123')

      expect(result).toHaveLength(1)
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledWith(
        expect.stringContaining('MedicationRequest?patient=patient-123')
      )
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledWith(
        expect.stringContaining('MedicationStatement?patient=patient-123')
      )
    })

    it('combines statements and resolves included Medication references', async () => {
      mockFhirClient.getClient.mockResolvedValue({ state: { serverUrl: 'https://ehr.example/fhir' } } as any)
      mockFhirClient.requestAllPages.mockImplementation((url: string) => {
        if (url.startsWith('MedicationRequest')) return Promise.resolve({ entry: [] })
        return Promise.resolve({
          entry: [
            {
              resource: {
                resourceType: 'MedicationStatement',
                id: 'statement-1',
                status: 'active',
                medicationReference: { reference: 'Medication/aspirin' },
                effectiveDateTime: '2024-01-01',
              },
            },
            {
              fullUrl: 'https://ehr.example/fhir/Medication/aspirin',
              resource: {
                resourceType: 'Medication',
                id: 'aspirin',
                code: { text: 'Aspirin 100 mg' },
              },
            },
          ],
        })
      })
      mockMapper.toMedication.mockImplementation((resource: any) => ({
        id: resource.id,
        medicationCodeableConcept: resource.medicationCodeableConcept,
        status: resource.status,
        _sourceResourceType: resource._sourceResourceType,
      }))

      const result = await repository.fetchMedications('patient-123')

      expect(result).toEqual([
        expect.objectContaining({
          id: 'statement-1',
          medicationCodeableConcept: { text: 'Aspirin 100 mg' },
          _sourceResourceType: 'MedicationStatement',
        }),
      ])
    })

    it('keeps MedicationRequest results when MedicationStatement is unsupported', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockFhirClient.requestAllPages.mockImplementation((url: string) => {
        if (url.startsWith('MedicationStatement')) return Promise.reject(new Error('not supported'))
        return Promise.resolve({
          entry: [{ resource: { resourceType: 'MedicationRequest', id: 'request-1' } }],
        })
      })
      mockMapper.toMedication.mockReturnValue({
        id: 'request-1',
        _sourceResourceType: 'MedicationRequest',
      })

      const result = await repository.fetchMedications('patient-123')

      expect(result).toHaveLength(1)
      expect(result[0]._sourceResourceType).toBe('MedicationRequest')
      consoleWarnSpy.mockRestore()
    })

    it('should return empty array on error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('Fetch error'))

      const result = await repository.fetchMedications('patient-123')

      expect(result).toEqual([])
      consoleErrorSpy.mockRestore()
    })
  })

  describe('fetchAllergies', () => {
    it('should fetch allergies successfully', async () => {
      const mockResponse = {
        entry: [{ resource: { resourceType: 'AllergyIntolerance', id: 'allergy-1', code: { text: 'Peanuts' } } }]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toAllergy.mockReturnValue({ id: 'allergy-1', code: { text: 'Peanuts' } })

      const result = await repository.fetchAllergies('patient-123')

      expect(result).toHaveLength(1)
    })

    it('should return empty array on error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('Error'))

      const result = await repository.fetchAllergies('patient-123')

      expect(result).toEqual([])
      consoleErrorSpy.mockRestore()
    })
  })

  describe('fetchObservations', () => {
    it('should fetch all observations', async () => {
      const mockResponse = {
        entry: [{ resource: { resourceType: 'Observation', id: 'obs-1', code: { text: 'Glucose' } } }]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toObservation.mockReturnValue({ id: 'obs-1', code: { text: 'Glucose' }, status: 'final' })

      const result = await repository.fetchObservations('patient-123')

      expect(result).toHaveLength(1)
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledWith(
        expect.stringContaining('Observation?patient=patient-123')
      )
    })

    it('should return empty array on error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('Error'))

      const result = await repository.fetchObservations('patient-123')

      expect(result).toEqual([])
      consoleErrorSpy.mockRestore()
    })
  })

  describe('fetchVitalSigns', () => {
    it('filters the unfiltered Observation search instead of searching by category', async () => {
      const mockResponse = {
        entry: [
          { resource: { resourceType: 'Observation', id: 'vital-1' } },
          { resource: { resourceType: 'Observation', id: 'lab-1' } },
        ]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toObservation.mockImplementation((resource: any) => ({
        id: resource.id,
        status: 'final',
        category: resource.id === 'vital-1'
          ? [{ coding: [{ code: 'vital-signs' }] }]
          : [{ coding: [{ code: 'laboratory' }] }],
      }))

      const result = await repository.fetchVitalSigns('patient-123')

      expect(result).toEqual([expect.objectContaining({ sourceId: 'vital-1' })])
      expect(mockFhirClient.requestAllPages).not.toHaveBeenCalledWith(
        expect.stringContaining('category=vital-signs')
      )
    })
  })

  describe('fetchDiagnosticReports', () => {
    it('should fetch diagnostic reports with observations', async () => {
      const mockResponse = {
        entry: [
          { resource: { resourceType: 'DiagnosticReport', id: 'report-1', code: { text: 'CBC' } } },
          { resource: { resourceType: 'Observation', id: 'obs-1', code: { text: 'Hemoglobin' } } }
        ]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toObservation.mockReturnValue({ id: 'obs-1', code: { text: 'Hemoglobin' }, status: 'final' })
      mockMapper.toDiagnosticReport.mockReturnValue({ id: 'report-1', code: { text: 'CBC' }, status: 'final' })

      const result = await repository.fetchDiagnosticReports('patient-123')

      expect(result).toHaveLength(1)
      expect(mockMapper.toDiagnosticReport).toHaveBeenCalled()
    })

    it('should return empty array on error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('Error'))

      const result = await repository.fetchDiagnosticReports('patient-123')

      expect(result).toEqual([])
      consoleErrorSpy.mockRestore()
    })
  })

  describe('fetchImagingStudies', () => {
    it('fetches only ImagingStudy resources and maps metadata', async () => {
      mockFhirClient.requestAllPages.mockResolvedValue({
        entry: [
          { resource: { resourceType: 'ImagingStudy', id: 'study-1', description: 'Chest CT' } },
          { resource: { resourceType: 'Patient', id: 'patient-123' } },
        ],
      })
      mockMapper.toImagingStudy.mockReturnValue({ id: 'study-1', description: 'Chest CT' })

      const result = await repository.fetchImagingStudies('patient-123')

      expect(result).toMatchObject([{ id: 'study-1', description: 'Chest CT' }])
      expect(mockFhirClient.requestAllPages).toHaveBeenCalledWith(
        expect.stringContaining('ImagingStudy?patient=patient-123'),
      )
    })

    it('returns an empty collection when the server does not support ImagingStudy', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockFhirClient.requestAllPages.mockRejectedValue(new Error('not supported'))

      await expect(repository.fetchImagingStudies('patient-123')).resolves.toEqual([])
      consoleWarnSpy.mockRestore()
    })
  })

  describe('fetchProcedures', () => {
    it('should fetch procedures', async () => {
      const mockResponse = {
        entry: [{ resource: { resourceType: 'Procedure', id: 'proc-1', code: { text: 'Surgery' } } }]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toProcedure.mockReturnValue({ id: 'proc-1', code: { text: 'Surgery' }, status: 'completed' })

      const result = await repository.fetchProcedures('patient-123')

      expect(result).toHaveLength(1)
    })
  })

  describe('fetchEncounters', () => {
    it('should fetch encounters', async () => {
      const mockResponse = {
        entry: [{ resource: { resourceType: 'Encounter', id: 'enc-1', status: 'finished' } }]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toEncounter.mockReturnValue({ id: 'enc-1', status: 'finished' })

      const result = await repository.fetchEncounters('patient-123')

      expect(result).toHaveLength(1)
    })

    // Regression: the query uses _include=Encounter:patient / :location, so
    // the response bundle also carries Patient and Location entries — those
    // must NOT be mapped into junk EncounterEntity rows.
    it('ignores _include-d Patient/Location entries in the same bundle', async () => {
      const mockResponse = {
        entry: [
          { resource: { resourceType: 'Patient', id: 'patient-123' } },
          { resource: { resourceType: 'Encounter', id: 'enc-1', status: 'finished' } },
          { resource: { resourceType: 'Location', id: 'loc-1' } },
        ]
      }
      mockFhirClient.requestAllPages.mockResolvedValue(mockResponse)
      mockMapper.toEncounter.mockImplementation((r: any) => ({ id: r.id, status: r.status }))

      const result = await repository.fetchEncounters('patient-123')

      expect(result).toMatchObject([{ id: 'enc-1', status: 'finished' }])
      expect(mockMapper.toEncounter).toHaveBeenCalledTimes(1)
    })
  })
})

describe('repository source intake', () => {
  it('captures unknown included resources before mapping and isolates patient snapshots', async () => {
    const repo = new FhirClinicalDataRepository()
    const request = fhirClient.requestAllPages as jest.Mock
    request.mockResolvedValueOnce({ entry: [
      { fullUrl: 'urn:uuid:unknown', resource: { resourceType: 'UnknownClinicalType', id: 'unknown', extension: [{ url: 'synthetic', valueString: 'preserved' }] } },
      { resource: { resourceType: 'Observation', id: 'obs' } },
    ] })
    ;(FhirMapper.toObservation as jest.Mock).mockReturnValue({ id: 'obs' })
    expect(await repo.fetchObservations('synthetic')).toMatchObject([{ sourceId: 'obs' }])
    const source = repo.getClinicalSource('synthetic')
    expect(source.graph.nodes).toHaveLength(2)
    expect(source.graph.nodes.find(node => node.resource.id === 'unknown')?.resource.extension).toEqual([{ url: 'synthetic', valueString: 'preserved' }])
    expect(repo.getClinicalSource('other').graph.nodes).toEqual([])
    request.mockResolvedValueOnce({ entry: [] })
    await repo.fetchObservations('synthetic')
    expect(repo.getClinicalSource('synthetic').graph.nodes).toHaveLength(0)
  })
})

it('maps only the current successful refresh while replacing its active source capture', async () => {
  const repo = new FhirClinicalDataRepository()
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id, valueString: resource.valueString }))
  const observation = (id: string, valueString = 'first') => ({ resource: { resourceType: 'Observation', id, valueString } })
  request.mockResolvedValueOnce({ entry: [observation('a'), observation('b')] })
  expect(await repo.fetchObservations('refresh')).toHaveLength(2)
  request.mockResolvedValueOnce({ entry: [observation('a', 'revised')] })
  expect(await repo.fetchObservations('refresh')).toMatchObject([{ sourceId: 'a', valueString: 'revised' }])
  request.mockResolvedValueOnce({ entry: [] })
  expect(await repo.fetchObservations('refresh')).toEqual([])
  expect(repo.getClinicalSource('refresh').graph.nodes).toHaveLength(0)
})

it('retains prior successful rows on a failed refresh while reporting the failure', async () => {
  const repo = new FhirClinicalDataRepository()
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  request.mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Observation', id: 'retained' } }] })
  expect(await repo.fetchObservations('retention')).toMatchObject([{ sourceId: 'retained' }])
  request.mockRejectedValueOnce(new Error('network unavailable'))
  expect(await repo.fetchObservations('retention')).toMatchObject([{ sourceId: 'retained' }])
  expect(repo.getQueryStatus('Observation')?.state).toBe('error')
  request.mockRejectedValueOnce(new Error('network unavailable'))
  expect(await repo.fetchObservations('different-patient')).toEqual([])
})

describe('medication graph resolution at intake', () => {
  it.each([
    ['https://foreign.example/fhir/Medication/same', [{ fullUrl: 'https://local.example/fhir/Medication/same', resource: { resourceType: 'Medication', id: 'same', code: { text: 'wrong host' } } }]],
    ['Medication/same/_history/2', [{ resource: { resourceType: 'Medication', id: 'same', meta: { versionId: '1' }, code: { text: 'wrong version' } } }]],
    ['Medication/same', [{ resource: { resourceType: 'Medication', id: 'same', code: { text: 'first' } } }, { resource: { resourceType: 'Medication', id: 'same', code: { text: 'second' } } }]],
  ])('does not promote unresolved or ambiguous reference %s', async (reference, included) => {
    const repo = new FhirClinicalDataRepository()
    ;(fhirClient.requestAllPages as jest.Mock).mockImplementation((url: string) => Promise.resolve({ entry: url.startsWith('MedicationRequest') ? [
      { resource: { resourceType: 'MedicationRequest', id: 'order', medicationReference: { reference } } }, ...included,
    ] : [] }))
    ;(FhirMapper.toMedication as jest.Mock).mockImplementation((resource: any) => resource)
    const result = await repo.fetchMedications('synthetic-medication')
    expect(result).toHaveLength(1)
    expect(result[0].medicationCodeableConcept).toBeUndefined()
  })
})

it('replaces only the refreshed query active graph and preserves another resource type', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(FhirMapper.toCondition as jest.Mock).mockImplementation((resource: any) => resource)
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation((resource: any) => resource)
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'condition' } }] })
  await repo.fetchConditions('active-scope')
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Observation', id: 'lab' } }] })
  await repo.fetchObservations('active-scope')
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValueOnce({ entry: [] })
  await repo.fetchObservations('active-scope')
  expect(repo.getClinicalSource('active-scope').graph.nodes.map(node => node.resource.id)).toEqual(['condition'])
})

it.each(['https://local.example/fhir/Medication/exact', 'Medication/exact/_history/2'])('promotes an unambiguous graph-verified medication reference %s', async reference => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://local.example/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation((url: string) => Promise.resolve({ entry: url.startsWith('MedicationRequest') ? [
    { resource: { resourceType: 'MedicationRequest', id: 'order', medicationReference: { reference } } },
    { fullUrl: 'https://local.example/fhir/Medication/exact', resource: { resourceType: 'Medication', id: 'exact', meta: { versionId: '2' }, code: { text: 'verified code' } } },
  ] : [] }))
  ;(FhirMapper.toMedication as jest.Mock).mockImplementation((resource: any) => resource)
  expect((await repo.fetchMedications('exact-medication'))[0].medicationCodeableConcept).toEqual({ text: 'verified code' })
})

it.each([
  ['https://reports.example/fhir/Observation/panel', 'https://reports.example/fhir/Observation/member'],
  ['urn:uuid:panel', 'urn:uuid:member'],
  ['Observation/panel/_history/2', 'Observation/member/_history/3'],
])('attaches graph-resolved report members for %s', async (panelReference, memberReference) => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://reports.example/fhir' } })
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [
    { resource: { resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: panelReference }] } },
    { fullUrl: panelReference.startsWith('urn:') ? panelReference : 'https://reports.example/fhir/Observation/panel', resource: { resourceType: 'Observation', id: 'panel', meta: { versionId: '2' }, hasMember: [{ reference: memberReference }] } },
    { fullUrl: memberReference.startsWith('urn:') ? memberReference : 'https://reports.example/fhir/Observation/member', resource: { resourceType: 'Observation', id: 'member', meta: { versionId: '3' }, valueString: 'synthetic' } },
  ] })
  ;(FhirMapper.toDiagnosticReport as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  expect((await repo.fetchDiagnosticReports('report-synthetic'))[0]._observations?.map(observation => observation.sourceId)).toEqual(['panel', 'member'])
})

it('does not attach a foreign report reference through a colliding observation id', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [
    { resource: { resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: 'https://foreign.example/fhir/Observation/collision' }] } },
    { fullUrl: 'https://local.example/fhir/Observation/collision', resource: { resourceType: 'Observation', id: 'collision' } },
  ] })
  ;(FhirMapper.toDiagnosticReport as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  expect((await repo.fetchDiagnosticReports('report-synthetic'))[0]._observations).toBeUndefined()
})

it('shares one active logical slot across optional-query fallback and later primary refresh', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toCondition as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  request.mockRejectedValueOnce(new Error('Sort not supported')).mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'old-fallback' } }] })
  expect(await repo.fetchConditions('logical-slot')).toMatchObject([{ id: 'old-fallback' }])
  expect(repo.getClinicalSource('logical-slot').graph.nodes).toHaveLength(1)
  request.mockResolvedValueOnce({ entry: [] })
  expect(await repo.fetchConditions('logical-slot')).toEqual([])
  expect(repo.getClinicalSource('logical-slot').graph.nodes).toEqual([])
  request.mockRejectedValueOnce(new Error('network unavailable'))
  expect(await repo.fetchConditions('logical-slot')).toEqual([])
  expect(repo.getClinicalSource('logical-slot').graph.nodes).toEqual([])
})

it('still retries an unsupported optional query after a previous success', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toCondition as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  request.mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'old' } }] })
  await repo.fetchConditions('optional-refresh')
  request.mockRejectedValueOnce(new Error('Sort not supported')).mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'updated' } }] })
  expect(await repo.fetchConditions('optional-refresh')).toMatchObject([{ id: 'updated' }])
  expect(request).toHaveBeenCalledTimes(3)
  expect(repo.getQueryStatus('Condition')?.state).toBe('ok')
})

it.each([401, 403])('does not retain clinical rows after HTTP %s', async status => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toCondition as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  request.mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'old' } }] })
  await repo.fetchConditions('auth-refresh')
  request.mockRejectedValueOnce(Object.assign(new Error('access denied'), { status }))
  expect(await repo.fetchConditions('auth-refresh')).toEqual([])
  expect(repo.getQueryStatus('Condition')?.state).toBe(status === 401 ? 'unauthorized' : 'forbidden')
  expect(repo.getClinicalSource('auth-refresh').graph.nodes).toEqual([])
  request.mockRejectedValueOnce(new Error('network unavailable'))
  expect(await repo.fetchConditions('auth-refresh')).toEqual([])
})

it('does not retain another authenticated session response on failure', async () => {
  const repo = new FhirClinicalDataRepository()
  let client = { state: { serverUrl: 'https://session.example/fhir' } }
  ;(fhirClient.getClient as jest.Mock).mockImplementation(async () => client)
  const request = fhirClient.requestAllPages as jest.Mock
  request.mockReset()
  ;(FhirMapper.toCondition as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  request.mockResolvedValueOnce({ entry: [{ resource: { resourceType: 'Condition', id: 'old-session' } }] })
  await repo.fetchConditions('same-patient')
  client = { state: { serverUrl: 'https://session.example/fhir' } }
  request.mockRejectedValueOnce(new Error('network unavailable'))
  expect(await repo.fetchConditions('same-patient')).toEqual([])
  expect(repo.getClinicalSource('same-patient').graph.nodes).toEqual([])
})

it('returns mutable mapped nested arrays without mutating immutable source graph', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [{ resource: {
    resourceType: 'Observation', id: 'mutable-view', status: 'final', category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'synthetic' },
  } }] })
  const realMapper = jest.requireActual('@/src/infrastructure/fhir/mappers/fhir.mapper').FhirMapper
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation(realMapper.toObservation)
  const rows = await repo.fetchObservations('mutable-patient')
  expect(() => rows[0].category?.[0].coding?.push({ code: 'view-only' })).not.toThrow()
  const raw = repo.getClinicalSource('mutable-patient').graph.nodes[0].resource as any
  expect(raw.category[0].coding).toEqual([{ code: 'laboratory' }])
  expect(Object.isFrozen(raw.category)).toBe(true)
})

it('keeps enumerable source-node keys on mapped observations and reports', async () => {
  const repo = new FhirClinicalDataRepository()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue(undefined)
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: [{ resource: url.startsWith('Observation')
    ? { resourceType: 'Observation', id: 'keyed-observation' }
    : { resourceType: 'DiagnosticReport', id: 'keyed-report' } }] }))
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  ;(FhirMapper.toDiagnosticReport as jest.Mock).mockImplementation((resource: any) => ({ id: resource.id }))
  const observations = await repo.fetchObservations('node-keys')
  const reports = await repo.fetchDiagnosticReports('node-keys')
  const graph = repo.getClinicalSource('node-keys').graph
  for (const row of [...observations, ...reports]) {
    expect(JSON.parse(JSON.stringify(row)).clinicalSourceNodeKey).toBe(graph.nodes.find(node => node.resource.id === row.sourceId)?.key)
  }
})

it.each(['absolute', 'urn', 'version'])('assembles graph-resolved report membership from separate %s searches', async kind => {
  const repo = new FhirClinicalDataRepository()
  const base = 'https://cross-query.example/fhir'
  const reference = kind === 'urn' ? 'urn:uuid:cross-query' : kind === 'version' ? 'Observation/cross-query/_history/2' : base + '/Observation/cross-query'
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: base } })
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Observation?') ? [
    { fullUrl: kind === 'urn' ? reference : base + '/Observation/cross-query', resource: { resourceType: 'Observation', id: 'cross-query', meta: { versionId: '2' }, status: 'final', code: { text: 'synthetic' } } },
  ] : url.startsWith('DiagnosticReport?') ? [
    { resource: { resourceType: 'DiagnosticReport', id: 'cross-report', status: 'final', code: { text: 'synthetic report' }, result: [{ reference }] } },
  ] : [] }))
  const realMapper = jest.requireActual('@/src/infrastructure/fhir/mappers/fhir.mapper').FhirMapper
  ;(FhirMapper.toObservation as jest.Mock).mockImplementation(realMapper.toObservation)
  ;(FhirMapper.toDiagnosticReport as jest.Mock).mockImplementation(realMapper.toDiagnosticReport)
  const collection = await repo.fetchAllClinicalData('cross-query-patient')
  expect(collection.diagnosticReports[0]._observations?.map(observation => observation.sourceId)).toEqual(['cross-query'])
})
