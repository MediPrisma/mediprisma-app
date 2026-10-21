import { create } from 'zustand'
import { useMedcloudLaunchStore, type MedcloudSummaryRequest } from '../launch/medcloud-launch.store'

// Shared transaction protocol for the importer and launch coordinator.

export const PROGRESSIVE_IMPORT_EVENT = 'mediprisma:progressive-import-settled'
export const PROGRESSIVE_STATUS_MESSAGE = 'medcloud:outpatient-status'
export const PROGRESSIVE_REQUEST_ATTRIBUTE = 'data-medcloud-progressive-request'
export type ProgressiveFailureReason = 'failed' | 'cancelled' | 'patient-changed' | 'privacy-stale' | 'source-unavailable'
export function isProgressiveFailureReason(value: unknown): value is ProgressiveFailureReason {
  return ['failed', 'cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'].includes(value as string)
}

export interface ProgressiveImportRequest {
  version: 1
  requestId: string
  runId: string
  stage: 'cloud' | 'hospital-visits' | 'hospital' | 'hospital-reports-failed' | 'hospital-empty' | 'cloud-only'
  expectedImportId?: string
  partial?: boolean
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/.test(value)

export function parseProgressiveImportRequest(raw: string | null): ProgressiveImportRequest | null {
  if (!raw || raw.length > 1024) return null
  try {
    const value = JSON.parse(raw)
    if (value?.version !== 1 || !validId(value.requestId) || !validId(value.runId)
      || !['cloud', 'hospital-visits', 'hospital', 'hospital-reports-failed', 'hospital-empty', 'cloud-only'].includes(value.stage)
      || (value.stage !== 'cloud' && !validId(value.expectedImportId))
      || (value.partial !== undefined && typeof value.partial !== 'boolean')) return null
    return value
  } catch { return null }
}

export interface ProgressiveImportState {
  runId: string
  importId: string
  phase: 'waiting' | 'reports-pending' | 'reports-pending-partial' | 'reports-failed' | 'update-failed' | 'loaded' | 'empty' | 'partial' | ProgressiveFailureReason
}

export const useProgressiveImportStore = create<{
  current: ProgressiveImportState | null
  pendingRunId: string | null
  stoppedRuns: Record<string, ProgressiveFailureReason>
}>(() => ({ current: null, pendingRunId: null, stoppedRuns: {} }))

function failedPhase(phase: ProgressiveImportState['phase']): ProgressiveImportState['phase'] {
  if (['reports-pending', 'reports-pending-partial', 'reports-failed'].includes(phase)) return 'reports-failed'
  if (['loaded', 'partial', 'update-failed'].includes(phase)) return 'update-failed'
  return 'failed'
}

export function stopProgressiveImport(runId: string, phase: ProgressiveFailureReason): void {
  if (!validId(runId)) return
  const { current, stoppedRuns } = useProgressiveImportStore.getState()
  // Repeated cleanup notifications must neither erase known coverage nor
  // downgrade an identity/privacy/cancellation stop to a generic failure.
  const reason = phase === 'failed' ? stoppedRuns[runId] ?? phase : phase
  useProgressiveImportStore.setState({
    stoppedRuns: Object.fromEntries([...Object.entries(stoppedRuns).filter(([id]) => id !== runId), [runId, reason]].slice(-100)),
    ...(current?.runId === runId ? { current: { ...current,
      phase: reason === 'failed' ? failedPhase(current.phase) : reason,
    } } : {}),
  })
  const queued = useMedcloudLaunchStore.getState().pendingSummary
  if (reason !== 'failed' && queued?.progressiveRunId === runId) {
    useMedcloudLaunchStore.setState({ pendingSummary: null })
  }
}

/** Check again at the consumer, after data/auth readiness and its timer. */
export function isProgressiveSummaryRequestCurrent(request: MedcloudSummaryRequest, activeImportId: string | null): boolean {
  if (!request.progressiveRunId) return true
  const { current, pendingRunId, stoppedRuns } = useProgressiveImportStore.getState()
  const stopped = stoppedRuns[request.progressiveRunId]
  return request.progressiveImportId === activeImportId
    && (current?.runId === request.progressiveRunId || pendingRunId === request.progressiveRunId)
    && (!stopped || stopped === 'failed')
}

export function isProgressiveAutoSummaryBlocked(): boolean {
  const { current, pendingRunId, stoppedRuns } = useProgressiveImportStore.getState()
  return (!!pendingRunId && !!stoppedRuns[pendingRunId])
    || !!current && ['cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'].includes(current.phase)
}

export function completeProgressiveImport(request: ProgressiveImportRequest, importId: string): void {
  const stopped = useProgressiveImportStore.getState().stoppedRuns[request.runId]
  const normalPhase = request.stage === 'cloud' ? 'waiting'
    : request.stage === 'hospital-visits' ? request.partial ? 'reports-pending-partial' : 'reports-pending'
    : request.stage === 'cloud-only' ? 'failed' : request.stage === 'hospital-empty' ? 'empty'
    : request.stage === 'hospital-reports-failed' ? 'reports-failed' : request.partial ? 'partial' : 'loaded'
  useProgressiveImportStore.setState({ current: {
    runId: request.runId, importId,
    phase: stopped === 'failed' ? failedPhase(normalPhase) : stopped ?? normalPhase,
  } })
}
