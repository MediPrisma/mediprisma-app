'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { configuredEndpoint, isCollectorSite } from '@/src/infrastructure/telemetry/collector'
import { captureCollectorAuth } from '@/src/infrastructure/telemetry/collector-auth'
import { buildSummaryReport } from '@/src/shared/utils/summary-diagnostics'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'

export function SummaryProblemReport({ records, busy }: { records: AiExecutionDiagnosticRecord[]; busy: boolean }) {
  const [snapshot, setSnapshot] = useState<{ json: string; endpoint: string; auth: ReturnType<typeof captureCollectorAuth> } | null>(null)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  if (!records.some(r => r.technical) || !isCollectorSite()) return null

  const prepare = () => {
    setMessage(''); setConsent(false); setSent(false)
    const endpoint = configuredEndpoint()?.replace(/\/events$/, '/ai-reports')
    if (!endpoint) { setMessage('尚未設定回報收件位置，請使用診斷紀錄下載。'); return }
    try {
      // Freeze exactly what is previewed. Later retries cannot silently join it.
      setSnapshot({ json: buildSummaryReport(records), endpoint, auth: captureCollectorAuth().catch(() => null) })
    } catch { setMessage('完整紀錄超過回報大小限制，請從診斷紀錄下載；沒有傳送任何資料。') }
  }
  const download = () => {
    if (!snapshot) return
    const url = URL.createObjectURL(new Blob([snapshot.json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'mediprisma-summary-report.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const submit = async () => {
    if (!snapshot || !consent || active.current || sent || !isCollectorSite()) return
    const controller = new AbortController(); active.current = controller
    setSending(true); setMessage('')
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const credential = await snapshot.auth
      const token = await credential?.getToken()
      if (!token || controller.signal.aborted || !isCollectorSite()) throw new Error('unavailable')
      const response = await fetch(snapshot.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: snapshot.json, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      })
      if (response.status !== 200 && response.status !== 201) { void response.body?.cancel(); throw new Error('rejected') }
      const result = await response.json()
      if (result.success !== true || typeof result.reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.reportId)) throw new Error('receipt')
      setSent(true); setMessage(`回報已收到，編號：${result.reportId}`)
    } catch { if (active.current === controller) setMessage('尚未確認收件成功。紀錄仍保留，可重試或下載；重試同一份回報不會重複建立。') }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setSending(false) } }
  }
  return <>
    <Button variant="outline" size="sm" onClick={prepare} disabled={busy}>回報問題</Button>
    {!snapshot && message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
    <Dialog open={Boolean(snapshot)} onOpenChange={open => { if (!open && !sending) setSnapshot(null) }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>回報摘要問題</DialogTitle>
          <DialogDescription>自動診斷只傳送技術資訊。此回報包含整次操作的提示詞、病歷內容與 AI 回答，請先確認下方預覽。紀錄僅暫存在此頁，重新整理後會消失。</DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm">收件位置：{snapshot ? new URL(snapshot.endpoint).origin : ''}</p>
        <pre aria-label="完整回報預覽" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-sm">{snapshot?.json}</pre>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={sending || sent} onChange={e => setConsent(e.target.checked)} className="mt-1" />我已確認內容，並同意將這份病歷相關資料傳送至上述院內收件位置。</label>
        <p role="status" className="break-all text-sm">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={download}>下載這份回報</Button>
          <Button variant="outline" disabled={sending} onClick={() => setSnapshot(null)}>關閉</Button>
          <Button disabled={!consent || sending || sent} onClick={() => void submit()}>{sending ? '傳送中…' : sent ? '已送出' : '確認送出回報'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
