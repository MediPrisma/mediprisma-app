import { fireEvent, render, screen } from '@testing-library/react'
import { MedicationList } from '@/features/clinical-summary/medications/components/MedicationList'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'
import type { ResourceNavTarget } from '@/src/application/stores/resource-navigation.store'

const mockActiveMedication = {
  id: 'active-medication-1',
  title: 'ACETYLCYSTEINE 600 MG',
  status: 'active',
  isInactive: false,
  isChronic: false,
  searchHaystack: '',
} as MedicationRow

const mockHistoricalMedication = {
  ...mockActiveMedication,
  id: 'historical-medication-1',
  status: 'completed',
  isInactive: true,
  startedOn: '2026/7/6',
  endDate: '2026/8/5',
} as MedicationRow

let mockInactiveMedicationGroups: Array<{
  key: string
  name: string
  count: number
  medications: MedicationRow[]
}> = []

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: 'medical' }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    t: {
      common: { loading: '載入中' },
      medications: {
        currentlyInUse: '使用中',
        showMedicationHistory: '顯示 {name} 的過往用藥紀錄（{count}）',
        hideMedicationHistory: '收合 {name} 的過往用藥紀錄（{count}）',
        noData: '無資料',
        history: '用藥歷史',
        historyStopped: '已停用',
        nameDisplay: {
          label: '藥名顯示方式',
          ingredient: '成分名',
          product: '商品名',
        },
      },
    },
  }),
}))

jest.mock('@/src/application/stores/resource-navigation.store', () => ({
  useResourceNavigationStore: (selector: (state: { pending: null; seq: number }) => unknown) =>
    selector({ pending: null, seq: 0 }),
}))

jest.mock('@/features/clinical-summary/medications/hooks/useGroupedMedications', () => ({
  useGroupedMedications: () => ({
    activeMedications: [mockActiveMedication],
    activeHistoryByMedicationId: new Map([
      [mockActiveMedication.id, {
        key: mockActiveMedication.title,
        name: mockActiveMedication.title,
        count: 1,
        medications: [mockHistoricalMedication],
      }],
    ]),
    inactiveMedicationGroups: mockInactiveMedicationGroups,
  }),
}))

jest.mock('@/features/clinical-summary/medications/components/MedicationItem', () => ({
  MedicationItem: ({
    medication,
    leadingControl,
    onRowToggle,
    onResourceNavigationMatch,
    resourceNavigationIds,
  }: {
    medication: MedicationRow
    leadingControl?: React.ReactNode
    onRowToggle?: () => void
    resourceNavigationIds?: string[]
    onResourceNavigationMatch?: (
      sequence: number,
      target: ResourceNavTarget,
    ) => void
  }) => (
    <div
      data-testid="medication-row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        onRowToggle?.()
      }}
    >
      {leadingControl}
      <span>{medication.title}</span>
      {onResourceNavigationMatch && (
        <button
          type="button"
          onClick={() => onResourceNavigationMatch(1, {
            resourceType: 'MedicationRequest',
            resourceId: medication.id,
            expandMedicationHistory: true,
          })}
        >
          模擬查看相關用藥
        </button>
      )}
      {onResourceNavigationMatch && resourceNavigationIds?.[1] && (
        <button
          type="button"
          onClick={() => onResourceNavigationMatch(2, {
            resourceType: 'MedicationRequest',
            resourceId: resourceNavigationIds[1],
          })}
        >
          模擬舊處方導引
        </button>
      )}
    </div>
  ),
}))

jest.mock('@/features/clinical-summary/medications/components/MedicationHistoryList', () => ({
  MedicationHistoryList: () => <div data-testid="medication-history-list" />,
  MedicationHistoryDetails: ({
    medications,
    nameMode,
  }: {
    medications: MedicationRow[]
    nameMode?: 'ingredient' | 'product'
  }) => (
    <div data-testid="active-history-details" data-name-mode={nameMode}>
      {medications.map((medication) => medication.id).join(',')}
    </div>
  ),
}))

describe('MedicationList active section toggle', () => {
  beforeEach(() => {
    mockInactiveMedicationGroups = []
  })

  it('collapses and expands the current medication rows without hiding the name switch', () => {
    render(
      <MedicationList
        medications={[mockActiveMedication]}
        isLoading={false}
        error={null}
        showNameModeSwitch
        onNameModeChange={jest.fn()}
      />,
    )

    const toggle = screen.getByRole('button', { name: '使用中 (1)' })
    expect(toggle).toHaveClass('min-h-[32px]', 'md:min-h-8')
    expect(screen.getByRole('group', { name: '藥名顯示方式' })).toHaveClass(
      'min-h-[32px]',
      'md:min-h-8',
    )
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('ACETYLCYSTEINE 600 MG')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('ACETYLCYSTEINE 600 MG')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '藥名顯示方式' })).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('ACETYLCYSTEINE 600 MG')).toBeInTheDocument()
  })

  it('expands the same drug history from the current medication row', () => {
    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: '顯示 ACETYLCYSTEINE 600 MG 的過往用藥紀錄（1）',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('historical-medication-1')).not.toBeInTheDocument()
    // The earlier fill is also listed under its own visit in 用藥歷史
    // (owner, 2026-10-13), so the section is there with it.
    expect(screen.getByRole('button', { name: '用藥歷史 (1 已停用)' })).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('historical-medication-1')).toBeInTheDocument()
  })

  it('passes product-name mode to the expanded current-drug history', () => {
    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
        nameMode="product"
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: '顯示 ACETYLCYSTEINE 600 MG 的過往用藥紀錄（1）',
    }))

    expect(screen.getByTestId('active-history-details'))
      .toHaveAttribute('data-name-mode', 'product')
  })

  it('toggles current-drug history when the medication row is clicked', () => {
    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: '顯示 ACETYLCYSTEINE 600 MG 的過往用藥紀錄（1）',
    })
    const row = screen.getByTestId('medication-row')

    fireEvent.click(row)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('historical-medication-1')).toBeInTheDocument()

    fireEvent.click(row)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('historical-medication-1')).not.toBeInTheDocument()
  })

  it('opens current-drug refill history when related-medication navigation lands on it', () => {
    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
      />,
    )

    const toggle = screen.getByRole('button', {
      name: '顯示 ACETYLCYSTEINE 600 MG 的過往用藥紀錄（1）',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: '模擬查看相關用藥' }))

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('historical-medication-1')).toBeInTheDocument()
  })

  it('leaves a citation of an older fill to that fill\'s own row in 用藥歷史', () => {
    // The earlier fill has its own row under its visit now, which answers for
    // it; the current row no longer claims it (the mock offers 模擬舊處方導引
    // only for a row that registers a second id).
    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
      />,
    )

    expect(screen.queryByRole('button', { name: '模擬舊處方導引' })).not.toBeInTheDocument()
    expect(screen.getByTestId('medication-history-list')).toBeInTheDocument()
  })

  it('opens the stopped-medication section by default and still allows collapsing it', () => {
    mockInactiveMedicationGroups = [{
      key: 'stopped-medication',
      name: 'STOPPED MEDICATION',
      count: 110,
      medications: [mockHistoricalMedication],
    }]

    render(
      <MedicationList
        medications={[mockActiveMedication, mockHistoricalMedication]}
        isLoading={false}
        error={null}
      />,
    )

    // 110 stopped fills plus the current drug's one earlier fill.
    const toggle = screen.getByRole('button', { name: '用藥歷史 (111 已停用)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls')
    expect(screen.getByTestId('medication-history-list')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('medication-history-list')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('medication-history-list')).toBeInTheDocument()
  })
})
