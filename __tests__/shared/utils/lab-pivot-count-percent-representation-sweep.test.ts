// A differential result's column (count → ANC / ALC …, percentage → NEU /
// LYM …) must not depend on how the value was written: a Quantity, a Range,
// or a number printed as text — signed, grouped ("3,100"), with an exponent
// ("3.1e3"), full-width, after a comparator — followed by its unit. The unit
// family is read by one grammar shared with the AI's labValueFamily. Both
// name modes keep the same split.
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { labValueFamily } from '@/src/infrastructure/ai/tools/fhir-tools'

const UCUM = 'http://unitsofmeasure.org'

// [unit text as printed, UCUM code when it has a valid one]
const COUNT_UNITS: Array<[string, string | undefined]> = [
  ['/uL', '/uL'], ['/µL', undefined], ['/μL', undefined], ['10^3/uL', undefined], ['x10^3/uL', undefined],
  ['10*3/uL', '10*3/uL'], ['K/uL', undefined], ['1000/uL', undefined], ['x10^9/L', undefined],
  ['10^9/L', undefined], ['10*9/L', '10*9/L'], ['/mm3', '/mm3'], ['/cumm', undefined], ['cells/uL', undefined],
  ['10³/µL', undefined], ['{cells}/uL', '{cells}/uL'],
]
const PERCENT_UNITS: Array<[string, string | undefined]> = [
  ['%', '%'], ['％', undefined], ['percent', undefined], ['Percent', undefined], ['per cent', undefined],
  ['pct', undefined], ['百分比', undefined],
]
// [as printed, numeric value]
const NUMBERS: Array<[string, number]> = [
  ['3100', 3100], ['3,100', 3100], ['3.1e3', 3100], ['3.1E3', 3100], ['3.2', 3.2], ['.5', 0.5],
  ['1,234.5', 1234.5], ['３１００', 3100], ['+3100', 3100],
]
const COMPARATORS = ['', '<', '< ', '>=', '≤']
const SEPARATORS = [' ', '']
const FLAGS = ['', ' (H)', ' H']

const NAMES: Array<[string, string, string]> = [
  // [source name, count key, percent key]
  ['嗜中性白血球 / Neutrophil', 'ANC', 'NEU'],
  ['Lymphocyte', 'ALC', 'LYM'],
  ['Eosinophil', 'AEC', 'EOS'],
  ['ANC', 'ANC', 'NEU'],
]

let seq = 0
function base(text: string) {
  seq += 1
  return {
    resourceType: 'Observation', id: `rep-${seq}`, status: 'final',
    category: [{ coding: [{ code: 'laboratory' }] }],
    code: { text, coding: [{ system: 'https://twcore.mohw.gov.tw/CodeSystem/nhi-medical-order-code', code: '08013C' }] },
    effectiveDateTime: '2026-01-01T08:00:00+08:00',
  }
}

function representations(text: string, unit: string, code: string | undefined, printed: string, value: number) {
  const out: Array<[string, any]> = []
  const quantity = (q: Record<string, unknown>) => ({ value, unit, ...q })
  out.push(['Quantity unit', { ...base(text), valueQuantity: quantity({}) }])
  if (code) out.push(['Quantity UCUM', { ...base(text), valueQuantity: quantity({ code, system: UCUM }) }])
  out.push(['Range', { ...base(text), valueRange: { low: { value, unit }, high: { value: value + 1, unit } } }])
  out.push(['Range low only', { ...base(text), valueRange: { low: { value, unit } } }])
  for (const comparator of COMPARATORS) {
    // A unit that starts with a digit ("10^3/uL") needs a space after the number.
    for (const separator of /^\d/.test(unit.normalize('NFKC')) ? [' '] : SEPARATORS) {
      for (const flag of FLAGS) {
        out.push([`text "${comparator}${printed}${separator}${unit}${flag}"`, { ...base(text), valueString: `${comparator}${printed}${separator}${unit}${flag}` }])
      }
    }
  }
  return out
}

describe('count / percentage identity is invariant across value representations', () => {
  it.each(NAMES)('%s', (text, countKey, percentKey) => {
    const failures: string[] = []
    const check = (units: Array<[string, string | undefined]>, expected: string, family: string) => {
      for (const [unit, code] of units) {
        for (const [printed, value] of NUMBERS) {
          for (const [shape, observation] of representations(text, unit, code, printed, value)) {
            const category = categorizeObservation(observation)?.id
            const standardized = getLabPivotTestIdentity(observation, category ?? 'cbc', 'standardized').testKey
            const original = getLabPivotTestIdentity(observation, category ?? 'cbc', 'original').mapKey
            if (standardized !== expected) failures.push(`${unit} ${shape}: ${standardized} ≠ ${expected}`)
            if (!original.endsWith(`|${expected}`)) failures.push(`${unit} ${shape} (original): ${original}`)
            // One grammar: the AI's value family agrees with the pivot's split.
            const aiFamily = labValueFamily(observation)
            if (aiFamily !== family) failures.push(`${unit} ${shape}: labValueFamily ${aiFamily} ≠ ${family}`)
          }
        }
      }
    }
    check(COUNT_UNITS, countKey, 'quantity')
    check(PERCENT_UNITS, percentKey, 'percent')
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('undecided representations keep the name key (no unit, conflicting Range bounds, Integer / Decimal)', () => {
    const neutrophil = (extra: Record<string, unknown>) => ({ ...base('Neutrophil'), ...extra })
    const key = (o: any) => getLabPivotTestIdentity(o, 'cbc').testKey
    expect(key(neutrophil({ valueRange: { low: { value: 1, unit: '%' }, high: { value: 3000, unit: '/uL' } } }))).toBe('NEU')
    // A bare number with no unit: above 100 cannot be a percentage (count).
    expect(key(neutrophil({ valueInteger: 3100 }))).toBe('ANC')
    expect(key(neutrophil({ valueDecimal: 3.1 }))).toBe('NEU')
    expect(key(neutrophil({ valueString: '3100' }))).toBe('ANC')
    expect(key(neutrophil({ valueString: 'see smear' }))).toBe('NEU')
    expect(key(neutrophil({ valueRange: { low: { value: 1 }, high: { value: 3 } } }))).toBe('NEU')
    // A Range with one bound's unit decides by that bound.
    expect(key(neutrophil({ valueRange: { low: { value: 3000, unit: '/uL' }, high: { value: 4000 } } }))).toBe('ANC')
    // A UCUM code decides over the unit text, on a Range bound too.
    expect(key(neutrophil({ valueRange: { low: { value: 60, unit: 'pct', code: '%', system: UCUM } } }))).toBe('NEU')
    expect(key(neutrophil({ valueRange: { low: { value: 3, unit: '%', code: '10*3/uL', system: UCUM } } }))).toBe('ANC')
  })
})
