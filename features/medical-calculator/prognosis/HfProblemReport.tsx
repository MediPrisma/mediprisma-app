'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { configuredEndpoint, isCollectorSite, captureCollectorAuth, awaitReportStep } from '@/src/application/telemetry/summary-report'
import { buildHfProblemReport, type HfReportSnapshot } from '@/src/application/telemetry/hf-report'
import { hfDiagnosticStage, type HfDiagnosticRecord } from '@/src/core/hf-risk/diagnostics'
import type { HfRecordSource } from '@/src/core/hf-risk/record-source'
import { hfHorizon } from './HfPredictionResult'

export function HfProblemReport({ runId, records, source, locale, describeError, snapshot, onSnapshotChange }: {
  runId: string; records: HfDiagnosticRecord[]; source: HfRecordSource; locale: string; describeError: (code: string) => string
  snapshot: HfReportSnapshot | null; onSnapshotChange: (snapshot: HfReportSnapshot) => void
}) {
  const en = locale === 'en'
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const sent = Boolean(snapshot?.receiptId)
  const [message, setMessage] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { const request = active.current; active.current = null; request?.abort() }, [])
  const prepare = () => {
    if (!snapshot) {
      try {
        onSnapshotChange({ json: buildHfProblemReport(runId, records, source, process.env.NEXT_PUBLIC_COLLECTOR_APP_VERSION ?? null),
          endpoint: isCollectorSite() ? configuredEndpoint()?.replace(/\/events$/, '/ai-reports') ?? null : null })
      } catch { setMessage(en ? 'Unable to prepare the report. No data was sent.' : '無法準備回報，沒有傳送任何資料。'); return }
    }
    setConsent(false); setOpen(true)
  }
  const download = () => {
    if (!snapshot) return
    const url = URL.createObjectURL(new Blob([snapshot.json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'mediprisma-hf-diagnostics.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const submit = async () => {
    if (!snapshot?.endpoint || !consent || active.current || sent || !isCollectorSite()) return
    const controller = new AbortController(); active.current = controller; setSending(true); setMessage('')
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const auth = await awaitReportStep(captureCollectorAuth(), controller.signal)
      const token = auth ? await awaitReportStep(auth.getToken(), controller.signal) : null
      if (!token || !isCollectorSite()) throw new Error('auth')
      const response = await fetch(snapshot.endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: snapshot.json,
        signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
      if (response.status !== 200 && response.status !== 201) {
        void response.body?.cancel().catch(() => {})
        throw new Error([401, 403].includes(response.status) ? 'auth' : response.status === 413 ? 'size' : response.status === 429 ? 'quota' : 'unavailable')
      }
      const receipt = await response.json()
      if (receipt.success !== true || typeof receipt.reportId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.reportId)) throw new Error('receipt')
      if (controller.signal.aborted) return
      onSnapshotChange({ ...snapshot, receiptId: receipt.reportId }); setMessage('')
    } catch (error) {
      if (controller.signal.aborted && active.current !== controller) return
      const code = error instanceof Error ? error.message : ''
      setMessage(code === 'auth' ? (en ? 'Report authorization failed. Sign in again or download this report.' : '無法驗證回報權限，請重新登入或下載這份回報。')
        : code === 'size' ? (en ? 'The receiver rejected the report size. Download this report.' : '回報超過收件大小限制，請下載這份回報。')
        : code === 'quota' ? (en ? 'The report quota has been reached. Download it or retry later.' : '已達回報收件限制，請下載或稍後再試。')
        : (en ? 'Receipt is not confirmed. Retry uses the same report ID; you can also download it.' : '尚未確認收件成功。可重試或下載；重試會使用同一份回報編號。'))
    } finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setSending(false) } }
  }
  return <div className="space-y-2">
    <details className="rounded-md border border-border px-3 py-2 text-sm">
      <summary className="min-h-8 cursor-pointer font-medium">{en ? 'Request diagnostics' : '查看請求診斷'}</summary>
      <div className="space-y-3 pt-2">{records.map(({ diagnostic: d }) => <div key={d.requestId} className="space-y-1 border-t border-border pt-2">
        <p className="font-medium">{hfHorizon(d.claim, en)} · {d.operation === 'predict' ? (en ? 'Prediction' : '模型預測') : (en ? 'Input check' : '輸入檢查')}</p>
        <p>{d.errorCode ? describeError(d.errorCode) : d.verdict === 'refused' ? (en ? 'The model refused assessment; review its input messages.' : '模型拒絕評估，請查看資料檢查訊息。') : (en ? 'Completed' : '已完成')}</p>
        <p>{hfDiagnosticStage(d.stage, en)} · HTTP {d.httpStatus ?? (en ? 'no response' : '未收到回應')} · {(d.elapsedMs / 1000).toFixed(2)} {en ? 's' : '秒'}</p>
        <p className="break-all text-xs text-muted-foreground">{en ? 'Request ID' : '請求編號'}：{d.requestId}</p>
      </div>)}</div>
    </details>
    <Button variant="outline" className="min-h-11" onClick={prepare}>{en ? 'Report HF problem' : '回報 HF 問題'}</Button>
    {!open && message && <p role="status" className="text-sm">{message}</p>}
    <Dialog open={open} onOpenChange={value => { if (!sending) setOpen(value) }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{en ? 'Report HF problem' : '回報 HF 問題'}</DialogTitle>
          <DialogDescription>{en ? 'Includes this run’s request diagnostics and the validated model input: birth date, sex, visit dates, diagnoses, laboratory values and procedures. It excludes the original chart, names, identity numbers and credentials. The receiver also records your signed-in account and source computer. Review the complete contents before sending.' : '包含本次請求診斷，以及已通過格式檢查的模型輸入：生日、性別、就診日期、診斷、檢驗數值與處置。不含原始整份病歷、姓名、身分證、病歷號或金鑰。收件端另記錄登入帳號與來源電腦；請先確認完整內容。'}</DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm">{en ? 'Recipient: ' : '收件位置：'}{snapshot?.endpoint ? new URL(snapshot.endpoint).origin : (en ? 'Upload unavailable on this route; download the report.' : '此入口未啟用院內回報，可下載診斷檔。')}</p>
        <pre aria-label={en ? 'Complete HF report preview' : '完整 HF 回報預覽'} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-xs">{snapshot?.json}</pre>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} disabled={sending || sent} onChange={e => setConsent(e.target.checked)} />{en ? 'I reviewed the contents and agree to send these clinical inputs to the hospital receiver.' : '我已確認內容，並同意將這份臨床輸入資料傳送至上述院內收件位置。'}</label>
        <p role="status" className="break-all text-sm">{snapshot?.receiptId ? (en ? 'Report received. ID: ' : '回報已收到，編號：') + snapshot.receiptId : message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="min-h-11" onClick={download}>{en ? 'Download report' : '下載這份回報'}</Button>
          <Button variant="outline" className="min-h-11" disabled={sending} onClick={() => setOpen(false)}>{en ? 'Close' : '關閉'}</Button>
          <Button className="min-h-11" disabled={!snapshot?.endpoint || !consent || sending || sent} onClick={() => void submit()}>{sending ? (en ? 'Sending…' : '傳送中…') : sent ? (en ? 'Sent' : '已送出') : (en ? 'Confirm and send' : '確認送出回報')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
}
