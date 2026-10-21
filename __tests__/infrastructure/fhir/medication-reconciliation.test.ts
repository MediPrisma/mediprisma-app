import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileMedicationRequests } from '@/src/infrastructure/fhir/services/medication-reconciliation'
import { renderHook } from '@testing-library/react'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { medicationExpectedEnd, assessMedicationCurrentness } from '@/src/core/utils/clinical-context-selection.utils'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
function fixture() {
  const base: any = {
    resourceType: 'MedicationRequest', subject: { reference: 'Patient/synthetic' },
    encounter: { reference: 'Encounter/one' }, authoredOn: '2026-09-17', intent: 'order',
    identifier: [{ system: 'urn:oid:vgh.medication.order', value: 'confirmed-source-order', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC' }] } }],
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
  hospital._authoredOn = { extension: [{ url: 'https://synthetic.example/source-ref', valueReference: { reference: 'MedicationRequest/cloud-med' } }] }
  const resources = reconcileMedicationRequests([cloud, hospital,
    { resourceType: 'Provenance', id: 'trace', target: [{ reference: 'MedicationRequest/cloud-med' }] }])
  expect(resources.filter(resource => resource.resourceType === 'MedicationRequest')).toHaveLength(1)
  expect(hospital).toMatchObject({ dosageInstruction: [{ text: '1 TAB PO QD' }], note: [{ text: 'Synthetic source instruction' }],
    dispenseRequest: { expectedSupplyDuration: { value: 28 } },
    _reconciledSourceReferences: ['MedicationRequest/hospital-med', 'MedicationRequest/cloud-med'] })
  expect(resources.find(resource => resource.id === 'trace')?.target[0].reference).toBe('MedicationRequest/cloud-med')
  expect(hospital._sourceRecordComparison.sourceStatuses.map((source: any) => source.reference)).toEqual(['MedicationRequest/hospital-med', 'MedicationRequest/cloud-med'])
  expect(hospital._authoredOn.extension[0].valueReference.reference).toBe('MedicationRequest/hospital-med')
  expect(hospital._sourcePrescriptionRecords[0]._authoredOn.extension[0].valueReference.reference).toBe('MedicationRequest/cloud-med')
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
    pair.hospital.identifier = pair.cloud.identifier = [{ ...pair.hospital.identifier[0], value: `order-${index}` }]
  }
  const graph = reconcileMedicationRequests([first.hospital, first.cloud, second.hospital, second.cloud])
  expect(graph).toHaveLength(2)
  expect(graph.every(order => order._reconciledSourceReferences.length === 2)).toBe(true)
  expect(graph.map(order => order.identifier[0].value)).toEqual(['order-0', 'order-1'])
})

it('recomputes imported comparison metadata without hiding two same-source real orders or changing the raw Bundle', () => {
  const { hospital } = fixture()
  const second = { ...hospital, id: 'hospital-second-order' }
  const stale = { status: 'confirmed', references: ['MedicationRequest/hospital-med', 'MedicationRequest/hospital-second-order'] }
  hospital._sourceRecordComparison = stale; second._sourceRecordComparison = stale
  const bundle = { resourceType: 'Bundle', type: 'collection', entry: [
    { resource: { resourceType: 'Patient', id: 'synthetic', name: [{ text: 'Synthetic Patient' }] } },
    { resource: hospital }, { resource: second },
  ] }
  const original = JSON.stringify(bundle)
  const parsed = LocalBundleService.parse(bundle)!.collection
  expect(parsed.medications).toHaveLength(2)
  expect(parsed.medications.every((order: any) => !order._sourceRecordComparison)).toBe(true)
  expect(JSON.stringify(bundle)).toBe(original)
})

it('retains every source order when otherwise identical copies cannot be uniquely paired', () => {
  const { cloud, hospital } = fixture()
  const orders = [hospital, cloud, { ...hospital, id: 'real-second-order' }]
  expect(reconcileMedicationRequests(orders)).toHaveLength(3)
  expect(orders.every(order => order._sourceRecordComparison.status === 'ambiguous')).toBe(true)
})

it('flags all four source records for two genuine identical orders and two unidentifiable cloud copies', () => {
  const first = fixture(), second = fixture()
  first.hospital.id = 'h1'; second.hospital.id = 'h2'; first.cloud.id = 'c1'; second.cloud.id = 'c2'
  for (const order of [first.hospital, first.cloud, second.hospital, second.cloud]) delete order.identifier
  const records = reconcileMedicationRequests([first.hospital, first.cloud, second.hospital, second.cloud])
  expect(records).toHaveLength(4)
  expect(records.every(record => record._sourceRecordComparison.status === 'ambiguous')).toBe(true)
  expect(records[0]._sourceRecordComparison.references).toEqual(['MedicationRequest/h1', 'MedicationRequest/h2', 'MedicationRequest/c1', 'MedicationRequest/c2'])
  const { result } = renderHook(() => useMedicationRows(records))
  expect(result.current).toHaveLength(2)
  expect(result.current.map(row => row.id)).toEqual(['h1', 'h2'])
  expect(result.current[0].sourceComparison?.records).toHaveLength(4)
  expect(result.current[0].sourceComparison?.records.filter(record => record.dataOrigin === 'hospital').map(record => record.id)).toEqual(['h1', 'h2'])
})

it('flags a possible copy with a missing source visit link without fabricating an Encounter reference', () => {
  const { hospital, cloud } = fixture()
  delete hospital.encounter
  hospital.requester = { display: '臺北榮總' }
  const visit = { resourceType: 'Encounter', id: 'one', class: { code: 'AMB' }, subject: hospital.subject,
    period: { start: '2026-09-17' }, serviceProvider: { display: '臺北榮總' }, status: 'finished' }
  expect(reconcileMedicationRequests([hospital, cloud, visit])).toHaveLength(3)
  expect(hospital.encounter).toBeUndefined()
  expect(hospital._sourceRecordComparison).toMatchObject({ status: 'candidate', warnings: ['encounter-link-unconfirmed'] })
  expect(hospital._reconciledSourceReferences).toBeUndefined()
})

it('does not use a date/facility fallback when two distinct same-day visits remain possible', () => {
  const { hospital, cloud } = fixture()
  delete hospital.encounter; hospital.requester = { display: '臺北榮總' }
  const visit = { resourceType: 'Encounter', id: 'one', class: { code: 'AMB' }, subject: hospital.subject,
    period: { start: '2026-09-17' }, serviceProvider: { display: '臺北榮總' }, status: 'finished' }
  reconcileMedicationRequests([hospital, cloud, visit, { ...visit, id: 'another' }])
  expect(hospital._sourceRecordComparison).toBeUndefined()
  expect(hospital.encounter).toBeUndefined()
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

it.each(['stopped', 'cancelled', 'entered-in-error', 'on-hold', 'completed'])('never lets unknown hospital status hide a cloud %s status', status => {
  const { hospital, cloud } = fixture()
  hospital.status = 'unknown'; cloud.status = status
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
  expect(cloud.status).toBe(status)
  expect(hospital.status).toBe(status)
  expect(hospital._sourcePrescriptionRecords.map((record: any) => record.status)).toEqual(['unknown', status])
})

it.each(['text', 'code', 'repeat'])('rejects a hospital text-only QD versus cloud BID expressed as %s', format => {
  const { hospital, cloud } = fixture()
  cloud.dosageInstruction = [format === 'text' ? { text: 'BID' } : format === 'code'
    ? { timing: { code: { text: 'BID' } } } : { timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } } }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital.dosageInstruction[0].text).toBe('1 TAB PO QD')
})

it('preserves names and actual source codes in source details when both orders reference Medication resources', () => {
  const { hospital, cloud } = fixture()
  const code = hospital.medicationCodeableConcept
  delete hospital.medicationCodeableConcept; delete cloud.medicationCodeableConcept
  hospital.medicationReference = { reference: 'Medication/h-product' }
  cloud.medicationReference = { reference: 'Medication/c-product' }
  const graph = reconcileMedicationRequests([hospital, cloud,
    { resourceType: 'Medication', id: 'h-product', code }, { resourceType: 'Medication', id: 'c-product', code }])
  expect(graph.filter(resource => resource.resourceType === 'MedicationRequest')).toHaveLength(1)
  expect(hospital._sourcePrescriptionRecords[0].medicationReference.reference).toBe('Medication/h-product')
  const { result } = renderHook(() => useMedicationRows([hospital]))
  expect(result.current[0].sourceComparison?.records.map(record => record.title)).toEqual(['Synthetic product 5 mg', 'Synthetic product 5 mg'])
  expect(result.current[0].sourceComparison?.records.map(record => record.nhiDrugCode)).toEqual(['SYNTHETIC1', 'SYNTHETIC1'])
})

it('never confirms medication copies through an unconfirmed visit comparison even with a shared order identifier', () => {
  const { hospital, cloud } = fixture()
  hospital.encounter = { reference: 'Encounter/h-visit' }; cloud.encounter = { reference: 'Encounter/c-visit' }
  const visits = ['h-visit', 'c-visit'].map(id => ({ resourceType: 'Encounter', id, class: { code: 'AMB' },
    _sourceRecordComparison: { status: 'candidate', references: ['Encounter/h-visit', 'Encounter/c-visit'] } }))
  const orders = reconcileMedicationRequests([hospital, cloud, ...visits]).filter(resource => resource.resourceType === 'MedicationRequest')
  expect(orders).toHaveLength(2)
  expect(hospital._sourceRecordComparison).toMatchObject({ status: 'candidate', warnings: ['encounter-link-unconfirmed'] })
})

it.each([1, 2])('does not add an unpaired structured %s TAB dose to a full text-only source SIG', value => {
  const { hospital, cloud } = fixture()
  hospital.dosageInstruction = [{ text: '1 TAB PO QD' }]
  cloud.dosageInstruction = [{ timing: { code: { text: 'QD' } }, doseAndRate: [{ doseQuantity: { value, unit: 'TAB' } }] }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital.dosageInstruction[0].doseAndRate).toBeUndefined()
})

it('keeps conflicting source statuses explicitly related without merging or changing either status', () => {
  const { hospital, cloud } = fixture()
  hospital.status = 'stopped'; cloud.status = 'active'
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital.status).toBe('stopped'); expect(cloud.status).toBe('active')
  expect(hospital._sourceRecordComparison).toMatchObject({ status: 'candidate', warnings: expect.arrayContaining(['source-facts-differ']) })
})

it.each(['urn:oid:vgh.case', 'urn:oid:vgh.medication.order', 'https://synthetic.example/patient-id', 'https://synthetic.example/untyped-id'])('never confirms a prescription using only shared untyped %s', system => {
  const { hospital, cloud } = fixture()
  hospital.identifier = cloud.identifier = [{ system, value: 'shared-context' }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital._sourceRecordComparison.status).toBe('candidate')
})

it('shows compatible cloud copies in one comparison without deleting or confirming any source order', () => {
  const { hospital, cloud } = fixture()
  delete hospital.identifier; delete cloud.identifier
  hospital.status = cloud.status = 'completed'
  const secondCloud = { ...cloud, id: 'cloud-second-real-order' }
  const orders = reconcileMedicationRequests([hospital, cloud, secondCloud])
  expect(orders).toHaveLength(3)
  const { result } = renderHook(() => useMedicationRows(orders))
  expect(result.current.map(row => row.id)).toEqual(['hospital-med'])
  expect(result.current[0].sourceComparison?.status).toBe('ambiguous')
  expect(result.current[0].sourceComparison?.records.map(record => record.id)).toEqual([
    'hospital-med', 'cloud-med', 'cloud-second-real-order',
  ])
  expect(result.current[0].reconciledOrderIds).toHaveLength(3)
  expect(orders.every(order => !order._reconciledSourceReferences)).toBe(true)
  expect(hospital.dispenseRequest).toBeUndefined()
})

it.each(['quantity', 'frequency', 'status'])('keeps surplus cloud rows visible when %s differs', field => {
  const { hospital, cloud } = fixture()
  delete hospital.identifier; delete cloud.identifier
  const secondCloud = JSON.parse(JSON.stringify(cloud))
  secondCloud.id = 'cloud-conflicting-order'
  if (field === 'quantity') {
    hospital.dispenseRequest = { quantity: { value: 28 } }
    secondCloud.dispenseRequest.quantity = { value: 56 }
  }
  if (field === 'frequency') secondCloud.dosageInstruction = [{ text: 'BID' }]
  if (field === 'status') secondCloud.status = 'stopped'
  const orders = reconcileMedicationRequests([hospital, cloud, secondCloud])
  const { result } = renderHook(() => useMedicationRows(orders))
  expect(result.current.map(row => row.id)).toEqual(expect.arrayContaining(['cloud-med', 'cloud-conflicting-order']))
  expect(result.current.every(row => row.sourceComparison?.records.length === 3)).toBe(true)
})

it('does not fold contradictory cloud regimens through an incomplete hospital record', () => {
  const { hospital, cloud } = fixture()
  delete hospital.identifier; delete cloud.identifier; delete hospital.dosageInstruction
  cloud.dosageInstruction = [{ text: 'QD' }]
  const secondCloud = { ...cloud, id: 'cloud-bid-order', dosageInstruction: [{ text: 'BID' }] }
  const orders = reconcileMedicationRequests([hospital, cloud, secondCloud])
  const { result } = renderHook(() => useMedicationRows(orders))
  expect(result.current.map(row => row.id)).toEqual(expect.arrayContaining(['cloud-med', 'cloud-bid-order']))
  expect(result.current[0].sourceComparison?.warnings).toContain('source-facts-differ')
})

it('keeps a cloud dispensing authorization end from becoming a hospital treatment end after a confirmed merge', () => {
  const { hospital, cloud } = fixture()
  hospital.authoredOn = cloud.authoredOn = '2026-10-19'
  cloud.dispenseRequest = { expectedSupplyDuration: { value: 7, code: 'd' }, validityPeriod: { end: '2026-12-31' } }
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
  expect(medicationExpectedEnd(hospital)).toBe('2026-10-25')
  expect(hospital._sourcePrescriptionRecords[1].dispenseRequest.validityPeriod.end).toBe('2026-12-31')
  const { result } = renderHook(() => useMedicationRows([hospital]))
  expect(result.current[0].endDateIso).toBe('2026-10-25')
})

it('does not add an unpaired structured IV route to a hospital full SIG recording PO', () => {
  const { hospital, cloud } = fixture()
  cloud.dosageInstruction = [{ timing: { code: { text: 'QD' } }, route: { text: 'IV' } }]
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital.dosageInstruction[0].route).toBeUndefined()
  expect(hospital._sourceRecordComparison.warnings).toContain('source-facts-differ')
})

it('does not let one stopped hospital order invalidate a separate active hospital order in an ambiguous group', () => {
  const { hospital, cloud } = fixture()
  delete hospital.identifier; delete cloud.identifier
  hospital.authoredOn = cloud.authoredOn = '2026-10-19'; hospital.status = 'stopped'
  const activeHospital = { ...hospital, id: 'second-real-hospital-order', status: 'active', dispenseRequest: { expectedSupplyDuration: { value: 28, code: 'd' } } }
  reconcileMedicationRequests([hospital, activeHospital, cloud])
  const now = Date.parse('2026-10-20T08:00:00+08:00')
  expect(assessMedicationCurrentness(activeHospital, now).current).toBe(true)
  expect(assessMedicationCurrentness(cloud, now)).toMatchObject({ current: false, uncertain: true })
})

it('recognises equivalent Taiwan prescription dates represented in UTC and UTC+08', () => {
  const { hospital, cloud } = fixture()
  hospital.authoredOn = '2026-09-17T00:00:00+08:00'; cloud.authoredOn = '2026-09-16T16:00:00Z'
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
})

it('preserves both records when two different supply-end strings are unparseable', () => {
  const { hospital, cloud } = fixture()
  hospital.dispenseRequest = { validityPeriod: { end: '2026-13-01' } }
  cloud.dispenseRequest.validityPeriod = { end: '2026-13-02' }
  expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  expect(hospital._sourceRecordComparison.warnings).toContain('source-facts-differ')
})
