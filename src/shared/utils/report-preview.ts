import { decodeReportEntities, formatReportText, type ReportLine } from './report-text-format'

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
const PREAMBLE_HEADINGS = new Set([
  'History', 'Comparison', 'Methods', 'Method', 'Technique', 'INDICATION', 'Indications', 'Indication',
  'Premedication', 'Instruments', 'Instrument', 'Chief Complain', 'Medication', 'CLINICAL DIAGNOSIS',
  'RADIOPHARMACEUTICAL', 'NUCLEAR MEDICINE STUDY',
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
const FINDINGS_HEADING_RE = /FINDINGS?$/i

// Conclusion markers the shared parser does not split on, found in the raw
// text: echo "Conclusion ＆ Comments" (no colon), all-caps "IMPRESSION:" /
// "CONCLUSION:" / a "* IMPRESSION *" banner, "SONAR DIAGNOSIS :" and a
// bracketed "【Impression】". Ranked after the parsed first-group headings and
// before the second group.
const RAW_CONCLUSION_RE = /(?<![A-Za-z])(Conclusion\s*[＆&]\s*Comments|IMPRESSIONS?(?=\s*[:：*])|CONCLUSIONS?(?=\s*[:：])|SONAR DIAGNOSIS(?=\s*[:：])|【Impression】)[\s:：*】]*/g
// Chang Gung pathology states its diagnosis as "SNOMED: <code> DX: …". A bare
// "DX:" elsewhere is too loose — "PREOPERATIVE DX:" or a history line would
// pass the pre-test diagnosis off as the result — so only the DX that follows
// a SNOMED code counts, ranked after every other conclusion.
const PATHOLOGY_DX_RE = /SNOMED\s*[:：][^:：\n]*?(?<![A-Za-z])(DX)\s*[:：]\s*/g
// Where a raw-marker section ends when no parsed heading ends it first.
const RAW_SECTION_END_RE = /\s*(?:GROSS D|MICRO D|COMMENTS?|Echo guided procedure)\s*[:：][\s\S]*$/
// "Clinical Impression:" is the referral reason, not the reader's verdict.
const CLINICAL_PREFIX_RE = /Clinical\s*$/i

// Sign-off that follows the report body: reader / operator / supervisor names
// and licence numbers ("操作醫師： DOC1234K 判讀醫師： … 監督醫師：…").
const SIGN_OFF_RE = /\s*(?:操作醫師|判讀醫師|監督醫師|報告醫師|執行醫師|技術員|打字員|Reported by\b|Report DR\b|放診專)[\s\S]*$/

// Taipei VGH reports open with a letterhead and the patient-identity block
// ("正式報告 臺北榮民總醫院心臟內科報告 病患資訊：… 醫囑名稱： E.C.G. (E.K.G) …").
// The report itself starts at the order name; nothing before it is a finding.
// MediCloud may prefix the block with its own field label ("病理診斷 1：正式報告…").
const VGH_LETTERHEAD_RE = /^\s*(?:[^\n:：]{1,12}[:：]\s*)?(?:正式|初步)報告\s/
const ORDER_NAME_FIELD_RE = /醫囑名稱\s*[:：]\s*/

const headingKey = (line: ReportLine) => line.text.replace(/\s*[:：]\s*$/, '')
const isSectionHeading = (line: ReportLine) => line.heading === true && line.level === 0
// "Impression:." — the source's stray punctuation after the colon — and the
// sign-off that would otherwise fill a short preview's second line.
const tidy = (text: string) => text.replace(/^[.。,，;；:：\s]+/, '').replace(SIGN_OFF_RE, '').trim()
// A "." bullet would read as a doubled full stop once items share one line.
const joinLines = (lines: ReportLine[]) => lines
  .filter((line) => !line.separator)
  .map((line) => (line.marker && line.marker !== '.' ? `${line.marker} ${line.text}` : line.text))
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

function headingConclusion(lines: ReportLine[], group: ReadonlySet<string>, withInline: boolean): ReportPreview | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isSectionHeading(line) && group.has(headingKey(line))) {
      if (CLINICAL_PREFIX_RE.test(lines[i - 1]?.text ?? '')) continue
      const text = tidy(joinLines(sectionBody(lines, i)))
      if (text) return { label: headingKey(line), text }
      continue
    }
    const inline = withInline && line.level === 0 && !line.heading ? INLINE_CONCLUSION_RE.exec(line.text) : null
    if (inline) {
      const text = tidy(`${inline[2]} ${joinLines(sectionBody(lines, i))}`)
      if (text) return { label: inline[1], text }
    }
  }
  return null
}

function rawMarkerConclusion(raw: string, marker: RegExp): ReportPreview | null {
  for (const match of raw.matchAll(marker)) {
    if (CLINICAL_PREFIX_RE.test(raw.slice(0, match.index))) continue
    const rest = formatReportText(raw.slice(match.index + match[0].length))
    const text = tidy(joinLines(sectionBody(rest, -1)).replace(RAW_SECTION_END_RE, ''))
    if (text) return { label: match[1].replace(/[【】]/g, ''), text }
  }
  return null
}

function conclusionPreview(lines: ReportLine[], raw: string): ReportPreview | null {
  const [primary, secondary] = CONCLUSION_GROUPS
  return headingConclusion(lines, primary, true)
    ?? rawMarkerConclusion(raw, RAW_CONCLUSION_RE)
    ?? headingConclusion(lines, secondary, false)
    ?? rawMarkerConclusion(raw, PATHOLOGY_DX_RE)
}

function letterheadPreview(raw: string): ReportPreview | null {
  if (!VGH_LETTERHEAD_RE.test(raw)) return null
  const field = ORDER_NAME_FIELD_RE.exec(raw)
  if (!field) return null
  const text = tidy(joinLines(formatReportText(raw.slice(field.index + field[0].length))))
  return text ? { text } : null
}

/**
 * Index of the first line after the preamble, or 0 when the preamble cannot be
 * skipped safely. Only a findings lead-in ("… Show:", inline or on its own
 * line) or a findings heading proves the findings have started; a method/technique section after it
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
  // A findings heading after the preamble ("SCINTIGRAPHIC FINDINGS:") is the
  // same proof a lead-in gives; preview its body.
  if (isSectionHeading(lines[i]) && FINDINGS_HEADING_RE.test(headingKey(lines[i]))) {
    return i + 1 < lines.length && !isSectionHeading(lines[i + 1]) ? i + 1 : 0
  }
  return afterLeadIn ? i : 0
}

/**
 * Pick what a collapsed report card should preview.
 *
 * 1. The report's conclusion section, labelled with the source's own heading.
 * 2. Otherwise, for a Taipei VGH letterhead report, the text from the order
 *    name on — never the patient-identity block.
 * 3. Otherwise the text after any leading method / history / study-name
 *    preamble.
 * 4. Otherwise `null` — the caller keeps showing the report as written.
 *
 * Every preview stops at the reader sign-off.
 */
export function extractReportPreview(raw: string | undefined | null): ReportPreview | null {
  if (!raw || !raw.trim()) return null
  const decoded = decodeReportEntities(raw)
  const lines = formatReportText(raw)
  const conclusion = conclusionPreview(lines, decoded)
  if (conclusion) return conclusion

  const letterhead = letterheadPreview(decoded)
  if (letterhead) return letterhead

  const start = skipPreamble(lines)
  if (start === 0) return null
  const text = tidy(joinLines(lines.slice(start)))
  return text ? { text } : null
}
