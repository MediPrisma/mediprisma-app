/**
 * signInAsEmbeddingAccount (src/application/providers/auth.provider.tsx): the
 * framing 門診 AI 助理 signs MediPrisma in as its own account. Synthetic uids.
 */
import { act, useEffect } from 'react'
import { render } from '@testing-library/react'
import { AuthProvider, useAuth, type AuthContextType } from '@/src/application/providers/auth.provider'
import { QueryProvider } from '@/src/application/providers/query-provider'

const mockAuth: { currentUser: { uid: string; isAnonymous: boolean } | null } = { currentUser: null }
const mockSignInWithCustomToken = jest.fn()
const mockClearKeys = jest.fn()
const mockClearBundle = jest.fn()

jest.mock('@/src/shared/config/firebase.config', () => ({ get auth() { return mockAuth }, db: undefined }))
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(() => jest.fn()),
  getRedirectResult: jest.fn(async () => null),
  signInAnonymously: jest.fn(async () => undefined),
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
})
