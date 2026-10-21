import { create } from 'zustand'
import type { AiExecutionDiagnosticRecord } from '@/src/shared/utils/ai-execution-diagnostics'

export type {
  AiExecutionDiagnosticRecord,
  AiExecutionStatus,
} from '@/src/shared/utils/ai-execution-diagnostics'

interface AiExecutionDiagnosticsState {
  records: AiExecutionDiagnosticRecord[]
  summaryRuns: Record<string, string>
  summaryScope: string | null
  setSummaryScope: (scope: string) => void
  beginSummaryRun: (operationKey: string, runId: string) => void
  addRecord: (record: AiExecutionDiagnosticRecord) => void
  markLatestOperationFeatureError: (
    operationKey: string,
    feature: string,
    errorMessage: string,
  ) => void
  clearOperation: (operationKey: string) => void
  clearOperationFeature: (operationKey: string, feature: string) => void
  clearFeature: (feature: string) => void
  clearAll: () => void
}

// Diagnostics may contain the complete clinical prompt and model output. Keep
// complete summary runs in volatile tab memory; this store deliberately
// has no persistence middleware and never writes diagnostics to web storage.
const MAX_SESSION_RECORDS = 2

export function retainDiagnostics(records: AiExecutionDiagnosticRecord[]) {
  // Evict whole runs, never individual retries. Unrelated AI requests cannot
  // overwrite a failed summary's history. Patient/page cleanup still applies.
  const runs = [...new Set([...records].reverse().map(r => r.technical?.run_id).filter(Boolean))].slice(0, 3)
  const other = records.filter(r => !r.technical).slice(-MAX_SESSION_RECORDS)
  return records.filter(r => r.technical ? runs.includes(r.technical.run_id) : other.includes(r))
}

/**
 * Session-only AI diagnostics. Clinical inputs are deliberately never
 * persisted: the user must explicitly download them from a visible control.
 */
export const useAiExecutionDiagnosticsStore = create<AiExecutionDiagnosticsState>()((set) => ({
  records: [],
  summaryRuns: {}, summaryScope: null,
  setSummaryScope: (scope) => set(state => state.summaryScope === scope ? state : { summaryScope: scope, records: [], summaryRuns: {} }),
  beginSummaryRun: (operationKey, runId) => set(state => ({
    summaryRuns: { ...state.summaryRuns, [operationKey]: runId },
    records: state.records.filter(r => r.operationKey !== operationKey || !r.technical || r.technical.run_id === runId),
  })),
  addRecord: (record) => set((state) => {
    if (record.technical && (!record.operationKey || state.summaryRuns[record.operationKey] !== record.technical.run_id)) return state
    return { records: retainDiagnostics([...state.records, record]) }
  }),
  markLatestOperationFeatureError: (operationKey, feature, errorMessage) => set((state) => {
    let index = -1
    for (let candidate = state.records.length - 1; candidate >= 0; candidate -= 1) {
      const record = state.records[candidate]
      if (record.operationKey === operationKey && record.feature === feature) {
        index = candidate
        break
      }
    }
    if (index < 0) return state
    const records = [...state.records]
    records[index] = {
      ...records[index],
      hasError: true,
      errorMessage,
      status: 'error',
    }
    return { records }
  }),
  clearOperation: (operationKey) => set((state) => ({
    records: state.records.filter((record) => record.operationKey !== operationKey),
    summaryRuns: Object.fromEntries(Object.entries(state.summaryRuns).filter(([key]) => key !== operationKey)),
  })),
  clearOperationFeature: (operationKey, feature) => set((state) => ({
    summaryRuns: feature === 'medical-summary' ? Object.fromEntries(Object.entries(state.summaryRuns).filter(([key]) => key !== operationKey)) : state.summaryRuns,
    records: state.records.filter((record) => (
      record.operationKey !== operationKey || record.feature !== feature
    )),
  })),
  clearFeature: (feature) => set((state) => ({
    records: state.records.filter((record) => record.feature !== feature),
    summaryRuns: feature === 'medical-summary' ? {} : state.summaryRuns,
  })),
  clearAll: () => set({ records: [], summaryRuns: {}, summaryScope: null }),
}))

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => useAiExecutionDiagnosticsStore.getState().clearAll())
