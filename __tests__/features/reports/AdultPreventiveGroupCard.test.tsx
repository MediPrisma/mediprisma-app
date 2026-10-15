import { fireEvent, render, screen } from '@testing-library/react'
import { AdultPreventiveGroupCard } from '@/features/clinical-summary/reports/components/AdultPreventiveGroupCard'
import type { Row } from '@/features/clinical-summary/reports/types'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { RightDetailProvider } from '@/src/application/providers/right-detail.provider'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const bloodPressure: Row = {
  id: 'blood-pressure',
  title: 'Blood Pressure',
  meta: 'Vital signs',
  group: 'vitals',
  institution: '良安診所',
  effectiveDate: '2024-06-28',
  sourceProgram: 'adult-preventive',
  obs: [{
    id: 'bp-observation',
    code: { text: 'Blood Pressure' },
    component: [
      {
        code: { text: 'Systolic blood pressure' },
        valueQuantity: { value: 130, unit: 'mmHg' },
      },
      {
        code: { text: 'Diastolic blood pressure' },
        valueQuantity: { value: 90, unit: 'mmHg' },
      },
    ],
  }],
}

const cholesterol: Row = {
  id: 'cholesterol',
  title: 'CHOL',
  meta: 'Laboratory',
  group: 'lab',
  institution: '良安診所',
  effectiveDate: '2024-06-28',
  sourceProgram: 'adult-preventive',
  obs: [{
    id: 'cholesterol-observation',
    code: { text: 'CHOL' },
    valueQuantity: { value: 210, unit: 'mg/dL' },
  }],
}

const liverPanel: Row = {
  id: 'liver-panel',
  title: 'Liver panel',
  meta: 'Laboratory',
  group: 'lab',
  institution: '良安診所',
  effectiveDate: '2024-06-28',
  sourceProgram: 'adult-preventive',
  obs: [
    {
      id: 'ast-observation',
      code: { text: 'AST' },
      valueQuantity: { value: 16, unit: 'IU/L' },
    },
    {
      id: 'alt-observation',
      code: { text: 'ALT' },
      valueQuantity: { value: 12, unit: 'IU/L' },
    },
  ],
}

const group: Row = {
  ...cholesterol,
  id: 'adult-preventive:2024-06-28',
  title: 'Adult health exam',
  obs: [],
  groupedRows: [cholesterol, bloodPressure, liverPanel],
  adultPreventiveGroup: true,
}

function renderCard() {
  return render(
    <LanguageProvider>
      <AudienceProvider>
        <RightDetailProvider>
          <AdultPreventiveGroupCard row={group} defaultOpen={[]} />
        </RightDetailProvider>
      </AudienceProvider>
    </LanguageProvider>,
  )
}

describe('AdultPreventiveGroupCard', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    })
  })

  it('summarizes one adult health-exam encounter in a compact row', () => {
    renderCard()

    const toggle = screen.getByRole('button', { name: '展開成人預防保健項目' })
    expect(toggle).toHaveClass('min-h-11', 'py-1.5')
    expect(toggle).toHaveTextContent('成人預防保健')
    expect(toggle).toHaveTextContent('良安診所')
    expect(toggle.querySelector('time[datetime="2024-06-28"]')).toBeInTheDocument()
    expect(toggle).toHaveTextContent('3 項')
    expect(screen.queryByText('CHOL')).not.toBeInTheDocument()
  })

  it('opens only the systolic/diastolic blood-pressure panel by default', () => {
    renderCard()

    fireEvent.click(screen.getByText('良安診所'))

    expect(screen.getByText('CHOL')).toBeInTheDocument()
    expect(screen.getByText('Systolic blood pressure')).toBeInTheDocument()
    expect(screen.getByText('Diastolic blood pressure')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Blood Pressure/ }))
      .toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Liver panel/ }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('AST')).not.toBeInTheDocument()
    expect(screen.queryByText('ALT')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收合成人預防保健項目' }))
      .toHaveAttribute('aria-expanded', 'true')
  })
})
