import { aiReportSchema, AI_REPORT_MAX_BODY_BYTES, type SummaryAttempt } from '@/src/shared/contracts/collector-event'
import type { AiExecutionDiagnosticRecord } from './ai-execution-diagnostics'

export interface SummaryDiagnosticContext {
  runId: string
  attempt: number
  lane: SummaryAttempt['lane']
  inspect: (text: string) => SummaryAttempt['parse_state']
}

/** Credentials are never part of the report DTO. Also remove a provider echo
 * of the exact credential before retaining the request in volatile memory. */
export function redactDiagnosticText(text: string, secret?: string | null): string {
  const clean = secret ? text.split(secret).join('[REDACTED]') : text
  return clean.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
}

export function buildSummaryReport(records: AiExecutionDiagnosticRecord[]) {
  const report = aiReportSchema.parse({
    schema_version: 1, submission_id: crypto.randomUUID(), consent: true,
    created_at: new Date().toISOString(),
    executions: records.filter(r => r.technical).map(r => ({
      timestamp: r.timestamp, status: r.status, technical: r.technical,
      prompt: redactDiagnosticText(r.prompt), output: redactDiagnosticText(r.outputData),
    })),
  })
  const json = JSON.stringify(report, null, 2)
  if (new TextEncoder().encode(json).length > AI_REPORT_MAX_BODY_BYTES) throw new Error('report_too_large')
  return json
}
