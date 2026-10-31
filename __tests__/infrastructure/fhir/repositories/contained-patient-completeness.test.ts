import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'

jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

describe('contained clinical member ownership completeness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://ehr.example/fhir' } })
  })

  it.each(['Patient/other', 'https://other.example/fhir/Patient/p'])('preserves a report but marks dropped contained results incomplete: %s', async reference => {
    ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [{ resource: {
      resourceType: 'DiagnosticReport', id: 'r', status: 'final', subject: { reference: 'Patient/p' },
      result: [{ reference: '#bad' }], contained: [{ resourceType: 'Observation', id: 'bad', status: 'final', subject: { reference }, valueString: 'synthetic' }],
    } }] })
    const repository = new FhirClinicalDataRepository()
    const reports = await repository.fetchDiagnosticReports('p')
    expect(reports).toHaveLength(1)
    expect(reports[0]._observations ?? []).toHaveLength(0)
    expect(repository.getQueryStatus('DiagnosticReport')).toMatchObject({ state: 'error', excludedCount: 1 })
  })

  it('keeps detached contained snapshots from making an otherwise complete report incomplete', async () => {
    ;(fhirClient.requestAllPages as jest.Mock).mockResolvedValue({ entry: [{ resource: {
      resourceType: 'DiagnosticReport', id: 'r', status: 'final',
      contained: [{ resourceType: 'Observation', id: 'unused', subject: { reference: 'Patient/other' } }],
    } }] })
    const repository = new FhirClinicalDataRepository()
    await repository.fetchDiagnosticReports('p')
    expect(repository.getQueryStatus('DiagnosticReport')).toMatchObject({ state: 'ok', count: 1 })
  })
})
