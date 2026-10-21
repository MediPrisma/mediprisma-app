import { render, screen, within } from '@testing-library/react'
import { MedicationItem } from '@/features/clinical-summary/medications/components/MedicationItem'
import type { MedicationRow } from '@/features/clinical-summary/medications/types'

let mockAudience: 'medical' | 'patient' = 'patient'

jest.mock('@/src/application/providers/audience.provider', () => ({
  useAudience: () => ({ audience: mockAudience }),
}))

jest.mock('@/src/application/providers/language.provider', () => ({
  useLanguage: () => ({
    locale: 'zh-TW',
    t: {
      medications: {
        daysLeft: '剩 {n} 天',
        statusEnded: '已結束',
        statusEndingToday: '今日到期',
        statusOverdue: '已逾期',
        singlePrescriptionRemainingCompact: '剩 {n} 天',
        executionPeriod: '執行',
        durationCompact: '{n} 天',
        totalQuantityCompact: '總量 {n}',
        supplyDaysCompact: '天數 {n}',
        refillSummary: '累計 {count} 次',
        refillSummarySince: '累計 {count} 次 · {date} 起',
        frequencyLabel: '頻次',
        dosageInstructionLabel: '用法用量',
        routeLabel: '途徑',
        terminologySource: '健保署藥品主檔補充',
        terminologyIngredientLabel: '成分／含量',
        terminologyOfficialNameZhLabel: '中文品名',
        terminologyOfficialNameEnLabel: '英文品名',
        terminologyDoseFormLabel: '劑型',
        terminologyAtcLabel: 'ATC 分類',
        terminologySnapshotLabel: '藥典版本',
      },
    },
  }),
}))

jest.mock('@/src/application/hooks/use-resource-anchor.hook', () => ({
  useResourceAnchor: () => undefined,
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({
    children,
    sideOffset: _sideOffset,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { sideOffset?: number }) => (
    <div {...props}>{children}</div>
  ),
}))

const terminology = {
  source: 'nhi-official-drug-master' as const,
  snapshotId: 'nhi-drug-terminology-20260728',
  officialNameZh: '愛克痰發泡錠600毫克',
  officialNameEn: 'ACTEIN EFFERVESCENT TABLETS 600MG',
  ingredientText: 'ACETYLCYSTEINE 600 MG',
  doseForm: '發泡錠',
  atcCode: 'R05CB01',
  atcNameEn: 'acetylcysteine',
}

function medicationRow(title: string, secondaryTitle?: string): MedicationRow {
  return {
    id: 'mr-1',
    title,
    secondaryTitle,
    status: 'active',
    startedOn: '2026/7/22',
    endDate: '2026/8/12',
    durationDays: 21,
    isInactive: false,
    isChronic: true,
    refillCount: 15,
    firstRefillDate: '2025/1/29',
    pharmacy: '長庚嘉義',
    drugTerminology: terminology,
    searchHaystack: '',
  }
}

describe('MedicationItem audience-aware compact terminology', () => {
  it('keeps the patient row Chinese-only and compact while exposing full terminology on hover', () => {
    mockAudience = 'patient'
    const { container } = render(
      <MedicationItem medication={medicationRow('愛克痰發泡錠600毫克')} />,
    )

    expect(screen.getAllByText('愛克痰發泡錠600毫克')).toHaveLength(2)
    const compactTitle = container.querySelector('[tabindex="0"]') as HTMLElement
    expect(within(compactTitle)
      .queryByText('ACTEIN EFFERVESCENT TABLETS 600MG')).not.toBeInTheDocument()
    expect(within(compactTitle)
      .queryByText('ACETYLCYSTEINE 600 MG')).not.toBeInTheDocument()
    expect(within(container.querySelector('[data-medication-cell="clinical"]') as HTMLElement)
      .queryByText(/R05CB01/)).not.toBeInTheDocument()
    const tooltip = screen.getByTestId('medication-terminology-tooltip')
    expect(tooltip).toHaveClass('bg-popover', 'text-popover-foreground', 'border-border')
    expect(tooltip).not.toHaveClass('bg-foreground', 'text-background')
    expect(within(tooltip).getByText('愛克痰發泡錠600毫克')).toBeInTheDocument()
    expect(within(tooltip).getByText('ACTEIN EFFERVESCENT TABLETS 600MG')).toBeInTheDocument()
    expect(within(tooltip).getByText('ACETYLCYSTEINE 600 MG')).toBeInTheDocument()
    expect(within(tooltip).getByText('R05CB01 · acetylcysteine')).toBeInTheDocument()
    expect(compactTitle).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('data-medication-row-layout', 'three-lane')
    expect(container.querySelectorAll('[data-medication-cell]')).toHaveLength(3)
  })

  it('defaults to the ingredient name only without inline product name or ATC', () => {
    mockAudience = 'medical'
    const { container } = render(
      <MedicationItem
        medication={medicationRow(
          'ACETYLCYSTEINE 600 MG',
          'ACTEIN EFFERVESCENT TABLETS 600MG',
        )}
      />,
    )

    expect(screen.getAllByText('ACETYLCYSTEINE 600 MG')).toHaveLength(2)
    expect(screen.getAllByText(/ACTEIN EFFERVESCENT TABLETS 600MG/)).toHaveLength(1)
    const compactTitle = container.querySelector('[tabindex="0"]') as HTMLElement
    expect(within(compactTitle).getByText('ACETYLCYSTEINE 600 MG')).toBeInTheDocument()
    expect(within(compactTitle)
      .queryByText(/ACTEIN EFFERVESCENT TABLETS 600MG/)).not.toBeInTheDocument()
    const tooltip = screen.getByTestId('medication-terminology-tooltip')
    expect(within(tooltip).getByText('愛克痰發泡錠600毫克')).toBeInTheDocument()
    expect(within(tooltip).getByText('ACTEIN EFFERVESCENT TABLETS 600MG')).toBeInTheDocument()
    expect(within(tooltip).getByText('ACETYLCYSTEINE 600 MG')).toBeInTheDocument()
    expect(within(tooltip).getByText('R05CB01 · acetylcysteine')).toBeInTheDocument()
    expect(within(tooltip).getByText(/健保署藥品主檔補充/)).toBeInTheDocument()
    const scheduleLine = container.querySelector('[data-medication-schedule]')
    const contextLine = container.querySelector('[data-medication-context]')
    const classificationLine = container.querySelector('[data-medication-classification]')
    const clinicalLane = container.querySelector('[data-medication-cell="clinical"]')
    const supplyLane = container.querySelector('[data-medication-cell="supply"]')
    expect(scheduleLine).not.toHaveTextContent('R05CB01')
    expect(scheduleLine).toHaveTextContent('26/07/22 → 26/08/12（21 天）')
    expect(scheduleLine).toHaveTextContent('長庚嘉義')
    expect(contextLine).not.toHaveTextContent('長庚嘉義')
    expect(classificationLine).toHaveTextContent('長庚嘉義')
    expect(clinicalLane).not.toHaveTextContent('R05CB01')
    expect(supplyLane).toHaveTextContent('15 筆紀錄')
    expect(screen.getByText('15 筆紀錄 · 2025/1/29 起').parentElement)
      .not.toHaveAttribute('title')
    expect(container.querySelectorAll('[data-medication-cell]')).toHaveLength(3)
  })

  it('shows only the product name when product mode is selected', () => {
    mockAudience = 'medical'
    const { container } = render(
      <MedicationItem
        medication={medicationRow(
          'ACETYLCYSTEINE 600 MG',
          'ACTEIN EFFERVESCENT TABLETS 600MG',
        )}
        nameMode="product"
      />,
    )

    const compactTitle = container.querySelector('[tabindex="0"]') as HTMLElement
    expect(within(compactTitle)
      .getByText('ACTEIN EFFERVESCENT TABLETS 600MG')).toBeInTheDocument()
    expect(within(compactTitle)
      .queryByText('ACETYLCYSTEINE 600 MG')).not.toBeInTheDocument()
    expect(screen.getAllByText('ACETYLCYSTEINE 600 MG')).toHaveLength(1)
  })

  it('shows exact inpatient execution periods on the shared compact row', () => {
    mockAudience = 'medical'
    const { container } = render(
      <MedicationItem
        medication={medicationRow(
          'POTASSIUM CRESOLSULFONATE 90 MG',
          '美致康膠囊「成大」',
        )}
        executionPeriods={[
          {
            start: '2025-05-20T00:00:00+08:00',
            end: '2025-05-21T23:59:59+08:00',
          },
          {
            start: '2025-05-22T00:00:00+08:00',
            end: '2025-05-28T23:59:59+08:00',
          },
        ]}
      />,
    )

    const scheduleLine = container.querySelector('[data-medication-schedule]')
    expect(scheduleLine).toHaveTextContent(
      '執行 2025/05/20–2025/05/21、2025/05/22–2025/05/28',
    )
    expect(container.querySelectorAll('[data-medication-cell]')).toHaveLength(3)
  })

  it('keeps the days-left badge inside constrained parent layouts', () => {
    mockAudience = 'medical'
    const medication = {
      ...medicationRow(
        'ACETYLCYSTEINE 600 MG',
        'ACTEIN EFFERVESCENT TABLETS 600MG',
      ),
      daysRemaining: 2,
    }
    const { container } = render(<MedicationItem medication={medication} />)

    const row = container.firstElementChild
    const badge = screen.getByText('剩 2 天')
    expect(row).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-hidden')
    expect(row).toHaveClass('grid', 'bg-transparent', 'py-1', 'border-b')
    expect(badge.closest('[data-medication-cell="supply"]')).toHaveClass('w-[4.75rem]')
    expect(badge.parentElement).toHaveClass('w-full')
  })

  it('shows a current zero-day cloud calculation without treating zero as missing', () => {
    const medication = {
      ...medicationRow('ACETYLCYSTEINE 600 MG'),
      daysRemaining: 2,
      displayRemainingDays: 0,
      displayRemainingSource: 'cloud-single' as const,
      singlePrescriptionRemainingDays: 0,
      singlePrescriptionRemainingCapturedAt: '2026-08-28T10:00:00+08:00',
      singlePrescriptionRemainingIsCurrent: true,
    }

    render(<MedicationItem medication={medication} />)

    expect(screen.getByText('剩 0 天')).toBeInTheDocument()
    expect(screen.queryByText(/單筆餘藥日數試算/)).not.toBeInTheDocument()
  })

  it('keeps ended history neutral even when its calculated supply is past due', () => {
    const medication = {
      ...medicationRow('AMOXICILLIN 500 MG'),
      isInactive: true,
      daysRemaining: -5,
    }

    render(<MedicationItem medication={medication} />)

    const badge = screen.getByText('已結束').parentElement
    expect(badge).toHaveClass('bg-transparent', 'text-muted-foreground')
    expect(badge).not.toHaveClass('bg-destructive/10', 'text-destructive')
  })

  it('uses the overdue label and red tone only for a still-active past-due row', () => {
    const medication = {
      ...medicationRow('AMOXICILLIN 500 MG'),
      daysRemaining: -5,
    }

    render(<MedicationItem medication={medication} />)

    const badge = screen.getByText('已逾期').parentElement
    expect(badge).toHaveClass('bg-destructive/10', 'text-destructive')
  })

  it('shows route beside the medication name and frequency in the prescription lane', () => {
    mockAudience = 'medical'
    const medication = {
      ...medicationRow('ACETYLCYSTEINE 600 MG'),
      frequency: 'QDPC',
      route: 'PO',
    }
    const { container } = render(<MedicationItem medication={medication} />)

    const scheduleLine = container.querySelector<HTMLElement>('[data-medication-schedule]')
    const frequency = container.querySelector<HTMLElement>('[data-medication-frequency]')
    const route = container.querySelector<HTMLElement>('[data-medication-route]')
    expect(frequency).toHaveTextContent('QDPC')
    expect(frequency).toHaveAttribute('aria-label', '用法用量：QDPC')
    expect(scheduleLine).toContainElement(frequency)
    expect(route).toHaveTextContent('PO')
    expect(route).toHaveAttribute('aria-label', '途徑：PO')
    expect(route?.parentElement).toBe(
      container.querySelector('[data-medication-cell="identity"]')?.firstElementChild,
    )
  })

  it('drops the individual card boundary inside a grouped medication surface', () => {
    mockAudience = 'medical'
    const { container } = render(
      <MedicationItem medication={medicationRow('ACETYLCYSTEINE 600 MG')} grouped />,
    )

    const row = container.firstElementChild
    expect(row).toHaveClass('rounded-none', 'border-0', 'bg-transparent')
    expect(row).not.toHaveClass('rounded-md', 'bg-muted/40')
  })

  it('does not reserve an invisible chronic badge when a row is not chronic', () => {
    mockAudience = 'medical'
    const medication = {
      ...medicationRow(
        'BRIMONIDINE TARTRATE 1.5 MG/ML',
        'BRIMONIN OPHTHALMIC SOLUTION',
      ),
      category: '縮瞳劑',
      isChronic: false,
    }
    const { container } = render(<MedicationItem medication={medication} />)

    const chronicSlot = container.querySelector('[data-medication-chronic-slot]')
    expect(chronicSlot).toBeNull()
    expect(screen.getByText('縮瞳劑')).toBeInTheDocument()
  })

  describe('compact supply summary', () => {
    const dateText = () =>
      screen.getByTestId('medication-schedule-date')

    it('puts route with the name and the complete prescription in the left lane', () => {
      mockAudience = 'medical'
      const medication = {
        ...medicationRow('LEVOTHYROXINE SODIUM 0.05 MG'),
        frequency: 'QOD',
        totalQuantity: 15,
        durationDays: 30,
        startedOn: '2026/8/5',
        endDate: '2026/9/4',
        pharmacy: '新北市聯合醫院',
        dose: '1 錠',
        route: 'PO',
      }
      const { container } = render(<MedicationItem medication={medication} />)

      const schedule = container.querySelector<HTMLElement>('[data-medication-schedule]')
      const context = container.querySelector<HTMLElement>('[data-medication-context]')
      const classification = container.querySelector<HTMLElement>(
        '[data-medication-classification]',
      )
      expect(container.querySelector('[data-medication-frequency]')).toHaveTextContent('QOD')
      expect(container.querySelector('[data-medication-route]')).toHaveTextContent('PO')
      // The shared wrapper still exposes all prescription metadata in DOM
      // order; on wide containers CSS places regimen and classification in
      // separate, vertically aligned grid columns.
      expect(schedule?.textContent).toContain(
        '26/08/05 → 26/09/04（30 天） 1 錠 QOD 總量 15',
      )
      expect(
        container.querySelector('[data-medication-frequency-total-gap]')?.textContent,
      ).toBe(' ')
      expect(container.querySelector('[data-medication-total-separator]')).toBeNull()
      expect(container.querySelector('[data-medication-frequency]'))
        .toHaveClass('font-normal', 'text-muted-foreground')
      expect(container.querySelector('[data-medication-frequency]'))
        .not.toHaveClass('font-semibold', 'text-foreground/80')
      expect(context).not.toHaveTextContent('新北市聯合醫院')
      expect(classification).toHaveTextContent('新北市聯合醫院')
      // Narrow panels use a dedicated third line for classification.
      expect(schedule).toContainElement(classification)
      expect(schedule).toHaveClass('contents')
      expect(container.querySelector('[data-medication-regimen]')).toHaveClass(
        'col-start-1',
        'row-start-2',
      )
      expect(classification).toHaveClass(
        'col-start-2',
        'row-start-3',
        '@min-[456px]:row-start-2',
      )
      expect(container.querySelector('[data-medication-total-quantity]'))
        .toHaveTextContent('總量 15')
      expect(container.querySelector('[data-medication-supply-days]'))
        .toHaveTextContent('（30 天）')
      expect(dateText()).toHaveAttribute('title', '2026/08/05 → 2026/09/04（30 天）')
      expect(dateText()).toHaveClass('truncate')
      expect(container.querySelector('[data-medication-schedule-end]')).toHaveTextContent('→ 26/09/04')
      // The date yields first on constrained rows so frequency and total
      // quantity remain visible; the full range stays in the title.
      expect(dateText().parentElement).toHaveClass('shrink')
      expect(screen.getByText('1 錠').parentElement).toHaveClass('shrink-0')
      // The identity wrapper dissolves into the two-line grid.
      expect(container.querySelector('[data-medication-cell="identity"]'))
        .toHaveClass('contents')
      expect(schedule).toHaveClass('contents')
      // ICD remains a single flex line while classification independently
      // occupies the same column's second grid row on wide containers.
      expect(context).toHaveClass('flex-1')
    })

    it('omits missing supply facts without leaving empty labels', () => {
      mockAudience = 'medical'
      const medication = {
        ...medicationRow('AMOXICILLIN 500 MG'),
        totalQuantity: undefined,
        durationDays: undefined,
      }
      const { container } = render(<MedicationItem medication={medication} />)

      expect(container.querySelector('[data-medication-total-quantity]')).toBeNull()
      expect(container.querySelector('[data-medication-supply-days]')).toBeNull()
      expect(dateText()).toHaveTextContent('26/07/22 → 26/08/12')
      expect(container.querySelector('[data-medication-schedule-end]')).not.toHaveClass('hidden')
    })

    it('keeps the complete coverage range for a stopped medication', () => {
      mockAudience = 'medical'
      const medication = { ...medicationRow('AMOXICILLIN 500 MG'), isInactive: true }
      const { container } = render(<MedicationItem medication={medication} />)

      expect(dateText()).toHaveTextContent('26/07/22 → 26/08/12（21 天）')
      expect(container.querySelector('[data-medication-schedule-end]')).not.toHaveClass('hidden')
    })

    it('keeps both years when a medication range crosses New Year', () => {
      mockAudience = 'medical'
      const medication = {
        ...medicationRow('AMOXICILLIN 500 MG'),
        startedOn: '2025/12/24',
        endDate: '2026/1/23',
        durationDays: 30,
      }
      render(<MedicationItem medication={medication} />)

      expect(dateText()).toHaveTextContent(
        '25/12/24 → 26/01/23（30 天）',
      )
      expect(dateText()).toHaveAttribute(
        'title',
        '2025/12/24 → 2026/01/23（30 天）',
      )
    })
  })

  it('stacks diagnosis above institution and classification in the middle lane', () => {
    mockAudience = 'medical'
    const medication = {
      ...medicationRow(
        'OXYBUTYNIN CHLORIDE 5 MG',
        'DITROPAN TABLETS 5 MG',
      ),
      category: '生殖泌尿道平滑肌鬆弛劑',
      icdCode: 'N40.0',
      icdText: '良性攝護腺增生未伴有下泌尿道症狀',
    }
    const { container } = render(<MedicationItem medication={medication} />)

    const clinicalLane = container.querySelector('[data-medication-cell="clinical"]')
    const contextLine = container.querySelector('[data-medication-context]')
    const classificationLine = container.querySelector('[data-medication-classification]')
    // The chip clips on its box and ellipses on an inner span, so the text
    // node's parent is the chip itself.
    const category = screen.getByText('生殖泌尿道平滑肌鬆弛劑').parentElement!
    const icd = screen.getByLabelText('N40.0 良性攝護腺增生未伴有下泌尿道症狀')

    // The medication column gets more width than ICD at every panel size.
    expect(container.firstElementChild).toHaveClass(
      'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.75rem]',
    )
    expect(clinicalLane).toHaveClass('h-4')
    expect(clinicalLane).not.toHaveClass('grid-rows-2')
    expect(category).toHaveClass('max-w-full')
    expect(category).not.toHaveClass('max-w-[10rem]')
    expect(contextLine).toContainElement(icd)
    expect(icd).toHaveClass('inline-flex', 'max-w-full')
    expect(icd).not.toHaveClass('flex-1')
    expect(contextLine).not.toHaveTextContent('長庚嘉義')
    expect(classificationLine).toHaveTextContent('長庚嘉義')
    expect(classificationLine).toContainElement(category)
    expect(classificationLine).toHaveClass(
      'col-start-2',
      'row-start-3',
      '@min-[456px]:row-start-2',
    )
    expect(clinicalLane).toContainElement(icd)
    const icdTooltip = screen.getByTestId('medication-icd-tooltip')
    expect(icdTooltip).toHaveClass(
      'border-border',
      'bg-popover',
      'text-popover-foreground',
      'shadow-md',
    )
    expect(icdTooltip).not.toHaveClass('bg-foreground', 'text-background')
  })
})
