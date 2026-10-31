/**
 * Ingredient catalogue for the VGH bridge's free-text drug-name systems.
 * These are exact recorded-name aliases, not NHI product-code matches. Never
 * use them as product identity, ATC codes, or a reason to merge fills. The CDSS
 * adapter may use a resolved ingredient as name evidence for its own classes;
 * resolution alone establishes neither current use nor a prescribed dose.
 * Strength/formulation remain in the original name; they are not reconstructed
 * from a prescribed dose or inferred from an ingredient name.
 */
export const HOSPITAL_MEDICATION_NAME_VERSION = 'vgh-recorded-names-20261001-v1'
export const HOSPITAL_MEDICATION_NAME_REVIEWED_AT = '2026-10-01'
const GENERIC_SYSTEM = 'urn:oid:vgh.medication.generic'
const PRODUCT_SYSTEM = 'urn:oid:vgh.medication.product'
const NAME_SYSTEM = 'urn:oid:vgh.medication.name'

export interface HospitalMedicationName {
  status: 'normalized' | 'unresolved'
  ingredientName?: string
  /** Display only: strength copied from this exact recorded-name alias. */
  recordedStrengthText?: string
  productName?: string
  recordedGenericName?: string
  recordedProductName?: string
  recordedName?: string
  source?: 'recorded-generic-name' | 'verified-product-alias'
  referenceUrl?: string
  version: string
  reviewedAt: string
}

type Concept = {
  coding?: Array<{ system?: string; code?: string; display?: string }>
}

// Only typography and bridge annotations are normalized. Digits, units, forms,
// brand qualifiers (notably Bio-cal PLUS), and manufacturer text stay distinct.
function nameKey(name: string): string {
  return name.normalize('NFKC')
    .replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&amp;/gi, '&')
    .replace(/[#*@]/g, '').replace(/\s+/g, '').toLowerCase()
}

// The ingredient is explicitly named by the same row's generic coding. Keep
// salts, combination ingredients and botanical extracts as recorded: Senna
// leaf must not be silently relabelled as a particular sennoside formulation.
const RECORDED_GENERICS: Array<[string, string]> = [
  ['Silymarin (Bao-gan) * cap 150 mg', 'Silymarin'],
  ['Acetaminophen "VPP" tab 500 mg', 'Acetaminophen'],
  ['Cefadroxil cap 500 mg', 'Cefadroxil'],
  ['Mosapride citrate FC tab 5 mg', 'Mosapride citrate'],
  ['Dextrose "YF""A" *inj 5% 500 ml', 'Dextrose'],
  ['Sod chloride "YF"*inj 0.9% 500ml', 'Sodium chloride'],
  ['Gentamicin "VPP" * inj 80mg/2ml', 'Gentamicin'],
  ['CLINdamycin(Clincin*inj300mg/2ml', 'Clindamycin'],
  ['Linagliptin FC # tab 5 mg', 'Linagliptin'],
  ['Metformin (Glucophage)#tab 500mg', 'Metformin'],
  ['Ceftriaxone (Sintrix) * inj 1 g', 'Ceftriaxone'],
  ['Ciprofloxacin "Swiss" *tab 250mg', 'Ciprofloxacin'],
  ['Letrozole FC tab 2.5 mg', 'Letrozole'],
  ['Dexamethasone "S.T."inj5mg/ml/AP', 'Dexamethasone'],
  ['ChlorPHENIRAMINE "T.Y*inj 5mg/ml', 'Chlorpheniramine'],
  ['Sod chloride "Ot"*inj 0.9% 250ml', 'Sodium chloride'],
  ['Trastuzumab Emtansine##*inj160mg', 'Trastuzumab emtansine'],
  ['Trastuzumab Emtansine##*inj100mg', 'Trastuzumab emtansine'],
  ['Sod chloride inj 0.9% 500 ml', 'Sodium chloride'],
  ['Tamoxifen (Nolvadex)* tab 10 mg', 'Tamoxifen'],
  ['Dextrose "YF"5%/0.45%NSinj 500ml', 'Dextrose / Sodium chloride'],
  ['Granisetron (Setron)*inj 3mg/3ml', 'Granisetron'],
  ['Morphine HCl #> inj 10 mg/1 ml', 'Morphine hydrochloride'],
  ['Fexofenadine * tab 60 mg', 'Fexofenadine'],
  ['Dexamethasone "Sta" *inj 5mg/1ml', 'Dexamethasone'],
  ['Furosemide tab 40 mg VPP', 'Furosemide'],
  ['Dexamethasone "Y.C." * tab 4 mg', 'Dexamethasone'],
  ['Netupitant/Palonosetron cap', 'Netupitant / Palonosetron'],
  ['Famotidine "S.T." *tab 20 mg/PTP', 'Famotidine'],
  ['Pertuzumab for ##*infusion 420mg', 'Pertuzumab'],
  ['Trastuzumab "USA" ##* inj 1 mg', 'Trastuzumab'],
  ['Docetaxel for ##* infu 20 mg/1ml', 'Docetaxel'],
  ['Dextrose "YF""A"*inj 5% 250ml/PP', 'Dextrose'],
  ['Carboplatin "DKSH"iv##*inj 150mg', 'Carboplatin'],
  ['Sod chloride "CSX"inj0.9%500mlBT', 'Sodium chloride'],
  ['Senna leaf * tab 7.5 mg', 'Senna leaf'],
  ['Loperamide (Loperam) *cap 2 mg', 'Loperamide'],
  ['Loperamide (Loperam)*cap 2mg/PTP', 'Loperamide'],
  ['Dioctahedral smectite 3 g', 'Dioctahedral smectite'],
  ['Carboplatin "BMS" iv##*inj 150mg', 'Carboplatin'],
  ['Platycodon fluidextract 120 ml', 'Platycodon fluidextract'],
  ['Acetylcysteine *granules200mg/3g', 'Acetylcysteine'],
]
const genericNames = new Map(RECORDED_GENERICS.map(([name, ingredient]) => [nameKey(name), ingredient]))

function recordedStrength(name: string): string | undefined {
  // Called only after a complete source name matched this catalogue. Never
  // read dosageInstruction: the administered dose is not product strength.
  if (nameKey(name) === nameKey('Dextrose "YF"5%/0.45%NSinj 500ml')) return '5% / 0.45%'
  return name.match(/\d+(?:\.\d+)?\s*(?:mcg|mg|g|%)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:ml|g))?/i)?.[0]
    .replace(/(\d)(mcg|mg|g)/gi, '$1 $2').replace(/\s+/g, ' ').trim()
}

export function hospitalMedicationDisplayName(name?: HospitalMedicationName): string | undefined {
  return name?.ingredientName
    ? [name.ingredientName, name.recordedStrengthText].filter(Boolean).join(' ')
    : undefined
}

type ProductAlias = { ingredient: string; referenceUrl: string; strength?: string }
const licenceUrl = (id: string) =>
  `https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=${id}`

// Product ingredients checked against the bundled official drug-master
// snapshot (20260728), except Bio-cal PLUS and Paxlovid, whose primary sources
// are linked below. URLs document the alias; they do not establish an exact
// licence/package/date match for the patient's prescription.
const VERIFIED_PRODUCTS: Array<[string, string, string, string?]> = [
  ['Aromasin SC tab 25 mg', 'Exemestane', licenceUrl('02023097'), '25 mg'],
  ['Femara FC tab 2.5 mg', 'Letrozole', licenceUrl('02022462'), '2.5 mg'],
  ['Bao-gan * cap 150 mg', 'Silymarin', licenceUrl('01041952'), '150 mg'],
  ['Meitifen SR FC * tab 75 mg', 'Diclofenac sodium', licenceUrl('01044041'), '75 mg'],
  ['Methasone inj 5 mg/1 ml @', 'Dexamethasone phosphate (sodium)', licenceUrl('01026804'), '5 mg/1 ml'],
  ['Bio-cal plus chewable tab "pay"', 'Tricalcium phosphate / Cholecalciferol',
    'https://shmc.ntu.edu.tw/medicine/detail/sn/195'],
  ['Benazon oint 20 g', 'Diphenhydramine hydrochloride / Bismuth subgallate / Benzocaine / Zinc oxide',
    licenceUrl('12007695')],
  ['Lactated ringer\'s "YF"inj 500ml@', 'Sodium chloride / Sodium lactate / Calcium chloride / Potassium chloride',
    licenceUrl('01002801')],
  ['PAXLOVID tab (eGFR>59,30 tabs)', 'Nirmatrelvir / Ritonavir',
    'https://webfiles.pfizer.com/taiwan_paxlovid_smpc'],
]
const productAliases = new Map<string, ProductAlias>(VERIFIED_PRODUCTS.map(
  ([name, ingredient, referenceUrl, strength]) => [nameKey(name), { ingredient, referenceUrl, strength }],
))

/** Resolve only the VGH bridge's explicitly named source systems. No fuzzy
 * matching, free-text scraping, cross-row propagation or fabricated NHI codes. */
export function resolveHospitalMedicationName(concept?: Concept): HospitalMedicationName | undefined {
  const codings = concept?.coding?.filter(({ system }) =>
    system === GENERIC_SYSTEM || system === PRODUCT_SYSTEM || system === NAME_SYSTEM) ?? []
  if (!codings.length) return undefined
  const names = (system: string) => [...new Set(codings.filter((c) => c.system === system)
    .map((c) => (c.display || c.code || '').trim()).filter(Boolean))]
  const generics = names(GENERIC_SYSTEM)
  const products = names(PRODUCT_SYSTEM)
  const recordedNames = names(NAME_SYSTEM)
  const base: HospitalMedicationName = {
    status: 'unresolved',
    recordedGenericName: generics.join(' / ') || undefined,
    recordedProductName: products.join(' / ') || undefined,
    recordedName: recordedNames.join(' / ') || undefined,
    productName: products[0] || generics[0] || recordedNames[0],
    version: HOSPITAL_MEDICATION_NAME_VERSION,
    reviewedAt: HOSPITAL_MEDICATION_NAME_REVIEWED_AT,
  }
  // Differing source codings are ambiguous even if an alias happens to match.
  if (generics.length > 1 || products.length > 1 || recordedNames.length > 1
    || (recordedNames.length && (generics.length || products.length))) return base
  const generic = generics[0] || ''
  const product = products[0] || recordedNames[0] || ''
  const recordedIngredient = genericNames.get(nameKey(generic))
    // Some bridge rows put an explicit chemical name in the product field.
    || (!generic ? genericNames.get(nameKey(product)) : undefined)
  const genericAlias = productAliases.get(nameKey(generic))
  const productAlias = productAliases.get(nameKey(product))
  if (genericAlias && productAlias && genericAlias.ingredient !== productAlias.ingredient) return base
  const verified = productAlias || genericAlias
  if (recordedIngredient && verified && recordedIngredient !== verified.ingredient) return base
  if (recordedIngredient) return {
    ...base, status: 'normalized', ingredientName: recordedIngredient,
    recordedStrengthText: recordedStrength(generic || product),
    source: 'recorded-generic-name',
  }
  // An unrecognized generic paired with a known product may be a conflicting
  // ingredient. Only use the alias when the generic itself is that product,
  // or when there is no generic field.
  if (verified && (!generic || genericAlias)) return {
    ...base, status: 'normalized', ingredientName: verified.ingredient,
    recordedStrengthText: verified.strength,
    source: 'verified-product-alias', referenceUrl: verified.referenceUrl,
  }
  return base
}
