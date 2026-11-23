import {
  buildSummaryGenerationInfo,
  formatGenerationDuration,
} from "@/features/medical-summary/utils/summary-generation-info"
import { createModelExecution } from '@/src/shared/utils/ai-model-execution'

const labels = {
  labelTemplate: "由 {model} 於 {time} 產生",
  labelWithDurationTemplate: "由 {model} 於 {time} 產生，總耗時 {duration}",
  generatedAtLabel: "產生時間：",
  durationLabel: "耗時",
  preGeneratedLabel: "預產生",
  preGeneratedTemplate: "預產生摘要，由 {model} 建立",
}

describe("buildSummaryGenerationInfo", () => {
  it('refreshes a stored unreported display name without changing its provenance', () => {
    const execution = createModelExecution('gemini-4-hydrogen')
    const info = buildSummaryGenerationInfo({
      generation: { source: 'live', modelId: 'gemini-4-hydrogen', modelName: '實際模型未回報',
        generatedAt: Date.now(), modelExecution: execution }, locale: 'zh-TW', ...labels,
    })
    expect(info?.modelName).toBe('Gemini 4 Hydrogen')
    expect(info?.ariaLabel).toContain('Gemini 4 Hydrogen')
    expect(info?.modelExecution?.actualModelId).toBeNull()
  })
  it("uses the configured upstream model name for a custom endpoint", () => {
    const generatedAt = new Date(2026, 6, 19, 14, 32).getTime()
    const completedAt = generatedAt + 83_000
    const info = buildSummaryGenerationInfo({
      generation: {
        source: "live",
        modelId: "openai-compatible-custom",
        modelName: "MODEL_NAME",
        generatedAt,
        completedAt,
        durationMs: 83_000,
      },
      locale: "zh-TW",
      ...labels,
    })

    expect(info).toMatchObject({
      modelName: "MODEL_NAME",
      generatedAtIso: new Date(completedAt).toISOString(),
      generatedAtLabel: "產生時間：",
      durationLabel: "耗時",
      durationText: "01:23",
    })
    expect(info?.generatedAtText).toContain("2026")
    expect(info?.ariaLabel).toBe(
      `由 MODEL_NAME 於 ${info?.generatedAtText} 產生，總耗時 01:23`,
    )
  })

  it("hides provenance when a legacy result has no reliable metadata", () => {
    expect(buildSummaryGenerationInfo({
      generation: undefined,
      locale: "zh-TW",
      ...labels,
    })).toBeUndefined()
  })

  it("shows a pre-generated label and model without inventing a timestamp", () => {
    expect(buildSummaryGenerationInfo({
      generation: {
        source: "pre-generated",
        modelId: "gemini-3.1-flash-lite",
        modelName: "Gemini 3.1 Flash-Lite",
      },
      locale: "zh-TW",
      ...labels,
    })).toEqual({
      prefix: "預產生",
      modelName: "Gemini 3.1 Flash-Lite",
      ariaLabel: "預產生摘要，由 Gemini 3.1 Flash-Lite 建立",
    })
  })

  it("rejects an invalid generation timestamp", () => {
    expect(buildSummaryGenerationInfo({
      generation: {
        source: "live",
        modelId: "gpt-5.4-nano",
        modelName: "GPT-5.4 Nano",
        generatedAt: Number.NaN,
      },
      locale: "en",
      ...labels,
    })).toBeUndefined()
  })

  it("keeps legacy live provenance when duration metadata is absent", () => {
    const generatedAt = new Date(2026, 6, 19, 14, 32).getTime()
    const info = buildSummaryGenerationInfo({
      generation: {
        source: "live",
        modelId: "gpt-5.4-nano",
        modelName: "GPT-5.4 Nano",
        generatedAt,
      },
      locale: "zh-TW",
      ...labels,
    })

    expect(info?.durationText).toBeUndefined()
    expect(info?.ariaLabel).toBe(`由 GPT-5.4 Nano 於 ${info?.generatedAtText} 產生`)
  })

  it("formats elapsed time across minute and hour boundaries", () => {
    expect(formatGenerationDuration(0)).toBe("00:00")
    expect(formatGenerationDuration(59_999)).toBe("00:59")
    expect(formatGenerationDuration(60_000)).toBe("01:00")
    expect(formatGenerationDuration(3_661_000)).toBe("1:01:01")
    expect(formatGenerationDuration(Number.NaN)).toBeUndefined()
  })
})
