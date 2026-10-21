// The background send against a REAL sonner <Toaster> (sonner is not mocked
// here). Sonner closes a toast once an action button's onClick returns unless
// the click was preventDefault()ed; the retry reuses that same toast for its
// loading and outcome steps, so a close there took the report id, or the next
// 重試, off the screen. Waits run past sonner's 200 ms close animation; the
// Toaster itself applies every toast change on a timer, hence findBy*.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Toaster, toast } from 'sonner'
import { sendLabDataReportInBackground } from '@/features/lab-data-report/utils/send-in-background'
import { submitLabDataReport, type LabDataReportSubmitResult } from '@/features/lab-data-report/utils/submit-lab-data-report'

jest.mock('@/features/lab-data-report/utils/submit-lab-data-report', () => ({
  submitLabDataReport: jest.fn(),
}))

const strings = {
  sending: 'sending', readingRaw: 'reading', successTitle: 'done', successId: 'id', copyId: 'copy', retry: 'retry',
  failure: () => 'failed',
}
const base: any = { schemaVersion: 1, rows: [{ ref: 1 }] }
const PAST_CLOSE_ANIMATION_MS = 650

const wait = (ms: number) => act(() => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))

async function failOnceThenRetry() {
  render(<Toaster closeButton />)
  await act(async () => { await sendLabDataReportInBackground({ base }, strings) })
  expect(await screen.findByText('failed')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'retry' }))
}

describe('sendLabDataReportInBackground with a real Toaster', () => {
  // mockReset, not clearAllMocks: a once-queue left by a failed test must
  // not leak into the next one.
  beforeEach(() => (submitLabDataReport as jest.Mock).mockReset())
  afterEach(() => { act(() => { toast.dismiss() }) })

  it('keeps the sending toast up through a pending retry, without a second 重試', async () => {
    let settle!: (result: LabDataReportSubmitResult) => void
    ;(submitLabDataReport as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 'network' })
      .mockReturnValueOnce(new Promise<LabDataReportSubmitResult>((resolve) => { settle = resolve }))
    await failOnceThenRetry()
    await wait(PAST_CLOSE_ANIMATION_MS)
    expect(screen.getByText('sending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument()
    expect(submitLabDataReport).toHaveBeenCalledTimes(2)

    await act(async () => { settle({ ok: true, reportId: 'LDR-TEST-0001' }) })
    expect(await screen.findByText('id LDR-TEST-0001')).toBeInTheDocument()
  })

  it('keeps the report id of a retry that succeeds at once', async () => {
    ;(submitLabDataReport as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 'network' })
      .mockResolvedValueOnce({ ok: true, reportId: 'LDR-TEST-0002' })
    await failOnceThenRetry()
    await wait(PAST_CLOSE_ANIMATION_MS)
    expect(screen.getByText('id LDR-TEST-0002')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument()
    expect((submitLabDataReport as jest.Mock).mock.calls[1][0]).toBe((submitLabDataReport as jest.Mock).mock.calls[0][0])
  })

  it('keeps 重試 on screen when the retry fails again at once', async () => {
    ;(submitLabDataReport as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 'network' })
      .mockResolvedValueOnce({ ok: false, status: 'network' })
    await failOnceThenRetry()
    await wait(PAST_CLOSE_ANIMATION_MS)
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument()
  })

  it('leaves the report id up after 複製', async () => {
    const writeText = jest.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      ;(submitLabDataReport as jest.Mock).mockResolvedValueOnce({ ok: true, reportId: 'LDR-TEST-0003' })
      render(<Toaster closeButton />)
      await act(async () => { await sendLabDataReportInBackground({ base }, strings) })
      fireEvent.click(await screen.findByRole('button', { name: 'copy' }))
      expect(writeText).toHaveBeenCalledWith('LDR-TEST-0003')
      await wait(PAST_CLOSE_ANIMATION_MS)
      expect(screen.getByText('id LDR-TEST-0003')).toBeInTheDocument()
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
    }
  })
})
