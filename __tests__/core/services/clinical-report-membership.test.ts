import { attachReportObservations } from '@/src/core/services/clinical-report-membership'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'

it('attaches an exact record once despite duplicate transmissions and result aliases', () => {
  const observation = { resourceType: 'Observation', id: 'o', meta: { versionId: '2' }, valueQuantity: { value: 7 } }
  const report = { resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/o' }, { reference: 'Observation/o/_history/2' }] }
  const scope = { sourceId: 'server', patientScope: 'p', restBase: 'https://one.invalid/fhir' }
  const source = reconcileClinicalSources([
    { ...scope, generation: 'one', resources: [{ resource: report, fullUrl: 'https://one.invalid/fhir/DiagnosticReport/r' }, { resource: observation, fullUrl: 'https://one.invalid/fhir/Observation/o' }] },
    { ...scope, generation: 'two', resources: [{ resource: observation, fullUrl: 'https://one.invalid/fhir/Observation/o' }] },
  ])
  const row: any = { ...observation, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === 'o' && node.generation === 'two')!.key }
  const reportRow: any = { ...report, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === 'r')!.key }
  const result = attachReportObservations([reportRow], [row], source)
  expect(result[0]._observations).toEqual([row])
  expect(result[0]._observations![0]).toBe(row)
})
