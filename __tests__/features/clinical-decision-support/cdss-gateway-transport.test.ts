import type { CdssPatientProfile, CdssResult } from '@voho0000/personalized-care'
import { createHash, webcrypto } from 'node:crypto'
import { cancelCdssGatewayRequests, cdssGatewayStatus, recordCdssEvent, saveCdssSnapshot } from '@/features/clinical-decision-support/telemetry/cdss-gateway'
import { cdssGatewaySaveSchema } from '@/src/shared/contracts/cdss-gateway-event'
import { cdssPatientIdentity } from '@/features/clinical-decision-support/telemetry/patient-identity'
import { parseStoredCdssSaveV2 } from '@/src/shared/contracts/cdss-stored-save-v2'

const mockGetToken = jest.fn()
const mockIsCurrent = jest.fn(() => true)
jest.mock('@/src/application/telemetry/cdss-auth', () => ({
  captureCollectorAuth: jest.fn(async () => ({ getToken: mockGetToken })),
}))
jest.mock('@/features/clinical-decision-support/telemetry/fhir-firebase-auth', () => ({
  captureFhirFirebaseAuth: jest.fn(async () => ({ uid: 'owner-a', isCurrent: mockIsCurrent, getToken: mockGetToken })),
}))

const input = {
  patient: {
    id: 'raw-patient-id', resourceType: 'Patient' as const,
    name: [{ text: '陳小華' }], birthDate: '1968-05-09',
    identifier: [{ system: 'https://example.org/national-id', value: 'A123XXXXXX' }],
  },
  packId: 'heart-failure-cdss',
  profile: { id: 'raw-patient-id', facts: { ldl: { zh: 'LDL', en: 'LDL', numericValue: 92,
    sources: [{ resourceType: 'Observation', resourceId: 'outside-lab', facility: '臺大醫院' }] },
    age: { zh: '68', en: '68', sources: [{ resourceType: 'Patient', resourceId: 'raw-patient-id' }] },
  } } as CdssPatientProfile,
  result: { packId: 'heart-failure-cdss', packVersion: '1', title: 'HF', summary: 'assessment', recommendations: [], notEvaluated: [], disclaimer: '' } as CdssResult,
  physicianInputs: { manualLvef: 52 },
  physicianDecisions: { module: { decision: 'reviewed', note: 'clinician text 陳小華 1968-05-09' } },
  sourceRecords: [{ resource_type: 'Observation', resource_id: 'outside-lab', source_institution: '臺大醫院', source_system: null }],
}

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  cancelCdssGatewayRequests()
  mockGetToken.mockReset().mockResolvedValue('synthetic-firebase-token')
  mockIsCurrent.mockReset().mockReturnValue(true)
  jest.mocked(fetch).mockReset().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init?.body as string)
    return { status: 201, json: async () => ({ status: 'stored', save_id: body.save_id }) } as Response
  })
  delete process.env.NEXT_PUBLIC_CDSS_API_ORIGIN
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'intranet'
  process.env.NEXT_PUBLIC_COLLECTOR_ORIGIN = 'https://collector.must-not-receive-clinical.invalid'
  window.history.replaceState({}, '', '/app/?site=vghtpe')
})

afterEach(() => { cancelCdssGatewayRequests(); delete process.env.NEXT_PUBLIC_CDSS_ADMISSION; delete process.env.NEXT_PUBLIC_CDSS_API_ORIGIN })

test('local synthetic pilot still requires an App account without inventing a clinician', async () => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'intranet-pilot'
  try {
    await saveCdssSnapshot(input)
    expect(mockGetToken).not.toHaveBeenCalled()
    const request = jest.mocked(fetch).mock.calls[0][1]!
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(request.body as string).actor_uid).toBeUndefined()
  } finally { delete process.env.NEXT_PUBLIC_CDSS_ADMISSION }
})

test('Firebase collaborator mode sends the existing account token only to the independent FHIR endpoint', async () => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'firebase'
  await saveCdssSnapshot(input)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, request] = jest.mocked(fetch).mock.calls[0]
  expect(url).toBe('http://127.0.0.1:8098/cdss/v1/saves')
  expect(request?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-firebase-token' })
  expect(JSON.parse(request!.body as string).actor_uid).toBeUndefined()
  jest.mocked(fetch).mockClear()
  mockGetToken.mockResolvedValue(null)
  await expect(saveCdssSnapshot(input)).rejects.toThrow('cdss_auth_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('records clicks locally and sends all used data only on explicit save', async () => {
  recordCdssEvent(input.patient.id, input.packId, { kind: 'assessment', changes: [{ field_id: 'hf-suspicion', value: 'suspected' }] })
  expect(fetch).not.toHaveBeenCalled()
  expect(cdssGatewayStatus().pending_events).toBe(1)
  await saveCdssSnapshot(input)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8098/cdss/v1/saves', expect.objectContaining({
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
  }))
  const request = jest.mocked(fetch).mock.calls[0][1]!
  expect(request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-firebase-token' })
  expect(mockGetToken).toHaveBeenCalledTimes(1)
  const body = JSON.parse(request.body as string)
  expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
  expect(body.profile.facts.ldl.numericValue).toBe(92)
  expect(body.source_records[0].source_institution).toBe('臺大醫院')
  expect(body.physician_inputs.manualLvef).toBe(52)
  expect(body.physician_decisions.module.note).toBe('clinician text [已遮蔽] [已遮蔽]')
  expect(body.events).toHaveLength(1)
  expect(body.patient_session_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(body.schema_version).toBe(2)
  expect(body.patient_identity).toEqual({
    name_masked: '陳○華', birth_year: '1968',
    identifier_masked: 'A123XXXXXX', identifier_system: 'https://example.org/national-id',
  })
  const tuple = JSON.stringify([1, 'vghtpe', '陳小華', '1968-05-09', 'https://example.org/national-id', 'A123XXXXXX'])
  expect(body.patient_key_sha256).toBe(createHash('sha256').update(tuple).digest('hex'))
  expect(body.profile.id).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain('raw-patient-id')
  expect(JSON.stringify(body)).not.toContain('陳小華')
  expect(JSON.stringify(body)).not.toContain('1968-05-09')
  expect(cdssGatewayStatus().pending_events).toBe(0)
})

test('failed or unconfirmed save keeps pending actions for retry', async () => {
  recordCdssEvent(input.patient.id, input.packId, { kind: 'interaction', action: 'page_reset' })
  jest.mocked(fetch).mockResolvedValueOnce({ status: 202, json: async () => ({ status: 'queued' }) } as Response)
  await expect(saveCdssSnapshot(input)).rejects.toThrow('cdss_gateway_rejected')
  expect(cdssGatewayStatus().pending_events).toBe(1)
  await saveCdssSnapshot(input)
  const firstId = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string).save_id
  const retryId = JSON.parse(jest.mocked(fetch).mock.calls[1][1]?.body as string).save_id
  expect(retryId).toBe(firstId)
  expect(cdssGatewayStatus().pending_events).toBe(0)
})

test('patient change cancels a save during identity preparation before any transport begins', async () => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: {
    digest: () => new Promise<ArrayBuffer>(() => {}),
  } })
  const request = saveCdssSnapshot(input)
  expect(cdssGatewayStatus().saving).toBe(true)
  cancelCdssGatewayRequests()
  await expect(request).rejects.toThrow('cdss_site_changed')
  expect(fetch).not.toHaveBeenCalled()
  expect(cdssGatewayStatus().saving).toBe(false)
})

test('events added during identity preparation remain pending after the click-time snapshot succeeds', async () => {
  const tuple = JSON.stringify([1, 'vghtpe', '陳小華', '1968-05-09', 'https://example.org/national-id', 'A123XXXXXX'])
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(tuple))
  let resolveDigest: (value: ArrayBuffer) => void = () => {}
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: {
    digest: () => new Promise<ArrayBuffer>(resolve => { resolveDigest = resolve }),
  } })
  recordCdssEvent(input.patient.id, input.packId, { kind: 'interaction', action: 'page_reset' })
  const request = saveCdssSnapshot(input)
  recordCdssEvent(input.patient.id, input.packId, { kind: 'interaction', action: 'layout_selected' })
  resolveDigest(digest)
  await request
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(body.events).toHaveLength(1)
  expect(body.events[0].action).toBe('page_reset')
  expect(cdssGatewayStatus().pending_events).toBe(1)
})

test.each(['/', '/app/?site=hmc', '/app/?site=VGHTPE', '/app/?site=vghtpe&site=vghtpe'])('refuses save on %s', async (url) => {
  window.history.replaceState({}, '', url)
  await expect(saveCdssSnapshot(input)).rejects.toThrow('cdss_site_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('rechecks site after preparation and refuses unsafe dedicated FHIR origin', async () => {
  let resolveDigest: (value: ArrayBuffer) => void = () => {}
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: {
    digest: () => new Promise<ArrayBuffer>(resolve => { resolveDigest = resolve }),
  } })
  const save = saveCdssSnapshot(input)
  window.history.replaceState({}, '', '/app/?site=hmc')
  resolveDigest(new ArrayBuffer(32))
  await expect(save).rejects.toThrow('cdss_site_changed')
  expect(fetch).not.toHaveBeenCalled()

  process.env.NEXT_PUBLIC_CDSS_API_ORIGIN = 'http://remote.example:8098'
  window.history.replaceState({}, '', '/app/?site=vghtpe')
  await expect(saveCdssSnapshot(input)).rejects.toThrow('cdss_endpoint_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('patient key stays stable when the imported FHIR Patient.id changes', async () => {
  await saveCdssSnapshot(input)
  await saveCdssSnapshot({ ...input, patient: { ...input.patient, id: 'new-import-id' } })
  const bodies = jest.mocked(fetch).mock.calls.map((call) => JSON.parse(call[1]?.body as string))
  expect(bodies[0].patient_key_sha256).toBe(bodies[1].patient_key_sha256)
  expect(bodies[0].patient_session_id).not.toBe(bodies[1].patient_session_id)
})

test('OAuth mode refuses a missing FHIR authorization without falling back to Firebase or the Gateway', async () => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'oauth2'
  await expect(saveCdssSnapshot(input)).rejects.toThrow('cdss_auth_unavailable')
  expect(mockGetToken).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('opaque numeric Patient IDs do not erase equal clinical values or other resource IDs', async () => {
  await saveCdssSnapshot({ ...input, patient: { ...input.patient, id: '92' },
    profile: { id: '92', facts: { ldl: { zh: '92', en: '92', numericValue: 92,
      sources: [{ resourceType: 'Observation', resourceId: '92' }] },
      age: { zh: '68', en: '68', sources: [{ resourceType: 'Patient', resourceId: '92' }] } } } as CdssPatientProfile })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(body.profile.facts.ldl.zh).toBe('92')
  expect(body.profile.facts.ldl.sources[0].resourceId).toBe('92')
  expect(body.profile.facts.age.sources[0].resourceId).toBe('[redacted]')
})

test('does not transmit when complete identity inputs are missing', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, birthDate: '1968' } }))
    .rejects.toThrow('cdss_identity_unavailable')
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, identifier: [] } }))
    .rejects.toThrow('cdss_identity_unavailable')
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient,
    identifier: [{ system: 'https://example.org/national-id', value: 'X123456789' }],
  } })).rejects.toThrow('cdss_identity_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test.each([
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id',
  ' https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id ',
  'https://Cloud-Wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id',
])('accepts the normalized source bridge namespace %s only for partially masked national IDs', async system => {
  const canonical = 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id'
  const patient = { ...input.patient, name: [{ text: '王小*' }],
    identifier: [{ system, value: 'B123***789' }] }
  await saveCdssSnapshot({ ...input, patient })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(body.patient_identity.identifier_system).toBe(canonical)
  expect(body.patient_identity.identifier_masked).toBe('B123***789')
  expect(() => parseStoredCdssSaveV2(body)).not.toThrow()
  expect(body.patient_key_sha256).toBe((await cdssPatientIdentity({ ...patient,
    identifier: [{ system: canonical, value: 'B123***789' }] })).patient_key_sha256)
  expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
})

test.each([
  ['source-medcloud-patient-id', 'B123456789'],
  ['source-medcloud-patient-id', 'B823***789'],
  ['source-medcloud-patient-id', '123***789'],
  ['unrecognized-system', 'B123***789'],
])('rejects unsupported bridge identifier %s / %s', async (namespace, value) => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient,
    identifier: [{ system: `https://cloud-wildcatch.invalid/fhir/IdentifierSystem/${namespace}`, value }] } }))
    .rejects.toThrow('cdss_identity_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test.each(['source-medcloud-patient-id', 'masked-medcloud-patient-id', 'masked-tw-national-id'])(
  'remasked bridge ID in %s requires turning off de-identification even without a source flag', async namespace => {
    await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient,
      birthDate: '1968', identifier: [{
        system: `https://cloud-wildcatch.invalid/fhir/IdentifierSystem/${namespace}`, value: 'B123XXXXXX',
      }] } })).rejects.toThrow('cdss_patient_deidentified')
    expect(fetch).not.toHaveBeenCalled()
  },
)

test('a masked bridge namespace never becomes a second storage identity', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, identifier: [{
    system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-medcloud-patient-id', value: 'B123***789',
  }] } })).rejects.toThrow('cdss_patient_deidentified')
  expect(fetch).not.toHaveBeenCalled()
})

test.each([
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id ',
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-ｔｗ-national-id',
  ' https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-medcloud-patient-id ',
  ' https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id ',
  'https://Cloud-Wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id',
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/MASKED-MEDCLOUD-PATIENT-ID',
  'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/masked-tw-national-id?unknown=1',
  'https://cloud-wildcatch.invalid:443/fhir/IdentifierSystem/masked-tw-national-id',
])(
  'namespace normalization does not bypass the remasking guard: %s', async system => {
    await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, identifier: [{
      system, value: 'B123XXXXXX',
    }] } })).rejects.toThrow('cdss_patient_deidentified')
    expect(fetch).not.toHaveBeenCalled()
  },
)

test('unknown bridge namespace cannot enter through the generic national-ID matcher', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, identifier: [{
    system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/national-id-unknown', value: 'B123***789',
  }] } })).rejects.toThrow('cdss_identity_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('bridge and national-ID candidates remain ambiguous and do not transmit', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, identifier: [
    ...input.patient.identifier,
    { system: 'https://cloud-wildcatch.invalid/fhir/IdentifierSystem/source-medcloud-patient-id', value: 'B123***789' },
  ] } })).rejects.toThrow('cdss_identity_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test.each([
  ['王小*', '王○*'], ['王小＊', '王○*'],
  ['王*明', '王○明'], ['*小明', '*○明'],
])('saves an unrecognized source name %s without sending its raw text', async (name, masked) => {
  const patient = { ...input.patient, name: [{ text: name }] }
  await saveCdssSnapshot({ ...input, patient,
    physicianDecisions: { module: { decision: 'reviewed', note: `source ${name}` } } })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
  expect(body.patient_identity.name_masked).toBe(masked)
  expect(body.physician_decisions.module.note).toBe('source [已遮蔽]')
  expect(JSON.stringify(body)).not.toContain(name)
  expect(body.patient_key_sha256).toBe((await cdssPatientIdentity(patient)).patient_key_sha256)
  const tuple = JSON.stringify([1, 'vghtpe', name.normalize('NFKC'), '1968-05-09', 'https://example.org/national-id', 'A123XXXXXX'])
  expect(body.patient_key_sha256).toBe(createHash('sha256').update(tuple).digest('hex'))
  expect(body.patient_key_sha256).not.toBe((await cdssPatientIdentity({ ...patient, name: [{ text: '王小明' }] })).patient_key_sha256)
  expect(body.patient_key_sha256).not.toBe((await cdssPatientIdentity({ ...patient, name: [{ text: '王小' }] })).patient_key_sha256)
})

test.each(['王\uE000', '王\uFFFD', '王?'])('preserves the existing identity hash for a source name %s without asterisks', async name => {
  const patient = { ...input.patient, name: [{ text: name }] }
  await saveCdssSnapshot({ ...input, patient })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
  expect(body.patient_identity.name_masked).toBe('王○')
  const tuple = JSON.stringify([1, 'vghtpe', name, '1968-05-09', 'https://example.org/national-id', 'A123XXXXXX'])
  expect(body.patient_key_sha256).toBe(createHash('sha256').update(tuple).digest('hex'))
})

test.each(['王小*', '王小＊'])('scrubs alternative source glyphs for %s from outbound free text', async name => {
  await saveCdssSnapshot({ ...input, patient: { ...input.patient, name: [{ text: name }] },
    physicianDecisions: { module: { decision: 'reviewed', note: '王小明 王小𠀋 王小? 王小□ 王小* 王小＊ LDL 92' } } })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(body.physician_decisions.module.note).toBe('[已遮蔽] [已遮蔽] [已遮蔽] [已遮蔽] [已遮蔽] [已遮蔽] LDL 92')
})

test('Latin source placeholders preserve structural keys and clinical words', async () => {
  recordCdssEvent(input.patient.id, 'lip', { kind: 'interaction', action: 'evidence_toggled', target: 'lip' })
  await saveCdssSnapshot({ ...input, packId: 'lip', patient: { ...input.patient, name: [{ text: 'Li*' }] },
    physicianDecisions: { module: { decision: 'reviewed', note: 'Lin clinical lipid' } } })
  const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
  expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
  expect(body.pack_id).toBe('lip')
  expect(body.events[0].pack_id).toBe('lip')
  expect(body.events[0].target).toBe('lip')
  expect(body.physician_decisions.module.note).toBe('[已遮蔽] clinical lipid')
})

test('name patterns preserve session UUIDs but scrub narrative keys at any depth', async () => {
  const uuid = '12345678-abed-4abc-8def-123456789abc'
  const random = jest.spyOn(crypto, 'randomUUID').mockReturnValue(uuid)
  try {
    await saveCdssSnapshot({ ...input, patient: { ...input.patient, name: [{ text: 'Abe*' }] },
      physicianInputs: { action: 'Abel', nested: { id: 'Abel', target: 'Abel' } } })
    const body = JSON.parse(jest.mocked(fetch).mock.calls[0][1]?.body as string)
    expect(body.patient_session_id).toBe(uuid)
    expect(body.physician_inputs).toEqual({ action: '[已遮蔽]', nested: { id: '[已遮蔽]', target: '[已遮蔽]' } })
    expect(cdssGatewaySaveSchema.safeParse(body).success).toBe(true)
  } finally { random.mockRestore() }
})

test.each(['***', '王**', '王○明'])('still rejects insufficient or explicitly masked name %s', async name => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, name: [{ text: name }] } }))
    .rejects.toThrow('cdss_identity_unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('an unrecognized character does not bypass an explicit de-identification flag', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient,
    name: [{ text: '王小*' }], deidentified: true } })).rejects.toThrow('cdss_patient_deidentified')
  expect(fetch).not.toHaveBeenCalled()
})


test('account switch during a save never confirms the old account response', async () => {
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    mockIsCurrent.mockReturnValue(false)
    return { status: 201, json: async () => ({ status: 'stored', save_id: JSON.parse(init!.body as string).save_id }) } as Response
  })
  await expect(saveCdssSnapshot({ ...input, ownerUid: 'owner-a' })).rejects.toThrow('cdss_site_changed')
})


test('de-identified source patients never transmit a CDSS save', async () => {
  await expect(saveCdssSnapshot({ ...input, patient: { ...input.patient, deidentified: true } }))
    .rejects.toThrow('cdss_patient_deidentified')
  expect(fetch).not.toHaveBeenCalled()
})
