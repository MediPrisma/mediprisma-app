import { render, screen } from '@testing-library/react'
import { HeaderAuthButton } from '@/features/auth/components/HeaderAuthButton'
import { useAuth } from '@/src/application/providers/auth.provider'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      auth: {
        restoringSession: '正在恢復登入',
        signIn: '登入',
        signedInAs: '登入身分',
      },
    },
  }),
}))

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: jest.fn(),
}))

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

describe('HeaderAuthButton', () => {
  const auth = (overrides: Partial<ReturnType<typeof useAuth>>) =>
    mockUseAuth.mockReturnValue({
      user: null,
      isAnonymous: false,
      anonymousUid: null,
      loading: true,
      signInWithGoogle: jest.fn(async () => undefined),
      signInWithEmail: jest.fn(async () => undefined),
      signUpWithEmail: jest.fn(async () => undefined),
      signInAsEmbeddingAccount: jest.fn(async () => undefined),
      lendSignIn: jest.fn(async () => null),
      signOut: jest.fn(),
      resetPassword: jest.fn(async () => undefined),
      dailyUsage: 0,
      dailyLimit: 0,
      perplexityUsage: 0,
      whisperUsage: 0,
      perplexityLimit: 0,
      whisperLimit: 0,
      ...overrides,
    })

  it('shows a neutral restoring state instead of guest or sign-in actions', () => {
    auth({})

    render(<HeaderAuthButton />)

    // The menu (import, language …) stays reachable while the session restores.
    const status = screen.getByRole('button', { name: '正在恢復登入' })
    expect(status).toBeEnabled()
    expect(screen.queryByText('訪客')).not.toBeInTheDocument()
    expect(screen.queryByText('登入')).not.toBeInTheDocument()
  })

  it('shows only an icon signed out and signed in: 登入 is an entry of the menu it opens', () => {
    auth({ loading: false })
    const { unmount } = render(<HeaderAuthButton />)
    expect(screen.getByRole('button', { name: '登入' })).toHaveTextContent('')
    unmount()

    auth({ loading: false, user: { displayName: '測試醫師', email: 'doctor@synthetic.invalid' } as never })
    render(<HeaderAuthButton />)
    expect(screen.getByRole('button', { name: '測試醫師' })).toHaveTextContent('')
  })
})
