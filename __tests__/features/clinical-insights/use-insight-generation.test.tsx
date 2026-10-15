import { act, renderHook, waitFor } from "@testing-library/react"
import { useInsightGeneration } from "@/features/clinical-insights/hooks/useInsightGeneration"
import { useInsightResponsesStore } from "@/features/clinical-insights/hooks/useInsightResponsesStore"
import { AiError, AiErrorCode } from "@/src/core/errors"

const mockQuery = jest.fn()
const mockStop = jest.fn()
const mockBuildMessages = jest.fn((_input: unknown) => [{ role: "user", content: "summarize" }])
const mockLoadIcdCrosswalk = jest.fn()

jest.mock("@/src/infrastructure/terminology/icd-crosswalk.loader", () => ({
  loadIcdCrosswalk: () => mockLoadIcdCrosswalk(),
}))

jest.mock("@/src/application/hooks/ai/use-unified-ai.hook", () => ({
  useUnifiedAi: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  }),
}))

jest.mock("@/src/application/hooks/clinical-insights/use-generate-insight.hook", () => ({
  useGenerateInsight: () => ({
    validate: () => ({ valid: true }),
    buildMessages: (input: unknown) => mockBuildMessages(input),
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

  describe("ICD code reference", () => {
    const LOCAL_MODEL = "openai-compatible-custom:vghtpe-tvghbrain"
    const billed = "-     ICD codes on visit record (billing, not confirmed diagnoses): I10 - Essential hypertension"
    // Real CMS 2018 GEM rows for I10: three mutually exclusive candidates.
    const crosswalk = {
      map: { I10: ["4010 10000", "4011 10000", "4019 10000"] },
      names: {
        "4010": "Malignant essential hypertension",
        "4011": "Benign essential hypertension",
        "4019": "Unspecified essential hypertension",
      },
    }
    const render = (
      model: string,
      prompt: string,
      context = `Visits & Treatment History:\n${billed}`,
      panelIds = ["soap"],
    ) =>
      renderHook(() => useInsightGeneration({
        panels: panelIds.map((id) => ({
          id, title: id, prompt, outputFormat: "markdown" as const, languagePolicy: "interface-language" as const,
        })),
        prompts: Object.fromEntries(panelIds.map((id) => [id, prompt])),
        context,
        piiLiterals: [],
        model,
        modelName: "Tvghbrain 3.5",
        contextLimit: 262_144,
        contextAdaptation: null,
        inputSignature: "input-icd",
      }))
    const pendingDownload = () => {
      let finish!: (value: typeof crosswalk) => void
      mockLoadIcdCrosswalk.mockReturnValue(new Promise((resolve) => { finish = resolve }))
      return (value: typeof crosswalk) => finish(value)
    }

    beforeEach(() => {
      mockQuery.mockResolvedValue("generated summary")
      mockLoadIcdCrosswalk.mockResolvedValue(crosswalk)
    })

    it("adds the translated billed codes for a local model and an ICD-9 template", async () => {
      const { result } = render(LOCAL_MODEL, "A: ICD-9 block and ICD-10 block")
      await act(async () => { await result.current.runPanel("soap", { force: true }) })

      expect(mockLoadIcdCrosswalk).toHaveBeenCalledTimes(1)
      expect(mockBuildMessages.mock.calls[0][0]).toMatchObject({
        icdCodeReference: expect.stringContaining(
          "1. billed ICD-10-CM I10 Essential hypertension | ICD-9-CM ALTERNATIVES (at most one): " +
          "option 1: 401.0 MALIGNANT ESSENTIAL HYPERTENSION; option 2: 401.1 BENIGN ESSENTIAL HYPERTENSION; " +
          "option 3: 401.9 UNSPECIFIED ESSENTIAL HYPERTENSION\n",
        ),
      })
    })

    it.each([
      ["a frontier model", "gpt-5.6-luna", "A: ICD-9 block", undefined],
      ["a template without ICD-9", LOCAL_MODEL, "Summarize the record", undefined],
      ["a record without billed codes", LOCAL_MODEL, "A: ICD-9 block", "Lab Reports:\nnone"],
    ])("leaves the request unchanged for %s", async (_label, model, prompt, context) => {
      const { result } = render(model, prompt, context)
      await act(async () => { await result.current.runPanel("soap", { force: true }) })

      expect(mockLoadIcdCrosswalk).not.toHaveBeenCalled()
      expect(mockBuildMessages.mock.calls[0][0]).not.toHaveProperty("icdCodeReference")
    })

    it("still generates when the crosswalk cannot be loaded", async () => {
      mockLoadIcdCrosswalk.mockRejectedValueOnce(new Error("offline"))
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
      const { result } = render(LOCAL_MODEL, "A: ICD-9 block")
      await act(async () => { await result.current.runPanel("soap", { force: true }) })

      expect(mockBuildMessages.mock.calls[0][0]).not.toHaveProperty("icdCodeReference")
      expect(useInsightResponsesStore.getState().responses.soap?.text).toBe("generated summary")
      warn.mockRestore()
    })

    it("sends nothing for a patient who was switched away during the crosswalk download", async () => {
      const finishDownload = pendingDownload()
      const { result } = render(LOCAL_MODEL, "A: ICD-9 block")
      let generation!: Promise<void>
      act(() => { generation = result.current.runPanel("soap", { force: true }) })
      expect(useInsightResponsesStore.getState().panelStatus.soap).toMatchObject({ isLoading: true })

      // ClinicalInsightsRuntimeProvider's patient switch: stopAll, then a new owner.
      act(() => {
        result.current.stopAll()
        useInsightResponsesStore.getState().resetForPatient("patient-2")
      })
      await act(async () => {
        finishDownload(crosswalk)
        await generation
      })

      expect(mockBuildMessages).not.toHaveBeenCalled()
      expect(mockQuery).not.toHaveBeenCalled()
      expect(useInsightResponsesStore.getState().ownerPatientId).toBe("patient-2")
      expect(useInsightResponsesStore.getState().responses).toEqual({})
      expect(useInsightResponsesStore.getState().panelStatus).toEqual({})
    })

    it("sends nothing when the run is stopped during the crosswalk download", async () => {
      const finishDownload = pendingDownload()
      const { result } = render(LOCAL_MODEL, "A: ICD-9 block")
      let generation!: Promise<void>
      act(() => { generation = result.current.runPanel("soap", { force: true }) })

      act(() => { result.current.stopPanel("soap") })
      await act(async () => {
        finishDownload(crosswalk)
        await generation
      })

      expect(mockQuery).not.toHaveBeenCalled()
      expect(useInsightResponsesStore.getState().panelStatus.soap).toEqual({ isLoading: false, error: null })
      expect(useInsightResponsesStore.getState().responses.soap).toBeUndefined()
    })

    it("lets only the newer batch query when a second batch starts during the download", async () => {
      const finishDownload = pendingDownload()
      const { result } = render(LOCAL_MODEL, "A: ICD-9 block", undefined, ["soap", "plan"])
      let first!: Promise<void>
      let second!: Promise<void>
      act(() => { first = result.current.runPanel("soap", { force: true }) })
      act(() => { second = result.current.runPanel("plan", { force: true }) })
      await act(async () => {
        finishDownload(crosswalk)
        await Promise.all([first, second])
      })

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][1]).toMatchObject({ operationKey: "clinical-insight:patient-1:plan" })
      expect(useInsightResponsesStore.getState().responses.plan?.text).toBe("generated summary")
      expect(useInsightResponsesStore.getState().responses.soap).toBeUndefined()
      expect(useInsightResponsesStore.getState().panelStatus.soap).toEqual({ isLoading: false, error: null })
    })
  })
})
