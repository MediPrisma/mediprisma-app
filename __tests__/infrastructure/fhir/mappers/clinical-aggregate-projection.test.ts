import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'

const source = reconcileClinicalSources([{ sourceId: 'synthetic-audit', patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: '#snapshot' }], contained: [{ resourceType: 'Observation', id: 'snapshot', status: 'final', code: { text: 'Synthetic snapshot' }, valueQuantity: { value: 5 } }] }] }])
const ids = createClinicalSourceProjectionIds(source)
const reportNode = source.graph.nodes.find(node => node.resource.resourceType === 'DiagnosticReport')!
const snapshotNode = source.graph.nodes.find(node => node.resource.resourceType === 'Observation')!
const snapshot = { id: ids.get(snapshotNode.key)!, sourceId: 'snapshot', clinicalSourceNodeKey: snapshotNode.key, valueQuantity: { value: 5 } }
const report = { id: ids.get(reportNode.key)!, sourceId: 'report', clinicalSourceNodeKey: reportNode.key, result: [{ reference: '#snapshot' }], _observations: [snapshot] }

it('does not promote a contained audit resource merely because an existing report member points to it', () => {
  const projected = projectClinicalAggregate({ observations: [], diagnosticReports: [report] } as any, source)
  expect(projected.observations).toEqual([])
  expect(projected.diagnosticReports[0]._observations).toEqual([])
  expect(projected.diagnosticReports[0].result[0].reference).toBe('#snapshot')
})

it('retains an explicit existing local contained projection as the one shared member object', () => {
  const projected = projectClinicalAggregate({ observations: [snapshot], diagnosticReports: [report] } as any, source)
  expect(projected.observations).toHaveLength(1)
  expect(projected.diagnosticReports[0]._observations[0]).toBe(projected.observations[0])
  expect(projected.diagnosticReports[0].result[0].reference).toBe('Observation/' + snapshot.id)
})
