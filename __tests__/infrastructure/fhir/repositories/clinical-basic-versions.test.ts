import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM, MEDCLOUD_REMAINING_SUMMARY_CODE, MEDCLOUD_REMAINING_SUMMARY_EXTENSION_URL } from '@/src/shared/constants/medcloud.constants'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it('preserves two SMART Basic source-record versions through fetchAllClinicalData', async () => {
  jest.resetAllMocks()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
  const entries = [7, 9].map((value, index) => ({ resource: { resourceType: 'Basic', id: 'same-summary', meta: { versionId: String(index + 1) }, code: { coding: [{ system: MEDCLOUD_BASIC_RESOURCE_TYPE_SYSTEM, code: MEDCLOUD_REMAINING_SUMMARY_CODE }] }, extension: [{ url: MEDCLOUD_REMAINING_SUMMARY_EXTENSION_URL, extension: [{ url: 'adherenceExpectedRemainingDays', valueQuantity: { value } }] }] } }))
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Basic?') ? [...entries, entries[0]] : [] }))
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic')
  expect(data.medicationRemainingSummaries).toHaveLength(1)
  expect([7,9]).toContain(data.medicationRemainingSummaries[0].adherenceExpectedRemainingDays)
  expect(data.medicationRemainingSummaries[0].clinicalRecordVariant).toBeUndefined()
  expect(new Set(data.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Basic').map(node => (node.resource.meta as any).versionId))).toEqual(new Set(['1', '2']))
})
