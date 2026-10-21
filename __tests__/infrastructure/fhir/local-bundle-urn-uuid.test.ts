// Regression coverage for ingesting urn:uuid / id-less bundles (IPS, TW-Core,
// and any transaction/collection/document Bundle).
//
// Such bundles identify resources by `entry.fullUrl` (e.g. `urn:uuid:…`), leave
// `resource.id` absent, and point every internal reference at those fullUrls.
// Before canonicalisation this produced the "只讀得到年齡性別" bug: the Patient
// had no id, so the patient-id-gated clinical-data query never ran and every
// other resource silently vanished; reports also never linked to their member
// observations because `split('/').pop()` left the `urn:uuid:` prefix attached.
//
// These tests lock in that the ingestion boundary now:
//   - stamps a stable id on every resource (from its fullUrl),
//   - rewrites internal references to the relative ResourceType/id form,
//   - links DiagnosticReports to their member Observations,
//   - resolves medicationReference → drug name for MedicationRequest too.

import {
  LocalBundleService,
  canonicalizeBundleResources,
  idFromFullUrl,
} from '@/src/infrastructure/fhir/services/local-bundle.service'
import { referenceId } from '@/src/core/utils/observation-selectors'

// A miniature of the real IPS_TWCORE-MIX-001 bundle: collection type, every
// resource id-less, every reference in urn:uuid form. Typed `any` on purpose:
// these fixtures are deliberately id-less / urn-referenced (not valid against
// the strict entity types), and the tests poke at raw `entry[].resource` fields.
function urnBundle(): any {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: 'urn:uuid:pat-1',
        resource: {
          resourceType: 'Patient',
          gender: 'female',
          birthDate: '1935-02-03',
          name: [{ text: '楊柏晴' }],
        },
      },
      {
        fullUrl: 'urn:uuid:enc-1',
        resource: {
          resourceType: 'Encounter',
          status: 'finished',
          period: { start: '2026-06-01T08:22:15.165Z' },
          subject: { reference: 'urn:uuid:pat-1' },
        },
      },
      {
        fullUrl: 'urn:uuid:obs-1',
        resource: {
          resourceType: 'Observation',
          status: 'final',
          category: [
            {
              coding: [
                { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' },
              ],
            },
          ],
          code: { coding: [{ system: 'http://loinc.org', code: '2089-1' }] },
          subject: { reference: 'urn:uuid:pat-1' },
          encounter: { reference: 'urn:uuid:enc-1' },
          effectiveDateTime: '2026-06-01T08:22:15.165Z',
          valueQuantity: { value: 121, unit: 'mg/dL' },
        },
      },
      {
        fullUrl: 'urn:uuid:dr-1',
        resource: {
          resourceType: 'DiagnosticReport',
          status: 'final',
          code: { coding: [{ system: 'http://loinc.org', code: '24331-1' }], text: '血脂檢查報告' },
          subject: { reference: 'urn:uuid:pat-1' },
          effectiveDateTime: '2026-06-01T08:22:15.165Z',
          result: [{ reference: 'urn:uuid:obs-1' }],
        },
      },
      {
        fullUrl: 'urn:uuid:med-1',
        resource: {
          resourceType: 'Medication',
          code: { coding: [{ system: 'http://snomed.info/sct', code: '373444002' }], text: 'Metoprolol 25 mg tablet' },
        },
      },
      {
        fullUrl: 'urn:uuid:mr-1',
        resource: {
          resourceType: 'MedicationRequest',
          status: 'active',
          intent: 'order',
          medicationReference: { reference: 'urn:uuid:med-1' },
          subject: { reference: 'urn:uuid:pat-1' },
          encounter: { reference: 'urn:uuid:enc-1' },
          authoredOn: '2026-06-01T08:22:15.165Z',
        },
      },
    ],
  }
}

describe('idFromFullUrl', () => {
  it('strips urn:uuid / urn:oid schemes', () => {
    expect(idFromFullUrl('urn:uuid:9355c5dc-abc')).toBe('9355c5dc-abc')
    expect(idFromFullUrl('urn:oid:1.2.3.4.5')).toBe('1.2.3.4.5')
  })
  it('takes the id segment of relative / absolute URLs (and drops _history)', () => {
    expect(idFromFullUrl('Observation/o1')).toBe('o1')
    expect(idFromFullUrl('https://h/baseR4/Observation/o1')).toBe('o1')
    expect(idFromFullUrl('https://h/baseR4/Observation/o1/_history/2')).toBe('o1')
  })
  it('returns undefined for missing input', () => {
    expect(idFromFullUrl(undefined)).toBeUndefined()
    expect(idFromFullUrl('')).toBeUndefined()
  })
})

describe('referenceId — URN-form references', () => {
  it('reduces urn:uuid / urn:oid to the bare id', () => {
    expect(referenceId('urn:uuid:9355c5dc-abc')).toBe('9355c5dc-abc')
    expect(referenceId('urn:oid:1.2.3.4.5')).toBe('1.2.3.4.5')
  })
  it('still handles relative + versioned forms', () => {
    expect(referenceId('Observation/o1')).toBe('o1')
    expect(referenceId('Observation/o1/_history/3')).toBe('o1')
  })
})

describe('canonicalizeBundleResources', () => {
  it('stamps ids from fullUrl and rewrites internal references to ResourceType/id', () => {
    const resources = canonicalizeBundleResources(urnBundle())
    const byType = (t: string) => resources.find((r) => r.resourceType === t)

    expect(byType('Patient').id).toBe('pat-1')
    expect(byType('Observation').id).toBe('obs-1')

    // Internal references are now relative; the target resource type is derived
    // from the resolved entry, not guessed from the field name.
    expect(byType('Observation').subject.reference).toBe('Patient/pat-1')
    expect(byType('DiagnosticReport').result[0].reference).toBe('Observation/obs-1')
    expect(byType('MedicationRequest').medicationReference.reference).toBe('Medication/med-1')
  })

  it('does not mutate the raw bundle', () => {
    const bundle = urnBundle()
    canonicalizeBundleResources(bundle)
    // The original entries keep their urn:uuid references and id-less resources.
    expect(bundle.entry[0].resource.id).toBeUndefined()
    expect(bundle.entry[2].resource.subject.reference).toBe('urn:uuid:pat-1')
  })

  it('leaves references to unknown / external targets untouched', () => {
    const resources = canonicalizeBundleResources({
      resourceType: 'Bundle',
      entry: [
        { fullUrl: 'urn:uuid:obs-x', resource: { resourceType: 'Observation', performer: [{ reference: 'https://other.example/fhir/Practitioner/999' }] } },
      ],
    })
    expect(resources[0].performer[0].reference).toBe('https://other.example/fhir/Practitioner/999')
  })
})

describe('LocalBundleService.parse — urn:uuid id-less bundle', () => {
  it('gives the Patient a stable id so the clinical-data query gate can open', () => {
    const data = LocalBundleService.parse(urnBundle())
    expect(data).not.toBeNull()
    // Empty id was the root cause of "只讀得到年齡性別": the gate is
    // `enabled: !!patient?.id`, so a blank id dropped all clinical data.
    expect(data!.patient.id).toBe('pat-1')
    expect(data!.patient.gender).toBe('female')
  })

  it('loads the clinical resources (not just demographics)', () => {
    const data = LocalBundleService.parse(urnBundle())!
    expect(data.collection.observations).toHaveLength(1)
    expect(data.collection.observations[0].id).toMatch(/^[A-Za-z0-9.-]{1,64}$/)
    expect(data.collection.observations[0].sourceId).toBeUndefined()
    expect(data.collection.diagnosticReports).toHaveLength(1)
    expect(data.collection.encounters).toHaveLength(1)
    expect(data.collection.medications).toHaveLength(1)
  })

  it('links a DiagnosticReport to its member Observation across urn:uuid refs', () => {
    const data = LocalBundleService.parse(urnBundle())!
    const report = data.collection.diagnosticReports[0]
    expect(report._observations).toEqual([data.collection.observations[0]])
    expect(report.result?.[0].reference).toBe('Observation/' + data.collection.observations[0].id)
  })

  it('resolves MedicationRequest.medicationReference into a drug name', () => {
    const data = LocalBundleService.parse(urnBundle())!
    const med = data.collection.medications[0]
    expect(med._sourceResourceType).toBe('MedicationRequest')
    expect(med.medicationCodeableConcept?.text).toBe('Metoprolol 25 mg tablet')
  })
})
