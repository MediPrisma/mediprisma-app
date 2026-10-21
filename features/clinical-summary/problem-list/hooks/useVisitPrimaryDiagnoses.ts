import { useMemo } from 'react'
import type { ConditionEntity } from '@/src/core/entities/clinical-data.entity'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useLanguage } from '@/src/application/providers/language.provider'
import { buildVisitPrimaryDiagnoses } from '../utils/visit-primary-diagnoses'

export function useVisitPrimaryDiagnoses(conditions: ConditionEntity[]) {
  const { encounters = [], resourceReady } = useClinicalData()
  const { locale } = useLanguage()
  const rows = useMemo(
    () => buildVisitPrimaryDiagnoses(encounters, conditions, locale),
    [encounters, conditions, locale],
  )
  return { rows, isReady: resourceReady.encounters }
}
