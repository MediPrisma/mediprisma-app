import { verifyDocumentQuote } from './document-evidence.utils'

/** Formatting tolerance for report excerpts only. Keep source offsets so the
 * displayed evidence is always the original, contiguous report wording. */
function normalizeReportExcerpt(text: string) {
  const chars: string[] = [], starts: number[] = [], ends: number[] = []
  const valueColon = (index: number) => /[A-Za-z]\s*$/.test(text.slice(0, index))
    && /^\s*[+\-−]?\d/.test(text.slice(index + 1))
  for (let i = 0; i < text.length;) {
    const start = i
    let char = text[i++]
    if (/\s/.test(char)) {
      while (i < text.length && /\s/.test(text[i])) i++
      // Space before a label/value colon, or between a number and a known
      // unit, is typography. Decimal points, signs and unit case stay intact.
      if (/[:：]/.test(text[i] ?? '') && valueColon(i)) continue
      if (/\d$/.test(text.slice(0, start)) && /^(?:mmHg|mm|cm|mg|g|mL|L|mmol|µg|μg|%)(?![A-Za-z])/.test(text.slice(i))) continue
      char = ' '
    } else if (/[:：]/.test(char) && valueColon(start)) char = ' '
    if (char === ' ' && (chars.length === 0 || chars.at(-1) === ' ')) continue
    chars.push(char); starts.push(start); ends.push(i)
  }
  if (chars.at(-1) === ' ') { chars.pop(); starts.pop(); ends.pop() }
  return { text: chars.join(''), starts, ends }
}

// A finding the report denies. Checked only within the clause around the
// matched span, so neither "No pleural effusion." nor "Pleural effusion:
// absent." can verify "pleural effusion", while a quote that carries its own
// negation still matches as written. "No interval change" describes the
// finding's course, not its absence. A decimal point is not a clause end.
const CLAUSE_BOUNDARY = /\.(?!\d)|[;\n。；!?！？]|,\s*(?:but|however|though)\b|\b(?:but|however)\b|但|然而/gi
const NEGATION_BEFORE = /\b(?:no|without|negative\s+for|free\s+of|absence\s+of)\b|無|未見|沒有|未發現|否認/i
const NEGATION_AFTER = /^[^.;\n。；]*?(?:\b(?:absent|none|negative|resolved|not\s+(?:seen|identified|detected|present|noted|demonstrated))\b|未見|消失)/i
const COURSE_NOT_ABSENCE = /\bno\s+(?:significant\s+|definite\s+)?(?:interval\s+)?(?:change|progression)\b/gi

function negatedAround(sourceText: string, start: number, end: number): boolean {
  const before = sourceText.slice(0, start)
  let clauseStart = 0
  for (const match of before.matchAll(CLAUSE_BOUNDARY)) clauseStart = (match.index ?? 0) + match[0].length
  if (NEGATION_BEFORE.test(before.slice(clauseStart).replace(COURSE_NOT_ABSENCE, ' '))) return true
  const after = sourceText.slice(end)
  const nextBoundary = after.search(CLAUSE_BOUNDARY)
  return NEGATION_AFTER.test(nextBoundary < 0 ? after : after.slice(0, nextBoundary))
}

/** The verified span, unless every place it occurs in the report sits under a
 * negation the quote left out. */
function acceptUnlessNegated(span: string, sourceText: string): string | null {
  for (let from = sourceText.indexOf(span); from >= 0; from = sourceText.indexOf(span, from + 1)) {
    if (!negatedAround(sourceText, from, from + span.length)) return span
  }
  return null
}

export function verifyReportQuote(quote: string, sourceText?: string): string | null {
  const strict = verifyDocumentQuote(quote, sourceText)
  if (strict.verification === 'exact' || strict.verification === 'whitespace-restored') {
    return sourceText ? acceptUnlessNegated(strict.quote, sourceText) : strict.quote
  }
  if (!sourceText) return null
  const target = normalizeReportExcerpt(quote).text
  // The fallback must not make short fragments easier to match.
  if (target.length < 8) return null
  const source = normalizeReportExcerpt(sourceText)
  const index = source.text.indexOf(target)
  if (index < 0) return null
  return acceptUnlessNegated(sourceText.slice(source.starts[index], source.ends[index + target.length - 1]), sourceText)
}
