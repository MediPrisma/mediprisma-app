import { aiReportSchema, AI_REPORT_MAX_BODY_BYTES, type SummaryAttempt } from '@/src/shared/contracts/collector-event'
import type { AiExecutionDiagnosticRecord } from './ai-execution-diagnostics'

export interface SummaryDiagnosticContext {
  runId: string
  attempt: number
  lane: SummaryAttempt['lane']
  inspect: (text: string) => SummaryAttempt['parse_state']
}

/** A malformed complete card must not be hidden by a different missing card. */
export function inspectSummaryBlocks(text: string, blocks: Array<{
  complete: (text: string) => boolean
  parse: (text: string) => unknown
}>): SummaryAttempt['parse_state'] {
  const complete = blocks.filter(block => block.complete(text))
  if (complete.some(block => !block.parse(text))) return 'invalid'
  return complete.length === blocks.length ? 'valid' : 'incomplete'
}

/** Correlation only, never authentication. Plain HTTP may lack randomUUID. */
export function diagnosticUuid(): string {
  try { return crypto.randomUUID() } catch { /* supported fallback below */ }
  const bytes = new Uint8Array(16)
  try { crypto.getRandomValues(bytes) }
  catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256) }
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Credentials are never part of the report DTO. Also remove a provider echo
 * of the exact credential before retaining the request in volatile memory. */
export function redactDiagnosticText(text: string, secret?: string | null): string {
  // Local endpoints often use placeholders such as "none" or "x". Replacing
  // these as substrings would destroy clinical terms ("allergies: none").
  const clean = secret && secret.length >= 16 ? text.split(secret).join('[REDACTED]') : text
  return clean.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
}

export function buildSummaryReport(records: AiExecutionDiagnosticRecord[]) {
  const report = aiReportSchema.parse({
    schema_version: 1, submission_id: diagnosticUuid(), consent: true,
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
