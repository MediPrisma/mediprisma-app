import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
it('does not revive Roche staging observations represented on the diagnosis', () => {
  const collection = LocalBundleService.parse({ resourceType: 'Bundle', entry: [
    { resource: { resourceType: 'Patient', id: 'p' } },
    { resource: { resourceType: 'Condition', id: 'c', code: { coding: [{ system: 'https://dip.roche.com/synthetic', code: 'cancer' }] }, stage: [{ assessment: [{ reference: 'Observation/stage' }] }] } },
    { resource: { resourceType: 'Observation', id: 'stage', valueString: 'II', hasMember: [{ reference: 'Observation/t' }] } },
    { resource: { resourceType: 'Observation', id: 't', valueString: 'T2' } },
    { resource: { resourceType: 'DiagnosticReport', id: 'report', contained: [{ resourceType: 'Observation', id: 'member', valueQuantity: { value: 7 } }], result: [{ reference: '#member' }] } },
  ] })!.collection
  expect(collection.conditions[0]._cancerStage).toContain('Stage II')
  expect(collection.observations.some(row => row.sourceId === 'stage' || row.sourceId === 't')).toBe(false)
  const projected = projectClinicalAggregate(collection)
  expect(projected.observations.some(row => row.sourceId === 'stage' || row.sourceId === 't')).toBe(false)
  expect(projected.diagnosticReports[0]._observations?.map(row => row.valueQuantity?.value)).toEqual([7])
  expect(projected.clinicalSource!.graph.nodes.filter(node => node.resource.resourceType === 'Observation')).toHaveLength(3)
})
