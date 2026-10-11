// Unit-based specimen inference (user decision 2026-10-11), for the analytes
// measured in both serum and urine — total protein, albumin, calcium,
// creatinine — and the immunology non-blood check. Evidence, strongest first:
//   1. an explicit specimen: the row's name (尿 / urine / serum / 血清) or a
//      structured specimen;
//   2. the unit class: mg/g, g/g, mg/mg, mg/mmol → urine ratio; mg/24h,
//      g/day → 24-h urine; g/dL, g/L → blood; mg/dL alone decides nothing;
//   3. the MediCloud inspect mode (batch-level, can be wrong) — only when the
//      reference range supports it;
//   4. conflict or nothing → today's behaviour.
// Real data: a 09011C serum "Ca 9.6 mg/dL [8.6~10.0]" carried inspect mode
// URINE(SPOT); it must stay in 生化.
import { categorizeObservation } from '@/src/shared/utils/lab-categories'

const NHI = 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-service-payment-tw'
const INSPECT = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/medcloud-source-inspect-mode'

function row(item: string, nhi: string, value: number, unit: string, opts: { range?: string | [number?, number?]; inspect?: string; specimen?: string } = {}) {
  const range = opts.range === undefined ? undefined
    : typeof opts.range === 'string' ? [{ text: opts.range }]
      : [{ ...(opts.range[0] !== undefined ? { low: { value: opts.range[0], unit } } : {}), ...(opts.range[1] !== undefined ? { high: { value: opts.range[1], unit } } : {}) }]
  return {
    resourceType: 'Observation', status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { text: item, coding: [{ system: NHI, code: nhi }] },
    valueQuantity: { value, unit },
    ...(range ? { referenceRange: range } : {}),
    ...(opts.inspect ? { extension: [{ url: INSPECT, valueString: opts.inspect }] } : {}),
    ...(opts.specimen ? { specimen: { display: opts.specimen } } : {}),
    effectiveDateTime: '2026-10-01T08:00:00+08:00',
  }
}

const cat = (o: any) => categorizeObservation(o)?.id

describe('unit class decides the specimen', () => {
  it.each([
    // urine ratios
    ['TP', '09040C', 150, 'mg/g'],
    ['Total protein', '09040C', 0.15, 'g/g'],
    ['Protein', '09040C', 0.2, 'mg/mg'],
    ['Albumin', '09038C', 30, 'mg/g'],
    ['Albumin', '09038C', 3.1, 'mg/mmol'],
    ['Ca', '09011C', 0.2, 'mg/mg'],
    ['Creatinine', '09015C', 1.1, 'g/g'],
    // 24-h urine
    ['Total protein', '09040C', 0.8, 'g/day'],
    ['TP', '09040C', 450, 'mg/24h'],
    ['Ca', '09011C', 180, 'mg/24hr'],
    ['Creatinine', '09015C', 1.2, 'g/24h'],
  ])('%s under %s, %s %s → 尿液', (item, nhi, value, unit) => {
    expect(cat(row(item, nhi, value, unit))).toBe('urine')
  })

  it.each([
    ['Total protein', '09040C', 7.1, 'g/dL', 'URINE(SPOT)'],
    ['Albumin', '09038C', 4.1, 'g/dL', 'URINE(SPOT)'],
    ['Albumin', '09038C', 41, 'g/L', '尿液'],
  ])('%s %s %s with inspect mode %s stays 生化 (g/dL, g/L are blood)', (item, nhi, value, unit, inspect) => {
    expect(cat(row(item, nhi, value, unit, { inspect }))).toBe('chem')
  })
})

describe('inspect mode counts only with a supporting reference range', () => {
  it('keeps the real-data serum Ca 9.6 mg/dL [8.6~10.0] under URINE(SPOT) in 生化', () => {
    expect(cat(row('Ca', '09011C', 9.6, 'mg/dL', { range: '[8.6~10.0]', inspect: 'URINE(SPOT)' }))).toBe('chem')
    expect(cat(row('Ca', '09011C', 9.6, 'mg/dL', { range: [8.6, 10.0], inspect: 'URINE(SPOT)' }))).toBe('chem')
  })

  it.each([
    ['Creatinine', '09015C', 85, 'mg/dL', '[20~300]'],
    ['Creatinine', '09015C', 85, 'mg/dL', '20-300'],
    ['Ca', '09011C', 12, 'mg/dL', '[<20]'],
    ['TP', '09040C', 9, 'mg/dL', '[<12]'],
  ])('%s %s %s %s with a urine-like range under URINE(SPOT) → 尿液', (item, nhi, value, unit, range) => {
    expect(cat(row(item, nhi, value, unit, { range, inspect: 'URINE(SPOT)' }))).toBe('urine')
  })

  it.each([
    ['Creatinine', '09015C', 1.0, 'mg/dL', '[0.7~1.3]', 'URINE(SPOT)'],
    ['Creatinine', '09015C', 85, 'mg/dL', undefined, 'URINE(SPOT)'],
    ['Creatinine', '09015C', 85, 'mg/dL', '[20~300]', 'SERUM_YL'],
    ['Creatinine', '09015C', 85, 'mg/dL', '[20~300]', undefined],
  ])('%s %s %s %s with inspect %s keeps today\'s category', (item, nhi, value, unit, range, inspect) => {
    const o = row(item, nhi, value, unit, { range, inspect })
    const baseline = row(item, nhi, value, unit)
    expect(cat(o)).toBe(cat(baseline))
  })
})

describe('explicit specimen wins over unit and inspect mode', () => {
  it.each([
    ['Serum creatinine', '09015C', 85, 'mg/dL', { range: '[20~300]', inspect: 'URINE(SPOT)' }, 'chem'],
    ['Serum Ca', '09011C', 12, 'mg/dL', { range: '[<20]', inspect: 'URINE(SPOT)' }, 'chem'],
    ['Urine creatinine', '09015C', 1.1, 'mg/dL', { inspect: 'SERUM_YL' }, 'urine'],
    ['Creatinine', '09015C', 1.1, 'g/g', { specimen: 'Serum' }, 'chem'],
  ] as Array<[string, string, number, string, any, string]>)('%s → %s', (item, nhi, value, unit, opts, want) => {
    expect(cat(row(item, nhi, value, unit, opts))).toBe(want)
  })

  it('mg/dL alone decides nothing', () => {
    expect(cat(row('Creatinine', '09015C', 1.0, 'mg/dL'))).toBe('chem')
    expect(cat(row('Ca', '09011C', 9.4, 'mg/dL'))).toBe('chem')
  })
})

describe('immunology non-blood check', () => {
  it('refuses an immunology name on a urine unit or a supported urine inspect mode', () => {
    expect(cat(row('IgG', '12025B', 1100, 'mg/dL'))).toBe('immuno')
    expect(cat(row('IgG', '12999B', 12, 'mg/g'))).not.toBe('immuno')
    expect(cat(row('IgG', '12999B', 1100, 'mg/dL', { inspect: 'URINE(SPOT)', range: '[700~1600]' }))).toBe('immuno')
  })
})

it('「血清鈣」 under URINE(SPOT) with a urine-like range is still never 尿液 (its name says serum)', () => {
  // (It files under 其他: 生化 has no 「鈣」 alias — a separate, pre-existing gap.)
  expect(cat(row('血清鈣', '09011C', 12, 'mg/dL', { range: '[<20]', inspect: 'URINE(SPOT)' }))).not.toBe('urine')
})

it('leaves ratio names to the urine ratio rules, whatever their unit', () => {
  // A ratio is its own urine analyte; its unit cannot make it serum.
  for (const [item, unit] of [['Prot/Cr ratio', 'g/dL'], ['Prot/Cr ratio', 'mg/g'], ['Alb/Cr ratio', 'g/L'], ['微白蛋白/肌酸酐比值', 'g/dL']]) {
    expect(cat(row(item, item.startsWith('Prot') ? '09040C' : '12111C', 7, unit))).toBe('urine')
  }
})
