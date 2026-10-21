import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { createClinicalSourceProjectionIds } from '@/src/core/services/clinical-source-projection'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'

it('retains identical observations when their resolved encounter contexts differ', () => {
  const captures = ['1', '2'].map(version => ({ sourceId: 'ehr', patientScope: 'patient', restBase: 'https://ehr.invalid/fhir', generation: version, resources: [
    { resourceType: 'Encounter', id: 'visit', meta: { versionId: version }, status: version === '1' ? 'in-progress' : 'finished' },
    { resourceType: 'Observation', id: 'value', status: 'final', encounter: { reference: 'Encounter/visit' }, valueInteger: 7 },
    { resourceType: 'DiagnosticReport', id: `report-${version}`, result: [{ reference: 'Observation/value' }] },
  ] }))
  const source = reconcileClinicalSources(captures)
  const repeatedSource = reconcileClinicalSources([...captures, { ...captures[0], generation: 'copy' }])
  const repeatedIds = createClinicalSourceProjectionIds(repeatedSource)
  expect(new Set(repeatedSource.graph.nodes.filter(node => node.resource.resourceType === 'Observation').map(node => repeatedIds.get(node.key))).size).toBe(2)
  const reports = source.graph.nodes.filter(node => node.resource.resourceType === 'DiagnosticReport').map(node => ({ id: node.resource.id, clinicalSourceNodeKey: node.key, result: [{ reference: 'Observation/value' }] }))
  const projected = projectClinicalAggregate({ observations: [], diagnosticReports: reports } as any, source)
  expect(projected.observations).toHaveLength(2)
  expect(new Set(projected.observations.map((row: any) => row.id)).size).toBe(2)
  for (const report of projected.diagnosticReports) {
    const member = report._observations[0]
    expect(projected.observations).toContain(member)
    expect(report.result[0].reference).toBe(`Observation/${member.id}`)
    const origin = source.graph.nodes.find(node => node.key === report.clinicalSourceNodeKey)!
    const target = source.graph.references.find(edge => edge.origin.key === origin.key && edge.path === 'result[0]')!
    expect(target.targetKeys).toContain(member.clinicalSourceNodeKey)
    expect(member.clinicalRecordVariant?.variantCount).toBe(2)
  }
  expect(projected.diagnosticReports[0]._observations[0]).not.toBe(projected.diagnosticReports[1]._observations[0])
})

const source = reconcileClinicalSources([{ sourceId: 'synthetic-audit', patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: '#snapshot' }], contained: [{ resourceType: 'Observation', id: 'snapshot', status: 'final', code: { text: 'Synthetic snapshot' }, valueQuantity: { value: 5 } }] }] }])
const ids = createClinicalSourceProjectionIds(source)
const reportNode = source.graph.nodes.find(node => node.resource.resourceType === 'DiagnosticReport')!
const snapshotNode = source.graph.nodes.find(node => node.resource.resourceType === 'Observation')!
const snapshot = { id: ids.get(snapshotNode.key)!, sourceId: 'snapshot', clinicalSourceNodeKey: snapshotNode.key, valueQuantity: { value: 5 } }
const report = { id: ids.get(reportNode.key)!, sourceId: 'report', clinicalSourceNodeKey: reportNode.key, result: [{ reference: '#snapshot' }], _observations: [snapshot] }

it('does not promote a contained audit resource merely because an existing report member points to it', () => {
  const auditSource = reconcileClinicalSources([{ sourceId: 'audit', patientScope: 'synthetic', generation: '1', resources: [
    { resourceType: 'Provenance', id: 'audit', contained: [{ resourceType: 'Observation', id: 'snapshot', valueQuantity: { value: 5 } }] },
    { resourceType: 'DiagnosticReport', id: 'report', result: [{ reference: '#snapshot' }] },
  ] }])
  const auditReport = auditSource.graph.nodes.find(node => node.resource.resourceType === 'DiagnosticReport')!
  const auditObservation = auditSource.graph.nodes.find(node => node.resource.resourceType === 'Observation')!
  const projected = projectClinicalAggregate({ observations: [], diagnosticReports: [{ ...report, clinicalSourceNodeKey: auditReport.key, _observations: [{ ...snapshot, clinicalSourceNodeKey: auditObservation.key }] }] } as any, auditSource)
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

it('drops every source-bound cached resource when the same patient moves to a new authenticated source', () => {
  const fields = ['conditions', 'medications', 'medicationRemainingSummaries', 'allergies', 'observations', 'diagnosticReports', 'imagingStudies', 'procedures', 'encounters', 'documentReferences', 'compositions', 'immunizations', 'consents', 'devices', 'carePlans', 'vitalSigns']
  const input = Object.fromEntries(fields.map(field => [field, [{ id: 'old', clinicalSourceNodeKey: reportNode.key }]]))
  const nextSource = reconcileClinicalSources([{ sourceId: 'new-authenticated-client', patientScope: 'synthetic', generation: '1', resources: [{ resourceType: 'Patient', id: 'synthetic' }] }])
  const projected = projectClinicalAggregate(input as any, nextSource)
  for (const field of fields) expect(projected[field]).toEqual([])
  const empty = projectClinicalAggregate(input as any, reconcileClinicalSources([]))
  for (const field of fields) expect(empty[field]).toEqual([])
})

it('projects identical panels in different capture contexts to their own leaf and shared collection members', () => {
  const source = reconcileClinicalSources([...([7, 9].map((value, index) => ({ sourceId: 'same-source', patientScope: 'patient', generation: String(index), resources: [
    { resourceType: 'Observation', id: 'leaf', status: 'final', code: { text: 'Leaf' }, valueQuantity: { value } },
    { resourceType: 'Observation', id: 'panel', status: 'final', code: { text: 'Panel' }, hasMember: [{ reference: 'Observation/leaf' }] },
    { resourceType: 'DiagnosticReport', id: 'same-report', status: 'final', code: { text: 'Report' }, result: [{ reference: 'Observation/panel' }] },
  ] }))), { sourceId: 'same-source', patientScope: 'patient', generation: 'third', resources: [{ resourceType: 'DiagnosticReport', id: 'outside-report', status: 'final', code: { text: 'Outside' }, result: [{ reference: 'Observation/panel' }] }] }])
  const ids = createClinicalSourceProjectionIds(source)
  const reports = source.graph.nodes.filter(node => node.resource.resourceType === 'DiagnosticReport').map(node => ({ id: ids.get(node.key)!, clinicalSourceNodeKey: node.key, result: [{ reference: 'Observation/panel' }] }))
  const projected = projectClinicalAggregate({ observations: [], diagnosticReports: reports } as any, source)
  const panels = projected.observations.filter((row: any) => row.sourceId === 'panel')
  expect(panels).toHaveLength(2)
  expect(new Set(panels.map((row: any) => row.id)).size).toBe(2)
  const contextReports = projected.diagnosticReports.filter((row: any) => row.clinicalSourceNodeKey !== source.graph.nodes.find(node => node.resource.id === 'outside-report')!.key)
  const outside = projected.diagnosticReports.find((row: any) => row.clinicalSourceNodeKey === source.graph.nodes.find(node => node.resource.id === 'outside-report')!.key)
  expect(outside._observations).toEqual([])
  expect(outside.result[0].reference).toBe('Observation/panel')
  for (const report of contextReports) {
    const panel = report._observations.find((row: any) => row.sourceId === 'panel')
    const leaf = report._observations.find((row: any) => row.sourceId === 'leaf')
    expect(panel.hasMember[0].reference).toBe('Observation/' + leaf.id)
    expect(report.result[0].reference).toBe('Observation/' + panel.id)
    for (const member of report._observations) expect(projected.observations).toContain(member)
    expect(projected.observations.find((row: any) => row.id === panel.id)).toBe(panel)
    expect(projected.observations.find((row: any) => row.id === leaf.id)).toBe(leaf)
  }
  expect(contextReports.map((report: any) => report._observations.find((row: any) => row.sourceId === 'leaf').valueQuantity.value)).toEqual([7, 9])
})

it('does not restore source-present foreign-patient cached rows or report members', () => {
  const source = reconcileClinicalSources([{ sourceId: 'scope', patientScope: 'a', generation: '1', resources: [
    { resourceType: 'Observation', id: 'foreign', subject: { reference: 'Patient/b' }, valueQuantity: { value: 7 } },
    { resourceType: 'Condition', id: 'foreign-condition', subject: { reference: 'Patient/b' } },
    { resourceType: 'MedicationRequest', id: 'foreign-medication', subject: { reference: 'Patient/b' } },
    { resourceType: 'DiagnosticReport', id: 'foreign-report', subject: { reference: 'Patient/b' } },
    { resourceType: 'DiagnosticReport', id: 'own-report', subject: { reference: 'Patient/a' }, result: [{ reference: 'Observation/foreign' }] },
  ] }])
  const row = (id: string) => ({ id, clinicalSourceNodeKey: source.graph.nodes.find(node => node.resource.id === id)!.key })
  const foreign = row('foreign')
  const input: any = { observations: [foreign], conditions: [row('foreign-condition')], medications: [row('foreign-medication')], diagnosticReports: [row('foreign-report'), { ...row('own-report'), result: [{ reference: 'Observation/foreign' }], _observations: [foreign] }] }
  const projected = projectClinicalAggregate(input, source)
  expect(projected.conditions).toEqual([])
  expect(projected.medications).toEqual([])
  expect(projected.observations).toEqual([])
  expect(projected.diagnosticReports).toHaveLength(1)
  expect(projected.diagnosticReports[0]._observations).toEqual([])
  expect(source.graph.nodes).toHaveLength(5)
})
