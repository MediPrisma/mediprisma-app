import { isNhiDrugCodeSystem } from './nhi-drug-terminology-enrichment.service'

const PRODUCT_SYSTEM = 'urn:oid:vgh.medication.product'
const NAME_SYSTEM = 'urn:oid:vgh.medication.name'
const GENERIC_SYSTEM = 'urn:oid:vgh.medication.generic'
const SNAPSHOT_TAG = 'https://nhi-fhir-bridge.github.io/CodeSystem/drug-terminology-snapshot'
const OFFICIAL_URL = 'https://nhi-fhir-bridge.github.io/IdentifierSystem/nhi-drug-official-url'

type Resource = Record<string, any>

function nameKey(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    : ''
}

// Product-level aliases checked against the bundled 20260728 official master.
// These establish the complete product (including strength/form and licence),
// unlike hospital-medication-names.ts's ingredient-only aliases. Do not add a
// generic/ingredient alias here or select one of a product's several NHI codes.
const VERIFIED_PRODUCTS = [
  { sourceName: 'Aromasin SC tab 25 mg', officialName: 'AROMASIN SUGAR COATED TABLETS 25MG', licence: '02023097', form: '糖衣錠' },
  { sourceName: 'Femara FC tab 2.5 mg', officialName: 'FEMARA FILM-COATED TABLETS 2.5MG', licence: '02022462', form: '膜衣錠' },
] as const

/** A complete literal product descriptor for non-destructive comparison.
 * A topical product's pack size is separate from its concentration: 2% 5 g
 * can be compared with 2% when the other source omits its tube size. Two
 * explicitly different pack sizes remain distinct. */
function productDescriptor(value: unknown): { name: string; pack?: string } | undefined {
  if (typeof value !== 'string') return undefined
  let name = value.normalize('NFKC').toLowerCase()
    .replace(/^[a-z][a-z\s-]*\(([a-z][a-z\s-]*)\)(?=[#*\s]*(?:tab|cap))/i, '$1 ')
    .replace(/[#*@]/g, ' ').replace(/([a-z])(?=\d)/gi, '$1 ')
    .replace(/\btablets?\b|\btabs?\b/g, 'tablet')
    .replace(/\bcapsules?\b|\bcaps?\b/g, 'capsule')
    .replace(/\boint\b/g, 'ointment').replace(/\s+/g, ' ').trim()
  const strength = name.match(/\d+(?:\.\d+)?\s*(?:(?:mg|mcg|g|iu)\b|%)/i)
  const form = name.match(/\b(?:tablet|capsule|injection|inj|cream|ointment|solution|gel|drops|patch(?:es)?|granules)\b/i)
  if (!strength || !form) return undefined
  const productName = name.slice(0, form.index!)
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/\b(?:mg|mcg|g|ml|iu|sugar|film|coated|extended|sustained|modified|controlled|enteric|delayed|release|sc|fc|xr|sr|mr|cr|ec|oral|topical|oph|ophthalmic|sterile|dry|powder|for|use|intravenous|intramuscular|subcutaneous)\b/g, '')
  if (!/\p{L}/u.test(productName)) return undefined
  const topical = /\b(?:cream|ointment|gel)\b/.test(name)
  if (topical && !/\d\s*%|\d\s*(?:mg|mcg|g|iu)\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:g|ml)\b/.test(name)) return undefined
  // A liquid's bottle/ampoule volume does not establish its drug strength.
  // Preserve explicit drug amounts (including injectable powder strengths),
  // percentages and mass/volume concentrations, but reject volume-only labels.
  const liquid = /\b(?:injection|inj|solution|drops)\b/.test(name)
  if (liquid && !/\d\s*(?:mg|mcg|iu)\b|\d\s*%|\d\s*g\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:g|ml)\b/.test(name)) return undefined
  const topicalPack = topical
    ? name.match(/^(.*\d\s*(?:%|(?:mg|mcg|g|iu)\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:g|ml)))\s+(\d+(?:\.\d+)?\s*(?:g|ml))(?:\s*\/?\s*(?:tub|tube|bottle))?$/) : undefined
  if (topicalPack) name = topicalPack[1]
  return { name: name.replace(/\s+/g, ''), ...(topicalPack ? { pack: topicalPack[2].replace(/\s+/g, '') } : {}) }
}

/** Suggest a comparison from complete recorded product names when raw FHIR
 * has no MedicationKnowledge. This never verifies a product code, confirms
 * prescription identity, or removes a source record. */
export function hospitalProductMayMatchConcept(concept: any, cloudConcept: any): boolean {
  const codings = concept?.coding ?? []
  if (codings.some((coding: any) => coding.system === GENERIC_SYSTEM)) return false
  const source = codings.filter((coding: any) => [NAME_SYSTEM, PRODUCT_SYSTEM].includes(coding.system))
  const names = [...new Set(source.flatMap((coding: any) => [coding.code, coding.display]).filter(Boolean))]
  const cloud = cloudConcept?.coding?.filter((coding: any) => isNhiDrugCodeSystem(coding.system) && coding.code) ?? []
  if (names.length !== 1 || cloud.length !== 1) return false
  const hospital = productDescriptor(names[0]), other = productDescriptor(cloud[0].display)
  return !!hospital && !!other && hospital.name === other.name
    && (!hospital.pack || !other.pack || hospital.pack === other.pack)
}

/** Compare a recorded hospital product with the official knowledge already
 * linked to this cloud prescription. Never creates an NHI code. Name-only
 * outpatient rows need a reviewed complete product alias; an explicitly
 * labelled brand field can also match a complete official label exactly.
 * Ingredient names, missing strength/form, fuzzy names and bare brands do not
 * establish a product identity.
 */
export function hospitalProductMatchesKnowledge(
  concept: any,
  cloudCode: string,
  knowledge: Resource,
): boolean {
  if (knowledge.meta?.source !== 'https://data.gov.tw/dataset/23715'
    || !knowledge.meta?.tag?.some((tag: any) => tag.system === SNAPSHOT_TAG && tag.code)) return false
  const codes = knowledge.code?.coding?.filter((coding: any) => isNhiDrugCodeSystem(coding.system)) ?? []
  if (codes.length !== 1 || String(codes[0].code ?? '').trim().toUpperCase() !== cloudCode) return false
  const officialName = nameKey(codes[0].display)
  const officialForm = nameKey(knowledge.doseForm?.text)
  if (!officialName || !officialForm) return false
  const officialUrl = knowledge.identifier?.find((identifier: any) => identifier.system === OFFICIAL_URL)?.value
  if (typeof officialUrl !== 'string'
    || !/^https:\/\/lmspiq\.fda\.gov\.tw\/web\/DRPIQ\/DRPIQ1000Result\?licId=\d{8}$/.test(officialUrl)) return false

  const codings = concept?.coding ?? []
  // An unverified generic paired with a brand may contradict the product.
  // Keep that order separate until both fields have a governed product match.
  if (codings.some((coding: any) => coding.system === GENERIC_SYSTEM && (coding.code || coding.display))) return false
  const products = codings.filter((coding: any) => coding.system === PRODUCT_SYSTEM || coding.system === NAME_SYSTEM)
  if (!products.length) return false
  const names = [...new Set(products.flatMap((coding: any) => [coding.code, coding.display])
    .map(nameKey).filter(Boolean))]
  if (names.length !== 1) return false

  const alias = VERIFIED_PRODUCTS.find((product) => nameKey(product.sourceName) === names[0])
  if (alias) {
    const url = `https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=${alias.licence}`
    return officialName === nameKey(alias.officialName) && officialForm === nameKey(alias.form)
      && officialUrl === url
  }

  // Without an alias, accept only the explicit product field and the entire
  // official label, with strength written in that label. A generic-looking
  // fallback drug_name cannot enter this branch. Decimal points, release/form
  // qualifiers, salts, manufacturer text and punctuation stay significant.
  return products.every((coding: any) => coding.system === PRODUCT_SYSTEM)
    && names[0] === officialName
    && /\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|%|微克|毫克|公克|毫升)/i.test(String(codes[0].display))
    && (officialName.includes(officialForm)
      || /\b(?:tablets?|capsules?|injection|solution|cream|ointment|suspension|gel|drops|patch(?:es)?|inhalation|aerosol|suppositor(?:y|ies)|granules|powder)\b/i.test(String(codes[0].display)))
}

// Micrograms, so 0.25 mg and 250 mcg compare equal.
const MICROGRAMS: Record<string, number> = { MG: 1000, MCG: 1, UG: 1 }

/** Every drug amount written in a label or official ingredient text. A pack
 * size (5 g, 3 ml) and a percentage are not amounts; mass per volume or mass
 * keeps its denominator, so 10 mg/1 ml never equals 10 mg. Undefined when the
 * text also names a quantity in a unit not read here (1 GM, 400 IU, 5%): the
 * amounts found would not be the whole strength. A bare volume (3 ml) is a
 * pack size and is let through. */
function drugAmounts(text: string): string[] | undefined {
  const upper = text.normalize('NFKC').toUpperCase()
    // "25/5 mg" names both ingredients' amounts in the trailing unit.
    .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(MG|MCG)\b/g, '$1 $3 + $2 $3')
  const pattern = /(?<![\d.])(\d+(?:\.\d+)?|\.\d+)\s*(MG|MCG|UG)\b(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ML|GM|G)\b)?/g
  if (/\d\s*(?:G|GM|IU|U|UNITS?|MEQ|MMOL|%)(?![A-Z])/.test(upper.replace(pattern, ' '))) return undefined
  return [...upper.matchAll(pattern)]
    .map((match) => {
      const amount = Number(match[1]) * MICROGRAMS[match[2]] / (match[3] ? Number(match[3]) : 1)
      return `${Math.round(amount * 1000) / 1000}${match[4] ? `/${match[4] === 'GM' ? 'G' : match[4]}` : ''}`
    }).sort()
}

// [hospital label word, official dose form]. Inhalers, eye and skin products
// are absent: their labels rarely carry a comparable drug amount.
const FORM_FAMILIES: Array<[RegExp, RegExp]> = [
  [/^(?:TAB|TABS|TABLETS?)$/, /錠/],
  [/^(?:CAP|CAPS|CAPSULES?)$/, /膠囊/],
  [/^(?:INJ|INJECTION)$/, /注射/],
  [/^(?:PATCH(?:ES)?|PAP)$/, /貼|膠布/],
  [/^GRANULES?$/, /顆粒|散/],
]
const MODIFIED_RELEASE_LABEL = /^(?:SR|ER|PR|XR|CR|MR|XL|LA|OROS|RETARD)$/
const MODIFIED_RELEASE_FORM = /持續|緩釋|長效|延長|控釋/

/** Same brand word, the same drug amounts and the same dose-form family, e.g.
 * Lipitor FC * tab 20 mg ↔ LIPITOR FILM-COATED TABLETS 20MG (膜衣錠). Amounts
 * come from the official ingredient text because cloud labels often omit
 * them. A label that starts with an ingredient (Colchicine "Synmosa") has no
 * brand word and is not compared here. */
function hospitalBrandMatchesKnowledge(concept: any, knowledge: Resource): boolean {
  const codings = concept?.coding ?? []
  if (codings.some((coding: any) => coding.system === GENERIC_SYSTEM)) return false
  const names = [...new Set(codings.filter((coding: any) => [NAME_SYSTEM, PRODUCT_SYSTEM].includes(coding.system))
    .flatMap((coding: any) => [coding.code, coding.display]).filter(Boolean))] as string[]
  if (names.length !== 1) return false
  const label = names[0].normalize('NFKC').toUpperCase()
  const brand = label.match(/^[A-Z][A-Z-]{3,}/)?.[0]
  const ingredients: string[] = (knowledge.ingredient ?? []).map((item: any) => String(item.itemCodeableConcept?.text ?? ''))
  const form = String(knowledge.doseForm?.text ?? '')
  if (!brand || !ingredients.length || !form) return false
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const word = new RegExp(`(?<![A-Z])${escapedBrand}(?![A-Z])`)
  const officialNames = [...(knowledge.code?.coding ?? []).map((coding: any) => coding.display), ...(knowledge.synonym ?? [])]
    .map((name) => String(name ?? '').normalize('NFKC').toUpperCase())
  if (!officialNames.some((name) => word.test(name)) || ingredients.some((text) => word.test(text.toUpperCase()))) return false
  // Each official ingredient must contribute a readable amount, so a
  // combination is compared whole, never by the one part this can read.
  const ingredientAmounts = ingredients.map(drugAmounts)
  if (ingredientAmounts.some((amounts) => !amounts?.length)) return false
  const hospitalAmounts = drugAmounts(label), officialAmounts = ingredientAmounts.flat().sort()
  if (!hospitalAmounts?.length || hospitalAmounts.join() !== officialAmounts.join()) return false
  // Whole label words only: "Glucophage" must not read as an "oph" product.
  const words = label.split(/[^A-Z]+/)
  const families = FORM_FAMILIES.filter(([labelWord]) => words.some((item) => labelWord.test(item)))
  return families.length === 1 && families[0][1].test(form)
    && FORM_FAMILIES.filter(([, official]) => official.test(form)).length === 1
    // A release marker may sit in the official name (TEGRETOL CR) while the
    // form reads 膜衣錠, so both count.
    && words.some((item) => MODIFIED_RELEASE_LABEL.test(item)) === (MODIFIED_RELEASE_FORM.test(form)
      || officialNames.some((name) => MODIFIED_RELEASE_FORM.test(name) || name.split(/[^A-Z]+/).some((item) => MODIFIED_RELEASE_LABEL.test(item))))
}

/** Non-destructive comparison only. Complete literal product labels may
 * differ in bridge typography/form abbreviations; a brand word counts only
 * with its drug amounts and dose form. Never use ingredient-only similarity,
 * a bare brand, or this predicate to confirm an order merge. */
export function hospitalProductMayMatchKnowledge(concept: any, cloudCode: string, knowledge: Resource): boolean {
  if (hospitalProductMatchesKnowledge(concept, cloudCode, knowledge)) return true
  if (knowledge.meta?.source !== 'https://data.gov.tw/dataset/23715'
    || !knowledge.meta?.tag?.some((tag: any) => tag.system === SNAPSHOT_TAG && tag.code)) return false
  const coding = knowledge.code?.coding?.filter((item: any) => isNhiDrugCodeSystem(item.system)) ?? []
  if (coding.length !== 1 || String(coding[0].code).toUpperCase() !== cloudCode) return false
  const sourceCoding = concept?.coding?.find((item: any) => [NAME_SYSTEM, PRODUCT_SYSTEM].includes(item.system))
  const hospitalName = String(sourceCoding?.display || sourceCoding?.code || '')
  const form = String(knowledge.doseForm?.text ?? '')
  if (!form) return false
  if (/錠|tablet/i.test(form) && !/tab/i.test(hospitalName)) return false
  if (/膠囊|capsule/i.test(form) && !/cap/i.test(hospitalName)) return false
  if (/注射|injection/i.test(form) && !/inj/i.test(hospitalName)) return false
  return hospitalProductMayMatchConcept(concept, knowledge.code) || hospitalBrandMatchesKnowledge(concept, knowledge)
}
