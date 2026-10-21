// The NHI order's coding display names the ORDER (09040C 全蛋白, 12064B
// 「可抽出的核抗體測定—Ro/La抗體」), not the row. While the row has its own name —
// code.text or a local item coding — that name alone decides category and
// column; the order display must never override it. Shapes as the MediCloud
// bridge writes them: NHI coding first, then the local item coding, no LOINC,
// no specimen; with and without code.text.
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'

const MEDCLOUD_NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const HEALTHBANK_NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'

function row(item: string, nhi: string, orderDisplay: string | undefined, opts: { text?: boolean; system?: string; value?: any } = {}) {
  const { text = true, system = MEDCLOUD_NHI, value = { valueQuantity: { value: 12, unit: 'mg/dL' } } } = opts
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: {
      ...(text ? { text: item } : {}),
      coding: [
        { system, code: nhi, ...(orderDisplay ? { display: orderDisplay } : {}) },
        { system: LOCAL, code: item, display: item },
      ],
    },
    effectiveDateTime: '2026-10-01T08:00:00+08:00',
    ...value,
  }
}

function placement(o: any): string {
  const id = categorizeObservation(o)?.id ?? 'none'
  return id === 'none' ? id : `${id}/${getLabPivotTestIdentity(o, id).testKey}`
}

const CASES: Array<[string, string, string, string]> = [
  // item, NHI order, order display, expected category
  ['Prot/Cr ratio', '09040C', '全蛋白', 'urine'],
  ['UPCR', '09040C', '全蛋白', 'urine'],
  ['PROT(SPOT)', '09040C', '全蛋白', 'urine'],
  ['MALB', '12111C', '微量白蛋白', 'urine'],
  ['ACR', '12111C', '微量白蛋白', 'urine'],
  ['Microalbumin/Creatinine ratio', '12111C', '微量白蛋白', 'urine'],
  ['Glu', '09005C', '血糖', 'glucose'],
  ['eGFR', '09015C', '肌酸酐、血', 'chem'],
  // The name states urine (specimen evidence, Pass 2.6) — no longer read as
  // serum Ca through the stripped parenthetical.
  ['Ca(spot urine)', '09011C', '鈣', 'urine'],
  ['SS-A/Ro Ab', '12064B', '可抽出的核抗體測定—Ro/La抗體', 'immuno'],
  ['Ro52', '12064B', '可抽出的核抗體測定—Ro/La抗體', 'immuno'],
  ['SS-B/La Ab', '12064B', '可抽出的核抗體測定—Ro/La抗體', 'immuno'],
]

describe('the NHI order display never overrides the row\'s own name', () => {
  describe.each([
    ['MediCloud, with code.text', { text: true, system: MEDCLOUD_NHI }],
    ['MediCloud, item only in the local coding', { text: false, system: MEDCLOUD_NHI }],
    ['健保存摺, with code.text', { text: true, system: HEALTHBANK_NHI }],
  ])('%s', (_shape, opts) => {
    it.each(CASES)('%s under %s (%s) → %s', (item, nhi, display, category) => {
      const withDisplay = row(item, nhi, display, opts)
      const withoutDisplay = row(item, nhi, undefined, opts)
      expect(categorizeObservation(withDisplay)?.id).toBe(category)
      expect(placement(withDisplay)).toBe(placement(withoutDisplay))
    })
  })

  it('places 12064B rows in their own antibody columns despite the panel display', () => {
    for (const [item, key] of [['SS-A/Ro Ab', 'ANTI-SSA'], ['Ro52', 'ANTI-RO52'], ['SS-B/La Ab', 'ANTI-SSB']]) {
      expect(placement(row(item, '12064B', '可抽出的核抗體測定—Ro/La抗體', { text: false }))).toBe(`immuno/${key}`)
    }
  })

  it('still uses the order display when the row has no name of its own', () => {
    const bare = {
      resourceType: 'Observation', status: 'final',
      code: { coding: [{ system: MEDCLOUD_NHI, code: '09040C', display: '全蛋白' }] },
      valueQuantity: { value: 7, unit: 'g/dL' },
      effectiveDateTime: '2026-10-01T08:00:00+08:00',
    }
    expect(categorizeObservation(bare)?.id).toBe('chem')
  })
})
