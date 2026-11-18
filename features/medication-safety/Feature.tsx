'use client'

// 安全 — the hospital interaction check, in the right panel. Present only on a
// hospital workstation of a build that has the service (see
// useMedicationSafetyTab); when the service cannot be reached the tab stays
// and says why, so "not checked" never reads as "nothing found".
import { Loader2, RotateCw } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { InteractionSummary, LocalPreparationNote } from '@/features/clinical-summary/medications/components/InteractionSummary'
import { useInteractionCheck } from '@/features/clinical-summary/medications/hooks/useInteractionCheck'

export default function MedicationSafetyFeature() {
  const { locale } = useLanguage()
  const en = locale === 'en'
  const { state, rows, retry } = useInteractionCheck()

  if (state.status === 'ok') return <InteractionSummary review={state.review} rows={rows} />

  if (state.status === 'blocked' || state.status === 'unreachable') {
    const reason = state.status === 'blocked'
      ? (en
        ? 'Chrome has not allowed this site to reach the local network: site icon left of the address → Site settings → Local network access → Allow.'
        : 'Chrome 尚未允許此網站存取區域網路：網址列左側圖示 → 網站設定 → 區域網路存取 → 允許。')
      : state.reason === 'timeout'
        ? (en ? 'The hospital service did not answer in time.' : '院內服務逾時未回應。')
        : (en ? 'Use the hospital network; the service may also be down.' : '請確認在院內網路；也可能是服務暫時無回應。')
    return (
      <section aria-label={en ? 'Drug interactions' : '交互作用'} className="rounded-md border border-border/70 bg-muted/30 p-3">
        <p className="text-[max(13px,0.8125rem)] font-medium text-foreground">
          {en ? 'Cannot reach the hospital drug database — interactions not checked' : '連不上院內藥劑資料庫，交互作用未檢核'}
        </p>
        <p className="mt-1 text-[max(12px,0.75rem)] text-muted-foreground">{reason}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[max(12px,0.75rem)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]"
        >
          <RotateCw aria-hidden className="h-3.5 w-3.5" />
          {en ? 'Retry' : '重試'}
        </button>
      </section>
    )
  }

  const message = state.status === 'too-few'
    ? (en ? 'Fewer than two checkable ingredients — interactions not checked.' : '可檢核的成分不足兩項，交互作用未檢核。')
    : (en ? 'Checking interactions…' : '交互作用檢核中…')
  return (
    <div>
      <p className="flex items-center gap-1.5 px-1 py-2 text-[max(13px,0.8125rem)] text-muted-foreground" role="status">
        {state.status !== 'too-few' && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
        {message}
      </p>
      {state.status === 'too-few' && <LocalPreparationNote rowIds={state.localRowIds} rows={rows} className="px-1" />}
    </div>
  )
}
