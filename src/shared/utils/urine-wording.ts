// 尿 inside an analyte name is not a urine specimen: 尿素氮 (urea nitrogen,
// BUN), 尿素 (urea, also 尿素呼氣試驗), 尿酸 (uric acid), and the natriuretic /
// antidiuretic words 利尿 / 鈉尿 (B型利鈉尿胜肽, 抗利尿激素). Every 尿 / URINE
// specimen heuristic reads the text with these words removed, so 「血中尿素氮」
// stays a blood analyte while 「尿中尿酸」 and 「尿素氮(尿)」 still state urine.
const URINE_ANALYTE_WORDS_RE = /尿素氮|尿素|尿酸|利尿|鈉尿/gu

/** The text (NFKC) with the analyte words that contain 尿 blanked out. */
export function withoutUrineAnalyteWords(text: string): string {
  return String(text ?? '').normalize('NFKC').replace(URINE_ANALYTE_WORDS_RE, ' ')
}

const URINE_WORDING_RE = /\bURINE\b|尿|小便/i

/** True when the text states a urine specimen: 尿 / 小便 / "Urine" outside an
 *  analyte word (尿液, 尿中, 尿蛋白, 「(尿)」, "Urine uric acid"). */
export function hasUrineWording(text: string): boolean {
  return URINE_WORDING_RE.test(withoutUrineAnalyteWords(text))
}

const URINE_ANALYTE_WORD_RE = /尿素氮|尿素|尿酸/u

/** A name of an analyte spelt with 尿 (尿素氮, 尿酸) that ALSO states urine —
 *  「尿素氮(尿)」, 「尿中尿酸」, "Urine uric acid" — is the urine measurement,
 *  even though its bare analyte name is a blood-chemistry alias. */
export function isUrineAnalyteInUrine(text: string): boolean {
  const normalized = String(text ?? '').normalize('NFKC')
  return (URINE_ANALYTE_WORD_RE.test(normalized) || /\bUREA\b|\bURIC\b/i.test(normalized)) && hasUrineWording(normalized)
}
