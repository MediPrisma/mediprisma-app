import { act, renderHook, waitFor } from '@testing-library/react'
import { useMedcloudAutoSummary } from '@/src/application/hooks/medical-summary/use-medcloud-auto-summary.hook'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID } from '@/src/application/launch/medcloud-launch-context'
import { MEDICAL_SUMMARY_MODEL_ID } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { stopProgressiveImport, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

describe('useMedcloudAutoSummary', () => {
  beforeEach(() => {
    useMedcloudLaunchStore.getState().clear()
    useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
  })
  afterEach(() => jest.restoreAllMocks())

  it('finishes the cloud snapshot across supplements and runs only the latest final snapshot afterwards', async () => {
    const finish: Array<() => void> = []
    const generate = jest.fn((_signal?: AbortSignal) => new Promise<void>(resolve => finish.push(resolve)))
    const active = jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud')
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud', phase: 'waiting' } })
    useMedcloudLaunchStore.getState().queueSummary({ messageId: 'cloud', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'cloud' })
    renderHook(() => useMedcloudAutoSummary({ authLoading: false, hasPatient: true, summaryModelId: null,
      dataReady: true, isGenerating: false, isRestoring: false, generationSlotKey: 'slot', modelId: MEDICAL_SUMMARY_MODEL_ID, generate }))
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    for (const id of ['visits', 'final']) {
      active.mockReturnValue(id)
      act(() => useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: id, phase: id === 'visits' ? 'reports-pending' : 'loaded' } }))
    }
    act(() => useMedcloudLaunchStore.getState().queueSummary({ messageId: 'final', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'final' }))
    expect(generate.mock.calls[0][0]!.aborted).toBe(false)
    expect(generate).toHaveBeenCalledTimes(1)
    await act(async () => finish[0]())
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    await act(async () => finish[1]())
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it.each(['patient-changed', 'privacy-stale', 'cancelled', 'source-unavailable'] as const)('aborts an already claimed automatic launch on %s', async phase => {
    let finish!: () => void
    const generate = jest.fn((_signal?: AbortSignal) => new Promise<void>(resolve => { finish = resolve }))
    jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud-import', phase: 'waiting' } })
    useMedcloudLaunchStore.getState().queueSummary({ messageId: 'active-cloud', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'cloud-import' })
    renderHook(() => useMedcloudAutoSummary({ authLoading: false, hasPatient: true, summaryModelId: null,
      dataReady: true, isGenerating: false, isRestoring: false, generationSlotKey: 'slot', modelId: MEDICAL_SUMMARY_MODEL_ID, generate }))
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const signal = generate.mock.calls[0][0]!
    act(() => stopProgressiveImport('other-run', phase))
    expect(signal.aborted).toBe(false)
    act(() => stopProgressiveImport('run-a', phase))
    expect(signal.aborted).toBe(true)
    await act(async () => finish())
  })

  it.each(['patient-changed', 'privacy-stale', 'cancelled', 'source-unavailable'] as const)('revokes a queued progressive summary on %s before data becomes ready', async phase => {
    const generate = jest.fn(async () => undefined)
    jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud-import', phase: 'waiting' } })
    useMedcloudLaunchStore.getState().queueSummary({ messageId: 'queued-cloud', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'cloud-import' })
    const { rerender } = renderHook(({ ready }) => useMedcloudAutoSummary({ authLoading: false, hasPatient: true, summaryModelId: null,
      dataReady: ready, isGenerating: false, isRestoring: false, generationSlotKey: 'slot', modelId: MEDICAL_SUMMARY_MODEL_ID, generate }), { initialProps: { ready: false } })
    act(() => stopProgressiveImport('run-a', phase))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    rerender({ ready: true })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(generate).not.toHaveBeenCalled()
  })

  it('rechecks the active import inside the scheduled timer before generating', async () => {
    const generate = jest.fn(async () => undefined)
    jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('manually-replaced')
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud-import', phase: 'waiting' } })
    useMedcloudLaunchStore.getState().queueSummary({ messageId: 'stale-cloud', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'cloud-import' })
    renderHook(() => useMedcloudAutoSummary({ authLoading: false, hasPatient: true, summaryModelId: null,
      dataReady: true, isGenerating: false, isRestoring: false, generationSlotKey: 'slot', modelId: MEDICAL_SUMMARY_MODEL_ID, generate }))
    await waitFor(() => expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull())
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps the launch pending until the persisted account state is resolved', async () => {
    const generate = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-auth',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    })
    const { rerender } = renderHook((props: { authLoading: boolean }) =>
      useMedcloudAutoSummary({
        authLoading: props.authLoading,
        hasPatient: true,
        summaryModelId: null,
        dataReady: true,
        isGenerating: false,
        isRestoring: false,
        generationSlotKey: 'summary-slot-auth',
        modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
        generate,
      }), {
        initialProps: { authLoading: true },
      })

    expect(generate).not.toHaveBeenCalled()
    expect(useMedcloudLaunchStore.getState().pendingSummary?.messageId)
      .toBe('message-auth')

    rerender({ authLoading: false })

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it('waits for the FHIR summary runtime, then claims and generates once', async () => {
    const generate = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-1',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    })
    const { rerender } = renderHook((props: {
      dataReady: boolean
      isRestoring: boolean
    }) => useMedcloudAutoSummary({
      authLoading: false,
      hasPatient: true,
      summaryModelId: null,
      dataReady: props.dataReady,
      isGenerating: false,
      isRestoring: props.isRestoring,
      generationSlotKey: 'summary-slot-1',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
      generate,
    }), {
      initialProps: { dataReady: false, isRestoring: true },
    })

    expect(generate).not.toHaveBeenCalled()
    expect(useMedcloudLaunchStore.getState().pendingSummary?.messageId).toBe('message-1')

    rerender({ dataReady: true, isRestoring: false })
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()

    rerender({ dataReady: true, isRestoring: false })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('does not consume a request until its queued model is selected', () => {
    const generate = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-2',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    })

    renderHook(() => useMedcloudAutoSummary({
      authLoading: false,
      hasPatient: true,
      summaryModelId: null,
      dataReady: true,
      isGenerating: false,
      isRestoring: false,
      generationSlotKey: 'summary-slot-2',
      modelId: 'gemini-2.5-flash-lite',
      generate,
    }))

    expect(generate).not.toHaveBeenCalled()
    expect(useMedcloudLaunchStore.getState().pendingSummary?.messageId).toBe('message-2')
  })

  it('runs the external launch with the ordinary default model', async () => {
    const generate = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-default',
      modelId: MEDICAL_SUMMARY_MODEL_ID,
    })

    renderHook(() => useMedcloudAutoSummary({
      authLoading: false,
      hasPatient: true,
      summaryModelId: null,
      dataReady: true,
      isGenerating: false,
      isRestoring: false,
      generationSlotKey: 'summary-slot-default',
      modelId: MEDICAL_SUMMARY_MODEL_ID,
      generate,
    }))

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it('consumes the launch without regenerating when this patient already has a matching summary', async () => {
    const generate = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-existing',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    })

    renderHook(() => useMedcloudAutoSummary({
      authLoading: false,
      hasPatient: true,
      summaryModelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
      dataReady: true,
      isGenerating: false,
      isRestoring: false,
      generationSlotKey: 'summary-slot-existing',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
      generate,
    }))

    await waitFor(() => expect(
      useMedcloudLaunchStore.getState().pendingSummary,
    ).toBeNull())
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps the first-launch request pending until an adaptive data-scope change settles', async () => {
    const generateInitialScope = jest.fn(async () => undefined)
    const generateFinalScope = jest.fn(async () => undefined)
    useMedcloudLaunchStore.getState().queueSummary({
      messageId: 'message-small-record',
      modelId: MEDICAL_SUMMARY_MODEL_ID,
    })

    const { rerender } = renderHook((props: {
      generationSlotKey: string
      isRestoring: boolean
      generate: () => Promise<void>
    }) => useMedcloudAutoSummary({
      authLoading: false,
      hasPatient: true,
      summaryModelId: null,
      dataReady: true,
      isGenerating: false,
      isRestoring: props.isRestoring,
      generationSlotKey: props.generationSlotKey,
      modelId: MEDICAL_SUMMARY_MODEL_ID,
      generate: props.generate,
    }), {
      initialProps: {
        generationSlotKey: 'summary-slot-new-patient',
        isRestoring: false,
        generate: generateInitialScope,
      },
    })

    // The small-record default switches to 全部資料 during the same passive
    // effect flush. The old slot's deferred claim must be cancelled.
    rerender({
      generationSlotKey: 'summary-slot-all-data',
      isRestoring: true,
      generate: generateFinalScope,
    })
    expect(generateInitialScope).not.toHaveBeenCalled()
    expect(useMedcloudLaunchStore.getState().pendingSummary?.messageId)
      .toBe('message-small-record')

    rerender({
      generationSlotKey: 'summary-slot-all-data',
      isRestoring: false,
      generate: generateFinalScope,
    })

    await waitFor(() => expect(generateFinalScope).toHaveBeenCalledTimes(1))
    expect(generateInitialScope).not.toHaveBeenCalled()
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })
})
