/**
 * signInAsEmbeddingAccount (src/application/providers/auth.provider.tsx): the
 * framing 門診 AI 助理 signs MediPrisma in as its own account. Synthetic uids.
 */
import { act, useEffect } from 'react'
import { render } from '@testing-library/react'
import { AuthProvider, useAuth, type AuthContextType } from '@/src/application/providers/auth.provider'
import { QueryProvider } from '@/src/application/providers/query-provider'

const mockAuth: { currentUser: { uid: string; isAnonymous: boolean } | null; authStateReady: () => Promise<void> } = {
  currentUser: null,
  authStateReady: () => mockReady(),
}
const mockReady = jest.fn()
let mockAuthListener: ((user: unknown) => Promise<void>) | undefined
const mockSignInAnonymously = jest.fn()
const mockSignInWithCustomToken = jest.fn()
const mockClearKeys = jest.fn()
const mockClearBundle = jest.fn()

jest.mock('@/src/shared/config/firebase.config', () => ({ get auth() { return mockAuth }, db: undefined }))
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((_auth, listener) => { mockAuthListener = listener; return jest.fn() }),
  getRedirectResult: jest.fn(async () => null),
  signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
  signInWithCustomToken: (...args: unknown[]) => mockSignInWithCustomToken(...args),
  signOut: jest.fn(async () => undefined),
}))
jest.mock('@/src/application/telemetry/usage-analytics', () => ({ setUserProps: jest.fn(), trackEvent: jest.fn() }))
jest.mock('@/src/shared/hooks/use-app-version.hook', () => ({ useAppVersion: () => null }))
jest.mock('@/src/application/services/beta-features-sync', () => ({ syncBetaFeaturesForAccount: jest.fn() }))
jest.mock('@/src/application/services/outpatient-prefs-sync', () => ({ syncOutpatientPrefsForAccount: jest.fn() }))
jest.mock('@/src/application/stores/ai-config.store', () => ({ useAiConfigStore: { getState: () => ({ clearAllKeys: mockClearKeys }) } }))
jest.mock('@/src/shared/utils/crypto.utils', () => ({ clearSessionKey: jest.fn() }))
jest.mock('@/src/infrastructure/fhir/services/local-bundle.service', () => ({
  LocalBundleService: { getActiveImportId: () => 'import-1', clear: () => mockClearBundle() },
}))
jest.mock('@/src/infrastructure/fhir/services/local-bundle-mutation-queue', () => ({
  serializeLocalBundleMutation: (task: () => Promise<void>) => task(),
}))
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({ clearSmartSession: jest.fn() }))
jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ purgeAiResultCaches: jest.fn() }))
jest.mock('@/src/shared/utils/reset-on-bundle-change', () => ({ notifyBundleChanged: jest.fn() }))

let context: AuthContextType
const keep = (value: AuthContextType) => { context = value }
function Capture({ onAuth }: { onAuth: (value: AuthContextType) => void }) {
  const value = useAuth()
  useEffect(() => onAuth(value))
  return null
}

describe('signInAsEmbeddingAccount', () => {
  beforeEach(() => {
    mockSignInWithCustomToken.mockReset().mockResolvedValue({ user: { uid: 'uid-a' } })
    mockSignInAnonymously.mockReset().mockResolvedValue(undefined)
    mockReady.mockReset().mockResolvedValue(undefined)
    mockClearKeys.mockReset()
    mockClearBundle.mockReset().mockResolvedValue(undefined)
    render(<QueryProvider><AuthProvider><Capture onAuth={keep} /></AuthProvider></QueryProvider>)
  })

  it('does nothing when that account is already signed in', async () => {
    mockAuth.currentUser = { uid: 'uid-a', isAnonymous: false }
    await act(async () => { await context.signInAsEmbeddingAccount('uid-a', 'token-a') })
    expect(mockSignInWithCustomToken).not.toHaveBeenCalled()
    expect(mockClearBundle).not.toHaveBeenCalled()
  })

  it("clears another account's keys and patient before signing the assistant's account in", async () => {
    mockAuth.currentUser = { uid: 'uid-b', isAnonymous: false }
    await act(async () => { await context.signInAsEmbeddingAccount('uid-a', 'token-a') })
    expect(mockClearKeys).toHaveBeenCalled()
    expect(mockClearBundle).toHaveBeenCalled()
    expect(mockSignInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'token-a')
    expect(mockClearBundle.mock.invocationCallOrder[0]).toBeLessThan(mockSignInWithCustomToken.mock.invocationCallOrder[0])
  })

  it('signs a guest straight in, leaving what the guest had open', async () => {
    mockAuth.currentUser = { uid: 'anon-1', isAnonymous: true }
    await act(async () => { await context.signInAsEmbeddingAccount('uid-a', 'token-a') })
    expect(mockClearBundle).not.toHaveBeenCalled()
    expect(mockSignInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'token-a')
  })

  it('waits for a guest session already being minted, so it cannot land after the sign-in', async () => {
    mockAuth.currentUser = null
    let landGuest!: () => void
    mockSignInAnonymously.mockReturnValue(new Promise<void>((resolve) => { landGuest = () => { mockAuth.currentUser = { uid: 'anon-2', isAnonymous: true }; resolve() } }))
    await act(async () => { await mockAuthListener!(null) })
    let done = false
    const signing = context.signInAsEmbeddingAccount('uid-a', 'token-a').then(() => { done = true })
    await act(async () => { await Promise.resolve() })
    expect(mockSignInWithCustomToken).not.toHaveBeenCalled()
    await act(async () => { landGuest(); await signing })
    expect(done).toBe(true)
    expect(mockSignInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'token-a')
  })

  it('mints no guest while signing in, and clears an account restored only after it was asked', async () => {
    mockAuth.currentUser = null
    let restore!: () => void
    mockReady.mockReturnValue(new Promise<void>((resolve) => { restore = () => { mockAuth.currentUser = { uid: 'uid-b', isAnonymous: false }; resolve() } }))
    const signing = context.signInAsEmbeddingAccount('uid-a', 'token-a')
    await act(async () => { await mockAuthListener!(null) })
    expect(mockSignInAnonymously).not.toHaveBeenCalled()
    await act(async () => { restore(); await signing })
    expect(mockClearBundle).toHaveBeenCalled()
    expect(mockSignInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'token-a')
  })
})
