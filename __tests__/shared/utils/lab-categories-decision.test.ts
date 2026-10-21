// categorizeObservationWithReason names the pass that placed a row; the
// lab-data problem report sends it so a mis-filed row says why. The plain
// categorizeObservation must stay a pure projection of it.
import {
  categorizeObservation,
  categorizeObservationWithReason,
} from '@/src/shared/utils/lab-categories'

const LAB = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'

const cases: Array<[string, any, string | null, string]> = [
  ['no observation', null, null, 'none'],
  ['LOINC', { category: LAB, code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] }, specimen: { display: 'Blood' } }, 'cbc', 'loinc'],
  ['urine specimen beats LOINC', { category: LAB, code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] }, specimen: { display: 'Urine' } }, 'urine', 'specimen-urine'],
  ['non-blood specimen', { category: LAB, code: { text: 'Glucose' }, specimen: { display: 'Pleural fluid' } }, 'other', 'specimen-non-blood'],
  ['short code', { category: LAB, code: { text: 'WBC' } }, 'cbc', 'code'],
  ['「尿」 in the order name', { category: LAB, code: { text: 'Zeta-XYZ', coding: [{ system: NHI, code: '12999C', display: '某某尿液檢查' }] } }, 'urine', 'text-urine'],
  ['nothing matches', { category: LAB, code: { text: 'Zeta-XYZ' } }, 'other', 'fallback'],
]

describe('categorizeObservationWithReason', () => {
  it.each(cases)('%s', (_label, observation, categoryId, decidedBy) => {
    const result = categorizeObservationWithReason(observation)
    expect(result.category?.id ?? null).toBe(categoryId)
    expect(result.decidedBy).toBe(decidedBy)
    expect(categorizeObservation(observation)?.id ?? null).toBe(categoryId)
  })
})
