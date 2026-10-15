import { useMedcloudHfDryRun } from '@/src/application/hooks/hf-risk/use-medcloud-hf-dry-run.hook'
import { useState } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { detectHfIntranet } from '@/src/infrastructure/hf-risk/intranet-discovery'
import { HfSamdCalculator } from '@/features/medical-calculator/prognosis/HfSamdCalculator'
import { HfMedcloudDryRun } from '@/features/medical-calculator/prognosis/HfMedcloudDryRun'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { shouldUseLocalBundle } from '@/src/infrastructure/fhir/client/fhir-client.service'
import { captureHfCallerAuth } from '@/src/infrastructure/hf-risk/caller-auth'
import { requestHfDryRun, requestHfPrediction } from '@/src/infrastructure/hf-risk/dry-run-client'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import type { HfDryRunResult, HfInput } from '@/src/core/hf-risk/contract'
import type { HfPredictionResult } from '@/src/core/hf-risk/prediction-result'

jest.mock('@/src/infrastructure/hf-risk/intranet-discovery', () => ({ detectHfIntranet: jest.fn() }))
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
jest.mock('@/src/infrastructure/fhir/services/local-bundle.service', () => ({ LocalBundleService: { getActiveImportId: jest.fn(), load: jest.fn() } }))
jest.mock('@/src/infrastructure/fhir/client/fhir-client.service', () => ({ shouldUseLocalBundle: jest.fn() }))
jest.mock('@/src/infrastructure/hf-risk/caller-auth', () => ({ captureHfCallerAuth: jest.fn() }))
jest.mock('@/src/infrastructure/hf-risk/dry-run-client', () => ({
  ...jest.requireActual('@/src/infrastructure/hf-risk/dry-run-client'), requestHfDryRun: jest.fn(), requestHfPrediction: jest.fn(),
}))
const accepted: HfDryRunResult = { verdict: 'accepted', issues: [{ severity: 'information', code: 'informational', text: 'Synthetic input checked' }] }
const predicted = { schemaVersion: 1 as const, verdict: 'scored' as const, claim: 'P1_CD_mortality_1m' as const, indexDate: '2026-01-01', probability: 0.1234, tier: 'intermediate' as const, horizonMonths: 1 as const, computedAt: '2026-10-05T08:00:00Z', notes: ['Synthetic coverage warning'], model: { name: 'Synthetic HF model', versions: [{type:'model-sha256',value:'a'.repeat(64)}] } }
/** 1 month scores 12.34%, 3 months 23.45%, so each horizon is identifiable on screen. */
const scoreFor = (input: HfInput): HfPredictionResult => input.claim === 'P1_CD_mortality_3m'
  ? { ...predicted, claim: input.claim, horizonMonths: 3, probability: 0.2345, tier: 'high' }
  : { ...predicted, claim: input.claim }
let importId: string
const getToken = jest.fn()
let identityChanged: (() => void) | undefined
const onIdentityChanged = jest.fn(callback => { identityChanged = callback; return jest.fn() })
/** The detail view prepares the record by itself when it opens. */
async function prepared() {
  await screen.findByRole('combobox', { name: '門診基準日／院所' })
}
const run = () => fireEvent.click(screen.getByRole('button', { name: '執行 HF 模型預測' }))
beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  jest.mocked(detectHfIntranet).mockResolvedValue(false)
  identityChanged = undefined
  process.env.NEXT_PUBLIC_HF_GATEWAY_ORIGIN = 'https://hf.test'
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: randomUUID })
  importId = 'synthetic-import-1'
  jest.mocked(LocalBundleService.getActiveImportId).mockImplementation(() => importId)
  jest.mocked(LocalBundleService.load).mockResolvedValue(hfMedcloudFixture())
  jest.mocked(shouldUseLocalBundle).mockReturnValue(true)
  getToken.mockResolvedValue('SYNTHETIC-CALLER')
  jest.mocked(captureHfCallerAuth).mockResolvedValue({ getToken, onIdentityChanged })
  jest.mocked(requestHfPrediction).mockImplementation(async input => scoreFor(input))
  jest.mocked(requestHfDryRun).mockResolvedValue(accepted)
})
afterEach(() => { delete process.env.NEXT_PUBLIC_HF_GATEWAY_ORIGIN; delete process.env.NEXT_PUBLIC_HF_AUTH_POLICY })

it('shows excluded lab details in the HF screen and clears them on patient import changes', async () => {
  const bundle = hfMedcloudFixture()
  bundle.entry.at(-1).resource.code.text = 'Synthetic excluded WBC'
  bundle.entry.at(-1).resource.valueQuantity.unit = 'unknown-unit'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  fireEvent.click(screen.getByText(/未納入的檢驗／觀察項目明細/))
  expect(screen.getByText('Synthetic excluded WBC')).toBeVisible()
  expect(screen.getByText(/單位無法換算成模型要求/)).toBeVisible()
  jest.mocked(LocalBundleService.load).mockResolvedValue(hfMedcloudFixture())
  importId = 'synthetic-import-2'
  act(() => window.dispatchEvent(new Event('storage')))
  await waitFor(() => expect(screen.queryByText('Synthetic excluded WBC')).not.toBeInTheDocument())
  expect(requestHfDryRun).not.toHaveBeenCalled()
})

it('prepares data locally on open with no network requests and explains the transmitted inputs', async () => {
  const bundle = hfMedcloudFixture()
  bundle.entry[0].resource.birthDate = '1960'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(LocalBundleService.load).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/不含姓名、身分證或無關內容/)).toBeVisible()
  fireEvent.click(screen.getByText('本次使用的資料'))
  expect(screen.getByText(/生日未含完整年月日/)).toBeVisible()
  expect(screen.getByText('用藥、生命徵象、自由文字：此模型不使用')).toBeVisible()
  expect(requestHfDryRun).not.toHaveBeenCalled()
  expect(captureHfCallerAuth).not.toHaveBeenCalled()
})
it('offers no horizon choice and lays the work out as three steps', async () => {
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.queryByRole('combobox', { name: '模型期間' })).toBeNull()
  expect(screen.queryByRole('button', { name: '整理模型資料' })).toBeNull()
  expect(screen.getByRole('region', { name: '步驟 1　基準門診' })).toHaveTextContent('同時計算 1 個月與 3 個月')
  expect(screen.getByRole('region', { name: '醫師補充心衰診斷' })).toHaveTextContent(/步驟 2\s*確認心衰病史/)
})
it('shows an unavailable configuration without a direct HTTP fallback', async () => {
  delete process.env.NEXT_PUBLIC_HF_GATEWAY_ORIGIN
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeDisabled()
  expect(screen.getByText('院內 HF 檢查服務尚未設定')).toBeVisible()
})
it('requires caller auth and never creates a new anonymous account', async () => {
  jest.mocked(captureHfCallerAuth).mockResolvedValue(null)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findByText('尚未登入或未取得 HF 服務授權')).toBeVisible()
  expect(requestHfDryRun).not.toHaveBeenCalled()
})
it('checks and scores both horizons from one click', async () => {
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')).toBeVisible()
  expect(within(await screen.findByTestId('hf-result-P1_CD_mortality_1m')).getByText('12.34%')).toBeVisible()
  expect(within(screen.getByTestId('hf-result-P1_CD_mortality_3m')).getByText('23.45%')).toBeVisible()
  expect(within(screen.getByTestId('hf-result-P1_CD_mortality_3m')).getByText('高風險層')).toBeVisible()
  expect(jest.mocked(requestHfDryRun).mock.calls.map(call => call[0].claim)).toEqual(['P1_CD_mortality_1m', 'P1_CD_mortality_3m'])
  expect(jest.mocked(requestHfPrediction).mock.calls.map(call => call[0].claim).sort()).toEqual(['P1_CD_mortality_1m', 'P1_CD_mortality_3m'])
})
it('keeps one horizon\'s score when the other is refused', async () => {
  jest.mocked(requestHfDryRun).mockImplementation(async input => input.claim === 'P1_CD_mortality_3m'
    ? { verdict: 'refused', issues: [{ severity: 'error', code: 'required', text: 'Synthetic 3-month refusal' }] } : accepted)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  const threeMonths = await screen.findByTestId('hf-result-P1_CD_mortality_3m')
  expect(await within(threeMonths).findByText('Synthetic 3-month refusal', { exact: false })).toBeVisible()
  expect(within(threeMonths).getByText('這不是低風險結果。')).toBeVisible()
  expect(within(screen.getByTestId('hf-result-P1_CD_mortality_1m')).getByText('12.34%')).toBeVisible()
  expect(requestHfPrediction).toHaveBeenCalledTimes(1)
})
it('shows one horizon\'s connection error in its own column', async () => {
  jest.mocked(requestHfPrediction).mockImplementation(async input => { if (input.claim === 'P1_CD_mortality_3m') throw new Error('gateway-unavailable'); return scoreFor(input) })
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await within(await screen.findByTestId('hf-result-P1_CD_mortality_3m')).findByText('無法完成檢查，請確認院內連線後重試')).toBeVisible()
  expect(within(screen.getByTestId('hf-result-P1_CD_mortality_1m')).getByText('12.34%')).toBeVisible()
})
it('shows a 422 refusal for both horizons and clears it when preparing again', async () => {
  jest.mocked(requestHfDryRun).mockResolvedValue({ verdict: 'refused', issues: [{ severity: 'error', code: 'required', text: 'Synthetic missing input' }] })
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findAllByText('Synthetic missing input', { exact: false })).toHaveLength(2)
  expect(screen.getByText('輸入檢查未通過；請核對缺漏或不相容資料。')).toBeVisible()
  expect(requestHfPrediction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  expect(screen.queryByText('Synthetic missing input', { exact: false })).toBeNull()
  await act(async () => {})
})
it('merges notes shared by both horizons and marks a note from only one', async () => {
  jest.mocked(requestHfPrediction).mockImplementation(async input => ({ ...scoreFor(input) as typeof predicted,
    notes: input.claim === 'P1_CD_mortality_3m' ? ['提示：12 個月內未測 NT-proBNP：風險可能被低估', '提示：C_LAB_K_LAST 超出開發資料範圍（2.2–7.35）'] : ['提示：12 個月內未測 NT-proBNP：風險可能被低估'] }))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  const notes = await screen.findByRole('region', { name: '判讀前先看' })
  expect(within(notes).getAllByText(/未測 NT-proBNP/)).toHaveLength(1)
  expect(within(notes).getByText('可能低估風險 · 1')).toBeVisible()
  expect(within(notes).getByText('提示：C_LAB_K_LAST 超出開發資料範圍（2.2–7.35） (3 個月)')).toBeVisible()
})
it('copies both horizons with the caveat for the note', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  fireEvent.click(await screen.findByRole('button', { name: '複製結果到病歷' }))
  await screen.findByRole('button', { name: '已複製' })
  const copied = writeText.mock.calls[0][0] as string
  expect(copied).toContain('就診後 1 個月內死亡：12.34%（中風險層）')
  expect(copied).toContain('就診後 3 個月內死亡：23.45%（高風險層）')
  expect(copied).toContain('死亡事件依北榮資料認定，院外或他院死亡可能未納入')
  expect(copied).not.toContain('院內死亡')
})
it('remembers a dismissed usage guide', async () => {
  const first = render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  const guide = screen.getByText('使用說明：三個步驟').closest('details')!
  expect(guide.open).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '知道了，之後收起' }))
  expect(guide.open).toBe(false)
  first.unmount()
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByText('使用說明：三個步驟').closest('details')!.open).toBe(false)
})
it('aborts and discards a late response after a different import, even for the same patient', async () => {
  const finish: ((value: HfDryRunResult) => void)[] = []
  jest.mocked(requestHfDryRun).mockImplementation(() => new Promise(resolve => { finish.push(resolve) }))
  const view = render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await waitFor(() => expect(requestHfDryRun).toHaveBeenCalledTimes(2))
  const signal = jest.mocked(requestHfDryRun).mock.calls[0][1].signal
  importId = 'synthetic-import-2'
  view.rerender(<HfMedcloudDryRun locale="zh-TW" />)
  expect(signal.aborted).toBe(true)
  await act(async () => finish.forEach(resolve => resolve(accepted)))
  expect(screen.queryByText(/輸入檢查通過/)).toBeNull()
  expect(requestHfPrediction).not.toHaveBeenCalled()
  await prepared()
  expect(LocalBundleService.load).toHaveBeenCalledTimes(2)
})
it('discards a response after sign-out', async () => {
  const finish: ((value: HfDryRunResult) => void)[] = []
  jest.mocked(requestHfDryRun).mockImplementation(() => new Promise(resolve => { finish.push(resolve) }))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await waitFor(() => expect(requestHfDryRun).toHaveBeenCalledTimes(2))
  getToken.mockResolvedValue(null)
  await act(async () => finish.forEach(resolve => resolve(accepted)))
  expect(screen.queryByText(/輸入檢查通過/)).toBeNull()
  expect(await screen.findByText('尚未登入或未取得 HF 服務授權')).toBeVisible()
  expect(requestHfPrediction).not.toHaveBeenCalled()
})
it('does not use an old local import while a SMART chart is active', async () => {
  jest.mocked(shouldUseLocalBundle).mockReturnValue(false)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  expect(await screen.findByText('請匯入雲端、健康或北榮懷爾抓抓的單一患者病歷')).toBeVisible()
  expect(LocalBundleService.load).not.toHaveBeenCalled()
})

it('clears a completed validation after the caller identity changes', async () => {
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  act(() => identityChanged?.())
  expect(screen.queryByText(/輸入檢查通過/)).toBeNull()
  expect(screen.getByText('尚未登入或未取得 HF 服務授權')).toBeVisible()
})
it('clears a completed local validation when the active source becomes SMART', async () => {
  const view = render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  jest.mocked(shouldUseLocalBundle).mockReturnValue(false)
  view.rerender(<HfMedcloudDryRun locale="zh-TW" />)
  expect(screen.queryByText(/輸入檢查通過/)).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(await screen.findByText('請匯入雲端、健康或北榮懷爾抓抓的單一患者病歷')).toBeVisible()
})

it('explicit intranet policy submits without Firebase and shows warnings on an accepted response', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  jest.mocked(captureHfCallerAuth).mockResolvedValue(null)
  jest.mocked(requestHfDryRun).mockResolvedValue({ verdict: 'accepted', issues: [{ severity: 'warning', code: 'business-rule', text: 'Synthetic missing hemoglobin' }] })
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  fireEvent.click(screen.getByText('本次使用的資料'))
  expect(screen.getByText(/未提供的模型檢驗項目/)).toBeVisible()
  run()
  expect(await screen.findByText('輸入檢查通過，但有資料警告；請核對下列缺漏。')).toBeVisible()
  expect(captureHfCallerAuth).not.toHaveBeenCalled()
  expect(requestHfDryRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authPolicy: 'intranet' }))
  expect(screen.getByText(/Synthetic missing hemoglobin/)).toBeVisible()
  expect(await screen.findByText('12.34%')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  expect(screen.queryByText('輸入檢查通過，但有資料警告；請核對下列缺漏。')).toBeNull()
  await act(async () => {})
})
it('invalid authorization policy fails closed', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'arbitrary'
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeDisabled()
  expect(requestHfDryRun).not.toHaveBeenCalled()
})

it('keeps the single action busy until every check and prediction finish', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  const finishValidation: ((value: HfDryRunResult) => void)[] = []
  const finishPrediction: (() => void)[] = []
  jest.mocked(requestHfDryRun).mockImplementation(() => new Promise(resolve => { finishValidation.push(resolve) }))
  jest.mocked(requestHfPrediction).mockImplementation(input => new Promise(resolve => { finishPrediction.push(() => resolve(scoreFor(input))) }))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await waitFor(() => expect(requestHfDryRun).toHaveBeenCalledTimes(2))
  expect(requestHfPrediction).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '檢查資料與預測中…' })).toBeDisabled()
  await act(async () => finishValidation.forEach(resolve => resolve(accepted)))
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
  await act(async () => finishPrediction[0]())
  expect(screen.getByRole('button', { name: '檢查資料與預測中…' })).toBeDisabled()
  await act(async () => finishPrediction[1]())
  expect(screen.getByText('12.34%')).toBeVisible()
  expect(screen.getByText('23.45%')).toBeVisible()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeEnabled()
})
it('validates before predicting with one button and keeps warnings with the score', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button',{name:'執行 HF 模型預測'})).toBeEnabled()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  expect(await screen.findByText('12.34%')).toBeVisible()
  const otherNotes = screen.getByTestId('hf-notes-other') as HTMLDetailsElement
  expect(otherNotes.open).toBe(false)
  expect(otherNotes).toHaveTextContent('其他提示 · 1')
  expect(screen.getByText('Synthetic coverage warning')).not.toBeVisible()
  fireEvent.click(within(otherNotes).getByText(/其他提示/))
  expect(screen.getByText('Synthetic coverage warning')).toBeVisible()
  expect(screen.getByText(/研究試辦版本，尚未取得醫療器材許可證/)).toBeVisible()
  expect(requestHfDryRun).toHaveBeenCalledTimes(2)
  expect(jest.mocked(requestHfDryRun).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(requestHfPrediction).mock.invocationCallOrder[0])
  expect(screen.queryByRole('button', { name: '執行院內輸入檢查' })).toBeNull()
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  expect(screen.queryByText('12.34%')).toBeNull()
  await act(async () => {})
  expect(LocalBundleService.load).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button',{name:'執行 HF 模型預測'})).toBeEnabled()
})
it('displays a prediction refusal without a low-risk result', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  jest.mocked(requestHfPrediction).mockImplementation(async input => ({schemaVersion:1,verdict:'refused',claim:input.claim,indexDate:'2026-01-01',issues:[{severity:'error',code:'required',text:'Synthetic missing creatinine'}]}))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  expect(await screen.findAllByText('資料不足或不相容，無法評估')).toHaveLength(2)
  expect(screen.getAllByText('這不是低風險結果。')).toHaveLength(2)
  expect(screen.queryByText(/\d+%/)).toBeNull()
  expect(screen.queryByRole('button', { name: '複製結果到病歷' })).toBeNull()
})
it('drops a late prediction when switching the source import', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  const finish: (() => void)[] = []
  jest.mocked(requestHfPrediction).mockImplementation(input => new Promise(resolve => { finish.push(() => resolve(scoreFor(input))) }))
  const view=render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  await waitFor(() => expect(requestHfPrediction).toHaveBeenCalledTimes(2))
  const signal=jest.mocked(requestHfPrediction).mock.calls[0][1].signal
  importId='synthetic-other-import'
  view.rerender(<HfMedcloudDryRun locale="zh-TW" />)
  expect(signal.aborted).toBe(true)
  await act(async () => finish.forEach(resolve => resolve()))
  expect(screen.queryByText('12.34%')).toBeNull()
  await prepared()
})

it('drops a local connection error after switching to a SMART chart', async () => {
  jest.mocked(requestHfDryRun).mockRejectedValue(new Error('gateway-unavailable'))
  const view=render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findAllByText('無法完成檢查，請確認院內連線後重試')).toHaveLength(1)
  jest.mocked(shouldUseLocalBundle).mockReturnValue(false)
  view.rerender(<HfMedcloudDryRun locale="zh-TW" />)
  expect(screen.queryByText('無法完成檢查，請確認院內連線後重試')).toBeNull()
  await screen.findByText('請匯入雲端、健康或北榮懷爾抓抓的單一患者病歷')
})
it('keeps the HF input surface usable on a hospital launch query', async () => {
  window.history.replaceState(null,'','/?medcloud2=auto&site=vghtpe')
  try {
    process.env.NEXT_PUBLIC_HF_AUTH_POLICY='intranet'
    render(<HfMedcloudDryRun locale="zh-TW" />)
    await prepared()
    expect(screen.getByRole('button',{name:'執行 HF 模型預測'})).toBeEnabled()
  } finally { window.history.replaceState(null,'','/') }
})

it.each(['/', '/?site=other', '/?site=VGHTPE', '/?site=vghtpe&site=hmc'])('omits the hospital SaMD calculator on %s', path => {
  window.history.replaceState({}, '', path)
  render(<HfSamdCalculator locale="zh-TW" />)
  expect(screen.queryByTestId('hf-samd-calculator-card')).toBeNull()
  expect(LocalBundleService.load).not.toHaveBeenCalled()
})
it('keeps the hospital card on the vghtpe route and opens the full detail without sending data', async () => {
  window.history.replaceState({}, '', '/?site=vghtpe')
  render(<HfSamdCalculator locale="zh-TW" />)
  expect(screen.getByText('北榮研究試用')).toBeVisible()
  expect(LocalBundleService.load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('region', { name: '北榮研究試用 HF 計算機' })).toBeVisible()
  await prepared()
  expect(requestHfDryRun).not.toHaveBeenCalled()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  await screen.findByText('23.45%')
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  expect(screen.getByText('輸入檢查通過；資料來源適用性仍待驗證。')).toBeVisible()
  expect(requestHfDryRun).toHaveBeenCalledTimes(2)
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
  expect(LocalBundleService.load).toHaveBeenCalledTimes(1)
})
it('returns both scores to the card and keeps the detailed result when reopened', async () => {
  window.history.replaceState({}, '', '/?site=vghtpe')
  render(<HfSamdCalculator locale="zh-TW" />)
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  await screen.findByText('23.45%')
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  expect(screen.getByRole('button', { name: /1 個月 12.34%.*3 個月 23.45%/ })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  expect(screen.getByRole('region', { name: 'HF 模型預測結果' })).toBeVisible()
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
})
it('shows the card without a site marker only after authorized intranet discovery', async () => {
  window.history.replaceState({}, '', '/')
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  const discovery = jest.mocked(detectHfIntranet).mockResolvedValue(true)
  render(<HfSamdCalculator locale="zh-TW" />)
  expect(await screen.findByText('北榮研究試用')).toBeVisible()
  expect(discovery).toHaveBeenCalledWith('https://hf.test', expect.any(AbortSignal))
  expect(LocalBundleService.load).not.toHaveBeenCalled()
  expect(requestHfDryRun).not.toHaveBeenCalled()

})
it('fails closed when intranet discovery cannot confirm access', async () => {
  window.history.replaceState({}, '', '/')
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  const discovery = jest.mocked(detectHfIntranet).mockResolvedValue(false)
  render(<HfSamdCalculator locale="zh-TW" />)
  await waitFor(() => expect(discovery).toHaveBeenCalled())
  expect(screen.queryByTestId('hf-samd-calculator-card')).toBeNull()

})

it('keeps a pending prediction running after returning to the list and switching tabs', async () => {
  window.history.replaceState({}, '', '/?site=vghtpe')
  const finish: (() => void)[] = []
  jest.mocked(requestHfPrediction).mockImplementation(input => new Promise(resolve => { finish.push(() => resolve(scoreFor(input))) }))
  function Harness() {
    const [tab, setTab] = useState('calculator')
    return <>
      <button onClick={() => setTab('other')}>其他畫面</button>
      <button onClick={() => setTab('calculator')}>回計算機</button>
      <div hidden={tab !== 'calculator'}><HfSamdCalculator locale="zh-TW" /></div>
      {tab === 'other' && <p>另一個功能頁</p>}
    </>
  }
  const view = render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  await prepared()
  run()
  await screen.findByText('輸入檢查通過；資料來源適用性仍待驗證。')
  await waitFor(() => expect(requestHfPrediction).toHaveBeenCalledTimes(2))
  const signal = jest.mocked(requestHfPrediction).mock.calls[0][1].signal
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  expect(screen.getByRole('button', { name: /北榮研究試用.*處理中/ })).toBeVisible()
  expect(signal.aborted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '其他畫面' }))
  expect(screen.getByText('另一個功能頁')).toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(signal.aborted).toBe(false)
  await act(async () => finish.forEach(resolve => resolve()))
  fireEvent.click(screen.getByRole('button', { name: '回計算機' }))
  expect(screen.getByRole('button', { name: /12.34%/ })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /北榮研究試用.*HF 門診預後模型/ }))
  expect(screen.getByRole('region', { name: 'HF 模型預測結果' })).toBeVisible()
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
  importId = 'synthetic-other-import'
  view.rerender(<Harness />)
  expect(screen.queryByText('12.34%')).toBeNull()
  await prepared()
})
it('prepares a TVGH bridge import but prevents upload with unverified generic ICD-10', async () => {
  const bundle = hfMedcloudFixture()
  bundle.meta = { source: 'ehr-fhir-bridge/extension-local' }
  const encounter = bundle.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Encounter').resource
  encounter.meta = { source: 'ehr-fhir-bridge/scraper' }
  delete encounter.serviceProvider
  encounter.reasonCode[0].coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  fireEvent.click(screen.getByText('本次使用的資料'))
  expect(screen.getByText(/病歷來源：北榮懷爾抓抓/)).toBeVisible()
  expect(screen.getByText(/門診缺少可核對的 ICD-10-CM/)).toBeVisible()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeDisabled()
  expect(requestHfDryRun).not.toHaveBeenCalled()
  expect(requestHfPrediction).not.toHaveBeenCalled()
})
it('the hook rejects a missing selected diagnosis even if another same-day visit has one', async () => {
  const bundle = hfMedcloudFixture()
  bundle.meta = { source: 'ehr-fhir-bridge/extension-local' }
  const first = bundle.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Encounter').resource
  first.meta = { source: 'ehr-fhir-bridge/scraper' }
  const other = JSON.parse(JSON.stringify(first))
  other.id = 'other-same-day-visit'
  bundle.entry.push({ fullUrl: 'Encounter/' + other.id, resource: other })
  first.reasonCode[0].coding[0].system = 'http://hl7.org/fhir/sid/icd-10'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  const { result } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare() })
  expect(result.current.current?.input.gaps).toContainEqual({ code: 'index-diagnosis-missing', count: 1 })
  await act(async () => { await result.current.validate() })
  expect(requestHfDryRun).not.toHaveBeenCalled()
})

it('clears cached HF results on an import event without a parent rerender', async () => {
  const { result } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare() })
  await act(async () => { await result.current.predict() })
  expect(result.current.runs?.P1_CD_mortality_1m?.prediction?.verdict).toBe('scored')
  expect(result.current.runs?.P1_CD_mortality_3m?.prediction?.verdict).toBe('scored')
  act(() => {
    jest.mocked(LocalBundleService.getActiveImportId).mockReturnValue('next-import')
    window.dispatchEvent(new Event('mediprisma:local-bundle-changed'))
  })
  expect(result.current.current).toBeNull()
  expect(result.current.runs).toBeNull()
})
it('aborts pending validation on an import event without a parent rerender', async () => {
  jest.mocked(requestHfDryRun).mockImplementation(() => new Promise(() => undefined))
  const { result } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare() })
  act(() => { void result.current.validate() })
  await waitFor(() => expect(requestHfDryRun).toHaveBeenCalledTimes(2))
  const signals = jest.mocked(requestHfDryRun).mock.calls.map(call => call[1].signal)
  act(() => {
    jest.mocked(LocalBundleService.getActiveImportId).mockReturnValue('next-import')
    window.dispatchEvent(new Event('mediprisma:local-bundle-changed'))
  })
  expect(signals.every(signal => signal?.aborted)).toBe(true)
  expect(result.current.busy).toBe(false)
  expect(result.current.current).toBeNull()
})

it('needs an HF diagnosis to submit, invalidates results when the physician diagnosis changes, and clears it on visit changes', async () => {
  const bundle = hfMedcloudFixture()
  const visit = bundle.entry.find((e: any) => e.resource.resourceType === 'Encounter').resource
  visit.reasonCode[0].coding[0].code = 'I10'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  const { result } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare(); })
  await act(async () => { await result.current.validate(); })
  expect(requestHfDryRun).not.toHaveBeenCalled()
  expect(result.current.runs).toBeNull()
  const reference = result.current.current!.baseInput.indexEncounterReference!
  act(() => result.current.supplementDiagnosis({ code: 'I50.9', ranks: { [reference]: 2 }, encounters: [reference], confirmed: true }))
  expect(result.current.runs).toBeNull()
  expect(result.current.current?.input.physicianDiagnosis?.code).toBe('I50.9')
  await act(async () => { await result.current.predict() })
  expect(requestHfPrediction).toHaveBeenCalledTimes(2)
  expect(jest.mocked(requestHfDryRun).mock.calls.at(-1)![0].physicianDiagnosis?.code).toBe('I50.9')
  expect(jest.mocked(requestHfPrediction).mock.calls.every(call => call[0].physicianDiagnosis?.code === 'I50.9')).toBe(true)
  act(() => result.current.supplementDiagnosis({ code: 'I50.9', ranks: { [reference]: 2 }, encounters: [reference], confirmed: false }))
  expect(result.current.runs).toBeNull()
  expect(result.current.current?.input.physicianDiagnosis).toBeUndefined()
  act(() => result.current.select({ ...result.current.current!.selection }))
  expect(result.current.current?.diagnosisDraft).toEqual({ code: '', encounters: [], ranks: {}, confirmed: false })
})
it('applies complete advanced diagnosis selections without an extra confirmation or automatic transmission', async () => {
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  const details = screen.getByText('本次使用的資料').closest('details')!
  expect(details.open).toBe(false)
  const button = screen.getByRole('button', { name: '執行 HF 模型預測' })
  const diagnosis = screen.getByRole('region', { name: '醫師補充心衰診斷' })
  expect(diagnosis.closest('details')).toBeNull()
  expect(diagnosis.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(button.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('region', { name: '醫師補充心衰診斷' })).toBeVisible()
  fireEvent.click(screen.getByText('日期不同？自訂就診與診斷順位'))
  fireEvent.change(screen.getByRole('combobox', { name: '補充 ICD-10-CM 診斷碼' }), { target: { value: 'I50.9' } })
  fireEvent.click(screen.getByLabelText(/2026-10-01 · 門診 · #1 · 基準就診/))
  expect(requestHfDryRun).not.toHaveBeenCalled()
  expect(screen.getByText('每次所選就診的診斷順位須為 1–50 的整數；補充資料未完整前不會套用。')).toBeVisible()
  expect(screen.queryByLabelText(/我是醫師/)).toBeNull()
  fireEvent.change(screen.getByRole('spinbutton', { name: '2026-10-01 診斷順位' }), { target: { value: '2' } })
  expect(screen.getByRole('note')).toHaveTextContent('醫師確認（使用者聲明）')
  expect(requestHfDryRun).not.toHaveBeenCalled()
})
it('collapses a confirmed diagnosis to one line after running and reopens it to change', async () => {
  const bundle = hfMedcloudFixture()
  const visit = bundle.entry.find((entry: any) => entry.resource.resourceType === 'Encounter').resource
  const past = JSON.parse(JSON.stringify(visit)); past.id = 'past'; past.period.start = '2026-09-01'
  bundle.entry.push({ fullUrl: 'Encounter/past', resource: past })
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  fireEvent.click(screen.getByLabelText('最近兩次門診皆有心衰診斷'))
  run()
  await screen.findByText('23.45%')
  const diagnosis = screen.getByRole('region', { name: '醫師補充心衰診斷' })
  expect(within(diagnosis).queryByRole('radio')).toBeNull()
  expect(diagnosis).toHaveTextContent('最近兩次門診皆有心衰診斷 · I50.9')
  fireEvent.click(within(diagnosis).getByRole('button', { name: '修改' }))
  expect(within(diagnosis).getByLabelText('最近兩次門診皆有心衰診斷')).toBeChecked()
})

it('does not resurrect a physician attestation after switching to SMART and back to the same import', async () => {
  const { result, rerender } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare() })
  act(() => result.current.supplementDiagnosis({ code: 'I50.9', ranks: { [result.current.current!.baseInput.indexEncounterReference!]: 2 }, encounters: [result.current.current!.baseInput.indexEncounterReference!], confirmed: true }))
  expect(result.current.current?.input.physicianDiagnosis).toBeDefined()
  jest.mocked(shouldUseLocalBundle).mockReturnValue(false)
  rerender()
  expect(result.current.current).toBeNull()
  jest.mocked(shouldUseLocalBundle).mockReturnValue(true)
  rerender()
  expect(result.current.current).toBeNull()
})

it('applies outpatient diagnosis on shortcut selection without an extra confirmation or network call', async () => {
  const bundle = hfMedcloudFixture()
  const visit = bundle.entry.find((entry: any) => entry.resource.resourceType === 'Encounter').resource
  visit.reasonCode[0].coding[0].code = 'I10'
  const past = JSON.parse(JSON.stringify(visit)); past.id = 'past'; past.period.start = '2026-09-01'
  bundle.entry.push({ fullUrl: 'Encounter/past', resource: past })
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('region', { name: '醫師補充心衰診斷' })).toBeVisible()
  expect(screen.getByText('日期不同？自訂就診與診斷順位').closest('details')!.open).toBe(false)
  expect(screen.getByText('住院選項無法使用：基準日以前沒有可用的已結束住院紀錄。')).toBeVisible()
  const outpatient = screen.getByLabelText('最近兩次門診皆有心衰診斷')
  expect(outpatient).toHaveAccessibleDescription(/2026-10-01（基準）、2026-09-01/)
  fireEvent.click(outpatient)
  expect(screen.getByRole('note')).toHaveTextContent('2026-10-01')
  expect(screen.queryByLabelText(/我是醫師/)).toBeNull()
  expect(screen.getByRole('note')).toHaveTextContent('順位 2')
  expect(requestHfDryRun).not.toHaveBeenCalled()
})

it('explains a disabled index-diagnosis check outside collapsed details', async () => {
  const bundle = hfMedcloudFixture()
  const visit = bundle.entry.find((entry: any) => entry.resource.resourceType === 'Encounter').resource
  visit.reasonCode = []
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeDisabled()
  expect(screen.getByTestId('hf-model-actions')).toHaveTextContent('基準門診缺少可用診斷')
  expect(screen.getByText('本次使用的資料').closest('details')!.open).toBe(false)
})

it('uses a refreshed caller token for prediction after input validation', async () => {
  getToken.mockResolvedValueOnce('SYNTHETIC-FIRST').mockResolvedValue('SYNTHETIC-REFRESHED')
  const { result } = renderHook(() => useMedcloudHfDryRun())
  await act(async () => { await result.current.prepare() })
  await act(async () => { await result.current.predict() })
  expect(jest.mocked(requestHfDryRun).mock.calls.every(call => call[1].token === 'SYNTHETIC-FIRST')).toBe(true)
  expect(jest.mocked(requestHfPrediction).mock.calls.every(call => call[1].token === 'SYNTHETIC-REFRESHED')).toBe(true)
})

it('offers copying only after every horizon settles', async () => {
  const finish: (() => void)[] = []
  jest.mocked(requestHfPrediction).mockImplementation(input => input.claim === 'P1_CD_mortality_3m'
    ? new Promise(resolve => { finish.push(() => resolve(scoreFor(input))) })
    : Promise.resolve(scoreFor(input)))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await within(await screen.findByTestId('hf-result-P1_CD_mortality_1m')).findByText('12.34%')).toBeVisible()
  expect(screen.queryByRole('button', { name: '複製結果到病歷' })).toBeNull()
  await act(async () => finish.forEach(resolve => resolve()))
  expect(await screen.findByRole('button', { name: '複製結果到病歷' })).toBeEnabled()
})
it('keeps the newer record when an older preparation finishes late', async () => {
  let finishFirst!: (value: ReturnType<typeof hfMedcloudFixture>) => void
  jest.mocked(LocalBundleService.load)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
    .mockResolvedValue(hfMedcloudFixture())
  const view = render(<HfMedcloudDryRun locale="zh-TW" />)
  await waitFor(() => expect(LocalBundleService.load).toHaveBeenCalledTimes(1))
  importId = 'synthetic-import-2'
  view.rerender(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  await act(async () => finishFirst(hfMedcloudFixture()))
  expect(screen.getByRole('combobox', { name: '門診基準日／院所' })).toBeVisible()
  expect(screen.queryByText('資料已切換，請重新整理輸入')).toBeNull()
})
it('stops every horizon as soon as one loses authorization', async () => {
  process.env.NEXT_PUBLIC_HF_AUTH_POLICY = 'intranet'
  let finishThreeMonths!: (value: HfDryRunResult) => void
  jest.mocked(requestHfDryRun).mockImplementation(input => input.claim === 'P1_CD_mortality_3m'
    ? new Promise(resolve => { finishThreeMonths = resolve })
    : Promise.reject(new Error('gateway-unauthorized')))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findByText('院內服務拒絕存取；請確認核准網段與入口設定。')).toBeVisible()
  const threeMonthSignal = jest.mocked(requestHfDryRun).mock.calls.find(call => call[0].claim === 'P1_CD_mortality_3m')![1].signal
  expect(threeMonthSignal.aborted).toBe(true)
  await act(async () => finishThreeMonths(accepted))
  expect(requestHfPrediction).not.toHaveBeenCalled()
  expect(screen.queryByTestId('hf-result-P1_CD_mortality_3m')).toBeNull()
})
it('shows the cohort behind the observed incidence', async () => {
  jest.mocked(requestHfPrediction).mockImplementation(async input => ({ ...scoreFor(input) as typeof predicted,
    observedIncidence: { rate: 0.0268, ciLow: 0.023, ciHigh: 0.0313, tierShare: 0.46, patients: 5848, basis: 'Synthetic cohort 2020–2025; frozen calibration' } }))
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  const column = await screen.findByTestId('hf-result-P1_CD_mortality_1m')
  expect(await within(column).findByText(/同層實際發生率（群體）/)).toBeVisible()
  const cohort = within(column).getByText('依據族群：Synthetic cohort 2020–2025; frozen calibration')
  expect(cohort).not.toBeVisible()
  fireEvent.click(within(within(column).getByTestId('hf-incidence-basis-P1_CD_mortality_1m')).getByText('依據'))
  expect(cohort).toBeVisible()
  expect(within(column).getByText(/群體發生率，非個人機率 · n=5848/)).toBeVisible()
})
it('keeps completed checks when both predictions fail the same way', async () => {
  jest.mocked(requestHfPrediction).mockRejectedValue(new Error('gateway-unavailable'))
  jest.mocked(requestHfDryRun).mockResolvedValue({ verdict: 'accepted', issues: [{ severity: 'warning', code: 'business-rule', text: 'Synthetic check warning' }] })
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  run()
  expect(await screen.findAllByText('無法完成檢查，請確認院內連線後重試')).toHaveLength(1)
  expect(screen.getByText('輸入檢查通過，但有資料警告；請核對下列缺漏。')).toBeVisible()
  expect(screen.getByText('Synthetic check warning')).toBeVisible()
})

it('warns before running when no model laboratory result will be sent, with the reason', async () => {
  const bundle = hfMedcloudFixture()
  bundle.entry.find((entry: any) => entry.resource.resourceType === 'Observation').resource.status = 'preliminary'
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  const reminder = screen.getByRole('region', { name: '執行前提醒' })
  expect(reminder).toHaveTextContent('本次沒有任何模型檢驗會送出')
  expect(reminder).toHaveTextContent('檢驗尚未確認完成，未送出 · 1')
  expect(requestHfDryRun).not.toHaveBeenCalled()
})

it('keeps the run button off until step 2 supplies an HF diagnosis when the record has none', async () => {
  const bundle = hfMedcloudFixture()
  const visit = bundle.entry.find((entry: any) => entry.resource.resourceType === 'Encounter').resource
  visit.reasonCode[0].coding[0].code = 'I10'
  const past = JSON.parse(JSON.stringify(visit)); past.id = 'past'; past.period.start = '2026-09-01'
  bundle.entry.push({ fullUrl: 'Encounter/past', resource: past })
  jest.mocked(LocalBundleService.load).mockResolvedValue(bundle)
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeDisabled()
  expect(screen.getByTestId('hf-model-actions')).toHaveTextContent('未偵測到心衰診斷，請先在步驟 2 確認心衰病史')
  fireEvent.click(screen.getByLabelText('最近兩次門診皆有心衰診斷'))
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeEnabled()
  expect(screen.getByTestId('hf-model-actions')).not.toHaveTextContent('未偵測到心衰診斷')
})
it('leaves step 2 optional when the record already has an HF diagnosis', async () => {
  render(<HfMedcloudDryRun locale="zh-TW" />)
  await prepared()
  expect(screen.getByRole('button', { name: '執行 HF 模型預測' })).toBeEnabled()
  expect(screen.getByTestId('hf-model-actions')).not.toHaveTextContent('未偵測到心衰診斷')
})
