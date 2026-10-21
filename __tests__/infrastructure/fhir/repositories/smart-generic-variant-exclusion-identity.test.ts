import { excludeUnresolvedGenericVariants } from '@/src/core/utils/clinical-variant-inputs'
import { FhirClinicalDataRepository } from '@/src/infrastructure/fhir/repositories/clinical-data.repository'
import { fhirClient } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { scopeClinicalDataForAi } from '@/src/core/utils/ai-clinical-scope.utils'
import { ALL_DATA_FILTERS, ALL_DATA_SELECTION } from '@/src/shared/constants/data-selection.constants'
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service')

it.each(['revision', 'conflict'])('keeps every actual SMART same-id %s variant in exclusion evidence', async classification => {
  jest.resetAllMocks()
  ;(fhirClient.getClient as jest.Mock).mockResolvedValue({ state: { serverUrl: 'https://synthetic.example/fhir' } })
  const resources = (resourceType: string) => ['one', 'two'].map((value, index) => ({ resource: { resourceType, id: resourceType.toLowerCase(), meta: { versionId: classification === 'revision' ? String(index + 1) : '1' }, status: 'active', code: { text: value }, medicationCodeableConcept: { text: value } } }))
  ;(fhirClient.requestAllPages as jest.Mock).mockImplementation(async (url: string) => ({ entry: url.startsWith('Condition?') ? resources('Condition') : url.startsWith('MedicationRequest?') ? resources('MedicationRequest') : [] }))
  const data = await new FhirClinicalDataRepository().fetchAllClinicalData('synthetic')
  expect(data.conditions).toHaveLength(1)
  expect(data.medications).toHaveLength(1)
  expect(new Set([...data.conditions, ...data.medications].map(row => row.clinicalSourceNodeKey)).size).toBe(2)
  const decision = selectCdssClinicalInputs(data)
  expect(decision.excluded).toHaveLength(0)
  const intermediate = excludeUnresolvedGenericVariants(data)
  expect(excludeUnresolvedGenericVariants(intermediate).clinicalRecordVariantExclusions).toBeUndefined()
  expect(selectCdssClinicalInputs({ ...data, conditions: [...data.conditions, data.conditions[0]] }).excluded).toHaveLength(0)
  const scoped = scopeClinicalDataForAi(data, ALL_DATA_SELECTION, ALL_DATA_FILTERS, [])
  expect(scoped.clinicalRecordVariantExclusions).toBeUndefined()
  expect(scoped.conditions).toHaveLength(1)
  expect(scoped.medications).toHaveLength(1)
  expect(data.clinicalSource!.graph.nodes.filter(node=>node.resource.resourceType==='Condition'||node.resource.resourceType==='MedicationRequest')).toHaveLength(4)
})
