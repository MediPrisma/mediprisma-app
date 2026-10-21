import { toast } from 'sonner'
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
const mockAccount: { user: { uid: string } | null; loading: boolean } = { user: { uid: 'owner-a' }, loading: false }
jest.mock('@/src/application/providers/auth.provider', () => ({ useAuth: () => mockAccount }))
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { CdssStorageActions } from '@/features/clinical-decision-support/renderers/CdssStorageActions'
import { listCdssHistory, readCdssHistory } from '@/features/clinical-decision-support/telemetry/cdss-history'
import { cancelCdssGatewayRequests, saveCdssSnapshot } from '@/features/clinical-decision-support/telemetry/cdss-gateway'

jest.mock('@/features/clinical-decision-support/telemetry/cdss-gateway', () => ({
  cdssGatewayStatus: () => ({ enabled: true }),
  cancelCdssGatewayRequests: jest.fn(),
  saveCdssSnapshot: jest.fn(),
}))

jest.mock('@/features/clinical-decision-support/telemetry/cdss-history', () => ({
  listCdssHistory: jest.fn(), readCdssHistory: jest.fn(),
}))

test('carry-forward moves into the full-window header without duplicating or unmounting the controller', () => {
  const target = document.createElement('div'); document.body.append(target)
  const onCarryForward = jest.fn(() => 1)
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={onCarryForward} />)
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={onCarryForward} saveTarget={target} />)
  // Viewing and bringing back share one button.
  expect(within(target).getByTestId('cdss-history-records')).toHaveAccessibleName('CDSS 紀錄與帶入')
  expect(screen.getAllByTestId('cdss-history-records')).toHaveLength(1)
  expect(screen.queryByTestId('cdss-carry-forward-latest')).not.toBeInTheDocument()
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={onCarryForward} />)
  expect(target).toBeEmptyDOMElement()
  expect(screen.getByTestId('cdss-history-records')).toBeVisible()
  view.unmount(); target.remove()
})

const input: Parameters<typeof CdssStorageActions>[0]['input'] = {
  patient: { id: 'synthetic', resourceType: 'Patient' }, packId: 'synthetic',
  profile: { id: 'synthetic', facts: {} },
  result: { packId: 'synthetic', packVersion: '1', title: 'Synthetic', summary: 'Synthetic',
    recommendations: [], notEvaluated: [], disclaimer: 'Synthetic' },
  physicianInputs: {}, physicianDecisions: {},
}

test.each([false, true])('moving the save between panel and full-window header preserves the pending request (English=%s)', async english => {
  jest.clearAllMocks()
  let complete!: () => void
  jest.mocked(saveCdssSnapshot).mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const sourceRecords = jest.fn(() => [])
  const target = document.createElement('div')
  document.body.append(target)
  const view = render(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
  try {
    view.rerender(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} saveTarget={target} />)
    const button = within(target).getByTestId('cdss-save-record')
    expect(screen.getAllByTestId('cdss-save-record')).toHaveLength(1)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent(english ? 'Saving…' : '儲存中…')
    fireEvent.click(button)
    view.rerender(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
    expect(target).toBeEmptyDOMElement()
    expect(screen.getByTestId('cdss-save-record')).toBeDisabled()
    expect(cancelCdssGatewayRequests).not.toHaveBeenCalled()
    expect(saveCdssSnapshot).toHaveBeenCalledTimes(1)
    expect(sourceRecords).toHaveBeenCalledTimes(1)
    expect(saveCdssSnapshot).toHaveBeenCalledWith({ ...input, ownerUid: 'owner-a', sourceRecords: [] })
    await act(async () => complete())
    expect(screen.getByTestId('cdss-save-record')).toBeEnabled()
    expect(screen.getByTestId('cdss-save-record')).toHaveAccessibleName(english ? 'Save CDSS record' : '儲存 CDSS 紀錄')
  } finally {
    view.unmount()
    target.remove()
  }
})


test.each([false, true])('guests and restoring sessions cannot save or view history (English=%s)', english => {
  mockAccount.user = null
  const sourceRecords = jest.fn(() => [])
  const view = render(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
  expect(screen.getByTestId('cdss-save-record')).toBeDisabled()
  expect(screen.getByTestId('cdss-save-record')).toHaveAccessibleName(english ? 'Sign in to save' : '請先登入後儲存')
  expect(screen.getByTestId('cdss-history-records')).toBeDisabled()
  mockAccount.loading = true
  view.rerender(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
  expect(screen.getByTestId('cdss-save-record')).toBeDisabled()
  mockAccount.loading = false; mockAccount.user = { uid: 'owner-a' }
  view.rerender(<CdssStorageActions input={input} sourceRecords={sourceRecords} english={english} />)
  expect(screen.getByTestId('cdss-save-record')).toBeEnabled()
  view.unmount()
})

test('logout cancels a pending save and suppresses its old completion notification', async () => {
  mockAccount.user = { uid: 'owner-a' }; mockAccount.loading = false
  jest.clearAllMocks()
  let complete!: () => void
  jest.mocked(saveCdssSnapshot).mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  fireEvent.click(screen.getByTestId('cdss-save-record'))
  mockAccount.user = null
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} />)
  expect(cancelCdssGatewayRequests).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('cdss-save-record')).toBeDisabled()
  await act(async () => complete())
  expect(screen.getByTestId('cdss-save-record')).toBeDisabled()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  view.unmount(); mockAccount.user = { uid: 'owner-a' }
})


test('an established account can save while unrelated profile synchronization is pending', () => {
  mockAccount.user = { uid: 'owner-a' }; mockAccount.loading = true
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  expect(screen.getByTestId('cdss-save-record')).toBeEnabled()
  expect(screen.getByTestId('cdss-history-records')).toBeEnabled()
  view.unmount(); mockAccount.loading = false
})


test.each([
  [false, false], [false, true], [true, false], [true, true],
])('identity failures explain how to correct patient data (English=%s, full-window=%s)', async (english, fullWindow) => {
  jest.clearAllMocks()
  mockAccount.user = { uid: 'owner-a' }
  jest.mocked(saveCdssSnapshot).mockRejectedValueOnce(new Error('cdss_identity_unavailable'))
  const target = document.createElement('div')
  document.body.append(target)
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} saveTarget={fullWindow ? target : null} />)
  try {
    fireEvent.click(screen.getByTestId('cdss-save-record'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      english ? 'Patient identification failed. CDSS record was not saved.' : '病人識別失敗，CDSS 紀錄未儲存。',
      { description: expect.stringContaining(english ? 'partially masked national ID' : '部分遮蔽的身分證字號'), duration: 10000 },
    ))
    const description = jest.mocked(toast.error).mock.calls[0][1]?.description
    expect(description).toEqual(expect.stringContaining(english ? 'at least two recognizable letters' : '至少保留兩個可辨識文字'))
    expect(description).toEqual(expect.stringContaining(english ? 'unrecognized source characters may appear as *' : '來源未辨識字元可保留 *'))
    expect(description).toEqual(expect.stringContaining(english ? 'valid date of birth' : '有效出生日期'))
    expect(screen.getByTestId('cdss-save-record')).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
  } finally { view.unmount(); target.remove() }
})

test.each([false, true])('other save failures retain the general error and do not expose raw error text (English=%s)', async english => {
  jest.clearAllMocks()
  jest.mocked(saveCdssSnapshot).mockRejectedValueOnce(new Error('private server error'))
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} />)
  fireEvent.click(screen.getByTestId('cdss-save-record'))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
    english ? 'Record was not saved. Please try again.' : '紀錄未儲存，請稍後重試。',
  ))
  expect(screen.getByTestId('cdss-save-record')).toBeEnabled()
  view.unmount()
})

test.each([
  [false, false], [false, true], [true, false], [true, true],
])('history list/detail identity failures show recovery guidance (English=%s, detail=%s)', async (english, detail) => {
  const record = { saveId: '11111111-1111-4111-8111-111111111111', documentId: '1', patientId: '2', receivedAt: '2026-10-03T00:00:00Z', packId: 'synthetic', versionId: '1' }
  jest.mocked(listCdssHistory).mockReset()
  jest.mocked(readCdssHistory).mockReset()
  if (detail) {
    jest.mocked(listCdssHistory).mockResolvedValueOnce({ records: [record], hasMore: false })
    jest.mocked(readCdssHistory).mockRejectedValueOnce(new Error('cdss_identity_unavailable'))
  } else {
    jest.mocked(listCdssHistory).mockRejectedValueOnce(new Error('cdss_identity_unavailable'))
  }
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  // Opening reads the newest record of this disease, so a detail failure shows without a second click.
  if (detail) await waitFor(() => expect(readCdssHistory).toHaveBeenCalledTimes(1))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(english ? 'Patient identification failed. CDSS history cannot be retrieved.' : '病人識別失敗，無法取得 CDSS 歷史紀錄。')
  expect(alert).toHaveTextContent(english ? 'partially masked national ID' : '部分遮蔽的身分證字號')
  expect(alert).not.toHaveTextContent('cdss_identity_unavailable')
  view.unmount()
})


test.each([false, true])('history retry clears the failure and retains general errors for other causes (English=%s)', async english => {
  jest.mocked(listCdssHistory).mockReset()
  jest.mocked(listCdssHistory).mockRejectedValueOnce(new Error('private server error'))
    .mockResolvedValueOnce({ records: [], hasMore: false })
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(english ? 'Records unavailable. Please try again.' : '目前無法取得紀錄，請稍後重試。')
  expect(alert).not.toHaveTextContent('private server error')
  fireEvent.click(screen.getByRole('button', { name: english ? 'Retry' : '重試' }))
  await screen.findByText(english ? 'No saved records.' : '尚無儲存紀錄。')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  view.unmount()
})


test.each([[false, false], [false, true], [true, false], [true, true]])('de-identification save rejection explains the export option (English=%s, full-window=%s)', async (english, fullWindow) => {
  jest.clearAllMocks()
  jest.mocked(saveCdssSnapshot).mockRejectedValueOnce(new Error('cdss_patient_deidentified'))
  const target = document.createElement('div'); document.body.append(target)
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} saveTarget={fullWindow ? target : null} />)
  try {
    fireEvent.click(screen.getByTestId('cdss-save-record'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      english ? 'De-identified patient data cannot be saved as a CDSS record.' : '去識別化資料無法儲存 CDSS 紀錄。',
      { description: expect.stringContaining(english ? 'Turn off the de-identification option' : '取消雲抓的「去識別化」選項'), duration: 10000 },
    ))
    expect(toast.success).not.toHaveBeenCalled()
  } finally { view.unmount(); target.remove() }
})

test.each([false, true])('history de-identification rejection explains how to reimport (English=%s)', async english => {
  jest.mocked(listCdssHistory).mockReset().mockRejectedValueOnce(new Error('cdss_patient_deidentified'))
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} english={english} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(english ? 'CDSS history cannot be retrieved for de-identified patient data.' : '去識別化資料無法查詢 CDSS 歷史紀錄。')
  expect(alert).toHaveTextContent(english ? 'Turn off the de-identification option' : '取消雲抓的「去識別化」選項')
  view.unmount()
})


test('switching the same patient to a de-identified source clears visible history', async () => {
  jest.mocked(listCdssHistory).mockReset().mockResolvedValueOnce({ records: [{ saveId: '11111111-1111-4111-8111-111111111111', documentId: '1', patientId: '2', receivedAt: '2026-10-03T00:00:00Z', packId: 'synthetic', versionId: '1' }], hasMore: false })
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  await screen.findByRole('button', { name: /synthetic/ })
  view.rerender(<CdssStorageActions input={{ ...input, patient: { ...input.patient, deidentified: true } }} sourceRecords={() => []} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /synthetic/ })).not.toBeInTheDocument()
  view.unmount()
})


test('switching the same patient to de-identified cancels pending save notifications', async () => {
  jest.clearAllMocks()
  let complete!: () => void
  jest.mocked(saveCdssSnapshot).mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  fireEvent.click(screen.getByTestId('cdss-save-record'))
  view.rerender(<CdssStorageActions input={{ ...input, patient: { ...input.patient, deidentified: true } }} sourceRecords={() => []} />)
  expect(cancelCdssGatewayRequests).toHaveBeenCalledTimes(1)
  await act(async () => complete())
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  view.unmount()
})

test('switching the same patient to de-identified cancels a pending history lookup', async () => {
  let signal!: AbortSignal
  let complete!: (result: Awaited<ReturnType<typeof listCdssHistory>>) => void
  jest.mocked(listCdssHistory).mockImplementation((_patient, requestSignal) => {
    signal = requestSignal
    return new Promise(resolve => { complete = resolve })
  })
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} />)
  fireEvent.click(screen.getByTestId('cdss-history-records'))
  view.rerender(<CdssStorageActions input={{ ...input, patient: { ...input.patient, deidentified: true } }} sourceRecords={() => []} />)
  expect(signal.aborted).toBe(true)
  await act(async () => complete({ records: [], hasMore: false }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('尚無儲存紀錄。')).not.toBeInTheDocument()
  view.unmount()
})

test('三區塊 does not offer saving or records, and switching to it neither cancels a pending save nor unmounts the controller', async () => {
  mockAccount.user = { uid: 'owner-a' }; mockAccount.loading = false
  jest.clearAllMocks()
  let complete!: () => void
  jest.mocked(saveCdssSnapshot).mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const view = render(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={() => 1} />)
  fireEvent.click(screen.getByTestId('cdss-save-record'))
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={() => 1} offered={false} />)
  expect(screen.queryByTestId('cdss-save-record')).not.toBeInTheDocument()
  expect(screen.queryByTestId('cdss-history-records')).not.toBeInTheDocument()
  expect(cancelCdssGatewayRequests).not.toHaveBeenCalled()
  await act(async () => complete())
  expect(toast.success).toHaveBeenCalledWith('CDSS 紀錄已儲存。')
  view.rerender(<CdssStorageActions input={input} sourceRecords={() => []} onCarryForward={() => 1} />)
  expect(screen.getByTestId('cdss-history-records')).toBeVisible()
  view.unmount()
})
