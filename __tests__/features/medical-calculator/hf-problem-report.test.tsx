import { TextEncoder } from 'node:util'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { useState } from 'react'
import { HfProblemReport } from '@/features/medical-calculator/prognosis/HfProblemReport'
import { buildMedcloudHfInput } from '@/src/core/hf-risk/medcloud-input'
import type { HfDiagnosticRecord } from '@/src/core/hf-risk/diagnostics'
import { hfMedcloudFixture } from './hf-medcloud-fixture'
import type { HfReportSnapshot } from '@/src/application/telemetry/hf-report'
Object.assign(globalThis, { TextEncoder })
jest.mock('@/src/infrastructure/telemetry/collector', () => ({ isCollectorSite: () => true, configuredEndpoint: () => 'https://collector.example/collector/v1/events' }))
jest.mock('@/src/infrastructure/telemetry/collector-auth', () => ({ captureCollectorAuth: async () => ({ getToken: async () => 'SYNTHETIC-TOKEN' }) }))
const runId = '10000000-0000-4000-8000-000000000001'
function records(): HfDiagnosticRecord[] {
  const input = buildMedcloudHfInput(hfMedcloudFixture(), { provider: 'SYNTHETIC-HOSPITAL', encounter: 'Encounter/synthetic-visit', claim: 'P1_CD_mortality_1m' }, { today: '2026-10-04', uuid: randomUUID })
  return [{ inputJson: JSON.stringify(input.bundle), diagnostic: { requestId: randomUUID(), operation: 'predict', claim: input.claim, indexDate: input.indexDate,
    startedAt: '2026-10-20T03:00:00.000Z', elapsedMs: 15000, stage: 'connect', httpStatus: null,
    errorCode: 'request-timeout', verdict: null, requestBytes: 1000, responseBytes: 0, responseType: 'missing', responseIdMatched: null } }]
}
function Harness({ data, show = true }: { data: HfDiagnosticRecord[]; show?: boolean }) {
  const [snapshot, setSnapshot] = useState<HfReportSnapshot | null>(null)
  return show ? <HfProblemReport runId={runId} records={data} source="medcloud" locale="zh-TW" describeError={() => '等候服務超過 15 秒'} snapshot={snapshot} onSnapshotChange={setSnapshot} /> : null
}
const view = (data = records()) => <Harness data={data} />

it('sends only the frozen preview, after consent, and keeps its identity on retry', async () => {
  jest.mocked(fetch).mockClear()
  jest.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 201, json: async () => ({ success: true, reportId: runId }) } as Response)
  const component = render(view())
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '回報 HF 問題' }))
  expect(screen.getByRole('button', { name: '確認送出回報' })).toBeDisabled()
  const preview = screen.getByLabelText('完整 HF 回報預覽').textContent
  expect(fetch).not.toHaveBeenCalled()
  component.rerender(view([]))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await screen.findByText(/尚未確認收件成功/)
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await screen.findByText(/回報已收到，編號/)
  expect(fetch).toHaveBeenCalledTimes(2)
  for (const [url, init] of jest.mocked(fetch).mock.calls) {
    expect(url).toBe('https://collector.example/collector/v1/ai-reports')
    expect(init?.body).toBe(preview)
  }
  expect(screen.getByRole('button', { name: '已送出' })).toBeDisabled()
})

it('aborts an unfinished upload when its source component is removed', async () => {
  let signal: AbortSignal | undefined
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    signal = init?.signal as AbortSignal
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('abort'))))
  })
  const component = render(view())
  fireEvent.click(screen.getByRole('button', { name: '回報 HF 問題' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await waitFor(() => expect(signal).toBeDefined())
  await act(async () => component.unmount())
  expect(signal?.aborted).toBe(true)
})

it('retains the same submission after returning to the list and reopening the run', async () => {
  jest.mocked(fetch).mockClear()
  jest.mocked(fetch).mockRejectedValueOnce(new Error('receipt lost')).mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, reportId: runId }) } as Response)
  const data = records()
  const component = render(<Harness data={data} />)
  fireEvent.click(screen.getByRole('button', { name: '回報 HF 問題' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await screen.findByText(/尚未確認收件成功/)
  const first = jest.mocked(fetch).mock.calls[0][1]?.body
  component.rerender(<Harness data={data} show={false} />)
  component.rerender(<Harness data={data} />)
  fireEvent.click(screen.getByRole('button', { name: '回報 HF 問題' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  await screen.findByText(/回報已收到，編號/)
  expect(jest.mocked(fetch).mock.calls[1][1]?.body).toBe(first)
})

it.each([400, 409, 413, 429, 503])('explains deterministic receiver rejection %s and offers download', async status => {
  jest.mocked(fetch).mockClear()
  jest.mocked(fetch).mockResolvedValue({ status, json: async () => ({ reason: 'unconfigured' }) } as Response)
  render(view())
  fireEvent.click(screen.getByRole('button', { name: '回報 HF 問題' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '確認送出回報' }))
  expect(await screen.findByRole('button', { name: '暫時無法送出' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下載這份回報' })).toBeEnabled()
  expect(fetch).toHaveBeenCalledTimes(1)
})
