// 總覽 → 檢驗 → 自訂: the same analyte × collection-day pivot as 常用／全部,
// with the clinician's own rows in their own order.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { zhTW } from '@/src/shared/i18n/locales/zh-TW'
import { OverviewLabsSection } from '@/features/clinical-summary/overview/components/OverviewLabsSection'
import type { OverviewLabRow, OverviewLabsData } from '@/features/clinical-summary/overview/hooks/useOverviewData'
import type { LabCell } from '@/src/shared/utils/lab-pivot.utils'
import { useOutpatientPrefsStore } from '@/src/application/stores/outpatient-prefs.store'

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})
jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))
jest.mock('@/src/application/providers/auth.provider', () => ({
  useAuth: () => ({ user: { uid: 'doc-1' }, anonymousUid: null }),
}))
const mockRevealTab = jest.fn()
jest.mock('@/src/application/providers/right-panel.provider', () => ({
  useRightPanel: () => ({ revealTab: mockRevealTab }),
}))

const cell = (value: string, high = false): LabCell => ({
  value,
  ...(high ? { isAbnormal: true, interpretationCode: 'H' } : {}),
})

function row(testKey: string, name: string, cells: (LabCell | undefined)[], categoryId = 'chem'): OverviewLabRow {
  return {
    mapKey: `${categoryId}:${testKey}`,
    categoryId,
    categoryLabel: '生化',
    testKey,
    name,
    isPinned: false,
    hasAbnormal: cells.some((c) => c?.isAbnormal),
    cells,
  }
}

// Two collection days inside the window; NT-proBNP was last done outside it.
const DATA: OverviewLabsData = {
  columns: [{ day: '2026-06-30', institution: '示範醫院' }, { day: '2026-09-18', institution: '示範醫院' }],
  rows: [
    row('CREA', 'CREA', [cell('1.28', true), cell('1.32', true)]),
    row('ALT', 'ALT', [undefined, cell('22')]),
    row('AST', 'AST', [undefined, cell('30')]),
  ],
  pinnedRowCount: 2,
  hiddenDayCount: 0,
  resultCount: 4,
  abnormalCount: 2,
  unpivotedCount: 0,
  navResourceId: 'o1',
}

function obs(id: string, code: string, date: string, value: number, unit: string, interpretation?: string) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { text: code },
    effectiveDateTime: `${date}T09:00:00+08:00`,
    valueQuantity: { value, unit },
    ...(interpretation ? { interpretation: [{ coding: [{ code: interpretation }] }] } : {}),
  }
}

// The whole loaded chart: CREA twice in the window, one ALT, and an
// NT-proBNP from before the window.
const CHART = [
  obs('o1', 'CREA', '2026-09-18', 1.32, 'mg/dL', 'H'),
  obs('o2', 'CREA', '2026-06-30', 1.28, 'mg/dL', 'H'),
  obs('o3', 'ALT', '2026-09-18', 22, 'U/L'),
  obs('o5', 'NT-PROBNP', '2025-11-02', 2105, 'pg/mL', 'H'),
]

function renderSection(data: OverviewLabsData = DATA) {
  return render(<OverviewLabsSection data={data} fit={{ bounded: false }} />)
}

const card = () => within(document.getElementById('overview-section-labs')!)

describe('OverviewLabsSection — 自訂', () => {
  beforeEach(() => {
    useOutpatientPrefsStore.setState({ byUser: {} })
    mockRevealTab.mockReset()
  })

  it('offers to choose pins when there are none yet', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.labs.mine }))
    expect(screen.getByText(zhTW.overview.myLabs.empty)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.myLabs.emptyAction }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('draws the same date-column pivot, with only the pinned rows in the chosen order', () => {
    useOutpatientPrefsStore.getState().update('doc-1', {
      pinnedLabs: ['chem:NT-PROBNP', 'chem:ALT', 'chem:CREA', 'note:Digoxin 濃度'],
      labMode: 'mine',
    })
    renderSection()
    // Date columns, exactly as 常用 shows them (jsdom has no width, so the
    // card's column budget keeps only the newest day).
    expect(card().getByText('09/18')).toBeInTheDocument()
    expect(card().getByText('1.32 ↑')).toBeInTheDocument()
    expect(card().getByText('22')).toBeInTheDocument()
    // ALT without AST.
    expect(card().queryByText('AST')).not.toBeInTheDocument()
    // A pin with nothing in the window keeps its (empty) row; so does a reminder.
    const names = card().getAllByText(/^(NT-proBNP|ALT|CREA|Digoxin 濃度)$/).map((node) => node.textContent)
    expect(names).toEqual(['NT-proBNP', 'ALT', 'CREA', 'Digoxin 濃度'])
  })

  it('keeps a pinned row empty in the period even when the chart holds an older result', async () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:CREA', 'chem:NT-PROBNP'], labMode: 'mine' })
    renderSection({ ...DATA, allObservations: CHART })
    // Wait for the whole-chart pass (it adds CREA's trend button).
    await card().findByRole('button', { name: '查看 CREA 趨勢' })
    expect(card().getByText('NT-proBNP')).toBeInTheDocument()
    expect(card().queryByText(/2105/)).toBeNull()
  })

  it('puts a trend button on an analyte the whole chart can plot', async () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:CREA', 'chem:ALT'], labMode: 'mine' })
    renderSection({ ...DATA, allObservations: CHART })
    expect(await card().findByRole('button', { name: '查看 CREA 趨勢' })).toBeInTheDocument()
    // A single ALT result is not a trend.
    expect(card().queryByRole('button', { name: '查看 ALT 趨勢' })).toBeNull()
  })

  describe('a day with several records (PR #170 review)', () => {
    const sameDay = (records: NonNullable<LabCell['sourceRecords']>): LabCell => ({
      value: records.map((record) => record.value).join(' / '),
      allValues: records.map((record) => record.value),
      unit: 'mmol/L',
      // What the pivot merge leaves at the top level: "some record" flags.
      isAbnormal: records.some((record) => record.isAbnormal),
      interpretationCode: records.find((record) => record.interpretationCode)?.interpretationCode,
      status: records.map((record) => record.status).filter(Boolean).join('|'),
      sourceRecords: records,
    })
    const render1 = (cell: LabCell) => {
      useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:K'], labMode: 'mine' })
      renderSection({ ...DATA, columns: [DATA.columns[1]!], rows: [row('K', 'K', [cell])] })
    }

    it('never shows an entered-in-error value', () => {
      render1(sameDay([
        { value: '9.9', unit: 'mmol/L', isAbnormal: true, interpretationCode: 'H', status: 'entered-in-error' },
        { value: '4.4', unit: 'mmol/L', status: 'final' },
      ]))
      expect(card().getByText('4.4')).toBeInTheDocument()
      expect(card().queryByText(/9\.9/)).toBeNull()
    })

    it("does not glue another record's ↑ to a normal value, but says another one is abnormal", () => {
      render1(sameDay([
        { value: '4.0', unit: 'mmol/L', status: 'final' },
        { value: '6.1', unit: 'mmol/L', isAbnormal: true, interpretationCode: 'H', status: 'final' },
      ]))
      expect(card().getByText('4.0')).toBeInTheDocument()
      expect(card().queryByText('4.0 ↑')).toBeNull()
      expect(card().getByLabelText(zhTW.overview.labs.sameDayOtherAbnormal.replace('{count}', '2'))).toBeInTheDocument()
    })
  })

  it('says so when no pinned test has a result in the period', () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:NT-PROBNP'], labMode: 'mine' })
    renderSection()
    expect(card().getByText(zhTW.overview.myLabs.noneInRange)).toBeInTheDocument()
    expect(card().getByRole('button', { name: zhTW.overview.labs.editPinned })).toBeInTheDocument()
  })

  it('keeps the header the same as the other filters', () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:CREA'], labMode: 'mine' })
    renderSection()
    expect(card().getByRole('button', { name: zhTW.overview.expandList })).toBeInTheDocument()
  })

  it('opens 複製 → 帶回紀錄 → 我的格式 from the card, even after 內建格式 was chosen', () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:CREA'], labMode: 'mine', handoffMode: 'builtin' })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.labs.handoff }))
    expect(mockRevealTab).toHaveBeenCalledWith('ips-export', { exportTab: 'emr' })
    expect(useOutpatientPrefsStore.getState().byUser['doc-1'].handoffMode).toBe('custom')
  })

  it('saves pins picked one by one in the editor', () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: ['chem:CREA'], labMode: 'mine' })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.labs.editPinned }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('searchbox'), { target: { value: 'alt' } })
    fireEvent.click(dialog.getByRole('button', { pressed: false, name: /^ALT/ }))
    fireEvent.click(dialog.getByRole('button', { name: zhTW.common.save }))
    expect(useOutpatientPrefsStore.getState().byUser['doc-1'].pinnedLabs).toEqual(['chem:CREA', 'chem:ALT'])
  })

  it('says plainly when a searched test is not recognised, and can keep a reminder row', () => {
    useOutpatientPrefsStore.getState().update('doc-1', { pinnedLabs: [], labMode: 'mine' })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: zhTW.overview.myLabs.emptyAction }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('searchbox'), { target: { value: 'digoxin' } })
    expect(dialog.getByText(zhTW.overview.myLabs.editor.unsupportedTitle.replace('{query}', 'digoxin'))).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: new RegExp(zhTW.overview.myLabs.editor.addReminder) }))
    fireEvent.click(dialog.getByRole('button', { name: zhTW.common.save }))
    expect(useOutpatientPrefsStore.getState().byUser['doc-1'].pinnedLabs).toEqual(['note:digoxin'])
  })
})
