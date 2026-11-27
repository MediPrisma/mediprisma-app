// TSAT from the record: Taiwanese labs report serum iron and TIBC, seldom a TSAT.
import { computeAutofilledResult, resolveInput } from '@/features/medical-calculator/autofill-compute'
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

it('has no result while the record holds no binding capacity', () => {
  expect(computeAutofilledResult(tsat, autofill([named('Fe', 45, 'ug/dL')]))).toBeNull()
})

it('is listed on the heart-failure page at DP-12, linked wherever a line names TSAT', () => {
  const entry = HF_VISIT_CALCULATORS.find((e) => e.id === 'tsat')!
  expect(entry).toMatchObject({ dp: 'DP-12', calculatorId: 'tsat', note: true })
  expect(entry.source).toBeUndefined()
  expect('缺鐵（ferritin 80・TSAT 15%）：IV 鐵劑？').toMatch(entry.names)
})
