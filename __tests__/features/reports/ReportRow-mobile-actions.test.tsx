import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReportRow } from '@/features/clinical-summary/reports/components/ReportRow'
import type { Row } from '@/features/clinical-summary/reports/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { RightDetailProvider, useRightDetail } from '@/src/application/providers/right-detail.provider'

// jsdom ships no matchMedia, so the layout hook reads "desktop" unless a test
// says otherwise — which is what keeps the rest of this file on the desktop
// contract.
function useCompactLayout() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

/** Surfaces what the right pane is currently showing, so a row's tap can be
 *  checked by its EFFECT rather than by the handler being wired. */
function RightDetailProbe() {
  const { detail } = useRightDetail()
  return <span data-testid="right-detail-source">{detail?.sourceId ?? 'none'}</span>
}

function RightDetailNodeProbe() {
  const { detail } = useRightDetail()
  return (
    <aside data-testid="right-detail-node" data-source-id={detail?.sourceId ?? ''}>
      {detail?.node}
    </aside>
  )
}

const COMPACT_ROW: Row = {
  id: 'report-2',
  title: 'Potassium',
  meta: 'Laboratory • final',
  group: 'lab',
  institution: '臺北榮民總醫院',
  effectiveDate: '2026-07-15',
  obs: [{
    id: 'obs-2',
    code: { text: 'Potassium' },
    valueQuantity: { value: 4.1, unit: 'mmol/L' },
  }],
}

function renderCompactRow() {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          <RightDetailProbe />
          <ReportRow row={COMPACT_ROW} defaultOpen={[]} />
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

jest.mock('@/features/report-interpretation', () => ({
  ReportInterpretationButton: jest.requireActual(
    '@/features/report-interpretation/ReportInterpretationButton',
  ).ReportInterpretationButton,
  ReportInterpretationLauncher: ({
    onReady,
    dataTour,
    detailSourceId,
    asDiv,
  }: {
    onReady: () => void
    dataTour?: string
    detailSourceId?: string
    asDiv?: boolean
  }) => {
    const Button = jest.requireActual(
      '@/features/report-interpretation/ReportInterpretationButton',
    ).ReportInterpretationButton
    return (
      <Button
        active={false}
        asDiv={asDiv}
        dataTour={dataTour}
        detailSourceId={detailSourceId}
        onToggle={(event: React.MouseEvent) => {
          event.stopPropagation()
          onReady()
        }}
      />
    )
  },
  ReportInterpretationPanel: ({ autoGenerate = true }: { autoGenerate?: boolean }) => (
    <span data-testid="report-interpretation-panel" data-auto-generate={String(autoGenerate)} />
  ),
}))

describe('ReportRow mobile actions', () => {
  // Undo the stub between tests: leaving it set would silently put every later
  // test on the compact contract depending on declaration order.
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('labels a row with its report type when rendered in a mixed list', () => {
    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ReportRow row={COMPACT_ROW} defaultOpen={[]} showTypeBadge />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('report-type-badge')).toHaveTextContent('檢驗')
    expect(screen.getByTestId('report-type-badge')).toHaveClass(
      'border-transparent',
      'text-muted-foreground',
    )
  })

  it('wraps narrative report actions without shrinking the AI button', () => {
    const row: Row = {
      id: 'report-1',
      title: '胸部電腦斷層檢查報告',
      meta: 'Radiology • final',
      group: 'imaging',
      institution: '臺北榮民總醫院',
      effectiveDate: '2026-07-15',
      obs: [{
        id: 'obs-1',
        code: { text: 'Report Summary' },
        valueString: 'No focal consolidation. No pleural effusion. The cardiac silhouette is within normal limits.',
      }],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <RightDetailProbe />
            <RightDetailNodeProbe />
            <ReportRow row={row} defaultOpen={[]} />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    const aiButton = screen.getByRole('button', { name: 'AI翻譯' })
    expect(aiButton).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(aiButton).toHaveAttribute('data-detail-source-id', 'report:report-1')

    const header = aiButton.closest('[role="button"][aria-expanded]')
    expect(header).toHaveClass('flex-col', '@min-[520px]:flex-row')
    expect(header?.parentElement).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-hidden')
    expect(aiButton.parentElement).toHaveClass('flex-wrap', 'justify-start')
    expect(aiButton.parentElement).toHaveClass('@min-[520px]:flex-nowrap', '@min-[520px]:justify-end')

    // The collapsed preview shows on phones too — the conclusion is what a
    // reader scanning the list needs, at every width.
    expect(screen.getByText(/No focal consolidation/)).not.toHaveClass('max-sm:hidden')
    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(aiButton)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('right-detail-source')).toHaveTextContent('report:report-1')
    expect(screen.getByTestId('report-interpretation-panel'))
      .toHaveAttribute('data-auto-generate', 'false')

    const rightPaneButton = screen.getByRole('button', { name: '在右側面板展開全文' })
    expect(rightPaneButton).toHaveClass('!opacity-100', 'bg-foreground/[0.07]', 'text-foreground')

    fireEvent.click(rightPaneButton)
    expect(screen.getByTestId('right-detail-source')).toHaveTextContent('none')
    expect(rightPaneButton).toHaveClass('md:inline-flex', 'border-transparent', 'bg-transparent')

    fireEvent.click(rightPaneButton)
    expect(screen.getByTestId('report-interpretation-panel'))
      .toHaveAttribute('data-auto-generate', 'false')
  })

  it('copies narrative reports with the formatted on-screen line breaks', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const row: Row = {
      id: 'formatted-copy-report',
      title: 'Chest X-ray',
      meta: 'Radiology • final',
      group: 'imaging',
      institution: 'A Hospital',
      effectiveDate: '2026-06-02',
      obs: [{
        id: 'formatted-copy-observation',
        code: { text: 'Report Summary' },
        valueString:
          'Radiography of Chest A-P View(Supine) Show:Tortuosity thoracic aorta. ' +
          'Borderline cardiomegaly. Bilateral pleural change with effusion.',
      }],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ReportRow row={row} defaultOpen={[row.id]} />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '複製報告全文' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith([
      'Radiography of Chest A-P View(Supine) Show:',
      '  Tortuosity thoracic aorta.',
      '  Borderline cardiomegaly.',
      '  Bilateral pleural change with effusion.',
    ].join('\n')))
  })

  it('shows the blood-pressure reading instead of a one-item count', () => {
    const bloodPressure: Row = {
      id: 'vital-blood-pressure',
      title: 'Blood pressure',
      meta: 'Vital signs • final',
      group: 'vitals',
      institution: '示範康德診所',
      effectiveDate: '2026-07-15',
      obs: [{
        id: 'blood-pressure-observation',
        code: { text: 'Blood pressure panel' },
        component: [
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
            valueQuantity: { value: 128, unit: 'mmHg' },
          },
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
            valueQuantity: { value: 76, unit: 'mmHg' },
          },
        ],
      }],
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ReportRow row={bloodPressure} defaultOpen={[]} />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('report-panel-summary')).toHaveTextContent('128/76 mmHg')
    expect(screen.queryByText('1 項')).not.toBeInTheDocument()
  })

  it('keeps vital metadata aligned with the reserved accordion-control column', () => {
    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <ReportRow
              row={{
                ...COMPACT_ROW,
                id: 'vital-height',
                title: 'Body height',
                group: 'vitals',
                sourceProgram: 'adult-preventive',
              }}
              defaultOpen={[]}
            />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByTestId('compact-lab-result-row'))
      .toHaveClass('@min-[800px]:!grid')
    expect(screen.getByTestId('vital-report-meta'))
      .toHaveClass('@min-[800px]:grid-cols-[152px_168px_auto]')
    expect(screen.getByTestId('vital-toggle-slot'))
      .toHaveClass('@min-[800px]:block', 'h-4', 'w-4')
  })

  it('keeps the standalone trend button on desktop', () => {
    // Desktop interaction is unchanged: a real icon button with its own label,
    // and a row that is NOT a control (hover + click the icon, as before).
    renderCompactRow()

    const compactRow = screen.getByTestId('compact-lab-result-row')
    expect(compactRow).not.toHaveAttribute('role')
    expect(compactRow).not.toHaveAttribute('tabindex')

    const action = compactRow.querySelector('[data-report-history-action]')
    expect(action).not.toBeNull()
    expect(action).toHaveAttribute('aria-label', '查看趨勢')
    expect(action).toHaveClass('min-h-[36px]', 'min-w-[36px]')
  })

  it('hands the tap to the whole row on the single-panel layout', () => {
    // A one-line result row is ~24px tall and ~343px wide: as a target it beats
    // the 36px icon it used to need, and it lets the row stop padding out
    // around that icon. The icon stays as a cue, but the ROW owns the role, the
    // accessible name and the handler — and it must open the very same detail.
    useCompactLayout()
    renderCompactRow()

    const compactRow = screen.getByTestId('compact-lab-result-row')
    expect(compactRow).toHaveAttribute('role', 'button')
    expect(compactRow).toHaveAttribute('tabindex', '0')
    // Reading first, action second: the row's own text is its default name, so
    // labelling it with the bare action would cost a screen-reader user the
    // result they navigated to.
    expect(compactRow).toHaveAttribute('aria-label', 'Potassium 4.1 mmol/L，查看趨勢')
    // The icon is demoted to decoration — no second tab stop, no second
    // announcement of the same action inside the control.
    expect(compactRow.querySelector('[data-report-history-action]')).toBeNull()
    expect(screen.getByTestId('right-detail-source')).toHaveTextContent('none')

    fireEvent.click(compactRow)
    expect(screen.getByTestId('right-detail-source'))
      .toHaveTextContent('report-longitudinal:report-2:obs-2')
  })

  it('opens the row from the keyboard too', () => {
    useCompactLayout()
    renderCompactRow()

    const compactRow = screen.getByTestId('compact-lab-result-row')
    fireEvent.keyDown(compactRow, { key: 'Enter' })
    expect(screen.getByTestId('right-detail-source'))
      .toHaveTextContent('report-longitudinal:report-2:obs-2')
  })

  it('lets an inner control keep its own tap', () => {
    // The row swallowing every tap would break the expandable value and the
    // NHI viewer links sharing it.
    useCompactLayout()
    renderCompactRow()

    const compactRow = screen.getByTestId('compact-lab-result-row')
    const inner = document.createElement('button')
    compactRow.appendChild(inner)
    fireEvent.click(inner)

    expect(screen.getByTestId('right-detail-source')).toHaveTextContent('none')
  })
})
