'use client'

import { AlertTriangle } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useHospitalCaptureReasons } from '@/src/application/hooks/use-hospital-capture-reasons.hook'

const CATEGORY: Record<string, [string, string]> = {
  patient: ['病人基本資料', 'patient details'], allergies: ['過敏', 'allergies'], vitals: ['生命徵象', 'vital signs'],
  conditions: ['診斷', 'diagnoses'], encounters: ['門診紀錄', 'outpatient visits'], orders: ['醫囑', 'orders'],
  admissions: ['住院紀錄', 'admissions'], emergency: ['急診紀錄', 'emergency visits'], operations: ['手術', 'operations'],
  medications: ['用藥', 'medications'], reports: ['檢查驗報告', 'test and imaging reports'],
  discharge_summaries: ['出院病摘', 'discharge summaries'], implants: ['植入物', 'implants'],
  chemotherapy: ['化療', 'chemotherapy'], careplans: ['照護計畫', 'care plans'], other: ['其他資料', 'other records'],
}
const KIND: Record<string, [string, string]> = {
  timeout: ['北榮回應逾時', 'HIS timed out'], his_busy: ['北榮忙碌', 'HIS busy'], http_error: ['北榮回應錯誤', 'HIS error'],
  parse_failed: ['頁面無法解析', 'page could not be read'], login_or_network: ['北榮登入可能過期或網路中斷', 'HIS login expired or network lost'],
  login_expired: ['北榮登入已過期，請重新登入北榮後再取得', 'HIS login expired; sign in to HIS again'],
  network: ['無法連到北榮（網路中斷或北榮沒有回應）', 'could not reach HIS (network down or no response)'],
  unknown: ['原因不明', 'unknown cause'],
}

/** Names the missing 北榮 data and why, from the active Bundle's capture tags. */
export function HospitalCaptureReasons() {
  const { locale } = useLanguage()
  const capture = useHospitalCaptureReasons()
  if (!capture) return null
  const en = locale === 'en' ? 1 : 0
  const items = capture.failures.map(f => {
    const detail = [f.status ? `HTTP ${f.status}` : null, f.count > 1 ? (en ? `${f.count} times` : `${f.count} 次`) : null].filter(Boolean).join(en ? ', ' : '，')
    return `${CATEGORY[f.category][en]}${en ? ': ' : '－'}${(KIND[f.kind] ?? KIND.unknown)[en]}${detail ? (en ? ` (${detail})` : `（${detail}）`) : ''}`
  })
  const text = capture.incompleteWithoutReason
    ? (en ? 'Some hospital records were not captured (no reason recorded). Check HIS.' : '部分院內資料未取得（未記錄原因）；請核對 HIS。')
    : (en ? `Hospital records not captured: ${items.join('; ')}. Check HIS.` : `院內資料未取得：${items.join('；')}。請核對 HIS。`)
  return <div role="status" aria-live="polite" className="flex shrink-0 items-start gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
    <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
    <span>{text}</span>
  </div>
}
