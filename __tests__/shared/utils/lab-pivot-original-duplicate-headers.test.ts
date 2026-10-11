// Original-name mode keys a column by source label + standardized key, so two
// columns can carry one source label (a neutrophil count and its percentage,
// both 「嗜中性白血球 / Neutrophil」). Their headers must still differ: only
// where two or more columns of one table share a label, each gets a short
// hint — # / % for count vs percentage, else the standardized label. A label
// no other column shares is shown exactly as the source sent it.
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

const LOINC = 'http://loinc.org'
const NHI_ORDER = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'

let seq = 0
function obs(text: string, value: number, unit: string, opts: { loinc?: string; nhi?: boolean; date?: string; display?: string } = {}) {
  seq += 1
  return {
    resourceType: 'Observation', id: `odh-${seq}`, status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: {
      text,
      coding: [
        ...(opts.loinc ? [{ system: LOINC, code: opts.loinc }] : []),
        ...(opts.nhi ? [{ system: NHI_ORDER, code: '08013C', display: '白血球分類計數' }] : []),
      ],
    },
    valueQuantity: { value, unit },
    effectiveDateTime: `${opts.date ?? '2026-01-01'}T08:00:00+08:00`,
  }
}

const CORPUS = ['2026-01-01', '2026-02-01'].flatMap((date) => [
  // count / % pairs under one label
  obs('嗜中性白血球 / Neutrophil', 3.2, '10^3/uL', { loinc: '751-8', nhi: true, date }),
  obs('嗜中性白血球 / Neutrophil', 55, '%', { loinc: '770-8', nhi: true, date }),
  obs('Lymphocyte', 1900, '/uL', { date }),
  obs('Lymphocyte', 33, '%', { date }),
  obs('Band', 300, '/uL', { date }),
  obs('Band', 3, '%', { date }),
  // glucose subtypes under one label
  obs('Glucose', 100, 'mg/dL', { loinc: '1558-6', date }),
  obs('Glucose', 140, 'mg/dL', { loinc: '2345-7', date }),
  // unique labels: unchanged
  obs('WBC', 5.6, '10^3/uL', { loinc: '6690-2', date }),
  obs('Monocyte', 6, '%', { date }),
])

const TB_CULTURE = {
  resourceType: 'Observation', id: 'odh-tb-1', status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }],
  code: { text: 'TB culture', coding: [{ system: LOINC, code: '50941-4' }] },
  valueString: 'No growth',
  effectiveDateTime: '2026-01-05T08:00:00+08:00',
}
const TB_CULTURE_LOCAL = {
  ...TB_CULTURE, id: 'odh-tb-2',
  code: { text: 'TB culture' },
  effectiveDateTime: '2026-01-06T08:00:00+08:00',
}

describe.each(['zh-TW', 'en'] as const)('original-mode headers (%s)', (language) => {
  const pivots = buildLabPivots([...CORPUS, TB_CULTURE, TB_CULTURE_LOCAL], { nameMode: 'original' })
  const headers = (categoryId: string) => pivots[categoryId].rows
    .filter((row) => row.values.size > 0)
    .map((row) => ({ row, name: getLabRowDisplayParts(row, 'medical', language, 'original').name }))

  it.each(['cbc', 'glucose', 'microbio'])('%s: every column header is unique', (categoryId) => {
    const names = headers(categoryId).map(({ name }) => name)
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
  })

  it('a count and its percentage read # and %', () => {
    const neutrophil = headers('cbc').filter(({ row }) => row.displayName === '嗜中性白血球 / Neutrophil')
    expect(neutrophil.map(({ name }) => name).sort()).toEqual([
      '嗜中性白血球 / Neutrophil (#)',
      '嗜中性白血球 / Neutrophil (%)',
    ])
    const lymphocyte = headers('cbc').filter(({ row }) => row.displayName === 'Lymphocyte')
    expect(lymphocyte.map(({ name }) => name).sort()).toEqual(['Lymphocyte (#)', 'Lymphocyte (%)'])
  })

  it('glucose subtypes under one label read their standardized names', () => {
    const glucose = headers('glucose').map(({ name }) => name)
    expect(glucose).toHaveLength(2)
    for (const name of glucose) expect(name).toMatch(/^Glucose \(.+\)$/)
  })

  it('labels no other column shares are shown exactly as the source sent them', () => {
    for (const { row, name } of headers('cbc')) {
      if (['WBC', 'Monocyte'].includes(row.displayName)) expect(name).toBe(row.displayName)
    }
  })

  it('standardized mode is unchanged (no hints)', () => {
    const standardized = buildLabPivots(CORPUS)
    for (const row of standardized.cbc.rows) expect(row.originalHintKind).toBeUndefined()
  })
})
