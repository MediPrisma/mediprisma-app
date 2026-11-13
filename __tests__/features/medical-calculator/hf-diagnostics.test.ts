/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { buildMedcloudHfInput } from '@/src/core/hf-risk/medcloud-input'
import { requestHfPrediction } from '@/src/infrastructure/hf-risk/dry-run-client'
import { buildHfProblemReport } from '@/src/application/telemetry/hf-report'
import { aiReportSchema } from '@/src/shared/contracts/collector-event'
import type { HfDiagnosticRecord } from '@/src/core/hf-risk/diagnostics'
import { hfMedcloudFixture } from './hf-medcloud-fixture'

const input = () => buildMedcloudHfInput(hfMedcloudFixture(), { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' }, { today: '2026-10-04', uuid: randomUUID })
const options = (records: HfDiagnosticRecord[], fetch: typeof globalThis.fetch) => ({ origin: 'https://hf.test', authPolicy: 'intranet' as const, signal: new AbortController().signal, onDiagnostic: (r: HfDiagnosticRecord) => records.push(r), fetch })

it.each([[400, 'gateway-input-rejected'], [404, 'gateway-not-found'], [413, 'gateway-payload-too-large'], [415, 'gateway-content-type'], [429, 'gateway-rate-limited'], [503, 'gateway-unavailable'], [504, 'gateway-upstream-timeout']])('identifies HTTP %s without retaining an arbitrary response', async (status, code) => {
  const records: HfDiagnosticRecord[] = []
  await expect(requestHfPrediction(input(), options(records, async () => new Response('PRIVATE-RESPONSE Bearer SECRET', { status: status as number })))).rejects.toThrow(code as string)
  expect(records[0].diagnostic).toMatchObject({ httpStatus: status, errorCode: code, stage: 'response', operation: 'predict' })
  expect(records[0].diagnostic.responseIdMatched).toBeNull()
  expect(JSON.stringify(records)).not.toMatch(/PRIVATE-RESPONSE|SECRET|FAKE-ID|synthetic-patient/)
})

it('distinguishes a browser network failure from a response JSON error', async () => {
  for (const [fetch, code, stage] of [
    [async () => { throw new TypeError('PRIVATE-ERROR https://user:secret@server') }, 'gateway-network', 'connect'],
    [async () => new Response('<html>PRIVATE-RESPONSE</html>', { status: 200 }), 'invalid-json-response', 'parse'],
  ] as const) {
    const records: HfDiagnosticRecord[] = []
    await expect(requestHfPrediction(input(), options(records, fetch))).rejects.toThrow(code)
    expect(records[0].diagnostic).toMatchObject({ errorCode: code, stage })
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE-ERROR|PRIVATE-RESPONSE|user:secret/)
  }
})

it('identifies its own deadline separately from cancellation', async () => {
  jest.useFakeTimers()
  try {
    const records: HfDiagnosticRecord[] = []
    const request = requestHfPrediction(input(), options(records, async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const result = expect(request).rejects.toThrow('request-timeout')
    await jest.advanceTimersByTimeAsync(15000)
    await result
    expect(records[0].diagnostic).toMatchObject({ errorCode: 'request-timeout', httpStatus: null, elapsedMs: 15000 })
  } finally { jest.useRealTimers() }
})

it('distinguishes an empty stream from malformed JSON', async () => {
  const records: HfDiagnosticRecord[] = []
  await expect(requestHfPrediction(input(), options(records, async () => new Response('')))).rejects.toThrow('response-empty')
  expect(records[0].diagnostic).toMatchObject({ stage: 'response', responseBytes: 0, errorCode: 'response-empty' })
})

it('does not blame input data for an unexpected preparation error', async () => {
  const original = globalThis.Blob
  const records: HfDiagnosticRecord[] = []
  const fetch = jest.fn()
  try {
    globalThis.Blob = class { constructor() { throw new Error('PRIVATE-INTERNAL-DETAIL') } } as unknown as typeof Blob
    await expect(requestHfPrediction(input(), options(records, fetch))).rejects.toThrow('internal-error')
    expect(records[0].diagnostic.errorCode).toBe('internal-error')
    expect(JSON.stringify(records)).not.toContain('PRIVATE-INTERNAL-DETAIL')
    expect(fetch).not.toHaveBeenCalled()
  } finally { globalThis.Blob = original }
})

it.each(['', '<html>Bad gateway</html>', '{not json'])('classifies a non-contract 502 as upstream unavailability: %s', async body => {
  const records: HfDiagnosticRecord[] = []
  await expect(requestHfPrediction(input(), options(records, async () => new Response(body, { status: 502 })))).rejects.toThrow('gateway-unavailable')
  expect(records[0].diagnostic).toMatchObject({ stage: 'response', httpStatus: 502, errorCode: 'gateway-unavailable' })
})

it('uses a frozen validated projection and receiver-compatible envelope for diagnosis', async () => {
  const records: HfDiagnosticRecord[] = []
  const prepared = input()
  const bundle = JSON.stringify(prepared.bundle)
  for (const claim of ['P1_CD_mortality_1m', 'P1_CD_mortality_3m'] as const) {
    await expect(requestHfPrediction({ ...prepared, claim }, options(records, async () => new Response('{}', { status: 400 })))).rejects.toThrow('gateway-input-rejected')
  }
  prepared.bundle.entry[0].resource.birthDate = '1901-01-01'
  const json = buildHfProblemReport(randomUUID(), records, 'medcloud', '0.51.0')
  const report = aiReportSchema.parse(JSON.parse(json))
  const first = JSON.parse(report.executions[0].prompt)
  const second = JSON.parse(report.executions[1].prompt)
  expect(JSON.stringify(first.input)).toBe(bundle)
  expect(second.input).toBeUndefined()
  expect(second.inputReference).toBe(records[0].diagnostic.requestId)
  expect(JSON.parse(report.executions[0].output)).toMatchObject({ kind: 'hf-samd', httpStatus: 400, errorCode: 'gateway-input-rejected' })
  expect(json).not.toMatch(/FAKE-ID|synthetic-patient|Authorization|Bearer/)
})

it('withholds invalid projections and unexpected fields from the report', async () => {
  const records: HfDiagnosticRecord[] = []
  await expect(requestHfPrediction(input(), options(records, async () => new Response('{}', { status: 400 })))).rejects.toThrow()
  const parsed = JSON.parse(records[0].inputJson!)
  parsed.entry[0].resource.identifier = [{ value: 'PRIVATE-ID' }]
  records[0].inputJson = JSON.stringify(parsed)
  Object.assign(records[0].diagnostic, { rawError: 'Bearer SECRET', token: 'SECRET' })
  const report = JSON.parse(buildHfProblemReport(randomUUID(), records, 'medcloud', null))
  expect(JSON.parse(report.executions[0].prompt)).toMatchObject({ inputOmission: expect.any(String) })
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE-ID|rawError|token|SECRET/)
})

it.each([
  ['request-timeout', 'connect', null, 'timeout'],
  ['gateway-network', 'connect', null, 'network'],
  ['invalid-json-response', 'parse', null, 'parse_failed'],
  ['gateway-unauthorized', 'response', null, 'authentication'],
  ['gateway-rate-limited', 'response', null, 'rate_limited'],
  ['gateway-unavailable', 'response', null, 'upstream'],
  ['request-aborted', 'connect', null, 'aborted'],
  [null, 'parse', 'refused', 'validation_failed'],
  [null, 'parse', 'scored', null],
] as const)('reports %s / %s / %s through the actual receiver schema', async (errorCode, stage, verdict, outcome) => {
  const records: HfDiagnosticRecord[] = []
  await expect(requestHfPrediction(input(), options(records, async () => new Response('{}', { status: 400 })))).rejects.toThrow()
  Object.assign(records[0].diagnostic, { errorCode, stage, verdict })
  const report = aiReportSchema.parse(JSON.parse(buildHfProblemReport(randomUUID(), records, 'medcloud', '0.51.0')))
  expect(report.executions[0].outcome).toBe(outcome)
  if (errorCode === 'request-aborted') expect(report.executions[0].status).toBe('aborted')
})
