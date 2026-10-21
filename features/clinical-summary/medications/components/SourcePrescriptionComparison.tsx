import type { MedicationRow } from '../types'
import { useLanguage } from '@/src/application/providers/language.provider'

export function SourcePrescriptionComparison({ comparison }: { comparison: NonNullable<MedicationRow['sourceComparison']>; displayOrigin?: MedicationRow['dataOrigin'] }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  return (
    <div className="space-y-2 text-[max(12px,0.75rem)] leading-relaxed">
      {comparison.records.map((record, index) => (
        <div key={record.id} className="border-t border-current/15 pt-1">
          <strong>{record.dataOrigin === 'hospital' ? (en ? 'Hospital' : '院內') : (en ? 'MediCloud' : '雲端')}{comparison.records.filter(other => other.dataOrigin === record.dataOrigin).length > 1 ? ` ${comparison.records.slice(0, index + 1).filter(other => other.dataOrigin === record.dataOrigin).length}` : ''}</strong>
          {record.pharmacy && <div>{record.pharmacy}</div>}
          <div className="break-words">{record.hospitalMedicationName?.recordedName || record.hospitalMedicationName?.recordedProductName || record.secondaryTitle || record.title}</div>
          <div>{(record.frequency?.includes(' ') ? record.frequency : [record.dose, record.route, record.frequency].filter(Boolean).join(' · ')) || record.detail || (en ? 'Regimen not provided' : '未提供用法用量')}</div>
          <div>{[record.startedOn, record.durationDays === undefined ? undefined : `${record.durationDays}${en ? ' days' : ' 天'}`,
            record.totalQuantity === undefined ? (en ? 'Quantity not provided' : '總量未提供') : `${en ? 'Quantity ' : '總量 '}${record.totalQuantity}`,
            record.isChronic ? (en ? 'Chronic Rx' : '慢箋') : (en ? 'Chronic Rx not marked' : '未標示慢箋'),
            record.selfPurchased ? (en ? 'Self-pay' : '自費／自購') : undefined].filter(Boolean).join(' · ')}</div>
          {record.endDate && <div>{record.endDateSource === 'estimated' ? (en ? 'Estimated supply end: ' : '估計供藥至：') : (en ? 'Recorded period end: ' : '來源期間至：')}{record.endDate}</div>}
          {record.nhiDrugCode && <div>{en ? 'Recorded NHI code: ' : '來源健保藥碼：'}{record.nhiDrugCode}</div>}
          <div>{record.statusEstimated ? (record.status === 'completed' ? (en ? 'Derived status: estimated supply ended' : '推估狀態：供藥估計到期') : (en ? 'Derived status: within estimated supply period' : '推估狀態：供藥期間內')) : <>{en ? 'Source status: ' : '來源狀態：'}{en ? record.status : ({ active: '已開立', completed: '已完成', unknown: '未明示', cancelled: '已取消', stopped: '已停用', 'on-hold': '暫停', 'entered-in-error': '誤植', draft: '草稿' } as Record<string, string>)[record.status] || record.status}</>}</div>
          {!!record.sourceOrderIdentifiers?.length && <div className="break-all">{en ? 'Hospital source identifier: ' : '院內識別碼：'}{record.sourceOrderIdentifiers.join('、')}</div>}
        </div>
      ))}
    </div>
  )
}
