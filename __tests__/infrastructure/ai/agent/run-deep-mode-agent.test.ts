/** @jest-environment node */
import {
  createObservationRecoveryBudget,
  repeatedToolCallIs,
  runDeepModeAgent,
} from '@/src/infrastructure/ai/agent/run-deep-mode-agent'
import { stepCountIs } from 'ai'
import { StreamIdleTimeoutError } from '@/src/infrastructure/ai/streaming/stream-idle-timeout'

const mockStreamText = jest.fn()

jest.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: jest.fn(() => 'stop-condition'),
}))

async function* textStream(text: string) {
  yield { type: 'text-delta', text }
}

async function* failedStream(): AsyncGenerator<never> {
  throw new Error('temporary endpoint failure')
}

const stalledStream: AsyncIterable<never> = {
  [Symbol.asyncIterator]() {
    return {
      next: () => new Promise<IteratorResult<never>>(() => {}),
      return: () => Promise.resolve({ value: undefined as never, done: true }),
    }
  },
}

const translations = {
  organizingResults: 'Organizing',
  queriedFhirData: 'FHIR result',
  answerQuestion: 'Answer the question',
  synthesizeResults: 'Synthesize',
  queryResult: 'Query result',
  queryFailed: 'Query failed',
  noData: 'No data',
  noDataFound: 'No data found',
  foundRecords: 'Found records',
  toolNames: { getHealthSummarySnapshot: 'Health summary' },
}

describe('runDeepModeAgent compact snapshot prefetch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('executes the no-argument tool locally and makes one synthesis request', async () => {
    const execute = jest.fn().mockResolvedValue({
      success: true,
      data: { conditions: [], medications: [], abnormalLabs: [], recentVitals: [] },
    })
    mockStreamText.mockReturnValue({
      fullStream: textStream('Complete answer'),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }),
    })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'health summary' },
      ],
      tools: { getHealthSummarySnapshot: { execute } } as never,
      initialToolName: 'getHealthSummarySnapshot',
      preExecuteInitialTool: true,
      preExecuteInitialToolInput: { limit: 3 },
      reasoningEffort: 'low',
      translations,
      idleMs: 1_000,
      abortController: new AbortController(),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ limit: 3 })
    expect(mockStreamText).toHaveBeenCalledTimes(1)
    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
      tools: undefined,
      providerOptions: { openai: { reasoningEffort: 'low' } },
    }))
    expect(JSON.stringify(mockStreamText.mock.calls[0][0].messages)).not.toContain('Continue using available tools')
    expect(result.answer).toBe('Complete answer')
    expect(result.toolCalls).toEqual(['getHealthSummarySnapshot'])
    expect(result.usage.totalTokens).toBe(120)
    expect(result.trajectory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool-call',
        toolName: 'getHealthSummarySnapshot',
        input: { limit: 3 },
      }),
      expect.objectContaining({ kind: 'tool-result', toolName: 'getHealthSummarySnapshot' }),
    ]))
  })

  it('retries one failed no-output synthesis without rerunning the FHIR tool', async () => {
    const execute = jest.fn().mockResolvedValue({ success: true, data: {} })
    mockStreamText
      .mockReturnValueOnce({
        fullStream: failedStream(),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      })
      .mockReturnValueOnce({
        fullStream: textStream('Recovered answer'),
        usage: Promise.resolve({ inputTokens: 80, outputTokens: 20, totalTokens: 100 }),
      })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'user', content: 'health summary' }],
      tools: { getHealthSummarySnapshot: { execute } } as never,
      initialToolName: 'getHealthSummarySnapshot',
      preExecuteInitialTool: true,
      translations,
      idleMs: 1_000,
      abortController: new AbortController(),
    })

    expect(mockStreamText).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.answer).toBe('Recovered answer')
    expect(result.usage.totalTokens).toBe(100)
  })

  it('keeps patient and lab tools available after an empty medication prefetch', async () => {
    const tools = {
      queryMedications: { execute: jest.fn().mockResolvedValue({ success: true, count: 0, data: [] }) },
      queryPatientInfo: { execute: jest.fn() },
      queryObservations: { execute: jest.fn() },
    }
    mockStreamText.mockReturnValue({
      fullStream: textStream('Needs lab lookup'),
      usage: Promise.resolve({}),
    })
    await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'user', content: '查用藥與檢驗' }],
      tools: tools as never,
      initialToolName: 'queryMedications',
      preExecuteInitialTool: true,
      translations,
      idleMs: 1_000,
      abortController: new AbortController(),
    })
    const request = mockStreamText.mock.calls[0][0]
    expect(Object.keys(request.tools)).toEqual(Object.keys(tools))
    expect(request.stopWhen).toHaveLength(2)
    expect(JSON.stringify(request.messages)).toContain('Unqueried resource types are unknown, not empty')
  })

  it('surfaces a second idle timeout instead of treating it as a user abort', async () => {
    const execute = jest.fn().mockResolvedValue({ success: true, data: {} })
    mockStreamText.mockReturnValue({
      fullStream: stalledStream,
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    })

    const run = runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'user', content: 'health summary' }],
      tools: { getHealthSummarySnapshot: { execute } } as never,
      initialToolName: 'getHealthSummarySnapshot',
      preExecuteInitialTool: true,
      translations,
      idleMs: 10,
      abortController: new AbortController(),
    })

    await expect(run).rejects.toBeInstanceOf(StreamIdleTimeoutError)
    expect(mockStreamText).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('repeatedToolCallIs', () => {
  const step = (toolName: string, input: unknown) => ({
    toolCalls: [{ toolName, input }],
  }) as never

  it('stops consecutive equivalent calls even when object key order differs', () => {
    const stop = repeatedToolCallIs(2)

    expect(stop({ steps: [
      step('queryMedications', { status: 'active', range: { end: 2, start: 1 } }),
      step('queryMedications', { range: { start: 1, end: 2 }, status: 'active' }),
    ] })).toBe(true)
  })

  it('lets a model repeat a query once by default and stops on the third identical batch', () => {
    const stop = repeatedToolCallIs()
    const same = step('queryMedications', { status: 'active' })
    const other = step('queryLabResultsByCategory', { status: 'active' })

    expect(stop({ steps: [same, same] })).toBe(false)
    expect(stop({ steps: [same, same, other] })).toBe(false)
    expect(stop({ steps: [other, same, same, same] })).toBe(true)
  })

  it('allows a model to refine the tool or its arguments', () => {
    const stop = repeatedToolCallIs(2)

    expect(stop({ steps: [
      step('queryMedications', { status: 'active' }),
      step('queryMedications', { status: 'completed' }),
    ] })).toBe(false)
    expect(stop({ steps: [
      step('queryMedications', { status: 'active' }),
      step('queryLabResultsByCategory', { status: 'active' }),
    ] })).toBe(false)
  })
})

describe('runDeepModeAgent repeated-query stop', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const usage = Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })
  const same = { toolCalls: [{ toolName: 'queryMedications', input: { status: 'active' } }] } as never

  it('tells the model and the reader when the tool loop was stopped for repeating a query', async () => {
    const events: Array<{ type: string; state?: string }> = []
    async function* round1() {
      yield { type: 'tool-call', toolName: 'queryMedications', input: { status: 'active' } }
      yield { type: 'tool-result', toolName: 'queryMedications', result: { success: true, data: [] } }
      // The SDK evaluates stopWhen after each step; simulate the third identical one.
      const stopWhen = mockStreamText.mock.calls[0][0].stopWhen as Array<(c: unknown) => boolean>
      expect(stopWhen[1]({ steps: [same, same, same] })).toBe(true)
    }
    mockStreamText
      .mockReturnValueOnce({ fullStream: round1(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Answer from retrieved data'), usage })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Q' }],
      tools: {} as never,
      translations: { ...translations, repeatedQueryStopped: 'Stopped: repeated query', repeatedQueryHint: '\n\nHINT' },
      idleMs: 1000,
      abortController: new AbortController(),
      onEvent: (e) => events.push(e as never),
    })

    expect(events.some((e) => e.type === 'status' && e.state?.includes('Stopped: repeated query'))).toBe(true)
    const followUp = mockStreamText.mock.calls[1][0].messages as Array<{ role: string; content: string }>
    expect(followUp[followUp.length - 1].content).toContain('HINT')
    expect(mockStreamText.mock.calls[1][0].tools).toBeUndefined()
    expect(JSON.stringify(followUp)).not.toContain('Continue using available tools')
    expect(result.answer).toBe('Answer from retrieved data\n\n_Stopped: repeated query_')
  })

  it('stays silent when the loop ended for another reason', async () => {
    const events: Array<{ type: string; state?: string }> = []
    async function* round1() {
      yield { type: 'tool-call', toolName: 'queryMedications', input: { status: 'active' } }
      yield { type: 'tool-result', toolName: 'queryMedications', result: { success: true, data: [] } }
      const stopWhen = mockStreamText.mock.calls[0][0].stopWhen as Array<(c: unknown) => boolean>
      expect(stopWhen[1]({ steps: [same] })).toBe(false)
    }
    mockStreamText
      .mockReturnValueOnce({ fullStream: round1(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Plain answer'), usage })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Q' }],
      tools: {} as never,
      translations: { ...translations, repeatedQueryStopped: 'Stopped: repeated query', repeatedQueryHint: '\n\nHINT' },
      idleMs: 1000,
      abortController: new AbortController(),
      onEvent: (e) => events.push(e as never),
    })

    expect(events.some((e) => e.state?.includes('Stopped: repeated query'))).toBe(false)
    const followUp = mockStreamText.mock.calls[1][0].messages as Array<{ role: string; content: string }>
    expect(followUp[followUp.length - 1].content).not.toContain('HINT')
    expect(result.answer).toBe('Plain answer')
  })
})

describe('runDeepModeAgent step-limit stop', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const usage = Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })
  const toolStep = { toolCalls: [{ toolName: 'getEncounterDetails', input: { encounterId: 'e' } }] }

  it('tells the model and the reader when the step ceiling ended the loop', async () => {
    const events: Array<{ type: string; state?: string }> = []
    async function* round1() {
      yield { type: 'tool-call', toolName: 'getEncounterDetails', input: { encounterId: 'e' } }
      yield { type: 'tool-result', toolName: 'getEncounterDetails', result: { success: true, data: {} } }
      // The SDK reports every finished step; ten tool-calling steps is the ceiling.
      const onStepFinish = mockStreamText.mock.calls[0][0].onStepFinish as (s: unknown) => void
      for (let i = 0; i < 10; i += 1) onStepFinish(toolStep)
    }
    mockStreamText
      .mockReturnValueOnce({ fullStream: round1(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Partial answer'), usage })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Q' }],
      tools: {} as never,
      translations: { ...translations, stepLimitReached: 'Stopped: step limit', stepLimitHint: '\n\nLIMIT-HINT' },
      idleMs: 1000,
      abortController: new AbortController(),
      onEvent: (e) => events.push(e as never),
    })

    expect(events.some((e) => e.type === 'status' && e.state?.includes('Stopped: step limit'))).toBe(true)
    const followUp = mockStreamText.mock.calls[1][0].messages as Array<{ role: string; content: string }>
    expect(followUp[followUp.length - 1].content).toContain('LIMIT-HINT')
    expect(result.answer).toBe('Partial answer\n\n_Stopped: step limit_')
  })

  it('does not treat a model that finished with tool calls before the ceiling as cut off', async () => {
    const events: Array<{ type: string; state?: string }> = []
    async function* round1() {
      yield { type: 'tool-call', toolName: 'getEncounterDetails', input: { encounterId: 'e' } }
      yield { type: 'tool-result', toolName: 'getEncounterDetails', result: { success: true, data: {} } }
      const onStepFinish = mockStreamText.mock.calls[0][0].onStepFinish as (s: unknown) => void
      for (let i = 0; i < 3; i += 1) onStepFinish(toolStep)
    }
    mockStreamText
      .mockReturnValueOnce({ fullStream: round1(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Plain answer'), usage })

    const result = await runDeepModeAgent({
      model: {} as never,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Q' }],
      tools: {} as never,
      translations: { ...translations, stepLimitReached: 'Stopped: step limit', stepLimitHint: '\n\nLIMIT-HINT' },
      idleMs: 1000,
      abortController: new AbortController(),
      onEvent: (e) => events.push(e as never),
    })

    expect(events.some((e) => e.state?.includes('Stopped: step limit'))).toBe(false)
    expect(result.answer).toBe('Plain answer')
  })
})

describe('turn recovery budget', () => {
  const result = { success: true, count: 0, data: [], availableObservationRecovery: { data: [{ name: 'TG', value: 103 }] } }
  it('sends identical inventory once per turn while preserving match semantics', () => {
    const bound = createObservationRecoveryBudget()
    expect(bound(result)).toBe(result)
    expect(bound(result)).toMatchObject({ success: true, count: 0, data: [], observationRecoveryNotice: expect.stringContaining('already returned') })
    expect((bound(result) as any).availableObservationRecovery).toBeUndefined()
    expect(createObservationRecoveryBudget()(result)).toBe(result)
  })
  it('caps total recovery characters even for different inventories', () => {
    const bound = createObservationRecoveryBudget(JSON.stringify(result.availableObservationRecovery).length)
    expect(bound(result)).toBe(result)
    const next = { ...result, availableObservationRecovery: { data: [{ name: 'ALT', value: 122 }] } }
    expect(bound(next)).toMatchObject({ observationRecoveryNotice: expect.stringContaining('budget is exhausted') })
    expect(bound({ success: true, data: [{ value: 122 }] })).toEqual({ success: true, data: [{ value: 122 }] })
  })
})

describe('prefetched multi-step follow-up safeguards', () => {
  const usage = Promise.resolve({ inputTokens: 1, outputTokens: 1 })
  const toolStep = { toolCalls: [{ toolName: 'queryObservations', input: {} }] }
  const params = () => ({
    model: {} as never,
    messages: [{ role: 'user' as const, content: '查基本資料、檢驗與用藥' }],
    tools: {
      getDataOverview: { execute: jest.fn().mockResolvedValue({ success: true, data: { observations: 12 } }) },
      queryObservations: { execute: jest.fn() },
    } as never,
    initialToolName: 'getDataOverview', preExecuteInitialTool: true,
    translations: { ...translations, stepLimitReached: 'STEP LIMIT', stepLimitHint: '\nLIMIT-HINT', repeatedQueryStopped: 'REPEAT STOP', repeatedQueryHint: '\nREPEAT-HINT' },
    idleMs: 1000, abortController: new AbortController(),
  })
  beforeEach(() => jest.clearAllMocks())

  it.each(['limit', 'repeat'])('synthesizes after a tool-ending preamble and exposes the %s stop', async (reason) => {
    async function* lookup() {
      yield { type: 'text-delta', text: '我再查檢驗…' }
      yield { type: 'tool-call', toolName: 'queryObservations', input: {} }
      yield { type: 'tool-result', toolName: 'queryObservations', output: { success: true, count: 1, data: [{ value: 103 }] } }
      const request = mockStreamText.mock.calls[0][0]
      if (reason === 'repeat') request.stopWhen[1]({ steps: [toolStep, toolStep, toolStep] })
      for (let i = 0; i < (reason === 'limit' ? 9 : 3); i++) request.onStepFinish(toolStep)
    }
    mockStreamText.mockReturnValueOnce({ fullStream: lookup(), usage })
      .mockReturnValueOnce({ fullStream: textStream('已有檢驗，其他項目未完成查詢'), usage })
    const result = await runDeepModeAgent(params())
    expect(mockStreamText).toHaveBeenCalledTimes(2)
    expect(stepCountIs).toHaveBeenCalledWith(9)
    const synthesis = mockStreamText.mock.calls[1][0]
    expect(synthesis.tools).toBeUndefined()
    expect(JSON.stringify(synthesis.messages)).not.toContain('Continue using available tools')
    expect(JSON.stringify(synthesis.messages)).toContain(reason === 'limit' ? 'LIMIT-HINT' : 'REPEAT-HINT')
    expect(result.answer).toContain('已有檢驗')
    expect(result.answer).toContain(reason === 'limit' ? 'STEP LIMIT' : 'REPEAT STOP')
    expect(result.trajectory).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool-result', toolName: 'queryObservations' })]))
  })

  it('does not replay a failed follow-up after any tool call', async () => {
    async function* lookup() {
      yield { type: 'tool-call', toolName: 'queryObservations', input: {} }
      yield { type: 'tool-result', toolName: 'queryObservations', output: { success: true, count: 0, data: [] } }
      throw new Error('provider failed after executing tool')
    }
    mockStreamText.mockReturnValue({ fullStream: lookup(), usage })
    await expect(runDeepModeAgent(params())).rejects.toThrow('provider failed')
    expect(mockStreamText).toHaveBeenCalledTimes(1)
  })
})

describe('review regression cases', () => {
  const usage = Promise.resolve({})
  const params = () => ({
    model: {} as never, messages: [{ role: 'user' as const, content: 'Q' }],
    tools: { queryObservations: { execute: jest.fn() } } as never,
    translations: { ...translations, answerQuestionCitationsHint: 'KEEP REFERENCES' },
    idleMs: 1000, abortController: new AbortController(),
  })
  beforeEach(() => jest.clearAllMocks())

  it.each(['getDataOverview', 'queryImagingRecords'])('does not requery a complete single %s prefetch', async (name) => {
    mockStreamText.mockReturnValue({ fullStream: textStream('Answer'), usage })
    const execute = jest.fn().mockResolvedValue({ success: true, count: 1, data: [{ id: 'one' }] })
    await runDeepModeAgent({ ...params(), tools: { [name]: { execute } } as never, initialToolName: name, preExecuteInitialTool: true })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockStreamText.mock.calls[0][0].tools).toBeUndefined()
  })

  it.each([
    { success: false }, { incomplete: true }, { canConcludeAbsence: false },
    { truncated: true }, { truncated: { imaging: true } }, { hasMore: true },
    { data: Array.from({ length: 11 }, (_, id) => ({ id })) },
  ])('allows refinement of partial single-tool evidence %j', async (partial) => {
    mockStreamText.mockReturnValue({ fullStream: textStream('Partial'), usage })
    await runDeepModeAgent({ ...params(), tools: { queryImagingRecords: { execute: jest.fn().mockResolvedValue({ success: true, ...partial }) } } as never,
      initialToolName: 'queryImagingRecords', preExecuteInitialTool: true })
    expect(mockStreamText.mock.calls[0][0].tools).toHaveProperty('queryImagingRecords')
  })

  it.each([false, true])('finishes an all-failed tool round (preamble=%s)', async (preamble) => {
    const events: Array<{ type: string }> = []
    async function* failure() {
      if (preamble) yield { type: 'text-delta', text: 'Checking…' }
      yield { type: 'tool-call', toolName: 'queryObservations', input: {} }
      yield { type: 'tool-error', toolName: 'queryObservations', error: new Error('private provider details') }
      mockStreamText.mock.calls[0][0].onStepFinish({ toolCalls: [{ toolName: 'queryObservations' }] })
    }
    mockStreamText.mockReturnValueOnce({ fullStream: failure(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Unable to verify labs'), usage })
    const result = await runDeepModeAgent({ ...params(), onEvent: e => events.push(e) })
    expect(result.answer).toBe('Unable to verify labs')
    expect(events.filter(e => e.type === 'final')).toHaveLength(1)
    const messages = JSON.stringify(mockStreamText.mock.calls[1][0].messages)
    expect(messages).toContain('requested facts remain unverified')
    expect(messages).not.toContain('private provider details')
    expect(result.trajectory).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool-result', result: expect.objectContaining({ success: false, canConcludeAbsence: false }) })]))
  })

  it('synthesizes failed follow-up evidence without replaying the tool call', async () => {
    async function* failure() {
      yield { type: 'tool-call', toolName: 'queryObservations', input: {} }
      yield { type: 'tool-error', toolName: 'queryObservations', error: new Error('failed') }
      mockStreamText.mock.calls[0][0].onStepFinish({ toolCalls: [{ toolName: 'queryObservations' }] })
    }
    mockStreamText.mockReturnValueOnce({ fullStream: failure(), usage })
      .mockReturnValueOnce({ fullStream: textStream('Labs unverified'), usage })
    const result = await runDeepModeAgent({ ...params(), initialToolName: 'getDataOverview', preExecuteInitialTool: true,
      tools: { getDataOverview: { execute: jest.fn().mockResolvedValue({ success: true, data: {} }) }, queryObservations: { execute: jest.fn() } } as never })
    expect(mockStreamText).toHaveBeenCalledTimes(2)
    expect(mockStreamText.mock.calls[1][0].tools).toBeUndefined()
    expect(JSON.stringify(mockStreamText.mock.calls[1][0].messages)).toContain('requested facts remain unverified')
    expect(result.answer).toBe('Labs unverified')
  })

  it.each([1, 2])('preserves the citation hint in synthesis for literature from round %s', async (literatureRound) => {
    async function* round(n: number) {
      yield { type: 'tool-result', toolName: literatureRound === n ? 'searchMedicalLiterature' : 'queryObservations',
        output: literatureRound === n ? { success: true, content: 'Reference [1]', citations: ['https://example.org/paper'] } : { success: true, count: 1, data: [{ value: 103 }] } }
    }
    mockStreamText.mockReturnValueOnce({ fullStream: round(1), usage })
      .mockReturnValueOnce({ fullStream: round(2), usage })
      .mockReturnValueOnce({ fullStream: textStream('Evidence [1]'), usage })
    const result = await runDeepModeAgent(params())
    expect(JSON.stringify(mockStreamText.mock.calls[2][0].messages)).toContain('KEEP REFERENCES')
    expect(result.answer).toContain('[[1]](https://example.org/paper)')
  })
})
