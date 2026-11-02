import { complementHospitalOrderVisitContext } from '@/src/infrastructure/fhir/services/hospital-order-visit-context'

const HOSPITAL = { source: 'ehr-fhir-bridge/scraper' }
const CLOUD = { source: 'https://medcloud2.nhi.gov.tw/' }
const I259 = { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I25.9' }], text: '慢性缺血性心臟病' }

function graph(paired = true) {
  const hospitalVisit: any = { resourceType: 'Encounter', id: 'h-visit', meta: HOSPITAL, class: { code: 'AMB' },
    serviceProvider: { display: '臺北榮總' }, reasonCode: [{ coding: [{ code: 'I25.9' }], text: 'Chronic ischemic heart disease' }] }
  const cloudVisit: any = { resourceType: 'Encounter', id: 'c-visit', meta: CLOUD, class: { code: 'AMB' },
    serviceProvider: { display: '臺北榮總;門診;0601160016' }, reasonCode: [I259] }
  if (paired) {
    const comparison = { status: 'candidate', references: ['Encounter/h-visit', 'Encounter/c-visit'] }
    hospitalVisit._sourceRecordComparison = comparison
    cloudVisit._sourceRecordComparison = comparison
  }
  // A hospital-only order (no MediCloud copy, e.g. self-paid) of that visit.
  const order: any = { resourceType: 'MedicationRequest', id: 'plavix', meta: HOSPITAL, encounter: { reference: 'Encounter/h-visit' },
    medicationCodeableConcept: { text: 'Plavix FC tab 75 mg' }, dosageInstruction: [{ text: 'X90 TAB PO QD' }] }
  return { hospitalVisit, cloudVisit, order, resources: [hospitalVisit, cloudVisit, order] }
}

describe('hospital order visit context', () => {
  it('takes institution, care setting and diagnosis from the paired MediCloud visit', () => {
    const { order, resources } = graph()
    complementHospitalOrderVisitContext(resources)
    expect(order.requester.display).toBe('臺北榮總;門診;0601160016')
    expect(order.reasonCode).toEqual([I259])
    expect(order.dosageInstruction).toEqual([{ text: 'X90 TAB PO QD' }])
  })

  it('takes them from its own visit when no cloud visit is paired', () => {
    const { order, resources } = graph(false)
    complementHospitalOrderVisitContext(resources)
    expect(order.requester.display).toBe('臺北榮總;門診')
    expect(order.reasonCode[0].coding[0].code).toBe('I25.9')
  })

  it('never overwrites what the order records, and leaves cloud and non-outpatient orders alone', () => {
    const { order, hospitalVisit, resources } = graph()
    order.requester = { display: '臺北榮總;急診' }
    order.reasonCode = [{ text: 'own' }]
    const cloudOrder: any = { resourceType: 'MedicationRequest', id: 'cloud', meta: CLOUD, encounter: { reference: 'Encounter/c-visit' } }
    complementHospitalOrderVisitContext([...resources, cloudOrder])
    expect(order.requester.display).toBe('臺北榮總;急診')
    expect(order.reasonCode).toEqual([{ text: 'own' }])
    expect(cloudOrder.requester).toBeUndefined()
    // An order paired with a MediCloud medication copy takes that copy's context instead.
    const paired = graph()
    paired.order._sourceRecordComparison = { status: 'candidate', references: ['MedicationRequest/plavix', 'MedicationRequest/cloud'] }
    complementHospitalOrderVisitContext(paired.resources)
    expect(paired.order.requester).toBeUndefined()
    const inpatient = graph()
    inpatient.hospitalVisit.class = { code: 'IMP' }
    complementHospitalOrderVisitContext(inpatient.resources)
    expect(inpatient.order.requester).toBeUndefined()
    expect(hospitalVisit.class.code).toBe('AMB')
  })
})
