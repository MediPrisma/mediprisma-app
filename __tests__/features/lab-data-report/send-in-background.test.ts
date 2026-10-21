import { toast } from 'sonner'
import { sendLabDataReportInBackground, withRawRows } from '@/features/lab-data-report/utils/send-in-background'
import { submitLabDataReport } from '@/features/lab-data-report/utils/submit-lab-data-report'
import { extractRawLabRows } from '@/features/lab-data-report/utils/raw-lab-rows'

jest.mock('sonner', () => ({
  toast: { loading: jest.fn(() => 't1'), success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/features/lab-data-report/utils/submit-lab-data-report', () => ({
  submitLabDataReport: jest.fn(),
}))

const strings = {
  sending: 'sending', readingRaw: 'reading', successTitle: 'done', successId: 'id', copyId: 'copy', retry: 'retry',
  failure: () => 'failed',
}
const base: any = { schemaVersion: 1, rows: [{ ref: 1 }], rawSource: { stale: true }, rawSourceError: 'EXPIRED' }
const extract = extractRawLabRows(JSON.stringify({ endpoints: { '/imu/api/imue0060/imue0060s02/get-data': { status: 200, body: JSON.stringify({ robject: [{ r: 1, order_code: '08003C', assay_item_name: 'Hb', assay_value: '11', case_time: '2026-03-02T09:30:00+08:00' }] }) } } }))!

describe('withRawRows', () => {
  it('replaces whatever raw state the base carried', () => {
    const withRows = withRawRows(base, { ok: true, extract, expiresAt: 0, producerVersion: '0.12.19' }, { dayZero: null, includeValues: true })
    expect(withRows.rawSource?.rows).toHaveLength(1)
    expect(withRows.rawSourceError).toBeUndefined()
    expect(withRawRows(base, { ok: false, code: 'NOT_AVAILABLE' }, { dayZero: null, includeValues: true })).toEqual(expect.objectContaining({ rawSourceError: 'NOT_AVAILABLE' }))
    const aborted = withRawRows(base, { ok: false, code: 'ABORTED' }, { dayZero: null, includeValues: true })
    expect(aborted.rawSource).toBeUndefined()
    expect(aborted.rawSourceError).toBeUndefined()
  })
})

describe('sendLabDataReportInBackground', () => {
  beforeEach(() => jest.clearAllMocks())

  it('waits for a pending raw read, then sends and reports the id', async () => {
    ;(submitLabDataReport as jest.Mock).mockResolvedValue({ ok: true, reportId: 'LDR-1' })
    const result = await sendLabDataReportInBackground({
      base,
      raw: { read: Promise.resolve({ ok: true, extract, expiresAt: 0 }), dayZero: null, includeValues: true },
    }, strings)
    expect(result).toEqual({ team: { ok: true, reportId: 'LDR-1' } })
    expect(toast.loading).toHaveBeenNthCalledWith(1, 'reading')
    expect(toast.loading).toHaveBeenNthCalledWith(2, 'sending', { id: 't1' })
    expect((submitLabDataReport as jest.Mock).mock.calls[0][0].rawSource.rows).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('done', expect.objectContaining({ id: 't1', description: 'id LDR-1' }))
  })

  it('keeps a failure on screen with a retry of the same payload', async () => {
    ;(submitLabDataReport as jest.Mock).mockResolvedValueOnce({ ok: false, status: 'network' }).mockResolvedValueOnce({ ok: true, reportId: 'LDR-2' })
    await sendLabDataReportInBackground({ base }, strings)
    const [message, options] = (toast.error as jest.Mock).mock.calls[0]
    expect(message).toBe('failed')
    expect(options.duration).toBe(Number.POSITIVE_INFINITY)
    // The retry keeps the toast it is about to reuse (sonner closes it
    // otherwise), and the retry's loading step drops the spent 重試.
    const retryClick = { preventDefault: jest.fn() }
    await options.action.onClick(retryClick)
    expect(retryClick.preventDefault).toHaveBeenCalled()
    expect(toast.loading).toHaveBeenLastCalledWith('sending', { id: 't1', action: undefined })
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(submitLabDataReport).toHaveBeenCalledTimes(2)
    expect((submitLabDataReport as jest.Mock).mock.calls[1][0]).toBe((submitLabDataReport as jest.Mock).mock.calls[0][0])
    expect(toast.success).toHaveBeenCalledWith('done', expect.objectContaining({ description: 'id LDR-2' }))
  })

  it('copies the report id and leaves the toast up', async () => {
    ;(submitLabDataReport as jest.Mock).mockResolvedValue({ ok: true, reportId: 'LDR-3' })
    const writeText = jest.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      await sendLabDataReportInBackground({ base }, strings)
      const copyClick = { preventDefault: jest.fn() }
      ;(toast.success as jest.Mock).mock.calls[0][1].action.onClick(copyClick)
      expect(copyClick.preventDefault).toHaveBeenCalled()
      expect(writeText).toHaveBeenCalledWith('LDR-3')
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  describe('to the team and the institution (?site=vghtpe)', () => {
    const both = {
      ...strings,
      institutionReceived: 'hospital {id}',
      institutionSkipped: 'hospital not set up',
      inDestination: (destination: string, text: string) => `${destination}: ${text}`,
    }
    const answer = (results: Record<string, unknown>) =>
      (submitLabDataReport as jest.Mock).mockImplementation((_payload, { destination }) => Promise.resolve(results[destination]))

    it('sends the same payload to both and gives both receipts', async () => {
      answer({ team: { ok: true, reportId: 'LDR-1' }, institution: { ok: true, reportId: 'GW-7' } })
      const result = await sendLabDataReportInBackground({ base, destinations: ['team', 'institution'] }, both)
      expect(result).toEqual({ team: { ok: true, reportId: 'LDR-1' }, institution: { ok: true, reportId: 'GW-7' } })
      const calls = (submitLabDataReport as jest.Mock).mock.calls
      expect(calls.map(([, options]) => options.destination)).toEqual(['team', 'institution'])
      expect(calls[1][0]).toBe(calls[0][0])
      expect(toast.success).toHaveBeenCalledWith('done', expect.objectContaining({ description: 'id LDR-1\nhospital GW-7' }))
    })

    it('retries only where it failed, keeping the receipt it already has', async () => {
      answer({ team: { ok: true, reportId: 'LDR-1' }, institution: { ok: false, status: 'network' } })
      await sendLabDataReportInBackground({ base, destinations: ['team', 'institution'] }, both)
      const [message, options] = (toast.error as jest.Mock).mock.calls[0]
      expect(message).toBe('institution: failed')
      expect(options.description).toBe('id LDR-1')

      answer({ institution: { ok: true, reportId: 'GW-8' } })
      await options.action.onClick({ preventDefault: jest.fn() })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const calls = (submitLabDataReport as jest.Mock).mock.calls
      expect(calls).toHaveLength(3)
      expect(calls[2][1]).toEqual({ destination: 'institution' })
      expect(toast.success).toHaveBeenCalledWith('done', expect.objectContaining({ description: 'id LDR-1\nhospital GW-8' }))
    })

    it('names both destinations when both fail', async () => {
      answer({ team: { ok: false, status: 500 }, institution: { ok: false, status: 'timeout' } })
      await sendLabDataReportInBackground({ base, destinations: ['team', 'institution'] }, both)
      expect((toast.error as jest.Mock).mock.calls[0][0]).toBe('team: failed\ninstitution: failed')
    })

    it('says the institution was left out when it has no Gateway', async () => {
      answer({ team: { ok: true, reportId: 'LDR-1' } })
      await sendLabDataReportInBackground({ base, destinations: ['team'], institutionSkipped: true }, both)
      expect(submitLabDataReport).toHaveBeenCalledTimes(1)
      expect(toast.success).toHaveBeenCalledWith('done', expect.objectContaining({ description: 'id LDR-1\nhospital not set up' }))
    })

    it('names the institution on its own failure, and copies its id on success', async () => {
      answer({ institution: { ok: false, status: 'network' } })
      await sendLabDataReportInBackground({ base, destinations: ['institution'] }, both)
      expect((toast.error as jest.Mock).mock.calls[0][0]).toBe('institution: failed')
      expect((submitLabDataReport as jest.Mock).mock.calls.map(([, options]) => options.destination)).toEqual(['institution'])

      answer({ institution: { ok: true, reportId: 'GW-9' } })
      const writeText = jest.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      try {
        await sendLabDataReportInBackground({ base, destinations: ['institution'] }, both)
        ;(toast.success as jest.Mock).mock.calls[0][1].action.onClick({ preventDefault: jest.fn() })
        expect(writeText).toHaveBeenCalledWith('GW-9')
      } finally {
        delete (navigator as { clipboard?: unknown }).clipboard
      }
    })
  })
})
