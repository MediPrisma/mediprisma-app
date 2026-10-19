import { carryableAnswers, carryForwardCdss } from '@/features/clinical-decision-support/telemetry/cdss-carry-forward'
import { createMemoryPatientAnswerBacking, setPatientAnswerBacking } from '@/features/clinical-decision-support/stores/patient-answer-backing'
import { useClinicVitalsStore } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import { useHfpefInputsStore } from '@/features/clinical-decision-support/stores/hfpef-inputs.store'
import { usePhenotypeAnswerStore } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import { usePhysicianDecisionsStore } from '@/features/clinical-decision-support/stores/physician-decisions.store'
import { useAfAnswersStore } from '@/features/clinical-decision-support/stores/af-answers.store'
import { useCoronaryPhaseStore } from '@/features/clinical-decision-support/stores/coronary-phase.store'
import { useNhiLipidReviewStore } from '@/features/clinical-decision-support/stores/nhi-lipid-review.store'
import { useVisitAnswersStore } from '@/features/clinical-decision-support/stores/visit-answers.store'
import { usePreventStore } from '@/features/clinical-decision-support/stores/prevent-inputs.store'
import { useEvidenceOverridesStore } from '@/features/clinical-decision-support/stores/evidence-overrides.store'
import { carriedFrom, staleCarriedKeys, useCarriedAnswersStore } from '@/features/clinical-decision-support/stores/carried-answers.store'
import { todayIsoDate } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import type { CdssHistoryRecord } from '@/features/clinical-decision-support/telemetry/cdss-history'

const at = '2026-09-01T08:00:00Z'
const measurement = { value: 80, measuredOn: '2026-09-01', modifiedAt: at }
const decision = { decision: 'deferred', reasons: ['synthetic'], note: 'Synthetic note', recordedAt: at, packVersion: '1' }
function record() {
  return { save: { pack_id: 'synthetic', saved_at: at, result: { packVersion: '1' }, profile: { facts: { OLD_RESULT: true } },
    physician_inputs: {
      clinicVitals: { entries: { bodyWeight: measurement, potassium: measurement }, nyhaClass: { value: 'IV', modifiedAt: at } },
      hfpefInputs: { entries: { lavi: { ...measurement, value: '35' }, age: { ...measurement, value: '90' } } },
      phenotypeAnswer: { answeredOn: '2026-09-01', hfSuspicion: 'suspected', choice: 'reduced', lvef: 30, measuredOn: '2026-09-01' },
      nhiLipidReview: { smoking: 'yes', cad: 'yes' }, nhiLipidReviewProvenance: { smoking: { source: 'manual', reviewedAt: at, manualAction: 'selected' }, cad: { source: 'ai' } },
      preventInputs: { egfr: '15', statin: 'no', smoking: 'yes' }, evidenceOverrides: { synthetic: false },
      visitAnswers: { 'dyspnoea-trend': 'worse', 'weight-trend': 'up', 'dyspnoea-present': 'yes', 'trigger-infection': 'yes' },
    }, physician_decisions: { synthetic: decision } } } as unknown as CdssHistoryRecord
}
beforeEach(() => {
  setPatientAnswerBacking(createMemoryPatientAnswerBacking())
  useClinicVitalsStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  useHfpefInputsStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  usePhenotypeAnswerStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  usePhysicianDecisionsStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  useVisitAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  useEvidenceOverridesStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  useCarriedAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: { p: true } })
  useAfAnswersStore.setState({ patientId: 'p', hydratedPatientId: 'p', answers: {} })
  useCoronaryPhaseStore.setState({ patientId: 'p', hydratedPatientId: 'p', answer: undefined })
  useNhiLipidReviewStore.setState({ patientId: 'p', answers: {}, provenance: {} })
  usePreventStore.setState({ patientId: 'p', inputs: {} })
})

test('confirmed carry-forward retains dates, fills gaps, marks what it carried and never installs the old profile/result or the every-visit questions', () => {
  const saved = record(), original = JSON.stringify(saved)
  const profile = { id: 'p', facts: { current: { zh: 'current', en: 'current' } } }
  // weight, echo, phenotype, decision, lipid, NYHA, PREVENT smoking, evidence switch, one every-visit trigger
  expect(carryForwardCdss('p', saved, 'synthetic', '1', profile, { inputs: true, decisions: true })).toBe(9)
  expect(useClinicVitalsStore.getState().byPatientId.p.entries).toEqual({ bodyWeight: measurement })
  // Owner decision 2026-10-07: the NYHA grade is carried as today's, marked with the record's day.
  expect(useClinicVitalsStore.getState().byPatientId.p.nyhaClass).toMatchObject({ value: 'IV', assessedOn: todayIsoDate() })
  expect(useHfpefInputsStore.getState().byPatientId.p.entries).toEqual({ lavi: { ...measurement, value: '35' } })
  expect(usePhysicianDecisionsStore.getState().byPatientId.p.synthetic).toEqual(decision)
  expect(useNhiLipidReviewStore.getState().answers).toEqual({ smoking: 'yes' })
  expect(useNhiLipidReviewStore.getState().provenance.smoking.reviewedAt).toBe(at)
  // Breathlessness and weight since last visit, and breathlessness today, are asked afresh.
  expect(Object.keys(useVisitAnswersStore.getState().byPatientId.p)).toEqual(['trigger-infection'])
  // A manual eGFR or statin answer would outrank today's record; only smoking and family history carry.
  expect(usePreventStore.getState().inputs).toEqual({ smoking: 'yes' })
  expect(useEvidenceOverridesStore.getState().byPatientId.p).toEqual({ synthetic: false })
  const marks = useCarriedAnswersStore.getState().byPatientId.p
  expect(carriedFrom(marks, 'nyha', 'IV')).toBe('2026-09-01')
  expect(carriedFrom(marks, 'visit:trigger-infection', 'yes')).toBe('2026-09-01')
  // A changed answer is no longer the carried one.
  expect(carriedFrom(marks, 'nyha', 'II')).toBeNull()
  expect(carriedFrom(marks, 'visit:dyspnoea-trend', 'worse')).toBeNull()
  expect(profile.facts).toEqual({ current: { zh: 'current', en: 'current' } })
  expect(JSON.stringify(saved)).toBe(original)
})

test('current edits win even if entered after the history dialog opened; a second carry-forward is a no-op', () => {
  usePhysicianDecisionsStore.getState().recordDecision('p', 'synthetic', { decision: 'ordered', packVersion: '1' })
  useClinicVitalsStore.getState().setVitals('p', { entries: { bodyWeight: { value: 70, measuredOn: '2026-10-01' } } })
  carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: true })
  expect(usePhysicianDecisionsStore.getState().byPatientId.p.synthetic.decision).toBe('ordered')
  expect(useClinicVitalsStore.getState().byPatientId.p.entries.bodyWeight?.value).toBe(70)
  expect(carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: true })).toBe(0)
})

test('this import’s measurements take precedence over previous manual measurements', () => {
  carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {
    bodyWeight: { zh: '65', en: '65', numericValue: 65 }, echoLavi: { zh: '25', en: '25', numericValue: 25 },
    LVEF: { zh: '55', en: '55', numericValue: 55 },
  } }, { inputs: true, decisions: false })
  expect(useClinicVitalsStore.getState().byPatientId.p.entries).toEqual({})
  expect(useHfpefInputsStore.getState().byPatientId.p.entries).toEqual({})
  expect(usePhenotypeAnswerStore.getState().byPatientId.p.lvef).toBeUndefined()
  expect(usePhysicianDecisionsStore.getState().byPatientId.p).toBeUndefined()
})

test.each(['other', 'old'])('incompatible pack/version causes no store writes (%s)', mismatch => {
  expect(() => carryForwardCdss('p', record(), mismatch === 'other' ? 'other' : 'synthetic', mismatch === 'old' ? 'old' : '1',
    { id: 'p', facts: {} }, { inputs: true, decisions: true })).toThrow('incompatible')
  expect(useClinicVitalsStore.getState().byPatientId).toEqual({})
  expect(usePhysicianDecisionsStore.getState().byPatientId).toEqual({})
})

test('invalid or future measurements and unsupported decision kinds are discarded', () => {
  const saved = record()
  saved.save.physician_inputs.clinicVitals = { entries: { bodyWeight: { ...measurement, measuredOn: '2026-02-30' } } }
  saved.save.physician_inputs.hfpefInputs = { entries: { lavi: { ...measurement, value: 'Infinity' }, trv: { ...measurement, value: '2', measuredOn: '2999-01-01' } } }
  saved.save.physician_decisions = { unknown: { ...decision, decision: 'invalid' }, old: { ...decision, packVersion: 'old' } }
  carryForwardCdss('p', saved, 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: true })
  expect(useClinicVitalsStore.getState().byPatientId.p.entries).toEqual({})
  expect(useHfpefInputsStore.getState().byPatientId.p.entries).toEqual({})
  expect(usePhysicianDecisionsStore.getState().byPatientId.p).toEqual({})
})

test('a never-hydrated store blocks the entire operation before any writes', () => {
  usePhysicianDecisionsStore.setState({ hydratedPatientIds: {} })
  expect(() => carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: true })).toThrow('unavailable')
  expect(useClinicVitalsStore.getState().byPatientId).toEqual({})
})

test('pending hydration is never overwritten by carry-forward', async () => {
  let finish!: (value: unknown) => void
  const backing = createMemoryPatientAnswerBacking()
  backing.has = () => true
  backing.load = () => new Promise(resolve => { finish = resolve })
  setPatientAnswerBacking(backing)
  usePhysicianDecisionsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  usePhysicianDecisionsStore.getState().hydrate('p')
  expect(() => usePhysicianDecisionsStore.getState().carryForward('p', record().save.physician_decisions, '1')).toThrow('unavailable')
  expect(backing.kept.size).toBe(0)
  finish({ newer: { ...decision, decision: 'ordered' } })
  await Promise.resolve(); await Promise.resolve()
  expect(usePhysicianDecisionsStore.getState().byPatientId.p.newer.decision).toBe('ordered')
})

test('blood pressure cannot mix dates or combine a current half with an old half', () => {
  const saved = record()
  saved.save.physician_inputs.clinicVitals = { entries: { systolic: { ...measurement, value: 130 }, diastolic: measurement } }
  useClinicVitalsStore.getState().setVitals('p', { entries: { systolic: { value: 150, measuredOn: '2026-10-01' } } })
  carryForwardCdss('p', saved, 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  expect(useClinicVitalsStore.getState().byPatientId.p.entries.diastolic).toBeUndefined()
})

test('no phenotype is installed when current EF removes all meaningful old fields', () => {
  const saved = record()
  saved.save.physician_inputs.phenotypeAnswer = { answeredOn: '2026-09-01', diagnosis: 'hfpEF', choice: 'preserved', hfpEfConfirmed: true }
  carryForwardCdss('p', saved, 'synthetic', '1', { id: 'p', facts: { LVEF: { zh: '30', en: '30', numericValue: 30 } } }, { inputs: true, decisions: false })
  expect(usePhenotypeAnswerStore.getState().byPatientId.p).toBeUndefined()
})

test('an imported echo study never borrows missing parameters from a historical study', () => {
  carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {
    echoEOverEPrime: { zh: '11', en: '11', numericValue: 11, date: '2026-10-01' },
  } }, { inputs: true, decisions: false })
  expect(useHfpefInputsStore.getState().byPatientId.p.entries).toEqual({})
  expect(usePhenotypeAnswerStore.getState().byPatientId.p.lvef).toBeUndefined()
  expect(usePhenotypeAnswerStore.getState().byPatientId.p.choice).toBeUndefined()
})

test('newer non-echo calculator inputs cannot select the carried echo study', () => {
  const saved = record()
  saved.save.physician_inputs.hfpefInputs = { entries: { lavi: { ...measurement, value: '35' }, age: { ...measurement, value: '90', measuredOn: '2026-10-01' } } }
  carryForwardCdss('p', saved, 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  expect(useHfpefInputsStore.getState().byPatientId.p.entries).toEqual({ lavi: { ...measurement, value: '35' } })
})

test('a cleared but still-pending hydration blocks all stores before a partial write', async () => {
  let finish!: (value: unknown) => void
  const backing = createMemoryPatientAnswerBacking()
  backing.has = () => true
  backing.load = () => new Promise(resolve => { finish = resolve })
  setPatientAnswerBacking(backing)
  useHfpefInputsStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  useHfpefInputsStore.getState().hydrate('p')
  useHfpefInputsStore.getState().clearInputs('p')
  const baseline = backing.kept.size
  expect(useHfpefInputsStore.getState().hydratedPatientIds.p).toBe(true)
  expect(() => carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: true })).toThrow('unavailable')
  expect(backing.kept.size).toBe(baseline)
  expect(useClinicVitalsStore.getState().byPatientId).toEqual({})
  finish(null); await Promise.resolve(); await Promise.resolve()
})

test('an earlier day’s NYHA grade replaced by a carry is counted and marked as carried', () => {
  const yesterday = new Date(Date.now() - 86_400_000)
  useClinicVitalsStore.getState().setVitals('p', { nyhaClass: 'II', signAnswers: { orthopnea: 'absent' } }, yesterday)
  const count = carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  const vitals = useClinicVitalsStore.getState().byPatientId.p
  expect(vitals.nyhaClass).toMatchObject({ value: 'IV', assessedOn: todayIsoDate() })
  const marks = useCarriedAnswersStore.getState().byPatientId.p
  expect(carriedFrom(marks, 'nyha', 'IV')).toBe('2026-09-01')
  expect(count).toBeGreaterThan(0)
})

test('an earlier day’s sign the record does not carry stays as it was', () => {
  const yesterday = new Date(Date.now() - 86_400_000)
  useClinicVitalsStore.getState().setVitals('p', { signAnswers: { rales: 'present' } }, yesterday)
  carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  expect(useClinicVitalsStore.getState().byPatientId.p.signAnswers.rales).toMatchObject({ value: 'present', examinedOn: todayIsoDate(yesterday) })
})

test('no carry while the carried-answer marks are still being read back', () => {
  useCarriedAnswersStore.setState({ byPatientId: {}, hydratedPatientIds: {} })
  expect(() => carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: false, decisions: true }))
    .toThrow('cdss_carry_forward_unavailable')
  expect(usePhysicianDecisionsStore.getState().byPatientId.p).toBeUndefined()
})

test('an every-visit answer held from yesterday with the same value is carried as today’s, counted and marked', () => {
  const yesterday = new Date(Date.now() - 86_400_000)
  useVisitAnswersStore.getState().answer('p', 'trigger-infection', 'yes', yesterday)
  const count = carryForwardCdss('p', record(), 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  expect(new Date(useVisitAnswersStore.getState().byPatientId.p['trigger-infection']!.answeredAt).toDateString()).toBe(new Date().toDateString())
  expect(carriedFrom(useCarriedAnswersStore.getState().byPatientId.p, 'visit:trigger-infection', 'yes')).toBe('2026-09-01')
  expect(count).toBeGreaterThan(0)
})

test('the next day, a carried compensation, NYHA grade or sign still held keeps its mark (三區塊 still shows it)', () => {
  const saved = record()
  ;(saved.save.physician_inputs as Record<string, unknown>).clinicVitals = {
    entries: {}, nyhaClass: { value: 'IV', modifiedAt: at }, compensationStatus: { value: 'decompensated', modifiedAt: at },
    signAnswers: { orthopnea: { value: 'present', modifiedAt: at, examinedOn: '2026-09-01' } },
  }
  carryForwardCdss('p', saved, 'synthetic', '1', { id: 'p', facts: {} }, { inputs: true, decisions: false })
  const tomorrow = new Date(Date.now() + 86_400_000)
  const held = carryableAnswers('p', tomorrow, 'held')
  const marks = useCarriedAnswersStore.getState().byPatientId.p
  for (const key of ['compensation', 'nyha', 'sign:orthopnea']) expect(carriedFrom(marks, key, held[key], tomorrow)).toBe('2026-09-01')
  expect(staleCarriedKeys(marks, held, tomorrow)).not.toEqual(expect.arrayContaining(['compensation', 'nyha', 'sign:orthopnea']))
})

test('carries CAD DP-01\'s class with the day it was given, so the pack ages it; today\'s answer wins', () => {
  const saved = record()
  ;(saved.save.physician_inputs as Record<string, unknown>).coronaryPhaseAnswer = { phase: 'acs-recent', answeredOn: '2026-09-01', eventMonth: '2026-04' }
  const profile = { id: 'p', facts: {} }
  carryForwardCdss('p', saved, 'synthetic', '1', profile, { inputs: true, decisions: false })
  expect(useCoronaryPhaseStore.getState().answer).toEqual({ phase: 'acs-recent', answeredOn: '2026-09-01', eventMonth: '2026-04' })
  expect(carryableAnswers('p', new Date(), 'held')['coronary:phase']).toBe('acs-recent')

  useCoronaryPhaseStore.setState({ answer: { phase: 'chronic-mi', answeredOn: todayIsoDate() } })
  carryForwardCdss('p', saved, 'synthetic', '1', profile, { inputs: true, decisions: false })
  expect(useCoronaryPhaseStore.getState().answer?.phase).toBe('chronic-mi')
})
