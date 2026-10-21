import type { ImportBundleOptions } from '../hooks/useImportBundle'
import { canClaimProgressiveImportWorkspace } from '@/src/application/services/progressive-import-ownership.service'
import { completeProgressiveImport, PROGRESSIVE_IMPORT_EVENT, isProgressiveFailureReason, stopProgressiveImport, useProgressiveImportStore, type ProgressiveImportRequest } from '@/src/application/stores/progressive-import.store'

export class ProgressiveImportError extends Error {
  constructor(readonly errorCode: 'PATIENT_HIS_MISMATCH' | 'IMPORT_STALE', message: string) { super(message) }
}

/** One native handoff transaction; manual file selection does not enter here. */
export async function runProgressiveImport(request: ProgressiveImportRequest, file: File,
  importFile: (file: File, options?: ImportBundleOptions) => Promise<void>): Promise<void> {
  // Refuse an obsolete workspace before claiming pending-run ownership, which
  // also scopes automatic AI cancellation. The queued writer checks again.
  if (!canClaimProgressiveImportWorkspace(request)) {
    window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: {
      version: 1, requestId: request.requestId, runId: request.runId, ok: false, errorCode: 'IMPORT_STALE',
    } }))
    return
  }
  const cancellation = new AbortController()
  const applyStop = () => {
    const reason = useProgressiveImportStore.getState().stoppedRuns[request.runId]
    if (reason && reason !== 'failed') cancellation.abort(reason)
  }
  const stoppedRuns = useProgressiveImportStore.getState().stoppedRuns
  useProgressiveImportStore.setState({ initialFailure: request.stage === 'cloud' && stoppedRuns[request.runId] && stoppedRuns[request.runId] !== 'failed'
    ? { runId: request.runId, importId: null, phase: stoppedRuns[request.runId] } : null, pendingRunId: request.runId,
    ...(stoppedRuns[request.runId] === 'failed' ? { stoppedRuns: Object.fromEntries(Object.entries(stoppedRuns).filter(([id]) => id !== request.runId)) } : {}),
  })
  const unsubscribe = useProgressiveImportStore.subscribe(applyStop)
  applyStop()
  const onCancel = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail?.runId === request.runId && detail.requestId === request.requestId) {
      const phase = isProgressiveFailureReason(detail.phase) ? detail.phase : 'cancelled'
      // A timed-out optional visit request must stop its own writer, while a
      // later final snapshot can still replace the unchanged active chart.
      if (phase === 'failed') { cancellation.abort(phase); return }
      stopProgressiveImport(request.runId, phase)
    }
  }
  window.addEventListener('medcloud:progressive-import-cancelled', onCancel)
  try {
    let importId: string | undefined
    await importFile(file, { signal: cancellation.signal, expectedImportId: request.expectedImportId, requireEmpty: request.stage === 'cloud', onCommitted: id => {
      importId = id
      completeProgressiveImport(request, id)
    } })
    if (!importId) throw new Error('Import did not commit')
    window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: {
      version: 1, requestId: request.requestId, runId: request.runId, stage: request.stage, ok: true, importId, stopped: cancellation.signal.aborted,
    } }))
  } catch (error) {
    if (error instanceof ProgressiveImportError && error.errorCode === 'PATIENT_HIS_MISMATCH') stopProgressiveImport(request.runId, 'patient-changed')
    window.dispatchEvent(new CustomEvent(PROGRESSIVE_IMPORT_EVENT, { detail: {
      version: 1, requestId: request.requestId, runId: request.runId, ok: false,
      errorCode: error instanceof ProgressiveImportError ? error.errorCode : 'IMPORT_FAILED',
    } }))
  } finally {
    unsubscribe()
    window.removeEventListener('medcloud:progressive-import-cancelled', onCancel)
    if (useProgressiveImportStore.getState().pendingRunId === request.runId) useProgressiveImportStore.setState({ pendingRunId: null })
  }
}
