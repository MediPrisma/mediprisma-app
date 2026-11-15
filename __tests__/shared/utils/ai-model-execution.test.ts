import { createModelExecution, reportModelExecution, modelExecutionFallback, modelExecutionLabel, modelExecutionNotice, sameModelVersion } from '@/src/shared/utils/ai-model-execution'

describe('model attribution', () => {
  it('identifies Flash → Lite fallback and retains both selected and actual ids', () => {
    const result = reportModelExecution(createModelExecution('gemini-4-hydrogen'), 'models/gemini-3.1-flash-lite')
    expect(result.actualModelId).toBe('gemini-3.1-flash-lite')
    expect(result.requestedModelId).toBe('gemini-4-hydrogen')
    expect(modelExecutionFallback(result)).toBe(true)
    expect(modelExecutionNotice(result, 'zh-TW')).toContain('實際使用 Gemini 3.1 Flash-Lite')
  })
  it('does not mistake dated provider revisions for another model', () => {
    expect(sameModelVersion('gpt-5.4-nano', 'gpt-5.4-nano-2026-03-17')).toBe(true)
    expect(sameModelVersion('gemini-4-hydrogen', 'gemini-4-hydrogen-001')).toBe(true)
    expect(sameModelVersion('gemini-4-hydrogen', 'gemini-4-hydrogen-lite')).toBe(false)
  })
  it('retains fallback evidence even if a later tool step uses the requested model', () => {
    const first = reportModelExecution(createModelExecution('gemini-4-hydrogen'), 'gemini-3.1-flash-lite')
    const last = reportModelExecution(first, 'gemini-4-hydrogen')
    expect(last.actualModelIds).toEqual(['gemini-3.1-flash-lite', 'gemini-4-hydrogen'])
    expect(modelExecutionFallback(last)).toBe(true)
  })
  it('reports a client-side key gate even when the server honors the routed model', () => {
    const result = reportModelExecution(createModelExecution('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite')
    expect(modelExecutionFallback(result)).toBe(true)
  })
  it('separates unknown provenance from an observed fallback', () => {
    const result = createModelExecution('gemini-4-hydrogen')
    expect(modelExecutionFallback(result)).toBe(false)
    expect(modelExecutionLabel(result)).toBe('Gemini 4 Hydrogen')
    expect(result.actualModelId).toBeNull()
    expect(modelExecutionNotice(result, 'zh-TW')).toContain('無法確認')
    expect(modelExecutionNotice(reportModelExecution(result, 'gemini-4-hydrogen'), 'zh-TW')).toBeNull()
  })
  it('keeps known routing and earlier fallback evidence visible without a final model report', () => {
    const gated = createModelExecution('gemini-3.1-pro-preview', 'gemini-3.1-flash-lite')
    expect(modelExecutionLabel(gated)).toBe('Gemini 3.1 Flash-Lite')
    expect(modelExecutionNotice(gated, 'zh-TW')).toContain('已請求 Gemini 3.1 Flash-Lite')
    const earlier = reportModelExecution(createModelExecution('gemini-4-hydrogen'), 'gemini-3.1-flash-lite')
    const unreported = reportModelExecution(earlier, null)
    expect(modelExecutionFallback(unreported)).toBe(true)
    expect(modelExecutionNotice(unreported, 'zh-TW')).toContain('先前步驟實際使用 Gemini 3.1 Flash-Lite')
  })
})
