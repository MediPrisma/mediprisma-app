import { act, renderHook, waitFor } from '@testing-library/react'
import { useUnifiedAi } from '@/src/application/hooks/ai/use-unified-ai.hook'
import { CUSTOM_OPENAI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
import { createModelExecution, reportModelExecution } from '@/src/shared/utils/ai-model-execution'
import { beginCollectorObservation, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { withCollectorOperation } from '@/src/application/telemetry/collector-operation'
import { mockCollectorPermission } from '../../../helpers/collector-permissions'

const mockStream = jest.fn()
const mockQuery = jest.fn()

interface MockAiConfigState {
  apiKey: string | null
  geminiKey: string | null
  claudeKey: string | null
  openAiCompatibleProfiles: OpenAiCompatibleProfile[]
}

const mockStoreListeners = new Set<(
  state: MockAiConfigState,
  previousState: MockAiConfigState,
) => void>()
let mockAiConfigState: MockAiConfigState = {
  apiKey: 'openai-key',
  geminiKey: '',
  claudeKey: '',
  openAiCompatibleProfiles: [],
}

function setMockAiConfigState(next: Partial<MockAiConfigState>) {
  const previousState = mockAiConfigState
  mockAiConfigState = { ...mockAiConfigState, ...next }
  for (const listener of mockStoreListeners) listener(mockAiConfigState, previousState)
}

jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: async () => ({ getToken: async () => 'synthetic-firebase-token' }),
}))

jest.mock('@/src/application/stores/ai-config.store', () => ({
  useAiConfigStore: Object.assign(jest.fn(), {
    getState: () => mockAiConfigState,
    subscribe: (listener: (
      state: MockAiConfigState,
      previousState: MockAiConfigState,
    ) => void) => {
      mockStoreListeners.add(listener)
      return () => mockStoreListeners.delete(listener)
    },
  }),
}))
jest.mock('@/src/infrastructure/ai/services/ai.service', () => ({
  AiService: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('@/src/core/use-cases/ai/query-ai.use-case', () => ({
  QueryAiUseCase: jest.fn().mockImplementation(() => ({ execute: mockQuery })),
}))
jest.mock('@/src/infrastructure/ai/streaming/stream-orchestrator', () => ({
  StreamOrchestrator: jest.fn().mockImplementation(() => ({ stream: mockStream })),
}))

describe('useUnifiedAi cancellation', () => {
  it('real hook scopes failed and retried transports into one parent event', async () => {
    const permission = mockCollectorPermission()
    window.history.replaceState({}, '', '/?site=vghtpe')
    jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
    const timeout = new Error('SYNTHETIC-PRIVATE-TIMEOUT')
    timeout.name = 'TimeoutError'
    mockStream.mockRejectedValueOnce(timeout).mockImplementationOnce(async options => { options.onChunk('SYNTHETIC-PRIVATE-ANSWER') })
    try {
      const parent = beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'feature', mode: 'structured' })
      const { result } = renderHook(() => useUnifiedAi())
      const ai = withCollectorOperation(result.current, parent.operation)
      await act(async () => {
        await expect(ai.stream([{ role: 'user', content: 'SYNTHETIC-PRIVATE-PROMPT' }], { diagnosticFeature: 'medical-summary', throwOnAbort: true })).rejects.toBe(timeout)
        expect(await ai.stream([{ role: 'user', content: 'SYNTHETIC-PRIVATE-RETRY' }], { diagnosticFeature: 'medical-summary', throwOnAbort: true })).toBe('SYNTHETIC-PRIVATE-ANSWER')
      })
      expect(fetch).not.toHaveBeenCalled()
      parent.finish({ outcome: 'ok', summaryCards: { succeeded: 6, failed: 0 } })
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      const event = JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)
      expect(event).toMatchObject({ schema_version: 6, sample_kind: 'feature',
        diagnostics: { requests: { count: 2, omitted: 0, details: [
          { status: 'error', error_class: 'timeout' }, { status: 'completed', response_complete: true },
        ] } } })
      expect(JSON.stringify(event)).not.toMatch(/SYNTHETIC-PRIVATE/)
      expect(result.current.isLoading).toBe(false)
    } finally { cancelCollectorRequests(); permission.restore(); window.history.replaceState({}, '', '/') }
  })
  it.each(['query', 'stream'] as const)('completes %s while an enabled collector is offline, without forwarding full diagnostics', async (transport) => {
    const permission = mockCollectorPermission()
    window.history.replaceState({}, '', '/?site=vghtpe')

    jest.mocked(fetch).mockRejectedValue(new Error('collector offline'))
    if (transport === 'query') mockQuery.mockResolvedValueOnce({ text: 'SYNTHETIC-ANSWER', metadata: {} })
    else mockStream.mockImplementationOnce(async (options) => { options.onChunk('SYNTHETIC-ANSWER') })
    try {
      const { result } = renderHook(() => useUnifiedAi())
      let answer: string | undefined
      await act(async () => {
        answer = await result.current[transport]([{ role: 'user', content: 'SYNTHETIC-CLINICAL-TEXT' }], {
          modelId: 'gpt-5.4-nano', operationKey: 'SYNTHETIC-PATIENT-ID', diagnosticFeature: 'medical-summary',
        })
      })
      expect(answer).toBe('SYNTHETIC-ANSWER')
      expect(result.current.error).toBeNull()
      expect(result.current.isLoading).toBe(false)
      await waitFor(() => expect(fetch).toHaveBeenCalled())
      const wire = String(jest.mocked(fetch).mock.calls.at(-1)?.[1]?.body)
      expect(wire).not.toMatch(/SYNTHETIC-CLINICAL-TEXT|SYNTHETIC-PATIENT-ID|SYNTHETIC-ANSWER|messages|outputData/)
      expect(JSON.parse(wire)).toMatchObject({ feature: 'summary', sample_kind: 'request', status: 'completed' })
    } finally { cancelCollectorRequests(); permission.restore(); window.history.replaceState({}, '', '/') }
  })
  it.each(['stream', 'query'] as const)('keeps actual provenance in %s diagnostics and forwards it to result owners', async (transport) => {
    const execution = reportModelExecution(createModelExecution('gemini-3.8-flash'), 'gemini-3.1-flash-lite')
    if (transport === 'stream') mockStream.mockImplementationOnce(async (options) => {
      options.onModelExecution(execution)
      options.onChunk('actual Lite answer')
    })
    else mockQuery.mockResolvedValueOnce({ text: 'actual Lite answer', metadata: { modelId: 'gemini-3.1-flash-lite', modelExecution: execution } })
    const onModelExecution = jest.fn()
    const { result } = renderHook(() => useUnifiedAi())
    await act(async () => {
      await result.current[transport]([{ role: 'user', content: 'hello' }], { modelId: 'gemini-3.8-flash', onModelExecution })
    })
    expect(onModelExecution).toHaveBeenCalledWith(execution)
    expect(useAiExecutionDiagnosticsStore.getState().records.at(-1)).toMatchObject({
      modelId: 'gemini-3.1-flash-lite', modelName: 'Gemini 3.1 Flash-Lite', modelExecution: execution,
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockStoreListeners.clear()
    mockAiConfigState = {
      apiKey: 'openai-key',
      geminiKey: '',
      claudeKey: '',
      openAiCompatibleProfiles: [],
    }
  })

  it('throws after an adapter resolves an aborted structured stream', async () => {
    let finishStream!: () => void
    mockStream.mockImplementationOnce(async (options: {
      onChunk: (chunk: string) => void
    }) => {
      options.onChunk('{"partial":true')
      await new Promise<void>((resolve) => { finishStream = resolve })
    })
    const onComplete = jest.fn()
    const { result } = renderHook(() => useUnifiedAi())

    let streaming!: Promise<string>
    act(() => {
      streaming = result.current.stream(
        [{ role: 'user', content: 'summarise' }],
        {
          modelId: 'gpt-5.4-nano',
          throwOnAbort: true,
          onComplete,
        },
      )
    })
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(1))

    act(() => result.current.stop())
    let rejection: unknown
    await act(async () => {
      finishStream()
      try {
        await streaming
      } catch (error) {
        rejection = error
      }
    })

    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).name).toBe('AbortError')
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })

  it('captures fresh credentials and forwards request policy options for every stream', async () => {
    mockStream.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useUnifiedAi())
    const capturedStream = result.current.stream

    act(() => setMockAiConfigState({ apiKey: 'replacement-openai-key' }))
    await act(async () => {
      await capturedStream(
        [{ role: 'user', content: 'structured summary' }],
        {
          modelId: 'gpt-5.6-terra',
          temperature: 0.2,
          maxTokens: 2048,
          responseFormat: 'json',
        },
      )
    })

    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-terra',
      apiKey: 'replacement-openai-key',
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: 'json',
    }))
  })

  it('stops only the requested generation slot and leaves background work running', async () => {
    let finishFirst!: () => void
    let finishSecond!: () => void
    const signals: AbortSignal[] = []
    mockStream
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        await new Promise<void>((resolve) => { finishFirst = resolve })
      })
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        await new Promise<void>((resolve) => { finishSecond = resolve })
      })
    const { result } = renderHook(() => useUnifiedAi())

    let first!: Promise<string>
    let second!: Promise<string>
    act(() => {
      first = result.current.stream(
        [{ role: 'user', content: 'scope one' }],
        { modelId: 'gpt-5.4-nano', operationKey: 'slot-one', throwOnAbort: true },
      )
      second = result.current.stream(
        [{ role: 'user', content: 'scope two' }],
        { modelId: 'gpt-5.4-nano', operationKey: 'slot-two', throwOnAbort: true },
      )
    })
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2))

    act(() => result.current.stop('slot-two'))
    expect(signals[0]?.aborted).toBe(false)
    expect(signals[1]?.aborted).toBe(true)
    expect(result.current.isLoading).toBe(true)

    let secondError: unknown
    await act(async () => {
      finishSecond()
      try {
        await second
      } catch (error) {
        secondError = error
      }
    })
    expect((secondError as Error).name).toBe('AbortError')
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      finishFirst()
      await first
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('lets a caller abort only one transport attempt with its own signal', async () => {
    let finishStream!: () => void
    let requestSignal!: AbortSignal
    mockStream.mockImplementationOnce(async (options: { signal: AbortSignal }) => {
      requestSignal = options.signal
      await new Promise<void>((resolve) => { finishStream = resolve })
    })
    const attemptController = new AbortController()
    const { result } = renderHook(() => useUnifiedAi())

    let streaming!: Promise<string>
    act(() => {
      streaming = result.current.stream(
        [{ role: 'user', content: 'summary attempt' }],
        {
          modelId: 'gpt-5.4-nano',
          operationKey: 'summary-slot',
          signal: attemptController.signal,
          throwOnAbort: true,
        },
      )
    })
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(1))

    act(() => attemptController.abort())
    expect(requestSignal.aborted).toBe(true)

    let rejection: unknown
    await act(async () => {
      finishStream()
      try {
        await streaming
      } catch (error) {
        rejection = error
      }
    })
    expect((rejection as Error).name).toBe('AbortError')
    expect(result.current.isLoading).toBe(false)
  })

  it('fails closed before streaming when a captured custom-model callback loses its profile', async () => {
    const profile: OpenAiCompatibleProfile = {
      profileId: 'legacy',
      enabled: true,
      baseUrl: 'https://hospital.example/v1',
      modelId: 'hospital-7b',
      apiKey: 'local-key',
      transport: 'direct',
      contextWindowTokens: 32768,
      contextWindowSource: 'manual',
    }
    setMockAiConfigState({ openAiCompatibleProfiles: [profile] })
    const { result } = renderHook(() => useUnifiedAi())
    const capturedStream = result.current.stream

    act(() => setMockAiConfigState({ openAiCompatibleProfiles: [] }))

    let rejection: unknown
    await act(async () => {
      try {
        await capturedStream(
          [{ role: 'user', content: 'clinical data' }],
          { modelId: CUSTOM_OPENAI_MODEL_ID, throwOnAbort: true },
        )
      } catch (error) {
        rejection = error
      }
    })

    expect(rejection).toEqual(expect.objectContaining({
      message: 'OpenAI-compatible endpoint is not configured',
    }))
    expect(mockStream).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })

  it('aborts an in-flight request when its exact custom profile is replaced', async () => {
    const profile: OpenAiCompatibleProfile = {
      profileId: 'legacy',
      enabled: true,
      baseUrl: 'https://hospital.example/v1',
      modelId: 'hospital-7b',
      apiKey: 'old-key',
      transport: 'direct',
      contextWindowTokens: 32768,
      contextWindowSource: 'manual',
    }
    setMockAiConfigState({ openAiCompatibleProfiles: [profile] })
    let finishStream!: () => void
    let requestSignal!: AbortSignal
    mockStream.mockImplementationOnce(async (options: { signal: AbortSignal }) => {
      requestSignal = options.signal
      await new Promise<void>((resolve) => { finishStream = resolve })
    })
    const { result } = renderHook(() => useUnifiedAi())

    let streaming!: Promise<string>
    act(() => {
      streaming = result.current.stream(
        [{ role: 'user', content: 'clinical data' }],
        { modelId: CUSTOM_OPENAI_MODEL_ID, throwOnAbort: true },
      )
    })
    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(1))

    act(() => setMockAiConfigState({
      openAiCompatibleProfiles: [{
        ...profile,
        baseUrl: 'https://replacement.example/v1',
      }],
    }))
    expect(requestSignal.aborted).toBe(true)

    let rejection: unknown
    await act(async () => {
      finishStream()
      try {
        await streaming
      } catch (error) {
        rejection = error
      }
    })

    expect((rejection as Error).name).toBe('AbortError')
    expect(result.current.isLoading).toBe(false)
  })
})
