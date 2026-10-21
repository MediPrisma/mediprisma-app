/**
 * @jest-environment jsdom
 */
/**
 * The every-visit answers are a clinical statement about a named person, so
 * they are kept like the rest of this feature's answers: encrypted, per
 * patient, and — being this visit's answers — dropped when read back on
 * another day.
 */
import {
  toVisitAnswerRecord,
  useVisitAnswersStore,
  visitAnswerSourcesOf,
  visitAnswersOf,
  visitAnswersStorageKey,
} from '@/features/clinical-decision-support/stores/visit-answers.store'
import {
  expectSealedEnvelope,
  sealAnswers,
  storedCiphertext,
  until,
  useRealWebCrypto,
} from '../encrypted-answers.helper'
import { localDayKey } from '@/features/clinical-decision-support/hooks/use-local-day.hook'

const AT = new Date('2026-09-27T09:10:00+08:00')
/** The local day of AT: answers are read for a day, and these were given on it. */
const AT_DAY = localDayKey(AT)

function store() {
  return useVisitAnswersStore.getState()
}

describe('visit answers', () => {
  useRealWebCrypto()

  beforeEach(() => {
    localStorage.clear()
    useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  })

  it('stores an answer as ciphertext, never as readable text', async () => {
    store().answer('p1', 'dyspnoea-trend', 'worse', AT)
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ 'dyspnoea-trend': 'worse' })
    const raw = await storedCiphertext(visitAnswersStorageKey('p1'))
    expectSealedEnvelope(raw, ['worse', 'dyspnoea'])
  })

  it('reads today’s answers back and keeps them to their own patient', async () => {
    await sealAnswers(visitAnswersStorageKey('p1'), {
      'weight-trend': { value: 'up', answeredAt: AT.toISOString() },
    })
    store().hydrate('p1', new Date('2026-09-27T15:00:00+08:00'))
    await until(() => Boolean(store().hydratedPatientIds.p1), 'p1 to hydrate')
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ 'weight-trend': 'up' })

    store().hydrate('p2')
    await until(() => Boolean(store().hydratedPatientIds.p2), 'p2 to hydrate')
    expect(visitAnswersOf(store().byPatientId.p2)).toEqual({})
  })

  it('drops an answer given on another day, and anything it does not recognise', () => {
    const next = new Date('2026-09-28T09:00:00+08:00')
    expect(toVisitAnswerRecord({ 'weight-trend': { value: 'up', answeredAt: AT.toISOString() } }, next)).toEqual({})
    expect(toVisitAnswerRecord({
      'weight-trend': { value: 'up', answeredAt: AT.toISOString() },
      nyha: { value: 'III', answeredAt: AT.toISOString() },
      bleeding: { value: 7, answeredAt: AT.toISOString() },
    }, AT)).toEqual({ 'weight-trend': { value: 'up', answeredAt: AT.toISOString() } })
    expect(toVisitAnswerRecord('garbage', AT)).toEqual({})
  })

  // #166 review: a page left open overnight, or a patient opened again the
  // next day, must not carry yesterday's 「無出血」 into today's rules.
  it('reads an answer held in memory for its own day only', () => {
    store().answer('p1', 'bleeding', 'no', AT)
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ bleeding: 'no' })
    const nextDay = localDayKey(new Date(AT.getTime() + 24 * 60 * 60 * 1000))
    expect(visitAnswersOf(store().byPatientId.p1, nextDay)).toEqual({})
  })

  it('drops an earlier day’s answers, from memory and storage, when the patient is opened again', async () => {
    store().hydrate('p1', AT)
    store().answer('p1', 'bleeding', 'no', AT)
    await storedCiphertext(visitAnswersStorageKey('p1'))
    // Same day: nothing to drop.
    store().hydrate('p1', new Date(AT.getTime() + 60 * 60 * 1000))
    expect(store().byPatientId.p1?.bleeding?.value).toBe('no')
    // The next day: gone, and so is its ciphertext.
    store().hydrate('p1', new Date(AT.getTime() + 24 * 60 * 60 * 1000))
    expect(store().byPatientId.p1).toEqual({})
    expect(localStorage.getItem(visitAnswersStorageKey('p1'))).toBeNull()
  })

  it('withdraws one answer and clears the chart', async () => {
    store().answer('p1', 'af-symptoms', 'yes', AT)
    store().answer('p1', 'bleeding', 'no', AT)
    store().answer('p1', 'af-symptoms', null, AT)
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ bleeding: 'no' })
    await storedCiphertext(visitAnswersStorageKey('p1'))
    store().clearAnswers('p1')
    expect(visitAnswersOf(store().byPatientId.p1)).toEqual({})
    expect(localStorage.getItem(visitAnswersStorageKey('p1'))).toBeNull()
  })

  // One answer per observation, whichever disease's page asked it, with the
  // page it was given on — what a second page names instead of asking again.
  it('keeps the page an answer was given on, and reads it back', () => {
    store().answer('p1', 'dyspnoea-trend', 'worse', AT, { packId: 'heart-failure-cdss' })
    store().answer('p1', 'bleeding', 'no', AT)
    expect(visitAnswerSourcesOf(store().byPatientId.p1, AT_DAY)).toEqual({
      'dyspnoea-trend': { answeredAt: AT.toISOString(), packId: 'heart-failure-cdss' },
      bleeding: { answeredAt: AT.toISOString() },
    })
    // Read back from storage, the page comes with it.
    const record = toVisitAnswerRecord({
      'dyspnoea-trend': { value: 'worse', answeredAt: AT.toISOString(), packId: 'heart-failure-cdss' },
    }, AT)
    expect(record['dyspnoea-trend']?.packId).toBe('heart-failure-cdss')
    // A page id that is not a name is dropped; the answer stands without it.
    const odd = toVisitAnswerRecord({
      'dyspnoea-trend': { value: 'worse', answeredAt: AT.toISOString(), packId: 42 },
      bleeding: { value: 'no', answeredAt: AT.toISOString(), packId: '' },
    }, AT)
    expect(odd).toEqual({
      'dyspnoea-trend': { value: 'worse', answeredAt: AT.toISOString() },
      bleeding: { value: 'no', answeredAt: AT.toISOString() },
    })
  })

  it('accepts every observation the pack catalogue defines, and only its answers', () => {
    // 今天有沒有喘 is in the pack's catalogue though no page asks it yet: a
    // pack that starts asking it needs no change to this store.
    store().answer('p1', 'dyspnoea-present', 'yes', AT)
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ 'dyspnoea-present': 'yes' })
    store().answer('p1', 'dyspnoea-present', 'maybe', AT)
    expect(visitAnswersOf(store().byPatientId.p1, AT_DAY)).toEqual({ 'dyspnoea-present': 'yes' })
  })
})
