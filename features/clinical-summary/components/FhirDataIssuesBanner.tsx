'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useLanguage } from '@/src/application/providers/language.provider'

const STATE_LABELS = {
  'zh-TW': {
    unauthorized: '授權已失效（401）',
    forbidden: '沒有讀取權限（403）',
    unsupported: '伺服器不支援',
    error: '查詢失敗',
  },
  en: {
    unauthorized: 'Authorization expired (401)',
    forbidden: 'Access forbidden (403)',
    unsupported: 'Not supported by server',
    error: 'Query failed',
  },
} as const

export function FhirDataIssuesBanner() {
  const { locale } = useLanguage()
  const {
    queryIssues,
    isLoading,
    refetch,
  } = useClinicalData()

  const visibleIssues = queryIssues.filter(([, status]) => status?.state !== 'incomplete' || status.medicationContentOnlyIncomplete !== true)
  if (isLoading || visibleIssues.length === 0) return null
  const hasBlockingQueryIssues = visibleIssues.some(([key, status]) =>
    ['Condition', 'MedicationRequest', 'AllergyIntolerance', 'Observation', 'DiagnosticReport', 'Encounter'].includes(key)
    || (status?.invalidModifierCount ?? 0) > 0)

  const isZh = locale === 'zh-TW'
  const labels = STATE_LABELS[isZh ? 'zh-TW' : 'en']
  const title = hasBlockingQueryIssues
    ? (isZh ? '部分病歷資料未載入，畫面可能不完整' : 'Some clinical data did not load; this chart may be incomplete')
    : (isZh ? 'FHIR 伺服器未提供部分選用資料' : 'The FHIR server does not provide some optional data')

  return (
    <details
      className={`mb-1 shrink-0 rounded-md border px-3 py-2 text-xs ${
        hasBlockingQueryIssues
          ? 'border-amber-400/60 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
          : 'border-border bg-muted/50 text-muted-foreground'
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{title}</span>
        <span className="shrink-0 opacity-70">{visibleIssues.length}</span>
      </summary>
      <div className="mt-2 space-y-1 border-t border-current/15 pt-2">
        {visibleIssues.map(([key, status]) => {
          if (!status) return null
          const stateLabel = labels[status.state as keyof typeof labels] ?? status.state
          return (
            <div key={key} className="flex flex-wrap gap-x-2">
              <span className="font-mono font-medium">{key}</span>
              <span>{stateLabel}</span>
              {status.message && (
                <span className="w-full break-words opacity-75">{status.message}</span>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 inline-flex items-center gap-1 rounded border border-current/25 px-2 py-1 font-medium hover:bg-background/60"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {isZh ? '重新查詢' : 'Retry'}
        </button>
      </div>
    </details>
  )
}
