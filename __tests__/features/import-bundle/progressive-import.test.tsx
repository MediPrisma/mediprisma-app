import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useImportBundle } from '@/features/import-bundle/hooks/useImportBundle'
import { BundleFileInput } from '@/features/import-bundle/components/BundleFileInput'
import { ProgressiveImportStatus } from '@/features/import-bundle/components/ProgressiveImportStatus'
import { PROGRESSIVE_IMPORT_EVENT, PROGRESSIVE_REQUEST_ATTRIBUTE, PROGRESSIVE_STATUS_MESSAGE, useProgressiveImportStore, completeProgressiveImport, stopProgressiveImport, isProgressiveAutoSummaryBlocked, restoreProgressiveImportStatus } from '@/src/application/stores/progressive-import.store'

let mockImportId: string | null = null
let mockBundle: any
let mockIncoming: any
const mockGenerateId = jest.fn(() => 'new-import')
const mockSave = jest.fn(async (bundle: any, options: any) => { mockBundle = bundle; mockImportId = options.importId })
const mockPrepare = jest.fn(async () => ({ bundle: mockIncoming }))
const mockInvalidateQueries = jest.fn(async () => {})
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => mockInvalidateQueries() }) }))
jest.mock('@/src/application/providers/language.provider', () => ({ useLanguage: () => ({ locale: 'zh-TW' }) }))
jest.mock('@/src/infrastructure/fhir/services/local-bundle.service', () => ({ LocalBundleService: {
  hasData: () => !!mockBundle, load: async () => mockBundle, parse: () => ({}), save: (bundle: any, options: any) => mockSave(bundle, options),
  getActiveImportId: () => mockImportId, isDemoData: () => false, getUserEnteredPatientProfile: () => ({ birthDate: '1980-01-01' }),
} }))
jest.mock('@/features/import-bundle/services/local-import-file.service', () => ({ prepareLocalImportFile: () => mockPrepare() }))
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({ shouldUseLocalBundle: () => true }))
jest.mock('@/src/infrastructure/cache/encrypted-session-cache', () => ({ purgeAiResultCaches: jest.fn(), purgeExpiredAiResultCaches: jest.fn() }))
jest.mock('@/src/shared/utils/id.utils', () => ({ generateId: () => mockGenerateId() }))
const bundle = (id = 'patient-a') => ({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id } }] })
beforeEach(() => {
  jest.clearAllMocks(); mockImportId = 'original-import'; mockBundle = bundle(); mockIncoming = bundle()
  mockGenerateId.mockReturnValue('new-import')
  mockInvalidateQueries.mockImplementation(async () => {})
  mockPrepare.mockImplementation(async () => ({ bundle: mockIncoming, originalFhir: new Blob([JSON.stringify(mockIncoming)]) }))
  useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
})

test('supplement replaces the same patient snapshot and returns a committed import id', async () => {
  const { result } = renderHook(() => useImportBundle())
  const committed = jest.fn()
  await act(() => result.current.importFile(new File(['{}'], 'merged.json'), { expectedImportId: 'original-import', onCommitted: committed }))
  expect(mockSave).toHaveBeenCalledTimes(1)
  expect(mockBundle.entry).toHaveLength(1)
  expect(mockSave.mock.calls[0][1].patientProfile).toEqual({ birthDate: '1980-01-01' })
  expect(mockSave.mock.calls[0][1].originalFhir).toBeInstanceOf(Blob)
  expect(committed).toHaveBeenCalledWith('new-import')
  await act(async () => { await expect(result.current.importFile(new File(['{}'], 'replay.json'), { expectedImportId: 'original-import' })).rejects.toThrow('目前資料已變更') })
  expect(mockSave).toHaveBeenCalledTimes(1)
})

test('a different patient is rejected even if the import token matches', async () => {
  mockIncoming = bundle('patient-b')
  const { result } = renderHook(() => useImportBundle())
  await act(async () => { await expect(result.current.importFile(new File(['{}'], 'wrong.json'), { expectedImportId: 'original-import' })).rejects.toThrow('病人資料不符') })
  expect(mockSave).not.toHaveBeenCalled()
})

test('manual import while the supplement is parsing prevents the later write', async () => {
  let release!: (value: any) => void
  mockPrepare.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const { result } = renderHook(() => useImportBundle())
  let importing!: Promise<void>
  act(() => { importing = result.current.importFile(new File(['{}'], 'late.json'), { expectedImportId: 'original-import' }) })
  await waitFor(() => expect(release).toBeDefined())
  mockImportId = 'manually-replaced'
  release({ bundle: mockIncoming })
  await act(async () => { await expect(importing).rejects.toThrow('目前資料已變更') })
  expect(mockSave).not.toHaveBeenCalled()
})

test('cancelling the native transaction during parsing prevents save and returns a failed receipt', async () => {
  let release!: (value: any) => void
  mockPrepare.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const receipts: CustomEvent[] = []
  const receive = (event: Event) => receipts.push(event as CustomEvent)
  window.addEventListener(PROGRESSIVE_IMPORT_EVENT, receive)
  function Workspace() {
    const { importFile } = useImportBundle()
    return <BundleFileInput importFile={importFile} />
  }
  render(<Workspace />)
  const input = document.querySelector('input')!
  input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId: 'cancel-me', runId: 'run-a', stage: 'hospital', expectedImportId: 'original-import' }))
  fireEvent.change(input, { target: { files: [new File(['{}'], 'delayed.json')] } })
  await waitFor(() => expect(release).toBeDefined())
  window.dispatchEvent(new CustomEvent('medcloud:progressive-import-cancelled', { detail: { requestId: 'cancel-me', runId: 'run-a' } }))
  await act(async () => { release({ bundle: mockIncoming }) })
  await waitFor(() => expect(receipts).toHaveLength(1))
  expect(receipts[0].detail).toMatchObject({ requestId: 'cancel-me', runId: 'run-a', ok: false })
  expect(mockSave).not.toHaveBeenCalled()
  expect(mockImportId).toBe('original-import')
  window.removeEventListener(PROGRESSIVE_IMPORT_EVENT, receive)
})

test('initial cloud import cannot overwrite an already populated workspace', async () => {
  const { result } = renderHook(() => useImportBundle())
  await act(async () => { await expect(result.current.importFile(new File(['{}'], 'cloud.json'), { requireEmpty: true })).rejects.toThrow('目前已載入其他資料') })
  expect(mockSave).not.toHaveBeenCalled()
})

test('a failed optional visit request is aborted without blocking the same run final report snapshot', async () => {
  let release!: (value: any) => void
  mockPrepare.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const receipts: CustomEvent[] = []
  const receive = (event: Event) => receipts.push(event as CustomEvent)
  window.addEventListener(PROGRESSIVE_IMPORT_EVENT, receive)
  function Workspace() { const { importFile } = useImportBundle(); return <><BundleFileInput importFile={importFile} /><ProgressiveImportStatus /></> }
  render(<Workspace />)
  const input = document.querySelector('input')!
  const request = (requestId: string, stage: string) => {
    input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId, runId: 'run-a', stage, expectedImportId: 'original-import' }))
    fireEvent.change(input, { target: { files: [new File(['{}'], `${stage}.json`)] } })
  }
  request('optional-visits', 'hospital-visits')
  await waitFor(() => expect(release).toBeDefined())
  act(() => window.dispatchEvent(new CustomEvent('medcloud:progressive-import-cancelled', {
    detail: { requestId: 'optional-visits', runId: 'run-a', phase: 'failed' },
  })))
  await act(async () => release({ bundle: mockIncoming }))
  await waitFor(() => expect(receipts).toHaveLength(1))
  expect(receipts[0].detail.ok).toBe(false)
  expect(mockSave).not.toHaveBeenCalled()
  request('final-report', 'hospital')
  await waitFor(() => expect(receipts).toHaveLength(2))
  expect(receipts[1].detail).toMatchObject({ requestId: 'final-report', ok: true, importId: 'new-import' })
  expect(mockSave).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('已載入院內門診資料')
  window.removeEventListener(PROGRESSIVE_IMPORT_EVENT, receive)
})

test('an App-detected patient mismatch emits a typed failure and leaves a persistent patient warning', async () => {
  mockIncoming = bundle('patient-b')
  useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'original-import', phase: 'loaded' } })
  const receipts = jest.fn()
  window.addEventListener(PROGRESSIVE_IMPORT_EVENT, receipts)
  function Workspace() { const { importFile } = useImportBundle(); return <><BundleFileInput importFile={importFile} /><ProgressiveImportStatus /></> }
  render(<Workspace />)
  const input = document.querySelector('input')!
  input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId: 'wrong-patient', runId: 'run-a', stage: 'hospital', expectedImportId: 'original-import' }))
  fireEvent.change(input, { target: { files: [new File(['{}'], 'wrong.json')] } })
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('畫面仍為先前病人資料')
  expect(receipts.mock.calls[0][0].detail).toMatchObject({ ok: false, errorCode: 'PATIENT_HIS_MISMATCH' })
  expect(mockSave).not.toHaveBeenCalled()
  expect(isProgressiveAutoSummaryBlocked()).toBe(true)
  window.removeEventListener(PROGRESSIVE_IMPORT_EVENT, receipts)
})

test('a same-run privacy stop aborts a pending import even when the injected cancel event never arrives', async () => {
  let release!: (value: any) => void
  mockPrepare.mockImplementation(() => new Promise(resolve => { release = resolve }))
  function Workspace() { const { importFile } = useImportBundle(); return <BundleFileInput importFile={importFile} /> }
  render(<Workspace />)
  const input = document.querySelector('input')!
  input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId: 'pending', runId: 'run-a', stage: 'hospital', expectedImportId: 'original-import' }))
  fireEvent.change(input, { target: { files: [new File(['{}'], 'pending.json')] } })
  await waitFor(() => expect(release).toBeDefined())
  act(() => stopProgressiveImport('run-a', 'privacy-stale'))
  await act(async () => { release({ bundle: mockIncoming }) })
  expect(mockSave).not.toHaveBeenCalled()
  expect(mockImportId).toBe('original-import')
})

test.each([['privacy-stale', '隱私設定已變更'], ['patient-changed', '來源病人已變更']] as const)(
  'a %s notice is visible during post-commit query refresh before the final receipt', async (phase, text) => {
  let refresh!: () => void
  mockInvalidateQueries.mockImplementation(() => new Promise<void>(resolve => { refresh = resolve }))
  useProgressiveImportStore.setState({ current: { runId: 'run-a', importId: 'original-import', phase: 'reports-pending' } })
  function Workspace() { const { importFile } = useImportBundle(); return <><BundleFileInput importFile={importFile} /><ProgressiveImportStatus /></> }
  render(<Workspace />)
  const input = document.querySelector('input')!
  input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId: 'committed', runId: 'run-a', stage: 'hospital', expectedImportId: 'original-import' }))
  fireEvent.change(input, { target: { files: [new File(['{}'], 'final.json')] } })
  await waitFor(() => expect(refresh).toBeDefined())
  expect(mockImportId).toBe('new-import')
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
    data: { source: 'medcloud2-extension', type: PROGRESSIVE_STATUS_MESSAGE, version: 1, runId: 'run-a', importId: 'original-import', phase } })))
  expect(screen.getByText(new RegExp(text))).toBeVisible()
  expect(useProgressiveImportStore.getState().current).toMatchObject({ importId: 'new-import', phase })
  expect(isProgressiveAutoSummaryBlocked()).toBe(true)
  await act(async () => { refresh() })
  await screen.findByText(new RegExp(text))
  expect(useProgressiveImportStore.getState().current).toMatchObject({ importId: 'new-import', phase })
  expect(isProgressiveAutoSummaryBlocked()).toBe(true)
})

test('a retained visit snapshot explicitly distinguishes failed reports from an ordinary partial import', () => {
  completeProgressiveImport({ version: 1, requestId: 'report-error', runId: 'run-a', stage: 'hospital-reports-failed', expectedImportId: 'original-import', partial: true }, 'original-import')
  render(<ProgressiveImportStatus />)
  expect(screen.getByRole('status')).toHaveTextContent('檢查驗報告未完整載入')
})

test('duplicate failure notifications preserve loaded visits and explicit invalidation reasons', () => {
  completeProgressiveImport({ version: 1, requestId: 'visits', runId: 'run-a', stage: 'hospital-visits', expectedImportId: 'previous' }, 'original-import')
  stopProgressiveImport('run-a', 'failed')
  stopProgressiveImport('run-a', 'failed')
  expect(useProgressiveImportStore.getState().current?.phase).toBe('reports-failed')
  // A late positive receipt must keep the failure while preserving the actual
  // coverage of the snapshot that did commit.
  completeProgressiveImport({ version: 1, requestId: 'late', runId: 'run-a', stage: 'hospital-visits', expectedImportId: 'previous' }, 'original-import')
  expect(useProgressiveImportStore.getState().current?.phase).toBe('reports-failed')
  stopProgressiveImport('run-a', 'patient-changed')
  stopProgressiveImport('run-a', 'failed')
  expect(useProgressiveImportStore.getState().current?.phase).toBe('patient-changed')
  expect(isProgressiveAutoSummaryBlocked()).toBe(true)
})

test.each(['patient-changed', 'privacy-stale'] as const)('late cancellation cannot downgrade a %s warning, including after reload', phase => {
  completeProgressiveImport({ version: 1, requestId: 'safety', runId: 'run-a', stage: 'hospital' }, 'original-import')
  stopProgressiveImport('run-a', phase)
  stopProgressiveImport('run-a', 'cancelled')
  stopProgressiveImport('run-a', 'failed')
  expect(useProgressiveImportStore.getState().current?.phase).toBe(phase)
  const saved = sessionStorage.getItem('mediprisma:progressive-status-v1')!
  useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
  sessionStorage.setItem('mediprisma:progressive-status-v1', saved)
  render(<ProgressiveImportStatus />)
  expect(useProgressiveImportStore.getState().current?.phase).toBe(phase)
  expect(screen.getByText(phase === 'patient-changed' ? /來源病人已變更/ : /隱私設定已變更/)).toBeVisible()
})

test('failure after a complete import does not claim that no hospital records loaded', () => {
  completeProgressiveImport({ version: 1, requestId: 'final', runId: 'run-a', stage: 'hospital', expectedImportId: 'previous' }, 'original-import')
  stopProgressiveImport('run-a', 'failed')
  stopProgressiveImport('run-a', 'failed')
  render(<ProgressiveImportStatus />)
  expect(screen.getByRole('status')).toHaveTextContent('畫面保留先前已載入資料')
})

test('native input acknowledges only its own committed transaction and displays loaded state', async () => {
  const receipt = jest.fn()
  window.addEventListener(PROGRESSIVE_IMPORT_EVENT, receipt)
  const importFile = jest.fn(async (_file, options) => options.onCommitted('new-import'))
  render(<><BundleFileInput importFile={importFile} /><ProgressiveImportStatus /></>)
  const input = document.querySelector('input')!
  input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, requestId: 'request-a', runId: 'run-a', stage: 'hospital', expectedImportId: 'original-import' }))
  fireEvent.change(input, { target: { files: [new File(['{}'], 'merged.json')] } })
  await screen.findByText('已載入院內門診資料')
  expect((receipt.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ requestId: 'request-a', runId: 'run-a', ok: true, importId: 'new-import' })
  expect(input.hasAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE)).toBe(false)
  window.removeEventListener(PROGRESSIVE_IMPORT_EVENT, receipt)
})

test('three native imports show cloud, visits-pending and reports-loaded without duplicating visit resources', async () => {
  mockBundle = null; mockImportId = null
  let revision = 0
  mockGenerateId.mockImplementation(() => `import-${++revision}`)
  function Workspace() {
    const { importFile } = useImportBundle()
    return <><BundleFileInput importFile={importFile} /><ProgressiveImportStatus /></>
  }
  render(<Workspace />)
  const input = document.querySelector('input')!
  const send = async (stage: string, resources: any[], expectedImportId?: string) => {
    mockIncoming = { ...bundle(), entry: [...bundle().entry, ...resources.map(resource => ({ resource }))] }
    input.setAttribute(PROGRESSIVE_REQUEST_ATTRIBUTE, JSON.stringify({ version: 1, runId: 'same-run', requestId: `request-${stage}`, stage, expectedImportId }))
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['{}'], `${stage}.json`)] } }) })
  }
  await send('cloud', [])
  expect(screen.getByRole('status')).toHaveTextContent('雲端資料已載入，院內門診資料擷取中')
  const visits = [
    { resourceType: 'Encounter', id: 'visit-a', subject: { reference: 'Patient/patient-a' } },
    { resourceType: 'DocumentReference', id: 'soap-a', subject: { reference: 'Patient/patient-a' } },
    { resourceType: 'MedicationRequest', id: 'medication-a', subject: { reference: 'Patient/patient-a' } },
    { resourceType: 'ServiceRequest', id: 'order-a', subject: { reference: 'Patient/patient-a' } },
  ]
  await send('hospital-visits', visits, 'import-1')
  expect(screen.getByRole('status')).toHaveTextContent('門診資料已載入，檢查驗報告擷取中')
  expect(mockBundle.entry).toHaveLength(5)
  await send('hospital', [...visits, { resourceType: 'Observation', id: 'result-a', subject: { reference: 'Patient/patient-a' } }], 'import-2')
  expect(screen.getByRole('status')).toHaveTextContent('已載入院內門診資料')
  expect(mockSave).toHaveBeenCalledTimes(3)
  expect(mockBundle.entry).toHaveLength(6)
  expect(new Set(mockBundle.entry.map((entry: any) => `${entry.resource.resourceType}/${entry.resource.id}`)).size).toBe(6)
  expect(mockBundle.entry.filter((entry: any) => entry.resource.resourceType === 'Patient')).toHaveLength(1)
})

test('report failure preserves the loaded visit state and ignores a failure from another run', () => {
  useProgressiveImportStore.setState({ current: { runId: 'same-run', importId: 'original-import', phase: 'reports-pending' } })
  render(<ProgressiveImportStatus />)
  const fail = (runId: string) => act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
    data: { source: 'medcloud2-extension', type: PROGRESSIVE_STATUS_MESSAGE, version: 1, runId, importId: 'original-import', phase: 'failed' } })))
  fail('another-run')
  expect(screen.getByRole('status')).toHaveTextContent('檢查驗報告擷取中')
  fail('same-run')
  expect(screen.getByRole('status')).toHaveTextContent('已載入的門診資料可繼續使用；檢查驗報告未完整載入')
  expect(mockBundle).toEqual(bundle())
})

test.each([
  ['patient-changed', '畫面仍為先前病人資料'], ['privacy-stale', '畫面資料沿用先前設定'], ['cancelled', '擷取已取消'],
] as const)('a %s notification before the first receipt survives commit and blocks automatic summary', (phase, text) => {
  mockBundle = null; mockImportId = null
  render(<ProgressiveImportStatus />)
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
    data: { source: 'medcloud2-extension', type: PROGRESSIVE_STATUS_MESSAGE, version: 1, runId: 'early-stop', importId: '', phase } })))
  act(() => {
    mockImportId = 'accepted-cloud'
    completeProgressiveImport({ version: 1, requestId: 'early-receipt', runId: 'early-stop', stage: 'cloud' }, 'accepted-cloud')
  })
  const banner = screen.getByRole(phase === 'patient-changed' ? 'alert' : 'status')
  expect(banner).toHaveTextContent(text)
  expect(banner).not.toHaveTextContent('可繼續使用')
  expect(isProgressiveAutoSummaryBlocked()).toBe(true)
})

test.each(['failed', 'cancelled', 'patient-changed', 'privacy-stale', 'source-unavailable'] as const)('a terminal %s for the same run is accepted after commit but before the extension receives its new import id', phase => {
  useProgressiveImportStore.setState({ current: { runId: 'same-run', importId: 'original-import', phase: 'loaded' } })
  render(<ProgressiveImportStatus />)
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
    data: { source: 'medcloud2-extension', type: PROGRESSIVE_STATUS_MESSAGE, version: 1, runId: 'same-run', importId: 'older-snapshot', phase } })))
  expect(useProgressiveImportStore.getState().current?.phase).toBe(phase === 'failed' ? 'update-failed' : phase)
  expect(mockImportId).toBe('original-import')
})

test('a late terminal message cannot change the status of a manually replaced chart', () => {
  useProgressiveImportStore.setState({ current: { runId: 'same-run', importId: 'original-import', phase: 'loaded' } })
  render(<ProgressiveImportStatus />)
  mockImportId = 'manual-import'
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
    data: { source: 'medcloud2-extension', type: PROGRESSIVE_STATUS_MESSAGE, version: 1, runId: 'same-run', importId: 'older-snapshot', phase: 'patient-changed' } })))
  expect(useProgressiveImportStore.getState().current?.phase).toBe('loaded')
})

test.each(['patient-changed', 'privacy-stale', 'reports-pending', 'loaded'] as const)('reload restores %s coverage only for its own active chart', phase => {
  useProgressiveImportStore.setState({ current: { runId: 'same-run', importId: 'original-import', phase } })
  const saved = sessionStorage.getItem('mediprisma:progressive-status-v1')!
  useProgressiveImportStore.setState({ current: null, pendingRunId: null, stoppedRuns: {} })
  sessionStorage.setItem('mediprisma:progressive-status-v1', saved)
  restoreProgressiveImportStatus('original-import')
  expect(useProgressiveImportStore.getState().current?.phase).toBe(phase === 'reports-pending' ? 'reports-failed' : phase)
  expect(isProgressiveAutoSummaryBlocked()).toBe(['patient-changed', 'privacy-stale'].includes(phase))
  useProgressiveImportStore.setState({ current: null })
  sessionStorage.setItem('mediprisma:progressive-status-v1', saved)
  restoreProgressiveImportStatus('another-import')
  expect(useProgressiveImportStore.getState().current).toBeNull()
  expect(sessionStorage.getItem('mediprisma:progressive-status-v1')).toBeNull()
})
