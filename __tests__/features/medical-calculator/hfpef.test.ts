import { resolveInput } from '@/features/medical-calculator/autofill-compute'
import { HFPEF } from '@/features/medical-calculator/calculators/hfpef'
import { parseCalculatorEcho, buildEchoAutofill } from '@/features/medical-calculator/echo-autofill'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
const h2 = HFPEF[0].compute, hfa = HFPEF[1].compute
const low = { age: '65', sex: 'male', rhythm: 'sr', e: '80', septalE: '8', lateralE: '12', trv: '2.5', gls: '18', lavi: '28', lvmi: '90', rwt: '0.4', wall: '10', ntprobnp: '100' }
const report = (conclusion: string, date = '2026-01-01', id = 'echo') => ({ id, status: 'final', code: { text: '心臟超音波', coding: [{ code: '18005C' }] }, conclusion, effectiveDateTime: date, performer: [{ display: 'Synthetic hospital' }] })

describe('HFpEF scores', () => {
  test('H2FPEF strict boundaries and maximum', () => {
    const boundary = { age: '60', bmi: '30', ee: '9', pasp: '35', af: 'no', antihypertensives: 'no' }
    expect(h2(boundary)?.value).toBe('0 / 9')
    expect(h2({ age: '61', bmi: '30.1', ee: '9.1', pasp: '35.1', af: 'yes', antihypertensives: 'yes' })?.value).toBe('9 / 9')
    expect(h2({ ...boundary, af: '' })?.extra?.[0].value).toBe('0–3 / 9')
    expect(h2({ ...boundary, bmi: '-1' })).toBeNull()
    expect(h2({ ...boundary, antihypertensives: '' })?.interpretation?.en).toContain('incomplete')
  })
  test('HFA complete normal synthetic Appcardio case = 0', () => expect(hfa(low)?.value).toBe('0 / 6'))
  test('three major domains capped at 6 even with multiple major criteria', () => {
    expect(hfa({ ...low, septalE: '4', averageEe: '18', trv: '3', lavi: '45', lvmi: '160', rwt: '0.5', ntprobnp: '800' })?.value).toBe('6 / 6')
  })
  test('AF NT-proBNP minor criterion starts at 365 pg/mL', () => {
    const afNormal = { ...low, rhythm: 'af', ntprobnp: '364.9' }
    expect(hfa(afNormal)?.value).toBe('0 / 6')
    expect(hfa({ ...afNormal, ntprobnp: '365' })?.value).toBe('1 / 6')
    expect(hfa({ ...afNormal, ntprobnp: '660' })?.value).toBe('1 / 6')
    expect(hfa({ ...afNormal, ntprobnp: '660.1' })?.value).toBe('2 / 6')
  })
  test('minor criteria and decimal E/e between 14 and 15', () => {
    expect(hfa({ ...low, averageEe: '14.5', lavi: '34', ntprobnp: '220' })?.value).toBe('3 / 6')
  })
  test('age-specific e-prime threshold changes at 75', () => {
    expect(hfa({ ...low, age: '74', septalE: '6', lateralE: '9', averageEe: '8' })?.value).toBe('2 / 6')
    expect(hfa({ ...low, age: '75', septalE: '6', lateralE: '9', averageEe: '8' })?.value).toBe('0 / 6')
  })
  test('sex-specific LVMI inclusive cutoffs and RWT strictly >0.42', () => {
    expect(hfa({ ...low, sex: 'female', lvmi: '122', rwt: '0.43' })?.value).toBe('2 / 6')
    expect(hfa({ ...low, sex: 'male', lvmi: '122', rwt: '0.43' })?.value).toBe('1 / 6')
    expect(hfa({ ...low, lvmi: '149', rwt: '0.42' })?.value).toBe('1 / 6')
    expect(hfa({ ...low, lvmi: '115' })?.value).toBe('1 / 6')
  })
  test.each([['sr', '220', '34', '2 / 6'], ['sr', '221', '34.1', '4 / 6'], ['af', '660', '40', '2 / 6'], ['af', '661', '40.1', '4 / 6']])('rhythm %s biomarker and LAVI boundaries', (rhythm, ntprobnp, lavi, score) => expect(hfa({ ...low, rhythm, ntprobnp, lavi })?.value).toBe(score))
  test.each([['sr', '35', 1], ['sr', '80', 1], ['sr', '81', 2], ['af', '105', 1], ['af', '240', 1], ['af', '241', 2]])('BNP %s %s', (rhythm, bnp, score) => expect(hfa({ ...low, ntprobnp: '', bnp, rhythm })?.value).toBe(`${score} / 6`))
  test('missing data yield ranges, never a false zero', () => {
    expect(hfa({ age: '65', sex: 'male', rhythm: 'sr', lavi: '28' })?.value).toBe('0–6 / 6')
    expect(hfa({ age: '65', sex: 'male', rhythm: 'sr', averageEe: '16', lavi: '40', ntprobnp: '300' })?.value).toBe('6 / 6')
    expect(hfa({ ...low, rhythm: '' })).toBeNull()
    expect(hfa({ ...low, sex: '' })).toBeNull()
    expect(hfa({ ...low, ntprobnp: '-1' })).toBeNull()
  })
})
describe('echo report autofill', () => {
  test('Taiwan report labels and cm/s, preserving mean E/e', () => {
    const values = parseCalculatorEcho("E/e' Sep: 18 E/e' Lat: 12 E/Avg e': 14 TR Vel: 300 cm/s RVSP: 42 mmHg LAVI: 38 mL/m² LVMI: 130 g/m² RWT: 0.45 GLS: -15%")
    expect(values).toMatchObject({ ee: 14, averageEe: 14, trv: 3, pasp: 42, lavi: 38, lvmi: 130, rwt: 0.45, gls: 15 })
    expect(values.septalE).toBeUndefined()
    expect(values.lateralE).toBeUndefined()
  })
  test('E / mean e is not arithmetic mean of E/e ratios', () => {
    expect(parseCalculatorEcho("E: 90 cm/s Septal e': 6 cm/s Lateral e': 12 cm/s")).toMatchObject({ e: 90, septalE: 6, lateralE: 12, averageEe: 10 })
    expect(parseCalculatorEcho("E/e' Sep: 18").averageEe).toBeUndefined()
  })
  test('lengths in cm normalize and derive wall thickness and RWT', () => {
    expect(parseCalculatorEcho('IVSd: 1.2 cm LVPWd: 1 cm LVIDd: 5 cm')).toMatchObject({ wall: 12, rwt: 0.4 })
  })
  test('ranges and inequalities are not point measurements', () => {
    expect(parseCalculatorEcho('LAVI: 30-40 TR Vel: >300 cm/s PASP: 35–45 mmHg')).toEqual({})
  })
  test('newer sparse reports cannot borrow older fields', () => {
    const result = buildEchoAutofill([report('PASP: 50 mmHg LAVI: 40'), report('PASP: 30 mmHg', '2026-02-01', 'new')])
    expect(result.pasp).toMatchObject({ value: 30, obsId: 'new', resourceType: 'DiagnosticReport' })
    expect(result.lavi).toBeUndefined()
  })
  test('report provenance and unit-normalized biomarker inputs', () => {
    const af = buildAutofill([{ code: { text: 'NT-proBNP' }, valueQuantity: { value: 300, unit: 'ng/L' } }], {}, [report('PASP: 42 mmHg')])
    expect(af.resolve({ kind: 'echo', key: 'pasp' })).toMatchObject({ value: 42, facility: 'Synthetic hospital' })
    expect(af.resolve({ kind: 'natriuretic', assay: 'NT-PROBNP' })).toMatchObject({ value: 300, unit: 'pg/mL' })
    expect(af.resolve({ kind: 'natriuretic', assay: 'BNP' })).toBeUndefined()
  })
})

describe('HFpEF reference-site and integration regressions', () => {
  test.each([['no', '5 / 9'], ['yes', '8 / 9']])('H2FPEF weighted score: AF %s', (af, expected) => {
    const result = h2({ age: '65', bmi: '32', ee: '12', pasp: '40', af, antihypertensives: 'no' })!
    expect(result.value).toBe(expected)
    expect(result.extra).toHaveLength(6)
    expect(JSON.stringify(result)).not.toMatch(/MDCalc|continuous|連續|%/)
  })
  test('Appcardio 3 and 6 point cases verified in browser', () => {
    expect(hfa({ ...low, e: '90', lavi: '34', ntprobnp: '220' })?.value).toBe('3 / 6')
    expect(hfa({ ...low, e: '160', lavi: '45', ntprobnp: '800' })?.value).toBe('6 / 6')
  })
  test('linked structured observations and panel components preserve report provenance', () => {
    const linked = { ...report(''), result: [{ reference: 'Observation/measurements' }] }
    const result = buildEchoAutofill([linked], [{ id: 'measurements', component: [
      { code: { text: 'LAVI' }, valueQuantity: { value: 36, unit: 'mL/m²' } },
      { code: { text: 'TR Vmax' }, valueQuantity: { value: 300, unit: 'cm/s' } },
    ] }])
    expect(result.lavi).toMatchObject({ value: 36, obsId: 'echo', resourceType: 'DiagnosticReport' })
    expect(result.trv?.value).toBe(3)
  })
  test('text attachments decoded without external requests', () => {
    const r = { ...report(''), presentedForm: [{ contentType: 'text/plain', data: btoa('LAVI: 36 mL/m2') }] }
    expect(buildEchoAutofill([r]).lavi?.value).toBe(36)
  })
  test('invalid, cancelled, non-echo reports and missing dates are excluded', () => {
    expect(buildEchoAutofill([{ ...report('LAVI: 36'), status: 'entered-in-error' }])).toEqual({})
    expect(buildEchoAutofill([{ ...report('LAVI: 36'), code: { text: 'Chest X-ray' } }])).toEqual({})
    expect(buildEchoAutofill([{ ...report('LAVI: 36'), effectiveDateTime: '' }])).toEqual({})
  })
  test('table layout with reference ranges before units', () => {
    expect(parseCalculatorEcho('IVSd 1.1 (0.6~1.2)cm LVPWd 0.87 (0.5~1.1)cm LVIDd 4.3 (3.6~5.2)cm')).toMatchObject({ wall: 11, rwt: 0.405 }) // 17.4 / 43 rounded
  })
  test('BMI only derives from same-day measurements and converts units', () => {
    const measurements = [{ code: { text: 'Body weight' }, effectiveDateTime: '2026-01-01', valueQuantity: { value: 80, unit: 'kg' } }, { code: { text: 'Body height' }, effectiveDateTime: '2026-01-01', valueQuantity: { value: 2, unit: 'm' } }]
    expect(buildAutofill(measurements, {}).resolve({ kind: 'bmi' })?.value).toBe(20)
    measurements[1].effectiveDateTime = '2026-02-01'
    expect(buildAutofill(measurements, {}).resolve({ kind: 'bmi' })).toBeUndefined()
  })
  test('unrecognized natriuretic unit is never silently scored', () => {
    expect(buildAutofill([{ code: { text: 'BNP' }, valueQuantity: { value: 80, unit: 'pmol/L' } }], {}).resolve({ kind: 'natriuretic', assay: 'BNP' })).toBeUndefined()
  })
})

test('autofill does not round a threshold crossing away', () => {
  const input = HFPEF[1].inputs.find(i => i.key === 'rwt')!
  const filled = resolveInput(input, buildAutofill([], {}, [report('RWT: 0.424')]))
  expect(filled.value).toBe('0.424')
  expect(hfa({ ...low, rwt: filled.value })?.value).toBe('1 / 6')
})

test('equivalent BMI unit spelling does not produce a conversion warning', () => {
  const af = buildAutofill([{ code: { coding: [{ code: '39156-5' }] }, valueQuantity: { value: 30.004, unit: 'kg/m2' } }], {})
  expect(resolveInput(HFPEF[0].inputs.find(i => i.key === 'bmi')!, af)).toMatchObject({ value: '30.004', unconvertible: false, displayUnit: 'kg/m²' })
})

test('NTUH format: TR gradient is not PASP; medial E/e is not an average', () => {
  const values = parseCalculatorEcho("IVSd: 0.80 cm LVIDd: 5.1 cm LVPWd: 0.88 cm LV mass(C)dI: 93.1 grams/m2 RWT_: 0.34 Med Peak E’ Vel: 4.8 cm/sec MV E max vel: 75.9 cm/sec TR max vel: 229.4 cm/sec TR max PG: 21.4 mmHg E/E’: 15.7")
  expect(values.pasp).toBeUndefined()
  expect(values.averageEe).toBeUndefined()
  expect(values).toMatchObject({ septalE: 4.8, e: 75.9, lvmi: 93.1, rwt: 0.34, trv: 2.294, ee: 15.7 })
})

 test('H2FPEF partial subtotal preserves missing weights and never invents probability', () => {
   const v = { age: '65', bmi: '32', ee: '12', pasp: '40', af: 'yes', antihypertensives: 'yes' }
   for (const [key, weight] of Object.entries({ age: 1, bmi: 2, ee: 1, pasp: 1, af: 3, antihypertensives: 1 })) {
     const result = h2({ ...v, [key]: '' })!
     expect(result.value).toBe(`${9 - weight} / 9`)
     expect(result.extra?.[0].value).toBe(`${9 - weight}–9 / 9`)
     expect(JSON.stringify(result)).not.toMatch(/MDCalc|continuous|連續|%/)
   }
   expect(h2({})).toBeNull()
   expect(h2({ age: '65' })?.extra?.[0].value).toBe('1–9 / 9')
 })
