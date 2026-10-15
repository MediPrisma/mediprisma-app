'use client'

import { useState } from 'react'
import type { HfExcludedLab } from '@/src/core/hf-risk/contract'

const REASONS: Record<string, [string, string]> = {
  'source-omitted': ['院所不符、無法確認或有衝突，未納入所選院所資料', 'Hospital differs, is unknown or conflicts with the selected hospital'],
  'void-omitted': ['紀錄已取消、作廢或未執行', 'Record cancelled, void or not performed'],
  'lab-status': ['尚未確認為完成／修正完成的檢驗結果', 'Result status is not confirmed as final, amended or corrected'],
  'lab-unmapped': ['沒有可對應 HF 模型的 LOINC；可能是模型不使用的項目或代碼尚未對應', 'No matching HF model LOINC; the item may be outside the model or its code is unmapped'],
  'lab-date': ['採檢日期缺漏或格式無效', 'Collection date missing or invalid'],
  'future-omitted': ['採檢日期晚於所選基準門診日', 'Collection date is after the selected index visit'],
  'lab-value-unit': ['數值不是有效數字、單位缺漏／不支援，或比較符號無法辨識；以單位代碼優先判定', 'Invalid numeric value, missing/unsupported unit or comparator; unit code takes precedence'],
  'value-invalid': ['缺少可用的數字結果；文字結果不自行換算', 'Missing a valid numeric result; text results are not converted'],
  'unit-missing': ['缺少單位，無法確認數值尺度', 'Unit missing; the numeric scale cannot be established'],
  'unit-unsupported': ['單位無法換算成模型要求的單位；若有單位代碼，優先依代碼判定', 'Unit cannot be converted to the model unit; unit code takes precedence when present'],
  'comparator-invalid': ['數值比較符號不支援；僅接受 <、<=、>、>=', 'Unsupported comparator; only <, <=, > and >= are accepted'],
}

export function HfExcludedLabs({ items, indexDate, locale }: { items: HfExcludedLab[]; indexDate: string; locale: string }) {
  const [limit, setLimit] = useState(20)
  const en = locale === 'en'
  const missing = en ? 'Not provided' : '未提供'
  return <details className="rounded-lg border border-border bg-background">
    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold">
      {en ? 'Excluded lab / observation details' : '未納入的檢驗／觀察項目明細'} · {items.length} {en ? 'results' : '筆'}
    </summary>
    <div className="space-y-3 px-3 pb-3">
      <p className="text-xs text-muted-foreground">{en
        ? `Index visit: ${indexDate}. Each row shows its first exclusion reason. This list includes non-model items; exclusion does not mean a test was never performed. Details stay in this browser and are not sent to the model.`
        : `基準門診日：${indexDate}。每筆顯示第一個未通過的原因；包含模型不使用的項目，未納入不代表沒有抽驗。明細僅供本機核對，不送給模型。`}</p>
      {!items.length && <p className="text-sm">{en ? 'No excluded observations in this preparation. Tests absent from the source cannot be listed here.' : '本次整理沒有被排除的檢驗／觀察紀錄；來源未匯入的檢驗無法列在此處。'}</p>}
      <ol className="divide-y divide-border">
        {items.slice(0, limit).map(item => <li key={item.row} className="space-y-1 break-words py-3 text-xs [overflow-wrap:anywhere]">
          <p className="text-sm font-semibold">{item.name || (en ? 'Unnamed item' : '未命名項目')} <span className="font-normal text-muted-foreground">· {en ? 'Source row' : '來源序號'} {item.row}</span></p>
          <p className="font-medium">{(REASONS[item.valueIssue ?? item.reason] ?? [item.reason, item.reason])[en ? 1 : 0]}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 tabular-nums">
            <dt className="text-muted-foreground">{en ? 'Collection date' : '採檢日期'}</dt><dd>{item.date || missing}</dd>
            <dt className="text-muted-foreground">{en ? 'Source result' : '原始結果'}</dt><dd>{item.value ?? missing} · {en ? 'Unit' : '單位'}：{item.unit || missing}</dd>
            <dt className="text-muted-foreground">{en ? 'Unit code' : '單位代碼'}</dt><dd>{item.unitCode || missing}</dd>
            <dt className="text-muted-foreground">{en ? 'Result status' : '結果狀態'}</dt><dd>{item.status || missing}</dd>
            <dt className="text-muted-foreground">{en ? 'Source codes' : '來源代碼'}</dt><dd>{item.codes.length ? item.codes.map(code => <div key={code}>{code}</div>) : missing}</dd>
          </dl>
        </li>)}
      </ol>
      {limit < items.length && <button type="button" onClick={() => setLimit(value => value + 20)} className="min-h-11 rounded-md border border-border px-3 text-sm">
        {en ? `Show next ${Math.min(20, items.length - limit)} (${Math.min(limit, items.length)} / ${items.length})` : `再顯示 ${Math.min(20, items.length - limit)} 筆（已顯示 ${Math.min(limit, items.length)}／${items.length}）`}
      </button>}
    </div>
  </details>
}
