import { render, screen } from '@testing-library/react'
import { BookAsks } from '@/features/clinical-decision-support/renderers/visit/BookAsks'
import { CarriedAnswerContext } from '@/features/clinical-decision-support/renderers/visit/carried-answer-context'
import type { VisitAsk } from '@/features/clinical-decision-support/types'

const ask = { id: 'trigger-infection', label: '感染', options: [{ value: 'yes', label: '有' }, { value: 'no', label: '無' }] } as unknown as VisitAsk
const nyha = { id: 'nyha', label: 'NYHA 分級', options: [{ value: 'II', label: 'II' }, { value: 'III', label: 'III' }], answer: 'III', previous: '上次評估 NYHA III（08/01）' }

test('a carried answer says it was carried and from which day; an answer given today does not', () => {
  const year = new Date().getFullYear()
  const lookup = (key: string) => (key === 'visit:trigger-infection' || key === 'nyha' ? `${year}-09-01` : null)
  const view = render(
    <CarriedAnswerContext.Provider value={lookup}>
      <BookAsks asks={[ask]} answers={{ 'trigger-infection': 'yes' } as never} isEnglish={false} examAsks={[nyha]} />
    </CarriedAnswerContext.Provider>,
  )
  expect(screen.getAllByText('帶入 · 09/01')).toHaveLength(2)
  // The carried grade replaces the pack's 「上次評估」 line rather than repeating it.
  expect(screen.queryByText(/上次評估/)).not.toBeInTheDocument()
  view.rerender(
    <CarriedAnswerContext.Provider value={() => null}>
      <BookAsks asks={[ask]} answers={{ 'trigger-infection': 'yes' } as never} isEnglish={false} examAsks={[nyha]} />
    </CarriedAnswerContext.Provider>,
  )
  expect(screen.queryByText(/帶入 ·/)).not.toBeInTheDocument()
})
