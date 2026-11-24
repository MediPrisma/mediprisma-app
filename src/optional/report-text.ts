// Public fallback for clones without private package access: a copy of
// @voho0000/personalized-care-fhir 1.18.1 ./report-text (mediprisma-cdss 4cb18fc,
// packages/personalized-care-fhir/src/report-text.ts). Keep it identical;
// __tests__/optional/report-text-fallback.test.ts compares the two.

/**
 * Imaging and pathology report text, shortened for a model prompt.
 *
 * Moved verbatim from mediprisma-app `src/core/use-cases/medical-summary/
 * report-digest.ts` so the app and the outpatient assistant read reports the
 * same way: which lines are administrative, where the conclusion section is,
 * how a report view is cut, and how many reports fit one request. Pure string
 * work — no FHIR resource, no host entity. Choosing which reports are
 * candidates, and the header line each one opens with, stays with the caller.
 *
 * Every excerpt and view is built from the report's own text; verification of
 * a quoted passage always runs against the full narrative, never the view.
 */


/** Reports considered for the request; the rest go straight to the footer. */
export const REPORT_DIGEST_MAX_REPORTS = 30
/** Characters of one report's text in the prompt (conclusion first) before
 *  the budget forces it shorter. */
export const REPORT_DIGEST_PER_REPORT_CHARS = 1_800
/** Estimated report-text tokens of the single request. On the hospital GPU
 *  ~13K tokens of prompt is ~24 s of prefill; 10K of reports plus the short
 *  instructions stays inside the first-output watchdog. */
export const REPORT_DIGEST_TOKEN_BUDGET = 10_000
/** Per-report lengths tried, in order, before the oldest reports are dropped
 *  from the request. Every step still leads with the conclusion section. */
export const REPORT_DIGEST_SHRINK_STEPS = [1_800, 1_200, 800, 500, 300] as const

/** Deterministic fallback lengths (characters). */
export const REPORT_CONCLUSION_EXCERPT_CHARS = 300
export const REPORT_OPENING_EXCERPT_CHARS = 200

const OMISSION_MARKER = '[…]'

// ---------------------------------------------------------------------------
// Line-level text helpers
// ---------------------------------------------------------------------------

interface LineSpan {
  start: number
  /** Exclusive; the line terminator is not part of the span. */
  end: number
  text: string
}

/** Report text arrives with \n, \r\n, and — from some NHI exports — a bare
 *  \r between lines. All three end a line. */
const LINE_BREAK = /\r\n|\r|\n/g

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  LINE_BREAK.lastIndex = 0
  for (let match = LINE_BREAK.exec(text); match; match = LINE_BREAK.exec(text)) {
    spans.push({ start, end: match.index, text: text.slice(start, match.index) })
    start = match.index + match[0].length
  }
  spans.push({ start, end: text.length, text: text.slice(start) })
  return spans
}

// Labels that never occur in clinical prose: matched anywhere on a short line.
const ADMIN_LABEL_ANYWHERE =
  /(?:申請序號|開醫囑者|開單醫師|報告人|報告醫師|醫檢師|病理號|簽收時間|病歷號碼?|身分證(?:字號|號)?)[ \t]*[:：]/
// Patient-identity and sign-off fields: matched only as a line's leading label.
const ADMIN_LABEL_AT_START =
  /^[ \t]*(?:姓名|性別|出生(?:日期)?|年齡|床號|patient(?:[ \t]+(?:name|id|no\.?))?|name|sex|gender|age|d\.?o\.?b\.?|date[ \t]+of[ \t]+birth|chart[ \t]*(?:no\.?|number)|mrn|medical[ \t]+record[ \t]+(?:no\.?|number)|reported[ \t]+by|signed[ \t]+by|verified[ \t]+by|accession(?:[ \t]+(?:no\.?|number))?)[ \t]*[:：]/i
/** A one-line NHI report can hold every field; never drop a long line whole. */
const ADMIN_LINE_MAX_CHARS = 160

/** An administrative line: patient identity, order and sign-off fields. */
export function isAdministrativeLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > ADMIN_LINE_MAX_CHARS) return false
  return ADMIN_LABEL_ANYWHERE.test(trimmed) || ADMIN_LABEL_AT_START.test(trimmed)
}

function stripAdministrativeLines(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => !isAdministrativeLine(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Header-anchored: the header opens its line and is followed by a colon or by
// nothing. "Clinical diagnosis:" (the requester's working diagnosis) and a
// sentence such as "Diagnosis of ..." are deliberately not headers.
const CONCLUSION_HEADER =
  /^[ \t]{0,40}(?:[#*•>\-–]{1,4}[ \t]{0,8})?(?:\d{1,3}[.)][ \t]{0,8})?[【[(（]?[ \t]{0,8}(?:(?:(?:patholog(?:ic|ical)|final|sonar|sonographic|ultrasound|imaging|radiologic(?:al)?)[ \t]{1,8})?diagnos[ie]s|impressions?(?:[ \t]{1,8}and[ \t]{1,8}recommendations?)?|conclusions?(?:[ \t]{0,8}[&/][ \t]{0,8}comments?|[ \t]{1,8}and[ \t]{1,8}comments?)?|(?:病理|最終|影像)?(?:診斷|結論|印象))[ \t]{0,8}[】\])）]?[ \t]{0,8}(?:[:：]|$)/i

// A line that is only a section heading ("Other Interpretations:", "建議：")
// closes the conclusion section that precedes it.
const BARE_SECTION_HEADING = /^[ \t]*[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff /&()（）-]{1,40}[:：][ \t]*$/

export interface ConclusionSection {
  /** Offset of the header line. */
  headerStart: number
  /** Offset of the first character after the header (and its colon). */
  contentStart: number
  /** Exclusive end: the next administrative line or bare section heading,
   *  or the end of the text. */
  end: number
}

/** The report's conclusion section, or null. The LAST matching header wins:
 *  an addendum's impression supersedes the original one above it. */
export function findConclusionSection(narrative: string): ConclusionSection | null {
  const spans = lineSpans(narrative)
  let found: ConclusionSection | null = null
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    const match = CONCLUSION_HEADER.exec(span.text)
    if (!match) continue
    const contentStart = span.start + match[0].length
    let end = narrative.length
    let sawContent = Boolean(narrative.slice(contentStart, span.end).trim())
    for (let next = index + 1; next < spans.length; next += 1) {
      const line = spans[next].text
      if (isAdministrativeLine(line) || (sawContent && BARE_SECTION_HEADING.test(line))) {
        end = spans[next].start
        break
      }
      if (line.trim()) sawContent = true
    }
    if (!narrative.slice(contentStart, end).trim()) continue
    found = { headerStart: span.start, contentStart, end }
  }
  return found
}

// A period after a digit is usually list numbering ("2. Senile atrophy"), not
// the end of a sentence.
const RULER_LINE = /^[-=_─━]{3,}$/

/** Drop trailing ruler lines ("-----"): layout, not content. Line by line on
 *  purpose — a nested-quantifier regex here backtracks exponentially on a
 *  long ruler that is not at the end. The result stays a prefix of `text`. */
function stripTrailingRulers(text: string): string {
  let end = text.trimEnd().length
  for (;;) {
    const lineStart = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf('\r', end - 1)) + 1
    if (lineStart === 0 || !RULER_LINE.test(text.slice(lineStart, end).trim())) {
      return text.slice(0, end)
    }
    end = text.slice(0, lineStart).trimEnd().length
  }
}

const SENTENCE_END = /[。！？；;!?]|(?<!\d)\.(?=\s|$)|\r\n|\r|\n/g

/**
 * Cut `text` to at most `max` characters, preferring the end of a sentence or
 * line. The result is always a prefix of `text` (trimmed), so a deterministic
 * excerpt stays verbatim. `truncated` is true only when no boundary fit and
 * the cut lands mid-sentence.
 */
export function cutAtSentenceBoundary(
  text: string,
  max: number,
  minBoundaryFraction = 0,
): { text: string; truncated: boolean } {
  const trimmed = stripTrailingRulers(text.trim())
  if (trimmed.length <= max) return { text: trimmed, truncated: false }
  let best = -1
  SENTENCE_END.lastIndex = 0
  for (let match = SENTENCE_END.exec(trimmed); match; match = SENTENCE_END.exec(trimmed)) {
    const isLineBreak = match[0] === '\n' || match[0] === '\r' || match[0] === '\r\n'
    const cut = isLineBreak ? match.index : match.index + match[0].length
    if (cut > max) break
    best = cut
  }
  if (best > 0 && best >= max * minBoundaryFraction) {
    const cutText = stripTrailingRulers(trimmed.slice(0, best).trim())
    if (cutText) return { text: cutText, truncated: false }
  }
  // No boundary: hard cut, never splitting a surrogate pair.
  let end = max
  const code = trimmed.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return { text: trimmed.slice(0, end).trimEnd(), truncated: true }
}

/** Shortened report view for the prompt: conclusion first, then the rest of
 *  the body, administrative lines removed, capped with an omission marker. */
export function buildReportPromptBody(
  narrative: string,
  maxChars = REPORT_DIGEST_PER_REPORT_CHARS,
): { text: string; hasConclusion: boolean } {
  const section = findConclusionSection(narrative)
  const parts = section
    ? [
        narrative.slice(section.headerStart, section.end),
        narrative.slice(0, section.headerStart),
        narrative.slice(section.end),
      ]
    : [narrative]
  const text = parts
    .map(stripAdministrativeLines)
    .filter(Boolean)
    .join('\n\n')
  if (text.length <= maxChars) return { text, hasConclusion: Boolean(section) }
  const room = Math.max(1, maxChars - OMISSION_MARKER.length - 1)
  // Prefer a boundary in the back half so a long first sentence is not
  // reduced to a stub; otherwise cut hard.
  const cut = cutAtSentenceBoundary(text, room, 0.5)
  return { text: `${cut.text}\n${OMISSION_MARKER}`, hasConclusion: Boolean(section) }
}

export interface DeterministicReportExcerpt {
  excerpt: string
  source: 'conclusion' | 'opening'
  truncated: boolean
}

/** The fallback a row shows when no model quote survived verification: the
 *  conclusion section, else the opening of the report. Always a contiguous
 *  slice of the narrative. */
export function deterministicReportExcerpt(narrative: string): DeterministicReportExcerpt | null {
  const section = findConclusionSection(narrative)
  if (section) {
    const cut = cutAtSentenceBoundary(
      narrative.slice(section.contentStart, section.end),
      REPORT_CONCLUSION_EXCERPT_CHARS,
    )
    if (cut.text) return { excerpt: cut.text, source: 'conclusion', truncated: cut.truncated }
  }
  const spans = lineSpans(narrative)
  const firstIndex = spans.findIndex((span) => span.text.trim() && !isAdministrativeLine(span.text))
  if (firstIndex < 0) return null
  let end = narrative.length
  for (let next = firstIndex + 1; next < spans.length; next += 1) {
    if (isAdministrativeLine(spans[next].text)) {
      end = spans[next].start
      break
    }
  }
  const cut = cutAtSentenceBoundary(
    narrative.slice(spans[firstIndex].start, end),
    REPORT_OPENING_EXCERPT_CHARS,
  )
  return cut.text ? { excerpt: cut.text, source: 'opening', truncated: cut.truncated } : null
}

// ---------------------------------------------------------------------------
// Fitting reports into one request
// ---------------------------------------------------------------------------

/** One report the caller offers for the request. */
export interface ReportTextCandidate {
  /** Citation key, e.g. "L14"; ties on date and rank go to the lower number. */
  key: string
  date?: string
  /** Higher ranks sort first among reports of the same date. */
  rank: number
  /** The FULL report text. A candidate whose text is blank is skipped. */
  narrative: string
  /** Line the caller writes above the report's view in the prompt. */
  header: string
  /** Identities of the study (accession, date + class, ...). A candidate
   *  sharing one with an earlier candidate in the input is the same study
   *  twice and is skipped: the first one is kept. */
  identities?: readonly string[]
}

export interface FittedReportText<C extends ReportTextCandidate> {
  candidate: C
  /** Header line plus the shortened report view sent to the model. */
  promptText: string
  estimatedTokens: number
  /** Whether a header-anchored conclusion section was found. */
  hasConclusion: boolean
}

export interface ReportTextFitOptions {
  /** The caller's token estimator; the budget is counted with it. */
  estimateTokens: (text: string) => number
  maxReports?: number
  /** Starting per-report length (the first shrink step is replaced by it). */
  perReportChars?: number
  /** Estimated-token budget of the request's report text. */
  tokenBudget?: number
}

export interface ReportTextFit<C extends ReportTextCandidate> {
  /** Reports sent to the model, newest first. */
  items: FittedReportText<C>[]
  /** Reports left out of the request — past the report cap, or the oldest
   *  ones dropped to fit the token budget — newest first. */
  overflow: FittedReportText<C>[]
  /** The single request's report text. */
  promptText: string
  /** Estimated tokens of `promptText`. */
  estimatedTokens: number
  /** Per-report length the request was built at (the last shrink step used). */
  perReportChars: number
}

function keyNumber(key: string): number {
  const n = Number(key.replace(/^\D+/, ''))
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

/** Separator between reports in the prompt, counted in the budget. */
const REPORT_SEPARATOR = '\n\n'

/**
 * Reports for one request, newest first, with every report's view shrunk
 * (conclusion first) before any report is dropped, and the oldest dropped to
 * `overflow` only when the shortest view is still over the budget. Pure and
 * deterministic.
 */
export function fitReportTextsToBudget<C extends ReportTextCandidate>(
  candidates: readonly C[],
  options: ReportTextFitOptions,
): ReportTextFit<C> {
  const { estimateTokens } = options
  const maxReports = Math.max(0, options.maxReports ?? REPORT_DIGEST_MAX_REPORTS)
  const tokenBudget = Math.max(1, options.tokenBudget ?? REPORT_DIGEST_TOKEN_BUDGET)
  const firstStep = Math.max(200, options.perReportChars ?? REPORT_DIGEST_PER_REPORT_CHARS)
  const shrinkSteps = [
    firstStep,
    ...REPORT_DIGEST_SHRINK_STEPS.filter((chars) => chars < firstStep),
  ]

  const fitted = (candidate: C, perReportChars: number): FittedReportText<C> => {
    const body = buildReportPromptBody(candidate.narrative, perReportChars)
    const promptText = `${candidate.header}\n${body.text}`
    return {
      candidate,
      promptText,
      estimatedTokens: estimateTokens(promptText),
      hasConclusion: body.hasConclusion,
    }
  }
  const totalTokens = (items: readonly FittedReportText<C>[]) =>
    items.reduce((sum, item) => sum + item.estimatedTokens, 0) +
    Math.max(0, items.length - 1) * estimateTokens(REPORT_SEPARATOR)

  const seen = new Set<string>()
  const kept: C[] = []
  for (const candidate of candidates) {
    if (!candidate.narrative.trim()) continue
    const identities = candidate.identities ?? []
    if (identities.some((identity) => seen.has(identity))) continue
    identities.forEach((identity) => seen.add(identity))
    kept.push(candidate)
  }
  kept.sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '') ||
    b.rank - a.rank ||
    keyNumber(a.key) - keyNumber(b.key))
  const considered = kept.slice(0, maxReports)
  const pastCap = kept.slice(maxReports)

  // Shrink every report's view before giving up on any report: a shorter
  // conclusion-first view of an old study is worth more than no view at all.
  let perReportChars = shrinkSteps[0]
  let items = considered.map((candidate) => fitted(candidate, perReportChars))
  for (const chars of shrinkSteps.slice(1)) {
    if (totalTokens(items) <= tokenBudget) break
    perReportChars = chars
    items = considered.map((candidate) => fitted(candidate, chars))
  }
  // Still over at the shortest view: the oldest reports leave the request
  // (newest first is the order, so they are at the end) for the overflow.
  const dropped: FittedReportText<C>[] = []
  while (items.length > 1 && totalTokens(items) > tokenBudget) {
    dropped.unshift(items.pop()!)
  }
  return {
    items,
    overflow: [
      ...dropped,
      ...pastCap.map((candidate) => fitted(candidate, perReportChars)),
    ],
    promptText: items.map((item) => item.promptText).join(REPORT_SEPARATOR),
    estimatedTokens: totalTokens(items),
    perReportChars,
  }
}
