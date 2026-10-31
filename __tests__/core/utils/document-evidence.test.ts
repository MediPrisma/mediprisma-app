import { verifyDocumentQuote } from '@/src/core/utils/document-evidence.utils'

test('restores whitespace from one contiguous source span without rewriting clinical content', () => {
  const raw = 'Report:\nNo pneumonia.\n\nFollow up in 7 days.'
  expect(verifyDocumentQuote('No pneumonia. Follow up in 7 days.', raw)).toEqual({
    quote: 'No pneumonia.\n\nFollow up in 7 days.', verification: 'whitespace-restored',
  })
  expect(verifyDocumentQuote('No pneumonia.', raw).verification).toBe('exact')
})

test.each([
  ['Pneumonia present.', 'No pneumonia present.'],
  ['Potassium 6.0 mmol/L', 'Potassium 4.0 mmol/L'],
  ['Dose 5 mg', 'Dose 5 Mg'],
  ['first finding last finding', 'first finding; intervening negative statement; last finding'],
])('never repairs changed clinical facts or non-contiguous passages', (quote, raw) => {
  expect(verifyDocumentQuote(quote, raw)).toEqual({ quote, verification: 'not-found' })
})

test('missing source remains unverified', () => {
  expect(verifyDocumentQuote('A clinical excerpt')).toEqual({ quote: 'A clinical excerpt', verification: 'unavailable' })
})

test('exact excerpt status is not a semantic entailment or negation check', () => {
  // A deliberately misleading substring still exists verbatim. The UI must
  // never describe this check as validating the clinical assertion.
  expect(verifyDocumentQuote('pneumonia present.', 'No pneumonia present.').verification).toBe('exact')
})

test('a line break before a full stop is whitespace, not a different sentence', () => {
  const raw = 'Impression:\nSubchondral sclerosis at right SI joint\n.\nNo fracture.'
  expect(verifyDocumentQuote('Subchondral sclerosis at right SI joint.', raw)).toEqual({
    quote: 'Subchondral sclerosis at right SI joint\n.', verification: 'whitespace-restored',
  })
  // Words, numbers and negation still have to match exactly.
  expect(verifyDocumentQuote('Subchondral sclerosis at left SI joint.', raw).verification).toBe('not-found')
})

test('a full-width character quoted half-width is the same passage, shown as the source wrote it', () => {
  const raw = 'Follow　thyroid function showed hypothyroid, adjust Thyroxine dose 1-＞ 2PC QD.'
  expect(verifyDocumentQuote('Follow thyroid function showed hypothyroid, adjust Thyroxine dose 1-> 2PC QD.', raw)).toEqual({
    quote: raw, verification: 'whitespace-restored',
  })
  // Width is the only allowance: a changed dose or word is still not found.
  expect(verifyDocumentQuote('adjust Thyroxine dose 1-> 3PC QD.', raw).verification).toBe('not-found')
  expect(verifyDocumentQuote('ADJUST Thyroxine dose 1-> 2PC QD.', raw).verification).toBe('not-found')
})
