import { webcrypto } from 'crypto'
import { act, render, waitFor } from '@testing-library/react'
import { MedcloudLaunchProvider } from '@/src/application/providers/medcloud-launch.provider'
import {
  MEDCLOUD_AUTO_LAUNCH_URL,
  MEDCLOUD_LAUNCH_CONTEXT_ACK_TYPE,
  VGTPE_SITE_LAUNCH_URL,
  VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
  VGTPE_TVGHBRAIN_PROFILE_ID,
} from '@/src/application/launch/medcloud-launch-context'
import { useAiConfigStore } from '@/src/application/stores/ai-config.store'
import {
  MODEL_PREF_DEFAULTS,
  useModelPrefsStore,
} from '@/src/application/stores/model-prefs.store'
import { useSummaryPrefsStore } from '@/src/application/stores/medical-summary-prefs.store'
import { useSafetyPrefsStore } from '@/src/application/stores/safety-prefs.store'
import { createEmptyOpenAiCompatibleConfig } from '@/src/shared/types/openai-compatible.types'
import { useMedcloudLaunchStore } from '@/src/application/launch/medcloud-launch.store'
import { MEDICAL_SUMMARY_MODEL_ID } from '@/src/core/use-cases/medical-summary/generate-medical-summary.use-case'
import { SAFETY_ALERTS_MODEL_ID } from '@/src/core/use-cases/safety-alerts/generate-safety-alerts.use-case'
import { BUNDLE_CHANGE_SETTLED_EVENT } from '@/src/shared/utils/reset-on-bundle-change'
import { PROGRESSIVE_IMPORT_EVENT, stopProgressiveImport, useProgressiveImportStore } from '@/src/application/stores/progressive-import.store'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'

const launchHref = 'https://mediprisma.tw/app/?medcloud2=auto&site=vghtpe'
const ENCRYPTED_RUNTIME_SECRET =
  'a256gcm.v1.AAECAwQFBgcICQoL.xdA13rrC_SiHbJycmQY.VPy_M14qGoZF29EY9sG1Qw'
const jsdomCrypto = globalThis.crypto

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: jsdomCrypto, configurable: true })
})

function extensionMessage(
  messageId = 'message-1',
  credential: string | null = ENCRYPTED_RUNTIME_SECRET,
  site: 'vghtpe' | null = 'vghtpe',
) {
  const event = new MessageEvent('message', {
    data: {
      source: 'medcloud2-extension',
      type: 'MEDIPRISMA_LAUNCH_CONTEXT',
      version: 1,
      messageId,
      ...(credential ? { credential } : {}),
      ...(site ? { site } : {}),
    },
    origin: 'https://mediprisma.tw',
  })
  Object.defineProperty(event, 'source', { value: window })
  return event
}

function settleImportedBundle() {
  act(() => window.dispatchEvent(new Event(BUNDLE_CHANGE_SETTLED_EVENT)))
}

describe('MedcloudLaunchProvider', () => {
  let postMessage: jest.SpyInstance

  beforeEach(() => {
    postMessage = jest.spyOn(window, 'postMessage').mockImplementation(() => {})
    useAiConfigStore.setState({
      openAiCompatibleProfiles: [],
      openAiCompatible: createEmptyOpenAiCompatibleConfig(),
      credentialsHydrating: false,
    })
    useModelPrefsStore.setState({
      prefs: { chat: 'gemini-2.5-flash-lite', insights: 'gemini-2.5-flash-lite' },
    })
    useSummaryPrefsStore.setState({ modelId: 'gemini-2.5-flash-lite' })
    useSafetyPrefsStore.setState({ modelId: 'gemini-2.5-flash-lite' })
    useMedcloudLaunchStore.getState().clear()
    useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
  })

  afterEach(() => postMessage.mockRestore())

  it('closes an accepted visits round on transport failure without replaying on status restore', async () => {
    jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('visits')
    useProgressiveImportStore.setState({ current: { runId: 'run-failed', importId: 'visits', phase: 'reports-pending' } })
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div /></MedcloudLaunchProvider>)
    act(() => stopProgressiveImport('run-failed', 'failed'))
    await waitFor(() => expect(useMedcloudLaunchStore.getState().pendingSummary?.progressiveImportId).toBe('visits'))
    const request = useMedcloudLaunchStore.getState().pendingSummary!
    act(() => useMedcloudLaunchStore.getState().claimSummary(request.messageId))
    act(() => stopProgressiveImport('run-failed', 'failed'))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })
  it('binds queued cloud summaries to the active progressive run and import', () => {
    const active = jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
    useProgressiveImportStore.setState({ pendingRunId: 'run-a' })
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().pendingSummary).toMatchObject({ progressiveRunId: 'run-a', progressiveImportId: 'cloud-import' })
    active.mockRestore()
  })

  it.each(['cancelled', 'patient-changed', 'privacy-stale'] as const)('does not queue a summary when a %s import finishes its accepted save', phase => {
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    act(() => useProgressiveImportStore.setState({ pendingRunId: 'stopped-run', stoppedRuns: { 'stopped-run': phase } }))
    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it.each(['cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'] as const)(
    'does not rearm a %s launch on a subsequent manual chart', phase => {
      render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
      act(() => useProgressiveImportStore.setState({ pendingRunId: 'run-a', stoppedRuns: { 'run-a': phase } }))
      settleImportedBundle()
      act(() => useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} }))
      settleImportedBundle()
      expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    },
  )

  it('retires a pre-commit stop even without a settled event or a current run', () => {
    const data = jest.spyOn(LocalBundleService, 'hasData').mockReturnValue(false)
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    act(() => useProgressiveImportStore.setState({ stoppedRuns: { 'run-a': 'cancelled' } }))
    act(() => useProgressiveImportStore.setState({ stoppedRuns: {} }))
    data.mockReturnValue(true)
    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    data.mockRestore()
  })

  it('does not rearm a stopped VGH launch when credentials arrive after a manual chart', async () => {
    render(<MedcloudLaunchProvider launchHref={launchHref}><div>app</div></MedcloudLaunchProvider>)
    act(() => useProgressiveImportStore.setState({ pendingRunId: 'run-a', stoppedRuns: { 'run-a': 'patient-changed' } }))
    act(() => useProgressiveImportStore.setState({ pendingRunId: null, stoppedRuns: {} }))
    settleImportedBundle()
    act(() => window.dispatchEvent(extensionMessage('late-credential')))
    await waitFor(() => expect(postMessage).toHaveBeenCalled())
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it('keeps a generic delivery failure recoverable for the same run', () => {
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    act(() => useProgressiveImportStore.setState({ pendingRunId: 'run-a', stoppedRuns: { 'run-a': 'failed' } }))
    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().pendingSummary).not.toBeNull()
  })

  it.each(['hospital-reports-failed', 'hospital'] as const)('refreshes automatic summaries once for an accepted final %s replacement', stage => {
    const active = jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
    useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud-import', phase: 'waiting' } })
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    settleImportedBundle()
    const first = useMedcloudLaunchStore.getState().pendingSummary!
    useMedcloudLaunchStore.getState().claimSummary(first.messageId)
    active.mockReturnValue('updated-import')
    act(() => useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'updated-import', phase: 'loaded' } }))
    const receipt = { version: 1, ok: true, stage, runId: 'run-a', requestId: 'updated-request', importId: 'updated-import', stopped: false }
    act(() => window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: receipt })))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toMatchObject({ messageId: 'updated-request', progressiveRunId: 'run-a', progressiveImportId: 'updated-import' })
    useMedcloudLaunchStore.getState().claimSummary('updated-request')
    act(() => window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: receipt })))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    active.mockRestore()
  })

  it.each([{ stage: 'cloud', stopped: false }, { stage: 'hospital-visits', stopped: false }, { stage: 'hospital-empty', stopped: false }, { stage: 'hospital-visits', stopped: true }])('does not requeue a $stage receipt with stopped=$stopped', receipt => {
    const active = jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
    render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
    settleImportedBundle()
    useMedcloudLaunchStore.getState().claimSummary(useMedcloudLaunchStore.getState().pendingSummary!.messageId)
    act(() => window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: { version: 1, ok: true, runId: 'run-a', requestId: 'ignored', importId: 'cloud-import', ...receipt } })))
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    active.mockRestore()
  })

  it('activates the runtime-only profile, selects it everywhere, and acknowledges', async () => {
    const { unmount } = render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage()))

    await waitFor(() => expect(
      useAiConfigStore.getState().openAiCompatibleProfiles[0],
    ).toMatchObject({
      profileId: VGTPE_TVGHBRAIN_PROFILE_ID,
      runtimeOnly: true,
      apiKey: 'runtime-secret',
    }))
    expect(useMedcloudLaunchStore.getState().runtimeModelId)
      .toBe(VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID)
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: 'gemini-2.5-flash-lite',
      insights: 'gemini-2.5-flash-lite',
    })
    expect(useSummaryPrefsStore.getState().modelId).toBe('gemini-2.5-flash-lite')
    expect(useSafetyPrefsStore.getState().modelId).toBe('gemini-2.5-flash-lite')
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()

    settleImportedBundle()
    await waitFor(() => expect(useMedcloudLaunchStore.getState().pendingSummary).toEqual({
      messageId: 'message-1',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    }))
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'mediprisma',
      type: MEDCLOUD_LAUNCH_CONTEXT_ACK_TYPE,
      messageId: 'message-1',
    }), 'https://mediprisma.tw')
    expect(Array.from({ length: localStorage.length }, (_, index) => (
      localStorage.getItem(localStorage.key(index) ?? '') ?? ''
    )).join('\n')).not.toContain('runtime-secret')

    unmount()
    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().runtimeModelId).toBeNull()
  })

  it('uses the ordinary default model for an external auto launch without installing VGH runtime', async () => {
    useModelPrefsStore.setState({
      prefs: { chat: 'custom-chat', insights: 'custom-insights' },
    })
    useSummaryPrefsStore.setState({ modelId: 'custom-summary' })
    useSafetyPrefsStore.setState({ modelId: 'custom-safety' })
    render(
      <MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    await waitFor(() => {
      expect(useMedcloudLaunchStore.getState().runtimeModelId)
        .toBe(MEDICAL_SUMMARY_MODEL_ID)
    })
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: 'custom-chat',
      insights: 'custom-insights',
    })
    expect(useSummaryPrefsStore.getState().modelId).toBe('custom-summary')
    expect(useSafetyPrefsStore.getState().modelId).toBe('custom-safety')
    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(postMessage).not.toHaveBeenCalled()

    settleImportedBundle()

    await waitFor(() => expect(
      useMedcloudLaunchStore.getState().pendingSummary,
    ).toEqual({
      messageId: expect.any(String),
      modelId: MEDICAL_SUMMARY_MODEL_ID,
    }))
  })

  it('selects VGHBrain for a site-only launch without queuing an automatic summary', async () => {
    render(
      <MedcloudLaunchProvider launchHref={VGTPE_SITE_LAUNCH_URL}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage('message-site-only')))

    await waitFor(() => expect(
      useAiConfigStore.getState().openAiCompatibleProfiles[0]?.profileId,
    ).toBe(VGTPE_TVGHBRAIN_PROFILE_ID))
    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().runtimeModelId)
      .toBe(VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID)
    expect(useSummaryPrefsStore.getState().modelId).toBe('gemini-2.5-flash-lite')
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('waits for the VGH credential when the imported Bundle settles first', async () => {
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    settleImportedBundle()
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()

    act(() => window.dispatchEvent(extensionMessage('message-bundle-first')))

    await waitFor(() => expect(useMedcloudLaunchStore.getState().pendingSummary).toEqual({
      messageId: 'message-bundle-first',
      modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
    }))
  })

  it('ignores a site context that does not match the route controls', async () => {
    render(
      <MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage('message-wrong-site')))
    await act(async () => { await Promise.resolve() })

    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('rejects a VGH credential on the external default-model route', async () => {
    render(
      <MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage(
      'message-secret-on-external-route',
      ENCRYPTED_RUNTIME_SECRET,
      null,
    )))
    await act(async () => { await Promise.resolve() })

    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('holds a valid message until credential hydration completes', async () => {
    useAiConfigStore.setState({ credentialsHydrating: true })
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage()))
    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(postMessage).not.toHaveBeenCalled()

    act(() => useAiConfigStore.setState({ credentialsHydrating: false }))
    await waitFor(() => expect(
      useAiConfigStore.getState().openAiCompatibleProfiles[0]?.profileId,
    ).toBe(VGTPE_TVGHBRAIN_PROFILE_ID))
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('acknowledges a successful retry without queuing or decrypting it again', async () => {
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage()))
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    settleImportedBundle()
    await waitFor(() => expect(
      useMedcloudLaunchStore.getState().pendingSummary,
    ).not.toBeNull())
    expect(useMedcloudLaunchStore.getState().claimSummary('message-1')).toBe(true)

    act(() => window.dispatchEvent(extensionMessage()))

    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  })

  it('does not acknowledge or install a profile when authentication fails', async () => {
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    act(() => window.dispatchEvent(extensionMessage(
      'message-invalid',
      `${ENCRYPTED_RUNTIME_SECRET.slice(0, -1)}A`,
    )))

    await act(async () => { await Promise.resolve() })
    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('clears the in-memory credential and queued launch on page exit', async () => {
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )
    act(() => window.dispatchEvent(extensionMessage()))
    await waitFor(() => expect(
      useAiConfigStore.getState().openAiCompatibleProfiles,
    ).toHaveLength(1))
    settleImportedBundle()
    await waitFor(() => expect(
      useMedcloudLaunchStore.getState().pendingSummary,
    ).not.toBeNull())

    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
    expect(useMedcloudLaunchStore.getState().runtimeModelId).toBeNull()
    expect(useModelPrefsStore.getState().prefs).toEqual({
      chat: 'gemini-2.5-flash-lite',
      insights: 'gemini-2.5-flash-lite',
    })
    expect(useSummaryPrefsStore.getState().modelId).toBe('gemini-2.5-flash-lite')
    expect(useSafetyPrefsStore.getState().modelId).toBe('gemini-2.5-flash-lite')
  })

  it('recovers stale runtime-only preferences on a later launch without Medcloud parameters', async () => {
    useModelPrefsStore.setState({
      prefs: {
        chat: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
        insights: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID,
      },
    })
    useSummaryPrefsStore.setState({ modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID })
    useSafetyPrefsStore.setState({ modelId: VGTPE_TVGHBRAIN_LOGICAL_MODEL_ID })

    render(
      <MedcloudLaunchProvider launchHref="https://mediprisma.tw/app/">
        <div>app</div>
      </MedcloudLaunchProvider>,
    )

    await waitFor(() => expect(useModelPrefsStore.getState().prefs).toEqual(
      MODEL_PREF_DEFAULTS,
    ))
    expect(useSummaryPrefsStore.getState().modelId).toBe(MEDICAL_SUMMARY_MODEL_ID)
    expect(useSafetyPrefsStore.getState().modelId).toBe(SAFETY_ALERTS_MODEL_ID)
  })

  it('ignores messages from a different origin', () => {
    render(
      <MedcloudLaunchProvider launchHref={launchHref}>
        <div>app</div>
      </MedcloudLaunchProvider>,
    )
    const event = extensionMessage()
    Object.defineProperty(event, 'origin', { value: 'https://evil.example' })

    act(() => window.dispatchEvent(event))

    expect(useAiConfigStore.getState().openAiCompatibleProfiles).toHaveLength(0)
    expect(postMessage).not.toHaveBeenCalled()
  })
})


test.each(['hospital-empty', 'cloud-only'])('%s transfers only an unclaimed cloud request to the new import', stage => {
  const active = jest.spyOn(LocalBundleService, 'getActiveImportId').mockReturnValue('cloud-import')
  useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'cloud-import', phase: 'waiting' } })
  render(<MedcloudLaunchProvider launchHref={MEDCLOUD_AUTO_LAUNCH_URL}><div>app</div></MedcloudLaunchProvider>)
  act(() => window.dispatchEvent(new Event('mediprisma:bundle-change-settled')))
  useMedcloudLaunchStore.getState().queueSummary({ messageId: 'pending-cloud', modelId: MEDICAL_SUMMARY_MODEL_ID, progressiveRunId: 'run-a', progressiveImportId: 'cloud-import' })
  active.mockReturnValue('empty-import')
  act(() => useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'empty-import', phase: 'empty', stage: 'hospital-empty' } }))
  const receipt = { version: 1, ok: true, stage, runId: 'run-a', requestId: 'empty', importId: 'empty-import', stopped: false }
  act(() => window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: receipt })))
  expect(useMedcloudLaunchStore.getState().pendingSummary).toMatchObject({ messageId: 'pending-cloud', progressiveImportId: 'empty-import' })
  useMedcloudLaunchStore.getState().claimSummary('pending-cloud')
  act(() => window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: receipt })))
  expect(useMedcloudLaunchStore.getState().pendingSummary).toBeNull()
  active.mockRestore()
})

