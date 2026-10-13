import { isPercentQuantity } from '@/src/shared/utils/lab-value-grammar'

describe('isPercentQuantity: the UCUM code decides only under the UCUM system', () => {
  it.each([
    'http://unitsofmeasure.org',
    'https://unitsofmeasure.org',
    'http://unitsofmeasure.org/',
    ' HTTP://UnitsOfMeasure.org ',
  ])('trusts the code under %j', (system) => {
    expect(isPercentQuantity({ value: 60, unit: '10*3/uL', system, code: '%' })).toBe(true)
    expect(isPercentQuantity({ value: 6, unit: '%', system, code: '10*3/uL' })).toBe(false)
  })

  it('trusts the code when no system is given', () => {
    expect(isPercentQuantity({ value: 60, unit: 'x', code: '%' })).toBe(true)
  })

  it.each([
    'http://example.org/unitsofmeasure.org',
    'http://unitsofmeasure.org.example.org',
    'urn:local:unitsofmeasure.org',
  ])('falls back to the unit text when the system only contains the UCUM host: %j', (system) => {
    expect(isPercentQuantity({ value: 60, unit: '10*3/uL', system, code: '%' })).toBe(false)
    expect(isPercentQuantity({ value: 60, unit: '%', system, code: '10*3/uL' })).toBe(true)
  })
})
