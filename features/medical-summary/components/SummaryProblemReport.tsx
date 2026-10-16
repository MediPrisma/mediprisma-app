'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { configuredEndpoint, isCollectorSite, captureCollectorAuth, awaitReportStep } from '@/src/application/telemetry/summary-report'
import { buildSummaryReport, summaryReportOutcomeLabel } from '@/src/shared/utils/summary-diagnostics'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'
import type { AiReport } from '@/src/shared/contracts/collector-event'

const subscribe = () => () => {}
const serverSite = () => false

export function SummaryProblemReport({ records, busy }: { records: AiExecutionDiagnosticRecord[]; busy: boolean }) {
  const eligible = useSyncExternalStore(subscribe, isCollectorSite, serverSite)
  const [snapshot, setSnapshot] = useState<{ json: string; endpoint: string; auth: ReturnType<typeof captureCollectorAuth> } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const active = useRef<AbortController | null>(null)
  const preview = useMemo(() => snapshot ? JSON.parse(snapshot.json) as AiReport : null, [snapshot])
  useEffect(() => () => { active.current?.abort() }, [])
  if (!records.some(r => r.technical) || !eligible) return null

  const prepare = (fresh = false) => {
    setMessage(sent && !fresh && receiptId ? `回報已收到，編號：${receiptId}` : ''); setConsent(false); setBlocked(false)
    if (snapshot && !fresh) {
      setSnapshot({ ...snapshot, auth: captureCollectorAuth().catch(() => null) })
      setReportOpen(true)
      return
    }
    const endpoint = configuredEndpoint()?.replace(/\/events$/, '/ai-reports')
    if (!endpoint) { setMessage('尚未設定回報收件位置，請使用診斷紀錄下載。'); return }
    try {
      // Freeze exactly what is previewed. Later retries cannot silently join it.
      setSnapshot({ json: buildSummaryReport(records), endpoint, auth: captureCollectorAuth().catch(() => null) })
      setSent(false); setReceiptId(null)
      setReportOpen(true)
    } catch (error) {
      setBlocked(true)
      setMessage(error instanceof Error && error.message === 'report_too_large'
        ? '完整紀錄超過回報筆數或大小限制，請從診斷紀錄下載；沒有傳送任何資料。'
        : '無法準備這份回報，請從診斷紀錄下載；沒有傳送任何資料。')
    }
  }
  const close = () => { if (!sending) { setReportOpen(false); setMessage('') } }
  const download = () => {
    if (!snapshot) return
    const url = URL.createObjectURL(new Blob([snapshot.json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'mediprisma-summary-report.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const submit = async () => {
    if (!snapshot || !consent || active.current || sent || blocked || !isCollectorSite()) return
    const controller = new AbortController(); active.current = controller
    setSending(true); setMessage('')
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const credential = await awaitReportStep(snapshot.auth, controller.signal)
      const token = credential ? await awaitReportStep(credential.getToken(), controller.signal) : null
      if (controller.signal.aborted || !isCollectorSite()) throw new Error('unavailable')
      if (!token) {
        setBlocked(true)
        setMessage('目前無法驗證回報權限，請下載這份回報，重新登入後再開啟回報。')
        return
      }
      const response = await fetch(snapshot.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: snapshot.json, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      })
      if (response.status === 503) {
        let unconfigured = false
        try { unconfigured = (await response.json()).reason === 'unconfigured' } catch { /* no raw server text is shown */ }
        if (unconfigured) {
          setBlocked(true); setMessage('目前收件功能無法使用，請下載這份回報並聯絡管理者。'); return
        }
      }
      if (response.status >= 400 && response.status < 500) {
        void response.body?.cancel().catch(() => {})
        setBlocked(true)
        setMessage(response.status === 429 ? '回報已達收件限制，請下載這份回報，稍後再試。'
          : response.status === 413 ? '這份回報超過收件大小限制，請下載這份回報。'
          : response.status === 401 || response.status === 403 ? '目前無法驗證回報權限，請下載這份回報，重新登入後再開啟回報。'
          : '收件端無法接受這份回報，請下載這份回報供後續處理。')
        return
      }
      if (response.status !== 200 && response.status !== 201) { void response.body?.cancel().catch(() => {}); throw new Error('rejected') }
      const result = await response.json()
      if (result.success !== true || typeof result.reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.reportId)) throw new Error('receipt')
      setSent(true); setReceiptId(result.reportId); setMessage(`回報已收到，編號：${result.reportId}`)
    } catch { if (active.current === controller) setMessage('尚未確認收件成功。紀錄仍保留，可重試或下載；重試同一份回報不會重複建立。') }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setSending(false) } }
  }
  return <>
    <Button className="min-h-[44px]" variant="outline" size="sm" onClick={() => prepare()} disabled={busy}>回報問題</Button>
    {!reportOpen && message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
    <Dialog open={reportOpen} onOpenChange={open => { if (!open) close() }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>回報摘要問題</DialogTitle>
          <DialogDescription>自動診斷只傳送技術資訊。此回報包含整次操作的提示詞、病歷內容與 AI 回答，請先確認下方預覽。收件端會另記錄您的登入帳號與來源電腦資訊，供追蹤處理。紀錄僅暫存在此頁，重新整理後會消失。</DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm">收件位置：{snapshot ? new URL(snapshot.endpoint).origin : ''}</p>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">共 {preview?.executions.length} 次 AI 請求，包含重試紀錄</p>
          {preview?.executions.map(execution => <section key={execution.technical.request_id} className="space-y-2 rounded-md border bg-background p-3">
            <h3 className="font-semibold">第 {execution.technical.attempt} 次請求 · {summaryReportOutcomeLabel(execution)}</h3>
            <p className="font-medium">送給 AI 的內容</p>
            <pre className="whitespace-pre-wrap break-all font-sans">{execution.prompt}</pre>
            <p className="font-medium">AI 回答（可能未完成）</p>
            <pre className="whitespace-pre-wrap break-all font-sans">{execution.output || '尚未收到回答'}</pre>
          </section>)}
          <details><summary className="cursor-pointer py-2">查看完整技術紀錄</summary><pre aria-label="完整回報預覽" className="whitespace-pre-wrap break-all">{snapshot?.json}</pre>
            <p className="py-2">重開視窗會保留這份回報。若改用最新紀錄，會建立另一份回報；先前收件狀態不明時可能重複。</p>
            <Button variant="outline" className="min-h-[44px] whitespace-normal" disabled={sending} onClick={() => prepare(true)}>改用最新紀錄建立另一份回報</Button>
          </details>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={sending || sent} onChange={e => setConsent(e.target.checked)} className="mt-1" />我已確認內容，並同意將這份病歷相關資料傳送至上述院內收件位置。</label>
        <p role="status" className="break-all text-sm">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button className="min-h-[44px]" variant="outline" onClick={download}>下載這份回報</Button>
          <Button className="min-h-[44px]" variant="outline" disabled={sending} onClick={close}>關閉</Button>
          <Button className="min-h-[44px]" disabled={!consent || sending || sent || blocked} onClick={() => void submit()}>{sending ? '傳送中…' : sent ? '已送出' : blocked ? '暫時無法送出' : '確認送出回報'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
