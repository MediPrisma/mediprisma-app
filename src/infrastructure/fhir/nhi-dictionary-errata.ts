// Verified errors in the official NHI drug dictionary (data.gov.tw 23715),
// applied when a medication's terminology is read, never written into the
// stored MedicationKnowledge: the snapshot and every saved bundle stay the
// official record, and removing an entry restores it. An entry applies only
// while the dictionary still carries its `original` value, so a later
// snapshot that fixes or changes the row is left alone (see
// docs/NHI-DRUG-DICTIONARY-ERRATA.md). Hospital rows already carry these
// corrections through the hospital medication index; this brings cloud rows
// in line, for the medication list, the interaction check and every reader.
import errata from './data/nhi-dictionary-errata.json'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'

type Terminology = NonNullable<MedicationEntity['drugTerminology']>

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()

const INGREDIENT = new Map(
  errata.entries
    .filter(entry => entry.field === 'ingredientText')
    .map(entry => [entry.nhiDrugCode, entry] as const),
)

export function applyNhiDictionaryErrata(nhiDrugCode: string | undefined, terminology: Terminology): Terminology {
  const entry = nhiDrugCode ? INGREDIENT.get(nhiDrugCode) : undefined
  if (!entry || !terminology.ingredientText || normalized(terminology.ingredientText) !== normalized(entry.original)) {
    return terminology
  }
  return { ...terminology, ingredientText: entry.corrected, officialIngredientText: terminology.ingredientText }
}
