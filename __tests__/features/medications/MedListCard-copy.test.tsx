// 用藥 tab → 使用中 → 複製｜編輯: the 總覽 card's copy, on the tab's own list,
// pasting the very same text for the same chart.
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { MedListCard } from '@/features/clinical-summary/medications/MedListCard'
import { OverviewMedsSection } from '@/features/clinical-summary/overview/components/OverviewMedsSection'
import { useOverviewMeds } from '@/features/clinical-summary/overview/hooks/useOverviewMeds'
import { buildOverviewWindow } from '@/features/clinical-summary/overview/utils/overview-selectors'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'

const NOW = Date.parse('2026-10-03T09:00:00+08:00')
jest.mock('@/src/shared/hooks/use-now.hook', () => ({ useNow: () => NOW }))
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
jest.mock('@/src/application/providers/right-detail.provider', () => ({
  useRightDetail: () => ({ detail: null, toggleDetail: jest.fn(), showDetail: jest.fn() }),
}))
jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: jest.fn() }),
}))
jest.mock('@/src/application/providers/clinical-tab-activity.provider', () => ({
  useClinicalTabActivity: () => true,
}))
const mockTrack = jest.fn()
jest.mock('@/src/application/telemetry/usage-analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrack(...args),
  markUserTrigger: jest.fn(),
  useTrackView: jest.fn(),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), dismiss: jest.fn() } }))
const toastSuccess = toast.success as unknown as jest.Mock

function prescription(id: string, name: string, authoredOn: string, days: number, frequency: string) {
  return {
    resourceType: 'MedicationRequest',
    id,
    status: 'active',
    intent: 'order',
    authoredOn: `${authoredOn}T09:00:00+08:00`,
    medicationCodeableConcept: { text: name },
    dosageInstruction: [{ text: frequency, timing: { code: { text: frequency } } }],
    dispenseRequest: { expectedSupplyDuration: { value: days, unit: 'days', code: 'd' } },
  }
}

const MEDICATIONS = [
  prescription('m1', 'AMLODIPINE 5 MG', '2026-09-19', 28, 'QD'),
  // Ran out two days ago, but a 28-day supply is long-term: still current.
  prescription('m2', 'ATORVASTATIN 20 MG', '2026-09-03', 28, 'QD'),
  // A short course that ran out: left out, and the receipt says so.
  prescription('m3', 'AMOXICILLIN 500 MG', '2026-09-20', 7, 'TID'),
  // Long gone: not 現在用藥 at all.
  prescription('m4', 'METFORMIN 500 MG', '2026-05-01', 28, 'BID'),
]

jest.mock('@/src/application/hooks/clinical-data/use-clinical-data-query.hook', () => ({
  useClinicalData: () => ({
    medications: MEDICATIONS,
    allergies: [],
    immunizations: [],
    medicationRemainingSummaries: [],
    resourceReady: { medications: true, allergies: true },
    error: null,
  }),
}))

describe('MedListCard — 複製現在用藥 on the 使用中 list', () => {
  let writeText: jest.Mock

  beforeEach(() => {
    mockAudience = 'medical'
    useOutpatientPrefsStore.setState({ byUser: {} })
    mockTrack.mockReset()
    writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('offers 複製｜編輯 on the 使用中 header and copies what 總覽 copies', async () => {
    const { unmount } = render(<MedListCard />)
    const header = screen.getByRole('button', { name: /使用中/ }).closest('div')!
    within(header).getByRole('button', { name: '編輯用藥複製格式' })
    await act(async () => {
      fireEvent.click(within(header).getByRole('button', { name: '複製' }))
    })
    const tabText = writeText.mock.calls.at(-1)?.[0] as string
    expect(tabText.split('\n')[0]).toBe('Current medication (2026/10/03, 2 項)')
    expect(tabText).toContain('AMLODIPINE 5 MG')
    expect(tabText).toContain('ATORVASTATIN 20 MG')
    expect(tabText).not.toContain('AMOXICILLIN')
    expect(tabText).not.toContain('METFORMIN')
    const [title, options] = toastSuccess.mock.calls.at(-1) as [string, { description: ReactNode }]
    expect(title).toBe('已複製 2 項現在用藥，可直接貼進病歷。')
    const { container } = render(<>{options.description}</>)
    expect(container).toHaveTextContent('沒有放入：AMOXICILLIN 500 MG')
    expect(mockTrack).toHaveBeenCalledWith('handoff_copy', { mode: 'meds_tab' })
    unmount()

    // The same chart through the 總覽 card.
    const { result } = renderHook(() => useOverviewMeds(MEDICATIONS, buildOverviewWindow(3, NOW), 'medical', 'zh-TW'))
    render(<OverviewMedsSection data={result.current.meds} fit={{ bounded: false }} />)
    await act(async () => {
      fireEvent.click(within(document.getElementById('overview-section-meds')!).getByRole('button', { name: '複製' }))
    })
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(tabText)
  })

  it('copies the whole current list whatever the search shows', async () => {
    render(<MedListCard />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'amlodipine' } })
    expect(screen.getByRole('button', { name: /使用中 \(1\)/ })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製' }))
    })
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('ATORVASTATIN 20 MG')
  })

  it('is not offered to the public audience', () => {
    mockAudience = 'patient'
    render(<MedListCard />)
    expect(screen.queryByRole('button', { name: '複製' })).toBeNull()
    expect(screen.queryByRole('button', { name: '編輯用藥複製格式' })).toBeNull()
  })
})
