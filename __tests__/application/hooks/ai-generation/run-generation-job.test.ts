import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { trackEvent } from '@/src/application/telemetry/usage-analytics'
import { runGenerationJob } from '@/src/application/hooks/ai-generation/run-generation-job'
import { saveEncryptedCache } from '@/src/infrastructure/cache/encrypted-session-cache'

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({
  saveEncryptedCache: jest.fn(),
}))

jest.mock('@/src/application/telemetry/usage-analytics', () => {
  const actual = jest.requireActual('@/src/application/telemetry/usage-analytics')
  return { ...actual, trackEvent: jest.fn() }
})

const mockedSaveEncryptedCache = jest.mocked(saveEncryptedCache)

describe('runGenerationJob cache ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('finishes the visible run without waiting for encryption', async () => {
    let finishSave!: () => void
    mockedSaveEncryptedCache.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSave = resolve
    }))
    const store = createAiResultStore<{ value: string }>()

    const generated = await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => ({ value: 'generated' }),
    })

    expect(generated).toEqual({ value: 'generated' })
    expect(store.getState().running['slot-a']).toBe(false)
    expect(mockedSaveEncryptedCache).toHaveBeenCalledTimes(1)
    finishSave()
  })

  it('guards a late cache write against a newer result or Bundle revision', async () => {
    mockedSaveEncryptedCache.mockResolvedValueOnce(undefined)
    const store = createAiResultStore<{ value: string }>()

    const generated = await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => ({ value: 'generated' }),
    })
    const shouldCommit = mockedSaveEncryptedCache.mock.calls[0]?.[2]

    expect(shouldCommit).toBeDefined()
    expect(shouldCommit?.()).toBe(true)

    store.getState().setResult('slot-a', { value: 'newer' })
    expect(shouldCommit?.()).toBe(false)

    store.setState((state) => ({ bundleRevision: state.bundleRevision + 1 }))
    expect(shouldCommit?.()).toBe(false)
    expect(generated).toEqual({ value: 'generated' })
  })

  it('guards encryption that finishes after an already-committed run is cancelled', async () => {
    mockedSaveEncryptedCache.mockResolvedValueOnce(undefined)
    const store = createAiResultStore<{ value: string }>()
    let commit = true

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => ({ value: 'generated before companion cancellation' }),
      shouldCommit: () => commit,
    })
    const cacheGuard = mockedSaveEncryptedCache.mock.calls[0]?.[2]
    expect(cacheGuard?.()).toBe(true)

    commit = false
    expect(cacheGuard?.()).toBe(false)
  })

  it('silently discards a result invalidated by user cancellation', async () => {
    const store = createAiResultStore<{ value: string }>()
    let commit = true

    const generated = await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => {
        commit = false
        return { value: 'cancelled' }
      },
      shouldCommit: () => commit,
    })

    expect(generated).toBeNull()
    expect(store.getState().running['slot-a']).toBe(false)
    expect(store.getState().byKey['slot-a']).toBeUndefined()
    expect(store.getState().errors['slot-a']).toBeNull()
    expect(mockedSaveEncryptedCache).not.toHaveBeenCalled()
  })

  it.each([false, true])('rolls back provisional cards on cancellation (prior completed artifact: %s)', async hasPrevious => {
    const store = createAiResultStore<{ value: string }>()
    const previous = { value: 'accepted previous artifact' }
    if (hasPrevious) store.getState().setResult('slot-a', previous)
    let commit = true
    await runGenerationJob({ store, key: 'slot-a', cacheKey: 'cache-a', shouldCommit: () => commit,
      produce: async () => {
        store.getState().setResult('slot-a', { value: 'provisional preview' })
        commit = false
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    expect(store.getState().byKey['slot-a']).toBe(hasPrevious ? previous : undefined)
    expect(store.getState().running['slot-a']).toBe(false)
    expect(mockedSaveEncryptedCache).not.toHaveBeenCalled()
  })

  it('never restores a cancelled preview baseline into a different Bundle epoch', async () => {
    const store = createAiResultStore<{ value: string }>()
    store.getState().setResult('slot-a', { value: 'old chart artifact' })
    const next = { value: 'new chart artifact' }
    await runGenerationJob({ store, key: 'slot-a', cacheKey: 'cache-a', shouldCommit: () => false,
      produce: async () => {
        store.setState(state => ({ bundleRevision: state.bundleRevision + 1, byKey: { 'slot-a': next } }))
        return null
      },
    })
    expect(store.getState().byKey['slot-a']).toBe(next)
  })

  it('does not turn an abort rejection into a generation error', async () => {
    const store = createAiResultStore<{ value: string }>()
    let commit = true
    const abortError = new Error('signal is aborted without reason')
    abortError.name = 'AbortError'

    const generated = await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => {
        commit = false
        throw abortError
      },
      shouldCommit: () => commit,
    })

    expect(generated).toBeNull()
    expect(store.getState().running['slot-a']).toBe(false)
    expect(store.getState().errors['slot-a']).toBeNull()
    expect(mockedSaveEncryptedCache).not.toHaveBeenCalled()
  })
})

describe('runGenerationJob ai_result reporting', () => {
  const mockedTrackEvent = trackEvent as jest.MockedFunction<typeof trackEvent>
  const analytics = { surface: 'summary' as const, modelId: 'gemini-2.5-flash' }

  beforeEach(() => {
    jest.clearAllMocks()
    mockedSaveEncryptedCache.mockResolvedValue(undefined)
  })

  it('reports one ok for a successful run', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => ({ value: 'generated' }),
    })

    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent).toHaveBeenCalledWith('ai_result', {
      surface: 'summary',
      outcome: 'ok',
      model_id: 'gemini-2.5-flash',
      duration_bucket: 'lt5',
    })
  })

  it('reports parse_failed for an unparseable reply', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => null,
    })

    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({ outcome: 'parse_failed' })
    expect(store.getState().errors['slot-a']).toBe('PARSE_FAILED')
  })

  it('reports a classified failure exactly once', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => {
        throw new Error('Daily quota exceeded')
      },
    })

    expect(mockedTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({ outcome: 'quota' })
  })

  it('reports a cancelled run as aborted, not an error', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      shouldCommit: () => false,
      produce: async () => ({ value: 'generated' }),
    })

    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({ outcome: 'aborted' })
  })

  it('passes a context-token estimate through when the caller has one', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: { ...analytics, contextTokens: 18_432 },
      produce: async () => ({ value: 'generated' }),
    })

    expect(mockedTrackEvent).toHaveBeenCalledWith('ai_result', {
      surface: 'summary',
      outcome: 'ok',
      model_id: 'gemini-2.5-flash',
      duration_bucket: 'lt5',
      context_tokens: 18_432,
    })
  })

  it('omits context_tokens entirely when the caller has no estimate', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => ({ value: 'generated' }),
    })

    // Absent, not 0: a surface with nothing to measure must not look like a
    // surface that measured an empty context.
    const params = mockedTrackEvent.mock.calls[0][1] as Record<string, unknown>
    expect('context_tokens' in params).toBe(false)
  })

  it('reports the estimate on a failure too — a big context is why it failed', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: { ...analytics, contextTokens: 240_000 },
      produce: async () => {
        throw new Error('request timed out')
      },
    })

    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({
      outcome: 'timeout',
      context_tokens: 240_000,
    })
  })

  it('passes the chart counts through when a chart is loaded', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: {
        ...analytics,
        counts: {
          resource_count: 1284,
          obs_count: 903,
          med_count: 61,
          doc_count: 42,
          encounter_count: 77,
          report_count: 118,
        },
      },
      produce: async () => ({ value: 'generated' }),
    })

    expect(mockedTrackEvent).toHaveBeenCalledWith('ai_result', {
      surface: 'summary',
      outcome: 'ok',
      model_id: 'gemini-2.5-flash',
      duration_bucket: 'lt5',
      resource_count: 1284,
      obs_count: 903,
      med_count: 61,
      doc_count: 42,
      encounter_count: 77,
      report_count: 118,
    })
  })

  it('omits every count when no chart is loaded', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => ({ value: 'generated' }),
    })

    // Absent, not zero — "no chart loaded" and "chart loaded, empty" are
    // different findings and must stay distinguishable in the report.
    expect(mockedTrackEvent).toHaveBeenCalledWith('ai_result', {
      surface: 'summary',
      outcome: 'ok',
      model_id: 'gemini-2.5-flash',
      duration_bucket: 'lt5',
    })
  })

  it('reports the counts on a failure too — chart size is why it failed', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: {
        ...analytics,
        contextTokens: 240_000,
        counts: {
          resource_count: 24_010,
          obs_count: 21_000,
          med_count: 610,
          doc_count: 400,
          encounter_count: 900,
          report_count: 1_100,
        },
      },
      produce: async () => {
        throw new Error('Daily quota exceeded')
      },
    })

    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({
      outcome: 'quota',
      context_tokens: 240_000,
      resource_count: 24_010,
      obs_count: 21_000,
    })
  })

  it('sends the loaded totals and the fed counts side by side', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: {
        ...analytics,
        contextTokens: 18_432,
        counts: {
          resource_count: 1284,
          obs_count: 903,
          med_count: 61,
          doc_count: 42,
          encounter_count: 77,
          report_count: 118,
        },
        fedCounts: {
          fed_resource_count: 190,
          fed_obs_count: 120,
          fed_med_count: 20,
          fed_doc_count: 8,
          fed_encounter_count: 12,
          fed_report_count: 30,
        },
      },
      produce: async () => ({ value: 'generated' }),
    })

    // The pairing is the point: how big the patient was AND how much reached
    // the model, on one event, for this one outcome.
    expect(mockedTrackEvent).toHaveBeenCalledWith('ai_result', {
      surface: 'summary',
      outcome: 'ok',
      model_id: 'gemini-2.5-flash',
      duration_bucket: 'lt5',
      context_tokens: 18_432,
      resource_count: 1284,
      obs_count: 903,
      med_count: 61,
      doc_count: 42,
      encounter_count: 77,
      report_count: 118,
      fed_resource_count: 190,
      fed_obs_count: 120,
      fed_med_count: 20,
      fed_doc_count: 8,
      fed_encounter_count: 12,
      fed_report_count: 30,
    })
  })

  it('accepts a partial fed set — report interpretation feeds one report', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: {
        surface: 'report_interp',
        modelId: 'gemini-2.5-flash-lite',
        fedCounts: { fed_resource_count: 1, fed_report_count: 1 },
      },
      produce: async () => ({ value: 'generated' }),
    })

    const params = mockedTrackEvent.mock.calls[0][1] as Record<string, unknown>
    expect(params).toMatchObject({ fed_resource_count: 1, fed_report_count: 1 })
    expect('fed_med_count' in params).toBe(false)
  })

  it('omits every fed count where there is no fed context', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics,
      produce: async () => ({ value: 'generated' }),
    })

    const params = mockedTrackEvent.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(params).some((key) => key.startsWith('fed_'))).toBe(false)
  })

  it('reports the fed counts on a failure too', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      analytics: {
        ...analytics,
        counts: {
          resource_count: 24_010,
          obs_count: 21_000,
          med_count: 610,
          doc_count: 400,
          encounter_count: 900,
          report_count: 1_100,
        },
        fedCounts: {
          fed_resource_count: 9_800,
          fed_obs_count: 9_000,
          fed_med_count: 200,
          fed_doc_count: 60,
          fed_encounter_count: 240,
          fed_report_count: 300,
        },
      },
      produce: async () => {
        throw new Error('request timed out')
      },
    })

    // "Trimmed to 9,800 and STILL timed out" is the finding this pairing
    // exists to make visible.
    expect(mockedTrackEvent.mock.calls[0][1]).toMatchObject({
      outcome: 'timeout',
      resource_count: 24_010,
      fed_resource_count: 9_800,
    })
  })

  it('reports nothing when the caller did not opt in', async () => {
    const store = createAiResultStore<{ value: string }>()

    await runGenerationJob({
      store,
      key: 'slot-a',
      cacheKey: 'cache-a',
      produce: async () => ({ value: 'generated' }),
    })

    expect(mockedTrackEvent).not.toHaveBeenCalled()
  })
})
