/**
 * One backing for every store that keeps what the clinician said about a
 * patient. The default is today's encrypted tab-session cache, under the keys
 * each store has always used — bar the evidence-row switches, whose old key
 * held plaintext; replacing the backing moves every store's reads
 * and writes at once, which is the one change carrying answers across visits
 * will need.
 */
import {
  createMemoryPatientAnswerBacking,
  ENCRYPTED_TAB_SESSION_BACKING,
  patientAnswerStorageKey,
  setPatientAnswerBacking,
  type PatientAnswerKind,
} from '@/features/clinical-decision-support/stores/patient-answer-backing'
import { afAnswersStorageKey, useAfAnswersStore } from '@/features/clinical-decision-support/stores/af-answers.store'
import { clinicVitalsStorageKey, useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { hfpefInputsStorageKey, useHfpefInputsStore } from '@/features/clinical-decision-support/stores/hfpef-inputs.store'
import {
  phenotypeAnswerStorageKey,
  usePhenotypeAnswerStore,
  type PhenotypeAnswer,
} from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import {
  physicianDecisionsStorageKey,
  usePhysicianDecisionsStore,
} from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useVisitAnswersStore, visitAnswersStorageKey } from '@/features/clinical-decision-support/stores/visit-answers.store'
import {
  evidenceOverridesStorageKey,
  useEvidenceOverridesStore,
} from '@/features/clinical-decision-support/stores/evidence-overrides.store'
import { expectSealedEnvelope, storedCiphertext, useRealWebCrypto } from './encrypted-answers.helper'

const AT = new Date('2026-09-29T10:32:00+08:00')
const DAY = '2026-09-29'
const PATIENT = 'p1'

const PHENOTYPE: PhenotypeAnswer = {
  hfSuspicion: 'suspected',
  choice: 'reduced',
  lvef: 30,
  measuredOn: '2026-02-01',
  answeredOn: DAY,
}

const KINDS: readonly PatientAnswerKind[] = [
  'visit-answers',
  'clinic-vitals',
  'af-answers',
  'phenotype-answer',
  'hfpef-inputs',
  'physician-decisions',
  'evidence-overrides',
]

function resetStores() {
  useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useAfAnswersStore.setState({ patientId: undefined, answers: {}, hydratedPatientId: undefined })
  usePhenotypeAnswerStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useHfpefInputsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  usePhysicianDecisionsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useEvidenceOverridesStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
}

/** One write through each store's own API. */
function answerEverywhere() {
  useVisitAnswersStore.getState().answer(PATIENT, 'dyspnoea-trend', 'worse', AT)
  useClinicVitalsStore.getState().setVitals(PATIENT, { nyhaClass: 'II' }, AT)
  useAfAnswersStore.getState().setPatient(PATIENT)
  useAfAnswersStore.getState().answer(PATIENT, 'symptomatic', true)
  usePhenotypeAnswerStore.getState().setAnswer(PATIENT, PHENOTYPE, AT)
  useHfpefInputsStore.getState().setInputs(PATIENT, { lavi: { value: '42', measuredOn: DAY } }, AT)
  usePhysicianDecisionsStore.getState().recordDecision(PATIENT, 'heart-failure-mra', { decision: 'prescribed', packVersion: 'test' }, AT)
  useEvidenceOverridesStore.getState().hydrate(PATIENT)
  useEvidenceOverridesStore.getState().setOverride(PATIENT, 'congestion:cxr', false)
}

beforeEach(() => {
  window.localStorage.clear()
  setPatientAnswerBacking(ENCRYPTED_TAB_SESSION_BACKING)
  resetStores()
})

afterAll(() => {
  setPatientAnswerBacking(ENCRYPTED_TAB_SESSION_BACKING)
})

describe('the patient-answer backing', () => {
  useRealWebCrypto()

  it('keeps every store under the key it has always used', () => {
    // An open tab's ciphertext is read back as before: no key moved.
    expect(visitAnswersStorageKey(PATIENT)).toBe('cdss-visit-answers:p1')
    expect(clinicVitalsStorageKey(PATIENT)).toBe('cdss-clinic-vitals:p1')
    expect(afAnswersStorageKey(PATIENT)).toBe('cdss-af-answers:p1')
    expect(phenotypeAnswerStorageKey(PATIENT)).toBe('cdss-phenotype-answer:p1')
    expect(hfpefInputsStorageKey(PATIENT)).toBe('cdss-hfpef-inputs:p1')
    expect(physicianDecisionsStorageKey(PATIENT)).toBe('cdss-physician-decisions:p1')
    // The one key that moved: the old prefix held plaintext, which the store sweeps.
    expect(evidenceOverridesStorageKey(PATIENT)).toBe('cdss-evidence-row-overrides:p1')
  })

  it('writes every store through the encrypted tab-session cache by default', async () => {
    answerEverywhere()
    // Sealed in the background: ciphertext, never the answer itself.
    for (const kind of KINDS) {
      expectSealedEnvelope(await storedCiphertext(patientAnswerStorageKey(kind, PATIENT)), ['worse', 'nyhaClass', 'symptomatic', 'lvef', 'lavi', 'prescribed', 'congestion'])
    }
  })

  it('moves every store’s writes to a replaced backing, and none to the browser', () => {
    const memory = createMemoryPatientAnswerBacking()
    setPatientAnswerBacking(memory)
    answerEverywhere()
    for (const kind of KINDS) {
      expect({ kind, kept: memory.kept.has(patientAnswerStorageKey(kind, PATIENT)) }).toEqual({ kind, kept: true })
      expect({ kind, inBrowser: window.localStorage.getItem(patientAnswerStorageKey(kind, PATIENT)) }).toEqual({ kind, inBrowser: null })
    }
  })

  it('reads every store back from a replaced backing', async () => {
    const memory = createMemoryPatientAnswerBacking()
    setPatientAnswerBacking(memory)
    answerEverywhere()
    const kept = new Map(memory.kept)
    // A fresh session over the same backing: nothing in memory, all of it kept.
    resetStores()
    const next = createMemoryPatientAnswerBacking()
    for (const [key, value] of kept) {
      const kind = KINDS.find((candidate) => key === patientAnswerStorageKey(candidate, PATIENT))!
      next.save(kind, PATIENT, value)
    }
    setPatientAnswerBacking(next)

    useVisitAnswersStore.getState().hydrate(PATIENT, AT)
    useClinicVitalsStore.getState().hydrate(PATIENT)
    useAfAnswersStore.getState().setPatient(PATIENT)
    usePhenotypeAnswerStore.getState().hydrate(PATIENT)
    useHfpefInputsStore.getState().hydrate(PATIENT)
    usePhysicianDecisionsStore.getState().hydrate(PATIENT)
    useEvidenceOverridesStore.getState().hydrate(PATIENT)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useVisitAnswersStore.getState().byPatientId[PATIENT]?.['dyspnoea-trend']?.value).toBe('worse')
    expect(useClinicVitalsStore.getState().byPatientId[PATIENT]?.nyhaClass?.value).toBe('II')
    expect(useAfAnswersStore.getState().answers.symptomatic).toBe(true)
    expect(usePhenotypeAnswerStore.getState().byPatientId[PATIENT]?.lvef).toBe(30)
    expect(useHfpefInputsStore.getState().byPatientId[PATIENT]?.entries.lavi?.value).toBe('42')
    expect(usePhysicianDecisionsStore.getState().byPatientId[PATIENT]?.['heart-failure-mra']?.decision).toBe('prescribed')
    expect(useEvidenceOverridesStore.getState().byPatientId[PATIENT]).toEqual({ 'congestion:cxr': false })
  })

  it('clears through the backing too', () => {
    const memory = createMemoryPatientAnswerBacking()
    setPatientAnswerBacking(memory)
    answerEverywhere()
    useVisitAnswersStore.getState().clearAnswers(PATIENT)
    useClinicVitalsStore.getState().clearVitals(PATIENT)
    useAfAnswersStore.getState().clear(PATIENT)
    usePhenotypeAnswerStore.getState().clearAnswer(PATIENT)
    useHfpefInputsStore.getState().clearInputs(PATIENT)
    usePhysicianDecisionsStore.getState().clearDecisions(PATIENT)
    useEvidenceOverridesStore.getState().clearOverrides(PATIENT)
    expect([...memory.kept.keys()]).toEqual([])
  })
})
