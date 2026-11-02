// Refactored VitalsCard Component
//
// A single-row card: these readings mostly come from health checks, often
// years old, so they are context rather than the tab's main content.
"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { useAuth } from "@/src/application/providers/auth.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useVitals } from './hooks/useVitals'
import { useVitalsView } from './hooks/useVitalsView'
import { VitalsGrid } from './components/VitalsGrid'
import { homeMeasurementLink } from './utils/home-measurement-link'
import { isHomeMeasurementPilotUser } from './utils/home-measurement-access'

// The check is async (hashing); the answer counts only for the account it was made for.
function useHomeMeasurementPilot(): boolean {
  const { user } = useAuth()
  const [checked, setChecked] = useState<{ user: typeof user; allowed: boolean } | null>(null)
  useEffect(() => {
    let current = true
    void isHomeMeasurementPilotUser(user).then((allowed) => { if (current) setChecked({ user, allowed }) }, () => {})
    return () => { current = false }
  }, [user])
  return checked?.user === user && checked.allowed
}

export function VitalsCard() {
  const { t } = useLanguage()
  const { vitalSigns, isLoading, error } = useVitals()
  const vitals = useVitalsView(vitalSigns)
  const { patient } = usePatient()
  const pilot = useHomeMeasurementPilot()
  const homeLink = pilot ? homeMeasurementLink(patient, typeof window === 'undefined' ? '' : window.location.href) : null

  return (
    <FeatureCard
      title={t.vitals.title}
      featureId="vitals"
      isLoading={isLoading}
      error={error}
      isEmpty={false}
      inline
      headerAction={homeLink ? (
        <Button asChild variant="outline" size="sm" title={t.vitals.homeMeasurementHint}>
          <a href={homeLink} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t.vitals.homeMeasurement}
          </a>
        </Button>
      ) : undefined}
    >
      <VitalsGrid vitals={vitals} />
    </FeatureCard>
  )
}
