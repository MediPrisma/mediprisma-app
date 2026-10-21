// 送給 on the 北榮 route: 團隊和機構 (default) / 僅機構 / 僅連線測試. The
// institution is the hospital's Gateway, contacted only once a build names it.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LabDataReportDialog } from '@/features/lab-data-report/components/LabDataReportDialog'
import {
  resolveInstitutionReportUrl,
  submitLabDataReport,
  testLabDataReportConnection,
} from '@/features/lab-data-report/utils/submit-lab-data-report'
import { toast } from 'sonner'

let mockSite = 'vghtpe'
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
  detectSite: () => mockSite,
}))
jest.mock('@/features/lab-data-report/utils/submit-lab-data-report', () => ({
  submitLabDataReport: jest.fn(),
  testLabDataReportConnection: jest.fn(),
  resolveInstitutionReportUrl: jest.fn(),
}))
jest.mock('sonner', () => ({
  toast: { loading: jest.fn(() => 'report-toast'), success: jest.fn(), error: jest.fn() },
}))

const observations = [{
  resourceType: 'Observation',
  id: 'a',
  status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text: 'Hb', coding: [{ system: 'http://loinc.org', code: '718-7' }] },
  effectiveDateTime: '2026-03-01T09:30:00+08:00',
  valueQuantity: { value: 13.2, unit: 'g/dL' },
}]

async function renderDialog() {
  const result = render(
    <LabDataReportDialog
      open
      onOpenChange={jest.fn()}
      panels={[{ id: 'cbc', label: '血液' }]}
      observations={observations}
      nameMode="standardized"
    />,
  )
  await act(async () => {})
  return result
}

const destinationsSent = () => (submitLabDataReport as jest.Mock).mock.calls.map(([, options]) => options.destination)

async function sendAndConfirm(confirmText?: string) {
  fireEvent.click(screen.getByRole('button', { name: '送出 1 筆' }))
  const confirm = await screen.findByRole('alertdialog')
  if (confirmText) expect(within(confirm).getByText(confirmText)).toBeInTheDocument()
  fireEvent.click(within(confirm).getByRole('button', { name: '確定送出' }))
  await waitFor(() => expect(toast.success).toHaveBeenCalled())
}

describe('LabDataReportDialog — 送給 on ?site=vghtpe', () => {
  beforeEach(() => {
    mockSite = 'vghtpe'
    jest.clearAllMocks()
    ;(resolveInstitutionReportUrl as jest.Mock).mockReturnValue(null)
    ;(submitLabDataReport as jest.Mock).mockImplementation((_payload, { destination }) =>
      Promise.resolve({ ok: true, reportId: destination === 'team' ? 'LDR-1' : 'GW-1' }))
  })

  it('is not asked anywhere else', async () => {
    mockSite = 'unknown'
    await renderDialog()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await sendAndConfirm()
    expect(destinationsSent()).toEqual(['team'])
  })

  it('offers the three choices, 團隊和機構 first and chosen', async () => {
    await renderDialog()
    const group = screen.getByRole('group', { name: '送給' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(['團隊和機構（建議）', '僅機構', '僅連線測試'])
    expect(within(group).getByRole('radio', { name: '團隊和機構（建議）' })).toBeChecked()
  })

  describe('before the hospital Gateway is set up', () => {
    it('says so, and 團隊和機構 sends to the team alone', async () => {
      await renderDialog()
      expect(screen.getByText('院內收件端尚未啟用：「團隊和機構」目前只會送給開發團隊，「僅機構」暫時無法送出。')).toBeInTheDocument()
      expect(screen.getByText(/傳給開發團隊除錯；不含姓名/)).toBeInTheDocument()
      await sendAndConfirm('院內收件端尚未啟用，這次只送給開發團隊。')
      expect(destinationsSent()).toEqual(['team'])
      expect(toast.success).toHaveBeenCalledWith('已送出，謝謝回報', expect.objectContaining({
        description: '回報編號 LDR-1\n院內收件端尚未啟用，這次只送給開發團隊。',
      }))
    })

    it('cannot send 僅機構', async () => {
      await renderDialog()
      fireEvent.click(screen.getByRole('radio', { name: '僅機構' }))
      expect(screen.getByRole('button', { name: '送出 1 筆' })).toBeDisabled()
    })

    it('discloses the team alone while 團隊和機構 goes to the team alone', async () => {
      await renderDialog()
      fireEvent.click(screen.getByRole('button', { name: '詳細說明' }))
      expect(screen.getByText(/傳給醫析開發團隊。/)).toBeInTheDocument()
      expect(screen.queryByText(/院內收件端，由院方保存與管理/)).not.toBeInTheDocument()
    })
  })

  describe('once the hospital Gateway is set up', () => {
    beforeEach(() => {
      ;(resolveInstitutionReportUrl as jest.Mock).mockReturnValue('https://gateway.example.test/lab-reports')
    })

    it('團隊和機構 sends the same report to both', async () => {
      await renderDialog()
      expect(screen.queryByText(/院內收件端尚未啟用/)).not.toBeInTheDocument()
      expect(screen.getByText(/傳給開發團隊除錯，同一份也送到院內收件端/)).toBeInTheDocument()
      await sendAndConfirm('開發團隊與院內收件端各收到一份。')
      expect(destinationsSent()).toEqual(['team', 'institution'])
      const [[team], [institution]] = (submitLabDataReport as jest.Mock).mock.calls
      expect(institution).toBe(team)
      expect(toast.success).toHaveBeenCalledWith('已送出，謝謝回報', expect.objectContaining({
        description: '回報編號 LDR-1\n院內收件端已收到（編號 GW-1）。',
      }))
    })

    it('僅機構 sends to the institution alone, and says the team will not get it', async () => {
      await renderDialog()
      fireEvent.click(screen.getByRole('radio', { name: '僅機構' }))
      expect(screen.getByText(/只會把這位病人累積報告的全部 1 筆檢驗（格式與數值）送到院內收件端，開發團隊收不到/)).toBeInTheDocument()
      await sendAndConfirm('只送院內收件端。')
      expect(destinationsSent()).toEqual(['institution'])
    })

    it('words the full disclosure for where the report goes', async () => {
      await renderDialog()
      fireEvent.click(screen.getByRole('button', { name: '詳細說明' }))
      // 團隊和機構: the team's text, and which copy its 90 days are about.
      expect(screen.getByText(/傳給醫析開發團隊。/)).toBeInTheDocument()
      expect(screen.getByText(/指的是開發團隊那一份/)).toBeInTheDocument()

      // 僅機構: nothing that says the team gets it, reads it or deletes it.
      fireEvent.click(screen.getByRole('radio', { name: '僅機構' }))
      expect(screen.getByText(/只送到院內收件端，醫析開發團隊收不到/)).toBeInTheDocument()
      expect(screen.queryByText(/只有開發團隊可讀取/)).not.toBeInTheDocument()
      expect(screen.queryByText(/傳給醫析開發團隊/)).not.toBeInTheDocument()
    })
  })

  describe('僅連線測試', () => {
    it('sends no report, tests each destination, and skips one not set up', async () => {
      ;(testLabDataReportConnection as jest.Mock).mockImplementation((destination) =>
        Promise.resolve(destination === 'team' ? { ok: true } : { ok: false, status: 'unconfigured' }))
      await renderDialog()
      fireEvent.click(screen.getByRole('radio', { name: '僅連線測試' }))
      // The report form steps aside: nothing about the patient is involved.
      expect(screen.queryByLabelText('一句話說明（可不填，勿填病人資料）')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /送出/ })).not.toBeInTheDocument()
      expect(screen.getByText('不送任何病歷資料，只測試能否連到開發團隊的回報服務與院內收件端。')).toBeInTheDocument()

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '測試連線' })) })
      const results = screen.getByRole('status')
      expect(within(results).getByText('開發團隊').closest('li')).toHaveTextContent('連線正常')
      expect(within(results).getByText('院內收件端').closest('li')).toHaveTextContent('尚未啟用，未連線')
      expect((testLabDataReportConnection as jest.Mock).mock.calls.map(([destination]) => destination)).toEqual(['team', 'institution'])
      expect(submitLabDataReport).not.toHaveBeenCalled()
      expect(toast.loading).not.toHaveBeenCalled()
    })

    it('says why a destination failed', async () => {
      ;(resolveInstitutionReportUrl as jest.Mock).mockReturnValue('https://gateway.example.test/lab-reports')
      ;(testLabDataReportConnection as jest.Mock).mockImplementation((destination) =>
        Promise.resolve(destination === 'team' ? { ok: false, status: 401 } : { ok: false, status: 'network' }))
      await renderDialog()
      fireEvent.click(screen.getByRole('radio', { name: '僅連線測試' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '測試連線' })) })
      const results = screen.getByRole('status')
      expect(within(results).getByText('開發團隊').closest('li')).toHaveTextContent('連線失敗：無法驗證登入狀態')
      expect(within(results).getByText('院內收件端').closest('li')).toHaveTextContent('連線失敗：連不上')
    })
  })
})
