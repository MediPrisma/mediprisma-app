// Refactored VitalsCard Component
//
// A single-row card: these readings mostly come from health checks, often
// years old, so they are context rather than the tab's main content.
"use client"

import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useVitals } from './hooks/useVitals'
import { useVitalsView } from './hooks/useVitalsView'
import { VitalsGrid } from './components/VitalsGrid'

export function VitalsCard() {
  const { t } = useLanguage()
  const { vitalSigns, isLoading, error } = useVitals()
  const vitals = useVitalsView(vitalSigns)

  return (
    <FeatureCard
      title={t.vitals.title}
      featureId="vitals"
      isLoading={isLoading}
      error={error}
      isEmpty={false}
      inline
    >
      <VitalsGrid vitals={vitals} />
    </FeatureCard>
  )
}
