import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LabDataReportDialog } from '@/features/lab-data-report/components/LabDataReportDialog'
import { submitLabDataReport } from '@/features/lab-data-report/utils/submit-lab-data-report'
import { toast } from 'sonner'

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: jest.requireActual('@/src/shared/i18n/locales/zh-TW').zhTW,
  }),
}))
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/shared/hooks/use-app-version.hook', () => ({
  useAppVersion: () => '9.9.9',
}))
jest.mock('@/src/application/telemetry/launch-context', () => ({
  detectLaunchSource: () => Promise.resolve('import'),
  detectSite: () => 'unknown',
}))
jest.mock('@/features/lab-data-report/utils/submit-lab-data-report', () => ({
  submitLabDataReport: jest.fn(),
  testLabDataReportConnection: jest.fn(),
  resolveInstitutionReportUrl: jest.fn(() => null),
}))
jest.mock('sonner', () => ({
  toast: { loading: jest.fn(() => 'report-toast'), success: jest.fn(), error: jest.fn() },
}))

const LOINC = 'http://loinc.org'
const urineRow = (id: string, date: string, loinc: string, text: string, value: number) => ({
  resourceType: 'Observation',
  id,
  status: 'final',
  subject: { reference: 'Patient/SECRET' },
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text, coding: [{ system: LOINC, code: loinc }] },
  specimen: { display: 'Urine' },
  effectiveDateTime: date,
  valueQuantity: { value, unit: 'g/dL' },
})

const observations = [
  urineRow('a', '2026-03-01T09:30:00+08:00', '718-7', 'Hb', 13.2),
  urineRow('b', '2026-02-01', '718-7', 'Hb', 12.9),
  urineRow('c', '2026-03-01', '777-3', 'PLT', 250),
]

const onOpenChange = jest.fn()

async function renderDialog() {
  const result = render(
    <LabDataReportDialog
      open
      onOpenChange={onOpenChange}
      panels={[{ id: 'cbc', label: '血液' }, { id: 'urine', label: '尿液' }]}
      observations={observations}
      nameMode="standardized"
    />,
  )
  // Let the launch-source lookup settle inside act().
  await act(async () => {})
  return result
}

describe('LabDataReportDialog', () => {
  beforeEach(() => {
    (submitLabDataReport as jest.Mock).mockReset()
    ;(toast.loading as jest.Mock).mockClear()
    ;(toast.success as jest.Mock).mockClear()
    ;(toast.error as jest.Mock).mockClear()
    onOpenChange.mockClear()
  })

  it('sends in two presses with nothing filled in: 送出 → 確定送出', async () => {
    ;(submitLabDataReport as jest.Mock).mockResolvedValue({ ok: true, reportId: 'LDR-20260927-ABCDEF12' })
    await renderDialog()
    expect(screen.getByText(/會把這位病人累積報告的全部 3 筆檢驗（格式與數值）傳給開發團隊除錯/)).toBeInTheDocument()
    // Focus lands on 送出, so Enter would do too.
    expect(screen.getByRole('button', { name: '送出 3 筆' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '送出 3 筆' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('確定送出這 3 筆檢驗資料（含數值）？')).toBeInTheDocument()
    expect(submitLabDataReport).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    // The dialog closes at once; the report finishes in the background and
    // answers with a toast carrying the report id.
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.loading).toHaveBeenCalledWith('回報送出中…')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已送出，謝謝回報', expect.objectContaining({
      id: 'report-toast',
      description: '回報編號 LDR-20260927-ABCDEF12',
      action: expect.objectContaining({ label: '複製' }),
    })))
    const payload = (submitLabDataReport as jest.Mock).mock.calls[0][0]
    expect(payload).toEqual(expect.objectContaining({
      problemType: 'unspecified',
      description: '',
      includesValues: true,
    }))
    expect(payload.context).toEqual(expect.objectContaining({ appVersion: '9.9.9', dataSource: 'import' }))
    expect(payload.rows).toHaveLength(3)
    expect(JSON.stringify(payload)).not.toContain('SECRET')
  })

  it('carries the optional type and note, and blocks a note with an identifier', async () => {
    ;(submitLabDataReport as jest.Mock).mockResolvedValue({ ok: true, reportId: 'LDR-20260927-ABCDEF12' })
    await renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '分錯類' }))
    expect(screen.getByRole('button', { name: '分錯類' })).toHaveAttribute('aria-pressed', 'true')

    const note = screen.getByLabelText('一句話說明（可不填，勿填病人資料）')
    fireEvent.change(note, { target: { value: '病歷號 12345678' } })
    expect(screen.getByText(/說明裡似乎有長串數字/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '送出 3 筆' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.change(note, { target: { value: 'Hb 和 PLT 出現在尿液' } })
    // Enter in the note goes straight to the confirmation.
    fireEvent.keyDown(note, { key: 'Enter' })
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '確定送出' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect((submitLabDataReport as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      problemType: 'wrong-panel',
      description: 'Hb 和 PLT 出現在尿液',
    }))
  })

  it('says "without values" when the values box is unticked', async () => {
    await renderDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: '附上檢驗數值' }))
    expect(screen.getByText(/全部 3 筆檢驗（只有格式、不含數值）/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '送出 3 筆' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('確定送出這 3 筆檢驗資料（不含數值）？')).toBeInTheDocument()
  })

  it('keeps the per-row preview and full disclosure one click away', async () => {
    await renderDialog()
    expect(screen.queryByRole('region', { name: '將送出的資料列' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '詳細說明' }))
    expect(screen.getByText(/傳給醫析開發團隊/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '預覽要送出的 3 筆' }))
    const table = screen.getByRole('region', { name: '將送出的資料列' })
    expect(within(table).getAllByRole('row')).toHaveLength(4) // header + 3
    expect(within(table).getAllByText(/檢體為尿液/)).toHaveLength(3)
  })

  it('offers only panels with rows as chips and sends the ticked ones; a failure offers 重試 with the same report', async () => {
    ;(submitLabDataReport as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, reportId: 'LDR-20260927-ABCDEF12' })
    await renderDialog()
    // 血液 has no rows in this patient, so it is not offered.
    expect(screen.queryByRole('button', { name: '血液' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '尿液' }))
    expect(screen.getByRole('button', { name: '尿液' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '送出 3 筆' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '確定送出' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('這台裝置送出次數過多，請一小時後再試。', expect.objectContaining({
      id: 'report-toast',
      action: expect.objectContaining({ label: '重試' }),
    })))
    const first = (submitLabDataReport as jest.Mock).mock.calls[0][0]
    expect(first.scope.flaggedCategories).toEqual(['urine'])
    // 重試 sends the very same report (the Function dedupes a resend).
    await act(async () => { (toast.error as jest.Mock).mock.calls[0][1].action.onClick({ preventDefault: jest.fn() }) })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect((submitLabDataReport as jest.Mock).mock.calls[1][0]).toBe(first)
  })
})
