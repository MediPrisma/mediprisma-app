import type { AiModelExecution } from '@/src/core/entities/ai-model-execution.entity'
import type { SummaryAttempt, AiReport } from '@/src/shared/contracts/collector-event'

export type AiExecutionStatus = 'completed' | 'error' | 'aborted'

export interface AiExecutionDiagnosticRecord {
  version: 1
  id: string
  feature: string
  operationKey: string | null
  transport: 'query' | 'stream'
  modelExecution?: AiModelExecution
  modelName: string
  modelId: string
  timestamp: string
  prompt: string
  inputData: unknown
  outputData: string
  hasError: boolean
  errorMessage: string | null
  status: AiExecutionStatus
  technical?: SummaryAttempt
  outcome?: AiReport['executions'][number]['outcome']
}

export interface AiExecutionDiagnosticsExport {
  version: 2
  exportedAtUtc: string
  exportedAtLocal: string
  timeZone: string
  feature: string
  executions: Array<Omit<AiExecutionDiagnosticRecord, 'timestamp'> & {
    timestampUtc: string
    timestampLocal: string
    timeZone: string
  }>
}

export function aiExecutionLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Human-readable local time for the preview/export. The canonical timestamp
 * remains ISO UTC for machine processing, while this value makes the clock and
 * zone explicit to clinicians reading the JSON by hand. */
export function formatAiExecutionTimestamp(
  timestamp: string,
  locale?: string,
  timeZone = aiExecutionLocalTimeZone(),
): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return `${timestamp} (${timeZone})`
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).format(date)
    return `${formatted} (${timeZone})`
  } catch {
    return `${timestamp} (${timeZone})`
  }
}

export function aiExecutionDiagnosticsFilename(timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `mediprisma-ai-diagnostics_${safeTimestamp}.json`
}

export function buildAiExecutionDiagnosticsExport(
  feature: string,
  records: AiExecutionDiagnosticRecord[],
  exportedAtUtc = new Date().toISOString(),
  timeZone = aiExecutionLocalTimeZone(),
): AiExecutionDiagnosticsExport {
  return {
    version: 2,
    exportedAtUtc,
    exportedAtLocal: formatAiExecutionTimestamp(exportedAtUtc, undefined, timeZone),
    timeZone,
    feature,
    executions: records.map((record) => {
      const { timestamp, ...rest } = record
      return {
        ...rest,
        timestampUtc: timestamp,
        timestampLocal: formatAiExecutionTimestamp(timestamp, undefined, timeZone),
        timeZone,
      }
    }),
  }
}

export function downloadAiExecutionDiagnostics(
  feature: string,
  records: AiExecutionDiagnosticRecord[],
): void {
  const exportedAtUtc = new Date().toISOString()
  const payload = buildAiExecutionDiagnosticsExport(feature, records, exportedAtUtc)
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = aiExecutionDiagnosticsFilename(exportedAtUtc)
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
