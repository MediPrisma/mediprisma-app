// 影像與病理重點 finalize — the model groups findings by organ and states each
// in a line; the app shows a point only when one of its quotes occurs verbatim
// in a cited report, writes every chip from the report, and folds every report
// no shown point cites into the footer. Synthetic fixtures only.
import {
  buildSourceCatalog,
  ensureReportHighlights,
  generateMedicalSummaryUseCase as useCase,
  reportQuoteHasUncertainty,
  reportTextIsHedged,
} from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import {
  normaliseReportOrgan,
  REPORT_ORGAN_LABELS,
  REPORT_ORGANS,
  type MedicalSummaryResult,
  type ReportsModuleDraft,
} from '@/src/core/entities/medical-summary.entity'

const RAD = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]

const CT_TEXT = [
  'Technique: Contrast-enhanced CT of the chest.',
  'Findings: A 12 mm part-solid nodule in the right upper lobe.',
  'No definite evidence of mediastinal lymphadenopathy.',
  'Impression:',
  'Suspect primary lung cancer, cT1bN0. Suggest   tissue proof.',
].join('\n')
const PATH_TEXT = '病理診斷：大腸，乙狀結腸，切片：管狀腺瘤，低度分化不良。'
const XRAY_TEXT = 'Suspicious for bronchiectasis over bilateral lower lung field. Cardiomegaly.'
const XRAY_OLD_TEXT = '報告人：測試醫師\nThe heart size is normal. Both lungs are clear.'
const US_TEXT = 'Sonar Diagnosis: Fatty liver.'

const report = (id: string, date: string, title: string, conclusion: string) => ({
  id,
  status: 'final',
  category: RAD,
  code: { text: title },
  effectiveDateTime: `${date}T09:00:00+08:00`,
  conclusion,
  performer: [{ display: '示範測試醫院' }],
})

const clinicalData = {
  diagnosticReports: [
    report('ct-1', '2026-06-24', '電腦斷層造影', CT_TEXT),
    report('path-1', '2026-05-02', '病理組織檢查', PATH_TEXT),
    report('xr-1', '2026-03-10', 'Chest X-ray', XRAY_TEXT),
    report('xr-0', '2025-01-10', 'Chest X-ray', XRAY_OLD_TEXT),
    report('us-1', '2026-02-05', 'Abdominal ultrasound', US_TEXT),
  ],
} as any
const catalog = buildSourceCatalog(clinicalData)
const keyOf = (resourceId: string) => catalog.find((entry) => entry.resourceId === resourceId)!.key
const CT = keyOf('ct-1')
const PATH = keyOf('path-1')
const XR = keyOf('xr-1')
const XR_OLD = keyOf('xr-0')
const US = keyOf('us-1')

const finalize = (
  reports: ReportsModuleDraft | undefined,
  options: { locale?: 'en' | 'zh-TW' } = {},
) => useCase.finalizeResult(
  { ...useCase.createEmptyAiResult(), ...(reports ? { reports } : {}) },
  catalog,
  { clinicalData, audience: 'medical', locale: options.locale ?? 'zh-TW' },
).reportHighlights!

const point = (text: string, sources: string[], quotes: Array<[string, string]>) => ({
  text,
  sources,
  quotes: quotes.map(([source, quote]) => ({ source, quote })),
})
const moduleOf = (groups: Array<{ organ?: string; points: ReturnType<typeof point>[] }>, unremarkable: string[] = []) =>
  ({ groups, unremarkable }) as ReportsModuleDraft

describe('organ enum', () => {
  it('maps every enum value to itself and anything else to other', () => {
    for (const organ of REPORT_ORGANS) expect(normaliseReportOrgan(organ)).toBe(organ)
    expect(normaliseReportOrgan('CHEST-LUNG')).toBe('chest-lung')
    expect(normaliseReportOrgan('lung')).toBe('other')
    expect(normaliseReportOrgan(undefined)).toBe('other')
    expect(normaliseReportOrgan(3)).toBe('other')
  })

  it('labels every organ in both languages', () => {
    expect(REPORT_ORGAN_LABELS['zh-TW']['chest-lung']).toBe('肺部')
    expect(REPORT_ORGAN_LABELS['zh-TW']['abdomen-liver-biliary']).toBe('肝膽')
    expect(REPORT_ORGAN_LABELS['zh-TW']['hematologic-lymph']).toBe('血液淋巴')
    for (const locale of ['zh-TW', 'en'] as const) {
      for (const organ of REPORT_ORGANS) expect(REPORT_ORGAN_LABELS[locale][organ]).toBeTruthy()
    }
  })

  it('groups by normalised organ, merges repeated organs, keeps model order and puts other last', () => {
    const highlights = finalize(moduleOf([
      { organ: 'banana', points: [point('脂肪肝', [US], [[US, 'Fatty liver.']])] },
      { organ: 'chest-lung', points: [point('疑似肺癌 cT1bN0', [CT], [[CT, 'Suspect primary lung cancer, cT1bN0.']])] },
      { organ: 'abdomen-other', points: [point('管狀腺瘤', [PATH], [[PATH, '管狀腺瘤，低度分化不良。']])] },
      { organ: 'chest-lung', points: [point('疑似支氣管擴張', [XR], [[XR, 'Suspicious for bronchiectasis over bilateral lower lung field.']])] },
    ]))
    expect(highlights.groups.map((group) => [group.organ, group.label, group.points.length])).toEqual([
      ['chest-lung', 'Lungs', 2],
      ['abdomen-other', 'Abdomen', 1],
      ['other', 'Other', 1],
    ])
    expect(finalize(moduleOf([
      { organ: 'chest-lung', points: [point('nodule', [CT], [[CT, 'Suspect primary lung cancer, cT1bN0.']])] },
    ]), { locale: 'en' }).groups[0].label).toBe('Lungs')
  })
})

describe('quote verification', () => {
  it('keeps an exact quote, and a whitespace-only difference in the report\'s own spacing', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [point('疑似肺癌，建議切片', [CT], [[CT, 'Suggest tissue proof.'], [CT, 'Suspect primary lung cancer, cT1bN0.']])],
    }]))
    expect(highlights.groups[0].points[0].quotes).toEqual([
      { key: CT, quote: 'Suggest   tissue proof.' },
      { key: CT, quote: 'Suspect primary lung cancer, cT1bN0.' },
    ])
    expect(highlights.droppedQuoteCount).toBe(0)
    expect(highlights.hiddenPointCount).toBe(0)
  })

  it('hides a point none of whose quotes verifies, and counts it', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [
        point('縱膈腔淋巴腫大', [CT], [[CT, 'Mediastinal lymphadenopathy.']]),
        point('沒有引句的重點', [CT], []),
        point('疑似肺癌', [CT], [[CT, 'Suspect primary lung cancer, cT1bN0.']]),
      ],
    }]))
    expect(highlights.groups[0].points.map((shown) => shown.text)).toEqual(['疑似肺癌'])
    expect(highlights.hiddenPointCount).toBe(2)
    expect(highlights.droppedQuoteCount).toBe(1)
    // Kept for a clinician who opens them: the line and the reports it cited.
    expect(highlights.hiddenPoints?.map((hidden) => [hidden.text, hidden.sources.map((source) => source.key)]))
      .toEqual([['縱膈腔淋巴腫大', [CT]], ['沒有引句的重點', [CT]]])
  })

  it('drops a translated or altered quote and keeps the point on its other verified quote', () => {
    const highlights = finalize(moduleOf([
      {
        organ: 'abdomen-other',
        points: [point('管狀腺瘤', [PATH], [[PATH, 'Sigmoid colon biopsy: tubular adenoma, low-grade dysplasia.']])],
      },
      {
        organ: 'chest-lung',
        points: [point('無縱膈腔淋巴腫大', [CT], [
          [CT, 'No evidence of mediastinal lymphadenopathy.'],
          [CT, 'No definite evidence of mediastinal lymphadenopathy.'],
        ])],
      },
    ]))
    expect(highlights.groups.map((group) => group.organ)).toEqual(['chest-lung'])
    expect(highlights.groups[0].points[0].quotes).toEqual([
      { key: CT, quote: 'No definite evidence of mediastinal lymphadenopathy.' },
    ])
    expect(highlights.droppedQuoteCount).toBe(2)
    expect(highlights.hiddenPointCount).toBe(1)
  })

  it('drops a quote filed under a key that names no listed report', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [point('疑似肺癌', ['L999'], [['L999', 'Suspect primary lung cancer, cT1bN0.']])],
    }]))
    expect(highlights.groups).toEqual([])
    expect(highlights.droppedQuoteCount).toBe(1)
    expect(highlights.hiddenPointCount).toBe(1)
  })

  it('treats a verified quote as a citation and ignores cited keys that name no report', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [point('疑似肺癌', ['Z9', `[${XR.toLowerCase()}]`], [[CT, 'Suspect primary lung cancer, cT1bN0.']])],
    }]))
    // The X-ray is cited but never says it: it lends the point no chip.
    expect(highlights.groups[0].points[0].sources.map((source) => source.key)).toEqual([CT])
    expect(highlights.others.map((row) => row.key)).toContain(XR)
  })

  it('a cited report that contradicts the finding never supports it', () => {
    const contradicting = {
      diagnosticReports: [
        report('xr-old', '2026-01-10', 'Chest X-ray', 'Cardiomegaly is noted.'),
        report('xr-new', '2026-06-10', 'Chest X-ray', 'The heart size is normal.'),
      ],
    } as any
    const contradictingCatalog = buildSourceCatalog(contradicting)
    const key = (id: string) => contradictingCatalog.find((entry) => entry.resourceId === id)!.key
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: moduleOf([{
          organ: 'heart',
          points: [point('Cardiomegaly', [key('xr-old'), key('xr-new')], [
            [key('xr-old'), 'Cardiomegaly is noted.'],
            [key('xr-new'), 'Cardiomegaly is noted.'],
          ])],
        }]),
      },
      contradictingCatalog,
      { clinicalData: contradicting, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.groups[0].points[0].sources.map((source) => source.key)).toEqual([key('xr-old')])
    expect(highlights.others.map((row) => row.key)).toEqual([key('xr-new')])
  })

  it('a follow-up report that denies the finding neither verifies its quote nor lends its date', () => {
    const resolved = {
      diagnosticReports: [
        report('xr-eff', '2026-01-10', 'Chest X-ray', 'Left pleural effusion, moderate.'),
        report('xr-dry', '2026-06-10', 'Chest X-ray', 'No pleural effusion. Lungs clear.'),
      ],
    } as any
    const resolvedCatalog = buildSourceCatalog(resolved)
    const key = (id: string) => resolvedCatalog.find((entry) => entry.resourceId === id)!.key
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: moduleOf([{
          organ: 'lung',
          points: [point('Pleural effusion', [key('xr-eff'), key('xr-dry')], [
            [key('xr-eff'), 'pleural effusion'],
            [key('xr-dry'), 'pleural effusion'],
          ])],
        }]),
      },
      resolvedCatalog,
      { clinicalData: resolved, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    const supported = highlights.groups[0].points[0]
    expect(supported.sources.map((source) => source.key)).toEqual([key('xr-eff')])
    expect(supported.quotes.map((quote) => quote.key)).toEqual([key('xr-eff')])
    expect(highlights.others.map((row) => row.key)).toEqual([key('xr-dry')])
  })

  it('a follow-up report repeating the verified words supports the point without its own quote', () => {
    const repeated = {
      diagnosticReports: [
        report('xr-a', '2026-01-10', 'Chest X-ray', 'Impression: Cardiomegaly.'),
        report('xr-b', '2026-06-10', 'Chest X-ray', 'Findings: stable. Impression: Cardiomegaly.'),
      ],
    } as any
    const repeatedCatalog = buildSourceCatalog(repeated)
    const key = (id: string) => repeatedCatalog.find((entry) => entry.resourceId === id)!.key
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: moduleOf([{
          organ: 'heart',
          points: [point('Cardiomegaly', [key('xr-a'), key('xr-b')], [[key('xr-a'), 'Impression: Cardiomegaly.']])],
        }]),
      },
      repeatedCatalog,
      { clinicalData: repeated, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.groups[0].points[0].sources.map((source) => source.key).sort())
      .toEqual([key('xr-a'), key('xr-b')].sort())
  })
})

describe('uncertainty preservation', () => {
  const bronchiectasis = (text: string) => finalize(moduleOf([{
    organ: 'chest-lung',
    points: [point(text, [XR], [[XR, 'Suspicious for bronchiectasis over bilateral lower lung field.']])],
  }]))

  it('shows the quote in place of a line that dropped the report\'s uncertainty', () => {
    const highlights = bronchiectasis('支氣管擴張')
    expect(highlights.groups[0].points[0]).toMatchObject({ text: '支氣管擴張', displayAs: 'quote' })
    expect(highlights.uncertaintyRewriteCount).toBe(1)
  })

  it('shows the line when it keeps the hedge', () => {
    const highlights = bronchiectasis('疑似支氣管擴張')
    expect(highlights.groups[0].points[0].displayAs).toBe('text')
    expect(highlights.uncertaintyRewriteCount).toBe(0)
  })

  it('leaves a point whose quote is certain alone', () => {
    const highlights = finalize(moduleOf([{
      organ: 'heart',
      points: [point('心臟擴大', [XR], [[XR, 'Cardiomegaly.']])],
    }]))
    expect(highlights.groups[0].points[0].displayAs).toBe('text')
  })

  it('recognises the markers and the hedges', () => {
    for (const quote of ['R/O pneumonia', 'rule out PE', 'favor hemangioma', 'suspected mass', 'possibly old',
      'probable scar', 'likely atelectasis', 'cannot be ruled out', 'can not be ruled out', 'nature to be determined',
      'Anteroseptal infarct , age undetermined', 'DDx: abscess', 'differential includes', '疑似肺炎', '待排除肺栓塞',
      '不排除結核', '可能為陳舊性病灶']) {
      expect(reportQuoteHasUncertainty(quote)).toBe(true)
    }
    for (const quote of ['Cardiomegaly.', 'Fatty liver', 'No definite evidence of mass.', 'Pneumothorax is ruled out.']) {
      expect(reportQuoteHasUncertainty(quote)).toBe(false)
    }
    for (const text of ['疑似支氣管擴張', '可能為陳舊性', '不排除結核', '待排除肺栓塞', '待確認', '前中隔梗塞，時間不明',
      '性質未定結節', 'suspected mass', 'possible scar', 'probably benign', 'likely atelectasis', 'cannot exclude PE',
      'age undetermined', 'uncertain significance']) {
      expect(reportTextIsHedged(text)).toBe(true)
    }
    expect(reportTextIsHedged('支氣管擴張')).toBe(false)
    expect(reportTextIsHedged('前中隔梗塞')).toBe(false)
  })
})

describe('chips and footer are the app\'s', () => {
  it('writes each chip from the report, never from the line, newest first', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [point('1999-01-01 外院 PET 顯示疑似肺癌', [XR, CT], [
        [CT, 'Suspect primary lung cancer, cT1bN0.'],
        [XR, 'Cardiomegaly.'],
      ])],
    }]))
    const shown = highlights.groups[0].points[0]
    // The line is shown as written; nothing reads a date out of it.
    expect(shown.text).toBe('1999-01-01 外院 PET 顯示疑似肺癌')
    expect(shown.sources).toEqual([
      {
        key: CT,
        resourceType: 'DiagnosticReport',
        resourceId: 'ct-1',
        kind: 'ct',
        date: '2026-06-24',
        title: catalog.find((entry) => entry.key === CT)!.display,
        organization: '示範測試醫院',
      },
      expect.objectContaining({ key: XR, kind: 'xray', date: '2026-03-10' }),
    ])
  })

  it('folds every report no shown point cites into the footer, unremarkable or not', () => {
    const highlights = finalize(moduleOf(
      [{ organ: 'chest-lung', points: [point('疑似肺癌', [CT], [[CT, 'Suspect primary lung cancer, cT1bN0.']])] }],
      [XR_OLD],
    ))
    expect(highlights.summarized).toBe(true)
    expect(highlights.totalReports).toBe(5)
    // Listed unremarkable, never mentioned, or cited only by a hidden point:
    // all in the footer, newest first.
    expect(highlights.others.map((row) => row.key)).toEqual([PATH, XR, US, XR_OLD])
    expect(highlights.others[0]).toMatchObject({ date: '2026-05-02', kind: 'pathology', organization: '示範測試醫院' })
  })

  it('a report cited only by a hidden point still lands in the footer', () => {
    const highlights = finalize(moduleOf([{
      organ: 'abdomen-other',
      points: [point('管狀腺瘤', [PATH], [[PATH, 'tubular adenoma']])],
    }]))
    expect(highlights.others.map((row) => row.key)).toContain(PATH)
  })

  it('lists every report, the ones past the request budget apart as unreviewed', () => {
    const many = {
      diagnosticReports: Array.from({ length: 33 }, (_, index) => report(
        `xr-${index}`,
        `2025-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
        'Chest X-ray',
        `Impression: Finding number ${index}, stable.`,
      )),
    } as any
    const manyCatalog = buildSourceCatalog(many)
    // A summarized reply (it called the newest report unremarkable).
    const newest = manyCatalog.find((entry) => entry.resourceType === 'DiagnosticReport' && entry.key === 'L1')!.key
    const result = useCase.finalizeResult(
      { ...useCase.createEmptyAiResult(), reports: { groups: [], unremarkable: [newest] } },
      manyCatalog,
      { clinicalData: many, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(result.totalReports).toBe(33)
    expect(result.others).toHaveLength(30)
    expect(result.unreviewed).toHaveLength(3)
    for (const rows of [result.others, result.unreviewed!]) {
      const dates = rows.map((row) => row.date ?? '')
      expect([...dates].sort().reverse()).toEqual(dates)
    }
  })
})

describe('severity stays on its own finding (Codex 2026-10-03, P5 L58)', () => {
  const echo = {
    diagnosticReports: [report('echo-1', '2026-08-04', 'Echocardiography',
      'Conclusion: Severe tricuspid regurgitation. Moderate pulmonary hypertension (RVSP 58 mmHg).')],
  } as any
  const echoCatalog = buildSourceCatalog(echo)
  const ECHO = echoCatalog[0].key
  const shown = (text: string) => useCase.finalizeResult(
    {
      ...useCase.createEmptyAiResult(),
      reports: moduleOf([{ organ: 'heart', points: [point(text, [ECHO], [
        [ECHO, 'Severe tricuspid regurgitation.'],
        [ECHO, 'Moderate pulmonary hypertension (RVSP 58 mmHg).'],
      ])] }]),
    },
    echoCatalog,
    { clinicalData: echo, audience: 'medical', locale: 'zh-TW' },
  ).reportHighlights!.groups[0].points[0]

  it('shows the report\'s own words when the line moves "moderate" onto the regurgitation', () => {
    expect(shown('Moderate tricuspid regurgitation and pulmonary hypertension').displayAs).toBe('quote')
  })

  it('keeps a line that binds each severity to its finding', () => {
    expect(shown('Severe tricuspid regurgitation; moderate pulmonary hypertension').displayAs).toBe('text')
  })

  it('reads a severity written after the valve ("mitral valve with moderate regurgitation")', () => {
    const valves = {
      diagnosticReports: [report('echo-2', '2026-08-04', 'Echocardiography',
        'Findings:\n. Thickened mitral valve with moderate regurgitation.\n. Thickened tricuspid valve with severe regurgitation.')],
    } as any
    const valveCatalog = buildSourceCatalog(valves)
    const KEY = valveCatalog[0].key
    const point_ = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: moduleOf([{ organ: 'heart', points: [point('Moderate mitral regurgitation and severe tricuspid regurgitation', [KEY], [
          [KEY, '. Thickened mitral valve with moderate regurgitation.'],
          [KEY, '. Thickened tricuspid valve with severe regurgitation.'],
        ])] }]),
      },
      valveCatalog,
      { clinicalData: valves, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!.groups[0].points[0]
    expect(point_.displayAs).toBe('text')
    // The stop of the previous sentence is not part of the quote shown.
    expect(point_.quotes[0].quote).toBe('Thickened mitral valve with moderate regurgitation.')
  })
})

describe('a reply that shows nothing', () => {
  it('does not call the reports unremarkable when every point failed verification', () => {
    const highlights = finalize(moduleOf([{
      organ: 'chest-lung',
      points: [point('Suspected lung cancer', [CT], [[CT, 'a quote the report never says']])],
    }]))
    expect(highlights.groups).toEqual([])
    expect(highlights.hiddenPointCount).toBe(1)
    // Presented like an unavailable summary: each report's own conclusion.
    expect(highlights.summarized).toBe(false)
  })

  it('does not call the reports unremarkable when the reply is empty', () => {
    expect(finalize(moduleOf([], [])).summarized).toBe(false)
  })

  it('keeps the unremarkable verdict the model actually gave', () => {
    const highlights = finalize(moduleOf([], [CT, PATH, XR, XR_OLD, US]))
    expect(highlights.summarized).toBe(true)
    expect(highlights.others).toHaveLength(5)
  })
})

describe('without a reports module', () => {
  it('lists every report with its deterministic conclusion or opening', () => {
    const highlights = finalize(undefined)
    expect(highlights.summarized).toBe(false)
    expect(highlights.groups).toEqual([])
    expect(highlights.others).toHaveLength(5)
    const rowOf = (key: string) => highlights.others.find((row) => row.key === key)!
    expect(rowOf(CT)).toMatchObject({
      excerpt: 'Suspect primary lung cancer, cT1bN0. Suggest   tissue proof.',
      excerptSource: 'conclusion',
    })
    expect(rowOf(XR_OLD)).toMatchObject({
      excerpt: 'The heart size is normal. Both lungs are clear.',
      excerptSource: 'opening',
    })
  })

  it('is clinician-only', () => {
    const patient = useCase.finalizeResult(useCase.createEmptyAiResult(), catalog, {
      clinicalData, audience: 'patient', locale: 'zh-TW',
    })
    expect(patient.reportHighlights).toBeUndefined()
  })

  it('gives a result finalized without the scoped data its deterministic rows', () => {
    const first = useCase.finalizeResult(useCase.createEmptyAiResult(), catalog, {
      clinicalData, audience: 'medical', locale: 'zh-TW',
    })
    const { reportHighlights: _omit, ...rest } = first
    const legacy: MedicalSummaryResult = rest
    const presented = ensureReportHighlights(legacy, { clinicalData, catalog, audience: 'medical' })!
    expect(presented.reportHighlights!.summarized).toBe(false)
    expect(presented.reportHighlights!.others).toHaveLength(5)
    expect(ensureReportHighlights(legacy, { clinicalData, catalog, audience: 'patient' })).toBe(legacy)
    expect(ensureReportHighlights(first, { clinicalData, catalog, audience: 'medical' })).toBe(first)
  })
})

describe('影像與病理重點 across card retries', () => {
  const first = useCase.finalizeResult(
    {
      ...useCase.createEmptyAiResult(),
      headline: 'h',
      reports: moduleOf([
        {
          organ: 'chest-lung',
          points: [
            point('疑似肺癌，建議切片', [CT], [[CT, 'Suggest tissue proof.'], [CT, 'No evidence of mediastinal lymphadenopathy.']]),
            point('支氣管擴張', [XR], [[XR, 'Suspicious for bronchiectasis over bilateral lower lung field.']]),
            point('不存在', [CT], [[CT, 'invented sentence here']]),
          ],
        },
      ]),
    },
    catalog,
    { clinicalData, audience: 'medical', locale: 'zh-TW' },
  )

  it('keeps groups, display decisions and every counter when another card is retried', () => {
    const highlights = first.reportHighlights!
    expect(highlights).toMatchObject({ droppedQuoteCount: 2, hiddenPointCount: 1, uncertaintyRewriteCount: 1 })
    expect(highlights.hiddenPoints?.map((hidden) => hidden.text)).toEqual(['不存在'])
    const draft = useCase.createAiDraftFromResult(first)
    const retried = useCase.mergeModuleResult(draft, 'problems', { problems: [] })
    const again = useCase.finalizeResult(retried, catalog, { clinicalData, audience: 'medical', locale: 'zh-TW' })
    expect(again.reportHighlights).toEqual(highlights)
  })

  it('replaces the module and its counters when the reports card itself is retried', () => {
    const draft = useCase.createAiDraftFromResult(first)
    const retried = useCase.mergeModuleResult(draft, 'reports', moduleOf([{
      organ: 'abdomen-other',
      points: [point('管狀腺瘤，低度分化不良', [PATH], [[PATH, '管狀腺瘤，低度分化不良。']])],
    }]))
    const again = useCase.finalizeResult(retried, catalog, { clinicalData, audience: 'medical', locale: 'zh-TW' }).reportHighlights!
    expect(again.groups.map((group) => group.organ)).toEqual(['abdomen-other'])
    expect(again.others.map((row) => row.key)).toContain(CT)
    expect(again).toMatchObject({ droppedQuoteCount: 0, hiddenPointCount: 0, uncertaintyRewriteCount: 0 })
  })

  it('does not round-trip a fallback section as if a module had run', () => {
    const fallback = useCase.finalizeResult(useCase.createEmptyAiResult(), catalog, {
      clinicalData, audience: 'medical', locale: 'zh-TW',
    })
    expect(useCase.createAiDraftFromResult(fallback).reports).toBeUndefined()
  })

  it('leaves the English line and the original quote byte-identical in zh-TW', () => {
    const highlights = finalize(moduleOf([{
      organ: 'abdomen-other',
      points: [point('Tubular adenoma, low-grade dysplasia', [PATH], [[PATH, '管狀腺瘤，低度分化不良。']])],
    }]))
    expect(highlights.groups[0].label).toBe('Abdomen')
    expect(highlights.groups[0].points[0].text).toBe('Tubular adenoma, low-grade dysplasia')
    expect(highlights.groups[0].points[0].quotes[0].quote).toBe('管狀腺瘤，低度分化不良。')
  })
})

describe('reports module parsing', () => {
  it('clamps instead of rejecting: bounds, malformed entries, long lines', () => {
    const parsed = useCase.parseModuleResult('reports', JSON.stringify({
      groups: [
        ...Array.from({ length: 10 }, () => ({
          organ: 'heart',
          points: [
            ...Array.from({ length: 6 }, () => ({
              text: 'x'.repeat(300),
              sources: ['L1'],
              quotes: [{ source: 'L1', quote: 'a' }, { source: 'L1', quote: 'b' }, { source: 'L1', quote: 'c' }, 'bad'],
            })),
            { text: 7 },
          ],
        })),
        'not a group',
      ],
      unremarkable: ['L2', 3, ''],
    }))!
    expect(parsed.groups).toHaveLength(8)
    expect(parsed.groups[0].points).toHaveLength(4)
    expect(parsed.groups[0].points[0].text).toHaveLength(120)
    expect(parsed.groups[0].points[0].quotes).toHaveLength(2)
    expect(parsed.unremarkable).toEqual(['L2'])
  })

  it('salvages the complete points of a reply cut off mid-stream', () => {
    const text = '<<<MEDIPRISMA_MODULE:reports>>>{"groups":[' +
      '{"organ":"chest-lung","points":[{"text":"A","sources":["L1"],"quotes":[{"source":"L1","quote":"q \\"one\\" }"}]}]},' +
      '{"organ":"heart","points":[{"text":"B","sources":["L2"],"quotes":[]},{"text":"C","sour'
    const salvaged = useCase.salvageReportsModule(text)
    expect(salvaged.pointCount).toBe(2)
    expect(salvaged.module.groups.map((group) => [group.organ, group.points.map((p) => p.text)])).toEqual([
      ['chest-lung', ['A']],
      ['heart', ['B']],
    ])
    expect(useCase.salvageReportsModule('<<<MEDIPRISMA_MODULE:reports>>>{"gro').pointCount).toBe(0)
  })
})

describe('reports prompt', () => {
  const messages = (locale: 'en' | 'zh-TW') => useCase.buildReportHighlightMessages({
    locale,
    reportsText: '[L1] CT · 2026-06-24 · 示範測試醫院 · CT chest\nImpression: nodule.',
    reportCount: 1,
    piiLiterals: ['王小明'],
  })

  it('says what happens to an unmatched quote, and keeps Chinese hedges as English ones', () => {
    const system = messages('en')[0].content
    expect(system).not.toContain('is never shown')
    expect(system).toContain('shown only as an unverified line')
    expect(system).toContain('疑似, 待排除, 不排除, 可能 become suspected')
  })

  it('states the organ enum, the merge rule, the quote rule and the bounds', () => {
    const system = messages('zh-TW')[0].content
    for (const organ of REPORT_ORGANS) expect(system).toContain(organ)
    expect(system).toContain('Merge the same finding across reports into ONE point')
    expect(system).toContain('never a date, a modality or examination name, a hospital, a recommendation')
    expect(system).toContain('Keep the source\'s uncertainty words')
    expect(system).toContain('at least one entry in "quotes"')
    expect(system).toContain('"unremarkable"')
    expect(system).toContain('At most 8 groups, at most 4 points per group and at most 2 quotes per point')
    expect(system).toContain('Example (fictional findings')
    expect(system).toContain('<<<MEDIPRISMA_MODULE:reports>>>')
  })

  it('writes lines in English in every locale and quotes in the report\'s own', () => {
    // The reports are English; the owner asked for English findings (2026-10-02).
    expect(messages('zh-TW')[0].content).toContain('write every "text" in ENGLISH ONLY')
    expect(messages('zh-TW')[0].content).not.toContain('疑似支氣管擴張')
    expect(messages('en')[0].content).toContain('write every "text" in ENGLISH ONLY')
    expect(messages('en')[0].content).toContain('never translate a quote')
    expect(messages('en')[0].content).not.toContain('疑似肝血管瘤')
  })

  it('sends only the digest, scrubbed', () => {
    const user = messages('zh-TW')[1].content
    expect(user).toContain('Reports (1)')
    expect(user).toContain('[L1] CT')
    expect(user).not.toContain('Patient clinical data')
  })
})

describe('a reply whose every point failed verification', () => {
  // PR #237 review (d834b140): nothing summarized, yet the rejected point and
  // its counts must stay openable when another card is retried.
  const clinicalData: any = {
    diagnosticReports: [{
      id: 'synthetic-report', status: 'final', category: [{ coding: [{ code: 'RAD', system: 'http://terminology.hl7.org/CodeSystem/v2-0074' }] }],
      code: { text: 'Chest X-ray' }, effectiveDateTime: '2026-10-02', conclusion: 'Heart size is normal.',
    }],
  }
  const catalog = buildSourceCatalog(clinicalData)
  const key = catalog[0].key
  const first = useCase.finalizeResult({
    ...useCase.createEmptyAiResult(),
    reports: { groups: [{ organ: 'heart', points: [{ text: 'Cardiomegaly', sources: [key], quotes: [{ source: key, quote: 'Cardiomegaly.' }] }] }], unremarkable: [] },
  }, catalog, { clinicalData, audience: 'medical' })

  it('keeps its unverified points and counts across another card\'s retry', () => {
    expect(first.reportHighlights).toMatchObject({ summarized: false, hiddenPointCount: 1, droppedQuoteCount: 1 })
    expect(first.reportHighlights!.hiddenPoints).toHaveLength(1)
    const draft = useCase.mergeModuleResult(useCase.createAiDraftFromResult(first), 'overview', { headline: 'Synthetic follow-up overview', medicationEducation: [] })
    const after = useCase.finalizeResult(draft, catalog, { clinicalData, audience: 'medical' }).reportHighlights!
    expect(after.hiddenPoints).toEqual(first.reportHighlights!.hiddenPoints)
    expect(after).toMatchObject({ summarized: false, hiddenPointCount: 1, droppedQuoteCount: 1 })
  })

  it('lets the reports card\'s own retry replace them', () => {
    const draft = useCase.mergeModuleResult(useCase.createAiDraftFromResult(first), 'reports', { groups: [], unremarkable: [key] })
    const after = useCase.finalizeResult(draft, catalog, { clinicalData, audience: 'medical' }).reportHighlights!
    expect(after.hiddenPoints).toBeUndefined()
    expect(after).toMatchObject({ summarized: true, hiddenPointCount: 0, droppedQuoteCount: 0 })
  })
})

describe('report value typography', () => {
  it('keeps a finding without an unverified label and restores the original RVSP quote', () => {
    const clinicalData: any = { diagnosticReports: [report('echo-format', '2026-10-02', 'Echo', 'RVSP: 58mmHg')] }
    const catalog = buildSourceCatalog(clinicalData)
    const key = catalog[0].key
    const result = useCase.finalizeResult({ ...useCase.createEmptyAiResult(), reports: moduleOf([
      { organ: 'heart', points: [point('RVSP 58mmHg', [key], [[key, 'RVSP 58mmHg']])] },
    ]) }, catalog, { clinicalData, audience: 'medical' }).reportHighlights!
    expect(result.hiddenPointCount).toBe(0)
    expect(result.droppedQuoteCount).toBe(0)
    expect(result.groups[0].points[0].quotes).toEqual([{key, quote: 'RVSP: 58mmHg'}])
  })
})

describe('hospital-model report key prefix drift', () => {
  const data: any = { diagnosticReports: [
    report('echo-1', '2026-10-02', 'Echo', 'Moderate pulmonary hypertension (RVSP: 58mmHg).'),
    report('echo-2', '2026-10-01', 'Echo', 'Moderate pulmonary hypertension (RVSP: 58mmHg).'),
    report('echo-3', '2026-09-30', 'Echo', 'No pulmonary hypertension.'),
  ] }
  const catalog = buildSourceCatalog(data)
  const key = (id: string) => catalog.find(entry => entry.resourceId === id)!.key
  const wrong = (id: string) => key(id).replace(/^L/, 'H')
  const run = (quote: string, source = wrong('echo-1')) => useCase.finalizeResult({
    ...useCase.createEmptyAiResult(), reports: moduleOf([{organ:'heart',points:[
      point('Moderate pulmonary hypertension (RVSP 58mmHg)', [source,wrong('echo-2'),wrong('echo-3')], [[source,quote]])
    ]}])
  },catalog,{clinicalData:data,audience:'medical'}).reportHighlights!
  it('restores only same-number listed reports with matching original quotes', () => {
    const result = run('Moderate pulmonary hypertension (RVSP 58 mmHg).')
    expect(result.hiddenPointCount).toBe(0)
    expect(result.groups[0].points[0].quotes).toEqual([{key:key('echo-1'),quote:'Moderate pulmonary hypertension (RVSP: 58mmHg).'}])
    expect(result.groups[0].points[0].sources.map(source=>source.key)).toEqual([key('echo-1'),key('echo-2')])
    expect(result.others.map(source=>source.key)).toEqual([key('echo-3')])
  })
  it.each([
    ['Moderate pulmonary hypertension (RVSP 59mmHg).', wrong('echo-1')],
    ['Moderate pulmonary hypertension (RVSP 58mmHg).', 'H999'],
    ['Moderate pulmonary hypertension (RVSP 58mmHg).', wrong('echo-1').replace('H','D')],
    ['Moderate pulmonary hypertension (RVSP 58mmHg).', wrong('echo-3')],
  ])('keeps changed quotes and unresolved or unrelated keys unverified', (quote,source) => {
    const result=run(quote,source)
    expect(result.hiddenPointCount).toBe(1)
    expect(result.groups).toEqual([])
  })
})

describe('reports the model never finished reading', () => {
  it('lists reports past the digest cap as unreviewed, not as nothing notable', () => {
    // 32 reports: the digest sends the newest 30; the two oldest overflow.
    const many = {
      diagnosticReports: Array.from({ length: 32 }, (_, index) => {
        const day = String(index + 1).padStart(2, '0')
        const month = index < 28 ? '03' : '01'
        return report(`r-${index}`, `2026-${month}-${day.slice(-2) === '00' ? '01' : day.slice(-2)}`, 'Chest X-ray', `Finding number ${index}. Lungs are clear.`)
      }),
    } as any
    const manyCatalog = buildSourceCatalog(many)
    const key = (id: string) => manyCatalog.find((entry) => entry.resourceId === id)!.key
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: moduleOf([{ organ: 'chest-lung', points: [point('Finding number 0', [key('r-0')], [[key('r-0'), 'Finding number 0.']])] }]),
      },
      manyCatalog,
      { clinicalData: many, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.totalReports).toBe(32)
    expect(highlights.unreviewed).toHaveLength(2)
    expect(highlights.others).toHaveLength(29)
    expect(highlights.unreviewed!.every((row) => row.excerpt)).toBe(true)
    const listed = new Set([...highlights.others, ...highlights.unreviewed!].map((row) => row.key))
    expect(listed.size).toBe(31)
  })

  it('treats every uncited report as unreviewed after a reply that was cut off', () => {
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point('Cardiomegaly', [XR], [[XR, 'Cardiomegaly.']])] }]), incomplete: true },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.summarized).toBe(true)
    expect(highlights.others).toEqual([])
    expect(highlights.unreviewed!.map((row) => row.key).sort()).toEqual([CT, PATH, XR_OLD, US].sort())
    expect(highlights.incomplete).toBe(true)
  })
})

describe('reports the model never finished reading — coverage and retries', () => {
  const point1 = () => point('Cardiomegaly', [XR], [[XR, 'Cardiomegaly.']])

  it('treats a report the reduced request cut as unread', () => {
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point1()] }]), sentKeys: [XR, CT] },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.others.map((row) => row.key)).toEqual([CT])
    expect(highlights.unreviewed!.map((row) => row.key).sort()).toEqual([PATH, XR_OLD, US].sort())
  })

  it('keeps what a cut-off reply explicitly called unremarkable among the read reports', () => {
    const highlights = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point1()] }], [US]), incomplete: true },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(highlights.others.map((row) => row.key)).toEqual([US])
    expect(highlights.unreviewed!.map((row) => row.key).sort()).toEqual([CT, PATH, XR_OLD].sort())
  })

  it('keeps the unread list across another card\'s retry', () => {
    const first = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point1()] }]), incomplete: true, sentKeys: [XR, CT, US] },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    )
    const again = useCase.finalizeResult(
      useCase.createAiDraftFromResult(first),
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    ).reportHighlights!
    expect(again.incomplete).toBe(true)
    expect(again.others).toEqual(first.reportHighlights!.others)
    expect(again.unreviewed).toEqual(first.reportHighlights!.unreviewed)
  })

  it('keeps a cut-off reply\'s explicit unremarkable verdict, beside a verified finding, across a retry', () => {
    const first = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point1()] }], [US]), incomplete: true },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    )
    const again = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData, audience: 'medical', locale: 'zh-TW' }).reportHighlights!
    expect(first.reportHighlights!.others.map((row) => row.key)).toEqual([US])
    expect(again.others.map((row) => row.key)).toEqual([US])
    expect(again.unreviewed!.map((row) => row.key).sort()).toEqual([CT, PATH, XR_OLD].sort())
  })

  it('reads a verdict on a report the cut removed as no summary, the same before and after a retry', () => {
    const first = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([], [CT]), sentKeys: [] },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    )
    const highlights = first.reportHighlights!
    expect(highlights.summarized).toBe(false)
    expect(highlights.unreviewed).toBeUndefined()
    expect(highlights.others).toHaveLength(5)
    const again = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData, audience: 'medical', locale: 'zh-TW' }).reportHighlights!
    expect(again.summarized).toBe(false)
    expect(again.others.map((row) => row.key)).toEqual(highlights.others.map((row) => row.key))
  })

  it('lists every report with its excerpt, the same way before and after a retry, when nothing verified', () => {
    const first = useCase.finalizeResult(
      {
        ...useCase.createEmptyAiResult(),
        reports: { ...moduleOf([{ organ: 'heart', points: [point('Cardiomegaly', [XR], [[XR, 'words the report never wrote']])] }]), incomplete: true },
      },
      catalog,
      { clinicalData, audience: 'medical', locale: 'zh-TW' },
    )
    const highlights = first.reportHighlights!
    expect(highlights.summarized).toBe(false)
    expect(highlights.unreviewed).toBeUndefined()
    expect(highlights.others).toHaveLength(5)
    const again = useCase.finalizeResult(useCase.createAiDraftFromResult(first), catalog, { clinicalData, audience: 'medical', locale: 'zh-TW' }).reportHighlights!
    expect(again.others.map((row) => row.key)).toEqual(highlights.others.map((row) => row.key))
    expect(again.unreviewed).toBeUndefined()
  })
})
