// 尿 inside an analyte name is not a urine specimen: 尿素氮 (urea nitrogen,
// BUN), 尿素 (urea), 尿酸 (uric acid), 利尿 / 鈉尿 (natriuretic peptides,
// antidiuretic hormone). The urine-text fallback and every specimen
// heuristic must read past these words; explicit urine wording (尿液, 尿中,
// 小便, "Urine", a 「(尿)」 qualifier) still states urine.
//
// Synthetic rows only.
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { hasUrineWording } from '@/src/shared/utils/urine-wording'
import { specimenEvidence } from '@/src/shared/utils/specimen-evidence'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

const MEDCLOUD_NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const HEALTHBANK_NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://example.invalid/fhir/CodeSystem/his-local-lab'

type Shape = 'text' | 'localDisplay' | 'orderDisplay'
function row(name: string, shape: Shape, order: string, orderDisplay: string, system = HEALTHBANK_NHI) {
  const codings: any[] = []
  if (order) codings.push({ system, code: order, display: shape === 'orderDisplay' ? name : orderDisplay })
  if (shape === 'localDisplay') codings.push({ system: LOCAL, code: 'L0001', display: name })
  return {
    resourceType: 'Observation', status: 'final',
    code: { ...(shape === 'text' ? { text: name } : {}), coding: codings },
    valueQuantity: { value: 15, unit: 'mg/dL' },
  }
}

describe('hasUrineWording', () => {
  it.each([
    '血中尿素氮', '血中尿素氮(BUN)', '尿素氮', '尿素', '尿酸', '血清尿酸', '尿素氮/肌酸酐比', 'BUN', 'Urea nitrogen',
    'Uric acid', 'B型利鈉尿胜肽', '抗利尿激素', '尿素呼氣試驗',
  ])('%s is not urine wording', (text) => expect(hasUrineWording(text)).toBe(false))
  it.each([
    '尿液常規', '尿蛋白', '尿中肌酸酐', '尿中尿酸', '尿液尿酸', '尿素氮(尿)', '尿液尿素氮', '小便尿酸', 'Urine uric acid',
    'URINE UREA NITROGEN', '尿糖', '尿一般檢查',
  ])('%s is urine wording', (text) => expect(hasUrineWording(text)).toBe(true))
})

// Every 尿 here is an analyte word: the row is chemistry, as on the base.
const BLOOD_NAMES = ['血中尿素氮(BUN)', '血中尿素氮', '尿素氮', '尿素氮(BUN)', '尿素', '尿酸', '尿酸(UA)', '血清尿酸', '血中尿酸', '尿素氮/肌酸酐比']
const BLOOD_ORDERS: Array<[string, string]> = [['09002C', 'BUN'], ['09002C', 'Blood urea nitrogen (BUN)'], ['09002C', '血中尿素氮'], ['09013C', '尿酸'], ['09013C', 'Uric acid']]

describe.each([['健保存摺', HEALTHBANK_NHI], ['MediCloud', MEDCLOUD_NHI]])('%s system', (_label, system) => {
  describe('尿 inside an analyte name never routes to 尿液', () => {
    it('the repro: 血中尿素氮(BUN) under 09002C "BUN" is chemistry', () => {
      expect(categorizeObservation(row('血中尿素氮(BUN)', 'text', '09002C', 'BUN', system))?.id).toBe('chem')
    })
    for (const shape of ['text', 'localDisplay'] as const) {
      it.each(BLOOD_NAMES.flatMap((name) => BLOOD_ORDERS.map(([order, display]) => [name, order, display])))(
        `${shape}: %s under %s (%s) → chem`,
        (name, order, display) => {
          expect(categorizeObservation(row(name, shape, order, display, system))?.id).toBe('chem')
        },
      )
    }
    it.each([['09002C', '血中尿素氮'], ['09002C', '尿素氮'], ['09013C', '尿酸']])(
      'order display only: %s %s → chem', (order, display) => {
        expect(categorizeObservation(row(display, 'orderDisplay', order, display, system))?.id).toBe('chem')
      },
    )
  })

  describe('explicit urine wording still routes to 尿液', () => {
    const URINE_NAMES = ['尿液常規', '尿蛋白', '尿中肌酸酐', '尿中尿酸', '尿液尿酸', '尿素氮(尿)', '尿液尿素氮', '小便尿酸', 'Urine uric acid', 'Urine urea nitrogen']
    for (const shape of ['text', 'localDisplay'] as const) {
      it.each(URINE_NAMES.flatMap((name) => [['', ''], ...BLOOD_ORDERS].map(([order, display]) => [name, order, display])))(
        `${shape}: %s under %s (%s) → urine`,
        (name, order, display) => {
          expect(categorizeObservation(row(name, shape, order, display, system))?.id).toBe('urine')
        },
      )
    }
  })
})

describe('specimen evidence reads past analyte words', () => {
  it('a 「尿素氮」 specimen text or inspect mode is not urine', () => {
    const base = { resourceType: 'Observation', status: 'final', code: { text: 'Creatinine' }, valueQuantity: { value: 1, unit: '' } }
    expect(specimenEvidence({ ...base, specimen: { display: '尿酸' } }, 'CREA')).toBeNull()
    expect(specimenEvidence({ ...base, specimen: { display: '尿液' } }, 'CREA')).toBe('urine')
  })
})

describe('the chemistry column of 尿-spelt analytes', () => {
  it.each([
    // A bilingual 「中文(EN)」 name keeps its own column, as on the base.
    ['血中尿素氮(BUN)', '09002C', 'BUN', '血中尿素氮(BUN)'],
    ['血中尿素氮', '09002C', '血中尿素氮', 'BUN'],
    ['尿素氮', '', '', 'BUN'],
    ['尿酸', '09013C', '尿酸', 'UA'],
    ['血清尿酸', '', '', 'UA'],
  ])('%s (%s %s) → chem/%s', (name, order, display, key) => {
    const o = row(name, 'text', order, display)
    expect(categorizeObservation(o)?.id).toBe('chem')
    expect(getLabPivotTestIdentity(o, 'chem').testKey).toBe(key)
  })
  it('尿素 (urea) is chemistry but never the BUN column: urea and urea nitrogen differ', () => {
    const o = row('尿素', 'text', '', '')
    expect(categorizeObservation(o)?.id).toBe('chem')
    expect(getLabPivotTestIdentity(o, 'chem').testKey).not.toBe('BUN')
  })
})
