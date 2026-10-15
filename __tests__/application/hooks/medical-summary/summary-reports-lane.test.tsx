/** @jest-environment jsdom */
// 影像與病理重點 runs as its own lane over the report digest: ONE request with
// every report (merging a finding across reports needs them all in one
// prompt), hidden reasoning off on the compact harness, one re-send after a
// transport failure, and module retries that keep or replace the verified
// points. Synthetic fixtures only.
import { act, renderHook } from '@testing-library/react'
import { useMedicalSummary } from '@/src/application/hooks/medical-summary/use-medical-summary.hook'
import { medicalSummaryStore } from '@/src/application/hooks/medical-summary/medical-summary-store'
import { buildSourceCatalog } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'

const SLOT = 'reports-lane-slot'
const RAD = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD' }] }]

// Ten chest films; all fit one request.
const REPORTS = Array.from({ length: 10 }, (_, index) => ({
  id: `xr-${index}`,
  status: 'final',
  category: RAD,
  code: { text: 'Chest X-ray' },
  effectiveDateTime: `2026-03-${String(index + 10)}T09:00:00+08:00`,
  conclusion: `Findings: Lines and tubes in place.\nImpression: Finding ${index} is stable.`,
  performer: [{ display: '示範測試醫院' }],
}))

const CLINICAL_DATA = {
  encounters: [
    { id: 'enc-1', class: { code: 'IMP' }, period: { start: '2026-04-01', end: '2026-04-05' }, serviceProvider: { display: '示範測試醫院' } },
  ],
  medications: [
    { id: 'med-1', status: 'active', authoredOn: '2026-04-20', medicationCodeableConcept: { text: 'Metformin 500mg' } },
  ],
  diagnosticReports: REPORTS,
} as any
const CATALOG = buildSourceCatalog(CLINICAL_DATA)
const quoteFor = (key: string) => {
  const resourceId = CATALOG.find((entry) => entry.key === key)!.resourceId
  return `Finding ${resourceId.replace('xr-', '')} is stable.`
}

const block = (id: string, body: unknown) =>
  `<<<MEDIPRISMA_MODULE:${id}>>>${JSON.stringify(body)}<<<END_MEDIPRISMA_MODULE:${id}>>>`
const OVERVIEW_BLOCK = block('overview', {
  headline: '測試病人，跨院照護',
  medicationEducation: [],
})
const NARRATIVE_BLOCKS = [
  block('problems', { problems: [{ label: '第二型糖尿病', basis: '藥局調劑', kind: 'medication', sources: ['M1'] }] }),
  block('safety', { scannedCount: 0, alerts: [] }),
].join('\n')

const contentOf = (messages: Array<{ content: string }>) => messages.map((message) => message.content).join('\n')
const isReportsRequest = (messages: Array<{ content: string }>) => contentOf(messages).includes('<<<MEDIPRISMA_MODULE:reports>>>')
const isFastLaneRequest = (messages: Array<{ content: string }>) => {
  const content = contentOf(messages)
  return content.includes('<<<MEDIPRISMA_MODULE:overview>>>') && !content.includes('<<<MEDIPRISMA_MODULE:problems>>>')
}
/** Keys a reports request lists, in prompt order. */
const listedKeys = (messages: Array<{ content: string }>) =>
  [...messages[1].content.matchAll(/^\[(L\d+)\] /gm)].map((match) => match[1])
/** One merged point citing every listed report, quoting the two newest. */
const reportsModule = (keys: string[]) => ({
  groups: [{
    organ: 'chest-lung',
    points: [{
      text: '多處穩定病灶',
      sources: keys,
      quotes: keys.slice(0, 2).map((key) => ({ source: key, quote: quoteFor(key) })),
    }],
  }],
  unremarkable: [],
})
const reportsReply = (keys: string[]) => block('reports', reportsModule(keys))

let mockSlotOptions: any
let mockResult: any
let mockAudience: 'medical' | 'patient' = 'medical'
let contextLimit = 120_000
const mockStream = jest.fn()

const runGeneration = async (overrides: Record<string, unknown> = {}) => {
  mockResult = await mockSlotOptions.run({
    operationKey: SLOT,
    modelId: 'gpt-nano-2',
    requestedModelId: 'gpt-nano-2',
    modelName: 'GPT Nano',
    locale: 'zh-TW',
    audience: mockAudience,
    clinicalContext: 'Patient Information:\n- Gender: Male',
    clinicalData: CLINICAL_DATA,
    patient: { id: 'p1', resourceType: 'Patient', gender: 'male', birthDate: '1948-01-01' },
    clinicalNowMs: Date.parse('2026-04-21T00:00:00Z'),
    catalog: CATALOG,
    piiLiterals: [],
    contextLimit,
    ai: { stream: mockStream },
    ...overrides,
  })
}

jest.mock('@/src/application/hooks/ai-generation/use-ai-slot-generation.hook', () => ({
  useAiSlotGeneration: (options: any) => {
    mockSlotOptions = options
    return {
      slotKey: SLOT,
      catalog: CATALOG,
      clinicalData: CLINICAL_DATA,
      dataReady: true,
      generate: () => runGeneration(),
    }
  },
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: mockAudience }) }))
jest.mock('@/src/application/providers/ai-demographics-gate.provider', () => ({ useAiDemographicsGate: () => ({ demographicsReadyForAi: true }) }))

beforeEach(() => {
  mockResult = undefined
  mockAudience = 'medical'
  contextLimit = 120_000
  mockStream.mockReset()
  medicalSummaryStore.setState({ byKey: {}, running: { [SLOT]: true } } as any)
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

/** Default model: every lane answers correctly; the reports request takes a tick. */
function answerEverything(
  reportsBehaviour: (keys: string[], callIndex: number) => string = (keys) => reportsReply(keys),
) {
  let reportsCalls = 0
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    if (isReportsRequest(messages)) {
      const callIndex = reportsCalls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      const reply = reportsBehaviour(listedKeys(messages), callIndex)
      options.onChunk(reply)
      return reply
    }
    const reply = isFastLaneRequest(messages) ? OVERVIEW_BLOCK : NARRATIVE_BLOCKS
    options.onChunk(reply)
    return reply
  })
}

const reportsCalls = () => mockStream.mock.calls.filter(([messages]: any[]) => isReportsRequest(messages))

test('a fresh compact-harness run sends ONE reports request with every report, hidden reasoning off', async () => {
  answerEverything()
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  // Fast + full narrative lanes, plus one reports request.
  expect(mockStream).toHaveBeenCalledTimes(3)
  const calls = reportsCalls()
  expect(calls).toHaveLength(1)
  const [messages, options] = calls[0]
  expect(listedKeys(messages)).toHaveLength(10)
  expect(options.hiddenReasoning).toBe('off')
  expect(options.operationKey).toBe(SLOT)
  // The lane input is the digest, not the clinical context.
  expect(contentOf(messages)).not.toContain('Patient clinical data')
  expect(contentOf(messages)).not.toContain('Metformin')
  expect(contentOf(messages)).not.toContain('<<<MEDIPRISMA_MODULE:overview>>>')
  // The narrative lanes never carry the reports contract.
  for (const [narrative] of mockStream.mock.calls.filter(([candidate]: any[]) => !isReportsRequest(candidate))) {
    expect(contentOf(narrative)).not.toContain('<<<MEDIPRISMA_MODULE:reports>>>')
  }

  const highlights = mockResult.reportHighlights
  expect(highlights.summarized).toBe(true)
  expect(highlights.totalReports).toBe(10)
  expect(highlights.groups).toHaveLength(1)
  expect(highlights.groups[0]).toMatchObject({ organ: 'chest-lung', label: 'Lungs' })
  // The point cites all ten reports but quotes two, and each report's text is
  // its own: only the two whose words were verified support it. The other
  // eight fall to the footer instead of lending the point their dates.
  expect(highlights.groups[0].points[0].sources).toHaveLength(2)
  expect(highlights.groups[0].points[0].quotes).toHaveLength(2)
  expect(highlights.others).toHaveLength(8)
  expect(mockResult.completedCardIds).toEqual(expect.arrayContaining(['overview', 'problems', 'reports', 'safety']))
  expect(mockResult.cardErrors).toBeUndefined()
  expect(mockResult.generation.cardModelExecutions.reports).toBeDefined()
})

test('a reply cut off mid-point keeps the points it finished', async () => {
  answerEverything((keys) => (
    // Second point never finished, no end marker.
    '<<<MEDIPRISMA_MODULE:reports>>>{"groups":[{"organ":"chest-lung","points":[' +
    JSON.stringify(reportsModule(keys).groups[0].points[0]) +
    `,{"text":"未完成","sources":["${keys[0]}"],"quo`
  ))
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  expect(mockResult.cardErrors).toBeUndefined()
  expect(mockResult.reportHighlights.groups[0].points.map((point: any) => point.text)).toEqual(['多處穩定病灶'])
})

test('an unparseable reply fails the card, and the section still lists every report from the digest', async () => {
  answerEverything(() => 'still not json')
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  expect(reportsCalls()).toHaveLength(1)
  expect(mockResult.cardErrors).toEqual({ reports: 'PARSE_FAILED' })
  const highlights = mockResult.reportHighlights
  expect(highlights.summarized).toBe(false)
  expect(highlights.groups).toEqual([])
  expect(highlights.others).toHaveLength(10)
  expect(highlights.others.every((row: any) => row.excerptSource === 'conclusion')).toBe(true)
  expect(mockResult.problems).toHaveLength(1)
})

test('retrying the reports card runs that lane alone and replaces the section', async () => {
  answerEverything(() => 'still not json')
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })
  expect(mockResult.cardErrors).toEqual({ reports: 'PARSE_FAILED' })
  medicalSummaryStore.setState({ byKey: { [SLOT]: mockResult }, running: { [SLOT]: true } } as any)

  mockStream.mockReset()
  answerEverything()
  await act(async () => { await result.current.retryFailedModules() })

  expect(mockStream).toHaveBeenCalledTimes(1)
  expect(reportsCalls()).toHaveLength(1)
  expect(mockResult.cardErrors).toBeUndefined()
  expect(mockResult.reportHighlights.summarized).toBe(true)
  expect(mockResult.reportHighlights.groups).toHaveLength(1)
  expect(mockResult.headline).toContain('測試病人')
  expect(mockResult.problems).toHaveLength(1)
})

test('verified points survive a retry of another card', async () => {
  let failOverview = true
  answerEverything()
  const base = mockStream.getMockImplementation()!
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    if (failOverview && isFastLaneRequest(messages)) {
      options.onChunk('garbage')
      return 'garbage'
    }
    return base(messages, options)
  })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })
  expect(mockResult.cardErrors).toEqual({ overview: 'PARSE_FAILED' })
  const before = mockResult.reportHighlights
  expect(before.groups).toHaveLength(1)
  medicalSummaryStore.setState({ byKey: { [SLOT]: mockResult }, running: { [SLOT]: true } } as any)

  failOverview = false
  mockStream.mockClear()
  await act(async () => { await result.current.retryFailedModules() })

  expect(reportsCalls()).toHaveLength(0)
  expect(mockResult.cardErrors).toBeUndefined()
  expect(mockResult.reportHighlights).toEqual(before)
})

test('a frontier-window model also runs the reports lane, with its default reasoning', async () => {
  contextLimit = 900_000
  answerEverything()
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    const reply = isReportsRequest(messages)
      ? reportsReply(listedKeys(messages))
      : `${OVERVIEW_BLOCK}\n${NARRATIVE_BLOCKS}`
    options.onChunk(reply)
    return reply
  })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  expect(mockStream).toHaveBeenCalledTimes(2)
  for (const [, options] of reportsCalls()) expect(options.hiddenReasoning).toBeUndefined()
  expect(mockResult.reportHighlights.groups).toHaveLength(1)
})

test('the patient audience never requests the reports lane', async () => {
  mockAudience = 'patient'
  answerEverything()
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  expect(reportsCalls()).toHaveLength(0)
  expect(mockResult.reportHighlights).toBeUndefined()
  expect(mockResult.headline).toContain('測試病人')
  expect(mockResult.problems).toHaveLength(1)
})

describe('a reports request that fails in transport', () => {
  const transportError = () => Object.assign(new Error('Provider returned 429 Too Many Requests'), { status: 429 })
  /** Fails the reports request `times` times. */
  const failReports = (times: number) => {
    let failuresLeft = times
    return (keys: string[]) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw transportError()
      }
      return reportsReply(keys)
    }
  }
  const generateWithTimers = async (run: () => Promise<unknown>) => {
    await act(async () => {
      const pending = run()
      await jest.advanceTimersByTimeAsync(10_000)
      await pending
    })
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('is re-sent once after 2 s and keeps its points', async () => {
    answerEverything(failReports(1))
    const { result } = renderHook(() => useMedicalSummary())
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.generate()
      await jest.advanceTimersByTimeAsync(100)
    })
    // The request went out and failed; the re-send is waiting, not sent yet.
    expect(reportsCalls()).toHaveLength(1)
    await act(async () => { await jest.advanceTimersByTimeAsync(1_800) })
    expect(reportsCalls()).toHaveLength(1)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500)
      await pending
    })

    const calls = reportsCalls().map(([messages]: any[]) => listedKeys(messages))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    expect(mockResult.reportHighlights.groups).toHaveLength(1)
    expect(mockResult.cardErrors).toBeUndefined()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[medical-summary:reports] request failed; retrying once'))
  })

  test('fails the card when the re-send fails too, still listing every report', async () => {
    answerEverything(failReports(2))
    const { result } = renderHook(() => useMedicalSummary())
    await generateWithTimers(() => result.current.generate())

    // The initial request plus exactly ONE re-send.
    expect(reportsCalls()).toHaveLength(2)
    expect(mockResult.cardErrors.reports).toBeDefined()
    expect(mockResult.reportHighlights.summarized).toBe(false)
    expect(mockResult.reportHighlights.others).toHaveLength(10)
  })

  test('an unparseable reply is not re-sent', async () => {
    answerEverything(() => 'not json at all')
    const { result } = renderHook(() => useMedicalSummary())
    await generateWithTimers(() => result.current.generate())

    expect(reportsCalls()).toHaveLength(1)
    expect(mockResult.cardErrors).toEqual({ reports: 'PARSE_FAILED' })
  })

  test('a user stop is not retried', async () => {
    answerEverything(() => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    renderHook(() => useMedicalSummary())
    let outcome: unknown
    await generateWithTimers(() => runGeneration().catch((error) => { outcome = error }))

    expect(outcome).toMatchObject({ name: 'AbortError' })
    expect(reportsCalls()).toHaveLength(1)
  })

  test('a stop during the retry wait sends nothing more', async () => {
    answerEverything(failReports(1))
    renderHook(() => useMedicalSummary())
    const runAbort = new AbortController()
    let outcome: unknown
    await act(async () => {
      const pending = runGeneration({ signal: runAbort.signal }).catch((error) => { outcome = error })
      await jest.advanceTimersByTimeAsync(500)
      expect(reportsCalls()).toHaveLength(1)
      runAbort.abort()
      await jest.advanceTimersByTimeAsync(10_000)
      await pending
    })

    expect(outcome).toMatchObject({ name: 'AbortError' })
    expect(reportsCalls()).toHaveLength(1)
  })
})

describe('on-prem latency budget', () => {
  test('the summary passes a 24K budget for self-hosted compact-harness windows only', () => {
    renderHook(() => useMedicalSummary())
    expect(mockSlotOptions.contextTokenBudget(262_144, { selfHosted: true })).toBe(24_000)
    expect(mockSlotOptions.contextTokenBudget(1_048_576, { selfHosted: true })).toBeUndefined()
    expect(mockSlotOptions.contextTokenBudget(120_000, { selfHosted: false })).toBeUndefined()
  })

  test('only the full-context request uses the narrowed records; the digest keeps the saved scope', async () => {
    answerEverything()
    // The budget kept two of the ten reports; their keys are the saved
    // catalog's (L-keys are newest-first, so these are not L1/L2 by accident).
    const keptReportIds = new Set(['xr-0', 'xr-1'])
    const narrowedCatalog = CATALOG.filter((entry) => (
      entry.resourceType !== 'DiagnosticReport' || keptReportIds.has(entry.resourceId)
    ))
    const keptKeys = narrowedCatalog
      .filter((entry) => entry.resourceType === 'DiagnosticReport')
      .map((entry) => entry.key)
    expect(keptKeys).toHaveLength(2)
    renderHook(() => useMedicalSummary())
    await act(async () => {
      await runGeneration({
        clinicalContextScope: {
          clinicalData: { ...CLINICAL_DATA, diagnosticReports: REPORTS.filter((report) => keptReportIds.has(report.id)) },
          catalog: narrowedCatalog,
        },
      })
    })

    const fullLane = mockStream.mock.calls.find(([messages]: any[]) => (
      !isReportsRequest(messages) && !isFastLaneRequest(messages)
    ))!
    const sourceList = fullLane[0][1].content.split('SOURCE LIST')[1]
    const listedReportKeys = [...sourceList.matchAll(/^\[(L\d+)\] /gm)].map((match: RegExpMatchArray) => match[1])
    expect(listedReportKeys.sort()).toEqual([...keptKeys].sort())
    // The report digest still covers every report in the saved scope.
    expect(reportsCalls().flatMap(([messages]: any[]) => listedKeys(messages))).toHaveLength(10)
    expect(mockResult.reportHighlights.totalReports).toBe(10)
    expect(mockResult.reportHighlights.groups[0].points[0].sources).toHaveLength(2)
  })
})

// PR #237 review (2026-10-03): the three fixed cases through the real hook,
// on both harnesses — a severity moved onto another finding, the two sides of
// one study written as a trend, and a CT and an ultrasound in reverse order.
test.each([120_000, 1_000_000])('fixed severity and trend cases hold through the summary hook; window %d', async (limit) => {
  const quote = 'Severe tricuspid regurgitation. Moderate pulmonary hypertension.'
  const data: any = {
    diagnosticReports: [
      { ...REPORTS[0], id: 'echo', code: { text: 'Echocardiography' }, conclusion: quote },
      { ...REPORTS[0], id: 'pwv', code: { text: 'baPWV' }, conclusion: 'Right baPWV 1200 cm/s; left baPWV 1300 cm/s.' },
      { ...REPORTS[0], id: 'ct', code: { text: 'CT abdomen' }, effectiveDateTime: '2026-01-01', conclusion: 'Mass measures 5 x 4 cm.' },
      { ...REPORTS[0], id: 'us', code: { text: 'Abdominal ultrasound' }, effectiveDateTime: '2026-02-01', conclusion: 'Mass measures 3 x 2 cm.' },
    ],
  }
  const catalog = buildSourceCatalog(data)
  const key = (id: string) => catalog.find((entry) => entry.resourceId === id)!.key
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    const reply = isReportsRequest(messages)
      ? block('reports', {
          groups: [{ organ: 'heart', points: [{ text: 'Moderate tricuspid regurgitation and pulmonary hypertension', sources: [key('echo')], quotes: [{ source: key('echo'), quote }] }] }],
          unremarkable: [],
        })
      : [
          OVERVIEW_BLOCK,
          block('problems', {
            problems: [
              { label: 'baPWV', metric: '1200 → 1300 cm/s', metricSources: [key('pwv')] },
              { label: 'Mass', metric: '3 x 2 cm (2026-02-01) → 5 x 4 cm (2026-01-01)', metricSources: [key('us'), key('ct')] },
            ],
          }),
          block('safety', { scannedCount: 0, alerts: [] }),
        ].join('\n')
    options.onChunk(reply)
    return reply
  })
  renderHook(() => useMedicalSummary())
  await act(async () => runGeneration({ clinicalData: data, catalog, contextLimit: limit }))

  expect(mockResult.reportHighlights.groups[0].points[0].displayAs).toBe('quote')
  expect(mockResult.problems[0]).toEqual(expect.objectContaining({ metricNeedsReview: true }))
  expect(mockResult.problems[0].metric).not.toContain('→')
  expect(mockResult.problems[1].metricNeedsReview).toBe(true)
  expect(mockResult.problems[1].metric.indexOf('2026-01-01')).toBeLessThan(mockResult.problems[1].metric.indexOf('2026-02-01'))
  expect(mockResult.cardErrors).toBeUndefined()
})
