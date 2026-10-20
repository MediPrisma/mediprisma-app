import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MedicationHistoryList } from '@/features/clinical-summary/medications/components/MedicationHistoryList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import type { ResourceNavTarget } from '@/src/application/stores/resource-navigation.store'

let mockAnchorOnMatch: ((sequence: number, target: ResourceNavTarget) => void) | undefined
let mockAnchorResourceId: string | string[] | undefined

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: {
      medications: {
        statusEnded: '已結束',
        totalQuantityCompact: '總量 {n}',
        supplyDaysCompact: '天數 {n}',
        refillSummary: '累計 {count} 次',
        refillSummarySince: '累計 {count} 次 · {date} 起',
        dosageInstructionLabel: '用法用量',
        durationDaysUnit: '天',
        billingIcdTooltip: '處方診斷',
        chronic: '慢箋',
        showMedicationHistory: '顯示 {name} 的過往用藥紀錄（{count}）',
        hideMedicationHistory: '收合 {name} 的過往用藥紀錄（{count}）',
      },
    },
  }),
}))

jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: (
    _resourceType: string | string[],
    resourceId?: string | string[],
    onMatch?: (sequence: number, target: ResourceNavTarget) => void,
  ) => {
    mockAnchorResourceId = resourceId
    if (onMatch) mockAnchorOnMatch = onMatch
    return null
  },
}))

jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (
    selector: (state: { pending: null; seq: number }) => unknown,
  ) => selector({ pending: null, seq: 0 }),
}))

const latestMedication = {
  id: 'history-latest',
  title: 'LEVOTHYROXINE SODIUM 0.05 MG',
  secondaryTitle: 'ELTROXIN TABLETS 50 MCG',
  status: 'completed',
  isInactive: true,
  isChronic: false,
  searchHaystack: '',
  frequency: 'QOD',
  totalQuantity: 15,
  durationDays: 30,
  startedOn: '2026/8/5',
  endDate: '2026/9/4',
  pharmacy: '新北市聯合醫院',
  category: '甲狀腺製劑',
  icdCode: 'E07.9',
  icdText: '甲狀腺疾患',
} as MedicationRow

const olderMedication = {
  ...latestMedication,
  id: 'history-older',
  secondaryTitle: 'SYNTHROID TABLETS 50 MCG',
  startedOn: '2026/7/6',
  endDate: '2026/8/5',
} as MedicationRow

// Each fill is its own row under its own visit (owner, 2026-10-13); the
// newest fill's row comes first. These checks read that row.
const fillRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('li[data-visit-band]')) as HTMLElement[]

describe('MedicationHistoryList row parity', () => {
  beforeEach(() => {
    mockAnchorOnMatch = undefined
    mockAnchorResourceId = undefined
  })

  it('uses the same MedicationItem layout as the current-medication list', () => {
    const { container } = render(
      <div tabIndex={0}>
        <MedicationHistoryList
          groups={[{
            key: 'levothyroxine',
            name: latestMedication.title,
            count: 2,
            medications: [latestMedication, olderMedication],
          }]}
        />
      </div>,
    )

    expect(container.querySelector('[data-medication-list-surface="grouped"]'))
      .toBeInTheDocument()
    // Two fills, two visits: one row each.
    expect(fillRows(container)).toHaveLength(2)
    const row = within(fillRows(container)[0])
    expect(container.querySelector('[data-medication-row-layout="three-lane"]'))
      .toBeInTheDocument()
    expect(row.getByText(latestMedication.title)).toBeInTheDocument()
    expect(row.getByText('QOD')).toBeInTheDocument()
    expect(row.getByText('總量 15')).toBeInTheDocument()
    expect(container.querySelector('[data-medication-schedule]')).toHaveTextContent(
      '26/08/05 → 26/09/04（30 天）QOD 總量 15',
    )
    expect(
      container.querySelector('[data-medication-date-frequency-join]')?.textContent,
    ).toBe('')
    expect(
      container.querySelector('[data-medication-frequency-total-gap]')?.textContent,
    ).toBe(' ')
    // A dated row sits under its visit header, which carries the diagnosis
    // and institution; the row itself keeps the drug class.
    const header = container.querySelector('[data-visit-header]')
    expect(header).toHaveTextContent('E07.9甲狀腺疾患')
    expect(header).toHaveTextContent('新北市聯合醫院')
    expect(container.querySelector('[data-medication-diagnosis]')).toBeEmptyDOMElement()
    expect(container.querySelector('[data-medication-classification]'))
      .toHaveTextContent('甲狀腺製劑')
    expect(container.querySelector('[data-medication-classification]'))
      .not.toHaveTextContent('新北市聯合醫院')
    expect(row.getByText('甲狀腺製劑')).toBeInTheDocument()
    expect(row.getByText('已完成')).toBeInTheDocument()
    // One copy per width: the status column (456px and up) and the end of
    // the regimen line below that; CSS shows exactly one.
    expect(row.getAllByText('2 筆紀錄')).toHaveLength(2)
    // The older fill's row shows its own dates.
    expect(fillRows(container)[1].querySelector('[data-medication-regimen]'))
      .toHaveTextContent('26/07/06 → 26/08/05（30 天）')

    const toggle = row.getByRole('button', {
      name: '顯示 LEVOTHYROXINE SODIUM 0.05 MG 的過往用藥紀錄（2）',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const details = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(details).toBeInTheDocument()
    expect(details).toHaveTextContent(
      '26/08/05 → 26/09/04（30 天）QOD 總量 15 · LEVOTHYROXINE SODIUM 0.05 MG · 新北市聯合醫院',
    )
    expect(details).toHaveTextContent(
      '26/07/06 → 26/08/05（30 天）QOD 總量 15 · LEVOTHYROXINE SODIUM 0.05 MG · 新北市聯合醫院',
    )
    expect(details).not.toHaveTextContent('ELTROXIN TABLETS 50 MCG')
    expect(details).not.toHaveTextContent('SYNTHROID TABLETS 50 MCG')
  })

  it('uses each historical fill product name in product-name mode', () => {
    render(
      <MedicationHistoryList
        nameMode="product"
        groups={[{
          key: 'levothyroxine',
          name: latestMedication.title,
          count: 2,
          medications: [latestMedication, olderMedication],
        }]}
      />,
    )

    const toggle = screen.getAllByRole('button', {
      name: '顯示 LEVOTHYROXINE SODIUM 0.05 MG 的過往用藥紀錄（2）',
    })[0]
    fireEvent.click(toggle)

    const details = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(details).toHaveTextContent(
      '26/08/05 → 26/09/04（30 天）QOD 總量 15 · ELTROXIN TABLETS 50 MCG · 新北市聯合醫院',
    )
    expect(details).toHaveTextContent(
      '26/07/06 → 26/08/05（30 天）QOD 總量 15 · SYNTHROID TABLETS 50 MCG · 新北市聯合醫院',
    )
  })

  it('toggles a historical medication group from the full row', () => {
    const { container } = render(
      <MedicationHistoryList
        groups={[{
          key: 'levothyroxine',
          name: latestMedication.title,
          count: 2,
          medications: [latestMedication, olderMedication],
        }]}
      />,
    )

    const row = container.querySelector('[data-medication-row-layout="three-lane"]')
    const toggle = within(fillRows(container)[0]).getByRole('button', {
      name: '顯示 LEVOTHYROXINE SODIUM 0.05 MG 的過往用藥紀錄（2）',
    })
    expect(row).toHaveAttribute('data-medication-row-toggle', 'true')

    fireEvent.click(row!)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? ''))
      .toBeInTheDocument()

    fireEvent.click(row!)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('bounds the initial history render and appends the remaining rows during idle time', () => {
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const originalRequestIdleCallback = browserWindow.requestIdleCallback
    const originalCancelIdleCallback = browserWindow.cancelIdleCallback
    let idleCallback: IdleRequestCallback | undefined
    browserWindow.requestIdleCallback = jest.fn((callback: IdleRequestCallback) => {
      idleCallback = callback
      return 1
    })
    browserWindow.cancelIdleCallback = jest.fn()

    const groups = Array.from({ length: 20 }, (_, index) => ({
      key: `history-${index}`,
      name: `HISTORY MEDICATION ${index}`,
      count: 1,
      medications: [{
        ...latestMedication,
        id: `history-${index}`,
        title: `HISTORY MEDICATION ${index}`,
      }],
    }))

    try {
      const { container } = render(<MedicationHistoryList groups={groups} />)

      expect(container.querySelectorAll('[data-medication-row-layout="three-lane"]'))
        .toHaveLength(12)
      expect(idleCallback).toBeDefined()

      act(() => {
        idleCallback?.({
          didTimeout: false,
          timeRemaining: () => 50,
        })
      })

      expect(container.querySelectorAll('[data-medication-row-layout="three-lane"]'))
        .toHaveLength(20)
    } finally {
      browserWindow.requestIdleCallback = originalRequestIdleCallback
      browserWindow.cancelIdleCallback = originalCancelIdleCallback
    }
  })

  it('hides the row toggle for a single prescription while keeping the name aligned', () => {
    const { container } = render(
      <MedicationHistoryList
        groups={[{
          key: 'single-prescription',
          name: latestMedication.title,
          count: 1,
          medications: [latestMedication],
        }]}
      />,
    )

    expect(screen.queryByRole('button', {
      name: '顯示 LEVOTHYROXINE SODIUM 0.05 MG 的過往用藥紀錄（1）',
    })).not.toBeInTheDocument()
    expect(container.querySelector('[data-medication-row-layout="three-lane"]'))
      .toHaveClass('pl-9', 'pr-3')
    expect(container.querySelector('[data-medication-row-layout="three-lane"]'))
      .not.toHaveAttribute('data-medication-row-toggle')
  })

  it('expands a fill row when a citation of that fill asks for the drug history', () => {
    const { container } = render(
      <MedicationHistoryList
        groups={[{
          key: 'levothyroxine',
          name: latestMedication.title,
          count: 2,
          medications: [latestMedication, olderMedication],
        }]}
      />,
    )

    // The older fill's own row answers for it (the mock keeps the last
    // registration, which is that row's).
    const toggle = within(fillRows(container)[1]).getByRole('button', {
      name: '顯示 LEVOTHYROXINE SODIUM 0.05 MG 的過往用藥紀錄（2）',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(mockAnchorResourceId).toEqual([olderMedication.id])

    act(() => {
      mockAnchorOnMatch?.(1, {
        resourceType: 'MedicationRequest',
        resourceId: olderMedication.id,
        expandMedicationHistory: true,
      })
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? ''))
      .toHaveTextContent('26/08/05 → 26/09/04（30 天）QOD 總量 15')
  })
})
