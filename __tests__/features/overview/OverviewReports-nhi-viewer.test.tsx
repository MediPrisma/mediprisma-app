/**
 * 總覽's 影像／檢查報告 rows must offer the same 健保影像 action the 報告 tab's
 * imaging rows do — the overview is where a clinician actually starts, and a
 * study whose viewer is only reachable two tabs away is a study they will not
 * open.
 */
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { OverviewCard } from '@/features/clinical-summary/overview'
import { useOverviewData } from '@/features/clinical-summary/overview/hooks/useOverviewData'
import {
  NHI_VIEWER_REQUEST_EXTENSION_URL,
  requestNhiViewerOpen,
} from '@/features/clinical-summary/reports/utils/nhi-viewer-request'

jest.mock('@/src/shared/hooks/use-now.hook', () => ({
  useNow: () => new Date('2026-06-15T09:00:00+08:00').getTime(),
}))

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})

jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: null, anonymousUid: null }),
}))

jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ setActiveTab: jest.fn(), revealTab: jest.fn() }),
}))

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/features/clinical-summary/reports/utils/nhi-viewer-request', () => ({
  ...jest.requireActual('@/features/clinical-summary/reports/utils/nhi-viewer-request'),
  requestNhiViewerOpen: jest.fn(),
}))

const mockUseClinicalData = jest.fn()
jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => mockUseClinicalData(),
}))

const viewerExtension = (seq: string) => ({
  url: NHI_VIEWER_REQUEST_EXTENSION_URL,
  extension: [
    { url: 'version', valueInteger: 1 },
    { url: 'proc-id', valueCode: 'IMUE0130' },
    { url: 'patient-context-hash', valueString: 'd'.repeat(64) },
    { url: 'ipl-case-seq-no', valueString: seq },
  ],
})

/** Two of these on one day share an NHI order code, so they cluster. */
const imagingReport = ({
  id,
  seq,
  conclusion,
}: {
  id: string
  seq?: string
  conclusion?: string
}) => ({
  resourceType: 'DiagnosticReport',
  id,
  status: 'final',
  code: {
    coding: [{
      system: 'https://nhi-fhir-bridge.local/CodeSystem/his-local-report',
      code: '33070B',
      display: '電腦斷層造影  －  無造影劑',
    }],
    text: '電腦斷層造影  －  無造影劑',
  },
  category: [{ coding: [{
    system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
    code: 'RAD',
    display: 'Radiology',
  }] }],
  effectiveDateTime: '2026-06-02T00:00:00+08:00',
  performer: [{ display: '示範長青醫院' }],
  ...(conclusion ? { conclusion } : {}),
  ...(seq ? { extension: [viewerExtension(seq)] } : {}),
})

const emptyChart = {
  encounters: [],
  medications: [],
  diagnosticReports: [],
  imagingStudies: [],
  observations: [],
  procedures: [],
  conditions: [],
  documentReferences: [],
  compositions: [],
  resourceReady: new Proxy({}, { get: () => true }) as Record<string, boolean>,
  error: null,
}

const reportsCard = () => document.getElementById('overview-section-reports') as HTMLElement

describe('總覽 影像／檢查報告 — 健保影像 actions', () => {
  it.each([
    ['2026-06-24', '2026-06-25', 0],
    ['2026-06-25', '2026-06-24', 1],
  ])('uses the examination period %s rather than signing date %s for the window', (examDay, issued, count) => {
    mockUseClinicalData.mockReturnValue({ ...emptyChart, diagnosticReports: [{
      ...imagingReport({ id: 'period-report', conclusion: 'Synthetic normal chest findings.' }),
      effectiveDateTime: undefined, effectivePeriod: { start: examDay }, issued,
    }] })
    const { result } = renderHook(() => useOverviewData({ months: 3, startDay: '2026-06-25', endDay: '2026-06-25' }))
    expect(result.current.reports.count).toBe(count)
    expect(result.current.latestDataDay).toBe(examDay)
  })

  const originalResizeObserver = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })
  afterAll(() => { globalThis.ResizeObserver = originalResizeObserver })
  beforeEach(() => { jest.clearAllMocks() })

  const oneReportWithViewer = () => {
    mockUseClinicalData.mockReturnValue({
      ...emptyChart,
      diagnosticReports: [imagingReport({
        id: 'ct-with-viewer',
        seq: 'CASE-OVERVIEW',
        conclusion: 'No acute intracranial haemorrhage.',
      })],
    })
  }

  it('opens the viewer from the type badge and leaves the row one target', async () => {
    ;(requestNhiViewerOpen as jest.Mock).mockResolvedValue({ ok: true })
    oneReportWithViewer()
    render(<OverviewCard />)

    const card = within(reportsCard())
    // The badge is the entry; no second 健保影像 button competing with it.
    expect(card.queryByText(/健保影像/)).not.toBeInTheDocument()
    // Never render the Viewer URL itself — the request carries no URL at all.
    expect(document.body.innerHTML).not.toContain('nhi.gov.tw')

    const badge = card.getByRole('button', { name: '開啟 DICOM Viewer（健保影像）' })
    expect(badge).toHaveTextContent('影像')

    fireEvent.click(badge)
    await waitFor(() => expect(requestNhiViewerOpen).toHaveBeenCalledTimes(1))
    expect(requestNhiViewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ iplCaseSeqNo: 'CASE-OVERVIEW' }),
    )
    // Opening the images must not also open the narrative.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says what the viewer needs before it is pressed, without bloating the name', async () => {
    oneReportWithViewer()
    render(<OverviewCard />)

    const badge = within(reportsCard()).getByRole('button', {
      name: '開啟 DICOM Viewer（健保影像）',
    })
    // A native `title` waits out the browser's 1–2s dwell, by which point the
    // reader has clicked and met the failure toast instead.
    expect(badge).not.toHaveAttribute('title')

    fireEvent.focus(badge)
    // The app has no status channel to 雲端病歷, so this bubble is the only
    // place the precondition can be stated ahead of the failure toast.
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('需同時開著該病人的健保雲端病歷')
    // …but a screen reader must not read the caveat on every imaging row.
    expect(badge).toHaveAccessibleName('開啟 DICOM Viewer（健保影像）')
  })

  it('still opens the narrative from the rest of the row', () => {
    oneReportWithViewer()
    render(<OverviewCard />)

    fireEvent.click(within(reportsCard()).getByRole('button', { name: '展開報告全文' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getAllByText('No acute intracranial haemorrhage.').length).toBeGreaterThan(0)
    expect(dialog.getByRole('button', {
      name: '開啟 DICOM Viewer（健保影像）',
    })).toBeInTheDocument()
  })

  it('reaches the viewer even when the study carries no report text at all', async () => {
    ;(requestNhiViewerOpen as jest.Mock).mockResolvedValue({ ok: true })
    mockUseClinicalData.mockReturnValue({
      ...emptyChart,
      diagnosticReports: [imagingReport({ id: 'images-only', seq: 'CASE-NO-TEXT' })],
    })
    render(<OverviewCard />)

    const card = within(reportsCard())
    // Nothing to expand — the badge is the ONLY way in, so it must be there.
    expect(card.queryByRole('button', { name: '展開報告全文' })).not.toBeInTheDocument()
    fireEvent.click(card.getByRole('button', { name: '開啟 DICOM Viewer（健保影像）' }))
    await waitFor(() => expect(requestNhiViewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ iplCaseSeqNo: 'CASE-NO-TEXT' }),
    ))
  })

  it('opens the first study of a merged cluster and keeps the choice in the report', async () => {
    ;(requestNhiViewerOpen as jest.Mock).mockResolvedValue({ ok: true })
    mockUseClinicalData.mockReturnValue({
      ...emptyChart,
      diagnosticReports: [
        imagingReport({ id: 'ct-head', seq: 'CASE-HEAD', conclusion: 'Head CT.' }),
        imagingReport({ id: 'ct-chest', seq: 'CASE-CHEST', conclusion: 'Chest CT.' }),
      ],
    })
    render(<OverviewCard />)

    // One merged row (the bridge cannot pair report to image set). The badge
    // says so and opens the first; the row stays a single target.
    const card = within(reportsCard())
    const badge = card.getByRole('button', { name: '開啟健保影像 1，共 2 筆中的第 1 筆' })

    // The ordinal belongs to the accessible name, which has nothing else to go
    // on. In the visible bubble it is just clutter over a row the reader is
    // scanning, so the two labels are deliberately NOT the same string.
    fireEvent.focus(badge)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('開啟 DICOM Viewer（健保影像）')
    expect(tooltip).not.toHaveTextContent('共 2 筆')
    fireEvent.blur(badge)

    fireEvent.click(badge)
    await waitFor(() => expect(requestNhiViewerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ iplCaseSeqNo: 'CASE-HEAD' }),
    ))

    // Choosing the OTHER body part lives one level in, where it can be labelled.
    fireEvent.click(card.getByRole('button', { name: '展開報告全文' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', {
      name: '開啟健保影像 1，共 2 筆中的第 1 筆',
    })).toHaveTextContent('健保影像 2')
    expect(dialog.getByRole('button', { name: '選擇健保影像，共 2 筆' })).toBeInTheDocument()
  })
})
