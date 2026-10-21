/**
 * Answers are kept per observation, not per page. A page that asks what
 * another disease's page already asked today shows that answer as answered,
 * says where and when it was given, and lets one press change it for both.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { VisitAsks, type VisitAnswerProvenance } from '@/features/clinical-decision-support/renderers/visit/VisitAsks'
import type { VisitAsk } from '@/features/clinical-decision-support/types'

const DYSPNOEA: VisitAsk = {
  id: 'dyspnoea-trend',
  label: '喘比上次',
  options: [{ value: 'worse', label: '變差' }, { value: 'stable', label: '穩定' }, { value: 'better', label: '進步' }],
}

const ANSWERED_AT = new Date(2026, 8, 29, 10, 32).toISOString()

function answeredOn(packId: string, pageLabel?: string): VisitAnswerProvenance {
  return { 'dyspnoea-trend': { answeredAt: ANSWERED_AT, packId, ...(pageLabel ? { pageLabel } : {}) } }
}

describe('an answer given on another page', () => {
  it('is shown answered, with the page and time it was given on', () => {
    const onAnswer = jest.fn()
    render(
      <VisitAsks
        asks={[DYSPNOEA]}
        answers={{ 'dyspnoea-trend': 'worse' }}
        isEnglish={false}
        onAnswer={onAnswer}
        pagePackId="copd-cdss"
        sources={answeredOn('heart-failure-cdss', '心衰竭')}
      />,
    )
    const worse = document.querySelector('[data-visit-ask="dyspnoea-trend"][data-value="worse"]')!
    expect(worse).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('[data-visit-answer-source="dyspnoea-trend"]')).toHaveTextContent('已在「心衰竭」頁回答 · 10:32')
    // One press changes it — the same answer every page reads.
    fireEvent.click(screen.getByRole('button', { name: '穩定' }))
    expect(onAnswer).toHaveBeenCalledWith('dyspnoea-trend', 'stable')
  })

  it('says nothing for an answer given on this page, or one with no page recorded', () => {
    const { rerender } = render(
      <VisitAsks
        asks={[DYSPNOEA]}
        answers={{ 'dyspnoea-trend': 'worse' }}
        isEnglish={false}
        pagePackId="heart-failure-cdss"
        sources={answeredOn('heart-failure-cdss', '心衰竭')}
      />,
    )
    expect(document.querySelector('[data-visit-answer-source]')).toBeNull()
    rerender(
      <VisitAsks
        asks={[DYSPNOEA]}
        answers={{ 'dyspnoea-trend': 'worse' }}
        isEnglish={false}
        pagePackId="heart-failure-cdss"
        sources={{ 'dyspnoea-trend': { answeredAt: ANSWERED_AT } }}
      />,
    )
    expect(document.querySelector('[data-visit-answer-source]')).toBeNull()
  })

  it('says nothing for the record’s own reading, which no page answered', () => {
    // A stale source left for an answer since withdrawn: the prefill shown in
    // its place is the record's, not the other page's.
    render(
      <VisitAsks
        asks={[{ ...DYSPNOEA, prefill: { value: 'stable', basis: '體重與上次相同' } }]}
        answers={{}}
        isEnglish={false}
        pagePackId="copd-cdss"
        sources={answeredOn('heart-failure-cdss', '心衰竭')}
      />,
    )
    expect(document.querySelector('[data-visit-ask="dyspnoea-trend"][data-value="stable"]')).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('[data-visit-answer-source]')).toBeNull()
  })

  it('names the page by its pack id when it has no name, in English too', () => {
    render(
      <VisitAsks
        asks={[DYSPNOEA]}
        answers={{ 'dyspnoea-trend': 'worse' }}
        isEnglish
        pagePackId="copd-cdss"
        sources={answeredOn('heart-failure-cdss')}
      />,
    )
    expect(document.querySelector('[data-visit-answer-source="dyspnoea-trend"]')).toHaveTextContent('Answered on the heart-failure-cdss page · 10:32')
  })
})
