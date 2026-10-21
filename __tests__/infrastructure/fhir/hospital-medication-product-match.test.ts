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
