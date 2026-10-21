import {
  medcloudExtensionVersion,
  RAW_CAPTURE_REQUEST,
  RAW_CAPTURE_RESULT,
  rawCaptureOrigin,
  requestRawCapture,
  supportsRawCapture,
} from '@/features/lab-data-report/utils/raw-capture-client'

// jsdom serves the page from http://localhost, which the client treats as a
// development origin (a stand-in responder answers there, not the extension).
const ORIGIN = window.location.origin
const BUNDLE = 'bundle-1.a'

function reply(data: Record<string, unknown>, init: Partial<MessageEventInit> = {}) {
  window.dispatchEvent(new MessageEvent('message', { data, origin: ORIGIN, source: window, ...init }))
}

/** Stands in for the extension: takes the next request the page posts
 *  (intercepting window.postMessage — the test registers no message
 *  handler of its own) and answers it the way the extension's bridge does. */
function answerNext(build: (request: { requestId: string; bundleId: string }) => Record<string, unknown> | null) {
  jest.spyOn(window, 'postMessage').mockImplementationOnce((message: any) => {
    if (message?.type !== RAW_CAPTURE_REQUEST) return
    const answer = build(message)
    if (answer) setTimeout(() => reply(answer), 0)
  })
}

const success = (request: { requestId: string; bundleId: string }, json = '{"endpoints":{}}', metadata: Record<string, unknown> = {}) => ({
  source: 'medcloud2-extension',
  type: RAW_CAPTURE_RESULT,
  version: 1,
  requestId: request.requestId,
  ok: true,
  json,
  metadata: {
    bundleId: request.bundleId,
    runId: 'run',
    filename: 'raw.json',
    expiresAt: Date.now() + 60_000,
    producerVersion: '0.12.19',
    byteLength: json.length,
    totalCharacters: json.length,
    ...metadata,
  },
})

describe('rawCaptureOrigin', () => {
  it('serves mediprisma.tw /app and /app-hmc only', () => {
    expect(rawCaptureOrigin({ origin: 'https://mediprisma.tw', pathname: '/app/' })).toBe('https://mediprisma.tw')
    expect(rawCaptureOrigin({ origin: 'https://mediprisma.tw', pathname: '/app-hmc' })).toBe('https://mediprisma.tw')
    expect(rawCaptureOrigin({ origin: 'https://mediprisma.tw', pathname: '/research' })).toBeNull()
    expect(rawCaptureOrigin({ origin: 'https://voho0000.github.io', pathname: '/medical-note-smart-on-fhir/' })).toBeNull()
  })

  it('lets local development answer itself', () => {
    expect(rawCaptureOrigin({ origin: 'http://localhost:3013', pathname: '/' })).toBe('http://localhost:3013')
  })
})

describe('requestRawCapture', () => {
  afterEach(() => jest.restoreAllMocks())

  it('returns the capture for a matching reply', async () => {
    let posted: any
    answerNext((request) => {
      posted = request
      return success(request)
    })
    const result = await requestRawCapture(BUNDLE)
    expect(result).toEqual({ ok: true, json: '{"endpoints":{}}', metadata: expect.objectContaining({ bundleId: BUNDLE }) })
    expect(posted).toEqual({ source: 'mediprisma', type: RAW_CAPTURE_REQUEST, version: 1, requestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/), bundleId: BUNDLE })
  })

  it('passes the extension error code through', async () => {
    answerNext((request) => ({ source: 'medcloud2-extension', type: RAW_CAPTURE_RESULT, version: 1, requestId: request.requestId, ok: false, code: 'EXPIRED' }))
    await expect(requestRawCapture(BUNDLE)).resolves.toEqual({ ok: false, code: 'EXPIRED' })
  })

  it.each([
    ['another bundle', { bundleId: 'other' }],
    ['an expired capture', { expiresAt: Date.now() - 1 }],
    ['a length mismatch', { totalCharacters: 3 }],
  ])('refuses %s', async (_label, metadata) => {
    answerNext((request) => success(request, '{"endpoints":{}}', metadata))
    await expect(requestRawCapture(BUNDLE)).resolves.toEqual({ ok: false, code: 'READ_FAILED' })
  })

  it('ignores replies from another window, origin, source or request', async () => {
    answerNext((request) => {
      const good = success(request)
      setTimeout(() => {
        reply({ ...good, requestId: 'someone-else-123' })
        reply({ ...good, source: 'other' })
        reply(good, { origin: 'https://evil.example' })
        reply(good, { source: null })
        reply(good)
      }, 0)
      return null
    })
    const result = await requestRawCapture(BUNDLE)
    expect(result.ok).toBe(true)
  })

  it('gives up when nothing answers, and when aborted', async () => {
    await expect(requestRawCapture(BUNDLE, { timeoutMs: 20 })).resolves.toEqual({ ok: false, code: 'EXTENSION_UNAVAILABLE' })
    const controller = new AbortController()
    const pending = requestRawCapture(BUNDLE, { signal: controller.signal, timeoutMs: 5_000 })
    controller.abort()
    await expect(pending).resolves.toEqual({ ok: false, code: 'ABORTED' })
  })

  it('does not ask with an invalid bundle id', async () => {
    await expect(requestRawCapture('bad id!')).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' })
  })
})

describe('extension version gate', () => {
  const tagged = (code: string) => ({ meta: { tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/adapter-version', code }] } })

  it.each([
    ['0.12.19', true],
    ['0.12.20', true],
    ['0.13.0', true],
    ['1.0', true],
    ['0.12.18', false],
    ['0.12.13', false],
    ['0.9.99', false],
    ['test', false],
    [undefined, false],
  ])('%s supports the raw capture: %s', (version, expected) => {
    expect(supportsRawCapture(version)).toBe(expected)
  })

  it('reads the highest adapter version the bridge stamped', () => {
    expect(medcloudExtensionVersion([tagged('0.12.13'), tagged('0.12.19'), tagged('0.12.2'), {}])).toBe('0.12.19')
    expect(medcloudExtensionVersion([{ meta: { tag: [{ system: 'other', code: '9.9.9' }] } }])).toBeUndefined()
  })
})
