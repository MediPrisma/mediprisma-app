import { createFhirTools } from '@/src/infrastructure/ai/tools/fhir-tools'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { reconcileOutpatientEncounters } from '@/src/infrastructure/fhir/services/outpatient-encounter-reconciliation'

const ICD = 'http://hl7.org/fhir/sid/icd-10-cm'
const sharedVisitIdentifier = [{
  system: 'https://synthetic.example/visit-id', value: 'shared-visit',
  type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'VN' }] },
}]

it('keeps visits separate without a shared visit identifier', () => {
  const resources = confirmedPair()
  for (const encounter of resources.filter(resource => resource.resourceType === 'Encounter')) delete encounter.identifier
  expect(reconcileOutpatientEncounters(resources).filter(resource => resource.resourceType === 'Encounter')).toHaveLength(2)
})

it('retargets hospital-linked medication, lab, procedure, and imaging rows after a confirmed merge, including AI encounter details', async () => {
  const resources: any[] = [
    { resourceType: 'Patient', id: 'synthetic' },
    ...confirmedPair(),
    { resourceType: 'Condition', id: 'hospital-diagnosis', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/hospital-visit' }, code: { text: 'Synthetic diagnosis', coding: [{ system: ICD, code: 'B02.9' }] } },
    { resourceType: 'MedicationRequest', id: 'medication', status: 'active', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/hospital-visit' }, authoredOn: '2026-09-17', medicationCodeableConcept: { text: 'Synthetic medication' } },
    { resourceType: 'Observation', id: 'lab', status: 'final', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/hospital-visit' }, code: { text: 'Synthetic lab' }, valueQuantity: { value: 7, unit: 'mg/dL' } },
    { resourceType: 'Procedure', id: 'procedure', status: 'completed', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/hospital-visit' }, code: { text: 'Synthetic procedure' }, performedDateTime: '2026-09-17' },
    { resourceType: 'ImagingStudy', id: 'imaging', status: 'available', subject: { reference: 'Patient/synthetic' }, encounter: { reference: 'Encounter/hospital-visit' }, started: '2026-09-17', description: 'Synthetic imaging study' },
  ]
  const original = JSON.stringify(resources)
  const imported = LocalBundleService.parse({ resourceType: 'Bundle', type: 'collection', entry: resources.map(resource => ({ resource })) } as any)!
  const collection = imported.collection

  expect(collection.encounters).toHaveLength(1)
  expect(collection.encounters[0].id).toBe('cloud-visit')
  for (const rows of [collection.medications, collection.observations, collection.procedures, collection.imagingStudies]) {
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).encounter?.reference).toBe('Encounter/cloud-visit')
  }

  const tools = createFhirTools(() => ({ patient: imported.patient, collection }))
  const details = await (tools.getEncounterDetails as any).execute({ encounterId: collection.encounters[0].id })
  expect(details.success).toBe(true)
  expect(details.incomplete).toBeUndefined()
  expect(details.encounterLinkUncertainty).toBeUndefined()
  expect(details.data.medications).toHaveLength(1)
  expect(details.data.observations).toHaveLength(1)
  expect(details.data.procedures).toHaveLength(1)
  expect(details.data.imagingStudies).toHaveLength(1)
  expect(JSON.stringify(resources)).toBe(original)
})

function confirmedPair(): any[] {
  return [
    {
      resourceType: 'Encounter', id: 'cloud-visit', status: 'finished', class: { code: 'AMB' },
      identifier: JSON.parse(JSON.stringify(sharedVisitIdentifier)), meta: { source: 'https://medcloud2.nhi.gov.tw/' },
      subject: { reference: 'Patient/synthetic' }, period: { start: '2026-09-17' },
      serviceProvider: { display: '臺北榮總;門診' },
      reasonCode: [{ text: 'Synthetic diagnosis', coding: [{ system: ICD, code: 'B02.9' }] }],
    },
    {
      resourceType: 'Encounter', id: 'hospital-visit', status: 'finished', class: { code: 'AMB' },
      identifier: JSON.parse(JSON.stringify(sharedVisitIdentifier)),
      meta: { source: 'https://web9.vghtpe.gov.tw/emr/qemr/' },
      subject: { reference: 'Patient/synthetic' }, period: { start: '2026-09-17T00:00:00+08:00' },
      reasonCode: [{ text: 'Synthetic diagnosis', coding: [{ system: ICD, code: 'B02.9' }] }],
    },
  ]
}
