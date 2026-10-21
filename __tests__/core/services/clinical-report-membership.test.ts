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
  const row: any = { ...observation, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === 'o' && node.generation === 'one')!.key }
  const reportRow: any = { ...report, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === 'r')!.key }
  const result = attachReportObservations([reportRow], [row], source)
  expect(result[0]._observations).toEqual([row])
  expect(result[0]._observations![0]).toBe(row)
})

it('does not reattach a superseded included row when the selected row is not yet supplied', () => {
  const includedObservation = { resourceType: 'Observation', id: 'o', status: 'final', valueQuantity: { value: 7 } }
  const report = { resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/o' }] }
  const scope = { sourceId: 'server', patientScope: 'p', restBase: 'https://one.invalid/fhir' }
  const source = reconcileClinicalSources([
    { ...scope, generation: 'report-search', resources: [
      { resource: report, fullUrl: 'https://one.invalid/fhir/DiagnosticReport/r' },
      { resource: includedObservation, fullUrl: 'https://one.invalid/fhir/Observation/o' },
    ] },
    { ...scope, generation: 'observation-search', resources: [
      { resource: { ...includedObservation, valueQuantity: { value: 9 } }, fullUrl: 'https://one.invalid/fhir/Observation/o' },
    ] },
  ])
  const includedKey = source.graph.nodes.find(node => node.resource.resourceType === 'Observation' && node.generation === 'report-search')!.key
  const includedRow: any = { ...includedObservation, clinicalSourceNodeKey: includedKey }
  const reportRow: any = { ...report, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.resourceType === 'DiagnosticReport')!.key }

  const result = attachReportObservations([reportRow], [includedRow], source)
  expect(result[0]._observations).toEqual([])
  const edge = source.graph.references.find(item => item.origin.resource.resourceType === 'DiagnosticReport')!
  expect(edge.status).toBe('resolved')
  expect(edge.targetKeys).toEqual([includedKey])
})

it('does not attach an explicitly foreign-patient Observation included with a report', () => {
  const scope = { sourceId: 'server', patientScope: 'a', restBase: 'https://one.invalid/fhir' }
  const foreign = { resourceType: 'Observation', id: 'foreign', status: 'final', subject: { reference: 'Patient/b' } }
  const report = { resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/foreign' }] }
  const source = reconcileClinicalSources([{ ...scope, generation: 'report-search', resources: [report, foreign] }])
  const foreignNode = source.graph.nodes.find(node => node.resource.id === 'foreign')!
  const reportNode = source.graph.nodes.find(node => node.resource.id === 'r')!
  const row: any = { ...foreign, id: 'foreign-row', clinicalSourceNodeKey: foreignNode.key }
  const reportRow: any = { ...report, clinicalSourceNodeKey: reportNode.key }
  const result = attachReportObservations([reportRow], [row], source, new Map([[foreignNode.key, row]]))
  expect(result[0]._observations).toEqual([])
  expect(source.graph.nodes).toContain(foreignNode)
})
