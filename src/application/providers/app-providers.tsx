import { ReactNode } from 'react'
import { ThemeProvider } from './theme.provider'
import { FontSizeProvider } from './font-size.provider'
import { LanguageProvider } from './language.provider'
import { AudienceProvider } from './audience.provider'
import { QueryProvider } from './query-provider'
import { AuthProvider } from '@/src/application/providers/auth.provider'
import { RightPanelProvider } from './right-panel.provider'
import { MedcloudLaunchProvider } from './medcloud-launch.provider'

interface AppProvidersProps {
  children: ReactNode
  /** Explicit launch context for isolated development fixtures. */
  launchHref?: string
}

/**
 * Unified App Providers - Clean Architecture
 *
 * Final architecture:
 * 1. QueryProvider: Server state (FHIR data via React Query)
 *    - Patient data: usePatientQuery()
 *    - Clinical data: useClinicalDataQuery()
 *
 * 2. ThemeProvider: UI infrastructure (low-frequency updates)
 *
 * 3. LanguageProvider: UI infrastructure (i18n, low-frequency updates)
 *
 * 4. AuthProvider: Authentication state (user, quota)
 *
 * 5. RightPanelProvider: Which right-panel tab is active. Promoted to
 *    app-level in v0.4.0 so the header overflow menu can navigate
 *    directly to Settings sub-tabs (previously scoped only to
 *    RightPanelLayout, which left the header out of range).
 *
 * State management strategy:
 * - High-frequency client state → Zustand (API keys, model, chat)
 * - Server state (FHIR) → React Query (patient, clinical data)
 * - UI infrastructure → Context (theme, language, auth, panel routing)
 *
 * Benefits:
 * - Automatic caching (5 min stale time)
 * - Background refetching
 * - Dependent queries
 * - No unnecessary re-renders
 * - Clean separation of concerns
 */
export function AppProviders({ children, launchHref }: AppProvidersProps) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <FontSizeProvider>
          <LanguageProvider>
            <AudienceProvider>
              <AuthProvider>
                <RightPanelProvider>
                  <MedcloudLaunchProvider launchHref={launchHref}>
                    {children}
                  </MedcloudLaunchProvider>
                </RightPanelProvider>
              </AuthProvider>
            </AudienceProvider>
          </LanguageProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryProvider>
  )
}
