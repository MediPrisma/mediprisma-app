// Refactored VitalsCard Component
//
// A single-row card: these readings mostly come from health checks, often
// years old, so they are context rather than the tab's main content.
"use client"

import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useVitals } from './hooks/useVitals'
import { useVitalsView } from './hooks/useVitalsView'
import { VitalsGrid } from './components/VitalsGrid'
import { homeMeasurementLink } from './utils/home-measurement-link'

export function VitalsCard() {
  const { t } = useLanguage()
  const { vitalSigns, isLoading, error } = useVitals()
  const vitals = useVitalsView(vitalSigns)
  const { patient } = usePatient()
  const homeLink = homeMeasurementLink(patient, typeof window === 'undefined' ? '' : window.location.href)

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
