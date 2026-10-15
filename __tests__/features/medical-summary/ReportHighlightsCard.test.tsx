/** @jest-environment jsdom */
// 影像與病理重點 rendering: one row per organ, points with app-written source
// chips, verified quotes behind an expand control, the 原文 tag where the line
// dropped the report's uncertainty, the collapsed footer, and the fallback
// when no key-findings summary exists. Synthetic fixtures only.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReportHighlightsCard, reportChipDate } from '@/features/medical-summary/components/ReportHighlightsCard'
import type {
  ReportFindingSource,
  ReportHighlights,
  ReportRow,
} from '@/src/core/entities/medical-summary.entity'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'

jest.mock('@/src/application/providers/language.provider', () => ({
  useOptionalLanguage: () => ({ locale: 'zh-TW' }),
}))

const ms = zhTW.medicalSummary
const LABELS = {
  title: ms.reportsTitle,
  kindLabels: ms.reportsKindLabels,
  originalTag: ms.reportsOriginalTag,
  showQuotes: ms.reportsShowQuotes,
  hideQuotes: ms.reportsHideQuotes,
  othersSummarized: ms.reportsOthers,
  othersAll: ms.reportsAll,
  unavailable: ms.reportsUnavailable,
  hiddenPoints: ms.reportsHiddenPoints,
  unverifiedTag: ms.reportsUnverifiedTag,
  hiddenPointsNote: ms.reportsHiddenPointsNote,
  conclusionTag: ms.reportsConclusionTag,
  openingTag: ms.reportsOpeningTag,
  moreSources: ms.reportsMoreSources,
}

const source = (key: string, kind: ReportFindingSource['kind'], date: string): ReportFindingSource => ({
  key,
  resourceType: 'DiagnosticReport',
  resourceId: `dr-${key}`,
  kind,
  date,
  title: `Report ${key}`,
  organization: '示範測試醫院',
})
const row = (key: string, kind: ReportRow['kind'], date: string, extra: Partial<ReportRow> = {}): ReportRow => ({
  ...source(key, kind, date),
  ...extra,
})

const XR1 = source('L1', 'xray', '2026-06-02')
const XR2 = source('L2', 'xray', '2026-05-25')
const ECHO = source('L3', 'echo', '2024-09-09')

const HIGHLIGHTS: ReportHighlights = {
  summarized: true,
  groups: [
    {
      organ: 'chest-lung',
      label: '肺部',
      points: [
        {
          // The model wrote a date into its line; the chips never read it.
          text: '2025-12-01 雙側下肺浸潤，反覆出現',
          displayAs: 'text',
          quotes: [{ key: 'L1', quote: 'Patchy lesions in bilateral lower lung field.' }],
          sources: [XR1, XR2],
        },
        {
          text: '支氣管擴張',
          displayAs: 'quote',
          quotes: [{ key: 'L2', quote: 'Suspicious for bronchiectasis over bilateral lower lung field.' }],
          sources: [XR2],
        },
      ],
    },
    {
      organ: 'heart',
      label: '心臟',
      points: [{
        text: '心臟擴大；舒張功能異常第 1 級',
        displayAs: 'text',
        quotes: [{ key: 'L3', quote: 'Grade I diastolic dysfunction.' }],
        sources: [XR1, ECHO],
      }],
    },
  ],
  others: [
    row('L4', 'ct', '2026-01-14'),
    row('L5', 'us', '2026-02-05'),
  ],
  totalReports: 5,
  droppedQuoteCount: 3,
  hiddenPointCount: 2,
  uncertaintyRewriteCount: 1,
}

describe('reportChipDate', () => {
  it('shortens dates in the newest year only', () => {
    expect(reportChipDate('2026-06-02', '2026')).toBe('06-02')
    expect(reportChipDate('2024-09-09', '2026')).toBe('2024-09-09')
    expect(reportChipDate(undefined, '2026')).toBe('—')
  })
})

describe('ReportHighlightsCard', () => {
  it('renders one row per organ with the app\'s labels and no subtitle', () => {
    const { container } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} />)
    expect(screen.getByRole('heading', { name: '影像與病理重點' })).toHaveTextContent(/^影像與病理重點$/)
    expect([...container.querySelectorAll('[data-report-organ]')].map((node) => node.getAttribute('data-report-organ')))
      .toEqual(['chest-lung', 'heart'])
    expect(screen.getByText('肺部')).toBeInTheDocument()
    expect(screen.getByText('心臟')).toBeInTheDocument()
  })

  it('shows the line as written and writes each chip from the report', () => {
    const { container } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} />)
    expect(screen.getByText('2025-12-01 雙側下肺浸潤，反覆出現')).toBeInTheDocument()
    const chips = [...container.querySelectorAll('[data-report-organ="chest-lung"] [data-report-chip]')]
      .map((chip) => chip.textContent)
    expect(chips).toEqual(['X-ray 06-02', 'X-ray 05-25', 'X-ray 05-25'])
    const heartChips = [...container.querySelectorAll('[data-report-organ="heart"] [data-report-chip]')]
      .map((chip) => chip.textContent)
    expect(heartChips).toEqual(['X-ray 06-02', 'Echo 2024-09-09'])
  })

  it('shows the quote, tagged 原文, where the line dropped the report\'s uncertainty', () => {
    const { container } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} />)
    const quotePoint = container.querySelector('[data-report-point="quote"]') as HTMLElement
    expect(within(quotePoint).getByText('原文')).toBeInTheDocument()
    expect(within(quotePoint).getByText('“Suspicious for bronchiectasis over bilateral lower lung field.”')).toBeInTheDocument()
    expect(screen.queryByText('支氣管擴張')).toBeNull()
  })

  it('expands a point to its verified quotes', () => {
    render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} />)
    const toggles = screen.getAllByRole('button', { name: '查看原文引句' })
    expect(toggles).toHaveLength(2)
    expect(screen.queryByText('“Patchy lesions in bilateral lower lung field.”')).toBeNull()
    fireEvent.click(toggles[0])
    expect(screen.getByText('“Patchy lesions in bilateral lower lung field.”')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收合原文引句' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('folds the remaining reports into a collapsed footer of navigable rows', () => {
    const onNavigate = jest.fn()
    const { container } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} onNavigate={onNavigate} />)
    const footer = screen.getByRole('button', { name: /其餘 2 份無特殊發現或未列入重點/ })
    expect(footer).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('[data-report-row]')).toBeNull()
    fireEvent.click(footer)
    const rows = [...container.querySelectorAll('[data-report-row]')] as HTMLElement[]
    expect(rows.map((node) => node.textContent)).toEqual([
      expect.stringContaining('2026-01-14 · CT · Report L4'),
      expect.stringContaining('2026-02-05 · US · Report L5'),
    ])
    // The summary ran: no fallback excerpts in the footer.
    expect(screen.queryByText('結論段')).toBeNull()
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(onNavigate).toHaveBeenCalledWith({
      resourceType: 'DiagnosticReport', resourceId: 'dr-L4', display: 'Report L4', date: '2026-01-14',
    })
  })

  it('navigates from a chip with that report\'s verified quote as the pinpoint', () => {
    const onNavigate = jest.fn()
    const { container } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} onNavigate={onNavigate} />)
    fireEvent.click(container.querySelector('[data-report-organ="heart"] [data-report-chip="L3"]')!)
    expect(onNavigate).toHaveBeenCalledWith({
      resourceType: 'DiagnosticReport', resourceId: 'dr-L3', display: 'Report L3', date: '2024-09-09',
      evidenceQuote: 'Grade I diastolic dysfunction.',
    })
    fireEvent.click(container.querySelector('[data-report-organ="heart"] [data-report-chip="L1"]')!)
    expect(onNavigate).toHaveBeenLastCalledWith({
      resourceType: 'DiagnosticReport', resourceId: 'dr-L1', display: 'Report L1', date: '2026-06-02',
    })
  })

  it('states hidden points only when there are any', () => {
    const { rerender } = render(<ReportHighlightsCard highlights={HIGHLIGHTS} labels={LABELS} />)
    expect(screen.getByText('2 項因與原文不符未顯示')).toBeInTheDocument()
    rerender(<ReportHighlightsCard highlights={{ ...HIGHLIGHTS, hiddenPointCount: 0 }} labels={LABELS} />)
    expect(screen.queryByText(/因與原文不符未顯示/)).toBeNull()
  })

  it('shows unverified AI wording immediately with a label and navigable reports', () => {
    const onNavigate = jest.fn()
    const { container } = render(
      <ReportHighlightsCard
        highlights={{ ...HIGHLIGHTS, hiddenPoints: [{ organ: 'heart', text: 'Synthetic unmatched finding', sources: [XR1] }] }}
        labels={LABELS}
        onNavigate={onNavigate}
      />,
    )
    expect(screen.getByText(/Synthetic unmatched finding/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /因與原文不符未顯示/ })).toBeNull()
    expect(screen.getByText(/未通過原文比對，僅供參考/)).toBeInTheDocument()
    const item = container.querySelector<HTMLElement>('[data-unverified-point]')!
    expect(item).toHaveTextContent('Synthetic unmatched finding')
    expect(within(item).getByText('未通過原文比對')).toBeVisible()
    fireEvent.click(item.querySelector('[data-report-chip="L1"]')!)
    expect(onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ resourceId: 'dr-L1' }))
  })

  it('says when the scope holds no report at all, and only when given the words', () => {
    const empty: ReportHighlights = { summarized: false, groups: [], others: [], totalReports: 0, droppedQuoteCount: 0, hiddenPointCount: 0, uncertaintyRewriteCount: 0 }
    const { container, rerender } = render(<ReportHighlightsCard highlights={empty} labels={LABELS} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ReportHighlightsCard highlights={empty} labels={{ ...LABELS, noReports: ms.reportsNoneMedcloudYear }} />)
    expect(screen.getByText('過去一年無檢查報告')).toBeInTheDocument()
    expect(screen.queryByText(ms.reportsUnavailable)).toBeNull()
  })

  it('without a summary, lists every report open with its own excerpt and says so', () => {
    const fallback: ReportHighlights = {
      summarized: false,
      groups: [],
      others: [
        row('L1', 'xray', '2026-06-02', { excerpt: 'Cardiomegaly.', excerptSource: 'conclusion' }),
        row('L4', 'ct', '2025-01-14', { excerpt: 'Axial images were obtained', excerptSource: 'opening', excerptTruncated: true }),
      ],
      totalReports: 2,
      droppedQuoteCount: 0,
      hiddenPointCount: 0,
      uncertaintyRewriteCount: 0,
    }
    render(<ReportHighlightsCard highlights={fallback} labels={LABELS} />)
    expect(screen.getByText(ms.reportsUnavailable)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /全部 2 份報告/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('結論段')).toBeInTheDocument()
    expect(screen.getByText('“Cardiomegaly.”')).toBeInTheDocument()
    expect(screen.getByText('原文開頭')).toBeInTheDocument()
    expect(screen.getByText('“Axial images were obtained…”')).toBeInTheDocument()
  })

  it('renders nothing without reports', () => {
    const { container } = render(
      <ReportHighlightsCard
        highlights={{ ...HIGHLIGHTS, groups: [], others: [], totalReports: 0 }}
        labels={LABELS}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ReportHighlightsCard — repeated original wording', () => {
  it('prints an identical quote from serial studies once; chips still list both', () => {
    const ECG1 = source('L8', 'ecg', '2026-05-25')
    const ECG2 = source('L9', 'ecg', '2026-02-10')
    const highlights: ReportHighlights = {
      ...HIGHLIGHTS,
      groups: [{
        organ: 'heart',
        label: '心臟',
        points: [{
          text: '前中隔梗塞',
          displayAs: 'quote',
          quotes: [
            { key: 'L8', quote: 'Anteroseptal infarct, age undetermined' },
            { key: 'L9', quote: 'Anteroseptal infarct, age undetermined' },
          ],
          sources: [ECG1, ECG2],
        }],
      }],
    }
    const { container } = render(<ReportHighlightsCard highlights={highlights} labels={LABELS} />)
    expect(screen.getAllByText('“Anteroseptal infarct, age undetermined”')).toHaveLength(1)
    expect(container.querySelectorAll('[data-report-organ="heart"] [data-report-chip]')).toHaveLength(2)
  })
})

describe('ReportHighlightsCard — many serial studies on one finding', () => {
  it('merges same-day studies into one chip, shows two chips and folds the rest behind +N', () => {
    const mri = ['2026-07-08', '2026-07-08', '2026-04-17', '2026-04-17', '2026-01-20'].map((date, index) => source(`L${10 + index}`, 'mri', date))
    const { container } = render(
      <ReportHighlightsCard
        highlights={{
          ...HIGHLIGHTS,
          groups: [{ organ: 'brain', label: '腦', points: [{ text: 'No active brain metastasis', displayAs: 'text', quotes: [{ key: 'L10', quote: 'No definite active brain metastasis.' }], sources: mri }] }],
        }}
        labels={LABELS}
        onNavigate={jest.fn()}
      />,
    )
    // Two MRIs on 07-08 and two on 04-17 read as one chip each; +1 is the
    // one study left, counted in reports.
    const chips = () => [...container.querySelectorAll('[data-report-chip]')].map((chip) => chip.textContent)
    expect(chips()).toEqual([expect.stringMatching(/07-08 ×2$/), expect.stringMatching(/04-17 ×2$/)])
    fireEvent.click(screen.getByRole('button', { name: ms.reportsMoreSources.replace('{count}', '1') }))
    // Opened: every study is its own chip again.
    expect(chips()).toHaveLength(5)
    expect(chips().some((label) => label?.includes('×'))).toBe(false)
  })
})
