import { clinicalSourceNodesEqualWithContext } from '@/src/core/services/clinical-source-context'
import { reconcileClinicalSources, selectClinicalSourceNodes } from '@/src/core/services/clinical-reconciliation'
import { createClinicalRecordVariants } from '@/src/core/services/clinical-record-variants'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
const scope = { sourceId: 'ehr', patientScope: 'p', restBase: 'https://ehr.test/fhir' }
it('does not turn exact observation transmissions into a conflict when a Patient support capture refreshes', () => {
  const observation = { resourceType: 'Observation', id: 'o', subject: { reference: 'Patient/p' }, valueQuantity: { value: 7 } }
  const source = reconcileClinicalSources([
    { ...scope, generation: 'report', resources: [{ resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/o' }] }, observation, { resourceType: 'Patient', id: 'p', meta: { versionId: '1' }, name: [{ text: 'Old label' }] }] },
    { ...scope, generation: 'observation', resources: [observation] },
    { ...scope, generation: 'patient-refresh', resources: [{ resourceType: 'Patient', id: 'p', meta: { versionId: '2' }, name: [{ text: 'New label' }] }] },
  ])
  const observationNodes = source.graph.nodes.filter(node => node.resource.resourceType === 'Observation')
  expect(source.graph.references.filter(edge => observationNodes.some(node => node.key === edge.origin.key)).map(edge => edge.status).sort()).toEqual(['ambiguous', 'resolved'])
  expect(selectClinicalSourceNodes(source).filter(node => node.resource.resourceType === 'Observation')).toHaveLength(1)
  const variants = createClinicalRecordVariants(source)
  expect(observationNodes.every(node => !variants.has(node.key))).toBe(true)
  expect(projectClinicalAggregate({ observations: [], clinicalSource: source }).observations).toHaveLength(1)
})

it.each(['patient-id', 'rest-base', 'source', 'patient-scope'])('does not erase distinct patient support identity: %s', difference => {
  const observation = { resourceType: 'Observation', id: 'o', subject: { reference: 'urn:uuid:patient' }, valueQuantity: { value: 7 } }
  const make = (generation: string, changed: boolean) => ({ ...scope, generation,
    ...(changed && difference === 'rest-base' ? { restBase: 'https://other.test/fhir' } : {}),
    ...(changed && difference === 'source' ? { sourceId: 'other' } : {}),
    ...(changed && difference === 'patient-scope' ? { patientScope: 'other' } : {}),
    resources: [observation, { fullUrl: 'urn:uuid:patient', resource: { resourceType: 'Patient', id: changed && difference === 'patient-id' ? 'other' : 'p' } }],
  })
  const source = reconcileClinicalSources([make('a', false), make('b', true)])
  const obs = source.graph.nodes.filter(node => node.resource.resourceType === 'Observation')
  expect(clinicalSourceNodesEqualWithContext(source.graph, obs[0], obs[1])).toBe(false)
})
