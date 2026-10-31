import { renderHook } from '@testing-library/react'
import fixture from '@/e2e/fixtures/cross-source-prescriptions.json'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { useMedicationRows } from '@/features/clinical-summary/medications/hooks/useMedicationRows'
import { useMedicationTimeline } from '@/features/clinical-summary/medications/timeline/hooks/useMedicationTimeline'
import { excludeUnresolvedDecisionVariants } from '@/src/core/utils/clinical-variant-inputs'
import { complementHospitalFromCloud } from '@/src/shared/utils/medication-source-complement'
import { MEDCLOUD_ATC_LEVEL_3_URL, MEDCLOUD_SOURCE_SETTING_URL } from '@/src/shared/constants/medcloud.constants'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => Date.parse('2026-10-20T04:00:00+08:00') }))

const ICD = [{ text: '乳房惡性腫瘤', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'C50.912', display: '乳房惡性腫瘤' }] }]
const CATEGORY = [{ text: '抗腫瘤藥', coding: [{ display: 'ANTINEOPLASTIC AGENTS' }] }]
const PLAC = { system: 'urn:oid:vgh.medication.order', value: 'SYNTHETIC-ORDER-A',
  type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'PLAC' }] } }

/** The synthetic Aromasin pair: the hospital order records 臺北榮總 only; its
 * MediCloud copy also records 門診, a billing diagnosis, a drug class and ATC3.
 * Confirmed: the same visit, recorded drug code and prescription identifier. */
function bundle(confirmed: boolean) {
  const input: any = JSON.parse(JSON.stringify(fixture))
  const resource = (id: string) => input.entry.find((entry: any) => entry.resource.id === id).resource
  const cloud = resource('synthetic-cloud-order-a')
  cloud.reasonCode = ICD
  cloud.category = CATEGORY
  cloud.extension = [...(cloud.extension ?? []), { url: MEDCLOUD_ATC_LEVEL_3_URL, valueCoding: { code: 'L02B', display: 'HORMONE ANTAGONISTS' } }]
  if (confirmed) {
    // One shared, confirmed visit (no cross-source visit pairing), the same
    // recorded drug code and a shared prescription identifier.
    const hospital = resource('synthetic-order-a')
    hospital.identifier = [PLAC]
    hospital.medicationCodeableConcept.coding.push(...cloud.medicationCodeableConcept.coding)
    cloud.identifier = [PLAC]
    input.entry = input.entry.filter((entry: any) => entry.resource.resourceType !== 'Encounter')
    input.entry.push({ resource: { resourceType: 'Encounter', id: 'synthetic-shared-visit', status: 'finished', class: { code: 'AMB' },
      subject: hospital.subject, period: { start: hospital.authoredOn } } })
    for (const entry of input.entry) {
      if (entry.resource.resourceType === 'MedicationRequest') entry.resource.encounter = { reference: 'Encounter/synthetic-shared-visit' }
    }
  }
  return LocalBundleService.parse(input)!.collection
}

describe.each([['candidate', false], ['confirmed', true]])('a %s hospital/MediCloud pair', (status, confirmed) => {
  it('keeps the cloud row visit context on the merged row, the timeline and the AI/CDSS record alike', () => {
    const collection = bundle(confirmed)
    const rows = renderHook(() => useMedicationRows(collection.medications)).result.current
    const row = rows.find(item => item.id === 'synthetic-order-a')!
    expect(row.sourceComparison?.status).toBe(status)
    expect(rows.some(item => item.id === 'synthetic-cloud-order-a')).toBe(false)
    expect(row).toMatchObject({ dataOrigin: 'hospital', pharmacy: '臺北榮總 門診', icdCode: 'C50.912', icdText: '乳房惡性腫瘤' })
    // The drug class follows the cloud row's own rule (ATC3 before source class).
    expect(row.category).toBe('HORMONE ANTAGONISTS')
    // Hospital clinical facts still win; the cloud code is not attributed to an unconfirmed pair.
    expect(row).toMatchObject({ route: 'PO', durationDays: 28 })
    if (!confirmed) expect(row.nhiDrugCode).toBeUndefined()
    // The source records shown on inspection stay as recorded.
    const hospitalSource = row.sourceComparison!.records.find(record => record.dataOrigin === 'hospital')!
    expect(hospitalSource.pharmacy).toBe('臺北榮總')
    expect(hospitalSource.icdCode).toBeUndefined()

    const timeline = renderHook(() => useMedicationTimeline(collection.medications, 'medical', 'all', '其他', 'zh-TW')).result.current
    const bar = timeline.drugs.flatMap(drug => drug.bars).find(item => item.icdCode === 'C50.912')
    expect(bar).toMatchObject({ icdText: '乳房惡性腫瘤' })

    const decision = excludeUnresolvedDecisionVariants({ medications: collection.medications }).medications as any[]
    const record = decision.find(item => item.id === 'synthetic-order-a')
    expect(decision.some(item => item.id === 'synthetic-cloud-order-a')).toBe(false)
    expect(record.reasonCode).toEqual(ICD)
    expect(record.category).toEqual(CATEGORY)
    expect(record.requester.display).toBe('臺北榮總;門診')
    expect(record.extension.some((extension: any) => extension.url === MEDCLOUD_ATC_LEVEL_3_URL)).toBe(true)
    expect(record.dosageInstruction[0].text).toBe('1 TAB PO QDPC')
  })
})

it('does not mutate the imported records', () => {
  const collection = bundle(false)
  const before = JSON.stringify(collection.medications)
  renderHook(() => useMedicationRows(collection.medications))
  excludeUnresolvedDecisionVariants({ medications: collection.medications })
  expect(JSON.stringify(collection.medications)).toBe(before)
})

describe('complementHospitalFromCloud', () => {
  const meta = { source: 'https://medcloud2.nhi.gov.tw/' }
  const hospital = { id: 'h', meta: { source: 'ehr-fhir-bridge/scraper' }, requester: { display: '臺北榮總' },
    reasonCode: undefined as any, dosageInstruction: [{ text: '1 TAB PO QD' }] }

  it('never substitutes another institution, overwrites a recorded value or copies clinical facts', () => {
    const other = complementHospitalFromCloud(hospital, [{ id: 'c', meta, requester: { display: '振興醫院;門診' },
      dosageInstruction: [{ text: 'BID' }], status: 'active', dispenseRequest: { quantity: { value: 56 } } }])
    expect(other.requester.display).toBe('臺北榮總')
    expect(other).not.toHaveProperty('status')
    expect(other).not.toHaveProperty('dispenseRequest')
    expect(other.dosageInstruction[0].text).toBe('1 TAB PO QD')
    const recorded = complementHospitalFromCloud({ ...hospital, reasonCode: [{ text: 'hospital' }] }, [{ id: 'c', meta, reasonCode: ICD }])
    expect(recorded.reasonCode).toEqual([{ text: 'hospital' }])
  })

  it('adds a cloud value only when every cloud copy agrees', () => {
    const disagree = complementHospitalFromCloud(hospital, [{ id: 'c1', meta, reasonCode: ICD }, { id: 'c2', meta, reasonCode: [{ text: 'other' }] }])
    expect(disagree.reasonCode).toBeUndefined()
    const missing = complementHospitalFromCloud(hospital, [{ id: 'c1', meta, reasonCode: ICD }, { id: 'c2', meta }])
    expect(missing.reasonCode).toBeUndefined()
    const setting = { url: MEDCLOUD_SOURCE_SETTING_URL, valueString: '門診' }
    const agree = complementHospitalFromCloud(hospital, [{ id: 'c1', meta, extension: [setting] }, { id: 'c2', meta, extension: [setting] }])
    expect(agree.extension).toEqual([setting])
  })
})
