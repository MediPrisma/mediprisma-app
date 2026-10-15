import { verifyReportQuote } from '@/src/core/utils/report-quote.utils'

test.each([
  ['RVSP 58mmHg', 'RVSP: 58mmHg'],
  ['RVSP 58 mmHg', 'RVSP:58mmHg'],
  ['RVSP: 58mmHg', 'RVSP 58 mmHg'],
  ['RVSP 58mmHg', 'RVSP ： 58 mmHg'],
  ['RVSP 58mmHg', 'RVSP:\n58 mmHg'],
])('restores report typography for %s from %s', (quote, raw) => {
  expect(verifyReportQuote(quote, 'Echo finding: ' + raw + '. No effusion.')).toBe(raw)
})

test.each([
  ['RVSP 58mmHg', 'RVSP: 580mmHg'],
  ['RVSP 58mmHg', 'RVSP: 5.8mmHg'],
  ['RVSP 58mmHg', 'RVSP: -58mmHg'],
  ['RVSP 58mmHg', 'RVSP: <58mmHg'],
  ['RVSP 58mmHg', 'RVSP: 58cmHg'],
  ['RVSP 58mmHg', 'RVSP: 58MMHG'],
  ['RVSP 58mmHg', 'RVSP: normal. Other value: 58mmHg'],
  ['ratio 12', 'ratio 1:2'],
  ['No pulmonary hypertension RVSP 58mmHg', 'Pulmonary hypertension RVSP: 58mmHg'],
])('does not repair changed content in %s from %s', (quote, raw) => {
  expect(verifyReportQuote(quote, raw)).toBeNull()
})

test('retains strict quote handling and rejects missing reports and short fragments', () => {
  expect(verifyReportQuote('No effusion.', 'No effusion.')).toBe('No effusion.')
  expect(verifyReportQuote('RVSP 58mmHg')).toBeNull()
  expect(verifyReportQuote('A 5mg', 'A: 5 mg')).toBeNull()
})

describe('verifyReportQuote — a finding the report denies', () => {
  it.each([
    ['pleural effusion', 'Heart size normal. No pleural effusion. Lungs clear.'],
    ['pleural effusion', 'CXR: without pleural effusion or pneumothorax.'],
    ['focal liver lesion', 'Liver: negative for focal liver lesion.'],
    ['pleural effusion', 'Pleural effusion: absent.'],
    ['pleural effusion', 'The previous pleural effusion has resolved.'],
    ['pericardial effusion', 'Pericardial effusion is not seen.'],
    ['肝臟腫瘤病灶', '腹部超音波：未見肝臟腫瘤病灶。'],
  ])('rejects %p inside %p', (quote, source) => {
    expect(verifyReportQuote(quote, source)).toBeNull()
  })

  it.each([
    ['No pleural effusion', 'Heart size normal. No pleural effusion. Lungs clear.'],
    ['2.1 cm nodule in RUL', 'No interval change of the 2.1 cm nodule in RUL.'],
    ['Small left pleural effusion', 'No pneumothorax. Small left pleural effusion.'],
    ['a 3 cm mass in the liver', 'No ascites, but a 3 cm mass in the liver is noted.'],
    ['pleural effusion', 'No pneumothorax; pleural effusion, left.'],
  ])('keeps %p inside %p', (quote, source) => {
    expect(verifyReportQuote(quote, source)).not.toBeNull()
  })

  it('accepts a span that also occurs once without the negation', () => {
    expect(verifyReportQuote('pleural effusion', 'No pleural effusion on the right. Left: pleural effusion, small.'))
      .toBe('pleural effusion')
  })
})
