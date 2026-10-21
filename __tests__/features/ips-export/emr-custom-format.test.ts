// 帶回病歷 — 我的格式. The clinician spells every character; these tests lock
// down that the renderer adds nothing, borrows nothing and drops nothing
// silently.
import {
  extractReportConclusion,
  formatEmrDate,
  renderEmrCustomFormat,
  starterTokens,
  tokensToUnits,
  unitsToTokens,
  type EmrFormatInputs,
} from '@/features/ips-export/utils/emr-custom-format'
import { resolveLatestExams } from '@/features/ips-export/utils/emr-exam-kinds'
import type { EmrCustomFormat, EmrFormatToken } from '@/src/application/stores/outpatient-prefs.store'
import { buildLabPivots } from '@/src/shared/utils/lab-pivot.utils'
import { findPinnableLab, resolvePinnedLab } from '@/src/shared/utils/pinned-labs'

const NOW = new Date(2026, 8, 25) // 2026-09-25 local

function obs(code: string, date: string, value: number, opts: { unit?: string; interpretation?: string } = {}) {
  return {
    resourceType: 'Observation',
    code: { text: code },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    valueQuantity: { value, unit: opts.unit },
    ...(opts.interpretation ? { interpretation: [{ coding: [{ code: opts.interpretation }] }] } : {}),
  }
}

const LIPIDS = [
  obs('LDL', '2026-09-18', 101, { unit: 'mg/dL', interpretation: 'H' }),
  obs('HDL', '2026-09-18', 50, { unit: 'mg/dL' }),
  obs('TG', '2026-09-18', 182, { unit: 'mg/dL', interpretation: 'H' }),
  obs('LDL', '2026-03-12', 88, { unit: 'mg/dL' }),
  obs('HDL', '2026-03-12', 48, { unit: 'mg/dL' }),
  obs('TG', '2026-03-12', 150, { unit: 'mg/dL' }),
]

function inputs(observations: any[], diagnosticReports: any[] = [], extra: Partial<EmrFormatInputs> = {}): EmrFormatInputs {
  const pivots = buildLabPivots(observations)
  return {
    resolveLab: (id) => resolvePinnedLab(pivots, id),
    labLabel: (id) => findPinnableLab(id)?.short ?? null,
    exams: resolveLatestExams(diagnosticReports),
    now: NOW,
    ...extra,
  }
}

function format(tokens: EmrFormatToken[], overrides: Partial<EmrCustomFormat> = {}): EmrCustomFormat {
  return { id: 'f1', name: 'test', tokens, labRule: 'sameDay', missingText: '—', dateStyle: 'md', emptyLines: 'omit', ...overrides }
}

const t = (text: string): EmrFormatToken => ({ kind: 'text', text })
const lab = (id: string, field: 'name' | 'value' | 'unit' | 'date' | 'flag'): EmrFormatToken => ({ kind: 'lab', lab: id, field })
const nl: EmrFormatToken = { kind: 'newline' }

describe('renderEmrCustomFormat — labs', () => {
  it('spells the user example exactly', () => {
    const result = renderEmrCustomFormat(format(starterTokens('lipid', [])), inputs(LIPIDS))
    expect(result.text).toBe('LDL/HDL/TG 101/50/182')
    expect(result.notes).toEqual([])
  })

  it('keeps every literal character: spaces, CJK, brackets, blank lines', () => {
    const tokens = [
      t('【血脂】  '), lab('lipid:LDL', 'value'), t(' ( '), lab('lipid:LDL', 'unit'), t(' )  '), nl, nl,
      t('  尾巴 '),
    ]
    const result = renderEmrCustomFormat(format(tokens), inputs(LIPIDS))
    expect(result.text).toBe('【血脂】  101 ( mg/dL )  \n\n  尾巴 ')
  })

  it('prints a same-day value with its own unit, comparator and flag — never another record\'s (PR #170 review)', () => {
    const sameDay = [
      { ...obs('K', '2026-09-18', 9.9, { unit: 'mmol/L', interpretation: 'H' }), status: 'entered-in-error' },
      { ...obs('K', '2026-09-18', 4.4, { unit: 'mmol/L' }), status: 'final' },
    ]
    const tokens = [lab('chem:K', 'value'), t(' '), lab('chem:K', 'unit'), t(' '), lab('chem:K', 'flag')]
    // The entered-in-error 9.9 H is gone before anything is picked.
    expect(renderEmrCustomFormat(format(tokens), inputs(sameDay)).text).toBe('4.4 mmol/L ')
  })

  it('allows reusing and reordering fields freely', () => {
    const tokens = [
      lab('lipid:TG', 'value'), t(' '), lab('lipid:TG', 'value'), t(' '), lab('lipid:LDL', 'flag'),
      lab('lipid:HDL', 'date'),
    ]
    expect(renderEmrCustomFormat(format(tokens), inputs(LIPIDS)).text).toBe('182 182 H09/18')
  })

  it('never borrows an older value for a line pinned to one day', () => {
    const noHdlToday = LIPIDS.filter((o) => !(o.code.text === 'HDL' && o.effectiveDateTime.startsWith('2026-09-18')))
    const result = renderEmrCustomFormat(format(starterTokens('lipid', [])), inputs(noHdlToday))
    expect(result.text).toBe('LDL/HDL/TG 101/—/182')
    expect(result.notes).toEqual([
      { type: 'labMissing', line: 1, lab: 'lipid:HDL', day: '2026-09-18', lastDate: '2026-03-12', lastValue: '48' },
    ])
  })

  it('prints the format’s own missing text', () => {
    const noHdlToday = LIPIDS.filter((o) => !(o.code.text === 'HDL' && o.effectiveDateTime.startsWith('2026-09-18')))
    const result = renderEmrCustomFormat(format(starterTokens('lipid', []), { missingText: '未驗' }), inputs(noHdlToday))
    expect(result.text).toBe('LDL/HDL/TG 101/未驗/182')
  })

  it('each-latest mode takes each value from its own day and reports the mix', () => {
    const noHdlToday = LIPIDS.filter((o) => !(o.code.text === 'HDL' && o.effectiveDateTime.startsWith('2026-09-18')))
    const tokens = [...starterTokens('lipid', []), t(' HDL@'), lab('lipid:HDL', 'date')]
    const result = renderEmrCustomFormat(format(tokens, { labRule: 'eachLatest' }), inputs(noHdlToday))
    expect(result.text).toBe('LDL/HDL/TG 101/48/182 HDL@03/12')
    expect(result.notes[0]).toMatchObject({ type: 'mixedDates', line: 1 })
  })

  it('treats each line as its own day', () => {
    const observations = [...LIPIDS, obs('HBA1C', '2026-06-30', 7.2, { unit: '%', interpretation: 'H' })]
    const tokens = [
      ...starterTokens('lipid', []), nl,
      t('HbA1c '), lab('glucose:HBA1C', 'value'), t('% ('), lab('glucose:HBA1C', 'date'), t(')'),
    ]
    expect(renderEmrCustomFormat(format(tokens), inputs(observations)).text)
      .toBe('LDL/HDL/TG 101/50/182\nHbA1c 7.2% (06/30)')
  })

  it('leaves out a line whose labs were never resulted, and says so', () => {
    const tokens = [...starterTokens('lipid', []), nl, t('Lp(a) '), lab('lipid:LP(A)', 'value'), nl, t('end')]
    const result = renderEmrCustomFormat(format(tokens), inputs(LIPIDS))
    expect(result.text).toBe('LDL/HDL/TG 101/50/182\nend')
    expect(result.notes).toEqual([{ type: 'lineEmpty', line: 2, labs: ['lipid:LP(A)'] }])
  })

  it('can print a never-resulted line with the missing text instead', () => {
    const tokens = [t('Lp(a) '), lab('lipid:LP(A)', 'value')]
    const result = renderEmrCustomFormat(format(tokens, { emptyLines: 'show' }), inputs(LIPIDS))
    expect(result.text).toBe('Lp(a) —')
    expect(result.notes).toEqual([{ type: 'labNoResult', line: 1, lab: 'lipid:LP(A)' }])
  })

  it('keeps a line where only some labs are missing', () => {
    const noHdl = LIPIDS.filter((o) => o.code.text !== 'HDL')
    const result = renderEmrCustomFormat(format(starterTokens('lipid', [])), inputs(noHdl))
    expect(result.text).toBe('LDL/HDL/TG 101/—/182')
  })

  it('flags an id the catalog no longer supports', () => {
    const result = renderEmrCustomFormat(format([lab('chem:NOPE', 'value')]), inputs(LIPIDS))
    expect(result.text).toBe('—')
    expect(result.notes).toEqual([{ type: 'labUnknown', line: 1, lab: 'chem:NOPE' }])
  })
})

describe('formatEmrDate', () => {
  it('adds the year outside the current year and supports ROC years', () => {
    expect(formatEmrDate('2026-09-18', 'md', NOW)).toBe('09/18')
    expect(formatEmrDate('2025-11-02', 'md', NOW)).toBe('2025/11/02')
    expect(formatEmrDate('2026-09-18', 'ymd', NOW)).toBe('2026/09/18')
    expect(formatEmrDate('2026-09-18', 'roc', NOW)).toBe('115/09/18')
  })
})

function report(code: string, title: string, date: string, text?: string, extra: Record<string, unknown> = {}) {
  return {
    resourceType: 'DiagnosticReport',
    id: `${code}-${date}-${title}`.replace(/\s+/g, ''),
    status: 'final',
    code: { coding: [{ system: 'https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medical-treatment-nhi-tw', code }], text: title },
    effectiveDateTime: `${date}T10:00:00+08:00`,
    ...(text ? { conclusion: text } : {}),
    ...extra,
  }
}

describe('renderEmrCustomFormat — exams', () => {
  const ECHO = report('18005C', 'Echocardiography', '2026-03-12', 'LVEF 45% by M-mode. Mild MR.')
  const ECG = report('18001C', 'ECG', '2026-09-18', 'Sinus rhythm, 72 bpm.')
  const CXR = report('32001C', 'Chest PA', '2026-09-20', 'No active lung lesion. ECG leads noted.')
  const tokens = starterTokens('exams', [])

  it('takes the latest of each kind independently', () => {
    const result = renderEmrCustomFormat(format(tokens), inputs([], [ECHO, ECG, CXR]))
    expect(result.text).toBe('Echo (03/12): LVEF 45% by M-mode. Mild MR.\nEKG (09/18): Sinus rhythm, 72 bpm.')
  })

  it('leaves a line out when that exam is absent, and says so', () => {
    const result = renderEmrCustomFormat(format(tokens), inputs([], [ECG]))
    expect(result.text).toBe('EKG (09/18): Sinus rhythm, 72 bpm.')
    expect(result.notes).toEqual([{ type: 'examMissing', line: 1, exam: 'echo', newerWithoutTextDate: undefined }])
  })

  it('does not fall back silently when the newest report has no text', () => {
    const imageOnly = report('18001C', 'ECG', '2026-09-25')
    const pending = renderEmrCustomFormat(format(tokens), inputs([], [ECHO, ECG, imageOnly]))
    expect(pending.text).toBe('Echo (03/12): LVEF 45% by M-mode. Mild MR.')
    expect(pending.notes).toContainEqual({ type: 'examPending', line: 2, exam: 'ecg', newerDate: '2026-09-25', olderDate: '2026-09-18' })

    const older = renderEmrCustomFormat(format(tokens), inputs([], [ECHO, ECG, imageOnly], { examDecisions: { ecg: 'useOlder' } }))
    expect(older.text).toBe('Echo (03/12): LVEF 45% by M-mode. Mild MR.\nEKG (09/18): Sinus rhythm, 72 bpm.')

    const skipped = renderEmrCustomFormat(format(tokens), inputs([], [ECHO, ECG, imageOnly], { examDecisions: { ecg: 'skip' } }))
    expect(skipped.text).toBe('Echo (03/12): LVEF 45% by M-mode. Mild MR.')
    expect(skipped.notes).toContainEqual({ type: 'examSkipped', line: 2, exam: 'ecg', newerDate: '2026-09-25' })
  })
})

describe('extractReportConclusion', () => {
  it('cuts from an explicit Conclusion / Impression heading to the end, verbatim', () => {
    const body = ['HOSPITAL HEADER', 'LVEDD 50 mm', 'EF 60 %', 'Conclusion:', '1. Normal LV systolic function.', '2. Mild MR.'].join('\n')
    expect(extractReportConclusion(body)).toBe('Conclusion:\n1. Normal LV systolic function.\n2. Mild MR.')
    expect(extractReportConclusion('x\nImpression: LVH\ny')).toBe('Impression: LVH\ny')
    expect(extractReportConclusion('x\n結論：左心室肥厚')).toBe('結論：左心室肥厚')
  })

  it('does not treat Interpretation, Summary or a mid-sentence word as the heading', () => {
    expect(extractReportConclusion('Interpretation\nLVEDD 50 mm')).toBeNull()
    expect(extractReportConclusion('Measurement Summary:\nEF 60')).toBeNull()
    expect(extractReportConclusion('No conclusion can be drawn')).toBeNull()
  })

  it('pastes the full text and says so when a report has no conclusion section', () => {
    const echo = report('18005C', 'Echocardiography', '2026-03-12', 'LVEF 45% by M-mode. Mild MR.')
    const tokens: EmrFormatToken[] = [t('Echo: '), { kind: 'exam', exam: 'echo', field: 'conclusion' }]
    const result = renderEmrCustomFormat(format(tokens), inputs([], [echo]))
    expect(result.text).toBe('Echo: LVEF 45% by M-mode. Mild MR.')
    expect(result.notes).toEqual([{ type: 'examNoConclusion', line: 1, exam: 'echo' }])
  })
})

describe('edit units', () => {
  it('round-trips tokens through per-character units', () => {
    const tokens: EmrFormatToken[] = [t('A /'), lab('lipid:LDL', 'value'), nl, t('中文 '), { kind: 'exam', exam: 'echo', field: 'text' }]
    const units = tokensToUnits(tokens)
    expect(units.filter((u) => u.kind === 'char')).toHaveLength(6)
    expect(unitsToTokens(units)).toEqual(tokens)
  })

  it('turns newlines inside text into newline tokens', () => {
    expect(unitsToTokens(tokensToUnits([t('a\nb')]))).toEqual([t('a'), nl, t('b')])
  })
})

describe('renderEmrCustomFormat — 最近 N 次', () => {
  const CREA = [
    obs('CREA', '2026-03-01', 1.2, { unit: 'mg/dL' }),
    obs('CREA', '2026-05-25', 1.3, { unit: 'mg/dL' }),
    obs('CREA', '2026-06-02', 1.5, { unit: 'mg/dL', interpretation: 'H' }),
    obs('CREA', '2025-12-01', 1.1, { unit: 'mg/dL' }),
  ]
  const series = (id: string, field: 'value' | 'date', count: number): EmrFormatToken => ({ kind: 'lab', lab: id, field, count })

  it('prints the last N values oldest first, with the latest date', () => {
    const tokens = [lab('chem:CREA', 'name'), t(' '), series('chem:CREA', 'value', 3), t(' ('), lab('chem:CREA', 'date'), t(')')]
    const result = renderEmrCustomFormat(format(tokens), inputs(CREA))
    expect(result.text).toBe('CREA 1.2→1.3→1.5 (06/02)')
    expect(result.notes).toEqual([])
  })

  it('can print the matching dates as a series too', () => {
    const result = renderEmrCustomFormat(format([series('chem:CREA', 'date', 2)]), inputs(CREA))
    expect(result.text).toBe('05/25→06/02')
  })

  it('follows the line rule for the day the series ends on', () => {
    const withK = [...CREA, obs('K', '2026-05-25', 4.1, { unit: 'mmol/L' })]
    const tokens = [series('chem:CREA', 'value', 2), t(' / '), lab('chem:K', 'value')]
    // 同一天 picks the newest day either has (06/02): K is missing there.
    expect(renderEmrCustomFormat(format(tokens), inputs(withK)).text).toBe('1.3→1.5 / —')
    expect(renderEmrCustomFormat(format(tokens, { labRule: 'eachLatest' }), inputs(withK)).text).toBe('1.3→1.5 / 4.1')
  })

  it('never prints a series as if it were one unit (PR #170 review)', () => {
    const mixed = [
      obs('CREA', '2026-05-25', 88.4, { unit: 'umol/L' }),
      obs('CREA', '2026-06-02', 1, { unit: 'mg/dL' }),
    ]
    const tokens = [series('chem:CREA', 'value', 2), t(' '), lab('chem:CREA', 'unit')]
    const result = renderEmrCustomFormat(format(tokens), inputs(mixed))
    expect(result.text).toBe('88.4 umol/L→1 mg/dL')
    expect(result.notes).toEqual([{ type: 'labSeriesUnits', line: 1, lab: 'chem:CREA', units: ['umol/L', 'mg/dL'] }])
  })

  it('gives every value of a cross-unit series its own unit when no unit field follows (review r2)', () => {
    const mixed = [
      obs('CREA', '2026-05-25', 88.4, { unit: 'umol/L' }),
      obs('CREA', '2026-06-02', 1, { unit: 'mg/dL' }),
    ]
    const inputsMixed = inputs(mixed)
    // Only the series: the newest value must not end up unitless.
    expect(renderEmrCustomFormat(format([series('chem:CREA', 'value', 2)]), inputsMixed).text).toBe('88.4 umol/L→1 mg/dL')
    // A unit field placed BEFORE the series does not stand in for the newest.
    const unitFirst = [t('('), lab('chem:CREA', 'unit'), t(') '), series('chem:CREA', 'value', 2)]
    expect(renderEmrCustomFormat(format(unitFirst), inputsMixed).text).toBe('(mg/dL) 88.4 umol/L→1 mg/dL')
  })

  it('never lets a unitless value borrow another value\'s unit (review r3)', () => {
    const tokens = [series('chem:CREA', 'value', 2), t(' '), lab('chem:CREA', 'unit')]
    // A history value whose source gave no unit, then 1 mg/dL: "88.4→1 mg/dL"
    // would read as 88.4 mg/dL.
    const historyUnitless = inputs([
      obs('CREA', '2026-05-25', 88.4),
      obs('CREA', '2026-06-02', 1, { unit: 'mg/dL' }),
    ])
    expect(renderEmrCustomFormat(format(tokens), historyUnitless).text).toBe('88.4 (unit not given)→1 mg/dL')
    // The newest one unitless: the unit field has nothing to supply.
    const newestUnitless = inputs([
      obs('CREA', '2026-05-25', 88.4, { unit: 'umol/L' }),
      obs('CREA', '2026-06-02', 1),
    ])
    expect(renderEmrCustomFormat(format(tokens), newestUnitless).text).toBe('88.4 umol/L→1 (unit not given) ')
    // The label follows the UI language.
    const zh = { ...historyUnitless, unknownUnitLabel: '（單位未提供）' }
    expect(renderEmrCustomFormat(format(tokens), zh).text).toBe('88.4 （單位未提供）→1 mg/dL')
  })

  it('leaves a same-unit series unlabelled', () => {
    const same = [
      obs('CREA', '2026-05-25', 1.1, { unit: 'mg/dL' }),
      obs('CREA', '2026-06-02', 1.2, { unit: 'mg/dL' }),
    ]
    const result = renderEmrCustomFormat(format([series('chem:CREA', 'value', 2)]), inputs(same))
    expect(result.text).toBe('1.1→1.2')
    expect(result.notes).toEqual([])
  })

  it('prints what there is and says so when fewer results exist', () => {
    const result = renderEmrCustomFormat(format([series('chem:CREA', 'value', 5)]), inputs(CREA))
    expect(result.text).toBe('1.1→1.2→1.3→1.5')
    expect(result.notes).toEqual([{ type: 'labFewer', line: 1, lab: 'chem:CREA', wanted: 5, got: 4 }])
  })
})
