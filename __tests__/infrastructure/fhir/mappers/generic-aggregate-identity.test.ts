import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'

const domains = {
  Condition: 'conditions', MedicationRequest: 'medications', MedicationStatement: 'medications', AllergyIntolerance: 'allergies', Encounter: 'encounters', Procedure: 'procedures', ImagingStudy: 'imagingStudies', DocumentReference: 'documentReferences', Composition: 'compositions', Immunization: 'immunizations', Consent: 'consents', Device: 'devices', CarePlan: 'carePlans', Basic: 'medicationRemainingSummaries',
} as const

it('projects collision identities and graph-resolved references in every mapped generic domain', () => {
  const resources = Object.keys(domains).flatMap(type => ['a', 'b'].map(label => ({ fullUrl: `urn:uuid:${type}-${label}`, resource: { resourceType: type, id: 'same', subject: { reference: 'Patient/patient' }, extension: [{ url: 'urn:synthetic:link', valueReference: { reference: `urn:uuid:Condition-${label}` } }] } })))
  const source = reconcileClinicalSources([{ sourceId: 'source', patientScope: 'patient', generation: '1', resources }])
  const input: Record<string, any[]> = { observations: [], diagnosticReports: [] }
  for (const node of source.graph.nodes) {
    const field = domains[node.resource.resourceType as keyof typeof domains]
    if (field) (input[field] ??= []).push({ ...node.resource, clinicalSourceNodeKey: node.key })
  }
  const projected = projectClinicalAggregate(input, source)
  for (const field of new Set(Object.values(domains))) {
    const rows = projected[field]
    expect(rows).toHaveLength(field === 'medications' ? 4 : 2)
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.id).toMatch(/^cs[A-Za-z0-9.-]+$/)
      expect(row.sourceId).toBe('same')
      expect(row.subject.reference).toBe('Patient/patient')
      const edge = source.graph.references.find(edge => edge.origin.key === row.clinicalSourceNodeKey && edge.path === 'extension[0].valueReference')!
      const target = projected.conditions.find(row => edge.targetKeys.includes(row.clinicalSourceNodeKey))!
      expect(row.extension[0].valueReference.reference).toBe(`Condition/${target.id}`)
    }
  }
})

it('removes only exact generic retransmissions while retaining source evidence', () => {
  const resource = { resourceType: 'Condition', id: 'same', code: { text: 'Same record' } }
  const source = reconcileClinicalSources(['first', 'second'].map(generation => ({ sourceId: 'source', patientScope: 'patient', generation, resources: [{ fullUrl: 'urn:uuid:condition', resource }] })))
  const input = { conditions: source.graph.nodes.map(node => ({ id: resource.id, clinicalSourceNodeKey: node.key, code: resource.code })) }
  const projected = projectClinicalAggregate(input, source)
  expect(projected.conditions).toHaveLength(1)
  expect(projected.conditions[0].id).toBe('same')
  expect(source.graph.nodes).toHaveLength(2)
})
