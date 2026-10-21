// 帶回病歷 — 我的格式: a clinician-built plain-text template.
//
// The clinician decides every character. A format is a sequence of tokens:
// literal text (slashes, spaces, colons, CJK — kept verbatim), newlines, and
// fields — a lab's name / value / unit / date / flag, or an exam's title /
// date / institution / text. Nothing here adds punctuation, trims, collapses
// whitespace or reorders; "LDL/HDL/TG 101/50/182" comes out exactly as the
// tokens spell it.
//
// Same rules as the built-in formats (see emr-plaintext.ts): no AI, values and
// flags straight from the source, and nothing borrowed silently —
//  * 同一天 (default): every lab on one line is read from ONE collection day,
//    the newest day any of them has. A lab missing that day prints the
//    format's own missing text; an older value is never pulled in to fill it.
//  * 各項最新: each lab its own latest; a line mixing days is reported.
//  * 最近 N 次 (a value or date field's own count): the N collection days that
//    end at the day the line picked, oldest first — "1.2→1.3→1.5".
//  * An exam line whose exam is absent, or whose newest report has no text,
//    is left out and reported — never replaced by an older report unless the
//    clinician chooses that for this patient.
//  * A line where NO lab has any result (a test this patient never had) is
//    left out by default — "NT-proBNP — (—)" is noise in a chart — and
//    reported; the format can choose to print it with the missing text.

import type {
  EmrCustomFormat,
  EmrDateStyle,
  EmrExamKind,
  EmrFormatToken,
} from '@/src/application/stores/outpatient-prefs.store'
import type { PinnedLabPoint, ResolvedPinnedLab } from '@/src/shared/utils/pinned-labs'
import type { EmrExamResolution } from './emr-exam-kinds'

export type EmrExamDecision = 'useOlder' | 'skip'

export interface EmrFormatInputs {
  resolveLab: (id: string) => ResolvedPinnedLab
  /** Short label for a pinned lab id, or null when the id is not a supported
   *  analyte (removed from the catalog, or never was one). */
  labLabel: (id: string) => string | null
  exams: Record<EmrExamKind, EmrExamResolution>
  examDecisions?: Partial<Record<EmrExamKind, EmrExamDecision>>
  now?: Date
  /** Printed after a value whose source gave no unit, inside a series that
   *  mixes units — in the UI language. */
  unknownUnitLabel?: string
}

const DEFAULT_UNKNOWN_UNIT_LABEL = '(unit not given)'

export type EmrFormatNote =
  | { type: 'labMissing'; line: number; lab: string; day: string; lastDate?: string; lastValue?: string }
  | { type: 'labNoResult'; line: number; lab: string }
  | { type: 'labSameDayMany'; line: number; lab: string; date: string; count: number; value: string }
  | { type: 'labFewer'; line: number; lab: string; wanted: number; got: number }
  | { type: 'labSeriesUnits'; line: number; lab: string; units: string[] }
  | { type: 'mixedDates'; line: number; labs: Array<{ lab: string; date?: string }> }
  | { type: 'labUnknown'; line: number; lab: string }
  | { type: 'examMissing'; line: number; exam: EmrExamKind; newerWithoutTextDate?: string }
  | { type: 'examPending'; line: number; exam: EmrExamKind; newerDate: string; olderDate: string }
  | { type: 'examSkipped'; line: number; exam: EmrExamKind; newerDate: string }
  | { type: 'examUsedOlder'; line: number; exam: EmrExamKind; newerDate: string; olderDate: string }
  | { type: 'examSameDay'; line: number; exam: EmrExamKind; date: string; count: number }
  | { type: 'examUnfinished'; line: number; exam: EmrExamKind; status: string }
  | { type: 'lineEmpty'; line: number; labs: string[] }
  | { type: 'examNoConclusion'; line: number; exam: EmrExamKind }

export interface EmrRenderedLine {
  /** 1-based line number in the format (newline tokens split lines). */
  line: number
  text: string
  /** False when the line was left out of the copy (see notes). */
  included: boolean
}

export interface EmrFormatResult {
  /** Exactly what is copied: included lines joined with "\n". */
  text: string
  lines: EmrRenderedLine[]
  notes: EmrFormatNote[]
}

export function formatEmrDate(iso: string, style: EmrDateStyle, now: Date = new Date()): string {
  const y = iso.slice(0, 4)
  const m = iso.slice(5, 7)
  const d = iso.slice(8, 10)
  if (!y || !m || !d) return iso
  if (style === 'ymd') return `${y}/${m}/${d}`
  if (style === 'roc') return `${Number(y) - 1911}/${m}/${d}`
  // Month/day only inside the current year: "11/02" next to "09/18" would read
  // as this November, and a line that ages a result by a year is a clinical
  // error, not a formatting one.
  return y === String(now.getFullYear()) ? `${m}/${d}` : `${y}/${m}/${d}`
}

/** Between the values of a 最近 N 次 field, oldest → newest. */
const SERIES_JOIN = '→'

function flagText(point: PinnedLabPoint): string {
  if (!point.cell.isAbnormal) return ''
  const code = point.cell.interpretationCode
  return code && code !== 'N' ? code : 'A'
}

/**
 * 結論段: the report's own Conclusion / Impression section, from its heading
 * line to the end of the report, verbatim. Echo reports run 30–120+ lines and
 * the finding a clinician quotes sits under that heading; the letterhead and
 * measurement tables above it are what makes a full paste unusable.
 *
 * Only an explicit heading at the start of a line counts. "Interpretation" and
 * "Summary" are NOT used: in real reports they head measurement blocks as
 * often as findings. No heading → null, and the caller pastes the full text
 * and says so.
 */
const CONCLUSION_HEADING = /^\s*(conclusions?|impressions?|結論|印象)\s*(?:[:：]|$|\s)/i

export function extractReportConclusion(body: string): string | null {
  const lines = body.split('\n')
  const start = lines.findIndex((line) => CONCLUSION_HEADING.test(line))
  if (start < 0) return null
  const section = lines.slice(start).join('\n').trim()
  return section || null
}

function splitLines(tokens: EmrFormatToken[]): EmrFormatToken[][] {
  const lines: EmrFormatToken[][] = [[]]
  for (const token of tokens) {
    if (token.kind === 'newline') lines.push([])
    else lines[lines.length - 1].push(token)
  }
  return lines
}

export function renderEmrCustomFormat(format: EmrCustomFormat, inputs: EmrFormatInputs): EmrFormatResult {
  const now = inputs.now ?? new Date()
  const notes: EmrFormatNote[] = []
  const lines: EmrRenderedLine[] = []

  splitLines(format.tokens).forEach((tokens, index) => {
    const lineNo = index + 1

    // ── Labs on this line ────────────────────────────────────────────────
    const labIds: string[] = []
    for (const token of tokens) {
      if (token.kind === 'lab' && !labIds.includes(token.lab)) labIds.push(token.lab)
    }
    const resolved = new Map<string, ResolvedPinnedLab>()
    for (const id of labIds) {
      if (inputs.labLabel(id) === null) {
        notes.push({ type: 'labUnknown', line: lineNo, lab: id })
        continue
      }
      resolved.set(id, inputs.resolveLab(id))
    }
    const picked = new Map<string, PinnedLabPoint | null>()
    if (format.labRule === 'sameDay') {
      const day = [...resolved.values()].reduce(
        (max, lab) => (lab.latest && lab.latest.date > max ? lab.latest.date : max),
        '',
      )
      for (const [id, lab] of resolved) {
        if (!lab.latest) {
          picked.set(id, null)
          notes.push({ type: 'labNoResult', line: lineNo, lab: id })
          continue
        }
        const point = lab.points.find((p) => p.date === day) ?? null
        picked.set(id, point)
        if (!point) {
          notes.push({
            type: 'labMissing', line: lineNo, lab: id, day,
            lastDate: lab.latest.date, lastValue: lab.latest.value,
          })
        }
      }
    } else {
      for (const [id, lab] of resolved) {
        picked.set(id, lab.latest ?? null)
        if (!lab.latest) notes.push({ type: 'labNoResult', line: lineNo, lab: id })
      }
      const days = new Set([...picked.values()].filter(Boolean).map((p) => p!.date))
      if (days.size > 1) {
        notes.push({
          type: 'mixedDates',
          line: lineNo,
          labs: [...picked.entries()].map(([lab, p]) => ({ lab, date: p?.date })),
        })
      }
    }
    // Nothing on this line has ever been resulted for this patient.
    const knownLabs = [...resolved.keys()]
    // An unsupported id is a format error to fix, never a quiet omission.
    const lineEmpty = knownLabs.length > 0
      && knownLabs.length === labIds.length
      && knownLabs.every((id) => !resolved.get(id)?.latest)
      && !tokens.some((token) => token.kind === 'exam')
    if (lineEmpty && format.emptyLines === 'omit') {
      for (let i = notes.length - 1; i >= 0; i -= 1) {
        const note = notes[i]
        if (note.line === lineNo && note.type === 'labNoResult') notes.splice(i, 1)
      }
      notes.push({ type: 'lineEmpty', line: lineNo, labs: knownLabs })
    }

    for (const [id, point] of picked) {
      if (point && point.sameDayCount > 1) {
        notes.push({ type: 'labSameDayMany', line: lineNo, lab: id, date: point.date, count: point.sameDayCount, value: point.value })
      }
    }

    // ── Exams on this line ───────────────────────────────────────────────
    let included = !(lineEmpty && format.emptyLines === 'omit')
    const examItems = new Map<EmrExamKind, EmrExamResolution['latest']>()
    const examKinds: EmrExamKind[] = []
    for (const token of tokens) {
      if (token.kind === 'exam' && !examKinds.includes(token.exam)) examKinds.push(token.exam)
    }
    for (const kind of examKinds) {
      const exam = inputs.exams[kind]
      const decision = inputs.examDecisions?.[kind]
      if (!exam || exam.latest.length === 0) {
        included = false
        notes.push({ type: 'examMissing', line: lineNo, exam: kind, newerWithoutTextDate: exam?.newerWithoutText?.date })
        continue
      }
      const olderDate = exam.latest[0].date
      if (exam.newerWithoutText) {
        const newerDate = exam.newerWithoutText.date
        if (decision === 'useOlder') {
          notes.push({ type: 'examUsedOlder', line: lineNo, exam: kind, newerDate, olderDate })
        } else if (decision === 'skip') {
          included = false
          notes.push({ type: 'examSkipped', line: lineNo, exam: kind, newerDate })
          continue
        } else {
          included = false
          notes.push({ type: 'examPending', line: lineNo, exam: kind, newerDate, olderDate })
          continue
        }
      }
      examItems.set(kind, exam.latest)
      if (exam.latest.length > 1) {
        notes.push({ type: 'examSameDay', line: lineNo, exam: kind, date: olderDate, count: exam.latest.length })
      }
      if (exam.unfinishedStatus) {
        notes.push({ type: 'examUnfinished', line: lineNo, exam: kind, status: exam.unfinishedStatus })
      }
    }

    // ── Spell the line out ───────────────────────────────────────────────
    // 最近 N 次: the N collection days ending at the day this line picked,
    // oldest first. Fewer on record prints what there is and says so.
    const seriesOf = (id: string, point: PinnedLabPoint, count: number): PinnedLabPoint[] => {
      const all = resolved.get(id)?.points ?? [point]
      const start = all.findIndex((p) => p.date === point.date)
      const series = (start < 0 ? [point] : all.slice(start, start + count)).reverse()
      if (series.length < count && !notes.some((n) => n.type === 'labFewer' && n.line === lineNo && n.lab === id)) {
        notes.push({ type: 'labFewer', line: lineNo, lab: id, wanted: count, got: series.length })
      }
      return series
    }
    // A series that crosses units ("88.4 umol/L" then "1 mg/dL", often two
    // hospitals) is never converted and never printed as if it were one
    // unit: EVERY value carries its own unit, and the line says so. A value
    // whose source gave no unit says so too — left bare, "88.4→1 mg/dL" reads
    // as 88.4 mg/dL. The one exception avoids "1 mg/dL mg/dL": when this
    // lab's unit field follows the series directly AND the newest value has
    // a unit, that field prints it.
    const seriesValues = (id: string, point: PinnedLabPoint, count: number, unitFieldFollows: boolean): string => {
      const series = seriesOf(id, point, count)
      const unitOf = (p: PinnedLabPoint) => (p.cell.unit ?? '').trim()
      const unitKey = (p: PinnedLabPoint) => unitOf(p).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
      const mixed = new Set(series.map(unitKey)).size > 1
      if (!mixed) return series.map((p) => p.value).join(SERIES_JOIN)
      if (!notes.some((n) => n.type === 'labSeriesUnits' && n.line === lineNo && n.lab === id)) {
        const units = [...new Set(series.map((p) => unitOf(p) || '—'))]
        notes.push({ type: 'labSeriesUnits', line: lineNo, lab: id, units })
      }
      const newestIndex = series.length - 1
      const unknownUnit = inputs.unknownUnitLabel ?? DEFAULT_UNKNOWN_UNIT_LABEL
      return series
        .map((p, index) => {
          const unit = unitOf(p)
          if (!unit) return `${p.value} ${unknownUnit}`
          const unitSuppliedAfter = index === newestIndex && unitFieldFollows
          return unitSuppliedAfter ? p.value : `${p.value} ${unit}`
        })
        .join(SERIES_JOIN)
    }
    // Does this lab's unit field come right after token `index` (only
    // whitespace text between)?
    const unitFieldFollows = (index: number, lab: string): boolean => {
      for (let next = index + 1; next < tokens.length; next += 1) {
        const token = tokens[next]!
        if (token.kind === 'text' && !token.text.trim()) continue
        return token.kind === 'lab' && token.lab === lab && token.field === 'unit'
      }
      return false
    }
    let text = ''
    for (const [index, token] of tokens.entries()) {
      if (token.kind === 'text') {
        text += token.text
        continue
      }
      if (token.kind === 'lab') {
        const label = inputs.labLabel(token.lab)
        const point = picked.get(token.lab) ?? null
        if (token.field === 'name') {
          text += label ?? token.lab
        } else if (!point) {
          text += token.field === 'value' || token.field === 'date' ? format.missingText : ''
        } else if (token.field === 'value') {
          text += token.count
            ? seriesValues(token.lab, point, token.count, unitFieldFollows(index, token.lab))
            : point.value
        } else if (token.field === 'unit') {
          text += point.cell.unit ?? ''
        } else if (token.field === 'date') {
          text += token.count
            ? seriesOf(token.lab, point, token.count).map((p) => formatEmrDate(p.date, format.dateStyle, now)).join(SERIES_JOIN)
            : formatEmrDate(point.date, format.dateStyle, now)
        } else if (token.field === 'flag') {
          text += flagText(point)
        }
        continue
      }
      if (token.kind === 'exam') {
        const items = examItems.get(token.exam)
        if (!items || !items.length) continue
        if (token.field === 'title') text += items.map((item) => item.name).join(' + ')
        else if (token.field === 'date') text += formatEmrDate(items[0].date, format.dateStyle, now)
        else if (token.field === 'org') text += [...new Set(items.map((item) => item.org).filter(Boolean))].join('、')
        else if (token.field === 'text') text += items.map((item) => item.body).join('\n')
        else if (token.field === 'conclusion') {
          const parts = items.map((item) => extractReportConclusion(item.body))
          if (parts.some((part) => part === null) && !notes.some((n) => n.type === 'examNoConclusion' && n.line === lineNo && n.exam === token.exam)) {
            notes.push({ type: 'examNoConclusion', line: lineNo, exam: token.exam })
          }
          text += items.map((item, index) => parts[index] ?? item.body).join('\n')
        }
      }
    }
    lines.push({ line: lineNo, text, included })
  })

  return {
    text: lines.filter((line) => line.included).map((line) => line.text).join('\n'),
    lines,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Editing: a format as a flat list of units, one per character or field, so a
// caret can sit between any two of them.
// ---------------------------------------------------------------------------

export type EmrEditUnit =
  | { kind: 'char'; ch: string }
  | { kind: 'newline' }
  | Extract<EmrFormatToken, { kind: 'lab' }>
  | Extract<EmrFormatToken, { kind: 'exam' }>

export function textToUnits(text: string): EmrEditUnit[] {
  const units: EmrEditUnit[] = []
  for (const ch of Array.from(text.replace(/\r\n?/g, '\n'))) {
    units.push(ch === '\n' ? { kind: 'newline' } : { kind: 'char', ch })
  }
  return units
}

export function tokensToUnits(tokens: EmrFormatToken[]): EmrEditUnit[] {
  const units: EmrEditUnit[] = []
  for (const token of tokens) {
    if (token.kind === 'text') units.push(...textToUnits(token.text))
    else units.push(token)
  }
  return units
}

export function unitsToTokens(units: EmrEditUnit[]): EmrFormatToken[] {
  const tokens: EmrFormatToken[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) tokens.push({ kind: 'text', text: buffer })
    buffer = ''
  }
  for (const unit of units) {
    if (unit.kind === 'char') {
      buffer += unit.ch
      continue
    }
    flush()
    tokens.push(unit)
  }
  flush()
  return tokens
}

// ---------------------------------------------------------------------------
// Starting points. Every one is fully editable once loaded.
// ---------------------------------------------------------------------------

export type EmrStarterId = 'lipid' | 'pinnedPerLine' | 'exams' | 'blank'

const t = (text: string): EmrFormatToken => ({ kind: 'text', text })
const nl: EmrFormatToken = { kind: 'newline' }
const lab = (id: string, field: Extract<EmrFormatToken, { kind: 'lab' }>['field']): EmrFormatToken => ({ kind: 'lab', lab: id, field })
const exam = (id: EmrExamKind, field: Extract<EmrFormatToken, { kind: 'exam' }>['field']): EmrFormatToken => ({ kind: 'exam', exam: id, field })

export function starterTokens(starter: EmrStarterId, pinnedLabIds: string[]): EmrFormatToken[] {
  switch (starter) {
    case 'lipid':
      return [
        lab('lipid:LDL', 'name'), t('/'), lab('lipid:HDL', 'name'), t('/'), lab('lipid:TG', 'name'), t(' '),
        lab('lipid:LDL', 'value'), t('/'), lab('lipid:HDL', 'value'), t('/'), lab('lipid:TG', 'value'),
      ]
    case 'pinnedPerLine': {
      const out: EmrFormatToken[] = []
      pinnedLabIds.forEach((id, index) => {
        if (index > 0) out.push(nl)
        // No unit field: several sources report none (HbA1c, lipids), and the
        // format prints text verbatim, so an empty unit would leave a double
        // space. Clinicians add 單位 themselves where they want it.
        out.push(lab(id, 'name'), t(' '), lab(id, 'value'), t(' ('), lab(id, 'date'), t(')'))
      })
      return out
    }
    case 'exams':
      return [
        t('Echo ('), exam('echo', 'date'), t('): '), exam('echo', 'conclusion'), nl,
        t('EKG ('), exam('ecg', 'date'), t('): '), exam('ecg', 'text'),
      ]
    default:
      return []
  }
}

export function newEmrFormatId(): string {
  return `fmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function newEmrFormat(name: string, tokens: EmrFormatToken[]): EmrCustomFormat {
  return { id: newEmrFormatId(), name, tokens, labRule: 'sameDay', missingText: '—', dateStyle: 'md', emptyLines: 'omit' }
}
