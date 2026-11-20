import { aiReportSchema, AI_REPORT_MAX_BODY_BYTES } from '@/src/shared/contracts/collector-event'
import { diagnosticUuid } from '@/src/shared/utils/summary-diagnostics'
import { validateHfTransportBundle } from '@/src/core/hf-risk/transport-bundle'
import { HF_REQUEST_ERRORS, type HfDiagnosticRecord } from '@/src/core/hf-risk/diagnostics'
import type { HfRecordSource } from '@/src/core/hf-risk/record-source'

/** Lives with the HF run, so returning to the list cannot change submission identity. */
export interface HfReportSnapshot { json: string; endpoint: string | null; receiptId?: string }

/** Use the existing consented /ai-reports envelope, never the automatic /events endpoint.
 * Its prompt/output fields carry structured HF input/diagnostics, labeled by kind. */
export function buildHfProblemReport(runId: string, records: HfDiagnosticRecord[], source: HfRecordSource, appVersion: string | null,
  buildRevision: string | null = process.env.NEXT_PUBLIC_COLLECTOR_BUILD_REVISION ?? null) {
  const inputs = new Map<string, string>()
  const executions = records.map(({ diagnostic: d, inputJson }, index) => {
    let input: unknown
    let inputReference: string | undefined
    let inputOmission: string | undefined
    if (inputJson) {
      const previous = inputs.get(inputJson)
      if (previous) inputReference = previous
      else {
        try {
          const parsed = JSON.parse(inputJson)
          if (validateHfTransportBundle(parsed, d.indexDate)) { input = parsed; inputs.set(inputJson, d.requestId) }
          else inputOmission = 'Input did not pass the model privacy contract; raw data excluded.'
        } catch { inputOmission = 'Input could not be validated; raw data excluded.' }
      }
    } else inputOmission = 'No validated input was sent.'
    const request = { kind: 'hf-samd', schemaVersion: 1, source,
      appVersion: appVersion && /^[0-9][0-9a-z.+-]{0,63}$/i.test(appVersion) ? appVersion : null,
      buildRevision: buildRevision && /^[0-9a-f]{7,40}$/i.test(buildRevision) ? buildRevision : null,
      operation: d.operation, claim: d.claim,
      indexDate: d.indexDate, input, inputReference, inputOmission }
    let prompt = JSON.stringify(request)
    // Existing receiver limits each text field. Never silently truncate a clinical input.
    if (prompt.length > 2_000_000) {
      inputs.delete(inputJson!)
      prompt = JSON.stringify({ ...request, input: undefined, inputOmission: 'Input exceeds the report attachment limit; only diagnostics included.' })
    }
    // Explicit allowlist: no raw exception, response body, URL, token, source record or identifier.
    const output = JSON.stringify({ kind: 'hf-samd', requestId: d.requestId, operation: d.operation, claim: d.claim,
      stage: d.stage, httpStatus: d.httpStatus, errorCode: d.errorCode, verdict: d.verdict, elapsedMs: d.elapsedMs,
      requestBytes: d.requestBytes, responseBytes: d.responseBytes, responseType: d.responseType,
      responseIdMatched: d.responseIdMatched, adapterVersion: d.adapterVersion })
    const outcome = d.errorCode ? HF_REQUEST_ERRORS[d.errorCode].outcome : d.verdict === 'refused' ? 'validation_failed' : null
    return { timestamp: d.startedAt, status: d.errorCode === 'request-aborted' ? 'aborted' as const : d.errorCode ? 'error' as const : 'completed' as const, outcome,
      technical: { run_id: runId, request_id: d.requestId, attempt: index + 1, lane: 'batch' as const,
        output_chars: output.length, last_chunk_ms: null,
        parse_state: d.stage === 'parse' ? d.errorCode ? 'invalid' as const : 'valid' as const : 'unknown' as const },
      prompt, output }
  })
  const report = aiReportSchema.parse({ schema_version: 1, submission_id: diagnosticUuid(), consent: true,
    created_at: new Date().toISOString(), executions })
  const json = JSON.stringify(report, null, 2)
  if (new TextEncoder().encode(json).length > AI_REPORT_MAX_BODY_BYTES) throw new Error('report_too_large')
  return json
}
