import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileMedicationRequests } from '@/src/infrastructure/fhir/services/medication-reconciliation'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
function fixture() {
  const base: any = {
    resourceType: 'MedicationRequest', subject: { reference: 'Patient/synthetic' },
    encounter: { reference: 'Encounter/one' }, authoredOn: '2026-09-17', intent: 'order',
    identifier: [{ system: 'https://synthetic.example/order-id', value: 'confirmed-source-order' }],
    medicationCodeableConcept: { text: 'Synthetic product 5 mg', coding: [{ system: NHI, code: 'SYNTHETIC1' }] },
  }
  const cloud: any = { ...base, id: 'cloud-med', meta: { source: 'https://medcloud2.nhi.gov.tw/' }, status: 'unknown',
    dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } },
    extension: [{ url: 'https://synthetic.example/source-module', valueString: 'IMUE0008' }] }
  const hospital: any = { ...base, id: 'hospital-med', meta: { source: 'ehr-fhir-bridge/scraper' }, status: 'active',
    dosageInstruction: [{ text: '1 TAB PO QD', doseAndRate: [{ doseQuantity: { value: 1, unit: 'TAB' } }] }],
    note: [{ text: 'Synthetic source instruction' }], courseOfTherapyType: { coding: [{ code: 'continuous' }] } }
  return { cloud, hospital }
}

it('retains two source records without a common order identifier and marks a comparison, not a confirmed merge', () => {
  const { hospital, cloud } = fixture()
  delete hospital.identifier; delete cloud.identifier
  const result = reconcileMedicationRequests([hospital, cloud])
  expect(result).toHaveLength(2)
  expect(result.every(order => order._sourceRecordComparison.status === 'candidate')).toBe(true)
  expect(hospital._reconciledSourceReferences).toBeUndefined()
  expect(hospital.dispenseRequest).toBeUndefined()
})

it('preserves source regimens and fills a missing structured frequency only on a confirmed pair', () => {
  const { hospital, cloud } = fixture()
  cloud.dosageInstruction = [{ timing: { code: { text: 'QD' } } }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
  expect(hospital.dosageInstruction[0].timing.code.text).toBe('QD')
  expect(hospital._sourcePrescriptionRecords[0].dosageInstruction[0].timing).toBeUndefined()
  expect(hospital._sourcePrescriptionRecords[1].dosageInstruction[0].timing.code.text).toBe('QD')
})

it('merges only verified cross-source copies while preserving hospital SIG, notes and cloud facts', () => {
  const { cloud, hospital } = fixture()
  const resources = reconcileMedicationRequests([cloud, hospital,
    { resourceType: 'Provenance', id: 'trace', target: [{ reference: 'MedicationRequest/cloud-med' }] }])
  expect(resources.filter(resource => resource.resourceType === 'MedicationRequest')).toHaveLength(1)
  expect(hospital).toMatchObject({ dosageInstruction: [{ text: '1 TAB PO QD' }], note: [{ text: 'Synthetic source instruction' }],
    dispenseRequest: { expectedSupplyDuration: { value: 28 } },
    _reconciledSourceReferences: ['MedicationRequest/hospital-med', 'MedicationRequest/cloud-med'] })
  expect(resources.find(resource => resource.id === 'trace')?.target[0].reference).toBe('MedicationRequest/hospital-med')
})

it.each(['visit', 'inferred-visit', 'date', 'patient', 'product', 'name-only', 'dose', 'status', 'quantity', 'ambiguous', 'same-source', 'self-pay'])(
  'preserves separate prescriptions for %s', (scenario) => {
    const { cloud, hospital } = fixture()
    if (scenario === 'visit') cloud.encounter = { reference: 'Encounter/another-clinic' }
    if (scenario === 'inferred-visit') cloud._encounterInferred = true
    if (scenario === 'date') cloud.authoredOn = '2026-09-16'
    if (scenario === 'patient') cloud.subject = { reference: 'Patient/another' }
    if (scenario === 'product') cloud.medicationCodeableConcept = { coding: [{ system: NHI, code: 'ANOTHER001' }] }
    if (scenario === 'name-only') hospital.medicationCodeableConcept = { text: 'Synthetic product 5 mg' }
    if (scenario === 'dose') cloud.dosageInstruction = [{ doseAndRate: [{ doseQuantity: { value: 2, unit: 'TAB' } }] }]
    if (scenario === 'status') cloud.status = 'stopped'
    if (scenario === 'quantity') { cloud.dispenseRequest.quantity = { value: 28 }; hospital.dispenseRequest = { quantity: { value: 56 } } }
    if (scenario === 'same-source') cloud.meta = { ...hospital.meta }
    if (scenario === 'self-pay') hospital.note = [{ text: '自購：Y' }]
    const resources = [cloud, hospital]
    if (scenario === 'ambiguous') resources.push({ ...hospital, id: 'other-hospital-order' })
    expect(reconcileMedicationRequests(resources)).toHaveLength(resources.length)
  },
)

it('gives all import consumers the same reconciled list without changing the original Bundle', () => {
  const { cloud, hospital } = fixture()
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic Patient' }] } },
    { resource: { resourceType: 'Encounter', id: 'one', class: { code: 'AMB' }, status: 'finished', period: { start: '2026-09-17' } } },
    { resource: cloud }, { resource: hospital },
  ] }
  const original = JSON.stringify(bundle)
  const parsed = LocalBundleService.parse(bundle)!.collection
  expect(parsed.medications).toHaveLength(1)
  expect(parsed.medications[0]._reconciledSourceReferences).toHaveLength(2)
  expect(JSON.stringify(bundle)).toBe(original)
})

it('retains two real orders when each has a uniquely corresponding source order identifier', () => {
  const first = fixture(), second = fixture()
  for (const [index, pair] of [first, second].entries()) {
    pair.hospital.id += `-${index}`
    pair.cloud.id += `-${index}`
    pair.hospital.identifier = pair.cloud.identifier = [{ system: 'https://synthetic.example/order-id', value: `order-${index}` }]
  }
  const graph = reconcileMedicationRequests([first.hospital, first.cloud, second.hospital, second.cloud])
  expect(graph).toHaveLength(2)
  expect(graph.every(order => order._reconciledSourceReferences.length === 2)).toBe(true)
  expect(graph.map(order => order.identifier[0].value)).toEqual(['order-0', 'order-1'])
})

it('retains every source order when otherwise identical copies cannot be uniquely paired', () => {
  const { cloud, hospital } = fixture()
  const orders = [hospital, cloud, { ...hospital, id: 'real-second-order' }]
  expect(reconcileMedicationRequests(orders)).toHaveLength(3)
})

it('compares a cloud frequency-only instruction with the hospital frequency and preserves the full SIG', () => {
  const { cloud, hospital } = fixture()
  hospital.dosageInstruction[0].timing = { code: { coding: [{ code: 'QDPC' }] } }
  hospital.dosageInstruction[0].text = '1 TAB PO QDPC'
  cloud.dosageInstruction = [{ text: 'QDPC' }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
  expect(hospital.dosageInstruction[0].text).toBe('1 TAB PO QDPC')
})

it('does not treat conflicting source frequencies as equivalent partial instructions', () => {
  const { cloud, hospital } = fixture()
  hospital.dosageInstruction[0].timing = { code: { coding: [{ code: 'QDPC' }] } }
  cloud.dosageInstruction = [{ text: 'BIDPC' }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
})

it('allows only the documented cloud coverage-derived completed status, without ignoring a stop', () => {
  const { cloud, hospital } = fixture()
  cloud.status = 'completed'
  cloud.meta.tag = [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0008' }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
  const stopped = fixture()
  stopped.cloud.meta = cloud.meta
  stopped.cloud.status = 'stopped'
  expect(reconcileMedicationRequests([stopped.hospital, stopped.cloud])).toHaveLength(2)
})

it('keeps complementary source supply metadata and recognises the actual hospital chronic-note format', () => {
  const { cloud, hospital } = fixture()
  delete hospital.courseOfTherapyType
  hospital.note = [{ text: '慢簽(三個月)' }]
  hospital.dispenseRequest = { validityPeriod: { start: '2026-09-17T00:00:00+08:00' }, expectedSupplyDuration: { value: 28 } }
  cloud.dispenseRequest.validityPeriod = { start: '2026-09-17', end: '2026-10-14' }
  const [merged] = reconcileMedicationRequests([hospital, cloud])
  expect(merged.courseOfTherapyType.coding[0].code).toBe('continuous')
  expect(merged.dispenseRequest.expectedSupplyDuration).toEqual({ value: 28, code: 'd' })
  expect(merged.dispenseRequest.validityPeriod).toEqual({ start: '2026-09-17T00:00:00+08:00', end: '2026-10-14' })
})

it('never interprets lower-case IMUE0120 remaining-supply snapshots as a prescription to merge', () => {
  const { cloud, hospital } = fixture()
  cloud.meta.tag = [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-module', code: 'imue0120' }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
})
