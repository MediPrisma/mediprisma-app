import { fireEvent, render, screen } from '@testing-library/react'
import {
  BookAsks,
  isMeasureAnswered,
  measureAsksOf,
  parseBloodPressurePair,
  type BookMeasureAsk,
} from '@/features/clinical-decision-support/renderers/visit/BookAsks'

const homeBp: BookMeasureAsk = {
  id: 'home-bp',
  label: '居家血壓',
  placeholder: '146/92',
  unit: 'mmHg',
  none: { askId: 'home-bp-measured', value: 'no', label: '沒有量' },
}

describe('a number typed beside the asks (HTN home BP)', () => {
  it('reads 「146/92」 and its look-alikes as a pair, and nothing else', () => {
    expect(parseBloodPressurePair('146/92')).toEqual({ systolic: 146, diastolic: 92 })
    expect(parseBloodPressurePair(' 146 92 ')).toEqual({ systolic: 146, diastolic: 92 })
    expect(parseBloodPressurePair('146／92')).toEqual({ systolic: 146, diastolic: 92 })
    for (const text of ['146', '92/146', '146/92/80', 'abc', '1460/92', '']) expect(parseBloodPressurePair(text)).toBeNull()
  })

  it('reads the pack field defensively', () => {
    expect(measureAsksOf({})).toEqual([])
    expect(measureAsksOf({ measureAsks: [{ id: 'home-bp' }, { label: 'x' }] })).toEqual([{ id: 'home-bp', label: '', placeholder: '', unit: '' }].filter(() => false))
    expect(measureAsksOf({ measureAsks: [{ ...homeBp, answer: { systolic: 146, diastolic: 92, basis: '門診輸入 10-29' } }] })[0].answer)
      .toEqual({ systolic: 146, diastolic: 92, basis: '門診輸入 10-29' })
  })

  it('counts as answered with a pair or with 「沒有量」, not before', () => {
    expect(isMeasureAnswered(homeBp, {})).toBe(false)
    expect(isMeasureAnswered(homeBp, { 'home-bp-measured': 'no' } as never)).toBe(true)
    expect(isMeasureAnswered({ ...homeBp, answer: { systolic: 146, diastolic: 92, basis: 'x' } }, {})).toBe(true)
  })

  it('hands a typed pair back on Enter, says what is wrong with a bad one, and offers 「沒有量」', () => {
    const onMeasure = jest.fn()
    const onAnswer = jest.fn()
    render(<BookAsks asks={[]} answers={{}} isEnglish={false} measureAsks={[homeBp]} onMeasure={onMeasure} onAnswer={onAnswer} />)
    const input = screen.getByRole('textbox', { name: '居家血壓' })
    fireEvent.change(input, { target: { value: '146' } })
    expect(screen.getByRole('alert')).toHaveTextContent('146/92')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onMeasure).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '146/92' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onMeasure).toHaveBeenCalledWith('home-bp', { systolic: 146, diastolic: 92 })
    fireEvent.click(screen.getByRole('button', { name: '沒有量' }))
    expect(onAnswer).toHaveBeenCalledWith('home-bp-measured', 'no')
  })

  it('shows where the pair it read came from, and clearing the field withdraws it', () => {
    const onMeasure = jest.fn()
    render(<BookAsks asks={[]} answers={{}} isEnglish={false} measureAsks={[{ ...homeBp, answer: { systolic: 146, diastolic: 92, basis: '門診輸入 10-29' } }]} onMeasure={onMeasure} />)
    expect(screen.getByText('門診輸入 10-29')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '居家血壓' })
    expect(input).toHaveValue('146/92')
    // A pair on file makes 「沒有量」 a contradiction, so it is not offered.
    expect(screen.getByRole('button', { name: '沒有量' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onMeasure).toHaveBeenCalledWith('home-bp', null)
  })
})
