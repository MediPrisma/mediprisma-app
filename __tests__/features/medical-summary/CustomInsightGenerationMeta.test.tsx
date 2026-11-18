import { act, render, screen } from "@testing-library/react"
import { CustomInsightGenerationMeta } from "@/features/medical-summary/components/CustomInsightGenerationMeta"
import { createModelExecution } from '@/src/shared/utils/ai-model-execution'

jest.mock("@/src/application/providers/language.provider", () => ({
  useLanguage: () => ({
    locale: "zh-TW",
    t: {
      medicalSummary: {
        summaryGenerationProvenance: "由 {model} 於 {time} 產生",
        summaryGenerationProvenanceWithDuration: "由 {model} 於 {time} 產生，總耗時 {duration}",
        summaryGenerationDateTimeInline: "{time}",
        summaryGenerationDurationLabel: "耗時",
        summaryGenerationRunningLabel: "產生中",
        summaryGenerationRunningProvenance: "正在使用 {model} 產生摘要，已進行 {elapsed}",
        summaryGenerationSlowWarning: "已等待至少 4 分鐘。長病歷可能需要較久；若連線中斷，請縮小「資料選擇」範圍後重試。",
        summaryPreGeneratedLabel: "預產生",
        summaryPreGeneratedProvenance: "預產生摘要，由 {model} 建立",
      },
    },
  }),
}))

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ")
}

describe("CustomInsightGenerationMeta", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it("shows the model, completion time and duration as visible metadata", () => {
    const generatedAt = new Date("2026-08-27T06:32:00.000Z").getTime()
    const expectedTime = new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(generatedAt)

    render(
      <CustomInsightGenerationMeta
        metadata={{
          modelId: "gpt-6-luna",
          modelName: "GPT-6 Luna",
          provider: "openai",
          generatedAt,
          durationMs: 18_400,
        }}
      />,
    )

    const meta = screen.getByTestId("custom-insight-generation-meta")
    expect(normalizeWhitespace(meta.textContent ?? "")).toBe(
      `GPT-6 Luna·${normalizeWhitespace(expectedTime)}·耗時 00:18`,
    )
    expect(normalizeWhitespace(meta.getAttribute("aria-label") ?? "")).toBe(
      `由 GPT-6 Luna 於 ${normalizeWhitespace(expectedTime)} 產生，總耗時 00:18`,
    )
    expect(meta.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-27T06:32:00.000Z",
    )
    expect(screen.getByText("GPT-6 Luna").parentElement).toHaveClass(
      "max-[340px]:basis-full",
      "max-[340px]:max-w-full",
    )
    expect(meta.querySelector("time")?.previousElementSibling).toHaveClass("max-[340px]:hidden")
    expect(screen.getByText("耗時 00:18").previousElementSibling).not.toHaveClass("max-[340px]:hidden")
  })

  it("uses the catalog label when restoring older metadata without a saved display name", () => {
    render(
      <CustomInsightGenerationMeta
        metadata={{
          modelId: "gpt-6-luna",
          provider: "openai",
          generatedAt: new Date("2026-08-27T06:32:00.000Z").getTime(),
          durationMs: 1_000,
        }}
      />,
    )

    expect(screen.getByText("GPT-6 Luna")).toBeInTheDocument()
  })

  it('replaces a previously saved unreported label with the selected model and an info hint', () => {
    render(<CustomInsightGenerationMeta metadata={{
      modelId: 'gemini-4-hydrogen', modelName: '實際模型未回報', provider: 'gemini',
      generatedAt: Date.now(), modelExecution: createModelExecution('gemini-4-hydrogen'),
    }} />)
    expect(screen.getByTestId('custom-insight-generation-meta')).toHaveTextContent('Gemini 4 Hydrogen')
    expect(screen.getByRole('button', { name: '模型資訊：API 未回報實際模型' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('實際模型未回報')).not.toBeInTheDocument()
  })

  it("shows honest pre-generated demo provenance without inventing a time", () => {
    render(
      <CustomInsightGenerationMeta
        metadata={{
          source: "pre-generated",
          modelId: "gemini-3.1-flash-lite",
          modelName: "Gemini 3.1 Flash-Lite",
          provider: "gemini",
        }}
      />,
    )

    const meta = screen.getByTestId("custom-insight-generation-meta")
    expect(meta).toHaveTextContent("預產生·Gemini 3.1 Flash-Lite")
    expect(meta).toHaveAttribute(
      "aria-label",
      "預產生摘要，由 Gemini 3.1 Flash-Lite 建立",
    )
    expect(meta.querySelector("time")).not.toBeInTheDocument()
  })

  it("shows a live model timer while regeneration is active", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-27T06:32:00.000Z"))

    const { unmount } = render(
      <CustomInsightGenerationMeta
        metadata={{
          modelId: "gpt-5.4-nano",
          modelName: "Old model",
          provider: "openai",
          generatedAt: Date.now() - 60_000,
          durationMs: 5_000,
        }}
        activeGeneration={{
          id: "run-1",
          modelName: "GPT-6 Luna",
          startedAt: Date.now(),
        }}
      />,
    )

    const meta = screen.getByTestId("custom-insight-generation-meta")
    expect(meta).toHaveTextContent("產生中·GPT-6 Luna·00:00")
    expect(meta).not.toHaveTextContent("Old model")
    expect(screen.getByText("產生中").parentElement?.querySelector(".animate-spin")).toBeInTheDocument()

    act(() => jest.advanceTimersByTime(61_000))

    expect(meta).toHaveTextContent("產生中·GPT-6 Luna·01:01")
    expect(meta).toHaveAttribute(
      "aria-label",
      "正在使用 GPT-6 Luna 產生摘要，已進行 01:01",
    )

    unmount()
    expect(jest.getTimerCount()).toBe(0)
  })

  it("warns after four minutes for a local model and clears the warning when generation ends", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-27T06:32:00.000Z"))
    const startedAt = Date.now()
    const { rerender } = render(
      <CustomInsightGenerationMeta activeGeneration={{
        id: "run-1", modelName: "Tvghbrain 3.5", startedAt, isLocalModel: true,
      }} />,
    )

    act(() => jest.advanceTimersByTime(4 * 60_000 - 1_000))
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    act(() => jest.advanceTimersByTime(1_000))
    expect(screen.getByRole("status")).toHaveTextContent("已等待至少 4 分鐘")
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
    expect(screen.getByTestId("custom-insight-generation-meta")).toHaveTextContent("04:00")

    rerender(<CustomInsightGenerationMeta />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("does not show the local-model warning for another provider", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-27T06:32:00.000Z"))
    render(<CustomInsightGenerationMeta activeGeneration={{
      id: "run-1", modelName: "Cloud model", startedAt: Date.now() - 5 * 60_000,
    }} />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("does not invent a timestamp for legacy results that did not save one", () => {
    const { container } = render(
      <CustomInsightGenerationMeta
        metadata={{
          modelId: "gpt-5.4-nano",
          provider: "openai",
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
