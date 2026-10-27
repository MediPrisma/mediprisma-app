import { reconcileClinicalSources, selectClinicalSourceResources } from '@/src/core/services/clinical-reconciliation'
import { getClinicalSourceNodePatientExclusionReason } from '@/src/core/services/clinical-patient-scope'

/** One fictional patient and many of their records, the shape of a cloud import. */
function largeImport(count: number, patientScope = 'scope-cache-a') {
  return reconcileClinicalSources([{
    sourceId: 'cloud', patientScope, generation: 'g1', restBase: 'https://cloud.example/fhir', resources: [
      { resource: { resourceType: 'Patient', id: patientScope }, fullUrl: `https://cloud.example/fhir/Patient/${patientScope}` },
      ...Array.from({ length: count }, (_, i) => ({
        resource: { resourceType: 'Observation', id: `obs-${i}`, subject: { reference: `Patient/${patientScope}` } },
        fullUrl: `https://cloud.example/fhir/Observation/obs-${i}`,
      })),
    ],
  }])
}

describe('patient-scope parsing on a large import', () => {
  it('parses each distinct scope, base and reference once, not once per record', () => {
    const source = largeImport(800)
    const RealURL = globalThis.URL
    let parsed = 0
    // Counts every construction, including the ones that throw on a plain id.
    class CountingURL extends RealURL {
      constructor(url: string | URL, base?: string | URL) {
        parsed += 1
        super(url, base)
      }
    }
    globalThis.URL = CountingURL
    try {
      for (let pass = 0; pass < 3; pass++) {
        for (const node of source.graph.nodes) getClinicalSourceNodePatientExclusionReason(node, source.graph.nodes)
      }
    } finally {
      globalThis.URL = RealURL
    }
    // 801 nodes × 3 passes used to construct (and mostly throw on) several URLs each.
    expect(parsed).toBeLessThan(50)
  })

  it('answers the same as before for in-scope, foreign and unresolved references', () => {
    const source = reconcileClinicalSources([{
      sourceId: 'ehr', patientScope: 'a', generation: 'query', restBase: 'https://ehr.example/fhir', resources: [
        { resource: { resourceType: 'Patient', id: 'a' }, fullUrl: 'urn:uuid:patient-a' },
        { resource: { resourceType: 'Patient', id: 'b' }, fullUrl: 'urn:uuid:patient-b' },
        { resourceType: 'Observation', id: 'relative-foreign', subject: { reference: 'Patient/b' } },
        { resourceType: 'Observation', id: 'other-server', subject: { reference: 'https://other.example/fhir/Patient/a' } },
        { resourceType: 'Observation', id: 'normalized-server', subject: { reference: 'https://EHR.example:443/fhir/Patient/a' } },
        { resourceType: 'Observation', id: 'matching', subject: { reference: 'urn:uuid:patient-a' } },
      ],
    }])
    // Twice: the second read comes from the remembered parses.
    for (let pass = 0; pass < 2; pass++) {
      expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual(['a', 'normalized-server', 'matching'])
      const reason = (id: string) => getClinicalSourceNodePatientExclusionReason(source.graph.nodes.find(node => node.resource.id === id)!, source.graph.nodes)
      expect(reason('relative-foreign')).toBe('foreign-patient-reference')
      expect(reason('other-server')).toBe('unresolved-patient-reference')
    }
  })

  it('keeps answering correctly past the cache limit', () => {
    // More distinct scopes than one remembered map holds.
    for (let i = 0; i < 5200; i += 400) {
      const source = largeImport(1, `scope-${i}`)
      expect(selectClinicalSourceResources(source).map(resource => resource.id)).toEqual([`scope-${i}`, 'obs-0'])
    }
  })
})
