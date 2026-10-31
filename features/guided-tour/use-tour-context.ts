'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useAuth } from '@/src/application/providers/auth.provider'
import { useBetaFeatures } from '@/src/application/hooks/use-beta-features.hook'
import { getEnabledRightPanelFeatures } from '@/src/shared/config/right-panel-registry'
import type { TourContext } from './guided-tour.types'

const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Who is reading and what they can open. Tours follow the same gates as the
 * panels — audience, the Beta switch, screen width — so a tour never points
 * at a tab this reader does not have.
 */
export function useTourContext(): TourContext {
  const { audience } = useAudience()
  const { user } = useAuth()
  const { enabled: betaEnabled } = useBetaFeatures()
  const [desktop, setDesktop] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DESKTOP_QUERY)
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return useMemo(() => ({
    audience,
    betaEnabled,
    authenticated: Boolean(user),
    desktop,
    rightFeatures: new Set(getEnabledRightPanelFeatures(audience, { betaFeaturesEnabled: betaEnabled }).map((feature) => feature.id)),
  }), [audience, betaEnabled, desktop, user])
}
