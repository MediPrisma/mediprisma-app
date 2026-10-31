/**
 * The Beta switch used to be rendered only for a signed-in account, so a
 * visitor who never logs in had no way to reach the experimental tabs at all.
 * The owner's rule is now the opposite: open 設定 → 顯示與關於, flip the switch,
 * and 個人化照護指引 appears — no account anywhere in that path.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { DisplaySettings } from '@/features/settings/components/DisplaySettings'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import {
  GUEST_BETA_FEATURES_KEY,
  useBetaFeaturesStore,
} from '@/src/application/stores/beta-features.store'

let mockMedcloudLaunchRoute = false
let mockUser: { uid: string } | null = null

jest.mock('@/src/application/launch/medcloud-launch-route', () => ({
  isMedcloudLaunchRoute: () => mockMedcloudLaunchRoute,
}))

// Signed out, on the free tier's anonymous session — the state a first-time
// visitor is actually in.
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: mockUser, isAnonymous: !mockUser, anonymousUid: null, loading: false }),
}))

jest.mock('@/src/application/providers/theme.provider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}))

jest.mock('@/src/application/providers/font-size.provider', () => ({
  useFontSize: () => ({ fontSize: 'base', setFontSize: jest.fn() }),
}))

jest.mock('@/src/shared/hooks/use-app-version.hook', () => ({
  useAppVersion: () => '0.0.0-test',
}))

jest.mock('@/src/application/hooks/chat/use-fhir-context.hook', () => ({
  useFhirContext: () => ({ patientId: null, patientName: null, fhirServerUrl: null }),
  isLocalBundleFhirUrl: () => false,
}))

jest.mock('@/features/feedback/components/FeedbackDialog', () => ({
  FeedbackDialog: () => null,
}))

jest.mock('@/features/feature-request-pool', () => ({
  FeatureRequestPoolDialog: () => null,
}))

// Reads the open chart's physicians; covered by its own tests.
jest.mock('@/features/settings/components/ClinicianNameSetting', () => ({
  ClinicianNameSetting: () => null,
}))

function renderSettings() {
  return render(
    <LanguageProvider>
      <DisplaySettings />
    </LanguageProvider>,
  )
}

describe('DisplaySettings Beta switch', () => {
  beforeEach(() => {
    mockMedcloudLaunchRoute = false
    mockUser = null
    window.localStorage.clear()
    useBetaFeaturesStore.setState({ enabledByUser: {}, syncErrors: {} })
  })

  it('renders the switch for a signed-out visitor and stores their opt-in', () => {
    renderSettings()

    const toggle = screen.getByRole('switch', { name: '開啟 Beta 功能' })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).not.toBeDisabled()

    fireEvent.click(toggle)

    expect(useBetaFeaturesStore.getState().enabledByUser[GUEST_BETA_FEATURES_KEY]).toBe(true)
    expect(screen.getByRole('switch', { name: '開啟 Beta 功能' }))
      .toHaveAttribute('aria-checked', 'true')
  })

  it('hides the switch on the unattended Medcloud launch route', () => {
    mockMedcloudLaunchRoute = true

    renderSettings()

    expect(screen.queryByRole('switch', { name: '開啟 Beta 功能' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('pilot-packs-settings')).not.toBeInTheDocument()
  })

  it('explains account persistence and surfaces a sync failure for the active account', () => {
    mockUser = { uid: 'account-a' }
    useBetaFeaturesStore.getState().setSyncError('account-a', true)
    renderSettings()
    expect(screen.getByText(/登入後設定隨帳號保存/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('目前無法同步 Beta 設定至帳號')
  })
})
