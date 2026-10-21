jest.mock('@/features/clinical-decision-support/telemetry/fhir-firebase-auth', () => ({ captureFhirFirebaseAuth: async () => ({ uid: 'owner-a', isCurrent: () => true, getToken: async () => 'synthetic-token' }) }))
const mockAccount: { user: { uid: string } | null; loading: boolean } = { user: { uid: 'owner-a' }, loading: false }
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => mockAccount }))
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { cdssPatientIdentity } from '@/features/clinical-decision-support/telemetry/patient-identity'
import { readCdssHistory } from '@/features/clinical-decision-support/telemetry/cdss-history'
import { CdssStorageActions } from '@/features/clinical-decision-support/renderers/CdssStorageActions'
import { cdssGatewaySaveSchema } from '@/src/shared/contracts/cdss-gateway-event'
import { storedTimestampForDisplay } from '@/src/shared/contracts/cdss-stored-save-v2'

const patient = { id: 'review-synthetic', resourceType: 'Patient' as const, name: [{ text: '測試病人' }],
  birthDate: '1970-01-01', identifier: [{ system: 'https://synthetic.invalid/national-id', value: 'A123XXXXXX' }] }
const saveId = '11111111-1111-4111-8111-111111111111'
const index = { saveId, documentId: '1', patientId: '2', receivedAt: '2026-10-03T00:00:00Z', packId: 'synthetic', versionId: '1' }
const result = { packId: 'synthetic', packVersion: '1', title: 'Synthetic assessment', summary: 'Synthetic summary',
  recommendations: [{ moduleName: 'Synthetic module', title: 'SAVED_DECISION_TITLE', status: 'needs-data',
    recommendation: 'SAVED_PRIMARY_RECOMMENDATION', rationale: 'SAVED_RATIONALE',
    safetyBoundary: 'SAVED_SAFETY_BOUNDARY', missingData: ['SAVED_MISSING_DATA'],
    patientEvidence: [{ label: 'SAVED_EVIDENCE', value: 'SAVED_EVIDENCE_VALUE' }], nextActions: ['SAVED_NEXT_ACTION'] }] }
const response = (data: unknown) => ({ status: 200, body: new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close()
} }) }) as Response
async function detail(patch = {}) {
  const identity = await cdssPatientIdentity(patient)
  const save = { ...identity, schema_version: 2, save_id: saveId, saved_at: index.receivedAt, site: 'vghtpe',
    patient_session_id: saveId, pack_id: 'synthetic', app_version: '0.0.0', build_revision: 'unknown',
    profile: { facts: { synthetic: true } }, result, physician_inputs: {}, physician_decisions: {}, source_records: [], events: [], ...patch }
  return { ...index, savedAt: save.saved_at, save }
}
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
  if (!AbortSignal.timeout) Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal })
  if (!AbortSignal.any) Object.defineProperty(AbortSignal, 'any', { configurable: true, value: (signals: AbortSignal[]) => signals[0] })
  process.env.NEXT_PUBLIC_CDSS_ADMISSION = 'intranet-pilot'
  window.history.replaceState({}, '', '/?site=vghtpe')
  jest.mocked(fetch).mockReset()
})
afterEach(() => { delete process.env.NEXT_PUBLIC_CDSS_ADMISSION })

const currentInput: Parameters<typeof CdssStorageActions>[0]['input'] = { patient, packId: 'synthetic',
  profile: { id: patient.id, facts: {} }, result: { packId: 'synthetic', packVersion: '1', title: 'Current', summary: '',
    recommendations: [], notEvaluated: [], disclaimer: '' }, physicianInputs: {}, physicianDecisions: {} }

test('last record is read and applied only after explicit confirmation; it does not save or mutate the snapshot', async () => {
  const stored = await detail()
  const original = JSON.stringify(stored)
  const onCarryForward = jest.fn(() => 2)
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={onCarryForward} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByTestId('cdss-carry-forward-review'))
  expect(onCarryForward).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: /人工輸入/ }))
  fireEvent.click(screen.getByTestId('cdss-carry-forward-confirm'))
  await waitFor(() => expect(onCarryForward).toHaveBeenCalledWith(stored, { inputs: false, decisions: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText(/帶入來源/)).toBeVisible()
  expect(JSON.stringify(stored)).toBe(original)
  expect(jest.mocked(fetch).mock.calls).toHaveLength(2)
})

test('old rule versions stay viewable but cannot be carried forward', async () => {
  const stored = await detail({ result: { ...result, packVersion: 'old' } })
  const apply = jest.fn(() => 1)
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={apply} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  expect(await screen.findByText(/疾病或指引版本不同/)).toBeVisible()
  expect(screen.queryByTestId('cdss-carry-forward-review')).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
})

test('closing confirmation or changing patients never applies a record', async () => {
  const stored = await detail()
  const apply = jest.fn(() => 1)
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  const view = render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={apply} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByTestId('cdss-carry-forward-review'))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByTestId('cdss-carry-forward-confirm')).not.toBeInTheDocument()
  view.rerender(<CdssStorageActions input={{ ...currentInput, patient: { ...patient, id: 'other' } }} sourceRecords={() => []} onCarryForward={apply} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
})

test('last record does not choose a different disease', async () => {
  jest.mocked(fetch).mockResolvedValue(response({ records: [{ ...index, packId: 'other' }], hasMore: false }))
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={() => 1} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  expect(await screen.findByText(/最近 10 筆儲存中沒有此疾病/)).toBeVisible()
  expect(jest.mocked(fetch).mock.calls).toHaveLength(1)
})

test('a rules change clears a selected confirmation without disconnecting authorization', async () => {
  const stored = await detail()
  const apply = jest.fn(() => 1)
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  const view = render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={apply} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByTestId('cdss-carry-forward-review'))
  view.rerender(<CdssStorageActions input={{ ...currentInput, result: { ...currentInput.result, packVersion: '2' } }} sourceRecords={() => []} onCarryForward={apply} />)
  expect(screen.queryByTestId('cdss-carry-forward-confirm')).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
})

test.each([
  ['legacy UUID', { patient_session_id: 'ABCDEFAB-1234-0000-0000-ABCDEFABCDEF' }],
  ['compact time offset', { saved_at: '2026-10-03T12:34+0800' }],
  ['minute precision UTC', { saved_at: '2026-10-03T12:34Z' }],
  ['legacy event times', { events: [
    { kind: 'interaction', pack_id: 'synthetic', action: 'disease_selected', occurred_at: '2026-10-03T12:34+0800' },
    { kind: 'assessment', pack_id: 'synthetic', occurred_at: '2026-10-03T12:34Z',
      changes: [{ field_id: 'synthetic', value: true, measured_on: '2024-02-29' }] },
  ] }],
])('server-supported v2 history remains readable: %s', async (_label, patch) => {
  const stored = await detail(patch)
  jest.mocked(fetch).mockResolvedValueOnce(response(stored))
  await expect(readCdssHistory(patient, saveId, new AbortController().signal)).resolves.toEqual(stored)
})

test.each([
  ['unknown version', { schema_version: 3 }],
  ['malformed UUID', { patient_session_id: 'not-a-uuid' }],
  ['invalid timestamp', { saved_at: '2026-02-30T12:34+0800' }],
  ['invalid event date', { events: [{ kind: 'assessment', pack_id: 'synthetic', occurred_at: index.receivedAt,
    changes: [{ field_id: 'synthetic', value: true, measured_on: '2026-02-30' }] }] }],
  ['missing clinical facts', { profile: { facts: {} } }],
  ['mismatched result pack', { result: { ...result, packId: 'other' } }],
  ['unexpected saved field', { future_field: true }],
])('unsupported or corrupt snapshots remain unavailable: %s', async (_label, patch) => {
  jest.mocked(fetch).mockResolvedValueOnce(response(await detail(patch)))
  await expect(readCdssHistory(patient, saveId, new AbortController().signal)).rejects.toThrow()
})

test('historical compatibility does not loosen the current writer', async () => {
  expect(cdssGatewaySaveSchema.safeParse((await detail()).save).success).toBe(true)
  for (const patch of [{ patient_session_id: 'ABCDEFAB-1234-0000-0000-ABCDEFABCDEF' }, { saved_at: '2026-10-03T12:34+0800' }]) {
    expect(cdssGatewaySaveSchema.safeParse((await detail(patch)).save).success).toBe(false)
  }
})

test('deep and oversized snapshots fail within the frozen reader bounds', async () => {
  let nested: unknown = true
  for (let index = 0; index < 65; index++) nested = { nested }
  for (const patch of [{ physician_inputs: { nested } }, { physician_inputs: { nodes: Array(100_001).fill(null) } },
    { physician_inputs: { note: 'x'.repeat(4 * 1024 * 1024) } }]) {
    jest.mocked(fetch).mockResolvedValueOnce(response(await detail(patch)))
    await expect(readCdssHistory(patient, saveId, new AbortController().signal)).rejects.toThrow('cdss_history_unavailable')
  }
})

test.each([false, true])('saved detail presents the full stored recommendation and normalizes only display time (english=%s)', async english => {
  const stored = await detail({ saved_at: '2026-10-03T12:34+0800' })
  const originalSnapshot = JSON.stringify(stored)
  const sourceRecords = jest.fn(() => [])
  const input: Parameters<typeof CdssStorageActions>[0]['input'] = {
    patient, packId: 'synthetic', profile: { id: patient.id, facts: {} },
    result: { packId: 'synthetic', packVersion: '2', title: 'CURRENT_ASSESSMENT_TITLE', summary: 'CURRENT_ASSESSMENT_SUMMARY',
      recommendations: [], notEvaluated: [], disclaimer: 'Synthetic current assessment' },
    physicianInputs: { note: 'CURRENT_INPUT' }, physicianDecisions: {},
  }
  const originalInput = JSON.stringify(input)
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  render(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByRole('button', { name: /synthetic/ }))
  await waitFor(() => expect(screen.getByText('SAVED_NEXT_ACTION')).toBeInTheDocument())
  // Each prompt opens in place; its rationale and evidence sit behind the row.
  fireEvent.click(screen.getByRole('heading', { level: 4, name: 'SAVED_DECISION_TITLE' }))
  for (const value of ['Synthetic module', 'SAVED_PRIMARY_RECOMMENDATION', 'SAVED_DECISION_TITLE', english ? 'Needs data' : '需補資料',
    'SAVED_RATIONALE', 'SAVED_SAFETY_BOUNDARY', 'SAVED_MISSING_DATA', 'SAVED_EVIDENCE', 'SAVED_EVIDENCE_VALUE']) {
    expect(within(screen.getByTestId('cdss-history-recommendation')).getByText(value)).toBeVisible()
  }
  const displayedTime = new Date(storedTimestampForDisplay(stored.savedAt)).toLocaleString(english ? 'en' : 'zh-TW')
  // ICU can emit thin/non-breaking spaces. Compare the exact localized text
  // without Testing Library replacing those spaces only on the DOM side.
  expect(screen.getByText(`${english ? 'Saved at: ' : '儲存時間：'}${displayedTime}`, { normalizer: value => value })).toBeVisible()
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
  expect(screen.queryByText('CURRENT_ASSESSMENT_TITLE')).not.toBeInTheDocument()
  expect(screen.queryByText('CURRENT_INPUT')).not.toBeInTheDocument()
  expect(JSON.stringify(stored)).toBe(originalSnapshot)
  expect(JSON.stringify(input)).toBe(originalInput)
  expect(sourceRecords).not.toHaveBeenCalled()
  expect(jest.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
    // Opening reads the newest record of this disease; choosing it again reads it again.
    'http://127.0.0.1:8098/cdss/v1/history', 'http://127.0.0.1:8098/cdss/v1/history/read', 'http://127.0.0.1:8098/cdss/v1/history/read',
  ])
})


test('switching accounts clears open history and aborts an in-flight detail read', async () => {
  mockAccount.user = { uid: 'owner-a' }
  const stored = await detail()
  let detailSignal: AbortSignal | undefined
  let finish!: (value: Response) => void
  jest.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/read')) {
      detailSignal = init?.signal as AbortSignal
      return new Promise<Response>(resolve => { finish = resolve })
    }
    return response({ records: [index], hasMore: false })
  })
  const input: Parameters<typeof CdssStorageActions>[0]['input'] = { patient, packId: 'synthetic',
    profile: { id: patient.id, facts: {} }, result: { packId: 'synthetic', packVersion: '1', title: 'Current', summary: '',
      recommendations: [], notEvaluated: [], disclaimer: '' }, physicianInputs: {}, physicianDecisions: {} }
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByRole('button', { name: /synthetic/ }))
  await waitFor(() => expect(detailSignal).toBeDefined())
  mockAccount.user = { uid: 'owner-b' }
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} />)
  expect(detailSignal?.aborted).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  finish(response(stored))
  await waitFor(() => expect(screen.queryByText('SAVED_NEXT_ACTION')).not.toBeInTheDocument())
  expect(screen.getByTestId('cdss-history-records')).toBeEnabled()
  view.unmount(); mockAccount.user = { uid: 'owner-a' }
})

test('opening shows the newest record of this disease beside the list, and compares each prompt with today', async () => {
  const stored = await detail({ result: { ...result, recommendations: [
    { ...result.recommendations[0], id: 'changed', title: 'CHANGED_PROMPT' },
    { ...result.recommendations[0], id: 'same', title: 'SAME_PROMPT', status: 'review' },
    { ...result.recommendations[0], id: 'gone', title: 'GONE_PROMPT', status: 'actionable', priority: 'high' },
  ] } })
  const other = { ...index, saveId: '22222222-2222-4222-8222-222222222222', packId: 'other', receivedAt: '2026-10-04T00:00:00Z' }
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index, other], hasMore: false }))
  const today = { ...currentInput, result: { ...currentInput.result, recommendations: [
    { id: 'changed', status: 'actionable' }, { id: 'same', status: 'review' },
  ] } } as unknown as typeof currentInput
  render(<CdssStorageActions input={today} sourceRecords={() => []} onCarryForward={() => 1}
    packLabel={packId => ({ synthetic: '合成疾病', other: '其他疾病' })[packId]} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  const rows = await screen.findAllByTestId('cdss-history-recommendation')
  expect(rows.map(row => within(row).getByRole('heading', { level: 4 }).textContent)).toEqual(['CHANGED_PROMPT', 'SAME_PROMPT', 'GONE_PROMPT'])
  expect(within(rows[0]).getByText('今天：建議處理')).toBeVisible()
  expect(within(rows[1]).getByText('相同')).toBeVisible()
  expect(within(rows[2]).getByText('今天未出現')).toBeVisible()
  expect(within(rows[2]).getByText('優先')).toBeVisible()
  expect(screen.getByTestId(`cdss-history-row-${index.saveId}`)).toHaveAttribute('aria-current', 'true')
  expect(screen.getByTestId(`cdss-history-row-${other.saveId}`)).toHaveTextContent('其他疾病・僅供調閱')
  fireEvent.click(screen.getByRole('button', { name: '合成疾病', pressed: false }))
  expect(screen.queryByTestId(`cdss-history-row-${other.saveId}`)).not.toBeInTheDocument()
  expect(screen.getByTestId('cdss-carry-forward-review')).toHaveTextContent('帶入這筆…')
})

test('deleting asks first; only a confirmed delete reaches the server, and the record leaves the list', async () => {
  const stored = await detail()
  const calls: string[] = []
  jest.mocked(fetch).mockImplementation(async (url, init) => {
    const path = String(url)
    calls.push(path.replace('http://127.0.0.1:8098', ''))
    if (path.endsWith('/delete')) {
      expect(JSON.parse(String(init?.body)).save_id).toBe(saveId)
      return response({ status: 'deleted', save_id: saveId })
    }
    return response(path.endsWith('/read') ? stored : { records: [index], hasMore: false })
  })
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={() => 1} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByTestId('cdss-history-delete'))
  const confirm = await screen.findByRole('alertdialog', { name: '確定要刪除這筆紀錄嗎？' })
  fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(calls).not.toContain('/cdss/v1/history/delete')
  fireEvent.click(screen.getByTestId('cdss-history-delete'))
  fireEvent.click(await screen.findByTestId('cdss-history-delete-confirm-button'))
  await waitFor(() => expect(screen.queryByTestId(`cdss-history-row-${saveId}`)).not.toBeInTheDocument())
  expect(calls.filter(path => path === '/cdss/v1/history/delete')).toHaveLength(1)
  expect(screen.getByText('尚無儲存紀錄。')).toBeVisible()
})

test('the carry confirmation counts every saved decision', async () => {
  const decision = { decision: 'deferred', reasons: ['synthetic'], recordedAt: '2026-10-03T00:00:00Z', packVersion: '1' }
  const stored = await detail({ physician_decisions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`m${i}`, decision])) })
  jest.mocked(fetch).mockImplementation(async url => response(String(url).endsWith('/read') ? stored : { records: [index], hasMore: false }))
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={() => 1} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByTestId('cdss-carry-forward-review'))
  expect(screen.getByText('9 項決策')).toBeVisible()
})

test('deleting the last record of a filtered disease falls back to all records', async () => {
  const stored = await detail()
  const other = { ...index, saveId: '22222222-2222-4222-8222-222222222222', packId: 'other', receivedAt: '2026-10-02T00:00:00Z' }
  jest.mocked(fetch).mockImplementation(async url => {
    const path = String(url)
    if (path.endsWith('/delete')) return response({ status: 'deleted', save_id: saveId })
    return response(path.endsWith('/read') ? stored : { records: [index, other], hasMore: false })
  })
  render(<CdssStorageActions input={currentInput} sourceRecords={() => []} onCarryForward={() => 1}
    packLabel={packId => ({ synthetic: '合成疾病', other: '其他疾病' })[packId]} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  fireEvent.click(await screen.findByRole('button', { name: '合成疾病', pressed: false }))
  expect(screen.queryByTestId(`cdss-history-row-${other.saveId}`)).not.toBeInTheDocument()
  fireEvent.click(await screen.findByTestId('cdss-history-delete'))
  fireEvent.click(await screen.findByTestId('cdss-history-delete-confirm-button'))
  expect(await screen.findByTestId(`cdss-history-row-${other.saveId}`)).toBeVisible()
})
