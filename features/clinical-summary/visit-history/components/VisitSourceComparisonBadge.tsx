import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { useLanguage } from '@/src/application/providers/language.provider'
import { clinicalTooltipSurfaceClass } from '@/features/clinical-summary/components/clinical-metadata-styles'
import type { VisitRecord } from '../hooks/useVisitHistory'

export function VisitSourceComparisonBadge({ visit }: { visit: VisitRecord }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  if (!visit.sourceComparisonStatus) return null
  return <TapTooltip asChild contentClassName={`${clinicalTooltipSurfaceClass} max-h-[70vh] max-w-[min(90vw,30rem)] overflow-y-auto whitespace-normal text-xs leading-relaxed`}
    content={<div className="space-y-2">
      <p>{visit.sourceComparisonStatus !== 'confirmed'
        ? (en ? 'Possible copies. Visit identity is unconfirmed; this is one comparison group, not a confirmed visit count.' : '兩個來源可能記錄同一次就診，尚未確認；此處為一組比較紀錄，不代表已確認就診次數。')
        : (en ? 'Matched by a shared visit identifier.' : '已依共同就診識別資料確認。')}</p>
      {visit.sourceComparisonWarnings?.includes('diagnosis-coding-systems-differ') && <p>{en ? 'The sources declare different ICD coding systems. Both original codes and descriptions are retained; no WHO/CM conversion is assumed.' : '兩邊宣告的 ICD 編碼系統不同；已保留各自原碼與名稱，未將 WHO 與 CM 直接互換。'}</p>}
      {visit.sourceComparisonWarnings?.includes('source-partners-not-in-view') && <p>{en ? 'Some source records are outside this view; open the full visit list to inspect them.' : '部分來源不在目前檢視範圍，請開啟完整就診清單核對。'}</p>}
      {visit.sourceRecords?.map((record, index) => <div key={record.id} className="border-t border-current/15 pt-1">
        <strong>{record.origin === 'hospital' || !record.origin && index === 0 ? (en ? 'Hospital' : '院內') : (en ? 'MediCloud' : '雲端')}</strong>
        <div>{[record.date, record.institution, record.department, record.physician].filter(Boolean).join(' · ')}</div>
        {record.diagnoses.map((text, index) => <div key={index} className="break-words">{text}</div>)}
      </div>)}
    </div>}>
    <span tabIndex={0} className="inline-flex shrink-0 cursor-help text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
      {visit.sourceComparisonStatus !== 'confirmed' ? (en ? 'Compare sources' : '跨來源待核對') : (en ? 'Hospital + cloud' : '院內＋雲端')}
    </span>
  </TapTooltip>
}
