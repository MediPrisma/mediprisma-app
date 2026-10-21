import { act, renderHook, waitFor } from "@testing-library/react"
import { useInsightGeneration } from "@/features/clinical-insights/hooks/useInsightGeneration"
import { useInsightResponsesStore } from "@/features/clinical-insights/hooks/useInsightResponsesStore"
import { AiError, AiErrorCode } from "@/src/core/errors"
import { stopProgressiveImport, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'

const mockQuery = jest.fn()
const mockStop = jest.fn()

jest.mock("@/src/application/hooks/ai/use-unified-ai.hook", () => ({
  useUnifiedAi: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  }),
}))

jest.mock("@/src/application/hooks/clinical-insights/use-generate-insight.hook", () => ({
  useGenerateInsight: () => ({
    validate: () => ({ valid: true }),
    buildMessages: () => [{ role: "user", content: "summarize" }],
    buildMetadata: (modelId: string) => ({ modelId, provider: "openai" }),
  }),
}))

jest.mock("@/src/application/providers/language.provider", () => ({
  useLanguage: () => ({ locale: "zh-TW" }),
}))

jest.mock("@/src/shared/utils/context-budget", () => ({
  preflightContextWarning: () => null,
}))

describe("useInsightGeneration provenance", () => {
  beforeEach(() => {
    useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-27T06:32:00.000Z"))
    jest.clearAllMocks()
    useInsightResponsesStore.setState({
      responses: {},
      panelStatus: {},
      ownerPatientId: "patient-1",
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const safetyOptions = () => ({
    panels: ['first', 'second'].map(id => ({ id, title: id, prompt: 'synthetic summary', outputFormat: 'plain-text' as const, languagePolicy: 'follow-template' as const })),
    prompts: {}, context: 'synthetic context', piiLiterals: [], model: 'gpt-5.6-luna', modelName: 'GPT',
    contextLimit: 120_000, contextAdaptation: null, inputSignature: 'synthetic-input',
  })

  it.each(['patient-changed', 'privacy-stale'] as const)('stops automatic custom batches on %s without publishing late text or starting another module', async phase => {
    let finish!: (value: string) => void
    mockQuery.mockReset().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'import-a', phase: 'waiting' } })
    const { result } = renderHook(() => useInsightGeneration(safetyOptions()))
    let generation!: Promise<void>
    act(() => { generation = result.current.runPanels(['first', 'second'], { automatic: true }) })
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    mockStop.mockClear()
    act(() => stopProgressiveImport('run-a', phase))
    expect(mockStop).toHaveBeenCalledTimes(1)
    await act(async () => { finish('late automatic text'); await generation })
    expect(useInsightResponsesStore.getState().responses).toEqual({})
    expect(mockQuery).toHaveBeenCalledTimes(1)
    mockQuery.mockResolvedValueOnce('explicit manual text')
    await act(async () => result.current.runPanel('first', { force: true }))
    expect(useInsightResponsesStore.getState().responses.first.text).toBe('explicit manual text')
  })

  it('does not cancel a newer explicit manual batch when an older automatic batch receives a safety stop', async () => {
    let finishAuto!: (value: string) => void, finishManual!: (value: string) => void
    mockQuery.mockReset()
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishAuto = resolve }))
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishManual = resolve }))
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'import-a', phase: 'waiting' } })
    const { result } = renderHook(() => useInsightGeneration(safetyOptions()))
    let automatic!: Promise<void>, manual!: Promise<void>
    act(() => { automatic = result.current.runPanels(['first'], { automatic: true }) })
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    act(() => { manual = result.current.runPanel('first', { force: true }) })
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
    mockStop.mockClear()
    act(() => stopProgressiveImport('run-a', 'privacy-stale'))
    expect(mockStop).not.toHaveBeenCalled()
    await act(async () => { finishAuto('old automatic'); finishManual('new manual'); await Promise.all([automatic, manual]) })
    expect(useInsightResponsesStore.getState().responses.first.text).toBe('new manual')
  })

  it("captures the immutable model, completion time and request duration per module", async () => {
    let finishQuery!: (value: string) => void
    mockQuery.mockImplementationOnce(() => new Promise<string>((resolve) => {
      finishQuery = resolve
    }))

    const { result } = renderHook(() => useInsightGeneration({
      panels: [{
        id: "changes",
        title: "變化摘要",
        prompt: "比較近期變化",
        outputFormat: "plain-text",
        languagePolicy: "follow-template",
      }],
      prompts: { changes: "比較近期變化" },
      context: "clinical context",
      piiLiterals: [],
      model: "gpt-5.6-luna",
      modelName: "GPT-5.6 Luna",
      contextLimit: 120_000,
      contextAdaptation: null,
      inputSignature: "input-1",
    }))

    let generation!: Promise<void>
    act(() => {
      generation = result.current.runPanel("changes", { force: true })
    })

    await waitFor(() => {
      expect(useInsightResponsesStore.getState().panelStatus.changes?.activeGeneration)
        .toMatchObject({
          id: "1:changes",
          modelName: "GPT-5.6 Luna",
          startedAt: new Date("2026-08-27T06:32:00.000Z").getTime(),
        })
    })

    await act(async () => {
      jest.setSystemTime(new Date("2026-08-27T06:32:18.400Z"))
      finishQuery("generated summary")
      await generation
    })

    expect(useInsightResponsesStore.getState().responses.changes).toEqual({
      text: "generated summary",
      isEdited: false,
      metadata: {
        source: "live",
        modelId: "gpt-5.6-luna",
        provider: "openai",
        modelName: "GPT-5.6 Luna",
        modelExecution: { requestedModelId: "gpt-5.6-luna", routedModelId: "gpt-5.6-luna", actualModelId: null, actualModelIds: [] },
        generatedAt: new Date("2026-08-27T06:32:18.400Z").getTime(),
        durationMs: 18_400,
        outputFormat: "plain-text",
        languagePolicy: "follow-template",
      },
    })
    expect(useInsightResponsesStore.getState().panelStatus.changes).toEqual({
      isLoading: false,
      error: null,
    })
  })

  it("bounds local custom summary output at 4,096 tokens", async () => {
    mockQuery.mockResolvedValueOnce("generated summary")

    const { result } = renderHook(() => useInsightGeneration({
      panels: [{
        id: "soap",
        title: "SOAP",
        prompt: "Generate SOAP",
        outputFormat: "markdown",
        languagePolicy: "interface-language",
      }],
      prompts: { soap: "Generate SOAP" },
      context: "clinical context",
      piiLiterals: [],
      model: "openai-compatible-custom:vghtpe-tvghbrain",
      modelName: "Tvghbrain 3.5",
      contextLimit: 262_144,
      contextAdaptation: null,
      inputSignature: "input-local",
    }))

    await act(async () => {
      await result.current.runPanel("soap", { force: true })
    })

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0][1]).toMatchObject({
      modelId: "openai-compatible-custom:vghtpe-tvghbrain",
      temperature: 0,
      maxTokens: 4096,
      allowTruncatedOutput: true,
      reasoningEffort: "low",
      // The collector names the template so the admin page can find which one failed.
      collectorContext: { template: { id: "soap", title: "SOAP" } },
    })
  })

  it("keeps partial local output and records that it was truncated", async () => {
    mockQuery.mockImplementationOnce(async (
      _messages: unknown,
      options: { onOutputTruncated?: (truncated: boolean) => void },
    ) => {
      options.onOutputTruncated?.(true)
      return "A:診斷\n部分內容"
    })

    const { result } = renderHook(() => useInsightGeneration({
      panels: [{
        id: "soap",
        title: "SOAP",
        prompt: "Generate SOAP",
        outputFormat: "markdown",
        languagePolicy: "interface-language",
      }],
      prompts: { soap: "Generate SOAP" },
      context: "clinical context",
      piiLiterals: [],
      model: "openai-compatible-custom:vghtpe-tvghbrain",
      modelName: "Tvghbrain 3.5",
      contextLimit: 262_144,
      contextAdaptation: null,
      inputSignature: "input-local",
    }))

    await act(async () => {
      await result.current.runPanel("soap", { force: true })
    })

    expect(useInsightResponsesStore.getState().responses.soap).toMatchObject({
      text: "A:診斷\n部分內容",
      metadata: { outputTruncated: true },
    })
    expect(useInsightResponsesStore.getState().panelStatus.soap.error).toBeNull()
  })

  it("keeps an empty truncation error when no partial text is available", async () => {
    const truncated = new AiError(
      'OpenAI-compatible local model output limit reached; response incomplete',
      AiErrorCode.OUTPUT_TRUNCATED,
    )
    mockQuery.mockRejectedValueOnce(truncated)

    const { result } = renderHook(() => useInsightGeneration({
      panels: [{
        id: "soap",
        title: "SOAP",
        prompt: "Generate SOAP",
        outputFormat: "markdown",
        languagePolicy: "interface-language",
      }],
      prompts: { soap: "Generate SOAP" },
      context: "clinical context",
      piiLiterals: [],
      model: "openai-compatible-custom:vghtpe-tvghbrain",
      modelName: "Tvghbrain 3.5",
      contextLimit: 262_144,
      contextAdaptation: null,
      inputSignature: "input-local",
    }))

    await act(async () => {
      await result.current.runPanel("soap", { force: true })
    })

    expect(useInsightResponsesStore.getState().panelStatus.soap.error).toBe(truncated)
    expect(useInsightResponsesStore.getState().responses.soap).toBeUndefined()
  })
})
