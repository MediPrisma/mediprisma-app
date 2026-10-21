/** Source-excerpt verification, not semantic verification of a clinical claim. */
export type DocumentQuoteVerification = 'exact' | 'whitespace-restored' | 'not-found' | 'unavailable'

// A Chinese character carries roughly a word of meaning, so a genuine
// verbatim clinical phrase can be much shorter than a Latin one (e.g.
// 「疑似肺炎」). Very short Latin fragments still match too easily by accident.
const HAN = /[㐀-鿿]/g
function minimumQuoteLength(quote: string): number {
  return (quote.match(HAN)?.length ?? 0) >= 4 ? 4 : 8
}

/** A full-width ASCII form (Ａ, １, ＞, （) is the same character at another
 *  width. Taiwanese clinical text mixes both, and a model copying a passage
 *  writes it half-width ("1-＞ 2PC QD" quoted as "1-> 2PC QD"). Case, digits
 *  and every other character stay as they are. */
function halfWidth(char: string): string {
  const code = char.charCodeAt(0)
  return code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : char
}

export function verifyDocumentQuote(quote: string, sourceText?: string): {
  quote: string
  verification: DocumentQuoteVerification
} {
  if (!sourceText) return { quote, verification: 'unavailable' }
  if (quote.trim().length < minimumQuoteLength(quote)) return { quote, verification: 'not-found' }
  if (sourceText.includes(quote)) return { quote, verification: 'exact' }
  // Only whitespace and character width may differ. Do not fuzzy-match,
  // translate, case-fold units, remove negation, change numbers, or join
  // non-contiguous passages. Whitespace before closing punctuation counts as
  // absent on both sides: reports break a line before a sentence's full stop
  // ("SI joint\n."), which a quote of that sentence writes as "SI joint.".
  // The returned quote is always the source's own span.
  const target = [...quote].map(halfWidth).join('')
    .replace(/\s+/g, ' ').replace(/ (?=[.,;:)\]])/g, '').trim()
  const chars: string[] = [], starts: number[] = [], ends: number[] = []
  for (let i = 0; i < sourceText.length;) {
    const start = i
    if (/\s/.test(sourceText[i])) {
      while (i < sourceText.length && /\s/.test(sourceText[i])) i++
      if (i < sourceText.length && /[.,;:)\]]/.test(halfWidth(sourceText[i]))) continue
      chars.push(' ')
    } else chars.push(halfWidth(sourceText[i++]))
    starts.push(start); ends.push(i)
  }
  const index = chars.join('').indexOf(target)
  if (index < 0) return { quote, verification: 'not-found' }
  return {
    quote: sourceText.slice(starts[index], ends[index + target.length - 1]),
    verification: 'whitespace-restored',
  }
}
