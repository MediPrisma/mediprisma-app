import { QueryClient } from '@tanstack/react-query'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { projectClinicalAggregate } from '@/src/infrastructure/fhir/mappers/clinical-aggregate-projection'
import { reconcileClinicalSources } from '@/src/core/services/clinical-reconciliation'
import { selectCdssClinicalInputs } from '@/features/clinical-decision-support/utils/clinical-record-inputs'
import { CLINICAL_RECORD_VARIANT_EXTENSION } from '@/src/core/services/clinical-record-variant-modifier'
import { stripClinicalCaptureMetadata } from '@/src/core/utils/ai-clinical-scope.utils'

const patient = { resourceType: 'Patient', id: 'synthetic' }
const bundle = (resources: any[]) => ({ resourceType: 'Bundle', type: 'collection', entry: [patient, ...resources].map(resource => ({ resource })) })
const observation = (value: number, updated?: string, id = 'glucose') => ({
  resourceType: 'Observation', id, status: 'final', subject: { reference: 'Patient/synthetic' },
  code: { text: 'Glucose' }, effectiveDateTime: '2026-10-01', valueQuantity: { value, unit: 'mg/dL' },
  ...(updated ? { meta: { lastUpdated: updated } } : {}),
})
const parse = (resources: any[]) => projectClinicalAggregate(LocalBundleService.parse(bundle(resources))!.collection)

it.each([false, true])('automatically uses the latest source version in chart and CDSS (reverse=%s)', reverse => {
  const resources = [observation(100, '2026-10-01T00:00:00Z'), observation(120, '2026-10-02T00:00:00Z')]
  const collection = parse(reverse ? resources.reverse() : resources)
  expect(collection.observations).toHaveLength(1)
  expect(collection.observations[0].valueQuantity?.value).toBe(120)
  expect(collection.observations[0].clinicalRecordVariant).toBeUndefined()
  const decision = selectCdssClinicalInputs(collection)
  expect(decision.input.observations).toHaveLength(1)
  expect(decision.input.observations[0].valueQuantity?.value).toBe(120)
  expect(decision.excluded).toEqual([])
  expect(collection.clinicalSource?.graph.nodes.filter(node => node.resource.resourceType === 'Observation')).toHaveLength(2)
})

it('does not merge separate measurements simply because their clinical values match', () => {
  expect(parse([observation(100, undefined, 'first'), observation(100, undefined, 'second')]).observations).toHaveLength(2)
})

it('uses the same deterministic record when timestamps and input order cannot establish chronology', () => {
  const a = observation(100), b = observation(120)
  const forward = parse([a, b]), reverse = parse([b, a])
  expect(forward.observations).toHaveLength(1)
  expect(reverse.observations[0].valueQuantity).toEqual(forward.observations[0].valueQuantity)
})

it('links a report to the automatically selected measurement without a reconciliation step', () => {
  const collection = parse([observation(100, '2026-10-01'), observation(120, '2026-10-02'), {
    resourceType: 'DiagnosticReport', id: 'report', status: 'final', subject: { reference: 'Patient/synthetic' },
    code: { text: 'Glucose report' }, result: [{ reference: 'Observation/glucose' }],
  }])
  expect(collection.diagnosticReports[0].result?.[0].reference).toBe('Observation/' + collection.observations[0].id)
  expect(collection.diagnosticReports[0]._observations?.map(row => row.valueQuantity?.value)).toEqual([120])
})

it('selects the Claim before deriving diagnoses, procedures, weight or visit dates', () => {
  const claim = (updated: string, text: string, value: number) => ({ resourceType: 'Claim', id: 'claim',
    patient: { reference: 'Patient/synthetic' }, created: '2026-10-01', meta: { lastUpdated: updated },
    diagnosis: [{ sequence: 1, diagnosisCodeableConcept: { text } }],
    supportingInfo: [{ category: { coding: [{ code: 'weight' }] }, valueQuantity: { value, code: 'kg' } }],
    procedure: [{ sequence: 1, procedureCodeableConcept: { text } }],
  })
  const collection = parse([claim('2026-10-01', 'Old source version', 70), claim('2026-10-02', 'Selected source version', 80)])
  expect(collection.conditions.map(row => row.code?.text)).toEqual(['Selected source version'])
  expect(collection.procedures.map(row => row.code?.text)).toEqual(['Selected source version'])
  expect(collection.observations.map(row => row.valueQuantity?.value)).toEqual([80])
  expect(selectCdssClinicalInputs(collection).excluded).toEqual([])
})

it('automatically consumes the available valid imported version while preserving its raw modifier', () => {
  const raw = { ...observation(120), modifierExtension: [{ url: CLINICAL_RECORD_VARIANT_EXTENSION, extension: [
    { url: 'groupId', valueString: 'synthetic-group' }, { url: 'classification', valueCode: 'revision' },
    { url: 'variantCount', valuePositiveInt: 2 }, { url: 'reason', valueString: 'Imported versions' },
  ] }] }
  const collection = parse([raw])
  expect(selectCdssClinicalInputs(collection).input.observations[0].valueQuantity?.value).toBe(120)
  expect(collection.observations[0].clinicalRecordVariant).toBeUndefined()
  expect(collection.clinicalSource?.graph.nodes.find(node => node.resource.resourceType === 'Observation')?.resource.modifierExtension).toEqual(raw.modifierExtension)
})

it('keeps cache-roundtripped report references pointing at the selected visible row', () => {
  const resource = { ...observation(100), encounter: { reference: 'Encounter/e' } }
  const report = { resourceType: 'DiagnosticReport', id: 'r', status: 'final', code: { text: 'Synthetic report' }, result: [{ reference: 'Observation/glucose' }] }
  const capture = (generation: string, status: string, withReport = true) => ({ sourceId: 'synthetic', patientScope: 'synthetic', generation,
    resources: [{ resourceType: 'Encounter', id: 'e', status }, resource, ...(withReport ? [report] : [])] })
  const project = (source: ReturnType<typeof reconcileClinicalSources>) => projectClinicalAggregate({ clinicalSource: source,
    observations: source.graph.nodes.filter(node => node.resource.resourceType === 'Observation').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
    diagnosticReports: source.graph.nodes.filter(node => node.resource.resourceType === 'DiagnosticReport').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
    encounters: source.graph.nodes.filter(node => node.resource.resourceType === 'Encounter').map(node => ({ ...node.resource, clinicalSourceNodeKey: node.key })),
  } as any)
  const client = new QueryClient()
  client.setQueryData(['reports'], project(reconcileClinicalSources([capture('a', 'finished')])).diagnosticReports)
  const fresh = project(reconcileClinicalSources([capture('b', 'finished')]))
  client.setQueryData(['reports'], fresh.diagnosticReports)
  const source = reconcileClinicalSources([capture('b', 'finished'), capture('c', 'in-progress', false)])
  const after = projectClinicalAggregate({ ...fresh, diagnosticReports: client.getQueryData(['reports']) } as any, source)
  expect(after.observations.map((row: any) => 'Observation/' + row.id)).toContain(after.diagnosticReports[0].result[0].reference)
  expect(JSON.stringify(stripClinicalCaptureMetadata(after))).not.toContain('clinicalSourceProjectedReferences')
})
