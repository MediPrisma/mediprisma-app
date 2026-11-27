import { duBoisBsa, indexToBsa } from '@/features/medical-calculator/echo-derived'

// Hand calculation: 0.007184 × 70^0.425 × 170^0.725
const bsa170x70 = 0.007184 * 70 ** 0.425 * 170 ** 0.725

describe('Du Bois BSA', () => {
  test('170 cm / 70 kg', () => {
    expect(duBoisBsa(170, 70)).toBeCloseTo(1.8097, 4)
    expect(duBoisBsa(170, 70)).toBe(bsa170x70)
  })
  test('158 cm / 52 kg', () => {
    expect(duBoisBsa(158, 52)).toBeCloseTo(0.007184 * 52 ** 0.425 * 158 ** 0.725, 10)
  })
  test.each([
    [undefined, 70], [170, undefined], [0, 70], [170, 0], [-170, 70], [170, -70], [NaN, 70], [170, Infinity],
  ])('height %p, weight %p → undefined', (height, weight) => {
    expect(duBoisBsa(height, weight)).toBeUndefined()
  })
})

describe('indexing to BSA', () => {
  test('divides without rounding', () => {
    expect(indexToBsa(62, bsa170x70)).toBe(62 / bsa170x70)
    // 61.6 / 1.8097 = 34.04: must stay above 34, not round to it.
    expect(indexToBsa(61.6, bsa170x70)! > 34).toBe(true)
  })
  test.each([
    [undefined, 1.8], [62, undefined], [0, 1.8], [-1, 1.8], [62, 0], [NaN, 1.8],
  ])('raw %p, BSA %p → undefined', (raw, bsa) => {
    expect(indexToBsa(raw, bsa)).toBeUndefined()
  })
})
