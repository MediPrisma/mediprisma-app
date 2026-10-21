import { pairRawRows } from '@/features/lab-data-report/admin/raw-pairing'
import type { LabDataReportRawRow, LabDataReportRow } from '@/features/lab-data-report/types'

const converted = (ref: number, day: number | null, text: string, value: LabDataReportRow['value'], codes: string[] = []): LabDataReportRow => ({
  ref, day, performer: [], code: { text, codings: codes.map((code) => ({ code })) }, category: ['laboratory'], value,
  interpretation: [], referenceRange: [], sourceExtensions: [], sourceTags: [],
  app: { categoryId: 'cbc', decidedBy: 'loinc', testKey: text, column: text },
})
const raw = (ref: number, days: number[], fields: LabDataReportRawRow['fields'], value?: string | number): LabDataReportRawRow => ({
  ref, source: 's02', dates: Object.fromEntries(days.map((day, i) => [['case_time', 'real_inspect_date', 'recipe_date'][i], { day }])),
  fields, results: value === undefined ? {} : { assay_value: value }, withheld: {},
})
const q = (value: number) => ({ kind: 'quantity' as const, value, magnitude: 0, decimals: 1 })

describe('pairRawRows', () => {
  it('pairs by day + order code or name + value, one to one', () => {
    const rows = [converted(1, 3, 'Hb', q(11.2), ['08003C']), converted(2, 3, 'Hb', q(11.2), ['08003C']), converted(3, 4, 'PLT', q(250))]
    const rawRows = [
      raw(1, [3], { order_code: '08003C', assay_item_name: 'Hb' }, '11.2'),
      raw(2, [9, 3], { assay_item_name: 'hb' }, '11.20'),
      raw(3, [4], { assay_item_name: 'Glu' }, '98'),
    ]
    const pairing = pairRawRows(rows, rawRows)
    expect([...pairing.convertedByRaw]).toEqual([[1, 1], [2, 2]])
    expect(pairing.unmatchedRaw).toEqual([3])
    expect(pairing.unmatchedConverted).toEqual([3])
  })

  it('prefers the raw row whose value matches exactly', () => {
    const rows = [converted(1, 0, 'K', q(4.41))]
    const rawRows = [raw(1, [0], { assay_item_name: 'K' }), raw(2, [0], { assay_item_name: 'K' }, '4.41')]
    expect([...pairRawRows(rows, rawRows).convertedByRaw]).toEqual([[2, 1]])
  })

  it('pairs equal values first, then flags a same-day same-test pair whose values differ', () => {
    const rows = [converted(1, 0, 'CRP', { kind: 'quantity', value: 0.5, comparator: '<', magnitude: -1, decimals: 1 }), converted(2, 0, 'CRP', q(2))]
    const rawRows = [raw(1, [0], { assay_item_name: 'CRP' }, '<0.5'), raw(2, [0], { assay_item_name: 'CRP' }, '3')]
    const pairing = pairRawRows(rows, rawRows)
    expect([...pairing.convertedByRaw]).toEqual([[1, 1], [2, 2]])
    expect([...pairing.valueDiffers]).toEqual([2])
    expect(pairing.unmatchedRaw).toEqual([])
  })

  it('does not count the unit written into a raw value as a difference', () => {
    const rows = [converted(1, 5, 'Testosterone', q(2.33), ['09121C'])]
    const pairing = pairRawRows(rows, [raw(1, [5], { order_code: '09121C', assay_item_name: 'Testosterone', unit_data: 'ng/mL' }, '2.33 ng/mL')])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect(pairing.valueDiffers.size).toBe(0)
  })

  it.each([
    ['a comparator', { kind: 'quantity', value: 0.5, magnitude: -1, decimals: 1 }, '<0.5'],
    ['a comparator the other way', { kind: 'quantity', value: 0.5, comparator: '<', magnitude: -1, decimals: 1 }, '0.5'],
    ['a ≤ against a bare value', { kind: 'quantity', value: 0.5, magnitude: -1, decimals: 1 }, '≤0.5'],
    ['a ≥ against a bare value', { kind: 'quantity', value: 10, magnitude: 1, decimals: 0 }, '≥10'],
    ['≤ against <', { kind: 'quantity', value: 0.5, comparator: '<', magnitude: -1, decimals: 1 }, '≤0.5'],
    ['≥ against >', { kind: 'quantity', value: 10, comparator: '>', magnitude: 1, decimals: 0 }, '≥10'],
    ['qualitative wording', { kind: 'string', value: 'Reactive(0.18)', length: 14 }, 'Nonreactive(0.18)'],
    ['a sign', { kind: 'string', value: '(+)', length: 3 }, '(-)'],
  ])('flags %s as a different result', (_label, value, rawValue) => {
    const pairing = pairRawRows([converted(1, 0, 'HBsAg', value as LabDataReportRow['value'])], [raw(1, [0], { assay_item_name: 'HBsAg' }, rawValue)])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect([...pairing.valueDiffers]).toEqual([1])
  })

  it.each([
    ['≤0.5', { kind: 'quantity', value: 0.5, comparator: '<=', magnitude: -1, decimals: 1 }],
    ['≥10', { kind: 'quantity', value: 10, comparator: '>=', magnitude: 1, decimals: 0 }],
    ['⩽0.5', { kind: 'quantity', value: 0.5, comparator: '<=', magnitude: -1, decimals: 1 }],
    ['=>10', { kind: 'quantity', value: 10, comparator: '>=', magnitude: 1, decimals: 0 }],
    ['＜0.5', { kind: 'quantity', value: 0.5, comparator: '<', magnitude: -1, decimals: 1 }],
    ['≦0.5', { kind: 'quantity', value: 0.5, comparator: '<=', magnitude: -1, decimals: 1 }],
    ['Nonreactive(0.18)', { kind: 'string', value: 'Nonreactive (0.18)', length: 18 }],
    ['1+', { kind: 'string', value: '1+', length: 2 }],
  ])('treats %j as the same result', (rawValue, value) => {
    const pairing = pairRawRows([converted(1, 0, 'X', value as LabDataReportRow['value'])], [raw(1, [0], { assay_item_name: 'X' }, rawValue)])
    expect(pairing.valueDiffers.size).toBe(0)
    expect(pairing.convertedByRaw.size).toBe(1)
  })

  it('pairs by test name before a shared order code, so swapped values show', () => {
    // WBC and RBC share 08011C; the conversion swapped their values.
    const rows = [converted(1, 0, 'WBC', q(4.5), ['08011C']), converted(2, 0, 'RBC', q(6.1), ['08011C'])]
    const rawRows = [
      raw(1, [0], { order_code: '08011C', assay_item_name: 'WBC' }, '6.1'),
      raw(2, [0], { order_code: '08011C', assay_item_name: 'RBC' }, '4.5'),
    ]
    const pairing = pairRawRows(rows, rawRows)
    expect([...pairing.convertedByRaw]).toEqual([[1, 1], [2, 2]])
    expect([...pairing.valueDiffers].sort()).toEqual([1, 2])
  })

  it('does not pair on an order code several tests share that day', () => {
    const rows = [converted(1, 0, '白血球', q(6.1), ['08011C']), converted(2, 0, '紅血球', q(4.5), ['08011C'])]
    const pairing = pairRawRows(rows, [raw(1, [0], { order_code: '08011C', assay_item_name: 'Leukocyte' }, '6.1')])
    expect(pairing.convertedByRaw.size).toBe(0)
    expect(pairing.unmatchedRaw).toEqual([1])
  })

  it('pairs on an order code only one test carries that day', () => {
    const rows = [converted(1, 0, '肌酸酐', q(1.1), ['09015C'])]
    const pairing = pairRawRows(rows, [raw(1, [0], { order_code: '09015C', assay_item_name: 'Creatinine' }, '1.1')])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
  })

  it('does not force a differing pair among several candidates', () => {
    const rows = [converted(1, 0, 'K', q(4.1)), converted(2, 0, 'K', q(4.2))]
    const pairing = pairRawRows(rows, [raw(1, [0], { assay_item_name: 'K' }, '5.0')])
    expect(pairing.convertedByRaw.size).toBe(0)
  })

  it('matches source names to the converted column through the canonical key', () => {
    const rows = [
      { ...converted(1, 0, 'Hb', q(13.2), ['08011C']), app: { categoryId: 'cbc', decidedBy: 'loinc' as const, testKey: 'HB', column: 'Hb' } },
      { ...converted(2, 0, 'Neutrophils %', q(61), ['08013C']), app: { categoryId: 'cbc', decidedBy: 'loinc' as const, testKey: 'NEU', column: 'NEU' } },
      { ...converted(3, 0, 'Lymphocytes %', q(30), ['08013C']), app: { categoryId: 'cbc', decidedBy: 'loinc' as const, testKey: 'LYM', column: 'LYM' } },
    ]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '08011C', assay_item_name: 'HGB' }, '13.2'),
      raw(2, [0], { order_code: '08013C', assay_item_name: 'Neutrophil 嗜中性多核球' }, '61'),
      raw(3, [0], { order_code: '08013C', assay_item_name: 'Lymphocyte 淋巴球' }, '30'),
    ])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1], [2, 2], [3, 3]])
    expect(pairing.valueDiffers.size).toBe(0)
  })

  it('matches a name written into a longer converted text as a whole word only', () => {
    const rows = [converted(1, 0, '睪丸酯醇免疫分析 ;(Testosterone (EIA/LIA))', q(2.3), ['09121C']), converted(2, 0, 'HbA1c', q(6.1))]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { assay_item_name: 'Testosterone' }, '2.3'),
      raw(2, [0], { assay_item_name: 'Hb' }, '6.1'),
    ])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect(pairing.unmatchedRaw).toEqual([2])
  })

  it('keeps rows from another module out of "no raw row"', () => {
    const other = { ...converted(1, 0, 'Creatinine', q(1.1), ['09015C']), sourceTags: ['source-module:imue0140'] }
    const lab = { ...converted(2, 0, 'Hb', q(12), ['08003C']), sourceTags: ['source-module:imue0060'] }
    const pairing = pairRawRows([other, lab], [raw(1, [0], { order_code: '09015C', assay_item_name: 'Creatinine' }, '1.1')])
    expect(pairing.convertedByRaw.size).toBe(0)
    expect(pairing.otherSource).toEqual([1])
    expect(pairing.unmatchedConverted).toEqual([2])
  })

  it('pairs S03 history rows by name and date', () => {
    const rows = [converted(1, -400, 'HbA1c', q(6.8))]
    const history: LabDataReportRawRow = { ref: 1, source: 's03', dates: { assaY_DATE: { day: -400 } }, fields: { assaY_NAME: 'HbA1c' }, results: { assaY_VALUE: 6.8 }, withheld: {} }
    expect([...pairRawRows(rows, [history]).convertedByRaw]).toEqual([[1, 1]])
  })

  it('lets the exact name win over a canonical match (two eGFR formulas, one value)', () => {
    // A hospital's "Estimated GFR" and its CKD-EPI row carry the same value on
    // one day; each raw row must land on the converted row that bears its name.
    const withKey = (row: LabDataReportRow, testKey: string, column: string) => ({ ...row, app: { ...row.app, testKey, column } })
    const rows = [
      withKey(converted(1, 0, 'Estimated GFR', q(88), ['69405-9', '09015C']), 'EGFR(M)', 'eGFR'),
      withKey(converted(2, 0, '腎絲球過濾率(新) ;(eGFR-CKD-EPI)', q(88), ['62238-1', '09015C']), 'EGFR(EPI)', 'eGFR (CKD-EPI)'),
    ]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '09015C', assay_item_name: '腎絲球過濾率(新) ;(eGFR-CKD-EPI)' }, '88'),
      raw(2, [0], { order_code: '09015C', assay_item_name: 'Estimated GFR' }, '88'),
    ])
    expect([...pairing.convertedByRaw].sort()).toEqual([[1, 2], [2, 1]])
  })

  it('matches a history row by the source name the conversion kept as a code', () => {
    const rows = [converted(1, -30, 'Creatinine', q(1.1), ['2160-0', '09015C', 'Renal_Scr'])]
    const history: LabDataReportRawRow = { ref: 1, source: 's03', dates: { assaY_DATE: { day: -30 } }, fields: { assaY_NAME: 'Renal_Scr' }, results: { assaY_VALUE: 1.1 }, withheld: {} }
    const pairing = pairRawRows(rows, [history])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
  })

  it('shows the second 健保日檔／月檔 copy as merged, not dropped — unless its value differs', () => {
    const rows = [converted(1, 0, '三酸甘油脂 / Triglyceride', q(150), ['09004C'])]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '09004C', assay_item_name: 'Triglyceride', data_mark: '健保日檔;' }, '150'),
      raw(2, [0], { order_code: '09004C', assay_item_name: '三酸甘油脂', data_mark: '健保月檔;' }, '150'),
      raw(3, [0], { order_code: '09004C', assay_item_name: '三酸甘油脂', data_mark: '健保月檔;' }, '162'),
    ])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect([...pairing.mergedInto]).toEqual([[2, 1]])
    expect(pairing.unmatchedRaw).toEqual([3])
  })

  it('pairs the one row left under a shared order code, flagged as code only', () => {
    // SMEAR and CULTURE share 13026C; CULTURE pairs by name, SMEAR is what is left.
    const rows = [converted(1, 0, 'Acid-fast Stain', { kind: 'string', value: 'Negative', length: 8 }, ['11545-1', '13026C']), converted(2, 0, 'Mycobacterial Culture', { kind: 'string', value: 'No growth', length: 9 }, ['13026C'])]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '13026C', assay_item_name: 'SMEAR' }, 'Negative'),
      raw(2, [0], { order_code: '13026C', assay_item_name: 'Culture' }, 'No growth'),
    ])
    expect([...pairing.convertedByRaw].sort()).toEqual([[1, 1], [2, 2]])
    expect([...pairing.codeOnly]).toEqual([1])
    expect(pairing.valueDiffers.size).toBe(0)
  })

  it.each([
    ['the same value', 'Negative', []],
    ['values withheld', undefined, []],
    ['values that differ', 'Positive', [1]],
  ])('flags a pair made on the one order code that day as code only, with %s', (_label, rawValue, differs) => {
    // No name matches; 13026C is the one code on both sides that day.
    const rows = [converted(1, 0, 'Acid-fast Stain', { kind: 'string', value: 'Negative', length: 8 }, ['13026C'])]
    const pairing = pairRawRows(rows, [raw(1, [0], { order_code: '13026C', assay_item_name: 'SMEAR' }, rawValue)])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect([...pairing.codeOnly]).toEqual([1])
    expect([...pairing.valueDiffers]).toEqual(differs)
  })

  it('never passes a copy of a paired test off as the test left under its order code', () => {
    // WBC daily + monthly copies; RBC was converted but no raw row explains it.
    const rows = [converted(1, 0, 'WBC', q(5), ['08011C']), converted(2, 0, 'RBC', q(4), ['08011C'])]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '08011C', assay_item_name: 'WBC', data_mark: '健保日檔;' }, '5'),
      raw(2, [0], { order_code: '08011C', assay_item_name: 'WBC', data_mark: '健保月檔;' }, '5'),
    ])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect([...pairing.mergedInto]).toEqual([[2, 1]])
    expect(pairing.valueDiffers.size).toBe(0)
    expect(pairing.codeOnly.size).toBe(0)
    expect(pairing.unmatchedRaw).toEqual([])
    expect(pairing.unmatchedConverted).toEqual([2])
  })

  it('leaves a named row whose test is taken unpaired rather than eliminating it onto another test', () => {
    // The second WBC cannot be proven a copy (no value), so it stays
    // unpaired — and still never becomes the RBC.
    const rows = [converted(1, 0, 'WBC', q(5), ['08011C']), converted(2, 0, 'RBC', q(4), ['08011C'])]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '08011C', assay_item_name: 'WBC' }, '5'),
      raw(2, [0], { order_code: '08011C', assay_item_name: 'WBC' }),
    ])
    expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
    expect(pairing.mergedInto.size).toBe(0)
    expect(pairing.unmatchedRaw).toEqual([2])
    expect(pairing.unmatchedConverted).toEqual([2])
  })

  it('still eliminates once a provable copy is merged', () => {
    const rows = [converted(1, 0, 'WBC', q(5), ['08011C']), converted(2, 0, 'Stain B', q(4), ['08011C'])]
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '08011C', assay_item_name: 'WBC', data_mark: '健保日檔;' }, '5'),
      raw(2, [0], { order_code: '08011C', assay_item_name: 'WBC', data_mark: '健保月檔;' }, '5'),
      raw(3, [0], { order_code: '08011C', assay_item_name: 'Y' }, '4'),
    ])
    expect([...pairing.convertedByRaw].sort()).toEqual([[1, 1], [3, 2]])
    expect([...pairing.mergedInto]).toEqual([[2, 1]])
    expect([...pairing.codeOnly]).toEqual([3])
  })

  describe('merged copies need proof', () => {
    const at = (day: number, time: string) => ({ case_time: { day, time } })
    const k = (ref: number, time: string, value?: string, dataMark?: string): LabDataReportRawRow => ({
      ref, source: 's02', dates: at(0, time),
      fields: { order_code: '09022C', assay_item_name: 'K', ...(dataMark && { data_mark: dataMark }) },
      results: value === undefined ? {} : { assay_value: value }, withheld: value === undefined ? { assay_value: 3 } : {},
    })
    const convertedK = (value: LabDataReportRow['value'], time: string, sourceTags: string[] = []): LabDataReportRow => ({
      ...converted(1, 0, 'K', value, ['09022C']), sourceTime: { dayDelta: 0, time }, sourceTags,
    })
    const noValue = { kind: 'quantity' as const, magnitude: null, decimals: 1 }

    it('does not take a missing value for the same result', () => {
      // Two potassium tests that day, results withheld; only the 08:00 one
      // was converted. The 16:00 test may be one the conversion dropped.
      const pairing = pairRawRows([convertedK(noValue, '08:00:00')], [k(1, '08:00:00'), k(2, '16:00:00')])
      expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
      expect(pairing.mergedInto.size).toBe(0)
      expect(pairing.unmatchedRaw).toEqual([2])
    })

    it('does not merge the same value from another report instance', () => {
      const pairing = pairRawRows([convertedK(q(4.1), '08:00:00')], [k(1, '08:00:00', '4.1'), k(2, '16:00:00', '4.1')])
      expect([...pairing.convertedByRaw]).toEqual([[1, 1]])
      expect(pairing.mergedInto.size).toBe(0)
      expect(pairing.unmatchedRaw).toEqual([2])
    })

    it('merges the same value from the same report instance (a 月檔 copy drops the seconds)', () => {
      const pairing = pairRawRows([convertedK(q(4.1), '11:46:23')], [k(1, '11:46:23', '4.1', '健保日檔;'), k(2, '11:46:00', '4.1', '健保月檔;')])
      expect([...pairing.mergedInto]).toEqual([[2, 1]])
      expect(pairing.unmatchedRaw).toEqual([])
    })

    it('with values withheld, merges only the 日檔／月檔 pair the bridge says it merged', () => {
      const merged = 'source-reconciliation:merged-daily-monthly-lab-copies'
      const copies = [k(1, '11:46:23', undefined, '健保日檔;'), k(2, '11:46:00', undefined, '健保月檔;')]
      expect([...pairRawRows([convertedK(noValue, '11:46:23', [merged])], copies).mergedInto]).toEqual([[2, 1]])
      // Untagged, or a third row: unproven.
      expect(pairRawRows([convertedK(noValue, '11:46:23')], copies).unmatchedRaw).toEqual([2])
      const third = pairRawRows([convertedK(noValue, '11:46:23', [merged])], [...copies, k(3, '11:46:00', undefined, '健保月檔;')])
      expect([...third.mergedInto]).toEqual([[2, 1]])
      expect(third.unmatchedRaw).toEqual([3])
    })
  })

  it('does not eliminate when two tests are still left under the code', () => {
    const rows = [converted(1, 0, 'Stain A', q(1), ['13026C']), converted(2, 0, 'Stain B', q(2), ['13026C'])]
    const pairing = pairRawRows(rows, [raw(1, [0], { order_code: '13026C', assay_item_name: 'X' }, '1'), raw(2, [0], { order_code: '13026C', assay_item_name: 'Y' }, '2')])
    expect(pairing.convertedByRaw.size).toBe(0)
  })

  it('learns a history name from this report\'s own rows, to find the row it was folded into', () => {
    // The bridge keeps "Renal_Scr" as a code on the history rows it converts
    // (column CREA); a later history row it folded into an S02 row shows up as
    // a merged copy of that S02 creatinine, not as dropped.
    const crea = (ref: number, day: number, value: number, codes: string[]) => ({ ...converted(ref, day, 'Creatinine', q(value), codes), app: { categoryId: 'chem', decidedBy: 'loinc' as const, testKey: 'CREA', column: 'CREA' } })
    const rows = [crea(1, -300, 1.0, ['2160-0', '09015C', 'Renal_Scr']), crea(2, 0, 1.1, ['2160-0', '09015C'])]
    const history = (ref: number, day: number, value: number): LabDataReportRawRow => ({ ref, source: 's03', dates: { assaY_DATE: { day } }, fields: { assaY_NAME: 'Renal_Scr' }, results: { assaY_VALUE: value }, withheld: {} })
    const pairing = pairRawRows(rows, [
      raw(1, [0], { order_code: '09015C', assay_item_name: 'Creatinine' }, '1.1'),
      history(2, -300, 1.0),
      history(3, 0, 1.1),
    ])
    expect([...pairing.convertedByRaw].sort()).toEqual([[1, 2], [2, 1]])
    expect([...pairing.mergedInto]).toEqual([[3, 2]])
    expect(pairing.unmatchedRaw).toEqual([])
  })
})
