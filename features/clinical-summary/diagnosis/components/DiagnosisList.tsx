// Diagnosis List Component
"use client"

import { useLanguage } from "@/src/application/providers/language.provider"
import type { DiagnosisRow } from '../types'
import { DiagnosisItem } from './DiagnosisItem'

interface DiagnosisListProps {
  diagnoses: DiagnosisRow[]
  isLoading: boolean
  error: Error | null
}

export function DiagnosisList({ diagnoses, isLoading, error }: DiagnosisListProps) {
  const { t } = useLanguage()

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t.common.loading}</div>
  }

  if (error) {
    return <div className="text-sm text-destructive">{String(error)}</div>
  }

  if (diagnoses.length === 0) {
    return <div className="text-sm text-muted-foreground">{(t as any).problemList?.noData ?? t.conditions.noData}</div>
  }

  return (
    <ul className="divide-y divide-border text-sm">
      {diagnoses.map((diagnosis) => (
        <DiagnosisItem key={diagnosis.id} diagnosis={diagnosis} />
      ))}
    </ul>
  )
}
