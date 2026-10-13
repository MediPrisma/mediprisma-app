import { formatReportText, type ReportLine } from './report-text-format'

// One-glance preview for a collapsed free-text report card.
//
// Why this exists: the collapsed card used to show the report's first line,
// and for CT / MRI / sonography that line is almost always acquisition detail
// ("Method: Axial noncontrast 5 mm sections from the skull base…") rather than
// what the reader opened the card for. Clinicians asked for the conclusion.
//
// Display-only, like `formatReportText`: it chooses WHERE the preview starts
// and never rewrites a word. Copy, the expanded view and every AI path keep
// reading the full original text.

export interface ReportPreview {
  /** The source's own heading for the section shown ("Impression", "IMP"…),
   *  colon stripped. Absent when the preview is not a conclusion section. */
  label?: string
  /** Section text in source order, items joined on one line with markers kept. */
  text: string
}

// Conclusion headings, grouped by how reliably they mean "the verdict".
// A report with both an "Impression:" and an endoscopy-style "Diagnosis:"
// previews the Impression; within a group the earliest heading wins (a later
// one is usually an addendum).
const CONCLUSION_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['Impressions', 'Impression', 'IMP', 'Imp', 'Conclusions', 'Conclusion', 'Sonar Diagnosis', 'Interpretation Summary', 'Short summary']),
  new Set(['PATHOLOGICAL DIAGNOSIS', 'Diagnosis', 'INTERPRETATION', 'Interpretations', 'Interpretation']),
]

// Leading sections that describe how the study was done or why, never what it
// found. When a report has no conclusion heading, the preview skips past these.
// A letterhead block ("正式報告 臺北榮民總醫院…報告 病患資訊：…") is deliberately
// NOT skipped: what follows it is patient identity, not findings.
const PREAMBLE_HEADINGS = new Set([
  'History', 'Comparison', 'Methods', 'Method', 'Technique', 'INDICATION', 'Indications', 'Indication',
  'Premedication', 'Instruments', 'Instrument', 'Chief Complain', 'Medication', 'CLINICAL DIAGNOSIS',
  'RADIOPHARMACEUTICAL',
])

// "Computed Tomography of Brain Without Enhancement Show:" left on its own
// line — the study name the card title already carries, introducing findings.
const LEAD_IN_ONLY_RE = /\b(?:Shows?|Showed|Showing|Reveals?|Revealed|Revealing|Demonstrates?|Demonstrated|Demonstrating|Discloses?|Disclosed|Disclosing)\s*[:：]\s*$/i
// The shared parser only splits on its own keyword list, so some conclusion
// headings arrive as a plain line with the verdict after the colon:
// "Interpretation Summary: Reduced LV systolic function." or a combined
// "CT findings and conclusion:" lead-in. Same priority as the first group.
const INLINE_CONCLUSION_RE = /^(Interpretation Summary|Short summary|Sonar Diagnosis|(?:[A-Z]{2,5}\s+)?[Ff]indings\s+and\s+[Cc]onclusions?)\s*[:：]\s*([\s\S]*)$/

// Preamble sections about how the images were acquired. Numbered items right
// after these are findings (the bridge drops the next heading); after History
// or Comparison they may still be the history itself.
const ACQUISITION_HEADINGS = new Set(['Methods', 'Method', 'Technique'])

const headingKey = (line: ReportLine) => line.text.replace(/\s*[:：]\s*$/, '')
const isSectionHeading = (line: ReportLine) => line.heading === true && line.level === 0
// "Impression:." — the source's stray punctuation after the colon.
const trimLeadingPunctuation = (text: string) => text.replace(/^[.。,，;；:：\s]+/, '')
const joinLines = (lines: ReportLine[]) => lines
  .filter((line) => !line.separator)
  .map((line) => (line.marker ? `${line.marker} ${line.text}` : line.text))
  .join(' ')
  .trim()

/** Body of the section starting at `start`, up to the next section heading. */
function sectionBody(lines: ReportLine[], start: number): ReportLine[] {
  const body: ReportLine[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (isSectionHeading(lines[i])) break
    body.push(lines[i])
  }
  return body
}

function conclusionPreview(lines: ReportLine[]): ReportPreview | null {
  for (const [rank, group] of CONCLUSION_GROUPS.entries()) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (isSectionHeading(line) && group.has(headingKey(line))) {
        const text = trimLeadingPunctuation(joinLines(sectionBody(lines, i)))
        if (text) return { label: headingKey(line), text }
        continue
      }
      const inline = rank === 0 && line.level === 0 && !line.heading ? INLINE_CONCLUSION_RE.exec(line.text) : null
      if (inline) {
        const text = trimLeadingPunctuation(`${inline[2]} ${joinLines(sectionBody(lines, i))}`.trim())
        if (text) return { label: inline[1], text }
      }
    }
  }
  return null
}

/**
 * Index of the first line after the preamble, or 0 when the preamble cannot be
 * skipped safely. Only a findings lead-in ("… Show:", inline or on its own
 * line) proves the findings have started; a method/technique section after it
 * keeps that proof, any other preamble section drops it. Without that proof a
 * History list or paragraph that runs on past its heading would preview as a
 * result, with the heading that said otherwise gone — so the report stays as
 * written.
 */
function skipPreamble(lines: ReportLine[]): number {
  let i = 0
  let afterLeadIn = false
  while (i < lines.length) {
    const line = lines[i]
    if (line.separator) {
      i++
      continue
    }
    if (line.level === 0 && LEAD_IN_ONLY_RE.test(line.text)) {
      afterLeadIn = true
      i++
      continue
    }
    if (isSectionHeading(line) && PREAMBLE_HEADINGS.has(headingKey(line))) {
      if (!ACQUISITION_HEADINGS.has(headingKey(line))) afterLeadIn = false
      i++
      // Only the heading's own run-on text.
      while (i < lines.length && lines[i].level > 0 && !lines[i].marker && !lines[i].heading) {
        // "Comparison: 2025/08/06 CT of the chest … shows:" — the run-on text
        // itself ends in the findings lead-in.
        if (LEAD_IN_ONLY_RE.test(lines[i].text)) afterLeadIn = true
        i++
      }
      continue
    }
    break
  }
  if (i === 0 || i >= lines.length) return 0
  return afterLeadIn ? i : 0
}

/**
 * Pick what a collapsed report card should preview.
 *
 * 1. The report's conclusion section, labelled with the source's own heading.
 * 2. Otherwise the text after any leading method / history / study-name
 *    preamble.
 * 3. Otherwise `null` — the caller keeps showing the report as written.
 */
export function extractReportPreview(raw: string | undefined | null): ReportPreview | null {
  if (!raw || !raw.trim()) return null
  const lines = formatReportText(raw)
  const conclusion = conclusionPreview(lines)
  if (conclusion) return conclusion

  const start = skipPreamble(lines)
  if (start === 0) return null
  const text = joinLines(lines.slice(start))
  return text ? { text } : null
}
