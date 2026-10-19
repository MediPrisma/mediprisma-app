'use client'

// Application boundary for the explicitly consented summary report UI.
export { configuredEndpoint, isCollectorSite } from '@/src/infrastructure/telemetry/collector'
export { captureCollectorAuth } from '@/src/infrastructure/telemetry/collector-auth'

/** Include auth readiness/token acquisition in the report's deadline too. */
export async function awaitReportStep<T>(step: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('report_cancelled'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([step, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
