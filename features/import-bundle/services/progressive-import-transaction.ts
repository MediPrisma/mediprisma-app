import type { ImportBundleOptions } from '../hooks/useImportBundle'
import { completeProgressiveImport, PROGRESSIVE_IMPORT_EVENT, isProgressiveFailureReason, stopProgressiveImport, useProgressiveImportStore, type ProgressiveImportRequest } from '@/src/application/stores/progressive-import.store'

export class ProgressiveImportError extends Error {
  constructor(readonly errorCode: 'PATIENT_HIS_MISMATCH' | 'IMPORT_STALE', message: string) { super(message) }
}

/** One native handoff transaction; manual file selection does not enter here. */
export async function runProgressiveImport(request: ProgressiveImportRequest, file: File,
  importFile: (file: File, options?: ImportBundleOptions) => Promise<void>): Promise<void> {
  const cancellation = new AbortController()
  const applyStop = () => {
    const reason = useProgressiveImportStore.getState().stoppedRuns[request.runId]
    if (reason) cancellation.abort(reason)
  }
  useProgressiveImportStore.setState({ pendingRunId: request.runId })
  const unsubscribe = useProgressiveImportStore.subscribe(applyStop)
  applyStop()
  const onCancel = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail?.runId === request.runId && detail.requestId === request.requestId) {
      stopProgressiveImport(request.runId, isProgressiveFailureReason(detail.phase) ? detail.phase : 'cancelled')
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
