import { humanDoseAmount, displayDosageInstruction } from '@/features/clinical-summary/medications/utils/dose-helpers'

it.each(['1/2 tab QD', '½ tab QD', '1 1/2 tab BID'])('does not misread a fractional source instruction as its denominator: %s', text => {
  expect(humanDoseAmount(undefined, text)).toBe('')
  expect(displayDosageInstruction({ text })).toBe(text)
})

it('retains a source-provided structured fractional dose', () => {
  expect(humanDoseAmount([{ doseQuantity: { value: 0.5, unit: 'TAB' } }], '1/2 TAB PO QD')).toBe('0.5 tab')
})
