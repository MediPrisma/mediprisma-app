import { fireEvent, render, screen } from '@testing-library/react'
import { OutpatientPrefsStorageNote } from '@/features/auth/components/OutpatientPrefsStorageNote'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'

let mockUser: { uid: string } | null = null
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: mockUser, anonymousUid: null }),
}))
jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({ locale: 'zh-TW', t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW }),
}))
jest.mock('@/features/auth/components/AuthDialog', () => ({
  AuthDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="登入對話框" /> : null),
}))

beforeEach(() => {
  mockUser = null
  useOutpatientPrefsStore.setState({ byUser: {}, syncMeta: {}, syncStatus: {} })
})

it('tells a visitor who is not signed in that the settings stay on this computer, with a way to sign in', () => {
  render(<OutpatientPrefsStorageNote />)
  expect(screen.getByText('目前存在這台電腦；若要跨裝置保存，需要登入。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '登入' }))
  expect(screen.getByRole('dialog', { name: '登入對話框' })).toBeInTheDocument()
})

it('tells a signed-in clinician the settings follow the account', () => {
  mockUser = { uid: 'a' }
  render(<OutpatientPrefsStorageNote />)
  expect(screen.getByText('已存到帳號，登入同一帳號的其他裝置也會看到。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '登入' })).toBeNull()
})

it('says so when the account cannot be reached', () => {
  mockUser = { uid: 'a' }
  useOutpatientPrefsStore.setState({ syncStatus: { a: 'error' } })
  render(<OutpatientPrefsStorageNote />)
  expect(screen.getByRole('status')).toHaveTextContent('目前無法同步到帳號，先存在這台電腦；連線恢復後會自動補上。')
})
