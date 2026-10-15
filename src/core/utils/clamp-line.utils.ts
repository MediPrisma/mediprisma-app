/** A one-line text clamped at a clause boundary, never mid-word: an over-long
 *  headline ("…on SEROQUEL, Lendormin, KARY") ends at its last complete
 *  clause and says it was cut with an ellipsis. */
export function clampLine(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const floor = Math.floor(max * 0.5)
  const clause = Math.max(...[', ', '; ', '；', '，', '、', ' (', '（'].map((mark) => head.lastIndexOf(mark)))
  const space = head.lastIndexOf(' ')
  const cut = clause >= floor ? clause : space >= floor ? space : max - 1
  return `${head.slice(0, cut).replace(/[\s,;，；、(（:：-]+$/, '')}…`
}
