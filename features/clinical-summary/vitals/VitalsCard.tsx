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
import { homeLookupQuery, homeMeasurementLink, type HomeLookupQuery } from './utils/home-measurement-link'
import { isHomeMeasurementPilotUser } from './utils/home-measurement-access'
import { currentIdToken, fetchHomeReadings, type HomeLookup } from './utils/home-measurement-readings'

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

// Asked once per patient; the answer counts only for the query it was asked with
// (a name first, then the 病歷號 once the hospital's records arrive).
function useHomeReadings(query: HomeLookupQuery | null): HomeLookup {
  const key = query ? JSON.stringify(query) : null
  const [answer, setAnswer] = useState<{ key: string; lookup: HomeLookup } | null>(null)
  useEffect(() => {
    if (!key) return
    let current = true
    void fetchHomeReadings(JSON.parse(key) as HomeLookupQuery, currentIdToken).then((lookup) => { if (current) setAnswer({ key, lookup }) })
    return () => { current = false }
  }, [key])
  return answer?.key === key ? answer.lookup : { readings: 'unknown', bp: null }
}

export function VitalsCard() {
  const { t } = useLanguage()
  const { vitalSigns, isLoading, error } = useVitals()
  const vitals = useVitalsView(vitalSigns)
  const { patient } = usePatient()
  const pilot = useHomeMeasurementPilot()
  const pageUrl = typeof window === 'undefined' ? '' : window.location.href
  const homeLink = pilot ? homeMeasurementLink(patient, pageUrl) : null
  const home = useHomeReadings(pilot ? homeLookupQuery(patient, pageUrl) : null)
  const noReadings = home.readings === 'none'

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
      <VitalsGrid vitals={vitals} homeBp={home.bp} />
    </FeatureCard>
  )
}
