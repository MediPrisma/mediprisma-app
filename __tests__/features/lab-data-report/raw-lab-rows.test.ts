import {
  assembleRawLabSource,
  extractRawLabRows,
  parseRawDate,
} from '@/features/lab-data-report/utils/raw-lab-rows'
import { LAB_DATA_REPORT_MAX_RAW_ROWS } from '@/features/lab-data-report/types'

// Synthetic capture in the extension's toRawCapturePayload shape. Values are
// invented; the identifier-like ones are planted to prove they never pass.
const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000

function s02Row(overrides: Record<string, unknown> = {}) {
  return {
    r: 1,
    assay_item_name: 'Hb',
    assay_mark: 'L',
    assay_method: '',
    assay_tp_cname: '血液',
    assay_value: '11.2',
    case_time: '2026-03-02T09:30:00+08:00',
    consult_value: '12~16',
    data_mark: 'S',
    fee_ym: '202603',
    func_type: 'AA',
    hosp: '合成醫院甲',
    hosp_id: '0601160016',
    icd_cname: '合成診斷名稱',
    icd_code: 'Z00.0',
    inspect_mode: '1',
    inspect_result: null,
    memo_data: null,
    order_code: '08003C',
    order_name: '血色素檢查',
    path_diag_1: '合成病理診斷',
    path_diag_2: null,
    path_diag_3: null,
    real_inspect_date: '2026/03/02',
    recipe_date: '115/03/01',
    unit_data: 'g/dL',
    ...overrides,
  }
}

function capture(rows: unknown[], history?: unknown, extraEndpoints: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { log2time: '2026-03-05 10:00:00', robject: rows }
  if (history !== undefined) body._cloudWildcatchLabHistory = { status: 200, body: JSON.stringify(history) }
  return JSON.stringify({
    patient: 'F203XXX511',
    capturedAt: '2026-03-05T10:00:00+08:00',
    endpoints: {
      '/imu/api/imue0060/imue0060s02/get-data': { status: 200, body: JSON.stringify(body) },
      '/imu/api/imue0008/imue0008s02/get-data': { status: 200, body: JSON.stringify({ robject: [{ drug_code: 'X' }] }) },
      ...extraEndpoints,
    },
  })
}

describe('parseRawDate (the bridge formats)', () => {
  it.each([
    ['2026-03-02', day('2026-03-02'), undefined],
    ['2026-03-02T09:30:00+08:00', day('2026-03-02'), '09:30:00'],
    ['2026-03-02 09:30', day('2026-03-02'), '09:30'],
    ['2026/3/2', day('2026-03-02'), undefined],
    ['2026/03/02 07:05:09', day('2026-03-02'), '07:05:09'],
    ['115/03/01', day('2026-03-01'), undefined],
    ['65/3/12', day('1976-03-12'), undefined],
    ['20260302', day('2026-03-02'), undefined],
  ])('%s', (text, ordinal, time) => {
    expect(parseRawDate(text)).toEqual({ ordinal, ...(time && { time }) })
  })

  it.each(['2026-02-30', '0/1/1', '3月2日', '', 'x', '2026.03.02'])('rejects %j', (text) => {
    expect(parseRawDate(text)).toBeNull()
  })
})

describe('extractRawLabRows + assembleRawLabSource', () => {
  const dayZero = day('2026-03-01')

  it('keeps only allow-listed fields, dates on the report axis', () => {
    const extract = extractRawLabRows(capture([s02Row()]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true, producerVersion: '0.12.19' })
    expect(source).toEqual({
      producer: 'medcloud2',
      producerVersion: '0.12.19',
      rows: [{
        ref: 1,
        source: 's02',
        ordinal: 1,
        dates: {
          case_time: { day: 1, time: '09:30:00' },
          real_inspect_date: { day: 1 },
          recipe_date: { day: 0 },
        },
        fields: {
          order_code: '08003C',
          order_name: '血色素檢查',
          assay_item_name: 'Hb',
          unit_data: 'g/dL',
          consult_value: '12~16',
          assay_mark: 'L',
          assay_tp_cname: '血液',
          inspect_mode: '1',
          data_mark: 'S',
          hosp: '合成醫院甲',
          func_type: 'AA',
        },
        results: { assay_value: '11.2' },
        withheld: {},
      }],
      s02Rows: 1,
      s03Rows: 0,
      endpointStatus: { s02: 200 },
      truncatedRows: 0,
      droppedStrings: 0,
      unparsedDates: 0,
      unknownFields: [],
    })
  })

  it('never carries the masked ID, diagnoses, hosp_id, fee_ym, log2time or other endpoints', () => {
    const extract = extractRawLabRows(capture([s02Row()]))!
    const json = JSON.stringify(assembleRawLabSource(extract, { dayZero, includeValues: true }))
    for (const secret of ['F203XXX511', 'Z00.0', '合成診斷名稱', '合成病理診斷', '0601160016', '202603', '2026-03-05', 'drug_code', '2026']) {
      expect(json).not.toContain(secret)
    }
  })

  it('takes only the 10-digit institution code out of hosp, as for performer', () => {
    const extract = extractRawLabRows(capture([
      s02Row({ hosp: '合成醫院甲;檢驗科;0601160016' }),
      s02Row({ r: 2, hosp: '合成醫院乙;病歷號12345678' }),
    ]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true })
    expect(source.rows[0].fields.hosp).toBe('合成醫院甲;檢驗科')
    expect(source.rows[1].fields.hosp).toBeUndefined()
    expect(source.droppedStrings).toBe(1)
  })

  it('reports unknown field names, never their values', () => {
    const extract = extractRawLabRows(capture([s02Row({ new_col: 'SECRET-VALUE', 'bad name!': 'x' })]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true })
    expect(source.unknownFields).toEqual(['new_col'])
    expect(JSON.stringify(source)).not.toContain('SECRET-VALUE')
  })

  it('drops identifier-like strings and counts them', () => {
    const extract = extractRawLabRows(capture([
      s02Row({ consult_value: '病歷號 12345678' }),
      s02Row({ r: 2, hosp: '合成醫院 0912345678', assay_value: '生日 65/3/12' }),
    ]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true })
    expect(source.rows[0].fields.consult_value).toBeUndefined()
    expect(source.rows[1].fields.hosp).toBeUndefined()
    expect(source.rows[1].results.assay_value).toBeUndefined()
    expect(source.droppedStrings).toBe(3)
  })

  it('sends free-text results only as a short result, and only with values', () => {
    const long = '顯微鏡下可見大量白血球與細菌，建議臨床追蹤並重新採檢'
    const extract = extractRawLabRows(capture([
      s02Row({ assay_value: 'Negative', inspect_result: long, memo_data: '陽性(+)' }),
    ]))!
    const withValues = assembleRawLabSource(extract, { dayZero, includeValues: true }).rows[0]
    expect(withValues.results).toEqual({ assay_value: 'Negative', memo_data: '陽性(+)' })
    expect(withValues.withheld).toEqual({ inspect_result: long.length })
    const withoutValues = assembleRawLabSource(extract, { dayZero, includeValues: false }).rows[0]
    expect(withoutValues.results).toEqual({})
    expect(withoutValues.withheld).toEqual({ assay_value: 8, inspect_result: long.length, memo_data: 5 })
  })

  it('reads the S03 history sidecar', () => {
    const extract = extractRawLabRows(capture([s02Row()], [
      { assaY_NAME: 'HbA1c', assaY_VALUE: 6.8, assaY_DATE: '2024-11-20', rn: 3 },
      { assaY_NAME: 'Cr', assaY_VALUE: null, assaY_DATE: '2024-11-20', rn: 4, extra: 1 },
    ]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true })
    expect(source.s03Rows).toBe(2)
    expect(source.endpointStatus).toEqual({ s02: 200, s03: 200 })
    expect(source.rows[1]).toEqual({
      ref: 2,
      source: 's03',
      ordinal: 3,
      dates: { assaY_DATE: { day: day('2024-11-20') - dayZero } },
      fields: { assaY_NAME: 'HbA1c' },
      results: { assaY_VALUE: 6.8 },
      withheld: {},
    })
    expect(source.rows[2].results).toEqual({})
    expect(source.unknownFields).toEqual(['extra'])
  })

  it('counts, and never sends, dates it cannot read', () => {
    const extract = extractRawLabRows(capture([s02Row({ recipe_date: '三月一日', real_inspect_date: '' })]))!
    const source = assembleRawLabSource(extract, { dayZero, includeValues: true })
    expect(source.rows[0].dates).toEqual({ case_time: { day: 1, time: '09:30:00' } })
    expect(source.unparsedDates).toBe(1)
    expect(JSON.stringify(source)).not.toContain('三月一日')
  })

  it('starts its own axis when no converted row is dated', () => {
    const extract = extractRawLabRows(capture([s02Row()]))!
    const source = assembleRawLabSource(extract, { dayZero: null, includeValues: true })
    expect(source.rows[0].dates.recipe_date).toEqual({ day: 0 })
  })

  it('caps the row count', () => {
    const rows = Array.from({ length: LAB_DATA_REPORT_MAX_RAW_ROWS + 3 }, (_, index) => s02Row({ r: index + 1 }))
    const source = assembleRawLabSource(extractRawLabRows(capture(rows))!, { dayZero, includeValues: true })
    expect(source.rows).toHaveLength(LAB_DATA_REPORT_MAX_RAW_ROWS)
    expect(source.truncatedRows).toBe(3)
  })

  it('is null when the capture has no IMUE0060 source, or is not JSON', () => {
    expect(extractRawLabRows(JSON.stringify({ endpoints: { '/imu/api/imue0008/imue0008s02/get-data': { status: 200, body: '{}' } } }))).toBeNull()
    expect(extractRawLabRows('not json')).toBeNull()
  })

  it.each(['A123456789', 'v0.12.19', '0.12.19-beta', '2026.07.04'])('leaves out producer version %j', (producerVersion) => {
    const extract = extractRawLabRows(capture([s02Row()]))!
    expect(assembleRawLabSource(extract, { dayZero, includeValues: true, producerVersion }).producerVersion).toBeUndefined()
  })

  it('keeps a manifest version', () => {
    const extract = extractRawLabRows(capture([s02Row()]))!
    expect(assembleRawLabSource(extract, { dayZero, includeValues: true, producerVersion: '0.12.19' }).producerVersion).toBe('0.12.19')
  })
})
