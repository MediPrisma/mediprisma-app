import { echoMeasurement, isDopplerEcho, isUpperEndoscopyReport, reflowReportLayout } from './report-layout-reflow'

// Pure parser that turns a free-text hospital report (endoscopy, imaging, ECG,
// pathology) into a lightly-structured list of lines for indented rendering.
//
// Why this exists: the NHI-FHIR bridge delivers these reports as one long
// `DiagnosticReport.conclusion` / `Observation.valueString` blob — section
// headings, numbered findings and recommendations are all run together, often
// with NO separator between a heading and its neighbour (e.g.
// "...descending colon.Impression:"). Rendering that blob verbatim is hard to
// read. This parser re-flows it into headings + indented items so the history
// detail view (and the inline card expansion) can lay it out hierarchically.
//
// IMPORTANT: this is a *display* transform only. It never edits clinical values
// — measurements like "0.5 cm" / "5%-25%" must survive untouched (the numbered-
// item detector has an explicit decimal guard so "0.5" is not mistaken for an
// item marker "0.").

export interface ReportLine {
  /** Text content of the line (any leading marker stripped). */
  text: string
  /** Indentation level: 0 = section heading / flush body, 1 = item, 2 = sub-item. */
  level: 0 | 1 | 2 | 3
  /** Leading list marker, if any (e.g. "1.", "2)", "a)", "•"). Rendered separately. */
  marker?: string
  /** True when the line is a section heading (e.g. "Impression:"). */
  heading?: boolean
  /**
   * Set when a label-style heading keeps its short value on the same line
   * ("Comparison: CT on 2026-5-19."). `text` stays the whole line so plain-text
   * consumers lose nothing; this is only the prefix the renderer emphasises.
   */
  headingLabel?: string
  /** Source-system divider rule, rendered as a real divider rather than dash noise. */
  separator?: boolean
  /** Fixed-width source row such as a microbiology susceptibility header. */
  monospace?: boolean
  /** Pipe-delimited source row rendered as a compact table without changing its text. */
  tableCells?: string[]
  /** Source label and its entire value/reference text; blanks stay blank. */
  measurement?: { label: string; value: string }
}

// Section headings commonly seen in TW hospital endoscopy / imaging / ECG /
// pathology reports. Capitalised on purpose — the split + heading detection is
// case-sensitive so an ordinary lowercase word that merely contains one of
// these substrings is not mistaken for a heading.
// NOTE: keep multi-word / longer variants *before* their shorter prefixes so the
// alternation prefers the longest match (e.g. "Other Interpretations" before
// "Interpretations", "Impressions" before "Impression").
const SECTION_KEYWORDS = [
  'DOPPLER ＆ ECHOCARDIOGRAPHIC REPORT',
  'DOPPLER & ECHOCARDIOGRAPHIC REPORT',
  'Short summary', 'Sonar Diagnosis', 'Carotid Sonographic Data', 'Sonographic Data',
  'CLINICAL DIAGNOSIS', 'B-MODE FINDINGS', 'DOPPLER FINDINGS', 'INTERPRETATION',
  'PATHOLOGICAL DIAGNOSIS', 'GROSS FINDING', 'MICROSCOPIC FINDING',
  'NUCLEAR MEDICINE STUDY', 'RADIOPHARMACEUTICAL', 'SCINTIGRAPHIC FINDINGS',
  'INDICATION', 'COMMENTS', 'HOLTER REPORT', 'IMP', 'Imp', 'Suggestion',
  'Chief Complain', 'Medication', 'HP FAST', '腎臟超音波', '心電圖',
  'Esophagus', 'Stomach', 'Duodenum', 'Others', '技術員',
  'LIVER', 'GB', 'PANCREAS', 'CBD', 'PORTAL VEIN', 'SPLEEN', 'KIDNEY',
  'Endoscopy',
  'Esophagoscopy',
  'Gastroscopy',
  'Colonoscopy',
  'Sigmoidoscopy',
  'Bronchoscopy',
  'Indications',
  'Indication',
  'Premedication',
  'Instruments',
  'Instrument',
  'Findings',
  'Finding',
  'Impressions',
  'Impression',
  'Diagnosis',
  'Conclusions',
  'Conclusion',
  'Recommendations',
  'Recommendation',
  'Procedures',
  'Procedure',
  'Complications',
  'Complication',
  'Comments',
  'Comment',
  'Methods',
  'Method',
  'Other Interpretations',
  'Interpretations',
  'Interpretation',
  'Technique',
  'Comparison',
  'History',
]

const KEYWORD_SOURCE = SECTION_KEYWORDS.join('|')

// Matches a section keyword + colon anywhere in the text (case-sensitive).
// Used to force every heading onto its own line, healing the bridge's glued
// concatenations. A keyword opening a parenthetical ("(Comparison: 2026/07/07)")
// is an inline note, not a section heading — breaking there strands the "(" on
// its own line and the closing date under a fake heading.
const KEYWORD_COLON_RE = new RegExp(`(?<![A-Za-z])(?<![(（][ \t]*)(${KEYWORD_SOURCE})[ \t]*([:：])`, 'g')

// Matches a numbered list marker ("1." … "10.") glued mid-text onto the
// preceding token, the way the bridge runs findings together
// ("...No apparent ICH2. Senile..." / "...vessel disease.3. Pan-paranasal...").
// Capture-group form (no lookbehind) for older Safari compatibility:
//   $1 = the char the marker is glued to (letter / CJK / sentence punctuation)
//   $2 = the marker itself ("2.")
// The lookahead requires a capital letter or CJK after the dot, which both
// starts a new item AND guarantees decimals ("0.5", where a digit follows the
// dot) are never split.
const GLUED_NUM_RE = /([A-Za-z一-鿿.;:)\]）】])\s*(\d{1,2}\.)(?=\s*[A-Z一-鿿])/g

// A line that *is* a section heading, optionally with inline content trailing
// the colon ("Recommendation: correlate with clinical finding").
const HEADING_LINE_RE = new RegExp(`^(${KEYWORD_SOURCE})[ \t]*([:：])\\s*([\\s\\S]*)$`)

// Headings that label a short value rather than open a section. The source
// writes "Comparison: CT on 2026-5-19." as one line; splitting it puts a lone
// date under a bold pseudo-section. Conclusion-type headings (Impression,
// Diagnosis, Recommendation...) and the endoscopy organ findings are not here:
// they keep their block layout so the conclusion stands on its own.
const INLINE_LABEL_KEYWORDS = new Set([
  'Comparison', 'History', 'Technique', 'Method', 'Methods',
  'Indication', 'Indications', 'INDICATION', 'CLINICAL DIAGNOSIS',
  'Premedication', 'Instrument', 'Instruments', 'Medication', 'Chief Complain',
  'Procedure', 'Procedures', 'Complication', 'Complications',
  'NUCLEAR MEDICINE STUDY', 'RADIOPHARMACEUTICAL', '技術員',
  'LIVER', 'GB', 'PANCREAS', 'CBD', 'PORTAL VEIN', 'SPLEEN', 'KIDNEY',
])
// Past this length the "value" is a whole narrative the bridge glued onto the
// label (real captures run past 1,500 chars); it keeps the block layout so
// pushBody can still break it into paragraphs.
const INLINE_LABEL_MAX_CHARS = 200

// Top-level numbered item: "1." / "10." but NOT a decimal like "0.5".
// The dot must be followed by whitespace, end-of-line, or a non-digit
// (letter / CJK / paren) so measurements are never split.
const NUM_DOT_RE = /^(\d{1,2})\.(?=\s|$|[^\d])\s*([\s\S]*)$/
// Sub item: "1)" / "2)" / "a)" / "(1)" / "(a)".
const SUB_PAREN_RE = /^\(?([0-9]{1,2}|[a-zA-Z])\)\s*([\s\S]*)$/
// Sub-sub item: a single capital letter + colon, e.g. "A:" / "B:".
const LETTER_COLON_RE = /^([A-Z])\s*:\s*([\s\S]*)$/
// Bullet markers.
const BULLET_RE = /^([-*•·●.])(?:\s+|(?=[(（]))([\s\S]*)$/

// Health Bank microbiology narratives can arrive as one flattened run where
// spaces stand in for the source system's rows. Keep this detector deliberately
// narrow: ordinary prose containing one of these words must not be split.
const MICROBIOLOGY_BLOB_SIGNATURES = [
  /\bFinal report\s*\(最終報告\)/i,
  /\bISOLATE\s*\d+\s*[:：]/i,
  /\|\s*Susceptibility\s*\|/i,
]

const MICROBIOLOGY_METADATA_BOUNDARY_RE = new RegExp(
  String.raw`[ \t]+(?=(?:開單日期|採檢日期|檢驗項目|檢體編號|Specimen|報告日期|報告)\s*[:：]|〔最終報告〕)`,
  'gi',
)

const MICROBIOLOGY_ROW_START = [
  'Final report\\s*\\(最終報告\\)',
  '[^:\uff1a\\r\\n]*?Culture',
  'Sample Type',
  'ISOLATE\\s*\\d+',
  '\\|\\s*Susceptibility\\s*\\|',
].join('|')

const MICROBIOLOGY_ROW_BOUNDARY_RE = new RegExp(
  String.raw`[ \t]*([:：])[ \t]*(?=(?:${MICROBIOLOGY_ROW_START}))`,
  'gi',
)

const MICROBIOLOGY_HEADING_LINE_RE = /^(?:Final report\s*\(最終報告\)|[^:：\r\n]*?Culture)\s*[:：]?\s*$/i

function isFlattenedMicrobiologyReport(raw: string): boolean {
  return MICROBIOLOGY_BLOB_SIGNATURES.every((signature) => signature.test(raw))
}

/**
 * Restore row boundaries in a clearly identified flattened microbiology
 * report. This is deliberately a whitespace-only display transform: colons,
 * separator rules, labels, dates, organisms, quantities and result tokens all
 * remain verbatim and in source order.
 */
function reflowMicrobiologyBlob(raw: string): string {
  if (!isFlattenedMicrobiologyReport(raw)) return raw

  return raw
    .replace(MICROBIOLOGY_METADATA_BOUNDARY_RE, '\n')
    .replace(/(報告\s*[:：])\s*(-{12,})/gi, '$1\n$2')
    .replace(/[ \t]*([:：])[ \t]*(?=-{12,})/g, '\n$1\n')
    .replace(/\s+(-{12,})/g, '\n$1')
    .replace(MICROBIOLOGY_ROW_BOUNDARY_RE, '\n$1')
}

function formatMicrobiologyLines(rawLines: string[]): ReportLine[] {
  const lines: ReportLine[] = []
  let pendingMarker: string | undefined

  for (const rawLine of rawLines) {
    if (/^[:：]$/.test(rawLine)) {
      pendingMarker = rawLine
      continue
    }

    const prefixed = rawLine.match(/^([:：])\s*([\s\S]+)$/)
    const marker = prefixed?.[1] ?? pendingMarker
    const text = (prefixed?.[2] ?? rawLine).trim()
    pendingMarker = undefined
    if (!text) continue

    if (/^-{12,}$/.test(text)) {
      lines.push({ text, level: 0, marker, separator: true })
      continue
    }

    const heading = MICROBIOLOGY_HEADING_LINE_RE.test(text)
    const nested = /^(?:Sample Type\s*[:：]|ISOLATE\s*\d+\s*[:：]|\|\s*Susceptibility\s*\|)/i.test(text)
    const tableCells = /^\|[\s\S]*\|$/.test(text)
      ? text.slice(1, -1).split('|').map((cell) => cell.trim())
      : undefined
    lines.push({
      text,
      level: nested ? 1 : 0,
      marker,
      heading,
      monospace: tableCells === undefined && /^\|\s*Susceptibility\s*\|/i.test(text),
      tableCells,
    })
  }

  // A trailing source gutter marker is unlikely but must not disappear.
  if (pendingMarker) lines.push({ text: pendingMarker, level: 0 })
  return lines
}

// Radiology narrative reports (chest X-ray, sonography) carry NO headings and NO
// numbers — they introduce findings with a verb + colon
// ("Radiography of Chest A-P View(Supine) Show:", "Sonar ... reveals:") and then
// run every finding together as period-separated sentences. Detect that lead-in
// so the findings can be split one-per-line. `[^.\n]*?` keeps the lead-in to the
// modality clause (which never contains a period) so we stop at the FIRST
// findings verb, not at a later sentence's period.
const FINDINGS_VERBS =
  'Shows?|Showed|Showing|Reveals?|Revealed|Revealing|Demonstrates?|Demonstrated|Demonstrating|Discloses?|Disclosed|Disclosing'
const FINDINGS_LEADIN_RE = new RegExp(`^([^.\\n]*?\\b(?:${FINDINGS_VERBS})\\s*:)\\s*([\\s\\S]+)$`, 'i')

/**
 * Split a run-on findings body into one finding per line. A break is inserted
 * after a period that ends a finding — i.e. preceded by a letter / ")" / "]"
 * (a real word end, never a decimal like "1.2" because the digit before the dot
 * is excluded) and followed, with or without whitespace, by the capital letter
 * or CJK char that starts the next finding. This heals both the spaced
 * ("field. Bilateral") and the bridge's glued ("field(s).Obliteration")
 * boundaries. The first replace heals the bridge's stray space-before-period
 * ("cardiomegaly ." → "cardiomegaly.").
 */
function segmentFindings(body: string): string[] {
  return body
    .replace(/\s+\./g, '.')
    .replace(/([A-Za-z)\]])\.\s*(?=[A-Z一-鿿])/g, '$1.\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Emit a body string into `lines`. When the body is a radiology findings
 * lead-in ("Radiography ... Show:Tortuosity..."), the lead-in is emitted at
 * `baseLevel` and each finding one level deeper. Otherwise the body is pushed
 * as a single line at `baseLevel`. Used for both standalone lines (baseLevel 0)
 * and the inline content trailing a section heading like "Conclusion:"
 * (baseLevel 1) — the bridge frequently wraps the whole findings list inside a
 * "Conclusion:" heading, so segmentation must reach there too.
 */
function pushBody(lines: ReportLine[], body: string, baseLevel: 0 | 1) {
  const bullet = BULLET_RE.exec(body)
  if (bullet) {
    lines.push({ text: bullet[2].trim(), level: 1, marker: bullet[1] })
    return
  }
  const fl = FINDINGS_LEADIN_RE.exec(body)
  if (fl) {
    lines.push({ text: fl[1].trim(), level: baseLevel })
    const findingLevel = (baseLevel + 1) as 1 | 2
    for (const finding of segmentFindings(fl[2])) {
      lines.push({ text: finding, level: findingLevel })
    }
    return
  }
  // Long unlabelled CT/MR narratives still need readable paragraphs. Only
  // insert whitespace at clear sentence boundaries; short prose stays intact.
  if (body.length > 400) {
    const paragraphs = body.replace(/([a-z]{3,}|[)\]])\.[ \t]+(?=[A-Z])/g, '$1.\n').split('\n')
    if (paragraphs.length > 1) {
      for (const paragraph of paragraphs) lines.push({ text: paragraph.trim(), level: baseLevel })
      return
    }
  }
  lines.push({ text: body.trim(), level: baseLevel })
}

/**
 * Parse a free-text report into structured, indentable lines.
 *
 * Always returns at least one line for non-blank input. When the text has no
 * recognisable structure it degrades gracefully to plain level-0 lines, which
 * render identically to a normal paragraph — so callers can use this
 * unconditionally without first sniffing for structure.
 */
/**
 * Undo XML escaping the source system left in the report body.
 *
 * Bridge captures deliver some narratives with their XML entities intact, so a
 * knee X-ray reads "XLE05L&apos;t knee" and an echo reports "LA 4.8 cm&apos;".
 * That is not clinical content — it is transport encoding that never got
 * decoded, and it survives into anything copied into a note.
 *
 * `&amp;` is decoded LAST on purpose: doing it first would turn a literal
 * "&amp;apos;" (an escaped ampersand followed by the word) into an apostrophe,
 * inventing a character the source never wrote. A bare "&" — "CT without&with
 * contrast" — is left exactly as it is, since only known entity names match.
 */
export function decodeReportEntities(raw: string): string {
  if (!raw || !raw.includes('&')) return raw
  return raw
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * Put a separator between the NHI order code and the study description the
 * source ran together — "XCH01Chest PA" → "XCH01 Chest PA".
 *
 * Unlike entity decoding, every character here is content the reporting system
 * actually wrote; what is missing is only the space. So this INSERTS and never
 * deletes: the code stays visible, because it is what the clinician matches
 * against the order and what a bridge report would have to quote.
 *
 * Deliberately narrow, and anchored to the very start of the report:
 *   • lettered codes need ≥2 uppercase letters AND ≥2 digits (XCH01, XLE18),
 *     which no English word can satisfy;
 *   • bare numeric codes must be exactly six digits (090170, 221070, 330272)
 *     or the five-digits-plus-letter NHI shape (18005C, 12193C), so
 *     "12mm nodule" and "2024 follow-up" are left alone;
 *   • the character after the code must be a letter, so "500000 units" and
 *     "1000000IU" never match.
 * Anything mid-text is untouched — a code only ever prefixes the first line.
 *
 * KNOWN LIMIT: the LETTERED form claims no trailing letter, because "XCH01C"
 * and "XCH01" + "Chest" are the same characters. Where a code genuinely ends
 * in a letter it is the numeric five-plus-letter shape, which is matched. A
 * wrong guess here costs a misplaced space and never a lost character — which
 * is the reason this inserts rather than deletes.
 */
const GLUED_ORDER_CODE_RE =
  /^([A-Z]{2,5}\d{2,4}|\d{6}|\d{5}[A-Z])(?=[A-Za-z\u4e00-\u9fff])/

export function separateGluedOrderCode(raw: string): string {
  if (!raw) return raw
  return raw.replace(/^\s*[^\n]*/, (firstLine) => (
    firstLine.replace(GLUED_ORDER_CODE_RE, '$1 ')
  ))
}

export function formatReportText(raw: string): ReportLine[] {
  if (!raw || !raw.trim()) return []

  // 0) Decode transport-level XML escaping before anything reads the text:
  //    heading detection, measurement parsing and the clipboard all see the
  //    characters the reporting system actually wrote.
  raw = separateGluedOrderCode(decodeReportEntities(raw))

  const isMicrobiologyBlob = isFlattenedMicrobiologyReport(raw)

  // 1) Force every section heading onto its own line, then break apart numbered
  //    findings the bridge ran together. Both heal glued concatenations so a
  //    plain line-split doesn't bury "Impression:" / "2." mid-sentence.
  const broken = reflowMicrobiologyBlob(isMicrobiologyBlob ? raw.replace(/\r\n?/g, '\n') : reflowReportLayout(raw))
    .replace(KEYWORD_COLON_RE, (_m, kw, colon) => `\n${kw}${colon}`)
    .replace(GLUED_NUM_RE, (_m, before, marker) => `${before}\n${marker}`)

  // 2) Split, trim, drop blank lines (this also collapses the verbose blank
  //    runs the bridge pads reports with).
  const splitLines = broken
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (isMicrobiologyBlob) return formatMicrobiologyLines(splitLines)

  // Heading detection may insert a break after a source list marker. Reattach
  // only a marker-only line to its heading; never consume adjacent findings.
  const rawLines: string[] = []
  for (const line of splitLines) {
    const previous = rawLines.at(-1)
    if (previous && /^(?:\d{1,2}\.|\(?[0-9]{1,2}\))$/.test(previous) && HEADING_LINE_RE.test(line)) {
      rawLines[rawLines.length - 1] = `${previous} ${line}`
    } else rawLines.push(line)
  }

  const lines: ReportLine[] = []
  let inEchoMeasurements = isDopplerEcho(raw)
  let inCarotidTable = false
  const upperEndoscopy = isUpperEndoscopyReport(raw)
  let bodyLevel: 0 | 1 = 0
  const numberedEndoscopy = /Endoscopy\s*[:：]/.test(raw) &&
    /(?:Pre-procedure assessment|Findings and interventions)\s*:/.test(raw)
  let numberedContinuation: ReportLine | undefined
  const pushNumbered = (text: string, level: 1 | 2 | 3, marker: string) => {
    const item: ReportLine = { text, level, marker }
    if (/[:：]$/.test(text)) item.heading = true
    lines.push(item)
    numberedContinuation = numberedEndoscopy ? item : undefined
  }
  for (const line of rawLines) {
    if (/^Carotid Sonographic Data:/.test(line)) inCarotidTable = true
    else if (inCarotidTable && /^Diam:/.test(line)) inCarotidTable = false
    else if (inCarotidTable) {
      const previous = lines.at(-1)
      if (previous?.monospace) previous.text += `\n${line}`
      else lines.push({ text: line, level: 0, monospace: true })
      continue
    }
    if (/^(?:Conclusion|Short summary)[:：]/.test(line)) inEchoMeasurements = false
    if (/^[-=_]{12,}$/.test(line)) {
      numberedContinuation = undefined
      lines.push({ text: line, level: 0, separator: true })
      continue
    }
    const measurement = inEchoMeasurements ? echoMeasurement(line) : undefined
    if (measurement) {
      lines.push({ text: line, level: 1, measurement })
      continue
    }
    if (/^(?:二尖瓣|三尖瓣|主動脈瓣|肺動脈瓣|心包膜液|其他發現|Diagnosis|Gross Finding|Microscopic Finding|Interpretation Summary|(?:MMode\/2D|Doppler) Measurements [＆&] Calculations|Left Ventricle|Left Atrium|Right Heart|Mitral Valve|Aortic Valve|Tricuspid Valve|Pulmonic Valve|Pericardium)$/.test(line)) {
      lines.push({ text: line, level: 0, heading: true })
      continue
    }
    // Section heading, possibly carrying inline content after the colon.
    const h = HEADING_LINE_RE.exec(line)
    if (h) {
      numberedContinuation = undefined
      if (upperEndoscopy) bodyLevel = 1
      const kw = h[1]
      const rest = h[3].trim()
      if (rest && INLINE_LABEL_KEYWORDS.has(kw) && rest.length <= INLINE_LABEL_MAX_CHARS && !BULLET_RE.test(rest) && !FINDINGS_LEADIN_RE.test(rest)) {
        // The source line verbatim: its own spacing after the colon, none added.
        lines.push({ text: line, level: 0, heading: true, headingLabel: line.slice(0, line.indexOf(h[2], kw.length) + 1) })
        continue
      }
      lines.push({ text: `${kw}${h[2]}`, level: 0, heading: true })
      // Inline content after the colon — may itself be a findings lead-in the
      // bridge tucked under "Conclusion:" / "Findings:", so route it through
      // pushBody (segments findings) rather than pushing one flat line.
      if (rest) pushBody(lines, rest, 1)
      continue
    }

    // Top-level numbered item ("1." … "10."), decimal-guarded.
    const n = NUM_DOT_RE.exec(line)
    if (n) {
      pushNumbered(n[2].trim(), 1, `${n[1]}.`)
      continue
    }

    const fullWidthItem = /^(\d{1,2}＞)\s*(.*)$/.exec(line)
    if (fullWidthItem) {
      lines.push({ text: fullWidthItem[2], level: 1, marker: fullWidthItem[1] })
      continue
    }

    // Sub item "1)" / "a)" / "(1)".
    const s = SUB_PAREN_RE.exec(line)
    if (s) {
      pushNumbered(s[2].trim(), 2, line.slice(0, line.indexOf(')') + 1))
      continue
    }

    const letterDot = numberedEndoscopy ? /^([a-z]\.)\s+([\s\S]*)$/.exec(line) : null
    if (letterDot) {
      pushNumbered(letterDot[2], 3, letterDot[1])
      continue
    }

    // Sub-sub item "A:" / "B:".
    const lc = LETTER_COLON_RE.exec(line)
    if (lc) {
      pushNumbered(lc[2].trim(), 2, `${lc[1]}:`)
      continue
    }

    // Bullet "-" / "*" / "•".
    const b = BULLET_RE.exec(line) ?? (numberedEndoscopy ? /^([*])(?=\S)([\s\S]*)$/.exec(line) : null)
    if (b) {
      numberedContinuation = undefined
      lines.push({ text: b[2].trim(), level: 1, marker: b[1] })
      continue
    }

    // Plain body / continuation line. pushBody also handles a standalone
    // radiology findings lead-in ("Radiography ... Show:Tortuosity...") — lead-in
    // flush at level 0, each finding indented at level 1. A structureless
    // multi-sentence paragraph WITHOUT a lead-in stays a single flush line.
    if (numberedContinuation && lines.at(-1) === numberedContinuation) {
      numberedContinuation.text += ` ${line}`
      continue
    }
    pushBody(lines, line, bodyLevel)
  }

  return lines
}

/** Serialize the display parser's hierarchy without changing clinical words. */
function serializeFormattedReportText(raw: string): string {
  return formatReportText(raw)
    .map((line) => {
      const indent = '  '.repeat(line.level)
      const marker = line.marker ? `${line.marker} ` : ''
      return `${indent}${marker}${line.text}`
    })
    .join('\n')
}

/**
 * Give the translation model the same source hierarchy the reader sees.
 * The original FHIR narrative is often one run-on string; sending it directly
 * made otherwise distinct findings easy for the model to merge into one
 * Chinese paragraph.
 */
export function formatReportTextForAi(raw: string): string {
  return serializeFormattedReportText(raw)
}

/**
 * Serialize a report with the same hierarchy used by `FormattedReportText`.
 * Clipboard text cannot carry the component's visual padding, so two spaces
 * per level preserve the heading/item relationship without changing any
 * clinical wording. List markers stripped by the parser are restored here.
 */
export function formatReportTextForClipboard(raw: string): string {
  return serializeFormattedReportText(raw)
}
