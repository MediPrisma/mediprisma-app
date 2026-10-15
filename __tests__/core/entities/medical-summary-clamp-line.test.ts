import { clampLine } from '@/src/core/entities/medical-summary.entity'

describe('clampLine', () => {
  it('leaves a line within the limit untouched', () => {
    expect(clampLine('94M with CKD 3b and IHD.', 240)).toBe('94M with CKD 3b and IHD.')
  })

  it('ends an over-long line at its last clause, never mid-word', () => {
    const line = 'F310 history, subnormal testosterone, BP 150/100 mmHg, on SEROQUEL TABLETS 25MG, Lendormin 0.25mg, KARY UNI'
    const clamped = clampLine(line, 100)
    expect(clamped).toBe('F310 history, subnormal testosterone, BP 150/100 mmHg, on SEROQUEL TABLETS 25MG, Lendormin 0.25mg…')
    expect(clamped.length).toBeLessThanOrEqual(101)
  })

  it('falls back to the last word when no clause ends late enough', () => {
    expect(clampLine('alpha beta gamma delta epsilon', 20)).toBe('alpha beta gamma…')
  })
})
