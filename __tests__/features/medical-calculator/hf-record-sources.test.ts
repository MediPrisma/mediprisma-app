import { randomUUID } from 'node:crypto'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import { buildMedcloudHfInput, medcloudHfVisits } from '@/src/core/hf-risk/medcloud-input'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'
import type { FhirRecord } from '@/src/core/hf-risk/contract'

function bridgeFixture(source: 'health-bank' | 'tvgh-ehr') {
  const bundle = hfMedcloudFixture()
  bundle.meta = source === 'health-bank' ? { tag: [{ system: 'https://github.com/voho0000/NHI-FHIR-BRIDGE/bridge-version', code: 'test' }] } : { source: 'ehr-fhir-bridge/extension-local' }
  bundle.entry = bundle.entry.filter((e: FhirRecord) => e.resource.resourceType !== 'Organization')
  for (const { resource } of bundle.entry) {
    resource.meta = { source: source === 'health-bank' ? 'nhi-fhir-bridge/scraper' : 'ehr-fhir-bridge/scraper' }
    if (resource.resourceType === 'Encounter') {
      if (source === 'health-bank') resource.serviceProvider = { display: '臺北榮民總醫院' }
      else delete resource.serviceProvider
    }
    if (resource.resourceType === 'Observation') resource.performer = [{ display: '台北榮民總醫院' }]
  }
  return bundle
}
function build(bundle: FhirRecord) {
  const visit = medcloudHfVisits(bundle, '2026-10-05')[0]
  return buildMedcloudHfInput(bundle, { provider: visit.provider, encounter: visit.reference, claim: 'P1_CD_mortality_1m' }, { today: '2026-10-05', uuid: randomUUID })
}
it.each(['health-bank', 'tvgh-ehr'] as const)('projects %s hospital scope without mutating the source or leaking identifiers', source => {
  const original = bridgeFixture(source)
  const before = JSON.stringify(original)
  const input = build(original)
  expect(JSON.stringify(original)).toBe(before)
  expect(input.counts).toMatchObject({ Encounter: 1, Condition: 1, Observation: 1 })
  expect(validateHfTransportBundle(input.bundle, input.indexDate)).toBe(true)
  expect(JSON.stringify(input.bundle)).not.toMatch(/bridge-hospital|Synthetic identity|FAKE-ID|PRIVATE/)
  expect(input.gaps.some(g => g.code.startsWith('module-unknown:imue'))).toBe(false)
})
it('keeps health-bank hospitals distinct and excludes conflicting performers', () => {
  const bundle = bridgeFixture('health-bank')
  const lab = bundle.entry.find((e: FhirRecord) => e.resource.resourceType === 'Observation').resource
  lab.performer = [{ display: '合成其他院所' }]
  expect(build(bundle).counts.Observation).toBeUndefined()
  lab.encounter = { reference: 'Encounter/synthetic-visit' }
  expect(build(bundle).counts.Observation).toBeUndefined()
})
it('does not infer a TVGH hospital from site labels or from unknown resource provenance', () => {
  const bundle = bridgeFixture('tvgh-ehr')
  delete bundle.entry.find((e: FhirRecord) => e.resource.resourceType === 'Encounter').resource.meta
  expect(medcloudHfVisits(bundle)).toEqual([])
  const unknown = bridgeFixture('health-bank')
  delete unknown.meta
  expect(() => medcloudHfVisits(unknown)).toThrow('source-unsupported')
})
it('allows source preparation but refuses to relabel generic ICD-10 as ICD-10-CM', () => {
  const bundle = bridgeFixture('tvgh-ehr')
  bundle.entry.find((e: FhirRecord) => e.resource.resourceType === 'Encounter').resource.reasonCode[0].coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
  const input = build(bundle)
  expect(input.gaps).toContainEqual({ code: 'index-diagnosis-missing', count: 1 })
  expect(input.counts.Condition).toBeUndefined()
  expect(validateHfTransportBundle(input.bundle, input.indexDate)).toBe(false)
})
it('does not use the artificial Jan 1 birth date in a deidentified TVGH export', () => {
  const bundle = bridgeFixture('tvgh-ehr')
  const patient = bundle.entry.find((e: FhirRecord) => e.resource.resourceType === 'Patient').resource
  patient.name = [{ text: 'DEID-synthetic' }]
  patient.birthDate = '1960-01-01'
  const input = build(bundle)
  expect(input.bundle.entry[0].resource.birthDate).toBeUndefined()
  expect(input.gaps).toContainEqual({ code: 'patient-birthdate', count: 1 })
})
it.each([{ family: 'DEID-synthetic' }, { given: ['DEID-synthetic'] }])('recognizes deidentified EHR markers outside name.text: %j', name => {
  const bundle = bridgeFixture('tvgh-ehr')
  bundle.entry.find((e: FhirRecord) => e.resource.resourceType === 'Patient').resource.name = [name]
  expect(build(bundle).bundle.entry[0].resource.birthDate).toBeUndefined()
})
it('ignores malformed entries without mutating a bridge import', () => {
  const bundle = bridgeFixture('health-bank')
  bundle.entry.push(null, { resource: null })
  expect(build(bundle).counts.Observation).toBe(1)
  expect(bundle.entry.at(-2)).toBeNull()
  expect(build(bundle).gaps).toContainEqual({ code: 'hospital-name-only', count: 1 })
})
