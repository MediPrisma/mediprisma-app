import { render, screen } from '@testing-library/react'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { RightDetailProvider } from '@/src/application/providers/right-detail.provider'
import { VisitItem } from '@/features/clinical-summary/visit-history/components/VisitItem'
import type {
  EncounterDetails,
  EncounterMedication,
} from '@/features/clinical-summary/visit-history/hooks/useEncounterDetails'

jest.mock(
  '@/features/clinical-summary/document-summary/components/DocumentDetailDialog',
  () => ({
    DocumentDetailDialog: () => null,
  }),
)

jest.mock(
  '@/features/clinical-summary/reports/components/ReportRow',
  () => ({
    ReportRow: () => null,
  }),
)

function medication(
  id: string,
  start: string,
  end: string,
): EncounterMedication {
  return {
    id,
    drugKey: 'AC426051G0',
    title: '美致康膠囊「成大」',
    status: 'completed',
    startedOn: start,
    stoppedOn: end,
    endDate: end,
    isInactive: true,
    isChronic: false,
    refillCount: 2,
    searchHaystack: '',
    executionPeriod: { start, end },
  }
}

describe('VisitItem inpatient medication periods', () => {
  it('shows every source execution window on the shared medication row', () => {
    const first = medication('med-1', '2025-05-20', '2025-05-21')
    const second = medication('med-2', '2025-05-22', '2025-05-28')
    const details: EncounterDetails = {
      diagnoses: [],
      medications: [first, second],
      medSeries: [{
        id: 'AC426051G0',
        name: '美致康膠囊「成大」',
        isChronic: false,
        firstDate: '2025-05-20',
        lastDate: '2025-05-22',
        refills: [first, second],
      }],
      tests: [],
      testGroups: [],
      reports: [],
      procedures: [],
      clinicalNotes: [],
      isMultiDay: true,
    }

    render(
      <LanguageProvider>
        <AudienceProvider>
          <RightDetailProvider>
            <VisitItem
              visit={{
                id: 'inpatient-1',
                type: 'inpatient',
                careDiscipline: 'western',
                date: '2025-05-18',
                endDate: '2025-05-22',
                icdCodes: [],
                status: 'finished',
              }}
              details={details}
              isExpanded
              onToggle={() => undefined}
            />
          </RightDetailProvider>
        </AudienceProvider>
      </LanguageProvider>,
    )

    expect(screen.getByText(
      '執行 2025/05/20–2025/05/21、2025/05/22–2025/05/28',
    )).toBeInTheDocument()
    expect(screen.getByText('住院')).toHaveClass(
      'bg-foreground/[0.07]',
      'text-foreground',
    )
    expect(screen.getByText('住院')).not.toHaveClass('bg-emerald-100', 'text-emerald-700')
  })
})
