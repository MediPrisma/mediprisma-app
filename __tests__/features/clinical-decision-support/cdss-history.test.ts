import { webcrypto } from 'node:crypto'
import { listCdssHistory, readCdssHistory } from '@/features/clinical-decision-support/telemetry/cdss-history'
import { cdssPatientIdentity } from '@/features/clinical-decision-support/telemetry/patient-identity'
import { captureCollectorAuth } from '@/src/application/telemetry/cdss-auth'
jest.mock('@/src/application/telemetry/cdss-auth', () => ({ captureCollectorAuth: jest.fn() }))
const mockGetFhirToken = jest.fn()
const mockIsCurrent = jest.fn(() => true)
jest.mock('@/features/clinical-decision-support/telemetry/fhir-firebase-auth', () => ({
  captureFhirFirebaseAuth: jest.fn(async () => ({ uid: 'owner-a', isCurrent: mockIsCurrent, getToken: mockGetFhirToken })),
}))

const patient = { id: 'synthetic-patient', resourceType: 'Patient' as const, name: [{ text: '測試病人' }],
  birthDate: '1970-01-01', identifier: [{ system: 'https://synthetic.invalid/national-id', value: 'A123XXXXXX' }] }
const saveId = '11111111-1111-4111-8111-111111111111'
const index = { saveId, documentId: '1', patientId: '2', receivedAt: '2026-10-03T00:00:00Z', packId: 'synthetic', versionId: '1' }
const response = (data: unknown) => ({ status: 200, body: new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close()
} }) }) as Response

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  // jsdom does not supply the newer browser AbortSignal static methods.
  if (!AbortSignal.timeout) Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal })
  if (!AbortSignal.any) Object.defineProperty(AbortSignal, 'any', { configurable: true, value: (signals: AbortSignal[]) => signals[0] })
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'intranet'
  window.history.replaceState({}, '', '/?site=vghtpe')
  jest.mocked(fetch).mockReset().mockResolvedValue(response({ records: [index], hasMore: false }))
  jest.mocked(captureCollectorAuth).mockClear()
  mockGetFhirToken.mockReset().mockResolvedValue('synthetic-firebase-id-token')
  mockIsCurrent.mockReset().mockReturnValue(true)
})
afterEach(() => { delete process.env.NEXT_PUBLIC_CDSS_ADMISSION })

test('intranet history requires the existing account token and keeps patient identifiers out of the URL', async () => {
  expect((await listCdssHistory(patient, new AbortController().signal)).records).toEqual([index])
  expect(captureCollectorAuth).not.toHaveBeenCalled()
  const [url, request] = jest.mocked(fetch).mock.calls[0]
  expect(url).toBe('http://127.0.0.1:8098/cdss/v1/history')
  expect(request).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
  expect(request?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-firebase-id-token' })
  expect(request?.body).not.toContain('測試病人')
})

test('Firebase history uses the existing account and refuses to send a request after sign-out', async () => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'firebase'
  await listCdssHistory(patient, new AbortController().signal)
  expect(jest.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-firebase-id-token' })
  expect(captureCollectorAuth).not.toHaveBeenCalled()
  jest.mocked(fetch).mockClear()
  mockGetFhirToken.mockResolvedValue(null)
  await expect(listCdssHistory(patient, new AbortController().signal)).rejects.toThrow('cdss_auth_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('unknown receipt shapes, mismatched patients and wrong save IDs are unavailable', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({ records: [index], hasMore: false, save: 'unexpected' }))
  await expect(listCdssHistory(patient, new AbortController().signal)).rejects.toThrow()
  const identity = await cdssPatientIdentity(patient)
  const save = { ...identity, schema_version: 2, save_id: saveId, saved_at: index.receivedAt, site: 'vghtpe',
    patient_session_id: saveId, pack_id: 'synthetic', app_version: '0.0.0', build_revision: 'unknown',
    profile: { facts: { synthetic: true } }, result: { packId: 'synthetic', packVersion: '1' },
    physician_inputs: {}, physician_decisions: {}, source_records: [], events: [] }
  const detail = { ...index, savedAt: index.receivedAt, save }
  jest.mocked(fetch).mockResolvedValueOnce(response(detail))
  expect((await readCdssHistory(patient, saveId, new AbortController().signal)).save).toEqual(save)
  jest.mocked(fetch).mockResolvedValueOnce(response({ ...detail, save: { ...save, patient_key_sha256: 'b'.repeat(64) } }))
  await expect(readCdssHistory(patient, saveId, new AbortController().signal)).rejects.toThrow('cdss_history_unavailable')
  jest.mocked(fetch).mockResolvedValueOnce(response({ ...detail, saveId: '22222222-2222-4222-8222-222222222222' }))
  await expect(readCdssHistory(patient, saveId, new AbortController().signal)).rejects.toThrow('cdss_history_unavailable')
  jest.mocked(fetch).mockResolvedValueOnce(response({ ...detail, savedAt: '2026-10-04T00:00:00Z' }))
  await expect(readCdssHistory(patient, saveId, new AbortController().signal)).rejects.toThrow('cdss_history_unavailable')
})

test('site changes and cancelled lookups never issue a request; oversized responses are rejected', async () => {
  window.history.replaceState({}, '', '/?site=other')
  await expect(listCdssHistory(patient, new AbortController().signal)).rejects.toThrow()
  window.history.replaceState({}, '', '/?site=vghtpe')
  const cancelled = new AbortController(); cancelled.abort()
  await expect(listCdssHistory(patient, cancelled.signal)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
  jest.mocked(fetch).mockResolvedValueOnce(response({ oversized: 'x'.repeat(5 * 1024 * 1024) }))
  await expect(listCdssHistory(patient, new AbortController().signal)).rejects.toThrow('cdss_history_unavailable')
})


test('account changes while receiving history suppress the old account result', async () => {
  jest.mocked(fetch).mockImplementation(async () => {
    mockIsCurrent.mockReturnValue(false)
    return response({ records: [index], hasMore: false })
  })
  await expect(listCdssHistory(patient, new AbortController().signal)).rejects.toThrow('cdss_site_changed')
})


test('de-identified source patients never request history list or detail', async () => {
  await expect(listCdssHistory({ ...patient, deidentified: true }, new AbortController().signal))
    .rejects.toThrow('cdss_patient_deidentified')
  await expect(readCdssHistory({ ...patient, deidentified: true }, saveId, new AbortController().signal))
    .rejects.toThrow('cdss_patient_deidentified')
  expect(fetch).not.toHaveBeenCalled()
})
