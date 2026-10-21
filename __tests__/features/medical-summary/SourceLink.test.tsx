import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SourceLink } from '@/features/medical-summary/components/SourceLink'
import { LanguageProvider, useLanguage } from '@/src/application/providers/language.provider'

function CurrentLocale() {
  return <span data-testid="current-locale">{useLanguage().locale}</span>
}

describe('SourceLink', () => {
  it('opens one clean source straight from the cited text, with no citation marks', () => {
    const onNavigate = jest.fn()
    const { container } = render(
      <p>
        <SourceLink
          sources={[{ key: 'L1', num: 1, verified: true, resourceType: 'Observation',
            resourceId: 'observation-egfr', organization: '臺北榮總', date: '2026-06-02', display: 'eGFR' }]}
          typeLabel={(resourceType) => resourceType ?? ''}
          unverifiedLabel="來源可能有問題，請核對"
          onNavigate={onNavigate}
        >
          eGFR 32
        </SourceLink>
      </p>,
    )

    expect(container.querySelector('sup')).toBeNull()
    const link = screen.getByRole('button', { name: /^eGFR 32\s*（開啟來源：Observation · 臺北榮總 · 2026-06-02）/ })
    fireEvent.click(link)
    expect(onNavigate).toHaveBeenCalledWith({
      resourceType: 'Observation',
      resourceId: 'observation-egfr',
      display: 'eGFR',
      date: '2026-06-02',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.keyDown(link, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('lists several sources before opening one', () => {
    const onNavigate = jest.fn()
    render(
      <SourceLink
        sources={[
          { key: 'L1', num: 1, verified: true, resourceType: 'Observation', resourceId: 'cr-1', date: '2026-05-25', display: 'Creatinine' },
          { key: 'L2', num: 2, verified: true, resourceType: 'Observation', resourceId: 'cr-2', date: '2026-06-02', display: 'Creatinine' },
        ]}
        typeLabel={(resourceType) => resourceType ?? ''}
        unverifiedLabel="來源可能有問題，請核對"
        onNavigate={onNavigate}
      >
        Cr 1.88 → 1.93
      </SourceLink>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Cr 1\.88 → 1\.93\s*（2 筆來源）/ }))
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Observation · 2026-06-02/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'cr-2' }))
  })

  it('warns about a mismatched excerpt before navigating, and keeps the original reachable', () => {
    const onNavigate = jest.fn()
    render(<SourceLink sources={[{ key: 'D1', num: 1, verified: true, resourceType: 'DocumentReference',
      resourceId: 'synthetic-doc', display: '合成病摘', evidenceQuote: 'Unmatched synthetic quote', evidenceWarning: 'mismatch' }]}
      typeLabel={() => '文件'} unverifiedLabel="來源不存在" onNavigate={onNavigate}>出院病摘記載</SourceLink>)
    fireEvent.click(screen.getByRole('button', { name: /出院病摘記載\s*（1 筆來源，來源不存在）/ }))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.getByText('引文與來源原文不符，請點開來源核對。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /合成病摘/ }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'synthetic-doc', evidenceQuote: 'Unmatched synthetic quote' }))
  })

  it('hides a trailing NHI institution code without changing source navigation', () => {
    const onNavigate = jest.fn()

    render(
      <SourceLink
        sources={[{
          key: 'L1',
          num: 1,
          verified: true,
          resourceType: 'Observation',
          resourceId: 'observation-hba1c',
          organization: '臺北榮總;門診;0601160016',
          date: '2026-05-05',
          display: 'HbA1c',
        }]}
        typeLabel={(resourceType) => resourceType ?? ''}
        unverifiedLabel="來源可能有問題，請核對"
        onNavigate={onNavigate}
      >
        HbA1c 6.6%
      </SourceLink>,
    )

    expect(document.body).not.toHaveTextContent('0601160016')
    fireEvent.click(screen.getByRole('button', { name: /HbA1c 6\.6%\s*（開啟來源：Observation · 臺北榮總 · 2026-05-05）/ }))
    expect(onNavigate).toHaveBeenCalledWith({
      resourceType: 'Observation',
      resourceId: 'observation-hba1c',
      display: 'HbA1c',
      date: '2026-05-05',
    })
  })

  it('renders the text alone when nothing is cited', () => {
    render(<SourceLink sources={[]} typeLabel={() => ''} unverifiedLabel="" onNavigate={jest.fn()}>Forxiga 10 mg</SourceLink>)
    expect(screen.getByText('Forxiga 10 mg')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps long pre-generated traces scrollable inside the available viewport', () => {
    render(
      <SourceLink
        sources={Array.from({ length: 11 }, (_, index) => ({
          key: `O${index + 1}`,
          num: index + 1,
          verified: true,
          resourceType: 'Observation',
          resourceId: `observation-${index + 1}`,
          display: `Observation ${index + 1}`,
        }))}
        typeLabel={(resourceType) => resourceType ?? ''}
        unverifiedLabel="來源可能有問題，請核對"
        onNavigate={jest.fn()}
      >
        慢性腎臟病
      </SourceLink>,
    )

    fireEvent.click(screen.getByRole('button', { name: /慢性腎臟病\s*（11 筆來源）/ }))

    const trace = screen.getByRole('dialog')
    expect(trace).toHaveClass('overflow-y-auto', 'overscroll-contain')
    expect(trace).toHaveStyle({
      maxHeight: 'min(20rem, calc(var(--radix-popover-content-available-height) - 0.5rem))',
    })
    expect(screen.getByRole('button', { name: /Observation 11/ })).toBeInTheDocument()
  })

  it('localizes frozen demo source titles in the English trace only', async () => {
    localStorage.setItem('medical-note-locale', 'en')

    render(
      <LanguageProvider>
        <CurrentLocale />
        <SourceLink
          sources={[
            { key: 'K1', num: 1, verified: true, resourceType: 'CarePlan', resourceId: 'demo-careplan-1',
              organization: '示範北辰醫院', display: '末期腎臟病前期（Pre-ESRD）之病人照護與衛教計畫' },
            { key: 'K2', num: 2, verified: true, resourceType: 'Encounter', resourceId: 'demo-encounter-1' },
          ]}
          typeLabel={(resourceType) => resourceType ?? ''}
          unverifiedLabel="Source may be incorrect"
          onNavigate={jest.fn()}
        >
          CKD
        </SourceLink>
      </LanguageProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('current-locale')).toHaveTextContent('en'))
    fireEvent.click(screen.getByRole('button', { name: /CKD\s*\(2 sources\)/ }))

    expect(screen.getByText(/CarePlan · C Hospital/)).toBeInTheDocument()
    expect(screen.getByText('Pre-ESRD patient care and education program')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('末期腎臟病前期')
  })
})
