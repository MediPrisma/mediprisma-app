/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useMedicalSummary } from '@/src/application/hooks/medical-summary/use-medical-summary.hook'
import { medicalSummaryStore } from '@/src/application/hooks/medical-summary/medical-summary-store'
import { createModelExecution, reportModelExecution, modelExecutionFallback } from '@/src/shared/utils/ai-model-execution'
import { useAiExecutionDiagnosticsStore } from '@/src/application/stores/ai-execution-diagnostics.store'
import { useSummaryPrefsStore } from '@/src/application/stores/medical-summary-prefs.store'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID } from '@/src/application/launch/medcloud-launch-context'
import { MEDICAL_SUMMARY_CARD_REGISTRY } from '@/src/core/use-cases/medical-summary/medical-summary-card-registry'

let mockSlotOptions: any
let mockResult: any
const mockStream = jest.fn()
const mockMeasureResult = jest.fn()
const mockGenerate = async () => {
  mockResult = await mockSlotOptions.run({
    operationKey: 'audit-slot', modelId: 'gemini-3.8-flash', requestedModelId: 'gemini-3.8-flash',
    modelName: 'Gemini 3.8 Flash', locale: 'zh-TW', audience: 'medical',
    clinicalContext: 'synthetic data', catalog: [], piiLiterals: [], contextLimit: 10000,
    ai: { stream: mockStream }, measureResult: mockMeasureResult,
  })
}

jest.mock('@/src/application/hooks/ai-generation/use-ai-slot-generation.hook', () => ({
  useAiSlotGeneration: (options: any) => {
    mockSlotOptions = options
    return { slotKey: 'audit-slot', catalog: [], dataReady: false, generate: mockGenerate }
  },
}))
jest.mock('@/src/application/providers/audience.provider', () => ({ useAudience: () => ({ audience: 'medical' }) }))
jest.mock('@/src/application/providers/ai-demographics-gate.provider', () => ({ useAiDemographicsGate: () => ({ demographicsReadyForAi: true }) }))
jest.mock('@/src/core/use-cases/medical-summary/generate-medical-summary.use-case', () => ({
  MEDICAL_SUMMARY_MODEL_ID: 'gemini-3.8-flash',
  generateMedicalSummaryUseCase: {
    createAiDraftFromResult: (base: any) => ({ ...base }),
    finalizeResult: (summary: any) => summary,
  },
}))
jest.mock('@/src/core/use-cases/medical-summary/medical-summary-card-registry', () => {
  const overview = {
    id: 'overview', hasCompleteBatchBlock: () => true, parseBatch: () => 'NEW_OVERVIEW_CARD',
    apply: (aggregate: any, parsed: any) => ({ ...aggregate, summary: { ...aggregate.summary, overview: parsed } }),
  }
  const safety = {
    id: 'safety', hasCompleteBatchBlock: () => true,
    parseBatch: () => ({ alerts: [], scannedCount: 1 }),
    apply: (aggregate: any, parsed: any) => ({ ...aggregate, safety: parsed }),
  }
  const cards = { overview, safety }
  return {
    MEDICAL_SUMMARY_CARD_REGISTRY: cards,
    registeredMedicalSummaryCards: (_input: any, enabledIds?: string[]) => (
      Object.values(cards).filter((card: any) => !enabledIds || enabledIds.includes(card.id))
    ),
  }
})
jest.mock('@/src/application/hooks/ai-generation/context-window-retry', () => ({
  runWithContextWindowRetry: async (options: any) => ({ value: await options.execute([]), clinicalContext: 'synthetic data' }),
}))

beforeEach(() => {
  mockMeasureResult.mockClear()
  mockResult = undefined
  mockStream.mockReset()
  useMedcloudLaunchStore.getState().clear()
  mockStream.mockImplementation(async (_messages, options) => {
    options.onChunk('NEW_OVERVIEW_CARD')
    // Some providers report identity only in their last chunk.
    options.onModelExecution(reportModelExecution(createModelExecution('gemini-3.8-flash'), 'gemini-3.8-flash'))
    return 'NEW_OVERVIEW_CARD'
  })
})

afterEach(() => jest.restoreAllMocks())

test.each([false, true])('reports final card failures after internal retries, preserving results (partial=%s)', async (partial) => {
  jest.spyOn(MEDICAL_SUMMARY_CARD_REGISTRY.safety, 'parseBatch').mockReturnValue(null)
  if (!partial) jest.spyOn(MEDICAL_SUMMARY_CARD_REGISTRY.overview, 'parseBatch').mockReturnValue(null)
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => result.current.generate())
  expect(mockStream).toHaveBeenCalledTimes(3)
  expect(mockMeasureResult).toHaveBeenCalledTimes(1)
  expect(mockMeasureResult).toHaveBeenCalledWith({
    outcome: 'parse_failed', summaryCards: { succeeded: partial ? 1 : 0, failed: partial ? 1 : 2 },
  })
  expect(mockResult.cardErrors.safety).toBe('PARSE_FAILED')
  if (partial) {
    expect(mockResult.overview).toBe('NEW_OVERVIEW_CARD')
    expect(mockResult.completedCardIds).toContain('overview')
  } else expect(mockResult.cardErrors.overview).toBe('PARSE_FAILED')
})

test('a manual summary model choice immediately releases the Medcloud override', () => {
  act(() => {
    useSummaryPrefsStore.setState({ modelId: 'gpt-5.4-nano' })
    useMedcloudLaunchStore.getState().setRuntimeModelId(
      VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    )
  })
  const { result } = renderHook(() => useMedicalSummary())
  expect(result.current.model).toBe(VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID)

  act(() => result.current.setModel('gemini-3.1-flash-lite'))

  expect(result.current.model).toBe('gemini-3.1-flash-lite')
  expect(useMedcloudLaunchStore.getState().runtimeModelId).toBeNull()
  expect(useSummaryPrefsStore.getState().modelId).toBe('gemini-3.1-flash-lite')
})

test('retrying failed cards retains provenance for successful cards kept from the previous run', async () => {
  const clear = jest.spyOn(useAiExecutionDiagnosticsStore.getState(), 'clearOperationFeature')
  const previousExecution = reportModelExecution(createModelExecution('gemini-3.8-flash'), 'gemini-3.1-flash-lite')
  medicalSummaryStore.setState({ byKey: { 'audit-slot': {
    problems: 'RETAINED_LITE_CARD', cardErrors: { overview: 'PARSE_FAILED' },
    completedCardIds: ['problems'],
    generation: { source: 'live', modelId: 'gemini-3.8-flash', modelName: 'Gemini 3.1 Flash-Lite',
      generatedAt: 1, modelExecution: previousExecution },
  } as any } })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => result.current.retryFailedModules())
  expect(mockResult.problems).toBe('RETAINED_LITE_CARD')
  expect(mockResult.overview).toBe('NEW_OVERVIEW_CARD')
  expect(mockResult.generation.modelExecution.actualModelIds).toContain('gemini-3.1-flash-lite')
  expect(modelExecutionFallback(mockResult.generation.modelExecution)).toBe(true)
  expect(mockResult.generation.cardModelExecutions.problems.actualModelId).toBe('gemini-3.1-flash-lite')
  expect(mockResult.generation.cardModelExecutions.overview.actualModelId).toBe('gemini-3.8-flash')
  expect(mockResult.generation.modelExecution.hasUnreportedSteps).not.toBe(true)
  expect(clear).not.toHaveBeenCalled()
  await act(async () => result.current.generate())
  expect(mockResult.generation.modelExecution.actualModelIds).toEqual(['gemini-3.8-flash'])
  expect(modelExecutionFallback(mockResult.generation.modelExecution)).toBe(false)
  expect(clear).toHaveBeenCalledWith('audit-slot', 'medical-summary')
})

test('replaces only the retried card provenance instead of retaining an obsolete aggregate fallback', async () => {
  const flash = reportModelExecution(createModelExecution('gemini-3.8-flash'), 'gemini-3.8-flash')
  const lite = reportModelExecution(createModelExecution('gemini-3.8-flash'), 'gemini-3.1-flash-lite')
  medicalSummaryStore.setState({ byKey: { 'audit-slot': {
    problems: 'RETAINED_FLASH_CARD', cardErrors: { overview: 'PARSE_FAILED' }, completedCardIds: ['problems'],
    generation: { source: 'live', modelId: 'gemini-3.8-flash', modelName: 'Gemini 3.1 Flash-Lite', generatedAt: 1,
      modelExecution: lite, cardModelExecutions: { problems: flash, overview: lite } },
  } as any } })
  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => result.current.retryFailedModules())
  expect(mockResult.problems).toBe('RETAINED_FLASH_CARD')
  expect(mockResult.generation.modelExecution.actualModelIds).toEqual(['gemini-3.8-flash'])
  expect(modelExecutionFallback(mockResult.generation.modelExecution)).toBe(false)
})

test('retrying a failed safety card preserves successful summary cards', async () => {
  medicalSummaryStore.setState({ byKey: { 'audit-slot': {
    problems: 'RETAINED_PROBLEM_CARD',
    cardErrors: { safety: 'PARSE_FAILED' },
    completedCardIds: ['problems'],
    generation: { source: 'live', modelId: 'gemini-3.8-flash', modelName: 'Gemini 3.8 Flash',
      generatedAt: 1, modelExecution: createModelExecution('gemini-3.8-flash') },
  } as any } })

  const { result } = renderHook(() => useMedicalSummary())
  await act(async () => result.current.retryFailedModules())

  expect(mockResult.problems).toBe('RETAINED_PROBLEM_CARD')
  expect(mockResult.safety).toEqual({
    alerts: [],
    scannedCount: 1,
    generation: expect.any(Object),
  })
  expect(mockResult.cardErrors).toBeUndefined()
  expect(mockResult.completedCardIds).toEqual(expect.arrayContaining(['problems', 'safety']))
  expect(mockMeasureResult).toHaveBeenCalledTimes(1)
  expect(mockMeasureResult).toHaveBeenCalledWith({
    outcome: 'ok', summaryCards: { succeeded: 1, failed: 0 },
  })
})
