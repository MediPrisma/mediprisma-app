// Refactored DiagnosisCard Component
"use client"

import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useDiagnosis } from './hooks/useDiagnosis'
import { useDiagnosisRows } from './hooks/useDiagnosisRows'
import { DiagnosisList } from './components/DiagnosisList'
import { useMemo } from 'react'
import { buildIcdDictionary } from '@/src/shared/utils/icd-lookup'

export function DiagnosesCard() {
  const { t, locale } = useLanguage()
  const { conditions, encounters, isLoading, error } = useDiagnosis()
  const icdDict = useMemo(() => buildIcdDictionary(conditions, locale, encounters), [conditions, locale, encounters])
  const rows = useDiagnosisRows(conditions, locale, icdDict, encounters)

  return (
    <FeatureCard 
      title={t.conditions.title}
      featureId="diagnosis"
      isLoading={isLoading} 
      error={error}
      isEmpty={rows.length === 0}
      emptyMessage={t.conditions.noData}
    >
      <DiagnosisList diagnoses={rows} isLoading={false} error={null} />
    </FeatureCard>
  )
}
