import { captureFhirFirebaseAuth } from '@/features/clinical-decision-support/telemetry/fhir-firebase-auth'
import { fhirAccessToken, fhirOAuthEnabled } from '@/features/clinical-decision-support/telemetry/fhir-auth'

const mockGetIdToken = jest.fn()
const mockAuth: { currentUser: { uid: string; isAnonymous: boolean; getIdToken: typeof mockGetIdToken } | null; authStateReady: () => Promise<void> } = {
  currentUser: null, authStateReady: jest.fn(async () => {}),
}
jest.mock('@/src/shared/config/firebase.config', () => ({ auth: mockAuth }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'firebase'
  mockGetIdToken.mockReset().mockResolvedValue('synthetic-firebase-id-token')
  mockAuth.currentUser = { uid: 'owner-a', isAnonymous: false, getIdToken: mockGetIdToken }
})
afterEach(() => { delete process.env.NEXT_PUBLIC_CDSS_ADMISSION })

test.each(['intranet', 'intranet-pilot'].flatMap(admission =>
  [null, { uid: 'owner-a', isAnonymous: true, getIdToken: mockGetIdToken }].map(user => ({ admission, user }))))('$admission admission rejects guests without opening an OAuth popup', async ({ admission, user }) => {
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = admission
  mockAuth.currentUser = user
  const popup = jest.spyOn(window, 'open').mockImplementation(() => null)
  try {
    await expect(fhirAccessToken()).rejects.toThrow('cdss_auth_unavailable')
    expect(mockGetIdToken).not.toHaveBeenCalled()
    expect(fhirOAuthEnabled()).toBe(false)
    expect(popup).not.toHaveBeenCalled()
  } finally { popup.mockRestore() }
})

test('FHIR reuses the signed-in Firebase account without opening an OAuth login', async () => {
  const popup = jest.spyOn(window, 'open').mockImplementation(() => null)
  try {
    expect(await fhirAccessToken()).toBe('synthetic-firebase-id-token')
    expect(mockGetIdToken).toHaveBeenCalledTimes(1)
    expect(fhirOAuthEnabled()).toBe(false)
    expect(popup).not.toHaveBeenCalled()
  } finally { popup.mockRestore() }
})

test.each([null, { uid: 'owner-a', isAnonymous: true, getIdToken: mockGetIdToken }])('guest and anonymous Firebase sessions cannot authorize FHIR', async user => {
  mockAuth.currentUser = user
  await expect(fhirAccessToken()).rejects.toThrow('cdss_auth_unavailable')
  expect(mockGetIdToken).not.toHaveBeenCalled()
})

test('sign-out or account switch while obtaining a token cancels the captured session', async () => {
  let resolveToken: (value: string) => void = () => {}
  mockGetIdToken.mockImplementation(() => new Promise<string>(resolve => { resolveToken = resolve }))
  const session = await captureFhirFirebaseAuth()
  const token = session!.getToken()
  mockAuth.currentUser = { uid: 'owner-a', isAnonymous: false, getIdToken: jest.fn() }
  resolveToken('old-account-token')
  expect(await token).toBeNull()
})

test('Firebase token errors are fixed authorization failures without an anonymous fallback', async () => {
  mockGetIdToken.mockRejectedValue(new Error('sensitive-provider-details'))
  await expect(fhirAccessToken()).rejects.toThrow('cdss_auth_unavailable')
})


test('a UI account cannot be replaced during auth readiness or patient preparation', async () => {
  await expect(captureFhirFirebaseAuth('other-user')).resolves.toBeNull()
  const session = await captureFhirFirebaseAuth('owner-a')
  expect(session?.isCurrent()).toBe(true)
  mockAuth.currentUser = null
  expect(session?.isCurrent()).toBe(false)
  await expect(session!.getToken()).resolves.toBeNull()
})


test.each([undefined, 'unknown'])('missing or unknown admission cannot send a Firebase token', async admission => {
  if (admission === undefined) delete process.env.NEXT_PUBLIC_CDSS_ADMISSION
  else process.env.NEXT_PUBLIC_CDSS_ADMISSION = admission
  await expect(fhirAccessToken()).rejects.toThrow('cdss_auth_unavailable')
  expect(mockGetIdToken).not.toHaveBeenCalled()
})
