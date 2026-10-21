/**
 * The AF page's answers — the diagnosis given on DP-01 among them — are kept
 * per patient and sealed, as the HF phenotype answer is: a reload of the tab
 * must not keep DP-01's recorded 「AF」 while the diagnosis behind it goes back
 * to the record's.
 */
import {
  afAnswersStorageKey,
  useAfAnswersStore,
} from '@/features/clinical-decision-support/stores/af-answers.store'
import { afAnswersForInput } from '@/features/clinical-decision-support/renderers/visit/physician-input'
import {
  expectSealedEnvelope,
  storedCiphertext,
  until,
  useRealWebCrypto,
} from './encrypted-answers.helper'

const hydrated = (patientId: string) => useAfAnswersStore.getState().hydratedPatientId === patientId

/** A reload of this tab: memory gone, storage kept. */
function reload(): void {
  useAfAnswersStore.setState({ patientId: undefined, answers: {}, hydratedPatientId: undefined })
}

describe('AF DP-01 answers the AF diagnosis and its type', () => {
  it('writes 「AF」, 「AFL」 and 「都有」 as a confirmed diagnosis and which of the two the patient has', () => {
    expect(afAnswersForInput({ request: 'af-diagnosis', optionId: 'af' })).toEqual([
      { id: 'diagnosisConfirmed', value: true }, { id: 'atrialFibrillation', value: true }, { id: 'atrialFlutter', value: false },
    ])
    expect(afAnswersForInput({ request: 'af-diagnosis', optionId: 'flutter' })).toEqual([
      { id: 'diagnosisConfirmed', value: true }, { id: 'atrialFibrillation', value: false }, { id: 'atrialFlutter', value: true },
    ])
    expect(afAnswersForInput({ request: 'af-diagnosis', optionId: 'both' })).toEqual([
      { id: 'diagnosisConfirmed', value: true }, { id: 'atrialFibrillation', value: true }, { id: 'atrialFlutter', value: true },
    ])
    expect(afAnswersForInput({ request: 'af-diagnosis', optionId: 'unsure' })).toBeUndefined()
    expect(afAnswersForInput({ request: 'af-diagnosis', optionId: 'other' })).toBeUndefined()
    expect(afAnswersForInput({ request: 'hf-suspicion', optionId: 'hfref' })).toBeUndefined()
  })
})

describe('the AF answers store', () => {
  useRealWebCrypto()

  beforeEach(() => {
    localStorage.clear()
    reload()
  })

  it('keeps a chart\'s answers sealed across a reload, and out of the next chart', async () => {
    const store = useAfAnswersStore.getState()
    store.setPatient('p1')
    expect(hydrated('p1')).toBe(true)
    store.answer('p1', 'diagnosisConfirmed', true)
    const raw = await storedCiphertext(afAnswersStorageKey('p1'))
    expectSealedEnvelope(raw, ['diagnosisConfirmed'])

    useAfAnswersStore.getState().setPatient('p2')
    expect(useAfAnswersStore.getState().answers).toEqual({})
    expect(localStorage.getItem(afAnswersStorageKey('p2'))).toBeNull()

    reload()
    useAfAnswersStore.getState().setPatient('p1')
    expect(hydrated('p1')).toBe(false)
    await until(() => hydrated('p1'), 'p1 to hydrate')
    expect(useAfAnswersStore.getState().answers).toEqual({ diagnosisConfirmed: true })
  })

  it('keeps an answer given while the read is in flight, and the stored ones beside it', async () => {
    useAfAnswersStore.getState().setPatient('p1')
    useAfAnswersStore.getState().answer('p1', 'stroke', true)
    const first = await storedCiphertext(afAnswersStorageKey('p1'))

    reload()
    useAfAnswersStore.getState().setPatient('p1')
    useAfAnswersStore.getState().answer('p1', 'diagnosisConfirmed', false)
    await until(() => hydrated('p1'), 'p1 to hydrate')
    expect(useAfAnswersStore.getState().answers).toEqual({ stroke: true, diagnosisConfirmed: false })
    // The merged answers are written back once the read lands, in the background.
    await until(() => localStorage.getItem(afAnswersStorageKey('p1')) !== first, 'the merged answers to be written')

    reload()
    useAfAnswersStore.getState().setPatient('p1')
    await until(() => hydrated('p1'), 'p1 to hydrate again')
    expect(useAfAnswersStore.getState().answers).toEqual({ stroke: true, diagnosisConfirmed: false })
  })

  it('removes the stored record when the last answer is taken back', async () => {
    useAfAnswersStore.getState().setPatient('p1')
    useAfAnswersStore.getState().answer('p1', 'diagnosisConfirmed', true)
    await storedCiphertext(afAnswersStorageKey('p1'))
    useAfAnswersStore.getState().answer('p1', 'diagnosisConfirmed', undefined)
    expect(localStorage.getItem(afAnswersStorageKey('p1'))).toBeNull()
  })
})

describe('the AF answers store · 恢復本頁預設', () => {
  useRealWebCrypto()

  beforeEach(() => {
    localStorage.clear()
    reload()
  })

  it('clears a chart\'s answers and their sealed copy, so a reload does not bring them back', async () => {
    useAfAnswersStore.getState().setPatient('p1')
    useAfAnswersStore.getState().answer('p1', 'atrialFlutter', true)
    await storedCiphertext(afAnswersStorageKey('p1'))

    useAfAnswersStore.getState().clear('p1')
    expect(useAfAnswersStore.getState().answers).toEqual({})
    expect(localStorage.getItem(afAnswersStorageKey('p1'))).toBeNull()

    reload()
    useAfAnswersStore.getState().setPatient('p1')
    expect(hydrated('p1')).toBe(true)
    expect(useAfAnswersStore.getState().answers).toEqual({})
  })

  it('drops a read still in flight rather than letting it bring the answers back', async () => {
    useAfAnswersStore.getState().setPatient('p1')
    useAfAnswersStore.getState().answer('p1', 'atrialFlutter', true)
    await storedCiphertext(afAnswersStorageKey('p1'))

    reload()
    useAfAnswersStore.getState().setPatient('p1')
    expect(hydrated('p1')).toBe(false)
    useAfAnswersStore.getState().clear('p1')
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    expect(useAfAnswersStore.getState().answers).toEqual({})
    expect(hydrated('p1')).toBe(true)
  })
})
