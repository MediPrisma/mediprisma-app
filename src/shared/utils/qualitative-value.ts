// One vocabulary for ordinal (qualitative) lab results, so the same result
// spelled differently — "Negative", "NEG", "neg.", 「陰性」, "(-)", full-width
// "ＮＥＧ" — is recognised as the same kind of value everywhere it is read.

/** Canonical ordinal value → every spelling hospitals print for it. Spellings
 *  are matched after NFKC, upper-casing and removing whitespace. */
export const ORDINAL_VALUE_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  NEGATIVE: ['NEGATIVE', 'NEG', 'NEGA', '(-)', '-', '陰性', '陰', 'NEGATIVE(-)'],
  POSITIVE: ['POSITIVE', 'POS', 'POSI', '(+)', '+', '陽性', '陽'],
  WEAKLY_POSITIVE: ['WEAKLYPOSITIVE', 'WEAKPOSITIVE', 'WEAKLYPOS', 'WEAKPOS', 'WPOS', 'W+', 'WEAKLYREACTIVE', 'WEAKREACTIVE', '弱陽性', '弱陽'],
  STRONGLY_POSITIVE: ['STRONGLYPOSITIVE', 'STRONGPOSITIVE', '強陽性'],
  NONREACTIVE: ['NONREACTIVE', 'NON-REACTIVE', 'NONREACT', 'NON-REACT', 'NR', 'N.R.', '無反應'],
  REACTIVE: ['REACTIVE', 'REACT', 'R', '有反應'],
  BORDERLINE: ['BORDERLINE', 'BL', 'EQUIVOCAL', 'EQUIV', 'EQV', 'INDETERMINATE', 'INDET', 'GRAYZONE', 'GREYZONE', '(±)', '±', '+/-', '可疑', '臨界'],
  TRACE: ['TRACE', 'TR', '微量'],
  DETECTED: ['DETECTED', 'DETECTABLE', 'PRESENT', '檢出', '有檢出'],
  NOT_DETECTED: ['NOTDETECTED', 'NOT-DETECTED', 'UNDETECTED', 'NONDETECTED', 'UNDETECTABLE', 'ND', 'N.D.', 'ABSENT', '未檢出', '未檢測到'],
  // Grades are written postfix ("3+") or as repeated signs ("+++"); a leading
  // sign before a digit ("+3", "+3.2") is a signed number, not a grade.
  GRADE_1: ['1+'],
  GRADE_2: ['2+', '++'],
  GRADE_3: ['3+', '+++'],
  GRADE_4: ['4+', '++++'],
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Each spelling as a pattern anchored at the start that tolerates one space
 *  between any two of its characters ("NOTDETECTED" reads "Not detected",
 *  "NONREACTIVE" reads "Non reactive"). Longest spelling first: "NONREACTIVE"
 *  before "NR" before "R", "+++" before "+". */
const SPELLING_PATTERNS: ReadonlyArray<{ spelling: string; canonical: string; pattern: RegExp }> =
  Object.entries(ORDINAL_VALUE_SPELLINGS)
    .flatMap(([canonical, spellings]) => spellings.map((spelling) => ({
      spelling,
      canonical,
      pattern: new RegExp(`^${[...spelling].map(escapeRegExp).join(' ?')}`),
    })))
    .sort((a, b) => b.spelling.length - a.spelling.length)

const isLatinLetter = (ch: string | undefined) => !!ch && /[A-Z]/.test(ch)

/**
 * The canonical ordinal value a result starts with, or null. Trailing detail
 * is allowed — "Negative for HBsAg", "Not detected by PCR", "Positive (1:80)",
 * 「陰性(-)」, "NEG 0.2 S/CO" — but a spelling must end where a word ends ("R"
 * is not the start of "RBC", "POS" not of "POSSIBLE"), and a bare sign or
 * grade must not be part of a number ("-5", "+0.3", "+1.25").
 */
export function ordinalValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!text) return null
  for (const { spelling, canonical, pattern } of SPELLING_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const next = text[match[0].length]
    if (isLatinLetter(spelling.slice(-1)) && isLatinLetter(next)) continue
    if (/^[-+]+$/.test(spelling) && next !== undefined && /[\d.]/.test(next)) continue
    if (/\d$/.test(spelling) && next !== undefined && /[\d.]/.test(next)) continue
    return canonical
  }
  return null
}

export function isOrdinalValue(value: unknown): boolean {
  return ordinalValue(value) !== null
}
