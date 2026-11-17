import { render, screen } from '@testing-library/react'
import { HeaderAuthButton } from '@/features/auth/components/HeaderAuthButton'
import { useAuth } from '@/src/application/providers/auth.provider'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      auth: {
        restoringSession: '正在恢復登入',
      },
    },
  }),
}))

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: jest.fn(),
}))

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

describe('HeaderAuthButton', () => {
  it('shows a neutral restoring state instead of guest or sign-in actions', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAnonymous: false,
      anonymousUid: null,
      loading: true,
      signInWithGoogle: jest.fn(async () => undefined),
      signInWithEmail: jest.fn(async () => undefined),
      signUpWithEmail: jest.fn(async () => undefined),
      signInAsEmbeddingAccount: jest.fn(async () => undefined),
      signOut: jest.fn(),
      resetPassword: jest.fn(async () => undefined),
      dailyUsage: 0,
      dailyLimit: 0,
      perplexityUsage: 0,
      whisperUsage: 0,
      perplexityLimit: 0,
      whisperLimit: 0,
    })

    render(<HeaderAuthButton />)

    const status = screen.getByRole('button', { name: '正在恢復登入' })
    expect(status).toBeDisabled()
    expect(screen.queryByText('訪客')).not.toBeInTheDocument()
  })
})
