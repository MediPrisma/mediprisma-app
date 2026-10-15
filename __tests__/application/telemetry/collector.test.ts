import { beginCollectorObservation, collectorError, collectorFeature, collectorStatus, cancelCollectorRequests } from '@/src/application/telemetry/collector'
import { collectorEventV5Schema } from '@/src/shared/contracts/collector-event'
import { runGenerationJob } from '@/src/application/hooks/ai-generation/run-generation-job'
import { createAiResultStore } from '@/src/application/hooks/ai-generation/create-ai-result-store'
import { MODEL_CATALOG } from '@/src/shared/constants/ai-models.constants'
import { mockCollectorPermission } from '../../helpers/collector-permissions'

jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ saveEncryptedCache: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ trackEvent: jest.fn() }))

const TOKEN = 'synthetic-token-'.repeat(4)
const mockGetToken = jest.fn()
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: mockGetToken })),
}))
import { captureCollectorAuth } from '@/src/infrastructure/telemetry/collector-auth'
const start = () => beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'feature', mode: 'structured' })
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const body = () => JSON.parse(jest.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
let permission: ReturnType<typeof mockCollectorPermission>

beforeEach(() => {
  cancelCollectorRequests()
  jest.useFakeTimers()
  localStorage.clear()
  permission = mockCollectorPermission()
  mockGetToken.mockReset().mockResolvedValue(TOKEN)
  jest.mocked(captureCollectorAuth).mockClear()
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/?site=vghtpe')
  delete process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN
})
afterEach(async () => { cancelCollectorRequests(); await settle(); permission.restore(); jest.useRealTimers() })

test.each(['/', '/?site=hmc', '/app-hmc/', '/app-hmc/?site=hmc', '/?site=VGHTPE', '/?site=', '/?site=vghtpe&site=hmc', '/?site=vghtpe&site=vghtpe'])('zero collector traffic and no enablement on %s', async (url) => {
  window.history.replaceState({}, '', url)
  expect(collectorStatus().enabled).toBe(false)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  expect(captureCollectorAuth).not.toHaveBeenCalled()
  expect(permission.query).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

test.each(['/?site=vghtpe', '/app/?site=vghtpe', '/app-hmc/?site=vghtpe'])('automatically sends with existing permission on %s regardless of pathname', async (url) => {
  window.history.replaceState({}, '', url)
  expect(collectorStatus().enabled).toBe(true)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(body().site).toBe('vghtpe')
  expect(collectorEventV5Schema.safeParse(body()).success).toBe(true)
})

test.each(['prompt', 'denied'] as const)('permission %s skips telemetry without changing clinical success or cache', async (state) => {
  permission.status.state = state
  const before = collectorStatus().dropped
  const store = createAiResultStore<{ result: string }>()
  const result = await runGenerationJob({ store, key: 'synthetic-slot', cacheKey: 'synthetic-cache',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' }, produce: async () => ({ result: 'synthetic-success' }) })
  await settle()
  expect(result).toEqual({ result: 'synthetic-success' })
  expect(store.getState().byKey['synthetic-slot']).toEqual(result)
  expect(store.getState().running['synthetic-slot']).toBe(false)
  expect(store.getState().errors['synthetic-slot']).toBeFalsy()
  expect(permission.query).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
  expect(mockGetToken).not.toHaveBeenCalled()
  expect(collectorStatus()).toMatchObject({ enabled: true, dropped: before + 1, in_flight: 0, cooling_down: false })
})

test.each(['missing API', 'missing query', 'query throws', 'unsupported names', 'query rejects', 'invalid status'])('%s never falls back to a permission-triggering fetch', async (scenario) => {
  if (scenario === 'missing API') Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined })
  if (scenario === 'missing query') Object.defineProperty(navigator, 'permissions', { configurable: true, value: {} })
  if (scenario === 'query throws') permission.query.mockImplementation(() => { throw new Error('unavailable') })
  if (scenario === 'unsupported names') permission.query.mockRejectedValue(new TypeError('unsupported descriptor'))
  if (scenario === 'query rejects') permission.query.mockRejectedValue(new DOMException('blocked', 'SecurityError'))
  if (scenario === 'invalid status') permission.query.mockResolvedValue(null)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  expect(mockGetToken).not.toHaveBeenCalled()
  expect(collectorStatus()).toMatchObject({ in_flight: 0, cooling_down: false })
})

test.each([
  ['https://collector.mediprisma.tw', 'local-network'],
  ['https://collector.mediprisma.tw:443', 'local-network'],
  ['https://collector.invalid:8787', 'local-network'],
  ['http://127.0.0.1:8787', 'loopback-network'],
  ['http://localhost:8787', 'loopback-network'],
  ['http://[::1]:8787', 'loopback-network'],
])('queries the relevant permission for %s without touching the network first', async (origin, name) => {
  process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN = origin
  permission.query.mockImplementation(async () => {
    expect(fetch).not.toHaveBeenCalled()
    expect(mockGetToken).not.toHaveBeenCalled()
    return permission.status
  })
  start().finish({ outcome: 'ok' })
  await settle()
  expect(permission.query).toHaveBeenCalledWith({ name })
  expect(permission.query).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('production Collector URL uses standard HTTPS 443 without changing site gating', async () => {
  process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN = 'https://collector.mediprisma.tw'
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledWith('https://collector.mediprisma.tw/collector/v1/events', expect.objectContaining({ method: 'POST' }))
  jest.mocked(fetch).mockClear()
  window.history.replaceState({}, '', '/app/?site=hmc')
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test.each(['granted', 'prompt', 'denied'] as const)('uses the legacy descriptor only when split permissions are unsupported (%s)', async (state) => {
  permission.query.mockRejectedValueOnce(new TypeError('unsupported descriptor')).mockResolvedValue({ state })
  start().finish({ outcome: 'ok' })
  await settle()
  expect(permission.query.mock.calls).toEqual([[{ name: 'loopback-network' }], [{ name: 'local-network-access' }]])
  expect(fetch).toHaveBeenCalledTimes(state === 'granted' ? 1 : 0)
})

test('a split permission denial cannot be overridden by a legacy grant', async () => {
  permission.query.mockResolvedValueOnce({ state: 'denied' }).mockResolvedValue({ state: 'granted' })
  start().finish({ outcome: 'ok' })
  await settle()
  expect(permission.query).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})

test('skips do not trigger cooldown or replay; the next newly permitted event resumes automatically', async () => {
  permission.status.state = 'prompt'
  for (let i = 0; i < 4; i++) {
    start().finish({ outcome: 'ok' })
    await settle()
  }
  expect(fetch).not.toHaveBeenCalled()
  expect(collectorStatus().cooling_down).toBe(false)
  permission.status.state = 'granted'
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  permission.status.state = 'denied'
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('revoking permission while credentials are pending prevents the fetch', async () => {
  let resolveToken!: (value: string) => void
  mockGetToken.mockImplementation(() => new Promise<string>(resolve => { resolveToken = resolve }))
  start().finish({ outcome: 'ok' })
  await settle()
  permission.status.state = 'prompt'
  resolveToken(TOKEN)
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  expect(collectorStatus().in_flight).toBe(0)
})

test.each(['navigation', 'pagehide', 'timeout'] as const)('a late permission grant after %s cannot send', async (cause) => {
  let resolvePermission!: (value: { state: PermissionState }) => void
  permission.query.mockImplementation(() => new Promise(resolve => { resolvePermission = resolve }))
  const store = createAiResultStore<{ result: string }>()
  const result = await runGenerationJob({ store, key: 'synthetic-slot', cacheKey: 'synthetic-cache',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' }, produce: async () => ({ result: 'synthetic-success' }) })
  expect(result).toEqual({ result: 'synthetic-success' })
  await settle()
  if (cause === 'navigation') window.history.replaceState({}, '', '/?site=hmc')
  if (cause === 'pagehide') window.dispatchEvent(new Event('pagehide'))
  if (cause === 'timeout') {
    await jest.advanceTimersByTimeAsync(5000)
    expect(collectorStatus().in_flight).toBe(0)
  }
  resolvePermission({ state: 'granted' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  expect(mockGetToken).not.toHaveBeenCalled()
  expect(collectorStatus().in_flight).toBe(0)
})

test('moving to app-hmc while keeping site=vghtpe does not suppress the observation', async () => {
  const observation = start()
  window.history.replaceState({}, '', '/app-hmc/?site=vghtpe')
  observation.finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(body().site).toBe('vghtpe')
})

test('start-site and send-site checks cannot be bypassed by navigation', async () => {
  window.history.replaceState({}, '', '/?site=hmc')
  const otherSite = start()
  window.history.replaceState({}, '', '/?site=vghtpe')
  otherSite.finish({ outcome: 'ok' })
  const observation = start()
  observation.finish({ outcome: 'ok' })
  window.history.replaceState({}, '', '/?site=hmc')
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test('exact resource counts and approved model codes leave the browser, once per observation', async () => {

  const observation = beginCollectorObservation({
    feature: 'summary', modelId: 'openai-compatible-custom:SECRET-PROFILE', sampleKind: 'feature', mode: 'structured',
    counts: { resource_count: 8237, med_count: 47, encounter_count: 23, doc_count: 0, obs_count: 8121, report_count: 19 },
    fedCounts: { fed_resource_count: 124, fed_med_count: 4, fed_encounter_count: 11,
      fed_obs_count: 100, fed_report_count: 8, fed_doc_count: 0 }, contextTokens: 90200, contextTrimmed: true,
  })
  observation.finish({ outcome: 'parse_failed', phase: 'parse', responseComplete: true })
  observation.finish({ outcome: 'ok' })
  expect(fetch).not.toHaveBeenCalled() // caller returns before even starting the fetch
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  const payload = body()
  expect(collectorEventV5Schema.safeParse(payload).success).toBe(true)
  expect(payload).toMatchObject({ schema_version: 5, site: 'vghtpe', model: 'custom', provider: 'custom', status: 'error', response_complete: true,
    diagnostics: { loaded: { total: 8237, medications: 47, encounters: 23, documents: 0, observations: 8121, reports: 19 },
      prepared: { total: 124, medications: 4, encounters: 11, observations: 100, reports: 8, documents: 0 },
      context_tokens_bucket: '32001-128000', context_trimmed: true } })
  expect(JSON.stringify(payload)).not.toMatch(/SECRET|90200/)
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8787/collector/v1/events', expect.objectContaining({
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
  }))
  expect(localStorage.length).toBe(1)
  expect(sessionStorage.length).toBe(0)
  expect(JSON.stringify(collectorStatus())).not.toContain(TOKEN)
})

test('unknown counts are absent, not zero; fixed model catalogue is representable', async () => {

  start().finish({ outcome: 'ok' })
  await settle()
  const payload = body()
  expect(payload.diagnostics).not.toHaveProperty('loaded')
  expect(payload.diagnostics).not.toHaveProperty('prepared')
  expect(payload.response_complete).toBeNull()
  for (const model of MODEL_CATALOG) {
    expect(collectorEventV5Schema.safeParse({ ...payload, model: model.provider === 'custom' ? 'custom' : model.id }).success).toBe(true)
  }
})

test('invalid counts are omitted, never rounded, made positive or coerced from strings', async () => {
  const invalidCounts = { resource_count: Number.MAX_SAFE_INTEGER + 1, encounter_count: -23, med_count: 1.5,
    obs_count: Number.NaN, report_count: Number.POSITIVE_INFINITY, doc_count: '12' } as unknown as Parameters<typeof beginCollectorObservation>[0]['counts']
  beginCollectorObservation({ feature: 'summary', modelId: 'gpt-5.4-nano', sampleKind: 'feature', mode: 'structured',
    counts: invalidCounts }).finish({ outcome: 'ok' })
  await settle()
  expect(body().diagnostics).not.toHaveProperty('loaded')
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12', '11-50', null]) {
    expect(collectorEventV5Schema.safeParse({ ...body(), diagnostics: { ...body().diagnostics, loaded: { medications: value } } }).success).toBe(false)
  }
})

test('rejects PHI-shaped fields and arbitrary error/feature strings on the wire', async () => {

  start().finish({ outcome: 'error' })
  await settle()
  const payload = body()
  for (const field of ['prompt', 'response', 'patient_id', 'token', 'url', 'error_message']) {
    expect(collectorEventV5Schema.safeParse({ ...payload, [field]: 'SYNTHETIC-SECRET' }).success).toBe(false)
    expect(collectorEventV5Schema.safeParse({ ...payload, diagnostics: { ...payload.diagnostics, [field]: 'SYNTHETIC-SECRET' } }).success).toBe(false)
  }
  expect(collectorEventV5Schema.safeParse({ ...payload, error_class: 'SYNTHETIC-SECRET' }).success).toBe(false)
  expect(collectorFeature('SYNTHETIC-PATIENT-TITLE')).toBe('ai_other')
  expect(collectorFeature('__proto__')).toBe('ai_other')
  expect(collectorError(new Error('SYNTHETIC-SECRET'))).toBe('error')
})

test('collector failure cannot change clinical success, cache update or loading state', async () => {

  jest.mocked(fetch).mockRejectedValue(new Error('offline'))
  const store = createAiResultStore<{ result: string }>()
  const result = await runGenerationJob({ store, key: 'synthetic-slot', cacheKey: 'synthetic-cache',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' }, produce: async () => ({ result: 'synthetic-success' }) })
  expect(result).toEqual({ result: 'synthetic-success' })
  expect(store.getState().running['synthetic-slot']).toBe(false)
  expect(store.getState().errors['synthetic-slot']).toBeFalsy()
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test.each([[0, 6], [3, 3], [6, 0], [1, 0]])('summary terminal event measures %i/%i without discarding partial results', async (succeeded, failed) => {
  const store = createAiResultStore<{ cardErrors?: object; completedCardIds: string[] }>()
  const parsed = { cardErrors: failed ? { safety: 'SYNTHETIC-SECRET' } : undefined, completedCardIds: ['synthetic-card'] }
  const result = await runGenerationJob({
    store, key: 'summary', cacheKey: 'synthetic-summary',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' },
    produce: async (measure) => {
      measure({ outcome: failed ? 'parse_failed' : 'ok', summaryCards: { succeeded, failed } })
      return parsed
    },
  })
  await settle()
  expect(result).toBe(parsed)
  expect(store.getState().byKey.summary).toBe(parsed)
  expect(store.getState().errors.summary).toBeNull()
  expect(store.getState().running.summary).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(body()).toMatchObject({
    schema_version: 5, sample_kind: 'feature', status: failed ? 'error' : 'completed',
    error_class: failed ? 'parse_failed' : null,
    diagnostics: { summary_cards: { succeeded, failed }, phase: failed ? 'parse' : 'unknown' },
  })
  expect(JSON.stringify(body())).not.toMatch(/SYNTHETIC-SECRET|synthetic-card|cardErrors/)
})

test.each(['cancelled', 'superseded', 'thrown'] as const)('a %s run overrides pending card measurements', async (kind) => {
  const store = createAiResultStore<object>()
  let commit = true
  const result = await runGenerationJob({
    store, key: 'summary', cacheKey: 'synthetic-summary',
    analytics: { surface: 'summary', modelId: 'gpt-5.4-nano' }, shouldCommit: () => commit,
    produce: async (measure) => {
      measure({ outcome: 'ok', summaryCards: { succeeded: 6, failed: 0 } })
      if (kind === 'thrown') throw new Error('SYNTHETIC-SECRET')
      if (kind === 'superseded') store.setState({ bundleRevision: 1 })
      else commit = false
      return {}
    },
  })
  await settle()
  expect(result).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(body().status).toBe(kind === 'thrown' ? 'error' : 'aborted')
  expect(body().diagnostics).not.toHaveProperty('summary_cards')
  expect(store.getState().byKey.summary).toBeUndefined()
})

test('5-second timeout, bounded concurrency and automatic recovery without eight-hour expiry', async () => {

  jest.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
  }))
  for (let i = 0; i < 20; i++) start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(collectorStatus().in_flight).toBe(2)
  await jest.advanceTimersByTimeAsync(5000)
  expect(collectorStatus().in_flight).toBe(0)
  start().finish({ outcome: 'ok' })
  await settle()
  await jest.advanceTimersByTimeAsync(5000)
  expect(collectorStatus().cooling_down).toBe(true)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(3)
  await jest.advanceTimersByTimeAsync(60_000)
  expect(collectorStatus().cooling_down).toBe(false)
  await jest.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
  expect(collectorStatus().enabled).toBe(true)
  jest.mocked(fetch).mockResolvedValue({ status: 201 } as Response)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(4)
})

test.each([401, 403])('credential rejection %i does not require manual reactivation', async (status) => {

  jest.mocked(fetch).mockResolvedValue({ status } as Response)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(collectorStatus().enabled).toBe(true)
  jest.mocked(fetch).mockResolvedValue({ status: 201 } as Response)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('old observations cannot send after pagehide', async () => {

  const old = start()
  cancelCollectorRequests()
  old.finish({ outcome: 'ok' })
  const current = start()
  window.dispatchEvent(new Event('pagehide'))
  current.finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test.each(['http://private.invalid', 'https://collector.invalid/path', 'https://u:p@collector.invalid', 'https://collector.invalid/?token=secret'])('rejects unsafe deployment origin %s', (origin) => {
  process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN = origin
  expect(collectorStatus().enabled).toBe(false)
  start().finish({ outcome: 'ok' })
  expect(fetch).not.toHaveBeenCalled()
})

test('automatic collection uses a persistent browser ID, never storing credentials or self-reported identity', async () => {
  start().finish({ outcome: 'ok' })
  await settle()
  const first = body()
  start().finish({ outcome: 'ok' })
  await settle()
  expect(body().browser_id).toBe(first.browser_id)
  expect(body().browser_id_scope).toBe('persistent')
  expect(JSON.stringify(localStorage)).not.toContain(TOKEN)
  for (const key of ['user_id', 'email', 'source_ip', 'room', 'receipt']) {
    expect(body()).not.toHaveProperty(key)
    expect(collectorEventV5Schema.safeParse({ ...body(), [key]: 'spoofed' }).success).toBe(false)
  }
  localStorage.clear()
  start().finish({ outcome: 'ok' })
  await settle()
  expect(body().browser_id).not.toBe(first.browser_id)
})

test('storage restrictions fall back to a page-scoped random ID', async () => {
  const blocked = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  try {
    start().finish({ outcome: 'ok' })
    await settle()
    expect(body().browser_id_scope).toBe('page')
  } finally { blocked.mockRestore() }
})

test('missing or stalled Firebase credentials drop only telemetry and release capacity', async () => {
  mockGetToken.mockResolvedValue(null)
  start().finish({ outcome: 'ok' })
  await settle()
  expect(fetch).not.toHaveBeenCalled()
  mockGetToken.mockImplementation(() => new Promise(() => {}))
  start().finish({ outcome: 'ok' })
  await settle()
  await jest.advanceTimersByTimeAsync(5000)
  expect(collectorStatus().in_flight).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
})

test('navigation during asynchronous credential retrieval prevents transmission', async () => {
  let resolveToken!: (value: string) => void
  mockGetToken.mockImplementation(() => new Promise<string>(resolve => { resolveToken = resolve }))
  start().finish({ outcome: 'ok' })
  await settle()
  window.history.replaceState({}, '', '/?site=hmc')
  resolveToken(TOKEN)
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})
