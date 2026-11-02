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
import { homeMeasurementLink, hospitalChart } from './utils/home-measurement-link'
import { isHomeMeasurementPilotUser } from './utils/home-measurement-access'
import { currentIdToken, fetchHomeReadings, type HomeReadings } from './utils/home-measurement-readings'

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

// Asked once per patient; the answer counts only for the chart it was asked about.
function useHomeReadings(chart: string | null): HomeReadings {
  const [answer, setAnswer] = useState<{ chart: string; readings: HomeReadings } | null>(null)
  useEffect(() => {
    if (!chart) return
    let current = true
    void fetchHomeReadings(chart, currentIdToken).then((readings) => { if (current) setAnswer({ chart, readings }) })
    return () => { current = false }
  }, [chart])
  return answer?.chart === chart ? answer.readings : 'unknown'
}

export function VitalsCard() {
  const { t } = useLanguage()
  const { vitalSigns, isLoading, error } = useVitals()
  const vitals = useVitalsView(vitalSigns)
  const { patient } = usePatient()
  const pilot = useHomeMeasurementPilot()
  const homeLink = pilot ? homeMeasurementLink(patient, typeof window === 'undefined' ? '' : window.location.href) : null
  const readings = useHomeReadings(homeLink ? hospitalChart(patient) : null)
  const noReadings = readings === 'none'

  return (
    <FeatureCard
      title={t.vitals.title}
      featureId="vitals"
      isLoading={isLoading}
      error={error}
      isEmpty={false}
      inline
      headerAction={homeLink ? (
        <Button asChild variant="outline" size="sm" className={noReadings ? 'opacity-50' : undefined}
          title={noReadings ? t.vitals.homeMeasurementNoReadings : t.vitals.homeMeasurementHint}>
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
