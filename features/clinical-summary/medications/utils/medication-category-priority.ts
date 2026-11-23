import type { MedicationRow } from '../types'

const COAGULATION_ATC_PREFIXES = ['B01', 'B02']
const COAGULATION_CATEGORY_PATTERN = /(?:抗凝|抗血小板|抗血小版|抗血栓|溶栓|止血|凝血因子|抗纖溶|anticoagul|antiplatelet|antithrombot|thrombol|fibrinol|antiha?emorrhag|ha?emostatic|coagulation factor)/i

/**
 * Prioritises classes that directly affect haemostasis or perioperative review.
 * Governed ATC B01/B02 codes are authoritative; text matching is only a fallback
 * for source records without structured drug-master terminology.
 */
export function isCoagulationOrSurgeryRelevant(
  row: Pick<MedicationRow, 'category' | 'drugTerminology' | 'hospitalAtcClassification'>,
): boolean {
  const terminology = row.drugTerminology
  const hospitalAtc = terminology ? undefined : row.hospitalAtcClassification
  const codes = [
    terminology?.atcCode,
    terminology?.atcLevel2Code,
    terminology?.atcLevel3Code,
    terminology?.atcLevel4Code,
    hospitalAtc?.atcCode,
    hospitalAtc?.atcLevel2Code,
    hospitalAtc?.atcLevel4Code,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase())

  if (codes.some((code) => COAGULATION_ATC_PREFIXES.some((prefix) => code.startsWith(prefix)))) {
    return true
  }

  if (codes.length > 0) return false
  return COAGULATION_CATEGORY_PATTERN.test(row.category?.trim() ?? '')
}
