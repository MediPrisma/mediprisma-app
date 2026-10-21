import { carriedFrom, staleCarriedKeys, useCarriedAnswersStore } from '@/features/clinical-decision-support/stores/carried-answers.store'
import { createMemoryPatientAnswerBacking, setPatientAnswerBacking } from '@/features/clinical-decision-support/stores/patient-answer-backing'

const today = new Date('2026-10-07T10:00:00+08:00')
const tomorrow = new Date('2026-10-08T10:00:00+08:00')

beforeEach(() => {
  setPatientAnswerBacking(createMemoryPatientAnswerBacking())
  useCarriedAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
})

test('an every-visit mark ends with its day; a lasting answer keeps its mark while it is in force', () => {
  useCarriedAnswersStore.getState().mark('p', { 'visit:trigger-infection': 'yes', 'evidence:row': false, 'af:drugCough': true }, '2026-09-01', today)
  const marks = useCarriedAnswersStore.getState().byPatientId.p
  expect(carriedFrom(marks, 'visit:trigger-infection', 'yes', today)).toBe('2026-09-01')
  expect(carriedFrom(marks, 'visit:trigger-infection', 'yes', tomorrow)).toBeNull()
  expect(carriedFrom(marks, 'evidence:row', false, tomorrow)).toBe('2026-09-01')
  expect(carriedFrom(marks, 'af:drugCough', true, tomorrow)).toBe('2026-09-01')
})

test('a mark whose answer left the carried value is stale and goes for good, so the same value typed back is not carried', () => {
  useCarriedAnswersStore.getState().mark('p', { nyha: 'III', 'evidence:row': false }, '2026-09-01', today)
  let marks = useCarriedAnswersStore.getState().byPatientId.p
  // Cleared, then (later) typed back as the same value.
  expect(staleCarriedKeys(marks, { nyha: undefined, 'evidence:row': false }, today)).toEqual(['nyha'])
  useCarriedAnswersStore.getState().unmark('p', ['nyha'])
  marks = useCarriedAnswersStore.getState().byPatientId.p
  expect(carriedFrom(marks, 'nyha', 'III', today)).toBeNull()
  expect(carriedFrom(marks, 'evidence:row', false, today)).toBe('2026-09-01')
})

test('read back the next day, only the every-visit marks are dropped', async () => {
  const backing = createMemoryPatientAnswerBacking()
  setPatientAnswerBacking(backing)
  useCarriedAnswersStore.getState().mark('p', { 'visit:trigger-infection': 'yes', 'sign:rales': 'present', 'prevent:smoking': 'yes' }, '2026-09-01', today)
  useCarriedAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useCarriedAnswersStore.getState().hydrate('p', tomorrow)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(Object.keys(useCarriedAnswersStore.getState().byPatientId.p.marks)).toEqual(['sign:rales', 'prevent:smoking'])
})
