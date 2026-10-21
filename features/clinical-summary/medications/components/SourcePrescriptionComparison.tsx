import type { MedicationRow } from '../types'
import { useLanguage } from '@/src/application/providers/language.provider'

export function SourcePrescriptionComparison({ comparison, displayOrigin }: { comparison: NonNullable<MedicationRow['sourceComparison']>; displayOrigin?: MedicationRow['dataOrigin'] }) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  return (
    <div className="space-y-2 text-[max(12px,0.75rem)] leading-relaxed">
      {displayOrigin === 'hospital' && <p className="font-medium">{en ? 'Display follows the hospital record. Cloud records are retained for reference.' : '以院內紀錄為準；雲端紀錄保留供查閱。'}</p>}
      <p>{comparison.status !== 'confirmed'
        ? (en ? 'Possible copies across sources. Prescription count and source correspondence are unconfirmed; do not count source records as separate prescriptions or combine their quantities.' : '兩個來源可能重複，藥囑筆數與來源對應尚未確認。請勿將來源筆數當成開藥次數，或將兩邊數量相加。')
        : (en ? 'Matched by a shared source order identifier. Both original records are shown below.' : '已依共同藥囑識別資料確認，以下保留兩邊原始紀錄。')}</p>
      {comparison.warnings?.includes('encounter-link-unconfirmed') && <p>{en ? 'The corresponding visit links are unconfirmed; the date/facility suggests comparison only.' : '來源的就診對應尚未確認；同日同院僅作為核對線索，未補成已確認的就診關聯。'}</p>}
      {comparison.warnings?.includes('source-currentness-differs') && <p>{displayOrigin === 'hospital'
        ? (en ? 'Source status or supply periods differ. The hospital status and period are displayed; cloud estimates do not replace them.' : '來源狀態或供藥期間不同；顯示採院內狀態與期間，雲端推估不覆蓋院內紀錄。')
        : (en ? 'Source status or supply periods differ; each original record is retained below.' : '來源狀態或供藥期間不同；以下保留各筆原始紀錄。')}</p>}
      {comparison.warnings?.includes('source-facts-differ') && <p>{en ? 'Source facts conflict. No confirmed merge was performed; verify status, regimen and supply in each original.' : '來源資料有差異，未確認合併；請核對各筆原始狀態、用法用量及供藥資料。'}</p>}
      {comparison.warnings?.includes('source-status-conflict') && <p>{en ? 'The hospital reports stopping, cancellation or a hold while the cloud status is active or unknown. Verify the cloud copy against the original hospital orders.' : '院內已停用、取消或暫停，雲端卻仍列有效或狀態不明；請依各筆原始院內藥囑核對雲端紀錄。'}</p>}
      {comparison.warnings?.includes('source-partners-not-in-view') && <p>{en ? 'Other comparison records are outside this view. Open the full medication list to inspect them.' : '部分比較來源不在目前檢視範圍；請開啟完整用藥清單核對。'}</p>}
      {comparison.records.filter(record => record.dataOrigin === 'hospital').length > 1 && <p>{en ? 'Distinct hospital orders are retained below; only their correspondence to cloud copies is uncertain.' : '以下各筆院內藥囑分別保留；尚未確認的是與雲端副本的逐筆對應。'}</p>}
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
