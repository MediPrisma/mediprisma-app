import { icdChronicity } from '@/src/shared/utils/icd-chronicity'
import { CCIR_PREFIXES, CCIR_VERSION } from '@/src/shared/constants/ccir-chronicity.generated'

describe('icdChronicity (AHRQ HCUP CCIR)', () => {
  it('classifies the CCIR guide examples: diabetes, hypertension, cancer chronic; infections not chronic', () => {
    expect(icdChronicity('E11.9')).toBe('chronic')
    expect(icdChronicity('I10')).toBe('chronic')
    expect(icdChronicity('C50.911')).toBe('chronic')
    expect(icdChronicity('J06.9')).toBe('nonChronic')
    expect(icdChronicity('J18.9')).toBe('nonChronic')
  })

  it('accepts dotted, dot-free and lower-case codes alike', () => {
    expect(icdChronicity('N18.32')).toBe('chronic')
    expect(icdChronicity('N1832')).toBe('chronic')
    expect(icdChronicity('n18.32')).toBe('chronic')
  })

  it('gives Z and V–Y codes no determination', () => {
    expect(icdChronicity('Z79.4')).toBe('undetermined')
    expect(icdChronicity('V00.01XA')).toBe('undetermined')
  })

  it('does not guess for a code CCIR cannot place', () => {
    expect(icdChronicity('')).toBe('undetermined')
    expect(icdChronicity('門診追蹤')).toBe('undetermined')
  })

  // CCIR v2026.1 codes that are listed themselves but have children of another
  // value. They once fell through the prefix table (Q21.1 showed under 全部 but
  // vanished under 慢性); scripts/build-ccir-table.mjs now re-checks all 75,725.
  it.each([
    ['D59.3', 'nonChronic'], ['D72.1', 'chronic'], ['D84.8', 'chronic'], ['F43.8', 'nonChronic'],
    ['F50.8', 'nonChronic'], ['I31.3', 'nonChronic'], ['J82', 'nonChronic'], ['J84.17', 'chronic'],
    ['K86.8', 'nonChronic'], ['N42.3', 'nonChronic'], ['N61', 'nonChronic'], ['P04.1', 'nonChronic'],
    ['P04.8', 'nonChronic'], ['P29.3', 'nonChronic'], ['Q21.1', 'chronic'], ['Z28.3', 'undetermined'],
  ] as const)('keeps the explicit class of listed parent code %s', (code, expected) => {
    expect(icdChronicity(code)).toBe(expected)
  })

  it('ships a generated table whose prefixes never overlap', () => {
    expect(CCIR_VERSION).toMatch(/^v\d{4}\.\d+$/)
    const all = Object.values(CCIR_PREFIXES).flatMap((list) => list.split(','))
    expect(new Set(all).size).toBe(all.length)
    // Exact entries ("Q211$") may sit under a prefix; prefixes may not nest, so a
    // longest-prefix lookup hits exactly one of them.
    const prefixes = new Set(all.filter((entry) => !entry.endsWith('$')))
    for (const prefix of prefixes) {
      for (let i = 1; i < prefix.length; i++) expect(prefixes.has(prefix.slice(0, i))).toBe(false)
    }
  })
})
