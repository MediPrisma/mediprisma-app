import { act, renderHook, waitFor } from '@testing-library/react'
import { useMedicalSummaryOrchestrator } from '@/src/application/hooks/medical-summary/use-medical-summary-orchestrator.hook'
import { useMedicalSummary } from '@/src/application/hooks/medical-summary/use-medical-summary.hook'
import { useSafetyAlerts } from '@/src/application/hooks/safety-alerts/use-safety-alerts.hook'
import { CUSTOM_OPENAI_MODEL_ID } from '@/src/shared/constants/ai-models.constants'
import type { ContextOverflowIssue } from '@/src/shared/utils/context-budget'
import { BUNDLE_CHANGED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import type { OpenAiCompatibleProfile } from '@/src/shared/types/openai-compatible.types'

const mockRequestDemographicsForAi = jest.fn(async () => true)

jest.mock('@/src/application/hooks/medical-summary/use-medical-summary.hook', () => ({
  useMedicalSummary: jest.fn(),
}))
jest.mock('@/src/application/hooks/safety-alerts/use-safety-alerts.hook', () => ({
  useSafetyAlerts: jest.fn(),
}))
jest.mock('@/src/application/providers/ai-demographics-gate.provider', () => ({
  useAiDemographicsGate: () => ({
    demographicsReadyForAi: true,
    requestDemographicsForAi: mockRequestDemographicsForAi,
  }),
}))

const mockUseMedicalSummary = useMedicalSummary as jest.MockedFunction<typeof useMedicalSummary>
const mockUseSafetyAlerts = useSafetyAlerts as jest.MockedFunction<typeof useSafetyAlerts>

const summaryGenerate = jest.fn(async () => {})
const summaryRetryFailedModules = jest.fn(async () => {})
const safetyGenerate = jest.fn(async () => {})
const summaryCancel = jest.fn()
const safetyCancel = jest.fn()
const restoreSummaryGenerationSlot = jest.fn()
const restoreSafetyGenerationSlot = jest.fn()
const setSummaryModel = jest.fn()
const setSafetyModel = jest.fn()
const setSummaryAuto = jest.fn()
const setSafetyAuto = jest.fn()
const recordGenerationCompletion = jest.fn()
const readSummaryGenerationSlot = jest.fn()
const readSafetyGenerationSlot = jest.fn()

interface ArrangeOptions {
  summaryResult?: unknown
  safetyResult?: unknown
  summaryResultOwnerModelId?: string | null
  safetyResultOwnerModelId?: string | null
  summaryResultOwnerRuntimeId?: string | null
  safetyResultOwnerRuntimeId?: string | null
  summaryError?: string | null
  safetyError?: string | null
  summaryIssue?: ContextOverflowIssue | null
  safetyIssue?: ContextOverflowIssue | null
  summaryHydrated?: boolean
  safetyHydrated?: boolean
  summaryGenerating?: boolean
  safetyGenerating?: boolean
  summaryScopeKey?: string
  summaryGenerationSlotKey?: string
  safetyGenerationSlotKey?: string
  summaryCurrentSlotGenerating?: boolean
  safetyCurrentSlotGenerating?: boolean
  summaryRunningSlotKey?: string | null
  safetyRunningSlotKey?: string | null
  summaryModel?: string
  summaryResolvedModelName?: string
  summaryModelUnavailable?: boolean
  safetyModel?: string
  summaryAuto?: boolean
  safetyAuto?: boolean
}

function arrange({
  summaryResult = { headline: 'summary' },
  safetyResult = { alerts: [] },
  summaryResultOwnerModelId,
  safetyResultOwnerModelId,
  summaryResultOwnerRuntimeId,
  safetyResultOwnerRuntimeId,
  summaryError = null,
  safetyError = null,
  summaryIssue = null,
  safetyIssue = null,
  summaryHydrated = true,
  safetyHydrated = true,
  summaryGenerating = false,
  safetyGenerating = false,
  summaryScopeKey = '0::patient-1::medical::zh-TW::input-a',
  summaryGenerationSlotKey = 'patient-1::medical::zh-TW::summary-model::ctx-input-a',
  safetyGenerationSlotKey = 'patient-1::medical::zh-TW::safety-model::ctx-input-a',
  summaryCurrentSlotGenerating = summaryGenerating,
  safetyCurrentSlotGenerating = safetyGenerating,
  summaryRunningSlotKey = summaryGenerating ? summaryGenerationSlotKey : null,
  safetyRunningSlotKey = safetyGenerating ? safetyGenerationSlotKey : null,
  summaryModel = 'gemini-3.1-flash-lite',
  summaryResolvedModelName = 'Gemini 3.1 Flash-Lite',
  summaryModelUnavailable = false,
  safetyModel = 'gemini-3.1-flash-lite',
  summaryAuto = true,
  safetyAuto = true,
}: ArrangeOptions = {}) {
  const resolvedSummaryResultOwnerModelId = summaryResultOwnerModelId === undefined
    ? (summaryResult ? summaryModel : null)
    : summaryResultOwnerModelId
  const resolvedSafetyResultOwnerModelId = safetyResultOwnerModelId === undefined
    ? (safetyResult ? safetyModel : null)
    : safetyResultOwnerModelId
  const resolvedSummaryResultOwnerRuntimeId = summaryResultOwnerRuntimeId === undefined
    ? resolvedSummaryResultOwnerModelId
    : summaryResultOwnerRuntimeId
  const resolvedSafetyResultOwnerRuntimeId = safetyResultOwnerRuntimeId === undefined
    ? resolvedSafetyResultOwnerModelId
    : safetyResultOwnerRuntimeId
  readSummaryGenerationSlot.mockImplementation((slotKey: string) => ({
    result: summaryResult,
    isRunning: slotKey === summaryRunningSlotKey,
    error: summaryError,
    issue: summaryIssue,
  }))
  readSafetyGenerationSlot.mockImplementation((slotKey: string) => ({
    result: safetyResult,
    isRunning: slotKey === safetyRunningSlotKey,
    error: safetyError,
    issue: safetyIssue,
  }))
  mockUseMedicalSummary.mockReturnValue({
    result: summaryResult as never,
    resultOwnerModelId: resolvedSummaryResultOwnerModelId,
    resultOwnerRuntimeId: resolvedSummaryResultOwnerRuntimeId,
    coverage: null,
    isGenerating: summaryGenerating,
    error: summaryError,
    issue: summaryIssue,
    contextAdaptation: null,
    hasPatient: true,
    dataReady: true,
    scopeKey: summaryScopeKey,
    generationSlotKey: summaryGenerationSlotKey,
    isCurrentSlotGenerating: summaryCurrentSlotGenerating,
    readGenerationSlot: readSummaryGenerationSlot,
    resolveSource: jest.fn(),
    sourceCatalog: [],
    isHydrated: summaryHydrated,
    autoGenerate: summaryAuto,
    setAutoGenerate: setSummaryAuto,
    model: summaryModel,
    resolvedModelName: summaryResolvedModelName,
    modelUnavailable: summaryModelUnavailable,
    setModel: setSummaryModel,
    recordGenerationCompletion,
    generate: summaryGenerate,
    retryFailedModules: summaryRetryFailedModules,
    cancel: summaryCancel,
    restoreGenerationSlot: restoreSummaryGenerationSlot,
    reportDigestInput: null,
  })
  mockUseSafetyAlerts.mockReturnValue({
    result: safetyResult as never,
    resultOwnerModelId: resolvedSafetyResultOwnerModelId,
    resultOwnerRuntimeId: resolvedSafetyResultOwnerRuntimeId,
    isScanning: safetyGenerating,
    error: safetyError,
    issue: safetyIssue,
    hasPatient: true,
    generationSlotKey: safetyGenerationSlotKey,
    isCurrentSlotGenerating: safetyCurrentSlotGenerating,
    readGenerationSlot: readSafetyGenerationSlot,
    isHydrated: safetyHydrated,
    autoScan: safetyAuto,
    setAutoScan: setSafetyAuto,
    model: safetyModel,
    setModel: setSafetyModel,
    scan: safetyGenerate,
    cancel: safetyCancel,
    restoreGenerationSlot: restoreSafetyGenerationSlot,
    resolveSource: jest.fn(),
  })
}

describe('useMedicalSummaryOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useAiConfigStore.setState({ openAiCompatibleProfiles: [] })
    mockRequestDemographicsForAi.mockResolvedValue(true)
    arrange()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('exposes a selected-model access block to the Medical Summary surface', () => {
    arrange({
      summaryModel: 'gpt-5.6-terra',
      summaryResolvedModelName: 'GPT-5.6 Terra',
      summaryModelUnavailable: true,
      summaryError: '所選的 GPT-5.6 Terra 需要有效的金鑰或連線設定。本次未送出任何資料。',
    })

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())

    expect(result.current.model).toBe('gpt-5.6-terra')
    expect(result.current.modelUnavailable).toBe(true)
    expect(result.current.summaryError).toContain('本次未送出任何資料')
  })

  it('runs all six cards through one briefing generation call', async () => {
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => result.current.generate())
    expect(summaryGenerate).toHaveBeenCalledTimes(1)
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('does not start manual generation when required demographics are cancelled', async () => {
    mockRequestDemographicsForAi.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())

    await act(async () => result.current.generate())

    expect(mockRequestDemographicsForAi).toHaveBeenCalledTimes(1)
    expect(summaryGenerate).not.toHaveBeenCalled()
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('aborts a deleted custom-profile batch before its queued safety request starts', async () => {
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
    useAiConfigStore.setState({ openAiCompatibleProfiles: [profile] })
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
      summaryResolvedModelName: 'hospital-7b',
    })
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(async () => (
      await new Promise<void>((resolve) => { finishSummary = resolve })
    ))
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())

    let generation!: Promise<void>
    act(() => {
      generation = result.current.generate()
    })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    act(() => useAiConfigStore.setState({ openAiCompatibleProfiles: [] }))

    expect(summaryCancel).toHaveBeenCalledWith(expect.stringContaining('summary-model'))
    expect(safetyCancel).toHaveBeenCalledWith(expect.stringContaining('safety-model'))
    await act(async () => {
      finishSummary()
      await generation
    })

    expect(safetyGenerate).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isGenerating).toBe(false))
  })

  it('tombstones queued local work when the summary screen unmounts', async () => {
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
    useAiConfigStore.setState({ openAiCompatibleProfiles: [profile] })
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
      summaryResolvedModelName: 'hospital-7b',
    })
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(async () => (
      await new Promise<void>((resolve) => { finishSummary = resolve })
    ))
    const { result, unmount } = renderHook(() => useMedicalSummaryOrchestrator())

    let generation!: Promise<void>
    act(() => {
      generation = result.current.generate()
    })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    unmount()
    expect(summaryCancel).toHaveBeenCalledWith(expect.stringContaining('summary-model'))
    expect(safetyCancel).toHaveBeenCalledWith(expect.stringContaining('safety-model'))
    await act(async () => {
      finishSummary()
      await generation
    })

    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('restores a custom endpoint version atomically as its two caches hydrate', async () => {
    const summaryA = { headline: 'summary A' }
    const safetyA = { alerts: [{ id: 'safety-a' }] }
    const summaryB = { headline: 'summary B' }
    const safetyB = { alerts: [{ id: 'safety-b' }] }
    arrange({
      summaryResult: summaryA,
      safetyResult: safetyA,
      summaryResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      safetyResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      summaryResultOwnerRuntimeId: 'custom-openai:endpoint-a',
      safetyResultOwnerRuntimeId: 'custom-openai:endpoint-a',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    arrange({
      summaryResult: summaryB,
      safetyResult: safetyA,
      summaryResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      safetyResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      summaryResultOwnerRuntimeId: 'custom-openai:endpoint-b',
      safetyResultOwnerRuntimeId: 'custom-openai:endpoint-a',
      summaryGenerationSlotKey: 'summary-slot-b',
      safetyGenerationSlotKey: 'safety-slot-b',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()

    expect(result.current.result).toBe(summaryA)
    expect(result.current.safetyResult).toBe(safetyA)

    arrange({
      summaryResult: summaryB,
      safetyResult: safetyB,
      summaryResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      safetyResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      summaryResultOwnerRuntimeId: 'custom-openai:endpoint-b',
      safetyResultOwnerRuntimeId: 'custom-openai:endpoint-b',
      summaryGenerationSlotKey: 'summary-slot-b',
      safetyGenerationSlotKey: 'safety-slot-b',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()

    expect(result.current.result).toBe(summaryB)
    expect(result.current.safetyResult).toBe(safetyB)
  })

  it('never presents two different model owners on an initially inconsistent restore', () => {
    arrange({
      summaryResult: { headline: 'summary B restored first' },
      safetyResult: { alerts: [{ id: 'safety-a' }] },
      summaryResultOwnerModelId: 'model-b',
      safetyResultOwnerModelId: 'model-a',
      summaryResultOwnerRuntimeId: 'model-b',
      safetyResultOwnerRuntimeId: 'model-a',
      summaryModel: 'model-b',
      safetyModel: 'model-b',
    })

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())

    expect(result.current.result).toBeUndefined()
    expect(result.current.safetyResult).toBeUndefined()
    expect(result.current.hasAnyResult).toBe(false)
  })

  it('shows a populated selected model while another model keeps running in the background', async () => {
    const summaryA = { headline: 'summary A' }
    const safetyA = { alerts: [{ id: 'safety-a' }] }
    const summaryB = { headline: 'summary B' }
    const safetyB = { alerts: [{ id: 'safety-b' }] }
    arrange({
      summaryResult: summaryA,
      safetyResult: safetyA,
      summaryResultOwnerModelId: 'model-a',
      safetyResultOwnerModelId: 'model-a',
      summaryGenerating: true,
      summaryGenerationSlotKey: 'summary-slot-a',
      safetyGenerationSlotKey: 'safety-slot-a',
      summaryRunningSlotKey: 'summary-slot-a',
      summaryModel: 'model-a',
      safetyModel: 'model-a',
      summaryResolvedModelName: 'Model A',
    })
    readSummaryGenerationSlot.mockImplementation((slotKey: string) => ({
      result: summaryA,
      isRunning: slotKey === 'summary-slot-a',
      error: null,
      issue: null,
    }))
    readSafetyGenerationSlot.mockImplementation(() => ({
      result: safetyA,
      isRunning: false,
      error: null,
      issue: null,
    }))
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)
    expect(result.current.activeGeneration?.modelName).toBe('Model A')

    arrange({
      summaryResult: summaryB,
      safetyResult: safetyB,
      summaryResultOwnerModelId: 'model-b',
      safetyResultOwnerModelId: 'model-b',
      summaryGenerating: true,
      summaryCurrentSlotGenerating: false,
      summaryRunningSlotKey: 'summary-slot-a',
      summaryGenerationSlotKey: 'summary-slot-b',
      safetyGenerationSlotKey: 'safety-slot-b',
      summaryModel: 'model-b',
      safetyModel: 'model-b',
      summaryResolvedModelName: 'Model B',
    })
    readSummaryGenerationSlot.mockImplementation((slotKey: string) => ({
      result: slotKey === 'summary-slot-b' ? summaryB : summaryA,
      isRunning: slotKey === 'summary-slot-a',
      error: null,
      issue: null,
    }))
    readSafetyGenerationSlot.mockImplementation((slotKey: string) => ({
      result: slotKey === 'safety-slot-b' ? safetyB : safetyA,
      isRunning: false,
      error: null,
      issue: null,
    }))
    rerender()

    expect(result.current.result).toBe(summaryB)
    expect(result.current.safetyResult).toBe(safetyB)
    expect(result.current.activeGeneration?.modelName).toBe('Model A')
  })

  it('does not let a late cancellation cleanup cover the newly selected model', async () => {
    const summaryA = { headline: 'summary A' }
    const safetyA = { alerts: [{ id: 'safety-a' }] }
    const summaryB = { headline: 'summary B' }
    const safetyB = { alerts: [{ id: 'safety-b' }] }
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryResult: summaryA,
      safetyResult: safetyA,
      summaryResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      safetyResultOwnerModelId: CUSTOM_OPENAI_MODEL_ID,
      summaryGenerationSlotKey: 'summary-slot-a',
      safetyGenerationSlotKey: 'safety-slot-a',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
      summaryResolvedModelName: 'Model A',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))
    act(() => result.current.cancelGeneration())

    act(() => result.current.setModel('model-b'))
    arrange({
      summaryResult: summaryB,
      safetyResult: safetyB,
      summaryResultOwnerModelId: 'model-b',
      safetyResultOwnerModelId: 'model-b',
      summaryGenerationSlotKey: 'summary-slot-b',
      safetyGenerationSlotKey: 'safety-slot-b',
      summaryModel: 'model-b',
      safetyModel: 'model-b',
      summaryResolvedModelName: 'Model B',
    })
    rerender()
    expect(result.current.result).toBe(summaryB)
    expect(result.current.safetyResult).toBe(safetyB)

    await act(async () => {
      finishSummary()
      await generation
    })
    await waitFor(() => expect(result.current.isStopping).toBe(false))

    expect(result.current.result).toBe(summaryB)
    expect(result.current.safetyResult).toBe(safetyB)
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('shows new model failures while retaining the previous coherent summary', () => {
    const previousSummary = { headline: 'previous valid summary' }
    const previousSafety = { alerts: [] }
    arrange({ summaryResult: previousSummary, safetyResult: previousSafety })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())

    arrange({
      summaryResult: { headline: '', cardErrors: { priorities: 'API Key error' } },
      safetyResult: previousSafety,
      summaryResultOwnerRuntimeId: 'new-model',
      safetyResultOwnerRuntimeId: 'old-model',
    })
    rerender()

    expect(result.current.result).toBe(previousSummary)
    expect(result.current.cardErrors).toEqual({ priorities: 'API Key error' })

    // A stale failed result must not be attributed to a newly selected slot.
    readSummaryGenerationSlot.mockReturnValue({
      result: undefined,
      isRunning: false,
      error: null,
      issue: null,
    })
    rerender()
    expect(result.current.cardErrors).toEqual({})
  })

  it('captures the last coherent pair when regeneration starts during partial cache hydration', async () => {
    const summaryA = { headline: 'summary A' }
    const safetyA = { alerts: [{ id: 'safety-a' }] }
    const summaryB = { headline: 'summary B' }
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryResult: summaryA,
      safetyResult: safetyA,
      summaryResultOwnerModelId: 'model-a',
      safetyResultOwnerModelId: 'model-a',
      summaryModel: 'model-a',
      safetyModel: 'model-a',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    arrange({
      summaryResult: summaryB,
      safetyResult: safetyA,
      summaryResultOwnerModelId: 'model-b',
      safetyResultOwnerModelId: 'model-a',
      summaryGenerationSlotKey: 'summary-slot-b',
      safetyGenerationSlotKey: 'safety-slot-b',
      summaryModel: 'model-b',
      safetyModel: 'model-b',
      summaryResolvedModelName: 'Model B',
    })
    rerender()
    expect(result.current.result).toBe(summaryA)
    expect(result.current.safetyResult).toBe(safetyA)

    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => {
      expect(summaryGenerate).toHaveBeenCalledTimes(1)
      expect(safetyGenerate).not.toHaveBeenCalled()
    })

    expect(result.current.result).toBe(summaryA)
    expect(result.current.safetyResult).toBe(safetyA)

    await act(async () => {
      finishSummary()
      await generation
    })
  })

  it('uses one combined request for a local model', async () => {
    const order: string[] = []
    summaryGenerate.mockImplementationOnce(async () => {
      order.push('summary:start')
      await Promise.resolve()
      order.push('summary:end')
    })
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => result.current.generate())

    expect(order).toEqual([
      'summary:start',
      'summary:end',
    ])
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('stops both pipelines and does not start queued local safety work', async () => {
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    act(() => result.current.cancelGeneration())

    expect(summaryCancel).toHaveBeenCalledTimes(1)
    expect(safetyCancel).toHaveBeenCalledTimes(1)
    expect(summaryCancel).toHaveBeenCalledWith(
      'patient-1::medical::zh-TW::summary-model::ctx-input-a',
    )
    expect(safetyCancel).toHaveBeenCalledWith(
      'patient-1::medical::zh-TW::safety-model::ctx-input-a',
    )
    expect(result.current.isStopping).toBe(true)
    expect(result.current.activeGeneration).toBeNull()

    await act(async () => {
      finishSummary()
      await generation
    })

    await waitFor(() => expect(result.current.isGenerating).toBe(false))
    expect(result.current.isStopping).toBe(false)
    expect(safetyGenerate).not.toHaveBeenCalled()
    expect(result.current.summaryError).toBeNull()
    expect(result.current.safetyError).toBeNull()
    expect(recordGenerationCompletion).not.toHaveBeenCalled()

    const flashLiteSummary = { headline: 'saved Flash-Lite summary' }
    const flashLiteSafety = { alerts: [{ id: 'saved-flash-lite-safety' }] }
    act(() => result.current.setModel('gemini-3.1-flash-lite'))
    arrange({
      summaryResult: flashLiteSummary,
      safetyResult: flashLiteSafety,
      summaryGenerationSlotKey: 'patient-1::medical::zh-TW::gemini-3.1-flash-lite::ctx-input-a',
      safetyGenerationSlotKey: 'patient-1::medical::zh-TW::gemini-3.1-flash-lite::ctx-input-a',
      summaryModel: 'gemini-3.1-flash-lite',
      safetyModel: 'gemini-3.1-flash-lite',
    })
    rerender()

    expect(result.current.result).toEqual(flashLiteSummary)
    expect(result.current.safetyResult).toEqual(flashLiteSafety)
  })

  it('keeps a cancelled local queue tombstoned across a scope switch', async () => {
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))
    act(() => result.current.cancelGeneration())

    arrange({
      summaryScopeKey: '0::patient-2::medical::zh-TW::input-b',
      summaryGenerationSlotKey: 'patient-2::medical::zh-TW::summary-model::ctx-input-b',
      safetyGenerationSlotKey: 'patient-2::medical::zh-TW::safety-model::ctx-input-b',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()

    await act(async () => {
      finishSummary()
      await generation
    })

    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('stops only the current scope while a background local batch continues', async () => {
    let finishFirstSummary!: () => void
    let finishSecondSummary!: () => void
    summaryGenerate
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishFirstSummary = resolve
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishSecondSummary = resolve
      }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let firstGeneration!: Promise<void>
    act(() => { firstGeneration = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    arrange({
      summaryScopeKey: '0::patient-2::medical::zh-TW::input-b',
      summaryGenerationSlotKey: 'patient-2::medical::zh-TW::summary-model::ctx-input-b',
      safetyGenerationSlotKey: 'patient-2::medical::zh-TW::safety-model::ctx-input-b',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()
    let secondGeneration!: Promise<void>
    act(() => { secondGeneration = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(2))

    act(() => result.current.cancelGeneration())
    expect(summaryCancel).toHaveBeenLastCalledWith(
      'patient-2::medical::zh-TW::summary-model::ctx-input-b',
    )
    expect(safetyCancel).toHaveBeenLastCalledWith(
      'patient-2::medical::zh-TW::safety-model::ctx-input-b',
    )

    await act(async () => {
      finishSecondSummary()
      await secondGeneration
    })
    expect(safetyGenerate).not.toHaveBeenCalled()

    await act(async () => {
      finishFirstSummary()
      await firstGeneration
    })
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('does not start queued local safety work after a Bundle replacement', async () => {
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    act(() => window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT)))
    await act(async () => {
      finishSummary()
      await generation
    })

    expect(summaryCancel).toHaveBeenCalledTimes(1)
    expect(safetyCancel).toHaveBeenCalledTimes(1)
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('tombstones a background local queue when a Bundle changes after a scope switch', async () => {
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSummary = resolve
    }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    arrange({
      summaryScopeKey: '0::patient-2::medical::zh-TW::input-b',
      summaryGenerationSlotKey: 'patient-2::medical::zh-TW::summary-model::ctx-input-b',
      safetyGenerationSlotKey: 'patient-2::medical::zh-TW::safety-model::ctx-input-b',
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()
    expect(result.current.activeGeneration).toBeNull()

    act(() => window.dispatchEvent(new Event(BUNDLE_CHANGED_EVENT)))
    await act(async () => {
      finishSummary()
      await generation
    })

    expect(summaryCancel).toHaveBeenCalledTimes(1)
    expect(safetyCancel).toHaveBeenCalledTimes(1)
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('keeps both completed cards from a combined request when it is stopped', async () => {
    const oldSummary = { headline: 'old summary' }
    const oldSafety = { alerts: [{ id: 'old-safety' }] }
    const newSummary = { headline: 'cancelled batch summary' }
    const newSafety = { alerts: [{ id: 'combined-safety' }] }
    let finishBriefing!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishBriefing = resolve
    }))
    arrange({
      summaryResult: oldSummary,
      safetyResult: oldSafety,
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    arrange({
      summaryResult: newSummary,
      safetyResult: newSafety,
      summaryGenerating: true,
      safetyGenerating: true,
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()
    await waitFor(() => expect(result.current.result).toEqual(newSummary))
    expect(result.current.safetyResult).toEqual(newSafety)

    act(() => result.current.cancelGeneration())
    expect(restoreSummaryGenerationSlot).not.toHaveBeenCalled()
    expect(restoreSafetyGenerationSlot).not.toHaveBeenCalled()
    await act(async () => {
      finishBriefing()
      await generation
    })

    arrange({
      summaryResult: newSummary,
      safetyResult: newSafety,
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })
    rerender()

    await waitFor(() => expect(result.current.isStopping).toBe(false))
    expect(result.current.result).toEqual(newSummary)
    expect(result.current.safetyResult).toEqual(newSafety)
    expect(safetyGenerate).not.toHaveBeenCalled()
    expect(result.current.summaryError).toBeNull()
    expect(result.current.safetyError).toBeNull()
    expect(recordGenerationCompletion).not.toHaveBeenCalled()
  })

  it('tracks summary and Safety completion from the same local request', async () => {
    const oldSummary = {
      headline: 'old summary',
      generation: {
        source: 'live',
        modelId: 'old-model',
        modelName: 'Old model',
        generatedAt: 100,
      },
    }
    const newSummary = {
      headline: 'new summary',
      generation: {
        source: 'live',
        modelId: CUSTOM_OPENAI_MODEL_ID,
        modelName: 'Local model',
        generatedAt: 200,
      },
    }
    const displayedSafety = { alerts: [{ id: 'displayed-a' }] }
    const staleSafety = { alerts: [{ id: 'stale-b' }] }
    const newSafety = { alerts: [{ id: 'new-b' }] }
    let summarySlot = {
      result: oldSummary,
      isRunning: false,
      error: null as string | null,
      issue: null,
    }
    let safetySlot = {
      result: staleSafety,
      isRunning: false,
      error: 'stale safety error' as string | null,
      issue: null,
    }
    let finishSummary!: () => void
    summaryGenerate.mockImplementationOnce(async () => {
      summarySlot = { ...summarySlot, isRunning: true, error: null }
      safetySlot = { ...safetySlot, isRunning: true, error: null }
      await new Promise<void>((resolve) => { finishSummary = resolve })
      summarySlot = { result: newSummary, isRunning: false, error: null, issue: null }
      safetySlot = { result: newSafety, isRunning: false, error: null, issue: null }
    })
    arrange({
      summaryResult: oldSummary,
      safetyResult: displayedSafety,
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
      summaryGenerationSlotKey: 'summary-slot-local',
      safetyGenerationSlotKey: 'safety-slot-local',
      summaryResolvedModelName: 'Local model',
    })
    readSummaryGenerationSlot.mockImplementation(() => summarySlot)
    readSafetyGenerationSlot.mockImplementation(() => safetySlot)

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => { generation = result.current.generate() })
    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))

    expect(safetyGenerate).not.toHaveBeenCalled()
    expect(recordGenerationCompletion).not.toHaveBeenCalled()

    await act(async () => {
      finishSummary()
      await generation
    })
    await act(async () => undefined)

    expect(safetyGenerate).not.toHaveBeenCalled()
    expect(recordGenerationCompletion).toHaveBeenCalledTimes(1)
    expect(recordGenerationCompletion).toHaveBeenCalledWith(expect.objectContaining({
      slotKey: 'summary-slot-local',
      generatedAt: 200,
      modelId: CUSTOM_OPENAI_MODEL_ID,
    }))
  })

  it('keeps a local manual batch active until the combined request settles', async () => {
    let finishBriefing!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishBriefing = resolve
    }))
    arrange({
      summaryModel: CUSTOM_OPENAI_MODEL_ID,
      safetyModel: CUSTOM_OPENAI_MODEL_ID,
    })

    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    let generation!: Promise<void>
    act(() => {
      generation = result.current.generate()
    })

    await waitFor(() => expect(summaryGenerate).toHaveBeenCalledTimes(1))
    expect(result.current.isGenerating).toBe(true)
    expect(safetyGenerate).not.toHaveBeenCalled()

    await act(async () => {
      finishBriefing()
      await generation
    })
    expect(result.current.isGenerating).toBe(false)
  })

  it('publishes staggered auto summary progress within one timed batch', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-20T01:00:00.000Z'))
    arrange({
      summaryResult: null,
      safetyResult: null,
      summaryGenerating: true,
      safetyHydrated: false,
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)
    const batchId = result.current.activeBatchId

    act(() => jest.advanceTimersByTime(5_000))
    const generatedAt = Date.now()
    const generatedSummary = {
      headline: 'auto summary',
      generation: {
        source: 'live',
        modelId: 'auto-model',
        modelName: 'Auto model',
        generatedAt,
      },
    }
    // Summary has settled, while the independently hydrated safety hook has
    // not started yet. Publish the validated summary but keep the batch timer
    // and the pending safety state active.
    arrange({
      summaryResult: generatedSummary,
      safetyResult: null,
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.isGenerating).toBe(true)
    expect(result.current.activeBatchId).toBe(batchId)
    expect(result.current.result).toBe(generatedSummary)
    expect(result.current.safetyResult).toBeNull()
    expect(result.current.isSafetyGenerating).toBe(true)
    expect(recordGenerationCompletion).not.toHaveBeenCalled()

    arrange({
      summaryResult: generatedSummary,
      safetyResult: null,
      safetyGenerating: true,
    })
    rerender()
    act(() => jest.advanceTimersByTime(30_000))

    const generatedSafety = { alerts: [{ id: 'auto-safety' }] }
    arrange({
      summaryResult: generatedSummary,
      safetyResult: generatedSafety,
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.activeGeneration).toBeNull()
    expect(result.current.lastCompletedBatchId).toBe(batchId)
    expect(result.current.result?.headline).toBe('auto summary')
    expect(result.current.safetyResult).toBe(generatedSafety)
    expect(recordGenerationCompletion).toHaveBeenCalledTimes(1)
    expect(recordGenerationCompletion).toHaveBeenCalledWith(expect.objectContaining({
      generatedAt,
      modelId: 'auto-model',
      durationMs: 35_000,
    }))
  })

  it('does not relabel a late cached summary with the companion safety run duration', async () => {
    arrange({
      summaryResult: null,
      safetyResult: null,
      summaryHydrated: false,
      safetyGenerating: true,
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    const cachedSummary = {
      headline: 'cached summary',
      generation: {
        source: 'live',
        modelId: 'cached-model',
        modelName: 'Cached model',
        generatedAt: 123,
        completedAt: 456,
        durationMs: 333,
      },
    }
    arrange({
      summaryResult: cachedSummary,
      safetyResult: null,
      safetyGenerating: true,
    })
    rerender()
    await act(async () => undefined)

    const generatedSafety = { alerts: [{ id: 'fresh-safety' }] }
    arrange({
      summaryResult: cachedSummary,
      safetyResult: generatedSafety,
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.result?.generation).toMatchObject({
      generatedAt: 123,
      completedAt: 456,
      durationMs: 333,
    })
    expect(recordGenerationCompletion).not.toHaveBeenCalled()
  })

  it('does not deadlock when a settled auto overflow is cleared before its companion finishes', async () => {
    const issue: ContextOverflowIssue = {
      kind: 'context-overflow',
      requestTokens: 15_000,
      selectedTokens: 6_400,
      usable: 11_000,
      limit: 15_000,
      reserve: 4_000,
      overBy: 4_000,
      suggestedSelectedMax: 2_399,
    }
    arrange({
      summaryResult: null,
      safetyResult: null,
      summaryGenerating: true,
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    arrange({
      summaryResult: null,
      safetyResult: null,
      summaryError: 'input exceeds context window',
      summaryIssue: issue,
      safetyGenerating: true,
    })
    rerender()
    await act(async () => undefined)
    expect(result.current.isGenerating).toBe(true)

    // Correcting the endpoint setting clears the settled summary slot, but it
    // does not auto-retry because this scope already consumed its auto attempt.
    arrange({
      summaryResult: null,
      safetyResult: null,
      safetyGenerating: true,
    })
    rerender()
    await act(async () => undefined)
    expect(result.current.isGenerating).toBe(true)

    const generatedSafety = { alerts: [{ id: 'safety-complete' }] }
    arrange({
      summaryResult: null,
      safetyResult: generatedSafety,
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.isGenerating).toBe(false)
    expect(result.current.activeGeneration).toBeNull()
    expect(result.current.contextOverflowIssue).toBeNull()
    expect(recordGenerationCompletion).not.toHaveBeenCalled()
  })

  it('freezes the actual model and records end-to-end batch duration on success', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-20T01:00:00.000Z'))
    const oldSummary = {
      headline: 'old summary',
      generation: {
        source: 'live',
        modelId: 'old-model',
        modelName: 'Old model',
        generatedAt: 100,
      },
    }
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryResolvedModelName: 'MODEL_NAME',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    expect(result.current.activeGeneration).toMatchObject({
      modelName: 'MODEL_NAME',
      startedAt: Date.now(),
    })

    // Changing the picker while the original request is active must not
    // relabel that request's timer.
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryResolvedModelName: 'Gemini 3 Flash Preview',
    })
    rerender()
    expect(result.current.activeGeneration?.modelName).toBe('MODEL_NAME')

    act(() => jest.advanceTimersByTime(65_000))
    const newSummary = {
      headline: 'new summary',
      generation: {
        source: 'live',
        modelId: CUSTOM_OPENAI_MODEL_ID,
        modelName: 'MODEL_NAME',
        generatedAt: 200,
      },
    }
    arrange({
      summaryResult: newSummary,
      summaryResolvedModelName: 'Gemini 3 Flash Preview',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.activeGeneration).toBeNull()
    expect(recordGenerationCompletion).toHaveBeenCalledWith({
      slotKey: 'patient-1::medical::zh-TW::summary-model::ctx-input-a',
      generatedAt: 200,
      modelId: CUSTOM_OPENAI_MODEL_ID,
      completedAt: Date.now(),
      durationMs: 65_000,
    })
    expect(result.current.result?.generation).toMatchObject({
      completedAt: Date.now(),
      durationMs: 65_000,
    })
    jest.useRealTimers()
  })

  it.each([
    ['Bundle revision', '1::patient-1::medical::zh-TW::input-a'],
    ['patient', '0::patient-2::medical::zh-TW::input-a'],
    ['audience', '0::patient-1::patient::zh-TW::input-a'],
    ['locale', '0::patient-1::medical::en::input-a'],
    ['clinical input', '0::patient-1::medical::zh-TW::input-b'],
  ])('does not carry a running batch across a changed %s scope', async (_change, nextScopeKey) => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-20T01:00:00.000Z'))
    const oldSummary = { headline: 'old-scope summary' }
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryResolvedModelName: 'Old scope model',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)
    const oldStartedAt = result.current.activeGeneration?.startedAt
    expect(result.current.activeGeneration?.modelName).toBe('Old scope model')

    act(() => jest.advanceTimersByTime(30_000))
    const nextSummary = { headline: 'current-scope summary' }
    arrange({
      summaryResult: nextSummary,
      safetyResult: { alerts: [{ id: 'current-scope' }] },
      summaryScopeKey: nextScopeKey,
      summaryResolvedModelName: 'Current scope model',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.result).toBe(nextSummary)
    expect(result.current.activeGeneration).toBeNull()
    expect(result.current.isGenerating).toBe(false)

    act(() => jest.advanceTimersByTime(10_000))
    arrange({
      summaryResult: nextSummary,
      safetyResult: { alerts: [{ id: 'current-scope' }] },
      summaryScopeKey: nextScopeKey,
      summaryGenerating: true,
      summaryResolvedModelName: 'Current scope model',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.activeGeneration).toMatchObject({
      modelName: 'Current scope model',
      startedAt: Date.now(),
    })
    expect(result.current.activeGeneration?.startedAt).not.toBe(oldStartedAt)
  })

  it('starts the current-scope timer when the new scope is already running', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-20T01:00:00.000Z'))
    arrange({
      summaryGenerating: true,
      summaryResolvedModelName: 'Old scope model',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)
    const oldStartedAt = result.current.activeGeneration?.startedAt

    act(() => jest.advanceTimersByTime(10_000))
    arrange({
      summaryGenerating: true,
      summaryScopeKey: '0::patient-2::medical::zh-TW::input-b',
      summaryGenerationSlotKey: 'patient-2::medical::zh-TW::model-b::ctx-input-b',
      summaryResolvedModelName: 'Current scope model',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.activeGeneration).toMatchObject({
      modelName: 'Current scope model',
      startedAt: Date.now(),
    })
    expect(result.current.activeGeneration?.startedAt).not.toBe(oldStartedAt)
  })

  it('surfaces the captured model failure after a picker switch and records no completion', async () => {
    const oldSummary = {
      headline: 'last complete summary',
      generation: {
        source: 'live',
        modelId: 'model-before-a',
        modelName: 'Earlier model',
        generatedAt: 100,
      },
    }
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryGenerationSlotKey: 'summary-slot-a',
      summaryResolvedModelName: 'Model A',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)
    expect(result.current.activeGeneration?.modelName).toBe('Model A')

    // The picker now points at B, while A remains the captured running slot.
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryCurrentSlotGenerating: false,
      summaryRunningSlotKey: 'summary-slot-a',
      summaryGenerationSlotKey: 'summary-slot-b',
      summaryResolvedModelName: 'Model B',
    })
    rerender()
    expect(result.current.activeGeneration?.modelName).toBe('Model A')

    arrange({
      summaryResult: oldSummary,
      summaryGenerationSlotKey: 'summary-slot-b',
      summaryResolvedModelName: 'Model B',
    })
    readSummaryGenerationSlot.mockImplementation((slotKey: string) => ({
      result: oldSummary,
      isRunning: false,
      error: slotKey === 'summary-slot-a' ? 'signal is aborted without reason' : null,
      issue: null,
    }))
    rerender()
    await act(async () => undefined)

    expect(result.current.activeGeneration).toBeNull()
    expect(result.current.result).toBe(oldSummary)
    expect(result.current.summaryError).toBe('signal is aborted without reason')
    expect(recordGenerationCompletion).not.toHaveBeenCalled()
  })

  it('does not attribute a stale picker-slot error to a successful captured run', async () => {
    const oldSummary = {
      headline: 'old summary',
      generation: {
        source: 'live',
        modelId: 'old-model',
        modelName: 'Old model',
        generatedAt: 100,
      },
    }
    arrange({
      summaryResult: oldSummary,
      summaryGenerating: true,
      summaryGenerationSlotKey: 'summary-slot-a',
      summaryResolvedModelName: 'Model A',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    const newSummary = {
      headline: 'new summary from A',
      generation: {
        source: 'live',
        modelId: 'model-a',
        modelName: 'Model A',
        generatedAt: Date.now(),
      },
    }
    arrange({
      summaryResult: newSummary,
      summaryError: 'stale error from model B',
      summaryGenerationSlotKey: 'summary-slot-b',
      summaryResolvedModelName: 'Model B',
    })
    readSummaryGenerationSlot.mockImplementation((slotKey: string) => ({
      result: slotKey === 'summary-slot-a' ? newSummary : undefined,
      isRunning: false,
      error: slotKey === 'summary-slot-b' ? 'stale error from model B' : null,
      issue: null,
    }))
    rerender()
    await act(async () => undefined)

    expect(result.current.summaryError).toBeNull()
    expect(result.current.result?.headline).toBe('new summary from A')
    expect(recordGenerationCompletion).toHaveBeenCalledWith(expect.objectContaining({
      slotKey: 'summary-slot-a',
      modelId: 'model-a',
    }))
  })

  it('releases a captured overflow after the same slot context window is corrected', async () => {
    const issue: ContextOverflowIssue = {
      kind: 'context-overflow',
      requestTokens: 15_000,
      selectedTokens: 6_400,
      usable: 11_000,
      limit: 15_000,
      reserve: 4_000,
      overBy: 4_000,
      suggestedSelectedMax: 2_399,
    }
    const priorSummary = { headline: 'prior summary' }
    arrange({
      summaryResult: priorSummary,
      summaryGenerating: true,
      summaryGenerationSlotKey: 'summary-slot-a',
    })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => undefined)

    arrange({
      summaryResult: priorSummary,
      summaryError: 'input exceeds context window',
      summaryIssue: issue,
      summaryGenerationSlotKey: 'summary-slot-a',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.contextOverflowIssue).toEqual(issue)

    // useAiSlotGeneration clears the exact slot error/issue when the user
    // corrects its configured context window. The orchestrator must not keep
    // replaying its captured failure over that live cleared state.
    arrange({
      summaryResult: priorSummary,
      summaryGenerationSlotKey: 'summary-slot-a',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.contextOverflowIssue).toBeNull()
    expect(result.current.summaryError).toBeNull()
  })

  it('does not let an old-scope manual promise keep the current scope busy', async () => {
    let finishOldSummary!: () => void
    summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishOldSummary = resolve
    }))
    arrange({ summaryResolvedModelName: 'Old scope model' })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    let oldGeneration!: Promise<void>

    act(() => {
      oldGeneration = result.current.generate()
    })
    await act(async () => undefined)
    expect(result.current.isGenerating).toBe(true)
    expect(result.current.activeGeneration?.modelName).toBe('Old scope model')

    const nextSummary = { headline: 'new scope summary' }
    arrange({
      summaryResult: nextSummary,
      summaryScopeKey: '0::patient-1::patient::zh-TW::input-a',
      summaryResolvedModelName: 'New scope model',
    })
    rerender()
    await act(async () => undefined)

    expect(result.current.result).toBe(nextSummary)
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.activeGeneration).toBeNull()

    await act(async () => {
      finishOldSummary()
      await oldGeneration
    })
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.activeGeneration).toBeNull()
  })

  it('routes a failed card through the combined retry runner', async () => {
    arrange({ summaryError: 'failed' })
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    await act(async () => result.current.retryFailed())
    expect(summaryRetryFailedModules).toHaveBeenCalledTimes(1)
    expect(summaryGenerate).not.toHaveBeenCalled()
    expect(safetyGenerate).not.toHaveBeenCalled()
    expect(recordGenerationCompletion).not.toHaveBeenCalled()
  })

  it('retries only failed summary modules and preserves the successful safety scan', async () => {
    arrange({
      summaryResult: {
        headline: '',
        cardErrors: { priorities: 'PARSE_FAILED' },
      },
    })
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())

    expect(result.current.cardErrors).toEqual({ priorities: 'PARSE_FAILED' })
    expect(result.current.hasCompleteResult).toBe(false)

    await act(async () => result.current.retryFailed())

    expect(summaryRetryFailedModules).toHaveBeenCalledTimes(1)
    expect(summaryGenerate).not.toHaveBeenCalled()
    expect(safetyGenerate).not.toHaveBeenCalled()
  })

  it('waits for both audience cache slots before presenting the summary', () => {
    arrange({ safetyHydrated: false })
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    expect(result.current.isRestoring).toBe(true)
  })

  it('migrates historical safety preferences to the summary controls', async () => {
    arrange({ safetyModel: 'old-model', safetyAuto: false })
    renderHook(() => useMedicalSummaryOrchestrator())
    await waitFor(() => {
      expect(setSafetyModel).toHaveBeenCalledWith('gemini-3.1-flash-lite')
      expect(setSafetyAuto).toHaveBeenCalledWith(true)
    })
  })

  // Automatic generation has no consent layer: the persisted switch is the
  // single control, and it behaves identically for every data source.
  it('turns automatic generation on for both pipelines', () => {
    arrange({ summaryAuto: false, safetyAuto: false })
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    expect(result.current.autoGenerate).toBe(false)

    act(() => result.current.setAutoGenerate(true))

    expect(setSummaryAuto).toHaveBeenCalledWith(true)
    expect(setSafetyAuto).toHaveBeenCalledWith(true)
  })

  it('turns automatic generation off for both pipelines', () => {
    const { result } = renderHook(() => useMedicalSummaryOrchestrator())
    expect(result.current.autoGenerate).toBe(true)

    act(() => result.current.setAutoGenerate(false))

    expect(setSummaryAuto).toHaveBeenCalledWith(false)
    expect(setSafetyAuto).toHaveBeenCalledWith(false)
  })

  it('shows validated summary cards while the same summary stream is still running', async () => {
    const oldSummary = { headline: 'old summary' }
    const oldSafety = { alerts: [{ id: 'old' }] }
    const partialSummary = {
      headline: '',
      problems: [{ label: 'validated first card' }],
    }
    arrange({ summaryResult: oldSummary, safetyResult: oldSafety, summaryGenerating: true })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())

    arrange({
      summaryResult: partialSummary,
      safetyResult: oldSafety,
      summaryGenerating: true,
    })
    rerender()

    expect(result.current.result).toBe(partialSummary)
    expect(result.current.safetyResult).toBe(oldSafety)
    expect(result.current.isSummaryGenerating).toBe(true)
    expect(result.current.isGenerating).toBe(true)
  })

  it('publishes each refreshed pipeline as soon as it settles', async () => {
    const oldSummary = { headline: 'old summary' }
    const oldSafety = { alerts: [{ id: 'old' }] }
    arrange({ summaryResult: oldSummary, safetyResult: oldSafety, summaryGenerating: true })
    const { result, rerender } = renderHook(() => useMedicalSummaryOrchestrator())
    await waitFor(() => expect(result.current.activeBatchId).not.toBeNull())

    arrange({
      summaryResult: { headline: 'new summary' },
      safetyResult: oldSafety,
      safetyGenerating: true,
    })
    rerender()
    await waitFor(() => expect(result.current.result).toEqual({ headline: 'new summary' }))
    expect(result.current.safetyResult).toEqual(oldSafety)
    expect(result.current.isGenerating).toBe(true)
    expect(result.current.isSafetyGenerating).toBe(true)

    arrange({
      summaryResult: { headline: 'new summary' },
      safetyResult: { alerts: [{ id: 'new' }] },
    })
    rerender()
    await waitFor(() => expect(result.current.activeBatchId).toBeNull())
    expect(result.current.result).toEqual({ headline: 'new summary' })
    expect(result.current.safetyResult).toEqual({ alerts: [{ id: 'new' }] })
  })
})
