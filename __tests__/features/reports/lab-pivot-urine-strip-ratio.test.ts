import { buildLabPivots, type LabPivot } from '@/src/shared/utils/lab-pivot.utils'
import { getLabRowDisplayParts } from '@/src/shared/utils/lab-analyte-display.utils'

// A urinalysis (06012C) strip reports albumin, creatinine and their ratios as
// graded categories (ACR 10 / 30 / 80 / 150 / 300 …). In the ACR / UPCR / CREA
// columns they sat beside quantitative results on one trend line, where a
// category step read as a measured change. They keep their own columns.
// Values are synthetic; row shapes follow 雲端病歷 exports.
const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const LOCAL = 'https://cloud-wildcatch.invalid/fhir/upstream-local/CodeSystem/his-local-lab'
let seq = 0
const urine = (text: string, value: number, unit: string, coding: Array<{ system: string; code: string }>, date = '2026-04-04') => ({
  resourceType: 'Observation', id: `urine-strip-${seq++}`, status: 'final', effectiveDateTime: date,
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  specimen: { display: 'Urine' },
  code: { text, coding },
  valueQuantity: { value, unit },
})
const strip = (local: string, value: number, unit: string, date?: string) =>
  urine(local, value, unit, [{ system: NHI, code: '06012C' }, { system: LOCAL, code: local }], date)

const cell = (pivot: LabPivot, key: string, date = '2026-04-04') =>
  pivot.rows.find(row => row.testKey === key)?.values.get(date)?.value
const row = (pivot: LabPivot, key: string) => pivot.rows.find(r => r.testKey === key)

it('gives urinalysis strip ratios, albumin and creatinine their own columns', () => {
  const pivot = buildLabPivots([
    strip('ACRatio', 150, '(mg/g Cr)'),
    strip('PCRatio', 300, '(mg/g Cr)'),
    strip('Albumin', 15, 'mg/dL'),
    strip('Creatinine', 100, 'mg/dL'),
  ]).urine
  expect(cell(pivot, 'ACR-STRIP')).toBe('150')
  expect(cell(pivot, 'UPCR-STRIP')).toBe('300')
  expect(cell(pivot, 'ALB-STRIP')).toBe('15')
  expect(cell(pivot, 'CREA-STRIP')).toBe('100')
  for (const key of ['ACR-STRIP', 'UPCR-STRIP', 'ALB-STRIP', 'CREA-STRIP']) {
    expect(row(pivot, key)?.subgroupId).toBe('strip')
  }
  expect(row(pivot, 'ACR')).toBeUndefined()
  expect(row(pivot, 'PROT/CR RATIO')).toBeUndefined()
})

it('keeps quantitative results in the ratio columns, apart from the strip', () => {
  const pivot = buildLabPivots([
    strip('ACRatio', 150, '(mg/g Cr)'),
    strip('ACRatio', 30, '(mg/g Cr)', '2026-01-04'),
    urine('Microalbumin/Creatinine Ratio', 87, 'mg/g', [{ system: 'http://loinc.org', code: '14959-1' }, { system: NHI, code: '12111C' }]),
    urine('Prot/Cr ratio', 210, 'mg/g', [{ system: 'http://loinc.org', code: '2890-2' }, { system: NHI, code: '09040C' }]),
    urine('U-CRE', 80, 'mg/dL', [{ system: 'http://loinc.org', code: '2161-8' }, { system: NHI, code: '09016C' }]),
  ]).urine
  expect(cell(pivot, 'ACR')).toBe('87')
  expect(cell(pivot, 'PROT/CR RATIO')).toBe('210')
  expect(cell(pivot, 'CREA')).toBe('80')
  expect(row(pivot, 'ACR')?.subgroupId).toBe('ratio')
  // The strip's own trend holds only strip results.
  expect([...row(pivot, 'ACR-STRIP')!.values.values()].map(c => c.value).sort()).toEqual(['150', '30'])
})

it('treats a result named semi-quantitative as a strip result', () => {
  const pivot = buildLabPivots([
    urine('微白蛋白/肌酐酸比值(半定量)', 30, 'mg/g', []),
    urine('微白蛋白(尿)(半定量)', 30, 'mg/L', [{ system: 'http://loinc.org', code: '14957-5' }]),
    urine('肌酸酐(尿液)(半定量)', 100, 'mg/dL', []),
  ]).urine
  expect(pivot.rows.filter(r => r.values.size > 0).map(r => r.testKey).sort()).toEqual(['ACR-STRIP', 'CREA-STRIP', 'MALB-STRIP'])
})

it('names the strip columns in each language', () => {
  const acr = row(buildLabPivots([strip('ACRatio', 150, '(mg/g Cr)')]).urine, 'ACR-STRIP')!
  expect(getLabRowDisplayParts(acr, 'medical', 'zh-TW').name).toBe('ACR (試紙)')
  expect(getLabRowDisplayParts(acr, 'medical', 'en').name).toBe('ACR (strip)')
})
