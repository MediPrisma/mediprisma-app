import { hospitalProductMatchesKnowledge, hospitalProductMayMatchKnowledge } from '@/src/infrastructure/fhir/services/hospital-medication-product-match'

const NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-drug-code'
function fixture() {
  const concept = { coding: [{ system: 'urn:oid:vgh.medication.name', code: 'Aromasin SC tab 25 mg', display: 'Aromasin SC tab 25 mg' }] }
  const knowledge: any = { resourceType: 'MedicationKnowledge',
    meta: { source: 'https://data.gov.tw/dataset/23715', tag: [{ system: 'https://nhi-fhir-bridge.github.io/CodeSystem/drug-terminology-snapshot', code: 'nhi-drug-terminology-20260728' }] },
    code: { coding: [{ system: NHI, code: 'BC23097100', display: 'AROMASIN SUGAR COATED TABLETS 25MG' }] },
    doseForm: { text: '糖衣錠' }, identifier: [{ system: 'https://nhi-fhir-bridge.github.io/IdentifierSystem/nhi-drug-official-url', value: 'https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02023097' }] }
  return { concept, knowledge }
}

it('matches the complete recorded outpatient alias to the linked official product without inventing a code', () => {
  const { concept, knowledge } = fixture()
  const original = JSON.stringify(concept)
  expect(hospitalProductMatchesKnowledge(concept, 'BC23097100', knowledge)).toBe(true)
  expect(JSON.stringify(concept)).toBe(original)
})

it.each(['strength', 'form', 'licence', 'source', 'snapshot', 'code', 'generic', 'bare-brand', 'conflicting-display'])(
  'does not infer a product when %s differs or is unverified', (scenario) => {
    const { concept, knowledge } = fixture()
    if (scenario === 'strength') concept.coding[0].code = concept.coding[0].display = 'Aromasin SC tab 50 mg'
    if (scenario === 'form') knowledge.doseForm.text = '膜衣錠'
    if (scenario === 'licence') knowledge.identifier[0].value = knowledge.identifier[0].value.replace('02023097', '02022462')
    if (scenario === 'source') knowledge.meta.source = 'https://synthetic.example/unknown'
    if (scenario === 'snapshot') knowledge.meta.tag = []
    if (scenario === 'code') knowledge.code.coding[0].code = 'ANOTHER001'
    if (scenario === 'generic') concept.coding.push({ system: 'urn:oid:vgh.medication.generic', code: 'Letrozole 25 mg', display: 'Letrozole 25 mg' })
    if (scenario === 'bare-brand') concept.coding[0].code = concept.coding[0].display = 'Aromasin'
    if (scenario === 'conflicting-display') concept.coding[0].display = 'Femara FC tab 2.5 mg'
    expect(hospitalProductMatchesKnowledge(concept, 'BC23097100', knowledge)).toBe(false)
  },
)

it('can suggest a name-only complete product comparison without assigning its cloud code or confirming a merge', () => {
  // A fictional knowledge entry exercises literal name matching, not a claim
  // that this synthetic NHI code is a real product.
  const { knowledge } = fixture()
  knowledge.code.coding[0] = { system: NHI, code: 'SYNTH00001', display: 'GLUCOPHAGE TABLETS 500MG' }
  knowledge.doseForm.text = '錠劑'
  const name = 'Metformin (Glucophage)#tab 500mg'
  const concept = { coding: [{ system: 'urn:oid:vgh.medication.name', code: name, display: name }] }
  const before = JSON.stringify(concept)
  expect(hospitalProductMatchesKnowledge(concept, 'SYNTH00001', knowledge)).toBe(false)
  expect(hospitalProductMayMatchKnowledge(concept, 'SYNTH00001', knowledge)).toBe(true)
  expect(JSON.stringify(concept)).toBe(before)
  for (const different of ['Metformin', 'Glucophage', 'Metformin (Otherbrand) tab 500mg', 'Metformin (Glucophage) tab 850mg', 'Metformin (Glucophage) capsule 500mg']) {
    expect(hospitalProductMayMatchKnowledge({ coding: [{ system: 'urn:oid:vgh.medication.name', code: different }] }, 'SYNTH00001', knowledge)).toBe(false)
  }
})

it.each([['mg', '1 g'], ['mg', '100 g'], ['mg', '1 ml'], ['mg', '100 ml'], ['iu', 'g']])('preserves complete topical knowledge comparisons with an explicit concentration: %s/%s', (unit, denominator) => {
  const { knowledge } = fixture()
  const product = `Synthetic ointment 20 ${unit}/${denominator}`
  knowledge.code.coding[0] = { system: NHI, code: 'SYNTH00001', display: product }
  knowledge.doseForm.text = '軟膏劑'
  const concept = { coding: [{ system: 'urn:oid:vgh.medication.name', code: product, display: product }] }
  expect(hospitalProductMayMatchKnowledge(concept, 'SYNTH00001', knowledge)).toBe(true)
})

// Synthetic codes; brand, ingredient and form text mirror the official master.
function brandKnowledge(display: string, ingredient: string, form: string, synonym?: string) {
  const { knowledge } = fixture()
  knowledge.code.coding[0] = { system: NHI, code: 'SYNTH00001', display }
  knowledge.ingredient = [{ itemCodeableConcept: { text: ingredient } }]
  knowledge.doseForm.text = form
  if (synonym) knowledge.synonym = [synonym]
  return knowledge
}
const hospitalLabel = (name: string, system = 'urn:oid:vgh.medication.product') => ({ coding: [{ system, code: name, display: name }] })

it.each([
  ['Lipitor FC * tab 20 mg', 'LIPITOR FILM-COATED TABLETS 20MG', 'ATORVASTATIN (CALCIUM) 20 MG', '膜衣錠'],
  ['Concor FC * tab 1.25 mg', 'CONCOR 1.25', 'BISOPROLOL FUMARATE 1.25 MG', '膜衣錠'],
  ['Glyxambi FC # tab 25/5 mg', 'Glyxambi Film-Coated Tablets 25/5 mg', 'Empagliflozin 25 MG+LINAGLIPTIN 5 MG', '膜衣錠'],
  ['Lendormin "France" ^* tab 0.25mg', 'Lendormin (R) 0.25mg Tablets', 'BROTIZOLAM 250 MCG', '錠劑'],
  ['Xanax ^* tab 0.5 mg', 'XANAX TABLETS 0.5MG', 'ALPRAZOLAM .5 MG', '錠劑'],
  ['Lacoxa SR * tab 400 mg', 'LACOXA SR TABLETS 400MG', 'ETODOLAC 400 MG', '持續性藥效錠'],
  ['Ozempic for inj 1.34 mg/ml 3 ml,', 'Ozempic solution for injection', 'SEMAGLUTIDE 1.34 MG/ML', '注射液劑'],
  ['Senokot * tab 7.5 mg', 'SENOKOT TABLETS', 'SENNOSIDE B 7.5 MG', '錠劑'],
])('suggests a same-visit comparison for brand, amount and form: %s', (name, display, ingredient, form) => {
  const knowledge = brandKnowledge(display, ingredient, form)
  const concept = hospitalLabel(name)
  const before = JSON.stringify(concept)
  expect(hospitalProductMayMatchKnowledge(concept, 'SYNTH00001', knowledge)).toBe(true)
  // A suggestion only: never the verified product identity that confirms a merge.
  expect(hospitalProductMatchesKnowledge(concept, 'SYNTH00001', knowledge)).toBe(false)
  expect(JSON.stringify(concept)).toBe(before)
})

it.each([
  ['another strength', 'Lipitor FC * tab 10 mg', 'LIPITOR FILM-COATED TABLETS 20MG', 'ATORVASTATIN (CALCIUM) 20 MG', '膜衣錠'],
  ['a combination product', 'Olmetec FC * tab 40 mg', 'OLMETEC PLUS 40/12.5MG FILM-COATED TABLETS', 'OLMESARTAN MEDOXOMIL 40 MG+HYDROCHLOROTHIAZIDE 12.5 MG', '膜衣錠'],
  ['a capsule for a tablet', 'Topamax FC * tab 25 mg', 'TOPAMAX SPRINKLE CAPSULES 25MG', 'TOPIRAMATE 25 MG', '膠囊劑'],
  ['an injection for a capsule', 'Methycobal * cap 500 mcg', 'METHYCOBAL INJECTION 500UG', 'MECOBALAMIN 500 MCG', '注射劑'],
  ['a modified-release product for a plain tablet', 'Glucophage #* tab 500 mg', 'GLUCOPHAGE XR 500MG', 'METFORMIN HCL 500 MG', '持續性藥效錠'],
  ['a plain product for a modified-release label', 'Lacoxa SR * tab 400 mg', 'LACOXA TABLETS 400MG', 'ETODOLAC 400 MG', '錠劑'],
  ['an ingredient-first label', 'Colchicine "Synmosa" * tab 0.5mg', 'COLCHICINE TABLETS 0.5MG "SYNMOSA"', 'COLCHICINE .5 MG', '錠劑'],
  ['a brand inside another word', 'Totifen * tab 1 mg', 'SOOTHER TABLETS 1MG (KETOTIFEN)', 'KETOTIFEN 1 MG', '錠劑'],
  ['a bare brand', 'Glucophage', 'GLUCOPHAGE TABLETS', 'METFORMIN HCL 500 MG', '錠劑'],
  ['a percentage-only label', 'Clobesol * cream 0.05% 5 g', 'CLOBESOL CREAM 0.5MG "GENTLE"', 'CLOBETASOL 17-PROPIONATE .5 MG/GM', '軟膏劑'],
  ['a concentration for an amount', 'Sivkort susp. * inj 10 mg/1 ml', 'SIVKORT SUSPENSION', 'TRIAMCINOLONE (ACETONIDE) 10 MG', '注射劑'],
  ['a pack size for an amount', 'Fubifen PAP * patch 40mg/10g(4\'s', 'FUBIFEN PAP "FM"', 'FLURBIPROFEN 40 MG', '藥膠布'],
])('keeps %s apart', (_scenario, name, display, ingredient, form) => {
  expect(hospitalProductMayMatchKnowledge(hospitalLabel(name), 'SYNTH00001', brandKnowledge(display, ingredient, form))).toBe(false)
})

it('does not compare a brand label that also carries an unverified generic name', () => {
  const knowledge = brandKnowledge('LIPITOR FILM-COATED TABLETS 20MG', 'ATORVASTATIN (CALCIUM) 20 MG', '膜衣錠')
  const concept = hospitalLabel('Lipitor FC * tab 20 mg')
  concept.coding.push({ system: 'urn:oid:vgh.medication.generic', code: 'Atorvastatin', display: 'Atorvastatin' })
  expect(hospitalProductMayMatchKnowledge(concept, 'SYNTH00001', knowledge)).toBe(false)
})

it('reads a brand from the official synonym when the coded display is Chinese', () => {
  const knowledge = brandKnowledge('立普妥膜衣錠20毫克', 'ATORVASTATIN (CALCIUM) 20 MG', '膜衣錠', 'LIPITOR FILM-COATED TABLETS 20MG')
  expect(hospitalProductMayMatchKnowledge(hospitalLabel('Lipitor FC * tab 20 mg'), 'SYNTH00001', knowledge)).toBe(true)
})
