import {
  buildLabDataReport,
  collectLabDataReportCandidates,
  detectLabDataSource,
  stripInstitutionCodes,
} from '@/features/lab-data-report/utils/build-lab-data-report'
import { LAB_DATA_REPORT_MAX_ROWS, type LabDataReportContext } from '@/features/lab-data-report/types'
import { FhirMapper } from '@/src/infrastructure/fhir/mappers/fhir.mapper'

// Synthetic rows only — shaped like the two bridges' output, values invented.
const LOINC = 'http://loinc.org'
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const SD = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/'
const LAB_CATEGORY = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]

const CONTEXT: LabDataReportContext = {
  appVersion: '9.9.9',
  dataSource: 'medcloud',
  site: 'unknown',
  language: 'zh-TW',
  nameMode: 'standardized',
}

let seq = 0
function lab(overrides: Record<string, any>): any {
  seq += 1
  return {
    resourceType: 'Observation',
    id: `obs-secret-${seq}`,
    status: 'final',
    category: LAB_CATEGORY,
    subject: { reference: 'Patient/PATIENT-SECRET' },
    encounter: { reference: 'Encounter/ENC-SECRET' },
    basedOn: [{ reference: 'ServiceRequest/SR-SECRET' }],
    performer: [{ reference: 'Organization/ORG-SECRET', display: '測試醫院;0936050029' }],
    ...overrides,
  }
}

// CBC hemoglobin that a mapper stamped with a urine specimen (中國醫藥北 shape).
const hbUnderUrine = (date: string, value: number) => lab({
  code: {
    text: '血色素檢查',
    coding: [
      { system: LOINC, code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' },
      { system: NHI, code: '08003C', display: '血色素檢查(含尿液)' },
    ],
  },
  specimen: { display: 'Urine' },
  effectiveDateTime: date,
  valueQuantity: { value, unit: 'g/dL' },
})

// The same result delivered as a daily and a monthly copy (台中慈濟 shape).
const potassiumCopy = (time: string, mark: string) => lab({
  code: { text: 'K', coding: [{ system: LOINC, code: '2823-3', display: 'Potassium' }] },
  specimen: { display: 'Blood' },
  effectiveDateTime: '2026-03-02',
  valueQuantity: { value: 4.41, unit: 'mmol/L' },
  interpretation: [{ coding: [{ code: 'N' }] }],
  referenceRange: [{ text: '3.5~5.1' }],
  note: [{ text: 'NOTE-SECRET 病人主訴' }],
  meta: {
    tag: [
      { system: 'https://cloud-wildcatch.invalid/fhir/nhi-visit-date', code: '2026-03-02' },
      { system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/adapter-version', code: '0.12.13' },
      { system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/source-reconciliation', code: 'merged-daily-monthly-lab-copies' },
    ],
  },
  extension: [
    { url: `${SD}medcloud-source-report-instance-time`, valueString: `2026-03-02T${time}` },
    { url: `${SD}medcloud-source-data-mark`, valueString: mark },
    { url: `${SD}medcloud-source-assay-category`, valueString: '生化學檢查' },
    { url: `${SD}medcloud-historical-lab-source`, valueUri: 'https://medcloud2.nhi.gov.tw/imu/api/imue0060/imue0060s03/get-data' },
    { url: `${SD}medcloud-lab-source-copy`, extension: [{ url: 'sourceRow', valueString: 'deadbeefdeadbeefdeadbeefdeadbeef' }, { url: 'sourceRow', valueString: 'cafebabecafebabecafebabecafebabe' }] },
    { url: `${SD}medcloud-unlisted-extension`, valueString: 'SHOULD-NOT-TRAVEL' },
  ],
})

function build(observations: any[], extra: Partial<Parameters<typeof buildLabDataReport>[1]> = {}) {
  const collected = collectLabDataReportCandidates(observations, 'standardized')
  return {
    collected,
    ...buildLabDataReport(collected, {
      problemType: 'wrong-panel',
      description: 'Hb 出現在尿液',
      includeValues: true,
      context: CONTEXT,
      ...extra,
    }),
  }
}

describe('lab-data report builder', () => {
  it('reports the rows the panel shows and why they landed there', () => {
    const { payload } = build([hbUnderUrine('2026-03-01T09:30:00+08:00', 13.2)])
    expect(payload.rows).toHaveLength(1)
    const row = payload.rows[0]
    expect(row.app).toEqual(expect.objectContaining({ categoryId: 'urine', decidedBy: 'specimen-urine' }))
    expect(row.specimen).toBe('Urine')
    expect(row.code.codings).toEqual(expect.arrayContaining([
      { system: NHI, code: '08003C', display: '血色素檢查(含尿液)' },
    ]))
    expect(row.timeOfDay).toBe('09:30:00')
    expect(row.day).toBe(0)
    // The institution code is taken out; the hospital name travels.
    expect(row.performer).toEqual(['測試醫院'])
    expect(row.value).toEqual({ kind: 'quantity', value: 13.2, magnitude: 1, decimals: 1 })
  })

  it('marks identical results with one group and keeps each copy\'s source time', () => {
    const { payload } = build([
      potassiumCopy('11:46:00', '健保月檔;'),
      potassiumCopy('11:46:23', '健保日檔;'),
    ])
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows.map((row) => row.sameValueGroup)).toEqual([1, 1])
    expect(payload.rows.map((row) => row.sourceTime)).toEqual([
      { dayDelta: 0, time: '11:46:00' },
      { dayDelta: 0, time: '11:46:23' },
    ])
    const row = payload.rows[0]
    expect(row.sourceExtensions).toEqual([
      { name: 'medcloud-source-data-mark', value: '健保月檔;' },
      { name: 'medcloud-source-assay-category', value: '生化學檢查' },
      { name: 'medcloud-historical-lab-source', value: 'imue0060/imue0060s03/get-data' },
      { name: 'medcloud-lab-source-copy', value: '2' },
    ])
    expect(row.sourceTags).toEqual([
      'adapter-version:0.12.13',
      'source-reconciliation:merged-daily-monthly-lab-copies',
    ])
    expect(row.interpretation).toEqual(['N'])
    expect(row.referenceRange).toEqual([{ text: '3.5~5.1' }])
  })

  it('never carries ids, references, notes, absolute dates or row digests', () => {
    const { payload } = build([
      potassiumCopy('11:46:00', '健保月檔;'),
      hbUnderUrine('2026-03-01T09:30:00+08:00', 13.2),
    ])
    const json = JSON.stringify(payload)
    for (const secret of ['SECRET', 'obs-secret', '2026-03-0', 'deadbeef', 'cafebabe', 'SHOULD-NOT-TRAVEL', 'nhi-visit-date', 'medcloud2.nhi.gov.tw']) {
      expect(json).not.toContain(secret)
    }
  })

  it('without values keeps shape, magnitude and equality but not the numbers', () => {
    const { payload } = build([
      potassiumCopy('11:46:00', '健保月檔;'),
      potassiumCopy('11:46:23', '健保日檔;'),
    ], { includeValues: false })
    expect(payload.includesValues).toBe(false)
    expect(payload.rows[0].value).toEqual({ kind: 'quantity', magnitude: 0, decimals: 2 })
    expect(payload.rows.map((row) => row.sameValueGroup)).toEqual([1, 1])
    expect(JSON.stringify(payload.rows.map((row) => row.value))).not.toContain('4.41')
  })

  it('sends short result strings only, and never narrative', () => {
    const shortText = lab({
      code: { text: 'Urine Color' },
      specimen: { display: 'Urine' },
      effectiveDateTime: '2026-03-01',
      valueString: 'Yellow',
    })
    const narrative = lab({
      code: { text: 'Urine Sediment Comment' },
      specimen: { display: 'Urine' },
      effectiveDateTime: '2026-03-01',
      valueString: '顯微鏡下可見大量白血球與細菌，建議臨床追蹤並重新採檢以排除污染之可能',
    })
    const { payload } = build([shortText, narrative])
    const byName = Object.fromEntries(payload.rows.map((row) => [row.code.text, row.value]))
    expect(byName['Urine Color']).toEqual({ kind: 'string', value: 'Yellow', length: 6 })
    expect(byName['Urine Sediment Comment']).toEqual({ kind: 'string', length: 34 })
  })

  it('drops source strings that look like identifiers and counts them', () => {
    const masked = hbUnderUrine('2026-03-01', 13.2)
    masked.performer = [{ display: '病人 F203XXX511' }]
    masked.referenceRange = [{ text: '採檢 2026/03/01' }]
    const { payload } = build([masked])
    expect(payload.rows[0].performer).toEqual([])
    expect(payload.rows[0].referenceRange).toEqual([])
    expect(payload.droppedStrings).toBe(2)
  })

  it('drops chart numbers, bare mobiles and old ROC birth dates in any source string', () => {
    const texts = ['病歷號 12345678', '0912345678', '生日 65/3/12', '出生日期 79年3月12日']
    const rows = texts.map((text) => {
      const row = hbUnderUrine('2026-03-01', 13.2)
      row.referenceRange = [{ text }]
      return row
    })
    const { payload } = build(rows)
    expect(payload.rows.map((row) => row.referenceRange)).toEqual([[], [], [], []])
    expect(payload.droppedStrings).toBe(4)
  })

  it.each([
    ['臺北榮民總醫院;0601160016', '臺北榮民總醫院'],
    ['臺北榮民總醫院 / 檢驗科 / 0601160016', '臺北榮民總醫院 / 檢驗科'],
    ['0601160016;臺北榮民總醫院', '臺北榮民總醫院'],
    ['臺北榮民總醫院;0601160016;檢驗科', '臺北榮民總醫院;檢驗科'],
    ['臺北榮民總醫院／檢驗科；０６０１１６００１６', '臺北榮民總醫院/檢驗科'],
    // Everything but the code is left exactly as written — mixed separators too.
    ['測試醫院;生日 65/3/12', '測試醫院;生日 65/3/12'],
    ['測試醫院;採檢 2026/03/01;0601160016', '測試醫院;採檢 2026/03/01'],
    ['測試醫院|檢驗科/血液組', '測試醫院|檢驗科/血液組'],
    // Not a whole segment: left in place for the scan to drop.
    ['測試醫院0601160016', '測試醫院0601160016'],
    ['測試醫院;12345678901', '測試醫院;12345678901'],
  ])('stripInstitutionCodes(%j) → %j', (display, expected) => {
    expect(stripInstitutionCodes(display)).toBe(expected)
  })

  it('still drops a performer whose remaining text holds a date, with mixed separators', () => {
    const birthday = hbUnderUrine('2026-03-01', 13.2)
    birthday.performer = [{ display: '測試醫院;生日 65/3/12' }]
    const western = hbUnderUrine('2026-03-02', 13.1)
    western.performer = [{ display: '測試醫院 / 採檢 2026/03/01 / 0601160016' }]
    const { payload } = build([birthday, western])
    expect(payload.rows.map((row) => row.performer)).toEqual([[], []])
    expect(payload.droppedStrings).toBe(2)
  })

  it('takes only the 10-digit institution code out of performer', () => {
    const slashed = hbUnderUrine('2026-03-01', 13.2)
    slashed.performer = [{ display: '臺北榮民總醫院 / 檢驗科 / 0601160016' }]
    const chart = hbUnderUrine('2026-03-02', 13.1)
    chart.performer = [{ display: '測試醫院;病歷號12345678' }]
    const mobile = hbUnderUrine('2026-03-03', 13.0)
    mobile.performer = [{ display: '測試醫院 0912345678' }]
    const { payload } = build([slashed, chart, mobile])
    const byDay = Object.fromEntries(payload.rows.map((row) => [row.day, row.performer]))
    expect(byDay[0]).toEqual(['臺北榮民總醫院 / 檢驗科'])
    expect(byDay[1]).toEqual([])
    expect(byDay[2]).toEqual([])
    expect(payload.droppedStrings).toBe(2)
  })

  it('counts, but never sends, non-laboratory observations shown in a lab panel', () => {
    const vital = {
      resourceType: 'Observation',
      id: 'vital-1',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { coding: [{ system: LOINC, code: '2345-7', display: 'Glucose' }] },
      effectiveDateTime: '2026-03-01',
      valueQuantity: { value: 110, unit: 'mg/dL' },
    }
    const glucose = lab({
      code: { coding: [{ system: LOINC, code: '2345-7', display: 'Glucose' }] },
      effectiveDateTime: '2026-03-01',
      valueQuantity: { value: 98, unit: 'mg/dL' },
    })
    const { payload } = build([vital, glucose])
    expect(payload.rows).toHaveLength(1)
    expect(payload.excludedNonLabRows).toBe(1)
  })

  it('reports the app\'s mapped observations (the cumulative report\'s own input)', () => {
    // useClinicalData hands the table FhirMapper entities, which drop
    // resourceType; the report must see the same rows the table shows.
    const entities = [hbUnderUrine('2026-03-01', 13.2), potassiumCopy('11:46:00', '健保月檔;')]
      .map((observation) => FhirMapper.toObservation(observation))
    const { payload } = build(entities)
    expect(payload.rows).toHaveLength(2)
    expect(payload.excludedNonLabRows).toBe(0)
  })

  it('decides laboratory from the FHIR category, never from the name', () => {
    const category = (code: string) => ({ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code }] })
    const glucose = (overrides: Record<string, any>) => lab({
      code: { text: 'Blood pressure questionnaire', coding: [{ system: LOINC, code: '2345-7', display: 'Glucose' }] },
      effectiveDateTime: '2026-03-01',
      valueQuantity: { value: 98, unit: 'mg/dL' },
      ...overrides,
    })
    const survey = glucose({ category: [category('survey')] })
    const labAndSurvey = glucose({ category: [category('laboratory'), category('survey')] })
    const uncategorised = glucose({ category: undefined })
    const systemless = glucose({ category: [{ coding: [{ code: 'laboratory' }] }] })
    const localOnly = glucose({ category: [{ coding: [{ system: 'urn:local', code: 'LAB' }] }] })
    const legacySystem = glucose({ category: [{ coding: [{ system: 'http://hl7.org/fhir/observation-category', code: 'laboratory' }] }] })
    const withLocal = glucose({ category: [category('laboratory'), { coding: [{ system: 'urn:local', code: 'chemistry' }] }] })
    const { payload } = build([survey, labAndSurvey, uncategorised, systemless, localOnly, legacySystem, withLocal])
    expect(payload.excludedNonLabRows).toBe(5)
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows.every((row) => row.category[0] === 'laboratory')).toBe(true)
    expect(payload.rows.map((row) => row.category).sort()).toEqual([['laboratory'], ['laboratory', 'chemistry']])
  })

  it('newest first, day 0 = earliest kept row, capped at the row limit', () => {
    const many = Array.from({ length: LAB_DATA_REPORT_MAX_ROWS + 5 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10)
      return hbUnderUrine(day, 12 + (index % 10) / 10)
    })
    const { payload, totalRows } = build(many)
    expect(totalRows).toBe(LAB_DATA_REPORT_MAX_ROWS + 5)
    expect(payload.rows).toHaveLength(LAB_DATA_REPORT_MAX_ROWS)
    expect(payload.truncatedRows).toBe(5)
    expect(payload.rows[0].day).toBe(LAB_DATA_REPORT_MAX_ROWS - 1)
    expect(payload.rows.at(-1)?.day).toBe(0)
    expect(payload.rows.map((row) => row.ref)).toEqual(payload.rows.map((_, index) => index + 1))
  })

  it('sends every panel, in the clinician\'s panel order, and records flagged panels', () => {
    const wbcBlood = lab({
      code: { text: 'WBC', coding: [{ system: LOINC, code: '6690-2' }] },
      specimen: { display: 'Blood' },
      effectiveDateTime: '2026-03-01',
      valueQuantity: { value: 6.2, unit: '10^3/uL' },
    })
    // The same result also filed under 尿液 — one result, two panels.
    const wbcUrine = { ...wbcBlood, id: 'wbc-urine', specimen: { display: 'Urine' } }
    const { payload } = build([hbUnderUrine('2026-03-01', 13.2), wbcBlood, wbcUrine, potassiumCopy('11:46:00', '健保月檔;')], {
      categoryOrder: ['urine', 'chem', 'cbc'],
      flaggedCategories: ['urine', 'coag'],
    })
    expect(payload.rows.map((row) => row.app.categoryId)).toEqual(['urine', 'urine', 'chem', 'cbc'])
    // coag has no rows, so it is not recorded as flagged.
    expect(payload.scope).toEqual({
      flaggedCategories: ['urine'],
      categories: [
        { categoryId: 'urine', rows: 2 },
        { categoryId: 'chem', rows: 1 },
        { categoryId: 'cbc', rows: 1 },
      ],
    })
    const wbcRows = payload.rows.filter((row) => row.app.testKey === 'WBC')
    expect(wbcRows).toHaveLength(2)
    expect(wbcRows[0].sameValueGroup).toBeDefined()
    expect(wbcRows[0].sameValueGroup).toBe(wbcRows[1].sameValueGroup)
    // One day axis across panels.
    expect(new Set(wbcRows.map((row) => row.day))).toEqual(new Set([0]))
  })

  it('keeps flagged panels whole when the row cap bites', () => {
    const recentUrine = Array.from({ length: LAB_DATA_REPORT_MAX_ROWS }, (_, index) =>
      hbUnderUrine(new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10), 13))
    const oldChem = Array.from({ length: 5 }, (_, index) => ({
      ...potassiumCopy('11:46:00', '健保日檔;'),
      id: `old-k-${index}`,
      effectiveDateTime: new Date(Date.UTC(2010, 0, 1 + index)).toISOString().slice(0, 10),
    }))
    const unflagged = build([...recentUrine, ...oldChem]).payload
    expect(unflagged.rows).toHaveLength(LAB_DATA_REPORT_MAX_ROWS)
    expect(unflagged.truncatedRows).toBe(5)
    expect(unflagged.rows.some((row) => row.app.categoryId === 'chem')).toBe(false)

    const flagged = build([...recentUrine, ...oldChem], { flaggedCategories: ['chem'] }).payload
    expect(flagged.rows).toHaveLength(LAB_DATA_REPORT_MAX_ROWS)
    expect(flagged.rows.filter((row) => row.app.categoryId === 'chem')).toHaveLength(5)
    expect(flagged.truncatedRows).toBe(5)
  })
})

describe('detectLabDataSource', () => {
  it('reads the bridge from the rows, then falls back to the launch source', () => {
    expect(detectLabDataSource([potassiumCopy('11:46:00', '健保日檔;')], 'import')).toBe('medcloud')
    expect(detectLabDataSource([{ meta: { tag: [{ system: 'http://nhi-fhir-bridge/nhi-source-channel', code: 'A' }] } }], 'import')).toBe('nhi')
    expect(detectLabDataSource([{}], 'smart')).toBe('smart')
    expect(detectLabDataSource([{}], 'medcloud2')).toBe('medcloud')
    expect(detectLabDataSource([{}], 'none')).toBe('unknown')
  })
})
