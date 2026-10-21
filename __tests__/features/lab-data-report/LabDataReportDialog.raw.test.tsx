import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { LabDataReportDialog } from '@/features/lab-data-report/components/LabDataReportDialog'
import { submitLabDataReport } from '@/features/lab-data-report/utils/submit-lab-data-report'
import { readRawLabRows } from '@/features/lab-data-report/utils/read-raw-lab-rows'
import { extractRawLabRows } from '@/features/lab-data-report/utils/raw-lab-rows'

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
  detectLaunchSource: () => Promise.resolve('medcloud2'),
  detectSite: () => 'vghtpe',
}))
jest.mock('@/features/lab-data-report/utils/submit-lab-data-report', () => ({
  submitLabDataReport: jest.fn(),
  testLabDataReportConnection: jest.fn(),
  resolveInstitutionReportUrl: jest.fn(() => null),
}))
jest.mock('sonner', () => ({
  toast: { loading: jest.fn(() => 'report-toast'), success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/features/lab-data-report/utils/read-raw-lab-rows', () => ({
  importedBundleId: jest.fn(() => Promise.resolve('bundle-1')),
  readRawLabRows: jest.fn(),
}))

const SD = 'https://cloud-wildcatch.invalid/fhir/StructureDefinition/'
const observations = [{
  resourceType: 'Observation',
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text: 'Hb', coding: [{ system: 'http://loinc.org', code: '718-7' }] },
  specimen: { display: 'Blood' },
  effectiveDateTime: '2026-03-02T09:30:00+08:00',
  valueQuantity: { value: 11.2, unit: 'g/dL' },
  extension: [{ url: `${SD}medcloud-source-data-mark`, valueString: 'S' }],
  meta: { tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/adapter-version', code: '0.12.19' }] },
}]

// Synthetic capture: two raw rows, one of them never converted.
const extract = extractRawLabRows(JSON.stringify({
  patient: 'F203XXX511',
  endpoints: {
    '/imu/api/imue0060/imue0060s02/get-data': {
      status: 200,
      body: JSON.stringify({
        robject: [
          { r: 1, order_code: '08003C', assay_item_name: 'Hb', assay_value: '11.2', unit_data: 'g/dL', case_time: '2026-03-02T09:30:00+08:00', hosp: '合成醫院甲', hosp_id: '0601160016', icd_code: 'Z00.0' },
          { r: 2, order_code: '09005C', assay_item_name: 'Glu AC', assay_value: '98', unit_data: 'mg/dL', case_time: '2026-03-02T09:30:00+08:00', hosp: '合成醫院甲' },
        ],
      }),
    },
  },
}))!

async function renderDialog(open = true, rows: any[] = observations) {
  const view = render(
    <LabDataReportDialog
      open={open}
      onOpenChange={() => {}}
      panels={[{ id: 'cbc', label: '血液' }]}
      observations={rows}
      nameMode="standardized"
    />,
  )
  await act(async () => {})
  return view
}

describe('LabDataReportDialog — MediCloud raw rows', () => {
  beforeEach(() => {
    ;(submitLabDataReport as jest.Mock).mockReset().mockResolvedValue({ ok: true, reportId: 'LDR-20260929-ABCDEF12' })
    ;(readRawLabRows as jest.Mock).mockReset()
    ;(toast.success as jest.Mock).mockClear()
    ;(toast.loading as jest.Mock).mockClear()
  })

  const sent = async () => {
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    return (submitLabDataReport as jest.Mock).mock.calls[0][0]
  }

  it('offers the raw rows ticked, reads them only on 送出, and says how many go', async () => {
    ;(readRawLabRows as jest.Mock).mockResolvedValue({ ok: true, extract, expiresAt: Date.now() + 60_000, producerVersion: '0.12.19' })
    await renderDialog()
    expect(screen.getByRole('checkbox', { name: '附上雲端病歷原始檢驗列' })).toBeChecked()
    expect(screen.getByText(/另附雲端病歷原始檢驗列（按送出時讀取）/)).toBeInTheDocument()
    expect(readRawLabRows).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    expect(readRawLabRows).toHaveBeenCalledWith('bundle-1', expect.anything())
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('另附 2 列雲端病歷原始檢驗列。')).toBeInTheDocument()
    expect(submitLabDataReport).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    const payload = await sent()
    expect(payload.rawSource).toEqual(expect.objectContaining({ producer: 'medcloud2', producerVersion: '0.12.19', s02Rows: 2 }))
    expect(payload.rawSource.rows.map((row: any) => row.fields.order_code)).toEqual(['08003C', '09005C'])
    // Same day axis as the converted rows: both are day 0.
    expect(payload.rows[0].day).toBe(0)
    expect(payload.rawSource.rows[0].dates.case_time).toEqual({ day: 0, time: '09:30:00' })
    const json = JSON.stringify(payload)
    for (const secret of ['F203XXX511', '0601160016', 'Z00.0', '2026-03-02']) expect(json).not.toContain(secret)
  })

  it('sends the converted rows alone, and says why, when the raw read fails', async () => {
    ;(readRawLabRows as jest.Mock).mockResolvedValue({ ok: false, code: 'PATIENT_UNVERIFIED' })
    await renderDialog()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/雲端病歷原始資料無法取得（雲端病歷分頁已關閉，或無法確認病人），這次只送轉換後的結果/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    const payload = await sent()
    expect(payload.rawSource).toBeUndefined()
    expect(payload.rawSourceError).toBe('PATIENT_UNVERIFIED')
    expect(payload.rows).toHaveLength(1)
  })

  it('does not read anything when the box is unticked', async () => {
    await renderDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: '附上雲端病歷原始檢驗列' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    const payload = await sent()
    expect(readRawLabRows).not.toHaveBeenCalled()
    expect(payload.rawSource).toBeUndefined()
    expect(payload.rawSourceError).toBeUndefined()
  })

  it('withholds raw values with the converted ones', async () => {
    ;(readRawLabRows as jest.Mock).mockResolvedValue({ ok: true, extract, expiresAt: Date.now() + 60_000 })
    await renderDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: '附上檢驗數值' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    const payload = await sent()
    expect(payload.rawSource.rows[0].results).toEqual({})
    expect(payload.rawSource.rows[0].withheld).toEqual({ assay_value: 4 })
  })

  it('offers nothing — and waits for nothing — when the data came from an older extension', async () => {
    const older = observations.map((row) => ({
      ...row,
      meta: { tag: [{ system: 'https://cloud-wildcatch.invalid/fhir/CodeSystem/adapter-version', code: '0.12.13' }] },
    }))
    await renderDialog(true, older)
    expect(screen.queryByRole('checkbox', { name: '附上雲端病歷原始檢驗列' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    expect(toast.loading).not.toHaveBeenCalledWith('讀取雲端病歷原始資料並送出回報中…')
    const payload = await sent()
    expect(readRawLabRows).not.toHaveBeenCalled()
    expect(payload.rawSource).toBeUndefined()
    expect(payload.rawSourceError).toBeUndefined()
  })

  it('opens the confirmation without waiting for the raw read, and sends it once read', async () => {
    let finish: (value: unknown) => void = () => {}
    ;(readRawLabRows as jest.Mock).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const view = await renderDialog()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('另附雲端病歷原始檢驗列（正在讀取，可直接確定送出）')).toBeInTheDocument()
    // 確定送出 at once: the dialog closes, the background waits for the read.
    fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
    expect(toast.loading).toHaveBeenCalledWith('讀取雲端病歷原始資料並送出回報中…')
    expect(submitLabDataReport).not.toHaveBeenCalled()
    // The read now belongs to the background send: closing does not abort it.
    view.unmount()
    expect((readRawLabRows as jest.Mock).mock.calls[0][1].signal.aborted).toBe(false)
    await act(async () => { finish({ ok: true, extract, expiresAt: Date.now() + 60_000, producerVersion: '0.12.19' }) })
    const payload = await sent()
    expect(payload.rawSource.rows).toHaveLength(2)
    expect(readRawLabRows).toHaveBeenCalledTimes(1)
  })

  it('abandons the raw read when the dialog closes before 確定送出', async () => {
    ;(readRawLabRows as jest.Mock).mockReturnValue(new Promise(() => {}))
    const view = await renderDialog()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' })) })
    await screen.findByRole('alertdialog')
    const { signal } = (readRawLabRows as jest.Mock).mock.calls[0][1]
    expect(signal.aborted).toBe(false)
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(toast.loading).not.toHaveBeenCalled()
    expect(submitLabDataReport).not.toHaveBeenCalled()
  })

  it('previews the raw rows on request, before anything is sent', async () => {
    ;(readRawLabRows as jest.Mock).mockResolvedValue({ ok: true, extract, expiresAt: Date.now() + 60_000 })
    await renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '預覽要送出的 1 筆' }))
    expect(screen.getByText('原始檢驗列會在按「送出」時讀取。')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '讀取原始列預覽' })) })
    expect(screen.getByText('雲端病歷原始檢驗列 2 列')).toBeInTheDocument()
    const table = screen.getByRole('region', { name: '將送出的原始檢驗列' })
    expect(within(table).getByText('Glu AC')).toBeInTheDocument()
    expect(submitLabDataReport).not.toHaveBeenCalled()
  })
})
