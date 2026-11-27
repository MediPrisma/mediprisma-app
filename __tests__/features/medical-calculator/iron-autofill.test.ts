// TSAT from the record: Taiwanese labs report serum iron and TIBC, seldom a TSAT.
import { calcReadiness, computeAutofilledResult, resolveInput } from '@/features/medical-calculator/autofill-compute'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { buildAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { convertToBase } from '@/features/medical-calculator/units'
import { HF_VISIT_CALCULATORS } from '@/features/clinical-decision-support/renderers/visit/VisitCalculators'

const tsat = CALCULATORS.find((c) => c.id === 'tsat')!
const named = (text: string, value: number, unit: string, date = '2026-11-01') =>
  ({ id: `o-${text}-${value}`, status: 'final', effectiveDateTime: date, code: { text }, valueQuantity: { value, unit } })
const autofill = (observations: object[]) =>
  buildAutofill(observations as never, { age: 70, gender: 'female' }, [], [], new Date('2026-11-27'), [], [])

it('computes TSAT from the record’s serum iron and TIBC', () => {
  const data = autofill([named('Fe', 45, 'ug/dL'), named('TIBC', 300, 'ug/dL'), named('Ferritin', 80, 'ng/mL')])
  const computed = computeAutofilledResult(tsat, data)
  expect(computed!.result.value).toBe('15')
  expect(computed!.result.extra!.map((row) => row.value)).toEqual(['✓ ferritin 80'])
})

it('converts µmol/L to µg/dL, and refuses a value in another unit matched by name', () => {
  expect(convertToBase(10, 'µmol/L', 'iron')!.value).toBeCloseTo(55.85, 2)
  expect(convertToBase(60, 'mcg/dL', 'iron')!.changed).toBe(false)
  const si = autofill([named('Iron', 10, 'umol/L'), named('TIBC', 60, 'umol/L')])
  expect(computeAutofilledResult(tsat, si)!.result.value).toBe('16.7')
  const wrong = autofill([named('Iron', 45, 'mg')])
  expect(resolveInput(tsat.inputs.find((input) => input.key === 'iron')!, wrong).filled).toBe(false)
})

const coded = (loinc: string, value: number, unit: string, date = '2026-11-01') =>
  ({ id: `o-${loinc}`, status: 'final', effectiveDateTime: date, code: { coding: [{ system: 'http://loinc.org', code: loinc }] }, valueQuantity: { value, unit } })

// Auto-review round 1: a lab that reports UIBC in TIBC's place is computed in the lists too.
it('builds TIBC from the same day’s serum iron and UIBC, and prefers a reported TIBC', () => {
  const data = autofill([named('Fe', 50, 'ug/dL'), coded('2501-5', 200, 'ug/dL')])
  expect(resolveInput(tsat.inputs.find((input) => input.key === 'tibc')!, data)).toMatchObject({ value: '250', filled: true, source: { testName: 'TIBC（同日 Fe＋UIBC）' } })
  expect(computeAutofilledResult(tsat, data)!.result.value).toBe('20')
  expect(calcReadiness(tsat, data)).toMatchObject({ ready: true, computable: true })
  const both = autofill([named('Fe', 50, 'ug/dL'), coded('2501-5', 200, 'ug/dL'), named('TIBC', 500, 'ug/dL')])
  expect(computeAutofilledResult(tsat, both)!.result.value).toBe('10')
  const otherDay = autofill([named('Fe', 50, 'ug/dL'), coded('2501-5', 200, 'ug/dL', '2026-10-01')])
  expect(computeAutofilledResult(tsat, otherDay)).toBeNull()
})

it('takes the red cell count in its equivalent units for the Mentzer index', () => {
  const mentzer = CALCULATORS.find((c) => c.id === 'mentzer-index')!
  for (const unit of ['10^12/L', 'M/µL', '10^6/uL', '10⁶/µL']) {
    const data = autofill([named('MCV', 65, 'fL'), named('RBC', 5.9, unit)])
    expect(computeAutofilledResult(mentzer, data)!.result.value).toBe('11')
  }
})

it('has no result while the record holds no binding capacity', () => {
  expect(computeAutofilledResult(tsat, autofill([named('Fe', 45, 'ug/dL')]))).toBeNull()
})

it('is listed on the heart-failure page at DP-12, linked wherever a line names TSAT', () => {
  const entry = HF_VISIT_CALCULATORS.find((e) => e.id === 'tsat')!
  expect(entry).toMatchObject({ dp: 'DP-12', calculatorId: 'tsat', note: true })
  expect(entry.source).toBeUndefined()
  expect('缺鐵（ferritin 80・TSAT 15%）：IV 鐵劑？').toMatch(entry.names)
})

// Auto-review round 2: ferritin in µg/L is the same number as ng/mL.
it('takes ferritin in µg/L as in ng/mL', () => {
  for (const unit of ['ng/mL', 'µg/L', 'ug/L']) {
    const computed = computeAutofilledResult(tsat, autofill([named('Fe', 45, 'ug/dL'), named('TIBC', 300, 'ug/dL'), named('Ferritin', 80, unit)]))
    expect(computed!.result.value).toBe('15')
    expect(computed!.result.extra!.map((row) => row.value)).toEqual(['✓ ferritin 80'])
  }
})

// Owner 2026-11-27: 「自動帶入要有 LOINC」. Every filled input is read by its LOINC
// code where the row carries one, under whatever name the lab gives it.
it('fills each iron calculator from LOINC-coded rows', () => {
  const data = autofill([
    coded('2498-4', 45, 'ug/dL'), coded('2500-7', 300, 'ug/dL'), coded('2276-4', 80, 'ng/mL'),
    coded('718-7', 9.2, 'g/dL'), coded('787-2', 65, 'fL'), coded('789-8', 5.9, '10*6/uL'), coded('29463-7', 60, 'kg'),
  ])
  const result = (id: string) => computeAutofilledResult(CALCULATORS.find((c) => c.id === id)!, data)
  expect(result('tsat')!.result.value).toBe('15')
  expect(result('tsat')!.result.extra!.map((row) => row.value)).toEqual(['✓ ferritin 80'])
  expect(result('mentzer-index')!.result.value).toBe('11')
  const ganzoni = CALCULATORS.find((c) => c.id === 'iron-deficit-ganzoni')!
  expect(resolveInput(ganzoni.inputs.find((input) => input.key === 'weight')!, data).value).toBe('60')
  expect(resolveInput(ganzoni.inputs.find((input) => input.key === 'hb')!, data).value).toBe('9.2')
})

it('takes a coded serum iron and TIBC before a row matched by name', () => {
  const data = autofill([named('Fe', 999, 'ug/dL'), named('TIBC', 999, 'ug/dL'), coded('2498-4', 45, 'ug/dL'), coded('2500-7', 300, 'ug/dL')])
  expect(computeAutofilledResult(tsat, data)!.result.value).toBe('15')
})
