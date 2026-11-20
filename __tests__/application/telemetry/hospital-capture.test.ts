import { reportHospitalCapture, summarizeHospitalCapture } from '@/src/infrastructure/telemetry/hospital-capture'
import { hospitalCaptureEventSchema } from '@/src/shared/contracts/collector-event'
import { mockCollectorPermission } from '../../helpers/collector-permissions'

const TOKEN = 'synthetic-token-'.repeat(4)
const mockGetToken = jest.fn()
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: mockGetToken })),
}))

const FAILURE = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-failure'
const HOSPITAL_VERSION = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/extension-version'
const MEDCLOUD_VERSION = 'https://cloud-wildcatch.invalid/fhir/CodeSystem/extension-version'
const supplement = { system: 'urn:wildcatch:source', code: 'vghtpe-outpatient-supplement' }
// Synthetic only; the identifiers below must never reach the event.
const patient = { resource: { resourceType: 'Patient', id: 'p1', identifier: [{ value: 'TEST-1' }], name: [{ text: '測試甲' }] } }
const oneClick = (tags: object[], resources = 3) => ({ resourceType: 'Bundle', meta: { source: 'ehr-fhir-bridge/extension-local', tag: tags },
  entry: [patient, ...Array.from({ length: resources }, (_, i) => ({ resource: { resourceType: 'Encounter', id: `e${i}` } }))] })
const relayed = (tags: object[], hospital = 2) => ({ resourceType: 'Bundle', meta: { tag: [{ system: MEDCLOUD_VERSION, code: '0.15.20' }, ...tags] },
  entry: [patient, { resource: { resourceType: 'Encounter', id: 'cloud' } },
    ...Array.from({ length: hospital }, (_, i) => ({ resource: { resourceType: 'Observation', id: `h${i}`, meta: { tag: [supplement] } } }))] })
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const sentBody = () => JSON.parse(jest.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
let permission: ReturnType<typeof mockCollectorPermission>

beforeEach(() => {
  permission = mockCollectorPermission()
  mockGetToken.mockReset().mockResolvedValue(TOKEN)
  jest.mocked(fetch).mockReset().mockResolvedValue({ status: 201 } as Response)
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  delete process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN
})
afterEach(() => permission.restore())

test('one-click 北榮 bundles report failures, version and resource count; complete ones report none', () => {
  expect(summarizeHospitalCapture(oneClick([
    { system: HOSPITAL_VERSION, code: '0.15.21' },
    { system: FAILURE, code: 'reports:timeout', display: '2' },
    { system: FAILURE, code: 'patient:http_error:500', display: '1' },
  ]))).toEqual({ path: 'one_click', outcome: 'partial', hospitalVersion: '0.15.21', medcloudVersion: undefined, hospitalResources: 3,
    failures: [{ category: 'reports', kind: 'timeout', count: 2 }, { category: 'patient', kind: 'http_error', status: 500, count: 1 }],
    resourceCounts: expect.objectContaining({ Encounter: 3, Observation: 0, other: 0 }),
    encounterCounts: { outpatient: 0, inpatient: 0, emergency: 0, other: 3 } })
  expect(summarizeHospitalCapture(oneClick([]))?.outcome).toBe('complete')
  expect(summarizeHospitalCapture(oneClick([], 0))?.outcome).toBe('empty')
  expect(summarizeHospitalCapture(oneClick([{ system: 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-completeness', code: 'partial' }]))?.outcome).toBe('partial')
})

test('only finished progressive stages report, with the outcome the stage implies', () => {
  for (const stage of ['cloud', 'hospital-visits', undefined]) expect(summarizeHospitalCapture(relayed([]), stage)).toBeNull()
  expect(summarizeHospitalCapture({ resourceType: 'Bundle', entry: [patient] })).toBeNull()
  expect(summarizeHospitalCapture(relayed([]), 'hospital')).toMatchObject({ path: 'medcloud_relay', outcome: 'complete', medcloudVersion: '0.15.20', hospitalResources: 2 })
  expect(summarizeHospitalCapture(relayed([{ system: FAILURE, code: 'reports:his_busy:503', display: '4' }]), 'hospital'))
    .toMatchObject({ outcome: 'partial', failures: [{ category: 'reports', kind: 'his_busy', status: 503, count: 4 }] })
  expect(summarizeHospitalCapture(relayed([]), 'hospital-reports-failed')?.outcome).toBe('partial')
  expect(summarizeHospitalCapture(relayed([], 0), 'hospital-empty')?.outcome).toBe('empty')
  expect(summarizeHospitalCapture(relayed([], 0), 'cloud-only')?.outcome).toBe('failed')
})

test('login_expired and network are kept apart; the older login_or_network still parses', () => {
  expect(summarizeHospitalCapture(oneClick([
    { system: FAILURE, code: 'reports:login_expired', display: '2' },
    { system: FAILURE, code: 'medications:network', display: '1' },
    { system: FAILURE, code: 'vitals:login_or_network', display: '1' },
  ]))?.failures).toEqual([
    { category: 'reports', kind: 'login_expired', count: 2 },
    { category: 'medications', kind: 'network', count: 1 },
    { category: 'vitals', kind: 'login_or_network', count: 1 },
  ])
})

test('malformed or identifying tags are dropped', () => {
  const summary = summarizeHospitalCapture(oneClick([
    { system: FAILURE, code: 'reports:timeout:504:TEST-1', display: '1' },
    { system: FAILURE, code: 'TEST-1:timeout', display: '1' },
    { system: FAILURE, code: 'reports:timeout', display: 'A123456789' },
    { system: FAILURE, code: 'reports:http_error:42', display: '1' },
    { system: HOSPITAL_VERSION, code: 'v1 TEST-1' },
  ]))
  expect(summary).toMatchObject({ failures: [], hospitalVersion: undefined, outcome: 'complete' })
})

test('sends one strict capture event to the capture endpoint without patient data', async () => {
  reportHospitalCapture(oneClick([{ system: HOSPITAL_VERSION, code: '0.15.21' }, { system: FAILURE, code: 'vitals:login_or_network', display: '3' }]))
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = jest.mocked(fetch).mock.calls[0]
  expect(url).toBe('http://127.0.0.1:8787/collector/v1/capture-events')
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' })
  expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  const body = sentBody()
  expect(hospitalCaptureEventSchema.safeParse(body).success).toBe(true)
  expect(body).toMatchObject({ path: 'one_click', outcome: 'partial', app_surface: 'app', hospital_extension_version: '0.15.21',
    hospital_resources: '1-10', failures: [{ category: 'vitals', kind: 'login_or_network', count: 3 }] })
  expect(JSON.stringify(body)).not.toMatch(/TEST-1|測試甲|"e0"/)
})

test('sends nothing off the 北榮 site, without network permission or sign-in, or for non-capture imports', async () => {
  window.history.replaceState({}, '', '/app/?site=hmc')
  reportHospitalCapture(oneClick([]))
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  reportHospitalCapture(relayed([]), 'cloud')
  reportHospitalCapture({ resourceType: 'Bundle', entry: [patient] })
  permission.status.state = 'prompt'
  reportHospitalCapture(oneClick([]))
  await settle()
  permission.status.state = 'granted'
  mockGetToken.mockResolvedValue(null)
  reportHospitalCapture(oneClick([]))
  await settle()
  expect(fetch).not.toHaveBeenCalled()
})

test('a rejected or failing request never throws into the import', async () => {
  jest.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
  expect(() => reportHospitalCapture(oneClick([]))).not.toThrow()
  await settle()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('a cloud-only end carries only a closed unavailable reason', async () => {
  reportHospitalCapture(relayed([], 0), 'cloud-only', 'HIS_LOGIN_REQUIRED')
  await settle()
  expect(sentBody()).toMatchObject({ outcome: 'failed', failures: [], unavailable_reason: 'HIS_LOGIN_REQUIRED' })
  expect(hospitalCaptureEventSchema.safeParse(sentBody()).success).toBe(true)
  for (const reason of [undefined, '北榮登入過期', 'HIS_PEER_NOT_CONFIGURED']) {
    reportHospitalCapture(relayed([], 0), 'cloud-only', reason)
    await settle()
    expect(sentBody()).not.toHaveProperty('unavailable_reason')
  }
  reportHospitalCapture(relayed([]), 'hospital', 'HIS_TIMEOUT')
  await settle()
  expect(sentBody()).toMatchObject({ outcome: 'complete' })
  expect(sentBody()).not.toHaveProperty('unavailable_reason')
})

test('a patient-selection cloud-only end is logged with its reason', async () => {
  reportHospitalCapture(relayed([], 0), 'cloud-only', 'HIS_PATIENT_SELECTION_REQUIRED')
  await settle()
  expect(sentBody()).toMatchObject({ outcome: 'failed', unavailable_reason: 'HIS_PATIENT_SELECTION_REQUIRED' })
  expect(hospitalCaptureEventSchema.safeParse(sentBody()).success).toBe(true)
})

test('D083/D084: chart number, capture time and counts reach the Collector; malformed tags are dropped', async () => {
  const CHART = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-chart-no'
  const DURATION = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-duration-ms'
  const bundle = oneClick([{ system: CHART, code: 'T000001' }, { system: DURATION, code: '36267' },
    { system: FAILURE, code: 'orders:order_unmatched', display: '101' }], 0)
  bundle.entry.push({ resource: { resourceType: 'Encounter', id: 'v1', class: { code: 'AMB' } } } as never,
    { resource: { resourceType: 'Encounter', id: 'v2', class: { code: 'EMER' } } } as never,
    { resource: { resourceType: 'Observation', id: 'o1' } } as never, { resource: { resourceType: 'Basic', id: 'b1' } } as never)
  reportHospitalCapture(bundle)
  await settle()
  const body = sentBody()
  expect(hospitalCaptureEventSchema.safeParse(body).success).toBe(true)
  expect(body).toMatchObject({ chart_no: 'T000001', duration_ms: 36267, outcome: 'partial',
    failures: [{ category: 'orders', kind: 'order_unmatched', count: 101 }],
    resource_counts: { Encounter: 2, Observation: 1, other: 1, Condition: 0 },
    encounter_counts: { outpatient: 1, emergency: 1, inpatient: 0, other: 0 } })
  expect(JSON.stringify(body)).not.toMatch(/測試甲|TEST-1/)
  for (const bad of [[{ system: CHART, code: 'T 1/2' }], [{ system: CHART, code: 'A1' }, { system: CHART, code: 'A2' }], [{ system: DURATION, code: '-1' }]]) {
    expect(summarizeHospitalCapture(oneClick(bad))).not.toHaveProperty('chartNo')
    expect(summarizeHospitalCapture(oneClick(bad))).not.toHaveProperty('durationMs')
  }
})

test('D091: the HIS request count the extension tagged reaches the Collector; a malformed or repeated tag is dropped', async () => {
  const REQUESTS = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-request-count'
  reportHospitalCapture(oneClick([{ system: REQUESTS, code: '512' }]))
  await settle()
  const body = sentBody()
  expect(hospitalCaptureEventSchema.safeParse(body).success).toBe(true)
  expect(body).toMatchObject({ request_count: 512 })
  for (const bad of [[{ system: REQUESTS, code: '-1' }], [{ system: REQUESTS, code: '1.5' }], [{ system: REQUESTS, code: '100000' }],
    [{ system: REQUESTS, code: '1' }, { system: REQUESTS, code: '2' }]])
    expect(summarizeHospitalCapture(oneClick(bad))).not.toHaveProperty('requestCount')
})

test('D093: how the capture used the stored record and how long each part took reach the Collector; anything malformed is dropped', async () => {
  const STORED = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-stored-record'
  const MEASURE = 'https://github.com/voho0000/EHR-FHIR-BRIDGE/CodeSystem/capture-measure'
  const measure = (code: string) => ({ system: MEASURE, code })
  reportHospitalCapture(oneClick([{ system: STORED, code: 'used' }, measure('prelude_ms:6200'), measure('record_read_ms:1800'), measure('record_wait_ms:0'),
    measure('capture_ms:3100'), measure('merge_ms:12'), measure('held_resources:812'), measure('newer_resources:23'), measure('since_days:1'), measure('something_new:5')]))
  await settle()
  const body = sentBody()
  expect(hospitalCaptureEventSchema.safeParse(body).success).toBe(true)
  expect(body).toMatchObject({ stored_record: { outcome: 'used', held_resources: 812, newer_resources: 23, since_days: 1 },
    stage_ms: { prelude: 6200, record_read: 1800, record_wait: 0, capture: 3100, merge: 12 } })
  // Times alone, with the setting off: no stored record is named.
  const timed = summarizeHospitalCapture(oneClick([measure('prelude_ms:4000'), measure('capture_ms:9000')]))
  expect(timed).toMatchObject({ stageMs: { prelude: 4000, capture: 9000 } })
  expect(timed).not.toHaveProperty('storedRecord')
  // An outcome the contract does not know, or said twice, is not sent; a size out of range leaves the outcome alone.
  for (const bad of [[{ system: STORED, code: 'maybe' }], [{ system: STORED, code: 'used' }, { system: STORED, code: 'none' }]])
    expect(summarizeHospitalCapture(oneClick(bad))).not.toHaveProperty('storedRecord')
  expect(summarizeHospitalCapture(oneClick([{ system: STORED, code: 'used' }, measure('since_days:401')]))).toMatchObject({ storedRecord: { outcome: 'used' } })
  for (const bad of [[measure('capture_ms:-1')], [measure('capture_ms:1.5')], [measure('capture_ms:3600001')], [measure('capture_ms:1'), measure('capture_ms:2')], [measure('Capture_ms:1')], [measure('T000001:1')]])
    expect(summarizeHospitalCapture(oneClick(bad))).not.toHaveProperty('stageMs')
})
