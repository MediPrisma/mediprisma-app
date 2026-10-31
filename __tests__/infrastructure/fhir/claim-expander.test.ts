// Coverage for TW-PAS (事前審查申請) Claim support. A PAS bundle carries its
// clinical content inside a single Claim resource (diagnosis / procedure /
// weight+height supportingInfo / narrative / requested drug). Without the
// expander the app has no Claim mapper, so a PAS bundle renders almost nothing.
//
// These tests lock in that parse() unpacks a Claim into the standard resources
// the rest of the pipeline already renders, and backfills the PAS Encounter's
// missing visit date. The fixture mirrors Bundle_claim_10_fixed.json (urn:uuid
// references, so it also exercises canonicalisation end-to-end).

import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { decodeBase64Utf8 } from '@/src/shared/utils/base64.utils'

function pasBundle(): any {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: 'urn:uuid:pat-1',
        resource: {
          resourceType: 'Patient',
          gender: 'female',
          birthDate: '1957-03-13',
          name: [{ text: '李淑貞' }],
        },
      },
      {
        fullUrl: 'urn:uuid:enc-1',
        resource: {
          // PAS Encounter: no period.start, no subject — both backfilled.
          resourceType: 'Encounter',
          status: 'finished',
          class: { code: 'AMB' },
          serviceType: {
            coding: [{ code: 'AF', display: '血液腫瘤科' }],
          },
        },
      },
      {
        fullUrl: 'urn:uuid:mr-1',
        resource: {
          resourceType: 'MedicationRequest',
          status: 'on-hold',
          intent: 'plan',
          medicationCodeableConcept: {
            coding: [{ code: 'KC01025219', display: 'KEYTRUDA INJECTION' }],
          },
          subject: { reference: 'urn:uuid:pat-1' },
          // No authoredOn / encounter — both backfilled from the Claim.
        },
      },
      {
        fullUrl: 'urn:uuid:claim-1',
        resource: {
          resourceType: 'Claim',
          identifier: [{ value: 'oldAcptNo_00000000' }],
          extension: [
            {
              url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-claim-encounter',
              valueReference: { reference: 'urn:uuid:enc-1' },
            },
          ],
          status: 'active',
          use: 'preauthorization',
          patient: { reference: 'urn:uuid:pat-1' },
          created: '2024-11-28',
          supportingInfo: [
            {
              sequence: 1,
              category: { coding: [{ code: 'weight' }] },
              valueQuantity: { code: 'kg', system: 'http://unitsofmeasure.org', value: 59 },
            },
            {
              sequence: 2,
              category: { coding: [{ code: 'height' }] },
              valueQuantity: { code: 'cm', system: 'http://unitsofmeasure.org', value: 155 },
            },
          ],
          diagnosis: [
            {
              sequence: 1,
              extension: [
                {
                  url: 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-diagnosisRecordedDate',
                  valueDate: '2023-05-10',
                },
              ],
              diagnosisCodeableConcept: {
                coding: [{ code: 'C43.31', display: '鼻惡性黑色素瘤' }],
              },
              type: [{ text: '病人66歲女性於2023/5月外院發現Right sinonasal mucosal melanoma。' }],
            },
          ],
          procedure: [
            {
              sequence: 1,
              date: '2024-11-28',
              procedureCodeableConcept: {
                coding: [{ code: '0016070', display: '開放性腦室至鼻咽繞道術' }],
              },
            },
          ],
          item: [
            {
              sequence: 1,
              extension: [
                {
                  url: 'https://twcore.mohw.gov.tw/ig/pas/StructureDefinition/extension-requestedService',
                  valueReference: { reference: 'urn:uuid:mr-1' },
                },
              ],
              productOrService: { coding: [{ code: '4', display: '癌症用藥' }] },
            },
          ],
        },
      },
    ],
  }
}

describe('TW-PAS Claim expander', () => {
  const parsed = LocalBundleService.parse(pasBundle())!

  it('parses the bundle (patient present)', () => {
    expect(parsed).not.toBeNull()
    expect(JSON.stringify(parsed.patient.name)).toContain('李淑貞')
  })

  it('synthesises a Condition from Claim.diagnosis with the ICD code and dates', () => {
    const cond = parsed.collection.conditions.find(
      (c) => c.code?.coding?.[0]?.code === 'C43.31',
    )
    expect(cond).toBeDefined()
    expect(cond!.recordedDate).toBe('2023-05-10')
    expect(cond!.encounter?.reference).toBe(`Encounter/${parsed.collection.encounters[0].id}`)
  })

  it('synthesises weight & height vital-sign Observations', () => {
    const weight = parsed.collection.vitalSigns.find(
      (o) => o.code?.coding?.[0]?.code === '29463-7',
    )
    const height = parsed.collection.vitalSigns.find(
      (o) => o.code?.coding?.[0]?.code === '8302-2',
    )
    expect(weight?.valueQuantity?.value).toBe(59)
    expect(weight?.valueQuantity?.unit).toBe('kg')
    expect(height?.valueQuantity?.value).toBe(155)
    expect(height?.effectiveDateTime).toBe('2024-11-28')
  })

  it('synthesises a Procedure from Claim.procedure', () => {
    const proc = parsed.collection.procedures.find(
      (p) => p.code?.coding?.[0]?.code === '0016070',
    )
    expect(proc).toBeDefined()
    expect(proc!.performedDateTime).toBe('2024-11-28')
  })

  it('synthesises a readable narrative DocumentReference from diagnosis.type.text', () => {
    const doc = parsed.collection.documentReferences.find(
      (d) => d.id === 'claim-claim-1-narrative',
    )
    expect(doc).toBeDefined()
    const decoded = decodeBase64Utf8(doc!.content?.[0]?.attachment?.data)
    expect(decoded).toContain('Right sinonasal mucosal melanoma')
    expect(doc!.content?.[0]?.attachment?.contentType).toBe('text/html')
  })

  it('backfills the requested MedicationRequest date & visit from the Claim', () => {
    const mr = parsed.collection.medications.find(
      (m) => m.medicationCodeableConcept?.coding?.[0]?.code === 'KC01025219',
    )
    expect(mr?.authoredOn).toBe('2024-11-28')
    expect(mr?.encounter?.reference).toBe(`Encounter/${parsed.collection.encounters[0].id}`)
  })

  it('backfills the PAS Encounter visit date from Claim.created', () => {
    const enc = parsed.collection.encounters[0]
    expect(enc.period?.start).toBe('2024-11-28')
  })

  it('is a no-op for a bundle with no Claim', () => {
    const noClaim: any = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { fullUrl: 'urn:uuid:p', resource: { resourceType: 'Patient', name: [{ text: 'X' }] } },
      ],
    }
    const out = LocalBundleService.parse(noClaim)!
    expect(out.collection.conditions).toHaveLength(0)
    expect(out.collection.procedures).toHaveLength(0)
  })
})
