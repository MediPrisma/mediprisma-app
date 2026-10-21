import {
  enrichBundleWithNhiDrugTerminology,
  NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
  NHI_DRUG_ENRICHMENT_POLICY_VERSION,
} from '@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

const NHI_DRUG_CODE_SYSTEM =
  'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code'
const TW_CORE_MEDICATION_NHI_CODE_SYSTEM =
  'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw'

function resources(bundle: Record<string, any>, resourceType: string) {
  return (bundle.entry ?? [])
    .map((entry: any) => entry?.resource)
    .filter((resource: any) => resource?.resourceType === resourceType)
}

function medicationRequest(overrides: Record<string, unknown> = {}) {
  return {
    resourceType: 'MedicationRequest',
    id: 'mr-1',
    status: 'active',
    intent: 'order',
    authoredOn: '2024-04-01T09:00:00+08:00',
    medicationCodeableConcept: {
      coding: [{
        system: NHI_DRUG_CODE_SYSTEM,
        code: 'AC49322100',
        display: 'SOURCE DISPLAY MUST REMAIN',
      }],
      text: '來源藥名不可被覆寫',
    },
    ...overrides,
  }
}

function bundleWith(...inputResources: Record<string, unknown>[]) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: '2026-07-29T12:00:00Z',
    entry: inputResources.map((resource) => ({ resource })),
  }
}

describe('App-side NHI drug terminology enrichment', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not load or alter anything when no exact NHI medication is eligible', async () => {
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      medicationRequest({
        medicationCodeableConcept: {
          coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '42347' }],
          text: 'Bupropion',
        },
      }),
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)

    expect(result.bundle).toBe(source)
    expect(result.report).toMatchObject({
      status: 'not-applicable',
      medicationRequestCount: 1,
      eligibleRequestCount: 0,
      linkedRequestCount: 0,
      skipped: { missingNhiDrugCode: 1 },
    })
  })

  it('adds date-effective MedicationKnowledge and Provenance without rewriting source fields', async () => {
    const sourceRequest = medicationRequest()
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      sourceRequest,
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)
    const request = resources(result.bundle, 'MedicationRequest')[0]
    const knowledge = resources(result.bundle, 'MedicationKnowledge')[0]
    const provenance = resources(result.bundle, 'Provenance')[0]

    expect(result.report).toMatchObject({
      status: 'enriched',
      snapshotId: 'nhi-drug-terminology-20260728',
      medicationRequestCount: 1,
      eligibleRequestCount: 1,
      linkedRequestCount: 1,
      knowledgeResourceCount: 1,
      atcResolvedCount: 1,
      byResolutionStatus: { resolved: 1 },
    })
    expect(sourceRequest).not.toHaveProperty('supportingInformation')
    expect(request.medicationCodeableConcept).toEqual(
      sourceRequest.medicationCodeableConcept,
    )
    expect(request.supportingInformation).toEqual([
      { reference: `MedicationKnowledge/${knowledge.id}` },
    ])
    expect(knowledge).toMatchObject({
      resourceType: 'MedicationKnowledge',
      meta: {
        tag: expect.arrayContaining([{
          system: NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
          code: NHI_DRUG_ENRICHMENT_POLICY_VERSION,
          display: 'Use the latest covered drug record for newer prescriptions',
        }]),
      },
      code: {
        coding: [{
          system: NHI_DRUG_CODE_SYSTEM,
          version: 'nhi-drug-terminology-20260728',
          code: 'AC49322100',
          display: 'Buprotrin sustained release F.C. Tablets 150mg 〝Royal〞',
        }],
      },
      doseForm: { text: '持續性藥效膜衣錠' },
      ingredient: [{
        itemCodeableConcept: { text: 'BUPROPION HYDROCHLORIDE 150 MG' },
      }],
      medicineClassification: expect.any(Array),
    })
    expect(knowledge.medicineClassification[0].classification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coding: [expect.objectContaining({ code: 'N06AX12', display: 'bupropion' })],
        }),
        expect.objectContaining({
          coding: [expect.objectContaining({
            version: 'atc-level2-2026',
            code: 'N06',
            display: 'PSYCHOANALEPTICS',
          })],
          text: '精神興奮／抗憂鬱與失智相關用藥',
        }),
        expect.objectContaining({
          coding: [expect.objectContaining({
            version: 'atc-hierarchy-2026',
            code: 'N06A',
            display: 'ANTIDEPRESSANTS',
          })],
          text: '抗憂鬱藥',
        }),
        expect.objectContaining({
          coding: [expect.objectContaining({
            version: 'atc-hierarchy-2026',
            code: 'N06AX',
            display: 'Other antidepressants',
          })],
          text: '其他抗憂鬱藥',
        }),
      ]),
    )
    expect(provenance).toMatchObject({
      resourceType: 'Provenance',
      recorded: '2026-07-29T12:00:00Z',
      target: [{ reference: `MedicationKnowledge/${knowledge.id}` }],
      entity: [{
        what: {
          display: expect.stringContaining('SHA-256'),
        },
      }, {
        what: {
          identifier: { value: 'atc-hierarchy-2026' },
        },
      }],
    })
  })

  it('accepts the TW Core medication-nhi-tw URI used by MedCloud bundles', async () => {
    const sourceRequest = medicationRequest({
      authoredOn: '2026-07-01',
      medicationCodeableConcept: {
        coding: [{
          system: TW_CORE_MEDICATION_NHI_CODE_SYSTEM,
          code: 'BC23097100',
          display: 'AROMASIN SUGAR COATED TABLETS 25MG',
        }],
        text: 'AROMASIN SUGAR COATED TABLETS 25MG',
      },
    })

    const result = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p1' },
        sourceRequest,
      ),
    )
    const request = resources(result.bundle, 'MedicationRequest')[0]
    const parsed = LocalBundleService.parse(result.bundle)

    expect(result.report).toMatchObject({
      status: 'enriched',
      eligibleRequestCount: 1,
      linkedRequestCount: 1,
      atcResolvedCount: 1,
      skipped: { missingNhiDrugCode: 0 },
    })
    expect(request.medicationCodeableConcept).toEqual(
      sourceRequest.medicationCodeableConcept,
    )
    expect(parsed?.collection.medications[0]?.drugTerminology).toMatchObject({
      atcCode: 'L02BG06',
      atcLevel2Code: 'L02',
      atcLevel4Code: 'L02BG',
    })
  })

  it('uses a source WHO ATC code as a governed grouping fallback when the NHI lookup misses', async () => {
    const sourceRequest = medicationRequest({
      authoredOn: '2026-07-01',
      medicationCodeableConcept: {
        coding: [{
          system: TW_CORE_MEDICATION_NHI_CODE_SYSTEM,
          code: 'ZZ00000000',
          display: 'SOURCE PRODUCT NAME',
        }, {
          system: 'http://www.whocc.no/atc',
          code: 'A10BK01',
          display: 'dapagliflozin',
        }],
        text: '來源藥品名稱',
      },
    })
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      sourceRequest,
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)
    const parsed = LocalBundleService.parse(result.bundle)
    const medication = parsed?.collection.medications[0]

    expect(result.report).toMatchObject({
      status: 'enriched',
      eligibleRequestCount: 1,
      linkedRequestCount: 0,
      atcResolvedCount: 0,
      sourceAtcFallbackCount: 1,
    })
    expect(sourceRequest).not.toHaveProperty('drugTerminology')
    expect(sourceRequest).not.toHaveProperty('atcClassification')
    expect(medication?.drugTerminology).toBeUndefined()
    expect(medication?.medicationCodeableConcept).toEqual(
      sourceRequest.medicationCodeableConcept,
    )
    expect(medication?.atcClassification).toMatchObject({
      source: 'source-who-atc',
      atcCode: 'A10BK01',
      atcNameEn: 'dapagliflozin',
      atcLevel2Code: 'A10',
      atcLevel2NameEn: 'DRUGS USED IN DIABETES',
      atcLevel2NameZh: '糖尿病用藥',
      atcLevel3Code: 'A10B',
      atcLevel4Code: 'A10BK',
      atcLevel4NameEn: 'Sodium-glucose co-transporter 2 (SGLT2) inhibitors',
      atcLevel4NameZh: 'SGLT2 抑制劑',
      atcHierarchySnapshotId: 'atc-hierarchy-2026',
    })
  })

  it('uses the latest covered drug record when a prescription is newer than the snapshot', async () => {
    const sourceRequest = medicationRequest({
      authoredOn: '2026-08-12T00:00:00+08:00',
      medicationCodeableConcept: {
        coding: [{
          system: NHI_DRUG_CODE_SYSTEM,
          code: 'AB45993100',
          display: 'ACTEIN EFFERVESCENT TABLETS 600MG',
        }],
        text: '愛克痰發泡錠600毫克',
      },
    })
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      sourceRequest,
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)
    const request = resources(result.bundle, 'MedicationRequest')[0]
    const knowledge = resources(result.bundle, 'MedicationKnowledge')[0]

    expect(result.report).toMatchObject({
      status: 'enriched',
      eligibleRequestCount: 1,
      linkedRequestCount: 1,
      atcResolvedCount: 1,
      byResolutionStatus: { resolved: 1 },
    })
    expect(request.authoredOn).toBe(sourceRequest.authoredOn)
    expect(request.medicationCodeableConcept).toEqual(
      sourceRequest.medicationCodeableConcept,
    )
    expect(request.supportingInformation).toEqual([
      { reference: `MedicationKnowledge/${knowledge.id}` },
    ])
    expect(knowledge).toMatchObject({
      code: {
        coding: [{
          system: NHI_DRUG_CODE_SYSTEM,
          version: 'nhi-drug-terminology-20260728',
          code: 'AB45993100',
          display: 'ACTEIN EFFERVESCENT TABLETS 600MG',
        }],
        text: '愛克痰發泡錠600毫克',
      },
      ingredient: [{
        itemCodeableConcept: { text: 'ACETYLCYSTEINE 600 MG' },
      }],
    })
  })

  it('is idempotent and keeps one link, one knowledge resource, and one provenance', async () => {
    const once = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p1' },
        medicationRequest(),
      ),
    )
    const twice = await enrichBundleWithNhiDrugTerminology(once.bundle)

    expect(resources(twice.bundle, 'MedicationRequest')[0].supportingInformation)
      .toHaveLength(1)
    expect(resources(twice.bundle, 'MedicationKnowledge')).toHaveLength(1)
    expect(resources(twice.bundle, 'Provenance')).toHaveLength(1)
    expect(twice.report).toMatchObject({
      status: 'enriched',
      linkedRequestCount: 1,
      knowledgeResourceCount: 0,
    })
  })

  it('upgrades an older knowledge resource in place with the level 2-4 hierarchy', async () => {
    const current = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p1' },
        medicationRequest(),
      ),
    )
    const oldBundle = JSON.parse(
      JSON.stringify(current.bundle),
    ) as Record<string, any>
    const oldKnowledge = resources(oldBundle, 'MedicationKnowledge')[0]
    oldKnowledge.medicineClassification[0].classification =
      oldKnowledge.medicineClassification[0].classification
        .filter((classification: any) =>
          classification?.coding?.[0]?.code !== 'N06')
    oldKnowledge.meta.tag = oldKnowledge.meta.tag.filter(
      (tag: any) =>
        tag?.system
        !== 'https://nhi-fhir-bridge.github.io/CodeSystem/atc-hierarchy-snapshot',
    )

    const upgraded = await enrichBundleWithNhiDrugTerminology(oldBundle)
    const knowledge = resources(upgraded.bundle, 'MedicationKnowledge')
    const provenance = resources(upgraded.bundle, 'Provenance')

    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].medicineClassification[0].classification)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          coding: [expect.objectContaining({
            code: 'N06',
            version: 'atc-level2-2026',
          })],
        }),
      ]))
    expect(provenance).toHaveLength(1)
    expect(provenance[0].entity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        what: expect.objectContaining({
          identifier: expect.objectContaining({
            value: 'atc-hierarchy-2026',
          }),
        }),
      }),
    ]))
  })

  it('fails closed for a missing date and for multiple NHI codes', async () => {
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      medicationRequest({ id: 'missing-date', authoredOn: undefined }),
      medicationRequest({
        id: 'ambiguous',
        medicationCodeableConcept: {
          coding: [
            { system: NHI_DRUG_CODE_SYSTEM, code: 'AC49322100' },
            { system: NHI_DRUG_CODE_SYSTEM, code: 'BC26476100' },
          ],
        },
      }),
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)

    expect(result.bundle).toBe(source)
    expect(result.report).toMatchObject({
      status: 'not-applicable',
      eligibleRequestCount: 0,
      linkedRequestCount: 0,
      skipped: {
        missingPrescriptionDate: 1,
        ambiguousNhiDrugCode: 1,
      },
    })
  })

  it('resolves a NHI code carried by a referenced Medication resource', async () => {
    const source = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      {
        resourceType: 'Medication',
        id: 'med-1',
        code: {
          coding: [{ system: NHI_DRUG_CODE_SYSTEM, code: 'AC49322100' }],
          text: '來源藥名',
        },
      },
      medicationRequest({
        medicationCodeableConcept: undefined,
        medicationReference: { reference: 'Medication/med-1' },
      }),
    )

    const result = await enrichBundleWithNhiDrugTerminology(source)

    expect(result.report.linkedRequestCount).toBe(1)
    expect(resources(result.bundle, 'MedicationKnowledge')).toHaveLength(1)
  })

  it('maps linked MedicationKnowledge into a separate App view model', async () => {
    const enriched = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p1' },
        medicationRequest(),
      ),
    )
    const parsed = LocalBundleService.parse(enriched.bundle)

    expect(parsed?.collection.medications[0]).toMatchObject({
      medicationCodeableConcept: {
        text: '來源藥名不可被覆寫',
      },
      drugTerminology: {
        source: 'nhi-official-drug-master',
        snapshotId: 'nhi-drug-terminology-20260728',
        officialNameZh: '〝皇佳〞慮舒妥 持續性藥效膜衣錠150毫克',
        officialNameEn: 'Buprotrin sustained release F.C. Tablets 150mg 〝Royal〞',
        ingredientText: 'BUPROPION HYDROCHLORIDE 150 MG',
        doseForm: '持續性藥效膜衣錠',
        atcCode: 'N06AX12',
        atcNameEn: 'bupropion',
        atcLevel2Code: 'N06',
        atcLevel2NameEn: 'PSYCHOANALEPTICS',
        atcLevel2NameZh: '精神興奮／抗憂鬱與失智相關用藥',
        atcLevel3Code: 'N06A',
        atcLevel3NameEn: 'ANTIDEPRESSANTS',
        atcLevel3NameZh: '抗憂鬱藥',
        atcLevel4Code: 'N06AX',
        atcLevel4NameEn: 'Other antidepressants',
        atcLevel4NameZh: '其他抗憂鬱藥',
        atcHierarchySnapshotId: 'atc-hierarchy-2026',
      },
    })
  })

  it('upgrades a stored pre-terminology bundle before medical rows are parsed', async () => {
    const stored = bundleWith(
      { resourceType: 'Patient', id: 'p1' },
      medicationRequest(),
    )
    jest.spyOn(LocalBundleService, 'load').mockResolvedValue(stored)
    const save = jest.spyOn(LocalBundleService, 'save').mockResolvedValue()

    const parsed = await LocalBundleService.parseStored()

    expect(parsed?.collection.medications[0]?.drugTerminology).toMatchObject({
      officialNameZh: '〝皇佳〞慮舒妥 持續性藥效膜衣錠150毫克',
      officialNameEn: 'Buprotrin sustained release F.C. Tablets 150mg 〝Royal〞',
      atcCode: 'N06AX12',
      atcLevel2Code: 'N06',
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(resources(
      save.mock.calls[0][0] as Record<string, any>,
      'MedicationKnowledge',
    )).toHaveLength(1)
  })

  it('performance contract: maps one stored Bundle once without dropping resources for concurrent consumers', async () => {
    const enriched = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p-complete' },
        medicationRequest({ id: 'mr-first' }),
        medicationRequest({ id: 'mr-last' }),
        {
          resourceType: 'Observation',
          id: 'obs-first',
          status: 'final',
          code: { text: 'Creatinine' },
          valueQuantity: { value: 1.1, unit: 'mg/dL' },
        },
        {
          resourceType: 'DiagnosticReport',
          id: 'report-last',
          status: 'final',
          code: { text: 'Complete report' },
          result: [{ reference: 'Observation/obs-first' }],
        },
      ),
    )
    // A fresh identity ensures this assertion cannot reuse another test's
    // WeakMap entry while still representing the exact persisted payload.
    const stored = JSON.parse(JSON.stringify(enriched.bundle)) as Record<string, any>
    jest.spyOn(LocalBundleService, 'load').mockResolvedValue(stored)
    const parse = jest.spyOn(LocalBundleService, 'parse')

    const [patientConsumer, clinicalConsumer, summaryConsumer] = await Promise.all([
      LocalBundleService.parseStored(),
      LocalBundleService.parseStored(),
      LocalBundleService.parseStored(),
    ])

    expect(parse).toHaveBeenCalledTimes(1)
    for (const result of [patientConsumer, clinicalConsumer, summaryConsumer]) {
      expect(result?.patient.id).toBe('p-complete')
      expect(result?.collection.medications.map((item) => item.id)).toEqual([
        'mr-first',
        'mr-last',
      ])
      expect(result?.collection.observations.map((item) => item.sourceId)).toContain('obs-first')
      expect(result?.collection.diagnosticReports.map((item) => item.sourceId)).toContain('report-last')
    }
    // Consumers share the immutable mapped collection; the patient overlay is
    // applied separately and therefore cannot thin the AI input.
    expect(clinicalConsumer?.collection).toBe(summaryConsumer?.collection)
  })

  it('re-runs enrichment once for a stored bundle created under the older date policy', async () => {
    const previouslyEnriched = await enrichBundleWithNhiDrugTerminology(
      bundleWith(
        { resourceType: 'Patient', id: 'p1' },
        medicationRequest(),
      ),
    )
    const stored = JSON.parse(
      JSON.stringify(previouslyEnriched.bundle),
    ) as Record<string, any>
    for (const knowledge of resources(stored, 'MedicationKnowledge')) {
      knowledge.meta.tag = knowledge.meta.tag.filter(
        (tag: any) => tag?.system !== NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
      )
    }
    stored.entry.push({
      resource: medicationRequest({
        id: 'mr-future',
        authoredOn: '2026-08-12T00:00:00+08:00',
        medicationCodeableConcept: {
          coding: [{
            system: NHI_DRUG_CODE_SYSTEM,
            code: 'AB45993100',
          }],
          text: '愛克痰發泡錠600毫克',
        },
      }),
    })
    jest.spyOn(LocalBundleService, 'load').mockResolvedValue(stored)
    const save = jest.spyOn(LocalBundleService, 'save').mockResolvedValue()

    const parsed = await LocalBundleService.parseStored()

    expect(parsed?.collection.medications.find(
      (medication) => medication.id === 'mr-future',
    )?.drugTerminology).toMatchObject({
      officialNameEn: 'ACTEIN EFFERVESCENT TABLETS 600MG',
      ingredientText: 'ACETYLCYSTEINE 600 MG',
    })
    expect(save).toHaveBeenCalledTimes(1)
    const saved = save.mock.calls[0][0] as Record<string, any>
    expect(resources(saved, 'MedicationKnowledge')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({
            tag: expect.arrayContaining([
              expect.objectContaining({
                system: NHI_DRUG_ENRICHMENT_POLICY_TAG_SYSTEM,
                code: NHI_DRUG_ENRICHMENT_POLICY_VERSION,
              }),
            ]),
          }),
        }),
      ]),
    )
  })
})
