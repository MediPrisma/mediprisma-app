import { applyNhiDictionaryErrata } from '@/src/infrastructure/fhir/nhi-dictionary-errata'
import { enrichBundleWithNhiDrugTerminology } from '@/src/infrastructure/fhir/services/nhi-drug-terminology-enrichment.service'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

const base = { source: 'nhi-official-drug-master' as const, snapshotId: 'nhi-drug-terminology-20260728' }

describe('applyNhiDictionaryErrata', () => {
  it('replaces an erroneous ingredient and keeps the dictionary value beside it', () => {
    expect(applyNhiDictionaryErrata('BC20144289', { ...base, ingredientText: 'AMPICILLIN SODIUM .5 GM' })).toEqual({
      ...base,
      ingredientText: 'SULBACTAM (SODIUM) .25 GM+AMPICILLIN (SODIUM) .5 GM',
      officialIngredientText: 'AMPICILLIN SODIUM .5 GM',
    })
  })

  it('leaves a row alone once the dictionary no longer carries the original value', () => {
    const fixedUpstream = { ...base, ingredientText: 'SULBACTAM (SODIUM) .25 GM+AMPICILLIN (SODIUM) .5 GM' }
    expect(applyNhiDictionaryErrata('BC20144289', fixedUpstream)).toBe(fixedUpstream)
    const otherValue = { ...base, ingredientText: 'AMPICILLIN SODIUM 1 GM' }
    expect(applyNhiDictionaryErrata('BC20144289', otherValue)).toBe(otherValue)
  })

  it('touches no other code', () => {
    const plain = { ...base, ingredientText: 'AMPICILLIN SODIUM .5 GM' }
    expect(applyNhiDictionaryErrata('AC49322100', plain)).toBe(plain)
    expect(applyNhiDictionaryErrata(undefined, plain)).toBe(plain)
  })
})

describe('a cloud medication read from a bundle', () => {
  it('carries the corrected ingredient while the stored MedicationKnowledge stays official', async () => {
    const result = await enrichBundleWithNhiDrugTerminology({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1' } },
        { resource: {
          resourceType: 'MedicationRequest', id: 'mr-unasyn', status: 'active', intent: 'order', authoredOn: '2026-07-01',
          medicationCodeableConcept: {
            coding: [{ system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw', code: 'BC20144289', display: 'UNASYN' }],
            text: 'UNASYN',
          },
        } },
      ],
    })
    const knowledge = (result.bundle as { entry: { resource: any }[] }).entry.map(e => e.resource).find((r: any) => r.resourceType === 'MedicationKnowledge')
    expect(knowledge.ingredient[0].itemCodeableConcept.text).toBe('AMPICILLIN SODIUM .5 GM')
    const medication = LocalBundleService.parse(result.bundle)?.collection.medications[0]
    expect(medication?.drugTerminology).toMatchObject({
      ingredientText: 'SULBACTAM (SODIUM) .25 GM+AMPICILLIN (SODIUM) .5 GM',
      officialIngredientText: 'AMPICILLIN SODIUM .5 GM',
    })
  })
})
