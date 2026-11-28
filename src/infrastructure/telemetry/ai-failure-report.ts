'use client'

import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'
import { buildSummaryReport } from '@/src/shared/utils/summary-diagnostics'
import { collectorNetworkPermission, configuredEndpoint, isCollectorSite } from './collector'
import { captureCollectorAuth } from './collector-auth'

const REQUEST_TIMEOUT_MS = 30_000

/**
 * 北榮 entry only (`?site=vghtpe`, /app and /app-hmc): a summary run that failed even after its
 * automatic retry is sent to the in-hospital Collector as an AI report with its prompts and
 * answers, without the 回報問題 preview (owner decision 2026-11-27, Collector D097). Only the given
 * run's records are sent. Never prompts the browser for network permission, never shows UI, and
 * any failure is dropped: it must not affect the summary.
 */
export function sendSummaryFailureReport(records: AiExecutionDiagnosticRecord[], runId: string | undefined): void {
  try {
    if (!runId || !isCollectorSite()) return
    const run = records.filter(record => record.technical?.run_id === runId)
    if (!run.length) return
    const base = configuredEndpoint()
    if (!base) return
    const endpoint = base.replace(/\/collector\/v1\/events$/, '/collector/v1/ai-reports')
    const body = buildSummaryReport(run, 'auto_failure')
    void (async () => {
      const permission = await collectorNetworkPermission(endpoint)
      if (permission?.state !== 'granted') return
      const token = await (await captureCollectorAuth())?.getToken()
      if (!token || !isCollectorSite()) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body, signal: controller.signal, credentials: 'omit',
          referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        })
        void response.body?.cancel().catch(() => {})
      } finally { clearTimeout(timer) }
    })().catch(() => {})
  } catch { /* An oversized or unbuildable report is dropped; the summary is unaffected. */ }
}
