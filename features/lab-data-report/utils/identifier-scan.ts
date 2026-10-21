// Patterns that must never leave the browser in a lab-data report. The
// `submitLabDataReport` Function runs the same list again (its copy lives in
// firebase-smart-on-fhir functions/src/services/lab-data-report/
// identifier-scan.ts) — keep the two in step; both test suites share the same
// vectors.
//
// Row text (names, units, reference ranges, short result strings) comes from
// the source and cannot be edited by the reporter: a match there drops that
// one string. The reporter's own description can be edited, so a match there
// blocks sending and says why. Both get the same patterns.

export type IdentifierKind =
  | 'national-id'
  | 'masked-id'
  | 'email'
  | 'phone'
  | 'full-date'
  | 'long-number'

// Text is NFKC-normalised first, so full-width letters and digits
// (Ａ１２３…) are caught by the same ASCII patterns.
//
// There is no exception for the 10-digit 醫事機構代碼 in source strings: a
// digit run cannot be told apart from a chart or mobile number (0936050029 is
// a real institution code and a valid mobile number). The one field known to
// carry the code, performer, has it removed before the scan
// (build-lab-data-report stripInstitutionCodes).
const MONTH = '(?:0?[1-9]|1[0-2])'
const DAY = '(?:0?[1-9]|[12]\\d|3[01])'

const ROW_PATTERNS: ReadonlyArray<readonly [IdentifierKind, RegExp]> = [
  // 身分證／新式居留證: letter + 1/2/8/9 + 8 digits.
  ['national-id', /(?:^|[^A-Za-z0-9])[A-Za-z][1289]\d{8}(?!\d)/],
  // 舊式居留證: two letters + 8 digits.
  ['national-id', /(?:^|[^A-Za-z0-9])[A-Za-z][A-Da-d]\d{8}(?!\d)/],
  // Masked forms the bridges print, e.g. F203XXX511, A10040XXXX, A123****89.
  ['masked-id', /(?:^|[^A-Za-z0-9])[A-Za-z]\d{2,6}[Xx*]{3,6}\d{0,4}(?!\d)/],
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  // Taiwan mobile: 0912-345-678, 0912345678, +886 912 345 678.
  ['phone', /(?:^|\D)(?:\+?886[-\s]?9\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})(?!\d)/],
  // Western: 2026-07-04, 2026/7/4, 2026.07.04, 2026年7月4日 (also ISO timestamps).
  ['full-date', new RegExp(`(?:^|\\D)(?:19|20)\\d{2}\\s*[-/.年]\\s*${MONTH}\\s*[-/.月]\\s*${DAY}(?!\\d)`)],
  // ROC, any year 民國 0–119, zero-padded or not — a birth date is usually
  // well before 80: 65/03/12, 079-3-12, 65年3月12日. Month and day must be
  // valid, so a titre such as "1/80/160" is not a date.
  ['full-date', new RegExp(`(?:^|\\D)(?:0?\\d{1,2}|1[01]\\d)\\s*[-/年]\\s*${MONTH}\\s*[-/月]\\s*${DAY}(?!\\d)`)],
  // ROC with dots only in the two-digit form (65.03.12, 079.03.12), so a
  // version ("0.12.13") or a decimal range is not a date.
  ['full-date', /(?:^|[^\d.])(?:0?\d{2}|1[01]\d)\.(?:0[1-9]|1[0-2])\.(?:0[1-9]|[12]\d|3[01])(?![\d.])/],
  // Any 7+ digit run: a chart number, an ID without its letter, a bare phone.
  ['long-number', /\d{7,}/],
]

function normalizeForScan(text: string): string {
  return text.normalize('NFKC')
}

export function findRowIdentifier(text: string | undefined | null): IdentifierKind | null {
  if (!text) return null
  const normalized = normalizeForScan(String(text))
  for (const [kind, pattern] of ROW_PATTERNS) if (pattern.test(normalized)) return kind
  return null
}

export function findDescriptionIdentifiers(text: string | undefined | null): IdentifierKind[] {
  if (!text) return []
  const normalized = normalizeForScan(String(text))
  const kinds = new Set<IdentifierKind>()
  for (const [kind, pattern] of ROW_PATTERNS) if (pattern.test(normalized)) kinds.add(kind)
  return [...kinds]
}

// A source result string travels only when it is a short result, not prose.
// A CJK character weighs 3: 40 Latin characters is "Klebsiella pneumoniae
// ssp.", 13 Chinese characters is already a clause. Sentence punctuation marks
// narrative whatever the length.
export const MAX_RESULT_TEXT_WEIGHT = 40

export function isShortResultText(text: string): boolean {
  const normalized = text.normalize('NFKC').trim()
  if (/[，。；！？]/.test(text) || /[.!?]\s+\S/.test(normalized)) return false
  let weight = 0
  for (const char of normalized) {
    weight += /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(char) ? 3 : 1
    if (weight > MAX_RESULT_TEXT_WEIGHT) return false
  }
  return true
}
