// 總覽 → 用藥 → 複製: one click copies with the chosen format and a toast that
// goes away by itself says what went in and what was left out; 編輯 opens the
// format editor in place.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { OverviewMedsSection } from '@/features/clinical-summary/overview/components/OverviewMedsSection'
import type { OverviewMedItem, OverviewMedsData } from '@/features/clinical-summary/overview/hooks/useOverviewData'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'
import { BUILTIN_MED_COPY_FORMATS } from '@/features/clinical-summary/medications/utils/medication-copy-text'

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})
let mockAudience: 'medical' | 'patient' = 'medical'
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: mockAudience }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: { uid: 'doc-1' }, anonymousUid: null }),
}))
const mockRevealTab = jest.fn()
jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: mockRevealTab }),
}))
jest.mock('@/src/shared/hooks/use-now.hook', () => ({
  useNow: () => Date.parse('2026-10-03T09:00:00+08:00'),
}))
const mockTrack = jest.fn()
jest.mock('@/src/application/telemetry/usage-analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), dismiss: jest.fn() } }))

interface ToastButton { label: string; onClick: () => void }
const toastSuccess = toast.success as unknown as jest.Mock
/** The last copy toast: its title, its description's text, and its buttons. */
function lastToast() {
  const [title, options] = toastSuccess.mock.calls.at(-1) as [string, {
    duration: number; description?: ReactNode; action: ToastButton; cancel?: ToastButton
  }]
  const { container, unmount } = render(<>{options.description}</>)
  const description = container.textContent ?? ''
  unmount()
  return { ...options, title, description }
}

function item(
  id: string,
  title: string,
  overrides: Partial<Omit<OverviewMedItem, 'row'>> & { row?: Partial<MedicationRow> } = {},
): OverviewMedItem {
  const { row: rowOverrides, ...rest } = overrides
  const isInactive = rest.isInactive ?? false
  const isChronic = rest.isChronic ?? false
  return {
    id,
    key: title,
    title,
    doseText: '',
    institution: '臺北榮總',
    day: '2026-09-19',
    isChronic,
    isInactive,
    isCurrent: true,
    row: {
      id,
      title,
      status: isInactive ? 'completed' : 'active',
      isInactive,
      isChronic,
      refillCount: 1,
      searchHaystack: title.toLowerCase(),
      dose: '1 tab',
      frequency: 'QD',
      route: 'PO',
      durationDays: 28,
      ...rowOverrides,
    } as MedicationRow,
    ...rest,
  }
}

const DATA: OverviewMedsData = {
  items: [
    item('m1', 'Amlodipine', { isChronic: true, daysRemaining: 14 }),
    item('m2', 'Atorvastatin', { isChronic: true, isInactive: true, daysRemaining: -2, day: '2026-09-03' }),
    item('m3', 'Amoxicillin/Clavulanate', {
      isInactive: true, daysRemaining: -6, institution: '○○診所', day: '2026-09-20',
      row: { frequency: 'BID', durationDays: 7 },
    }),
  ],
  count: 3,
  changeCount: 0,
}

const card = () => within(document.getElementById('overview-section-meds')!)

describe('OverviewMedsSection — 複製現在用藥', () => {
  let writeText: jest.Mock

  beforeEach(() => {
    mockAudience = 'medical'
    useOutpatientPrefsStore.setState({ byUser: {} })
    mockTrack.mockReset()
    toastSuccess.mockReset()
    writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('copies the default (緊湊) format and says what was left out', async () => {
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })

    expect(writeText).toHaveBeenCalledWith([
      'Current medication (2026/10/03, 2 項)',
      '- Amlodipine 1 tab QD',
      '- Atorvastatin 1 tab QD （已用完 2 天）',
    ].join('\n'))
    const notice = lastToast()
    expect(notice.title).toBe('已複製 2 項現在用藥，可直接貼進病歷。')
    expect(notice.description).toContain('1 項短期藥（開不到 28 天）已用完或已停用，沒有放入：Amoxicillin/Clavulanate')
    expect(notice.description).toContain('1 項長期處方（慢箋或開 28 天以上）已用完，照樣放入')
    // A notice, not a banner to close: it times out, and the card holds none.
    expect(notice.duration).toBeGreaterThan(0)
    expect(card().queryByRole('status')).toBeNull()
    expect(mockTrack).toHaveBeenCalledWith('handoff_copy', { mode: 'overview_meds' })
  })

  it('看複製內容 shows the whole copied text at once', async () => {
    render(<OverviewMedsSection data={DATA} fit={{ bounded: true }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    const notice = lastToast()
    expect(notice.action.label).toBe('看複製內容')
    act(() => notice.action.onClick())
    const dialog = await screen.findByRole('dialog', { name: '複製的內容' })
    expect(within(dialog).getByTestId('med-copy-receipt-text').textContent).toBe(writeText.mock.calls.at(-1)?.[0])
  })

  it('a format without day counts copies none, and the receipt says so', async () => {
    const standard = BUILTIN_MED_COPY_FORMATS['builtin:standard']
    useOutpatientPrefsStore.getState().update('doc-1', {
      medFormat: {
        ...standard,
        id: 'mine',
        fields: standard.fields.map((field) => (field.id === 'remaining' ? { ...field, on: false } : field)),
      },
    })
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain('已用完')
    expect(lastToast().description).toContain('1 項長期處方（慢箋或開 28 天以上）已用完，照樣放入；這個格式不寫天數')
  })

  it('lists the left-out short courses last on request, and back', async () => {
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    expect(lastToast().cancel?.label).toBe('另列一段放入')
    await act(async () => {
      lastToast().cancel?.onClick()
    })
    const listed = writeText.mock.calls.at(-1)?.[0] as string
    expect(listed).toContain('近期已用完（短期藥，不算在上面 2 項）')
    expect(listed).toContain('- Amoxicillin/Clavulanate 1 tab BID （已用完 6 天）')
    expect(lastToast().title).toBe('已複製 3 項（現在用藥 2 項＋最後另列 1 項），可直接貼進病歷。')
    expect(lastToast().cancel?.label).toBe('改回不放')
    // In the paste now, so the toast no longer calls it left out.
    expect(lastToast().description).not.toContain('沒有放入')

    await act(async () => {
      lastToast().cancel?.onClick()
    })
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain('近期已用完')
  })

  it('opens the text pre-selected when the clipboard is refused', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    const area = await screen.findByRole('textbox', { name: '要複製的用藥內容' })
    expect((area as HTMLTextAreaElement).value).toContain('- Amlodipine 1 tab QD')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('closes the hand-copy text when the list changes under it', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const { rerender } = render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    await screen.findByRole('textbox', { name: '要複製的用藥內容' })
    const other: OverviewMedsData = { ...DATA, items: [item('x1', 'Metformin', { daysRemaining: 10 })], count: 1 }
    rerender(<OverviewMedsSection data={other} fit={{ bounded: false }} />)
    expect(screen.queryByRole('textbox', { name: '要複製的用藥內容' })).toBeNull()
  })

  it('reports nothing for a copy that comes back after the card unmounted', async () => {
    let finish: () => void = () => {}
    writeText.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const { unmount } = render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    fireEvent.click(card().getByRole('button', { name: '複製' }))
    unmount()
    await act(async () => { finish() })
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('a toast outliving its card copies nothing', async () => {
    const { unmount } = render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    const calls = writeText.mock.calls.length
    const stale = lastToast().cancel
    unmount()
    await act(async () => { stale?.onClick() })
    expect(writeText.mock.calls.length).toBe(calls)
  })

  it('reports nothing for a copy that comes back after the list changed', async () => {
    let finish: () => void = () => {}
    writeText.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const { rerender } = render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    fireEvent.click(card().getByRole('button', { name: '複製' }))
    const other: OverviewMedsData = { ...DATA, items: [item('x1', 'Metformin', { daysRemaining: 10 })], count: 1 }
    rerender(<OverviewMedsSection data={other} fit={{ bounded: false }} />)
    await act(async () => { finish() })
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('編輯 opens the one format\'s editor right here; saving makes 複製 use it', async () => {
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    fireEvent.click(card().getByRole('button', { name: '編輯用藥複製格式' }))
    // Until the clinician saves one, the editor starts from 緊湊.
    const dialog = await screen.findByRole('dialog', { name: '編輯用藥格式' })
    const preview = () => within(dialog).getByTestId('med-copy-editor-preview').textContent ?? ''
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '改回預設（緊湊）' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: '院所' }))
    expect(preview()).toContain('臺北榮總')
    fireEvent.click(within(dialog).getByRole('button', { name: '中文' }))
    expect(preview()).toContain('一天一次')
    fireEvent.click(within(dialog).getByRole('button', { name: '依院所' }))
    expect(preview()).toContain('【臺北榮總】')
    expect(within(dialog).getByText('放在組標題')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '依院所' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '不分組' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '頻次上移' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }))

    const saved = useOutpatientPrefsStore.getState().byUser['doc-1']?.medFormat
    expect(saved?.fields.find((field) => field.id === 'frequency')).toMatchObject({ on: true, style: 'zh' })
    expect(saved?.fields.map((field) => field.id).indexOf('frequency')).toBe(1)
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    expect(writeText).toHaveBeenLastCalledWith([
      'Current medication (2026/10/03, 2 項)',
      '- Amlodipine 一天一次 1 tab 臺北榮總',
      '- Atorvastatin 一天一次 1 tab 臺北榮總 （已用完 2 天）',
    ].join('\n'))
  })

  it('改回預設 puts 複製 back on 緊湊', async () => {
    useOutpatientPrefsStore.getState().update('doc-1', {
      medFormat: { ...BUILTIN_MED_COPY_FORMATS['builtin:standard'], id: 'mine' },
    })
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    fireEvent.click(card().getByRole('button', { name: '編輯用藥複製格式' }))
    const dialog = await screen.findByRole('dialog', { name: '編輯用藥格式' })
    fireEvent.click(within(dialog).getByRole('button', { name: '改回預設（緊湊）' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '確定改回預設' }))
    expect(useOutpatientPrefsStore.getState().byUser['doc-1']?.medFormat).toBeNull()
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: '複製' }))
    })
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('- Amlodipine 1 tab QD')
  })

  it('is not offered in the patient view', () => {
    mockAudience = 'patient'
    render(<OverviewMedsSection data={DATA} fit={{ bounded: false }} />)
    expect(card().queryByRole('button', { name: '複製' })).toBeNull()
  })
})
