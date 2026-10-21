import { clinicalContainedPatientExclusions } from '../clinical-contained-patient-exclusions'
import { reconcileClinicalSources } from '../clinical-reconciliation'
import type { FhirSourceResource } from '../clinical-source-graph'

const source = (resources: FhirSourceResource[]) => reconcileClinicalSources([{
  sourceId: 'synthetic-ehr', patientScope: 'p', generation: 'one', restBase: 'https://ehr.example/fhir', resources,
}])
const member = (id: string, reference: string) => ({ resourceType: 'Observation', id, subject: { reference } })

describe('clinicalContainedPatientExclusions', () => {
  it.each(['Patient/other', 'https://other.example/fhir/Patient/p'])('marks both measurement and report coverage for an excluded result: %s', reference => {
    const result = clinicalContainedPatientExclusions(source([{
      resourceType: 'DiagnosticReport', id: 'r', subject: { reference: 'Patient/p' },
      result: [{ reference: '#bad' }], contained: [member('bad', reference)],
    }]))
    expect(result).toHaveLength(1)
    expect(result[0].resourceTypes).toEqual(['Observation', 'DiagnosticReport'])
    expect(result[0].reason).toBe(reference.startsWith('Patient/') ? 'foreign-patient-reference' : 'unresolved-patient-reference')
  })

  it('follows hasMember siblings and de-duplicates a member reached from multiple roots', () => {
    const result = clinicalContainedPatientExclusions(source([{
      resourceType: 'DiagnosticReport', id: 'r', result: [{ reference: 'Observation/panel' }],
    }, {
      resourceType: 'Observation', id: 'panel', hasMember: [{ reference: '#nested' }], contained: [
        { resourceType: 'Observation', id: 'nested', hasMember: [{ reference: '#bad' }] },
        member('bad', 'Patient/other'),
      ],
    }]))
    expect(result).toHaveLength(1)
    expect(result[0].node.resource.id).toBe('bad')
    expect(result[0].resourceTypes).toEqual(['Observation', 'DiagnosticReport'])
  })

  it('does not treat detached, audit-embedded, unrelated references or foreign-root content as clinical coverage', () => {
    const result = clinicalContainedPatientExclusions(source([{
      resourceType: 'DiagnosticReport', id: 'detached', contained: [member('bad', 'Patient/other')],
    }, {
      resourceType: 'Observation', id: 'focus', focus: [{ reference: '#bad' }], contained: [member('bad', 'Patient/other')],
    }, {
      resourceType: 'DiagnosticReport', id: 'foreign', subject: { reference: 'Patient/other' },
      result: [{ reference: '#bad' }], contained: [member('bad', 'Patient/other')],
    }, {
      resourceType: 'AuditEvent', id: 'audit', entity: [{ what: { resourceType: 'DiagnosticReport', id: 'embedded', result: [{ reference: '#bad' }], contained: [member('bad', 'Patient/other')] } }],
    }]))
    expect(result).toEqual([])
  })
})
