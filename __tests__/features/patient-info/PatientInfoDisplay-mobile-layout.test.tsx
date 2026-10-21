import { render, screen } from '@testing-library/react'
import { PatientInfoDisplay } from '@/features/clinical-summary/patient-info/components/PatientInfoDisplay'
import { LanguageProvider } from '@/src/application/providers/language.provider'

function renderInfo(patientInfo: Parameters<typeof PatientInfoDisplay>[0]['patientInfo']) {
  return render(
    <LanguageProvider>
      <PatientInfoDisplay patientInfo={patientInfo} />
    </LanguageProvider>,
  )
}

describe('PatientInfoDisplay single line', () => {
  it('puts name, sex, age and ID on one line, known values without labels', () => {
    const { container } = renderInfo({ id: 'demo-patient-1', name: '陳○明', gender: '男性', age: '94' })

    const line = container.querySelector('p')!
    expect(line).toHaveTextContent('陳○明')
    expect(line).toHaveTextContent('男性')
    expect(line).toHaveTextContent('94歲')
    // The long ID breaks anywhere rather than widening a phone-width card.
    expect(screen.getByText('ID demo-patient-1')).toHaveClass('break-all')
    // Labels stay available to screen readers only.
    expect(screen.getByText(/^年齡/)).toHaveClass('sr-only')
  })

  it('labels a value that means nothing on its own', () => {
    renderInfo({ name: '未知', gender: '未知', age: 'N/A' })

    expect(screen.getByText('性別')).not.toHaveClass('sr-only')
    expect(screen.getByText('年齡')).not.toHaveClass('sr-only')
    expect(screen.getByText('N/A')).toBeInTheDocument()
  })
})
