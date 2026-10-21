// Wording for the notes a custom format raises (missing values, mixed days,
// an exam with no text…). Kept in one place so the daily panel and the
// format editor can never describe the same state differently.

import type { EmrDateStyle, EmrExamKind } from '@/src/application/stores/outpatient-prefs.store'
import { formatEmrDate, type EmrFormatNote } from '../utils/emr-custom-format'

export interface EmrNoteStrings {
  examNames: Record<EmrExamKind, string>
  notes: {
    labMissing: string
    labNoResult: string
    labSameDayMany: string
    labFewer: string
    labSeriesUnits: string
    mixedDates: string
    labUnknown: string
    examMissing: string
    examPending: string
    examSkipped: string
    examUsedOlder: string
    examSameDay: string
    examUnfinished: string
    lineEmpty: string
    examNoConclusion: string
  }
}

function fill(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

export function describeEmrNote(
  note: EmrFormatNote,
  strings: EmrNoteStrings,
  labLabel: (id: string) => string,
  dateStyle: EmrDateStyle,
  missingText: string,
  now: Date = new Date(),
): string {
  const date = (iso?: string) => (iso ? formatEmrDate(iso, dateStyle, now) : '')
  const n = strings.notes
  switch (note.type) {
    case 'labMissing':
      return fill(n.labMissing, {
        line: note.line, lab: labLabel(note.lab), day: date(note.day), missing: missingText,
        lastDate: date(note.lastDate), lastValue: note.lastValue,
      })
    case 'labNoResult':
      return fill(n.labNoResult, { line: note.line, lab: labLabel(note.lab) })
    case 'labSameDayMany':
      return fill(n.labSameDayMany, { line: note.line, lab: labLabel(note.lab), date: date(note.date), count: note.count, value: note.value })
    case 'labFewer':
      return fill(n.labFewer, { line: note.line, lab: labLabel(note.lab), wanted: note.wanted, got: note.got })
    case 'labSeriesUnits':
      return fill(n.labSeriesUnits, { line: note.line, lab: labLabel(note.lab), units: note.units.join('、') })
    case 'mixedDates':
      return fill(n.mixedDates, {
        line: note.line,
        items: note.labs.map((entry) => `${labLabel(entry.lab)} ${entry.date ? date(entry.date) : '—'}`).join('、'),
      })
    case 'labUnknown':
      return fill(n.labUnknown, { line: note.line })
    case 'examMissing':
      return fill(n.examMissing, { line: note.line, exam: strings.examNames[note.exam] })
    case 'examPending':
      return fill(n.examPending, { line: note.line, exam: strings.examNames[note.exam], newerDate: date(note.newerDate) })
    case 'examSkipped':
      return fill(n.examSkipped, { line: note.line, exam: strings.examNames[note.exam] })
    case 'examUsedOlder':
      return fill(n.examUsedOlder, {
        line: note.line, exam: strings.examNames[note.exam], olderDate: date(note.olderDate), newerDate: date(note.newerDate),
      })
    case 'examSameDay':
      return fill(n.examSameDay, { line: note.line, exam: strings.examNames[note.exam], date: date(note.date), count: note.count })
    case 'examUnfinished':
      return fill(n.examUnfinished, { line: note.line, exam: strings.examNames[note.exam], status: note.status })
    case 'examNoConclusion':
      return fill(n.examNoConclusion, { line: note.line, exam: strings.examNames[note.exam] })
    case 'lineEmpty':
      return fill(n.lineEmpty, { line: note.line, labs: note.labs.map(labLabel).join('、') })
    default:
      return ''
  }
}
