// 免疫 third subgroup 「電泳／輕鏈」 (paraprotein), user decision 2026-10-11.
// NHI orders (verified against the NHI fee schedule, 2026-10-10): 12103B
// 免疫電泳分析, 12157B CSF IEP, 12158B urine IEP, 12159B urine IFE, 12160B
// 免疫球蛋白κ/λ; SPEP 09065B / UPEP 09100B only for an explicit M-protein row;
// 06010C Bence-Jones stays in 尿液. LOINCs verified on tx.fhir.org (LOINC
// 2.82, all ACTIVE) on 2026-10-11.
import { categorizeObservation, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import { buildLabPivots, getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'
import { IMMUNOLOGY_NAME_DENIED_NHI_ORDER_CODES } from '@/src/shared/utils/immunology-analytes'
import { paraproteinTextBadge } from '@/src/shared/utils/paraprotein-analytes'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { en } from '@/src/shared/i18n/locales/en'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOINC = 'http://loinc.org'
let seq = 0

function row(item: string, nhi: string | undefined, value: number | string, opts: { unit?: string; loinc?: string; specimen?: string; orderDisplay?: string; date?: string } = {}) {
  seq += 1
  return {
    resourceType: 'Observation', id: `pp-${seq}`, status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: {
      text: item,
      coding: [
        ...(nhi ? [{ system: NHI, code: nhi, ...(opts.orderDisplay ? { display: opts.orderDisplay } : {}) }] : []),
        ...(opts.loinc ? [{ system: LOINC, code: opts.loinc }] : []),
      ],
    },
    ...(typeof value === 'number' ? { valueQuantity: { value, unit: opts.unit ?? 'mg/L' } } : { valueString: value }),
    ...(opts.specimen ? { specimen: { display: opts.specimen } } : {}),
    effectiveDateTime: `${opts.date ?? '2026-10-01'}T08:00:00+08:00`,
  }
}

function placement(o: any): string {
  const id = categorizeObservation(o)?.id ?? 'none'
  return id === 'immuno' ? `immuno/${getLabPivotTestIdentity(o, 'immuno').testKey}` : id
}

const immuno = LAB_CATEGORIES.find((c) => c.id === 'immuno')!

describe('paraprotein subgroup definition', () => {
  it('is the third stacked panel of 免疫, with zh-TW and en labels', () => {
    expect(immuno.subgroups?.map((s) => s.id)).toEqual(['immunoglobulin', 'autoantibody', 'paraprotein'])
    expect(immuno.stackedPanels).toEqual([['immunoglobulin'], ['autoantibody'], ['paraprotein']])
    expect((zhTW as any).reports.cumulativeSubgroups.paraprotein).toBe('電泳／輕鏈')
    expect((en as any).reports.cumulativeSubgroups.paraprotein).toBeTruthy()
  })

  it('denies 12159B (urine IFE) for immunoglobulin name matching, like 12103B / 12160B', () => {
    expect(IMMUNOLOGY_NAME_DENIED_NHI_ORDER_CODES).toEqual(expect.arrayContaining(['12103B', '12159B', '12160B']))
  })
})

describe('routing and columns', () => {
  it.each([
    // serum IFE / IEP text and its lanes fold into one text column
    ['IFE', '12103B', 'IgG-kappa monoclonal band in gamma region', {}, 'immuno/PP:IFE'],
    ['Immunofixation', '12103B', 'No monoclonal band', {}, 'immuno/PP:IFE'],
    ['IgG', '12103B', 'Present', {}, 'immuno/PP:IFE'],
    ['IgA', '12103B', 'Absent', {}, 'immuno/PP:IFE'],
    ['Kappa', '12103B', 'Present', {}, 'immuno/PP:IFE'],
    // a numeric IgG under the IEP order never reaches the IgG column
    ['IgG', '12103B', 1200, { unit: 'mg/dL' }, 'immuno/PP:IFE'],
    // urine IFE / IEP, CSF IEP — before specimen routing
    ['Urine IFE', '12159B', 'Free kappa light chain detected', { specimen: 'Urine' }, 'immuno/PP:U:IFE'],
    ['IgM', '12159B', 'Absent', { specimen: 'Urine' }, 'immuno/PP:U:IFE'],
    ['Urine IEP', '12158B', 'No Bence-Jones protein', { specimen: 'Urine' }, 'immuno/PP:U:IEP'],
    ['CSF IEP', '12157B', 'Oligoclonal pattern', { specimen: 'CSF' }, 'immuno/PP:CSF:IEP'],
    ['Urine IFE', '12103B', 'Negative', { specimen: 'Urine' }, 'immuno/PP:U:IFE'],
    // 12160B: free / total only when the name says so
    ['Free Kappa', '12160B', 15.2, {}, 'immuno/PP:KAPPA-FREE'],
    ['FLC Lambda', '12160B', 12.1, {}, 'immuno/PP:LAMBDA-FREE'],
    ['FLC K/L ratio', '12160B', 1.26, { unit: '' }, 'immuno/PP:KL-RATIO-FREE'],
    ['游離輕鏈 κ', '12160B', 15.2, {}, 'immuno/PP:KAPPA-FREE'],
    ['Total Kappa', '12160B', 260, { unit: 'mg/dL' }, 'immuno/PP:KAPPA-TOTAL'],
    ['κ 總量', '12160B', 260, { unit: 'mg/dL' }, 'immuno/PP:KAPPA-TOTAL'],
    ['Lambda total', '12160B', 150, { unit: 'mg/dL' }, 'immuno/PP:LAMBDA-TOTAL'],
    ['UFLC Kappa', '12160B', 8.1, {}, 'immuno/PP:U:KAPPA-FREE'],
    ['Free Kappa', '12160B', 8.1, { specimen: 'Urine' }, 'immuno/PP:U:KAPPA-FREE'],
    // LOINC decides where the name is silent
    ['Kappa', undefined, 15.2, { loinc: '36916-5' }, 'immuno/PP:KAPPA-FREE'],
    ['Lambda', undefined, 12.1, { loinc: '33944-0' }, 'immuno/PP:LAMBDA-FREE'],
    ['K/L', undefined, 1.2, { loinc: '48378-4', unit: '' }, 'immuno/PP:KL-RATIO-FREE'],
    ['Kappa', undefined, 260, { loinc: '11050-2', unit: 'mg/dL' }, 'immuno/PP:KAPPA-TOTAL'],
    ['K/L', undefined, 1.7, { loinc: '15189-4', unit: '' }, 'immuno/PP:KL-RATIO-TOTAL'],
    ['IFE', undefined, 'Negative', { loinc: '25700-6' }, 'immuno/PP:IFE'],
    ['Urine IFE', undefined, 'Negative', { loinc: '14896-5', specimen: 'Urine' }, 'immuno/PP:U:IFE'],
    ['Urine IEP', undefined, 'Negative', { loinc: '34440-8', specimen: 'Urine' }, 'immuno/PP:U:IEP'],
    ['IgG lane', undefined, 'Detected', { loinc: '44597-3' }, 'immuno/PP:IFE'],
    // M-protein: from SPEP only when the row says so
    ['M-protein', '09065B', 1.2, { unit: 'g/dL' }, 'immuno/PP:M-PROTEIN'],
    ['M-spike', '09065B', 0.8, { unit: 'g/dL' }, 'immuno/PP:M-PROTEIN'],
    ['M蛋白', '09065B', 0.8, { unit: 'g/dL' }, 'immuno/PP:M-PROTEIN'],
    ['M-protein', '09100B', 0.3, { unit: 'g/L', specimen: 'Urine' }, 'immuno/PP:U:M-PROTEIN'],
    ['M-protein', undefined, 1.1, { loinc: '33358-3', unit: 'g/dL' }, 'immuno/PP:M-PROTEIN'],
  ] as Array<[string, string | undefined, number | string, any, string]>)('%s under %s = %s → %s', (item, nhi, value, opts, want) => {
    expect(placement(row(item, nhi, value, opts))).toBe(want)
  })

  it('keeps a neutral κ/λ (no free / total marker) in a column named after the source, serum and urine apart', () => {
    const serum = getLabPivotTestIdentity(row('κ/λ ratio', '12160B', 1.4, { unit: '' }), 'immuno')
    const urine = getLabPivotTestIdentity(row('κ/λ ratio', '12160B', 3.1, { unit: '', specimen: 'Urine' }), 'immuno')
    const kappa = getLabPivotTestIdentity(row('Kappa', '12160B', 15), 'immuno')
    expect(categorizeObservation(row('κ/λ ratio', '12160B', 1.4, { unit: '' }))?.id).toBe('immuno')
    expect(serum.testKey).toMatch(/^PP:/)
    expect(serum.testKey).not.toMatch(/FREE|TOTAL/)
    expect(serum.displayName).toBe('κ/λ ratio')
    expect(urine.testKey).not.toBe(serum.testKey)
    expect(kappa.testKey).not.toMatch(/FREE|TOTAL/)
    expect(kappa.displayName).toBe('Kappa')
  })

  it('keeps SPEP fractions and Bence-Jones where they were', () => {
    for (const item of ['Albumin', 'Alpha-1 globulin', 'Gamma globulin', 'A/G ratio']) {
      expect(categorizeObservation(row(item, '09065B', 1.2, { unit: 'g/dL' }))?.id).not.toBe('immuno')
    }
    expect(categorizeObservation(row('Bence Jones protein', '06010C', 'Negative'))?.id).toBe('urine')
    expect(categorizeObservation(row('本周氏蛋白', '06010C', 'Negative', { specimen: 'Urine' }))?.id).toBe('urine')
  })

  it('assigns every paraprotein row to the paraprotein subgroup, ordered after the autoantibodies', () => {
    const pivot = buildLabPivots([
      row('IgG', '12025B', 1100, { unit: 'mg/dL' }),
      row('IFE', '12103B', 'No monoclonal band'),
      row('Free Kappa', '12160B', 15.2),
      row('κ/λ ratio', '12160B', 1.4, { unit: '' }),
      row('Urine IFE', '12159B', 'Negative', { specimen: 'Urine' }),
    ]).immuno
    const rows = pivot.rows.filter((r) => r.values.size > 0)
    expect(rows.find((r) => r.testKey === 'IGG')?.subgroupId).toBe('immunoglobulin')
    for (const r of rows.filter((r) => r.testKey.startsWith('PP:'))) expect(r.subgroupId).toBe('paraprotein')
    expect(rows.filter((r) => r.testKey.startsWith('PP:'))).toHaveLength(4)
  })

  it('labels the fixed columns in zh-TW and en', () => {
    const header = (testKey: string, lang: 'zh-TW' | 'en') =>
      getLabRowDisplayParts({ testKey, displayName: testKey }, 'medical', lang).name
    expect(header('PP:KAPPA-FREE', 'zh-TW')).toContain('κ')
    expect(header('PP:KAPPA-FREE', 'en')).toMatch(/free/i)
    expect(header('PP:U:IFE', 'zh-TW')).toContain('尿')
    expect(header('PP:U:IFE', 'en')).toMatch(/urine/i)
    expect(header('PP:IFE', 'zh-TW')).toContain('血清')
    expect(header('PP:M-PROTEIN', 'en')).toMatch(/M-protein/)
  })
})

describe('paraprotein text badge', () => {
  it.each([
    [['No monoclonal band'], '陰性', 'Negative'],
    [['Negative'], '陰性', 'Negative'],
    [['未見單株球蛋白'], '陰性', 'Negative'],
    [['IgG-kappa monoclonal band in gamma region'], 'IgG-κ', 'IgG-κ'],
    [['IgA lambda'], 'IgA-λ', 'IgA-λ'],
    [['Monoclonal IgM κ, free λ also seen'], 'IgM-κ', 'IgM-κ'],
    [['Free lambda light chain detected'], 'free λ', 'free λ'],
    [['IgG: Absent', 'IgA: Absent', 'Negative'], '陰性', 'Negative'],
    [['Present'], '見報告', 'See report'],
    [['Oligoclonal pattern, suggest correlation'], '見報告', 'See report'],
    [['IgG-κ', 'IgA-λ'], 'IgG-κ + IgA-λ', 'IgG-κ + IgA-λ'],
  ] as Array<[string[], string, string]>)('%j → %s / %s', (values, zh, enBadge) => {
    expect(paraproteinTextBadge(values, 'zh-TW')).toBe(zh)
    expect(paraproteinTextBadge(values, 'en')).toBe(enBadge)
  })
})
