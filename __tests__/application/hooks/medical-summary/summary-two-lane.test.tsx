/** @jest-environment jsdom */
// The two-lane split: on the compact harness the overview (the headline) is
// requested on its own, over a reduced evidence set, concurrently with the
// full lane (problems + safety) — so the first section reaches the screen
// without waiting for the whole batch.
import { act, renderHook } from '@testing-library/react'
import { useMedicalSummary } from '@/src/application/hooks/medical-summary/use-medical-summary.hook'
import { medicalSummaryStore } from '@/src/application/hooks/medical-summary/medical-summary-store'
import type { SummarySourceCatalogEntry } from '@/src/core/entities/medical-summary.entity'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'

const SLOT = 'lane-slot'

const CATALOG: SummarySourceCatalogEntry[] = [
  { key: 'E1', resourceType: 'Encounter', resourceId: 'enc-1', display: '住院', date: '2026-04-01', encounterClass: 'inpatient' },
  { key: 'E2', resourceType: 'Encounter', resourceId: 'enc-2', display: '門診', date: '2026-04-20', encounterClass: 'outpatient' },
  { key: 'M1', resourceType: 'MedicationRequest', resourceId: 'med-1', display: 'Metformin 500mg', date: '2026-04-20' },
  { key: 'P1', resourceType: 'Procedure', resourceId: 'proc-1', display: '大腸鏡', date: '2026-02-01' },
]

const OVERVIEW_BLOCK = '<<<MEDIPRISMA_MODULE:overview>>>' + JSON.stringify({
  headline: '78 歲男性，糖尿病與慢性腎病，跨院照護',
  medicationEducation: [],
}) + '<<<END_MEDIPRISMA_MODULE:overview>>>'

// The scoped bundle the catalog above was built from. The fast lane derives
// its own evidence from THIS, not from the fitted narrative.
const CLINICAL_DATA = {
  encounters: [
    { id: 'enc-1', class: { code: 'IMP' }, period: { start: '2026-04-01', end: '2026-04-05' }, serviceProvider: { display: '示範長青醫院' } },
    { id: 'enc-2', class: { code: 'AMB' }, period: { start: '2026-04-20' }, serviceProvider: { display: '示範長青醫院' } },
  ],
  medications: [
    { id: 'med-1', status: 'active', authoredOn: '2026-04-20', medicationCodeableConcept: { text: 'Metformin 500mg' } },
  ],
  procedures: [{ id: 'proc-1', code: { text: '大腸鏡' }, performedDateTime: '2026-02-01' }],
} as any

const FULL_BLOCKS = [
  '<<<MEDIPRISMA_MODULE:problems>>>' + JSON.stringify({
    problems: [{ label: '第二型糖尿病', basis: '藥局調劑', kind: 'medication', sources: ['M1'] }],
  }) + '<<<END_MEDIPRISMA_MODULE:problems>>>',
  '<<<MEDIPRISMA_MODULE:safety>>>' + JSON.stringify({ scannedCount: 0, alerts: [] }) + '<<<END_MEDIPRISMA_MODULE:safety>>>',
].join('\n')

let mockSlotOptions: any
let mockResult: any
const mockStream = jest.fn()

/** Prompts whose card contract asks for the overview and nothing else. */
const isFastLaneRequest = (messages: Array<{ content: string }>) => {
  const contract = messages.map((message) => message.content).join('\n')
  return contract.includes('<<<MEDIPRISMA_MODULE:overview>>>') &&
    !contract.includes('<<<MEDIPRISMA_MODULE:problems>>>')
}

let mockIdentifySummaryRun: jest.Mock | undefined
const runGeneration = (contextLimit: number) => async () => {
  mockResult = await mockSlotOptions.run({
    identifySummaryRun: mockIdentifySummaryRun,
    operationKey: SLOT,
    modelId: 'gpt-nano-2',
    requestedModelId: 'gpt-nano-2',
    modelName: 'GPT Nano',
    locale: 'zh-TW',
    audience: 'medical',
    clinicalContext: 'Patient Information:\n- Gender: Male',
    clinicalData: CLINICAL_DATA,
    patient: { id: 'p1', resourceType: 'Patient', gender: 'male', birthDate: '1948-01-01' },
    clinicalNowMs: Date.parse('2026-04-21T00:00:00Z'),
    catalog: CATALOG,
    piiLiterals: [],
    contextLimit,
    ai: { stream: mockStream },
  })
}

let contextLimit = 120_000
jest.mock('@/src/application/hooks/ai-generation/use-ai-slot-generation.hook', () => ({
  useAiSlotGeneration: (options: any) => {
    mockSlotOptions = options
    return {
      slotKey: SLOT,
      catalog: CATALOG,
      dataReady: true,
      generate: () => runGeneration(contextLimit)(),
    }
  },
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/ai-demographics-gate.provider', () => ({ useAiDemographicsGate: () => ({ demographicsReadyForAi: true }) }))

beforeEach(() => {
  mockResult = undefined
  contextLimit = 120_000
  mockStream.mockReset()
  medicalSummaryStore.setState({ byKey: {}, running: { [SLOT]: true } } as any)
})

afterEach(() => { mockIdentifySummaryRun = undefined; jest.restoreAllMocks() })

test('the run names the operation with the same random ID its attempts carry', async () => {
  const seen: Array<[string, string | undefined]> = []
  mockIdentifySummaryRun = jest.fn((runId: string) => {
    seen.push([runId, useAiExecutionDiagnosticsStore.getState().summaryRuns[SLOT]])
  })
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    const block = isFastLaneRequest(messages) ? OVERVIEW_BLOCK : FULL_BLOCKS
    options.onChunk(block)
    return block
  })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })
  expect(mockIdentifySummaryRun).toHaveBeenCalledTimes(1)
  const [[runId, attemptRunId]] = seen
  expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(runId).toBe(attemptRunId)
  expect(runId).not.toContain(SLOT)
})

test('the overview lane publishes its section while the full lane is still streaming', async () => {
  let releaseFullLane: (() => void) | undefined
  const fullLaneBlocked = new Promise<void>((resolve) => { releaseFullLane = resolve })
  const fastLanePrompts: string[] = []
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    if (isFastLaneRequest(messages)) {
      fastLanePrompts.push(messages.map((message) => message.content).join('\n'))
      options.onChunk(OVERVIEW_BLOCK)
      return OVERVIEW_BLOCK
    }
    await fullLaneBlocked
    options.onChunk(FULL_BLOCKS)
    return FULL_BLOCKS
  })

  const { result } = renderHook(() => useMedicalSummary())
  let pending!: Promise<void>
  await act(async () => {
    pending = result.current.generate()
    // Let the fast lane settle while the full lane is still awaiting.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })

  const published = medicalSummaryStore.getState().byKey[SLOT] as any
  expect(published.headline).toContain('78 歲男性')
  expect(published.completedCardIds).toEqual(['overview'])
  expect(published.problems).toEqual([])
  // The first section is timed from the start of the run, not from the batch.
  expect(published.generation.firstCardMs).toBeGreaterThanOrEqual(0)

  await act(async () => {
    releaseFullLane?.()
    await pending
  })

  expect(mockResult.headline).toContain('78 歲男性')
  expect(mockResult.problems).toHaveLength(1)
  expect(mockResult.completedCardIds).toEqual(
    expect.arrayContaining(['overview', 'problems', 'safety']),
  )
  for (const retired of ['focus', 'recent']) expect(mockResult.completedCardIds).not.toContain(retired)
  expect(mockResult.cardErrors).toBeUndefined()

  // Two concurrent requests, both owned by the same generation slot. (No
  // report lane: this bundle has no imaging or pathology report.)
  expect(mockStream).toHaveBeenCalledTimes(2)
  const fullLanePrompt = mockStream.mock.calls
    .map(([messages]: any[]) => messages.map((message: any) => message.content).join('\n'))
    .find((content: string) => content.includes('<<<MEDIPRISMA_MODULE:problems>>>'))!
  expect(fullLanePrompt).toContain('<<<MEDIPRISMA_MODULE:safety>>>')
  expect(fullLanePrompt).not.toContain('<<<MEDIPRISMA_MODULE:overview>>>')
  for (const retired of ['focus', 'recent']) expect(fullLanePrompt).not.toContain(`<<<MEDIPRISMA_MODULE:${retired}>>>`)
  for (const [, options] of mockStream.mock.calls) {
    expect(options.operationKey).toBe(SLOT)
  }
  // The fast lane carries the deterministic snapshot, not the fitted narrative:
  // a current medicine, an admission and a major procedure, but no routine
  // outpatient visit — that one cannot back the headline.
  expect(fastLanePrompts[0]).toContain('[M1]')
  expect(fastLanePrompts[0]).toContain('[E1]')
  expect(fastLanePrompts[0]).toContain('[P1]')
  expect(fastLanePrompts[0]).toContain('## Major procedures')
  expect(fastLanePrompts[0]).not.toContain('[E2]')
  expect(fastLanePrompts[0]).toContain('## Medicines (current first; "supply ended" = recently dispensed but no longer covered)')
  expect(fastLanePrompts[0]).not.toContain('Patient Information:')
  // The output-language contract is stated once per message on this lane.
  expect(fastLanePrompts[0].match(/OUTPUT LANGUAGE/g)).toHaveLength(2)

  // Hidden reasoning is turned off for the overview lane only.
  const optionsByLane = mockStream.mock.calls.map(([messages, options]: any[]) => ({
    fast: isFastLaneRequest(messages),
    hiddenReasoning: options.hiddenReasoning,
  }))
  expect(optionsByLane.find((lane) => lane.fast)?.hiddenReasoning).toBe('off')
  // Local models: the full lane runs without hidden reasoning too (it wrote no
  // card within the watchdog with thinking on).
  expect(optionsByLane.find((lane) => !lane.fast)?.hiddenReasoning).toBe('off')
})

test('a failed overview lane is still repairable by the single-module retry path', async () => {
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    if (isFastLaneRequest(messages)) {
      options.onChunk('not json at all')
      return 'not json at all'
    }
    options.onChunk(FULL_BLOCKS)
    return FULL_BLOCKS
  })

  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })
  expect(mockResult.cardErrors).toEqual({ overview: 'PARSE_FAILED' })
  expect(mockResult.problems).toHaveLength(1)
  medicalSummaryStore.setState({ byKey: { [SLOT]: mockResult }, running: { [SLOT]: true } } as any)

  const retryPrompts: string[] = []
  mockStream.mockReset()
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    retryPrompts.push(messages.map((message: any) => message.content).join('\n'))
    options.onChunk(OVERVIEW_BLOCK)
    return OVERVIEW_BLOCK
  })
  await act(async () => { await result.current.retryFailedModules() })

  // The retry is a single request for the failed card only — the lane split
  // does not apply to it — and the previously successful cards are retained.
  expect(mockStream).toHaveBeenCalledTimes(1)
  expect(retryPrompts[0]).toContain('<<<MEDIPRISMA_MODULE:overview>>>')
  expect(retryPrompts[0]).not.toContain('<<<MEDIPRISMA_MODULE:problems>>>')
  expect(mockResult.headline).toContain('78 歲男性')
  expect(mockResult.problems).toHaveLength(1)
  expect(mockResult.cardErrors).toBeUndefined()
})

test('a frontier-window model keeps the established single batch', async () => {
  contextLimit = 900_000
  mockStream.mockImplementation(async (_messages: any[], options: any) => {
    const everything = `${OVERVIEW_BLOCK}\n${FULL_BLOCKS}`
    options.onChunk(everything)
    return everything
  })

  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  expect(mockStream).toHaveBeenCalledTimes(1)
  expect(mockResult.headline).toContain('78 歲男性')
  expect(mockResult.cardErrors).toBeUndefined()
})

test('a key the fast lane never sent stays unverified, even when the saved catalog has it', async () => {
  // The snapshot sends E1, M1 and P1 but not the outpatient visit E2. A key
  // the model could not have seen must not land as a verified chip on E2.
  const overview = '<<<MEDIPRISMA_MODULE:overview>>>' + JSON.stringify({
    headline: '78 歲男性，糖尿病與慢性腎病，跨院照護',
    medicationEducation: [
      { name: 'Metformin', benefit: '控制血糖', attention: '腎功能', sources: ['M1', 'E2'] },
    ],
  }) + '<<<END_MEDIPRISMA_MODULE:overview>>>'
  mockStream.mockImplementation(async (messages: any[], options: any) => {
    const text = isFastLaneRequest(messages) ? overview : FULL_BLOCKS
    options.onChunk(text)
    return text
  })

  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => { await result.current.generate() })

  const byKey = new Map<string, any>(mockResult.sourceIndex.map((ref: any) => [ref.key, ref]))
  expect(byKey.get('M1')).toEqual(expect.objectContaining({ verified: true, resourceId: 'med-1' }))
  expect(byKey.get('E2')).toBeUndefined()
  expect(byKey.get('E2?')).toEqual(expect.objectContaining({ verified: false }))
  expect(byKey.get('E2?')?.resourceId).toBeUndefined()
})
