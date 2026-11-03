import { reconcileMedicationRequests } from '@/src/infrastructure/fhir/services/medication-reconciliation'
import { markVghtpeMedicationIdentities } from '@/src/infrastructure/fhir/services/vghtpe-medication-identity-enrichment'
import { enrichBundleWithNhiDrugTerminology } from '@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service'
import { VGHTPE_MEDICATION_IDENTITY_URL, vghtpeMedicationIdentityCodes, vghtpeMedicationIdentityIngredient,
  vghtpeMedicationIdentityExtension, hasVghtpeMedicationIdentityCheck } from '@/src/shared/utils/hospital-medication-index'
import { MEDCLOUD_REFILL_DISPENSE_DAY_URL } from '@/src/shared/constants/medcloud.constants'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'
const PRODUCT = 'urn:oid:vgh.medication.product'
const GENERIC = 'urn:oid:vgh.medication.generic'
// Concor FC * tab 1.25 mg is in the committed index with BC24039100 among its
// codes; BC24040100 is not one of them (another strength).
const CONCOR = 'Concor FC * tab 1.25 mg'

function hospitalOrder(overrides: Record<string, any> = {}): any {
  return {
    resourceType: 'MedicationRequest', id: 'hospital-med', meta: { source: 'ehr-fhir-bridge/scraper' },
    status: 'active', intent: 'order', subject: { reference: 'Patient/synthetic' }, authoredOn: '2026-09-17T09:30:00+08:00',
    identifier: [{ system: 'urn:oid:vgh.medication.order', value: 'synthetic-case-1' }],
    medicationCodeableConcept: { text: CONCOR, coding: [{ system: PRODUCT, code: CONCOR, display: CONCOR }] },
    dosageInstruction: [{ text: '1 TAB PO QD', doseAndRate: [{ doseQuantity: { value: 1, unit: 'TAB' } }] }],
    ...overrides,
  }
}

function cloudOrder(overrides: Record<string, any> = {}): any {
  return {
    resourceType: 'MedicationRequest', id: 'cloud-med', meta: { source: 'https://medcloud2.nhi.gov.tw/' },
    status: 'unknown', intent: 'order', subject: { reference: 'Patient/synthetic' }, authoredOn: '2026-09-17',
    requester: { display: '臺北榮總;門診' }, reasonCode: [{ coding: [{ code: 'I10' }], text: '本態性高血壓' }],
    medicationCodeableConcept: { coding: [{ system: NHI, code: 'BC24039100', display: 'CONCOR 1.25MG' }] },
    ...overrides,
  }
}

async function marked(...orders: any[]): Promise<any[]> {
  const bundle = await markVghtpeMedicationIdentities({ resourceType: 'Bundle', entry: orders.map(resource => ({ resource })) })
  return (bundle.entry as any[]).map(entry => entry.resource)
}

describe('VGH medication index identity mark', () => {
  it('marks a hospital order with every NHI code of its one identity and leaves cloud orders alone', async () => {
    const [hospital, cloud] = await marked(hospitalOrder(), cloudOrder())
    expect(vghtpeMedicationIdentityCodes(hospital)?.has('BC24039100')).toBe(true)
    expect(vghtpeMedicationIdentityCodes(hospital)?.has('BC24040100')).toBe(false)
    expect(hospital.medicationCodeableConcept.coding).toEqual([{ system: PRODUCT, code: CONCOR, display: CONCOR }])
    expect(cloud.extension).toBeUndefined()
  })

  it('carries the identity ingredient, and treats an older mark without it as unchecked', async () => {
    const [hospital] = await marked(hospitalOrder())
    // The identity's products word the salt two ways; the mark names neither.
    expect(vghtpeMedicationIdentityIngredient(hospital)?.ingredientText).toBe('BISOPROLOL 1.25 MG')
    expect(hasVghtpeMedicationIdentityCheck(hospital)).toBe(true)
    const older = { extension: [{ url: VGHTPE_MEDICATION_IDENTITY_URL, extension: [{ url: 'index', valueString: 'x' }, { url: 'nhiCode', valueCode: 'BC24039100' }] }] }
    expect(hasVghtpeMedicationIdentityCheck(older)).toBe(false)
    expect(hasVghtpeMedicationIdentityCheck({ extension: [vghtpeMedicationIdentityExtension('x', [])] })).toBe(true)
  })

  it('records an unresolved check without codes and replaces a previous mark', async () => {
    const stale = { url: VGHTPE_MEDICATION_IDENTITY_URL, extension: [{ url: 'nhiCode', valueCode: 'BC24039100' }] }
    const [hospital] = await marked(hospitalOrder({ extension: [stale],
      medicationCodeableConcept: { coding: [{ system: PRODUCT, code: 'Synthetic unlisted tab 5 mg' }] } }))
    expect(hospital.extension).toHaveLength(1)
    expect(hospital.extension[0].url).toBe(VGHTPE_MEDICATION_IDENTITY_URL)
    expect(vghtpeMedicationIdentityCodes(hospital)).toBeUndefined()
  })

  it('gives no identity when the generic and product fields name two different drugs', async () => {
    const [hospital] = await marked(hospitalOrder({ medicationCodeableConcept: { coding: [
      { system: GENERIC, code: 'Norvasc * tab 5 mg' }, { system: PRODUCT, code: CONCOR },
    ] } }))
    expect(vghtpeMedicationIdentityCodes(hospital)).toBeUndefined()
  })

  it('returns the same Bundle when every hospital order already carries the current mark', async () => {
    const once = await markVghtpeMedicationIdentities({ resourceType: 'Bundle', entry: [{ resource: hospitalOrder() }] })
    expect(await markVghtpeMedicationIdentities(once)).toBe(once)
  })

  it('is applied by the drug terminology enrichment even when no cloud order needs terminology', async () => {
    const result = await enrichBundleWithNhiDrugTerminology({ resourceType: 'Bundle', entry: [{ resource: hospitalOrder() }] })
    expect(vghtpeMedicationIdentityCodes((result.bundle.entry as any[])[0].resource)?.has('BC24039100')).toBe(true)
  })
})

describe('pairing a hospital order with its 臺北榮總 cloud claim by index identity', () => {
  it('merges the same-day claim without a shared order number or visit and keeps the cloud facility and diagnosis', async () => {
    const [hospital, cloud] = await marked(hospitalOrder(), cloudOrder())
    const result = reconcileMedicationRequests([hospital, cloud])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(hospital)
    expect(hospital._sourceRecordComparison).toMatchObject({ status: 'confirmed' })
    expect(hospital._sourceRecordComparison.warnings).toBeUndefined()
    expect(hospital.requester.display).toBe('臺北榮總;門診')
    expect(hospital.reasonCode[0].coding[0].code).toBe('I10')
    expect(hospital.dosageInstruction[0].text).toBe('1 TAB PO QD')
    expect(hospital._sourcePrescriptionRecords).toHaveLength(2)
    // With no visit link the merged row still carries the cloud's recorded NHI code.
    expect(hospital.encounter).toBeUndefined()
    expect(hospital.medicationCodeableConcept.coding.map((coding: any) => coding.code)).toContain('BC24039100')
    expect(hospital._sourcePrescriptionRecords[1]._resolvedMedicationCodeableConcept.coding[0].code).toBe('BC24039100')
  })

  it.each([
    ['another strength', { medicationCodeableConcept: { coding: [{ system: NHI, code: 'BC24040100' }] } }],
    ['another hospital', { requester: { display: '臺大醫院;門診' } }],
    ['another day', { authoredOn: '2026-09-18' }],
    ['another patient', { subject: { reference: 'Patient/another' } }],
    ['a different dose', { dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 2, unit: 'TAB' } }] }] }],
    ['a self-pay record', { note: [{ text: '自購：Y' }] }],
  ])('keeps both rows for %s', async (_, overrides) => {
    const [hospital, cloud] = await marked(hospitalOrder(), cloudOrder(overrides))
    const result = reconcileMedicationRequests([hospital, cloud])
    expect(result).toHaveLength(2)
    expect(hospital._sourceRecordComparison?.status).not.toBe('confirmed')
  })

  it('keeps every row when two same-day claims fall in the identity', async () => {
    const [hospital, cloud, second] = await marked(hospitalOrder(), cloudOrder(),
      cloudOrder({ id: 'cloud-med-2', medicationCodeableConcept: { coding: [{ system: NHI, code: 'B024039100' }] } }))
    expect(reconcileMedicationRequests([hospital, cloud, second])).toHaveLength(3)
    expect(hospital._sourceRecordComparison.status).toBe('ambiguous')
  })

  it('pairs with the visit claim while a later 慢連箋 fill listed under the same visit keeps its own row', async () => {
    const [hospital, cloud, later] = await marked(hospitalOrder(), cloudOrder(), cloudOrder({ id: 'cloud-med-refill',
      extension: [{ url: MEDCLOUD_REFILL_DISPENSE_DAY_URL, valueString: '2026-10-15T00:00:00' }] }))
    const result = reconcileMedicationRequests([hospital, cloud, later])
    expect(result).toHaveLength(2)
    expect(hospital._sourceRecordComparison).toMatchObject({ status: 'confirmed' })
    expect(hospital._sourceRecordComparison.references).not.toContain('MedicationRequest/cloud-med-refill')
    expect(later._sourceRecordComparison).toBeUndefined()
  })

  it('keeps every row when two same-day hospital orders share the identity', async () => {
    const [hospital, other, cloud] = await marked(hospitalOrder(),
      hospitalOrder({ id: 'hospital-med-2', identifier: [{ system: 'urn:oid:vgh.medication.order', value: 'synthetic-case-2' }] }), cloudOrder())
    expect(reconcileMedicationRequests([hospital, other, cloud])).toHaveLength(3)
  })

  // MediCloud records only the frequency code, the hospital the full SIG.
  const sigOrders = (name: string, nhiCode: string, sig: string, frequency: string, cloudSig: string) => [
    hospitalOrder({ medicationCodeableConcept: { text: name, coding: [{ system: PRODUCT, code: name, display: name }] },
      dosageInstruction: [{ text: sig, timing: { code: { coding: [{ system: 'urn:oid:vgh.medication.frequency', code: frequency }] } } }] }),
    cloudOrder({ medicationCodeableConcept: { coding: [{ system: NHI, code: nhiCode }] }, dosageInstruction: [{ text: cloudSig }] }),
  ]

  it.each([
    ['QN', 'Progor * cap 120 mg', 'BC23001100', '1 CAP PO QN', 'QN'],
    ['Q5MPRN', 'Nitrostat tab 0.6 mg', 'BC20802100', 'X25 TAB SL Q5MPRN', 'Q5MPRN'],
  ])('merges when the cloud records only the same %s frequency', async (_, name, nhiCode, sig, frequency) => {
    const [hospital, cloud] = await marked(...sigOrders(name, nhiCode, sig, frequency, frequency))
    expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(1)
    expect(hospital._sourceRecordComparison).toMatchObject({ status: 'confirmed' })
  })

  it('keeps both rows when the cloud frequency code differs', async () => {
    const [hospital, cloud] = await marked(...sigOrders('Progor * cap 120 mg', 'BC23001100', '1 CAP PO QN', 'QN', 'QD'))
    expect(reconcileMedicationRequests([hospital, cloud])).toHaveLength(2)
  })

  it('does not pair by name when the hospital order has no index mark', () => {
    expect(reconcileMedicationRequests([hospitalOrder(), cloudOrder()])).toHaveLength(2)
  })
})
