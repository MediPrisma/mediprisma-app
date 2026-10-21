/**
 * The prototype's decision buttons on 決策地圖 v2: which recommendation is the
 * red one. A safety row stays red on a later step whose own state is not
 * safety (the pack sets `QueueRow.safety` from the chain's head).
 */
import { render, screen } from '@testing-library/react'
import { BookDecisionControls } from '@/features/clinical-decision-support/renderers/visit/BookDecisionControls'
import type { DecisionPointView } from '@/features/clinical-decision-support/types'

const point = (state: string) => ({
  dp: 'DP-09',
  label: 'MRA',
  state,
  actions: [{ id: 'reduce', label: '減半劑量' }, { id: 'hold', label: '暫停' }],
}) as unknown as DecisionPointView

const primary = () => screen.getByRole('button', { name: '減半劑量' })

it('a safety point\'s recommendation is the red button', () => {
  render(<BookDecisionControls point={point('safety')} isEnglish={false} onDecide={jest.fn()} />)
  expect(primary()).toHaveClass('priSafety')
})

it('a safety row keeps it red on a step whose own state is not safety', () => {
  render(<BookDecisionControls point={point('act')} isEnglish={false} safety onDecide={jest.fn()} />)
  expect(primary()).toHaveClass('priSafety')
  expect(primary()).not.toHaveClass('pri')
})

it('any other recommendation is the blue one', () => {
  render(<BookDecisionControls point={point('act')} isEnglish={false} safety={false} onDecide={jest.fn()} />)
  expect(primary()).toHaveClass('pri')
  expect(screen.getByRole('button', { name: '暫停' })).toHaveClass('btn')
})
