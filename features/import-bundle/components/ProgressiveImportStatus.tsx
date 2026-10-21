'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useProgressiveImportStatus } from '@/src/application/hooks/use-progressive-import.hook'

export function ProgressiveImportStatus() {
  const { locale } = useLanguage()
  const current = useProgressiveImportStatus()
  if (!current) return null
  const english = locale === 'en'
  const waiting = ['waiting', 'reports-pending', 'reports-pending-partial'].includes(current.phase)
  const warning = ['partial', 'failed', 'reports-failed', 'update-failed', 'reports-pending-partial', 'cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'].includes(current.phase)
  const Icon = waiting ? LoaderCircle : warning ? AlertTriangle : CheckCircle2
  const text = {
    waiting: english ? 'Cloud records loaded. Hospital outpatient records are still loading…' : '雲端資料已載入，院內門診資料擷取中…',
    'reports-pending': english ? 'Outpatient records loaded. Test and imaging reports are still loading…' : '門診資料已載入，檢查驗報告擷取中…',
    'reports-pending-partial': english ? 'Some outpatient records loaded. Reports are still loading; check HIS for missing records.' : '部分門診資料已載入，檢查驗報告擷取中；請核對 HIS。',
    'reports-failed': english ? 'Outpatient records remain available. Reports were not fully loaded; check HIS.' : '已載入的門診資料可繼續使用；檢查驗報告未完整載入，請核對 HIS。',
    'update-failed': english ? 'Hospital update did not finish. Previously loaded records remain available; check HIS.' : '院內資料更新未完成；畫面保留先前已載入資料，請核對 HIS。',
    cancelled: english ? 'Capture cancelled. Check the patient and coverage of the records still shown.' : '擷取已取消；畫面保留已載入資料，請核對病人與資料範圍。',
    'patient-changed': english ? 'Source patient changed. This is the previous patient’s chart; do not use it for the current patient.' : '來源病人已變更，已停止補載；畫面仍為先前病人資料，請勿用於目前病人。',
    'privacy-stale': english ? 'Privacy settings changed. Records shown use the previous settings; capture again.' : '隱私設定已變更，已停止補載；畫面資料沿用先前設定，請重新取得。',
    'source-unavailable': english ? 'Source patient could not be verified. Check patient identity before continuing.' : '無法確認來源病人，已停止補載；請先核對病人後重新取得。',
    loaded: english ? 'Hospital outpatient records loaded.' : '已載入院內門診資料',
    empty: english ? 'Hospital lookup completed. No additional outpatient records were available.' : '院內門診查詢完成，無可補入資料。',
    partial: english ? 'Some hospital outpatient records loaded. Check HIS for missing records.' : '已載入部分院內門診資料，請核對 HIS。',
    failed: english ? 'Cloud records are available. Hospital outpatient records were not loaded.' : '雲端資料可繼續使用；院內門診資料未載入。',
  }[current.phase]
  return <div role="status" aria-live="polite" className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm ${warning ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100' : waiting ? 'bg-muted/50 text-muted-foreground' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'}`}>
    <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${waiting ? 'animate-spin motion-reduce:animate-none' : ''}`} />
    <span>{text}</span>
  </div>
}
