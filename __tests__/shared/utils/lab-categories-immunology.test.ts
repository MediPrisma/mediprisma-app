// 免疫 category — from a field report (雲端病歷 data, 2026-10-08) that IgG,
// IgA, IgM, C3, C4 and RF had no cumulative panel; values here are
// synthetic. Every analyte of the
// report, with and without LOINC and with no / an unrelated order code; the
// name guards; the former mis-routes (line-blot "Negative" → 尿液, 混合黴菌 →
// 微生物); specific-allergen rows kept out of the cumulative report; and the
// non-regressions.
import {
  categorizeObservation,
  categorizeObservationWithReason,
  isExcludedFromCumulativeReport,
  LAB_CATEGORIES,
} from '@/src/shared/utils/lab-categories'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { collectLabDataReportCandidates } from '@/features/lab-data-report/utils/build-lab-data-report'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { en } from '@/src/shared/i18n/locales/en'

const LAB = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]
// The 雲端病歷 bridge writes NHI codes under TW Core's payment code system.
const TW_CORE_NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const BRIDGE_NHI = 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code'
const LOCAL = 'https://nhi-fhir-bridge.local/CodeSystem/his-local-lab'
const LOINC = 'http://loinc.org'

let seq = 0
function obs({
  item,
  nhi,
  nhiDisplay,
  nhiSystem = TW_CORE_NHI,
  loinc,
  value,
  unit,
  specimen,
  date = '2026-09-30',
}: {
  item: string
  nhi?: string
  nhiDisplay?: string
  nhiSystem?: string
  loinc?: string
  value: string | number
  unit?: string
  specimen?: string
  date?: string
}) {
  const coding: any[] = []
  if (loinc) coding.push({ system: LOINC, code: loinc })
  if (nhi) coding.push({ system: nhiSystem, code: nhi, ...(nhiDisplay ? { display: nhiDisplay } : {}) })
  coding.push({ system: LOCAL, code: item, display: item })
  return {
    resourceType: 'Observation',
    id: `imm-${seq++}`,
    status: 'final',
    category: LAB,
    code: { coding, text: item },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    ...(typeof value === 'number'
      ? { valueQuantity: { value, unit } }
      : { valueString: value }),
    ...(specimen ? { specimen: { display: specimen } } : {}),
  }
}

// [item as the hospital prints it, NHI order, verified analyte LOINC, value,
//  expected column key, needs immunology context when the row has no order]
const SPEC_ROWS: Array<[string, string, string, string | number, string, boolean]> = [
  ['RF', '12011C', '11572-5', 9.5, 'RF', true],
  ['IGG', '12025B', '2465-3', 1000, 'IGG', false],
  ['IGA', '12027B', '2458-8', 200, 'IGA', false],
  ['IGM', '12029B', '2472-9', 300, 'IGM', false],
  ['IgE', '12031C', '19113-0', 100, 'IGE', false],
  ['C3', '12034B', '4485-9', 100, 'C3', false],
  ['C4', '12038B', '4498-2', 20, 'C4', false],
  ['ANA', '12053C', '5048-4', 'N', 'ANA', false],
  ['dsDNA Ab', '12060C', '5130-0', 5, 'ANTI-DSDNA', false],
  ['SS-A/Ro Ab', '12064B', '33569-5', 2, 'ANTI-SSA', false],
  ['SS-B/La Ab', '12064B', '17791-5', 3, 'ANTI-SSB', false],
  ['Ro52', '12064B', '53017-0', 'Negative', 'ANTI-RO52', false],
  ['RNP Ab', '12173B', '29374-6', 4, 'ANTI-RNP', false],
  ['Sm Ab', '12173B', '11090-8', 6, 'ANTI-SM', false],
  ['Mi-2alpha(Mi-2a)', '12137B', '88732-3', 'Negative', 'ANTI-MI-2A', false],
  ['Mi-2beta(Mi-2b)', '12137B', '88733-1', 'Negative', 'ANTI-MI-2B', false],
  ['Jo-1', '12154B', '8076-2', 'Negative', 'ANTI-JO-1', false],
  ['Ku', '12155B', '18484-6', 'Negative', 'ANTI-KU', true],
  ['粒腺體抗體 ;(AMA, anti-mitochondrial antibody)', '12056B', '20483-4', 'Negative', 'AMA', false],
  ['IgG1', '12149B', '2466-1', 500, 'IGG1', false],
  ['IgG2', '12149B', '2467-9', 300, 'IGG2', false],
  ['IgG3', '12149B', '2468-7', 50, 'IGG3', false],
  ['IgG4', '12149B', '2469-5', 40, 'IGG4', false],
]

const ALLERGENS = ['混合花粉', '屋塵璊', '德國蟑螂', '混合動物皮毛', '貓毛', '狗毛', '混合黴菌']

describe('免疫 category definition', () => {
  const immuno = LAB_CATEGORIES.find((c) => c.id === 'immuno')!

  it('is a secondary sub-tab with immunoglobulin, autoantibody and electrophoresis / light-chain subgroups', () => {
    expect(immuno.hiddenByDefault).toBe(true)
    expect(immuno.subgroups?.map((sg) => sg.id)).toEqual(['immunoglobulin', 'autoantibody', 'paraprotein'])
    expect(immuno.stackedPanels).toEqual([['immunoglobulin'], ['autoantibody'], ['paraprotein']])
    expect(immuno.pinnedColumns).toBeUndefined()
    expect(immuno.nhiOrderCodes).not.toContain('30022C')
    // No allergen LOINC (cat 6833-8, dog 6098-8, cockroach 6078-0) anywhere.
    for (const category of LAB_CATEGORIES) {
      for (const loinc of ['6833-8', '6098-8', '6078-0']) expect(category.loincCodes ?? []).not.toContain(loinc)
    }
  })

  it('has zh-TW and en labels for the category, its subgroups and the excluded reason', () => {
    for (const locale of [zhTW, en] as any[]) {
      expect(locale.reports.cumulativeCategories.immuno).toBeTruthy()
      for (const sg of immuno.subgroups!) expect(locale.reports.cumulativeSubgroups[sg.id]).toBeTruthy()
      expect(locale.labDataReport.decidedBy.excluded).toBeTruthy()
      expect(locale.labDataReportAdmin.excludedByDesign).toBeTruthy()
    }
  })

  it('no longer files the RF LOINC 11572-5 under 內分泌', () => {
    const endocrine = LAB_CATEGORIES.find((c) => c.id === 'endocrine')!
    expect(endocrine.loincCodes).not.toContain('11572-5')
  })
})

describe.each([
  ['NHI code only (雲端病歷 today)', false],
  ['NHI code + analyte LOINC (mapper 0.1.6)', true],
])('every field-report analyte — %s', (_label, withLoinc) => {
  it.each(SPEC_ROWS)('%s → 免疫 / %s', (item, nhi, loinc, value, key) => {
    const observation = obs({ item, nhi, loinc: withLoinc ? loinc : undefined, value })
    const result = categorizeObservationWithReason(observation)
    expect(result.category?.id).toBe('immuno')
    // The NHI-order pass reports 'code': the lab-data report Function only
    // accepts its fixed decision enum.
    expect(result.decidedBy).toBe(withLoinc ? 'loinc' : 'code')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
  })
})

describe('by name alone — no order code, or a code the app does not know', () => {
  const unambiguous = SPEC_ROWS.filter((row) => !row[5])

  it.each(unambiguous)('%s with no code', (item, _nhi, _loinc, value, key) => {
    const observation = obs({ item, value })
    expect(categorizeObservation(observation)?.id).toBe('immuno')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
  })

  it.each(unambiguous)('%s under an unrelated / unknown order code', (item, _nhi, _loinc, value, key) => {
    for (const nhi of ['12999B', '09999C', '27001C']) {
      const observation = obs({ item, nhi, value })
      expect(categorizeObservation(observation)?.id).toBe('immuno')
      expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
    }
  })

  it.each([
    ['IgG1', 'IGG1'], ['IgG 1', 'IGG1'], ['IGG1', 'IGG1'], ['IgG-1', 'IGG1'], ['IgG subclass 1', 'IGG1'],
    ['IgG1亞型', 'IGG1'], ['IgG 2 次分類', 'IGG2'], ['IgG3 subclass', 'IGG3'], ['免疫球蛋白G4', 'IGG4'],
    ['免疫球蛋白 G4 量', 'IGG4'], ['IgG4 (Nephelometry)', 'IGG4'], ['ＩｇＧ２', 'IGG2'],
  ])('IgG subclass spelling %s → %s, with any or no order code', (item, key) => {
    for (const nhi of [undefined, '12149B', '12999B', '09999C']) {
      const observation = obs({ item, nhi, value: 100, unit: 'mg/dL' })
      expect(categorizeObservation(observation)?.id).toBe('immuno')
      expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
    }
  })

  it('reads the bilingual standardized IgE name', () => {
    const observation = obs({ item: '免疫球蛋白E ;(IgE)', value: 100 })
    expect(categorizeObservation(observation)?.id).toBe('immuno')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe('IGE')
  })

  it('accepts the older bridge NHI system too', () => {
    const observation = obs({ item: 'Ro52', nhi: '12064B', nhiSystem: BRIDGE_NHI, value: 'Negative' })
    expect(categorizeObservationWithReason(observation)).toMatchObject({ category: { id: 'immuno' }, decidedBy: 'code' })
  })
})

describe('name guards', () => {
  // 12103B / 12160B rows now reach 免疫's 電泳／輕鏈 subgroup (2026-10-11), but an
  // IgG under them is an IFE lane / light-chain row, never the IgG column.
  it.each([
    ['immunofixation band', { item: 'IgG', nhi: '12103B', value: 'Monoclonal band' }],
    ['free light chains', { item: 'IgG', nhi: '12160B', value: 12 }],
  ])('%s reaches only the electrophoresis / light-chain subgroup', (_label, input: any) => {
    const observation = obs(input)
    expect(categorizeObservation(observation)?.id).toBe('immuno')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toMatch(/^PP:/)
  })

  it.each([
    ['blood bank (Coombs IgG)', { item: 'IgG', nhi: '11003C', value: 'Negative' }],
    ['virus serology (14xxx)', { item: 'IgG', nhi: '14049C', value: 'Positive' }],
    ['microbiology (13xxx)', { item: 'IgM', nhi: '13999C', value: 'Positive' }],
    ['urinalysis (06xxx)', { item: 'IgG', nhi: '06999C', value: 3 }],
    ['CMV in the name', { item: 'CMV IgG', value: 'Positive' }],
    ['CMV in the order display', { item: 'IgG', nhi: '12999B', nhiDisplay: '巨細胞病毒抗體 CMV', value: 'Positive' }],
    ['CSF in the name', { item: 'CSF IgG', value: 3 }],
    ['urine in the name', { item: 'IgG (Urine)', value: 3 }],
    ['kappa light chain', { item: 'Free kappa', value: 12 }],
    ['immunofixation in the display', { item: 'IgG', nhiDisplay: 'Immunofixation electrophoresis', nhi: '12999B', value: 'Band' }],
  ])('%s stays out of 免疫', (_label, input: any) => {
    expect(categorizeObservation(obs(input))?.id).not.toBe('immuno')
  })

  it('a CSF specimen keeps an IgG out of the blood panels', () => {
    expect(categorizeObservation(obs({ item: 'IgG', value: 3, specimen: 'CSF' }))?.id).toBe('other')
  })

  it.each(['C3d', 'C3NeF', 'C4d', 'C3a', 'IgG index', 'IgG/Alb ratio', 'IgG4-RD score', 'Ki-67'])(
    '%s does not land on an immunology column',
    (item) => {
      const observation = obs({ item, value: 1 })
      expect(categorizeObservation(observation)?.id).not.toBe('immuno')
    },
  )

  it.each(['RF', 'Ku', 'Ki', 'EJ', 'OJ', 'Sm', 'RNP', 'SRP', 'SSA', 'SSB'])(
    'bare %s with no immunology context is not 免疫',
    (item) => {
      expect(categorizeObservation(obs({ item, value: 'Negative' }))?.id).not.toBe('immuno')
      expect(categorizeObservation(obs({ item, nhi: '09999C', value: 1 }))?.id).not.toBe('immuno')
    },
  )

  it.each([
    ['RF', { nhi: '12999C', nhiDisplay: '類風濕性關節炎因子試驗' }, 'RF'],
    ['Ku', { nhi: '12999B', nhiDisplay: 'Myositis line blot' }, 'ANTI-KU'],
    ['EJ', { nhiDisplay: '肌肉炎自體抗體組合', nhi: '12998B' }, 'ANTI-EJ'],
    ['Sm', { nhi: '12999B', nhiDisplay: 'ENA panel' }, 'ANTI-SM'],
    ['Ku', { nhi: '12155B' }, 'ANTI-KU'],
  ])('bare %s in an immunology context is 免疫', (item, context: any, key) => {
    const observation = obs({ item, ...context, value: 'Negative' })
    expect(categorizeObservation(observation)?.id).toBe('immuno')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
  })

  it.each([
    ['Ku Ab', 'ANTI-KU'], ['anti-Ku', 'ANTI-KU'], ['Ki Ab', 'ANTI-KI'], ['Rheumatoid factor', 'RF'],
    ['RA factor', 'RF'], ['SS-A', 'ANTI-SSA'], ['Sm Ab', 'ANTI-SM'], ['RNP Ab', 'ANTI-RNP'],
  ])('qualified %s needs no context', (item, key) => {
    const observation = obs({ item, value: 'Negative' })
    expect(categorizeObservation(observation)?.id).toBe('immuno')
    expect(getLabPivotTestIdentity(observation, 'immuno').testKey).toBe(key)
  })

  it('immunology names do not take over existing columns of other panels', () => {
    const cases: Array<[string, string]> = [
      ['CRP', 'chem'], ['WBC', 'cbc'], ['Protein', 'urine'], ['ESR', 'chem'], ['TSH', 'endocrine'],
      ['Anti-TPO', 'endocrine'], ['HBsAg', 'hep'], ['Ferritin', 'tumor'], ['HbA1c', 'glucose'],
    ]
    for (const [item, category] of cases) {
      expect(categorizeObservation(obs({ item, value: 1 }))?.id).toBe(category)
    }
  })
})

describe('specific-allergen IgE is kept out of the cumulative report', () => {
  it.each(ALLERGENS)('%s — coded 30022C or uncoded — has no category', (item) => {
    for (const observation of [
      obs({ item, nhi: '30022C', value: '<0.1', unit: 'KU/L' }),
      obs({ item, nhi: '30022C', loinc: '6833-8', value: '<0.1', unit: 'KU/L' }),
      obs({ item, value: '<0.1', unit: 'KU/L' }),
    ]) {
      expect(isExcludedFromCumulativeReport(observation)).toBe(true)
      expect(categorizeObservationWithReason(observation)).toEqual({ category: null, decidedBy: 'excluded' })
    }
  })

  it('any 30022C row is excluded, whatever its allergen name', () => {
    for (const item of ['牛奶', '蛋白', 'Alternaria tenuis 交錯黴菌', 'Penicillium 青黴菌', 'Phadiatop']) {
      expect(categorizeObservation(obs({ item, nhi: '30022C', value: '<0.1' }))).toBeNull()
    }
  })

  it('appears in no cumulative panel — not 免疫, 其他 or 微生物 — and in no lab-data report', () => {
    const rows = [
      ...ALLERGENS.map((item) => obs({ item, nhi: '30022C', value: '<0.1', unit: 'KU/L' })),
      obs({ item: '混合黴菌', value: '<0.1' }),
      obs({ item: 'IGG', nhi: '12025B', value: 1000 }),
    ]
    const pivots = buildLabPivots(rows)
    const names = Object.values(pivots).flatMap((pivot) => pivot.rows.filter((row) => row.values.size > 0).map((row) => row.displayName))
    expect(names).toEqual(['IgG'])
    const report = collectLabDataReportCandidates(rows, 'standardized')
    expect(report.candidates.map((candidate) => candidate.categoryId)).toEqual(['immuno'])
  })

  it('a 混合黴菌 allergen is still never a fungal culture; real cultures are', () => {
    expect(categorizeObservation(obs({ item: '混合黴菌', value: '<0.1' }))?.id).toBeUndefined()
    expect(categorizeObservation(obs({ item: '黴菌培養', nhi: '13007C', value: 'No growth' }))?.id).toBe('microbio')
  })

  it('total IgE (12031C) is not an allergen row', () => {
    expect(categorizeObservation(obs({ item: 'IgE', nhi: '12031C', value: 100 }))?.id).toBe('immuno')
  })
})

describe('former mis-routes', () => {
  it.each(['Ro52', 'Mi-2alpha(Mi-2a)', 'Mi-2beta(Mi-2b)', 'Jo-1', 'Ku'])(
    'line-blot %s "Negative" with no specimen is never 尿液',
    (item) => {
      const nhi = { Ro52: '12064B', 'Mi-2alpha(Mi-2a)': '12137B', 'Mi-2beta(Mi-2b)': '12137B', 'Jo-1': '12154B', Ku: '12155B' }[item]!
      const result = categorizeObservationWithReason(obs({ item, nhi, value: 'Negative' }))
      expect(result.category?.id).toBe('immuno')
      expect(result.decidedBy).not.toBe('qualitative')
    },
  )

  it('an immunology order with a Positive result and an unknown member name is not 尿液', () => {
    const observation = obs({ item: 'Zeta blot member', nhi: '12137B', value: 'Positive' })
    expect(categorizeObservationWithReason(observation)).toMatchObject({ category: { id: 'immuno' }, decidedBy: 'code' })
  })

  it('an immunology order whose specimen says urine still follows the specimen', () => {
    expect(categorizeObservation(obs({ item: 'IgG', nhi: '12025B', value: 3, specimen: 'Urine' }))?.id).toBe('urine')
  })
})

describe('columns come from the analyte, not the shared order code', () => {
  it('splits 12064B into SS-A, Ro52 and SS-B and 12173B into Sm and RNP', () => {
    const rows = [
      obs({ item: 'SS-A/Ro Ab', nhi: '12064B', value: 2 }),
      obs({ item: 'SS-B/La Ab', nhi: '12064B', value: 3 }),
      obs({ item: 'Ro52', nhi: '12064B', value: 'Negative' }),
      obs({ item: 'RNP Ab', nhi: '12173B', value: 4 }),
      obs({ item: 'Sm Ab', nhi: '12173B', value: 6 }),
      obs({ item: 'IGG', nhi: '12025B', value: 1000 }),
      obs({ item: 'C3', nhi: '12034B', value: 100 }),
      obs({ item: 'RF', nhi: '12011C', value: 9.5 }),
      obs({ item: 'IgG1亞型', value: 500 }),
    ]
    const pivot = buildLabPivots(rows).immuno
    expect(pivot.rows.map((row) => [row.testKey, row.subgroupId])).toEqual([
      ['IGG', 'immunoglobulin'],
      ['IGG1', 'immunoglobulin'],
      ['C3', 'immunoglobulin'],
      ['ANTI-SM', 'autoantibody'],
      ['ANTI-RNP', 'autoantibody'],
      ['ANTI-SSA', 'autoantibody'],
      ['ANTI-RO52', 'autoantibody'],
      ['ANTI-SSB', 'autoantibody'],
      ['RF', 'autoantibody'],
    ])
    const labels = Object.fromEntries(pivot.rows.map((row) => [row.testKey, row.displayName]))
    expect(labels).toMatchObject({ 'ANTI-SSA': 'SS-A/Ro', 'ANTI-SSB': 'SS-B/La', 'ANTI-RO52': 'Ro52', 'ANTI-SM': 'Sm', 'ANTI-RNP': 'RNP', C3: 'C3', RF: 'RF', IGG1: 'IgG1' })
  })

  it('a LOINC-coded, an order-coded and an uncoded row of one analyte share a column', () => {
    const pivot = buildLabPivots([
      obs({ item: 'SS-A/Ro Ab', nhi: '12064B', loinc: '33569-5', value: 2, date: '2026-01-01' }),
      obs({ item: 'SS-A/Ro Ab', nhi: '12064B', value: 0.5, date: '2026-09-30' }),
      obs({ item: 'Mi-2alpha(Mi-2a)', nhi: '12137B', value: 'Negative', date: '2026-01-01' }),
      obs({ item: 'Mi-2α', value: 'Negative', date: '2026-09-30' }),
      obs({ item: 'IgG 4', nhi: '12149B', loinc: '2469-5', value: 60, date: '2026-01-01' }),
      obs({ item: 'IgG4亞型', nhi: '27999C', value: 61, date: '2026-09-30' }),
    ]).immuno
    expect(pivot.rows.map((row) => [row.testKey, row.values.size])).toEqual([
      ['IGG4', 2],
      ['ANTI-SSA', 2],
      ['ANTI-MI-2A', 2],
    ])
  })

  it('does not label a column with the multi-analyte order name', () => {
    const pivot = buildLabPivots([
      obs({ item: 'Zeta blot member', nhi: '12137B', nhiSystem: 'urn:oid:nhi.lab.code', nhiDisplay: '肌肉炎自體抗體組合', value: 'Negative' }),
    ]).immuno
    expect(pivot.rows[0].displayName).toBe('Zeta blot member')
  })
})

describe('non-regression', () => {
  it('genuine uncoded urine dipstick rows still go to 尿液', () => {
    expect(categorizeObservationWithReason({ category: LAB, code: { text: 'Zeta strip' }, valueString: 'Negative' }))
      .toMatchObject({ category: { id: 'urine' }, decidedBy: 'qualitative' })
    expect(categorizeObservation(obs({ item: 'Protein', nhi: '06013C', value: 'Negative' }))?.id).toBe('urine')
    expect(categorizeObservationWithReason(obs({ item: 'Zeta strip', nhi: '06013C', value: 'Trace' })))
      .toMatchObject({ category: { id: 'urine' }, decidedBy: 'qualitative' })
  })

  it('genuine microbiology still goes to 微生物', () => {
    expect(categorizeObservation(obs({ item: 'Blood culture', nhi: '13016B', value: 'No growth' }))?.id).toBe('microbio')
    expect(categorizeObservation(obs({ item: 'Fungus culture', value: 'No growth' }))?.id).toBe('microbio')
  })

  it('CRP (12015C) stays in 生化', () => {
    expect(categorizeObservation(obs({ item: 'CRP', nhi: '12015C', value: 0.1 }))?.id).toBe('chem')
  })

  it('雲端病歷 CBC rows under 08 orders stay in 血液', () => {
    expect(categorizeObservation(obs({ item: 'WBC', nhi: '08011C', value: 6.2 }))?.id).toBe('cbc')
  })
})

describe('urine spot Prot/Cr ratio (09040C)', () => {
  it.each([
    ['NHI code only', undefined],
    ['with LOINC 2890-2', '2890-2'],
  ])('%s → 尿液 UPCR column', (_label, loinc) => {
    const observation = obs({ item: 'Prot/Cr ratio', nhi: '09040C', loinc, value: 0.1, unit: 'mg/g' })
    expect(categorizeObservation(observation)?.id).toBe('urine')
    const pivot = buildLabPivots([observation]).urine
    const row = pivot.rows.find((r) => r.values.size > 0)!
    expect(row.testKey).toBe('PROT/CR RATIO')
    expect(row.subgroupId).toBe('ratio')
  })

  it('a bare 09040C 全蛋白 is still not urine', () => {
    expect(categorizeObservation(obs({ item: 'TP', nhi: '09040C', value: 7.1 }))?.id).toBe('chem')
  })
})
