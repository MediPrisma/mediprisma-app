import type { MedicationRow } from '../types'
import { useLanguage } from '@/src/application/providers/language.provider'

export function SourcePrescriptionComparison({ comparison }: { comparison: NonNullable<MedicationRow['sourceComparison']> }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  return (
    <div className="space-y-2 text-[max(12px,0.75rem)] leading-relaxed">
      <p>{comparison.status === 'candidate'
        ? (en ? 'Possible copies across sources. Order identity is unconfirmed; do not count these as two prescriptions or combine their quantities.' : '兩個來源可能記錄同一藥囑，尚未確認。請勿視為開立兩次，或將兩邊數量相加。')
        : (en ? 'Matched by a shared source order identifier. Both original records are shown below.' : '已依共同藥囑識別資料確認，以下保留兩邊原始紀錄。')}</p>
      {comparison.records.map((record) => (
        <div key={record.id} className="border-t border-current/15 pt-1">
          <strong>{record.dataOrigin === 'hospital' ? (en ? 'Hospital' : '院內') : (en ? 'MediCloud' : '雲端')}</strong>
          <div className="break-words">{record.hospitalMedicationName?.recordedName || record.hospitalMedicationName?.recordedProductName || record.secondaryTitle || record.title}</div>
          <div>{(record.frequency?.includes(' ') ? record.frequency : [record.dose, record.route, record.frequency].filter(Boolean).join(' · ')) || record.detail || (en ? 'Regimen not provided' : '未提供用法用量')}</div>
          <div>{[record.startedOn, record.durationDays === undefined ? undefined : `${record.durationDays}${en ? ' days' : ' 天'}`,
            record.totalQuantity === undefined ? (en ? 'Quantity not provided' : '總量未提供') : `${en ? 'Quantity ' : '總量 '}${record.totalQuantity}`,
            record.isChronic ? (en ? 'Chronic Rx' : '慢箋') : undefined,
            record.selfPurchased ? (en ? 'Self-pay' : '自費／自購') : undefined].filter(Boolean).join(' · ')}</div>
          {record.nhiDrugCode && <div>{en ? 'Recorded NHI code: ' : '來源健保藥碼：'}{record.nhiDrugCode}</div>}
          <div>{en ? 'Source status: ' : '來源狀態：'}{en ? record.status : ({ active: '已開立', completed: '已完成', unknown: '未明示', cancelled: '已取消', stopped: '已停用', 'on-hold': '暫停', 'entered-in-error': '誤植', draft: '草稿' } as Record<string, string>)[record.status] || record.status}</div>
          {!!record.sourceOrderIdentifiers?.length && <div className="break-all">{en ? 'Order: ' : '藥囑編號：'}{record.sourceOrderIdentifiers.join('、')}</div>}
        </div>
      ))}
    </div>
  )
}
