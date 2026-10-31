import { z } from 'zod'
import { AF_CLINICAL_QUESTIONS } from '@voho0000/personalized-care'
import type { CdssPatientProfile } from '../types'
import type { CdssHistoryRecord } from './cdss-history'
import { storedTimestampForDisplay, storedTimestampV2 } from '@/src/shared/contracts/cdss-stored-save-v2'
import { CLINIC_VITALS_ENTRY_KEYS, calendarDayOf, todayIsoDate, useClinicVitalsStore } from '../stores/clinic-vitals.store'
import { useHfpefInputsStore } from '../stores/hfpef-inputs.store'
import { usePhenotypeAnswerStore } from '../stores/phenotype-answer.store'
import { usePhysicianDecisionsStore } from '../stores/physician-decisions.store'
import { useAfAnswersStore } from '../stores/af-answers.store'
import { toCoronaryPhaseAnswer, useCoronaryPhaseStore } from '../stores/coronary-phase.store'
import { useNhiLipidReviewStore } from '../stores/nhi-lipid-review.store'
import { useVisitAnswersStore, visitAnswersOf } from '../stores/visit-answers.store'
import { useEvidenceOverridesStore } from '../stores/evidence-overrides.store'
import { usePreventStore } from '../stores/prevent-inputs.store'
import { useCarriedAnswersStore } from '../stores/carried-answers.store'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
const measurement = z.object({ value: z.number().finite().nonnegative(), measuredOn: day, modifiedAt: storedTimestampV2 })
const echo = z.object({ value: z.string().max(120).refine(value => value.trim() !== '' && Number.isFinite(Number(value))), measuredOn: day, modifiedAt: storedTimestampV2 })
// Only echo measurements, never the calculator's current age, medicines or labs.
const echoFacts: Record<string, string> = { averageEe: 'echoEOverEPrime', ee: 'echoEOverEPrime',
  septalE: 'echoSeptalEPrime', lateralE: 'echoLateralEPrime', trv: 'echoTrVmax', pasp: 'echoRvsp',
  gls: 'echoGls', lavi: 'echoLavi', lvmi: 'echoLvmi', rwt: 'echoRwt', wall: 'echoLvWallThickness' }
const clinicFacts: Record<string, string> = { systolic: 'bloodPressure', diastolic: 'bloodPressure',
  bodyHeight: 'bodyMassIndex', bodyWeight: 'bodyWeight', heartRate: 'heartRate', oxygenSaturation: 'oxygenSaturation' }
const phenotype = z.object({ answeredOn: day,
  hfSuspicion: z.enum(['suspected', 'not-suspected']).optional(), diagnosis: z.enum(['hfrEF', 'hfpEF']).optional(),
  choice: z.enum(['reduced', 'preserved', 'unknown']).optional(), lvef: z.number().min(0).max(100).optional(), measuredOn: day.optional(),
  hfpEfConfirmed: z.union([z.boolean(), z.literal('not-assessed')]).optional(),
  diagnosisConfirmation: z.object({ method: z.enum(['current', 'existing']), confirmedAt: storedTimestampV2, basis: z.string().max(10000) }).optional(),
  modifiedAt: z.object({ hfSuspicion: storedTimestampV2.optional(), phenotype: storedTimestampV2.optional(), hfpEfConfirmed: storedTimestampV2.optional() }).optional(),
})

export type CarryForwardChoices = { inputs: boolean; decisions: boolean }

/** The every-visit questions a clinician answers afresh at each visit; never carried. */
export const EVERY_VISIT_ASK_IDS: readonly string[] = ['dyspnoea-trend', 'weight-trend', 'dyspnoea-present']
/**
 * The PREVENT answers only a clinician gives and today's record never fills.
 * Every other PREVENT input is a measurement or a record-derived answer, where
 * a carried manual value would take precedence over today's record.
 */
export const PREVENT_CARRIED_KEYS: readonly string[] = ['smoking', 'genetic']

/**
 * Every answer a carry can fill, keyed the way `carried-answers.store` marks it
 * and the screen looks it up. What is new after a carry is what was carried.
 */
export function carryableAnswers(patientId: string, now: Date = new Date(), scope: 'today' | 'held' = 'today'): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  const put = (prefix: string, values: object | undefined, pick = (value: unknown) => value) => {
    for (const [key, value] of Object.entries(values ?? {})) if (value !== undefined && value !== null) answers[prefix + key] = pick(value)
  }
  const vitals = useClinicVitalsStore.getState().byPatientId[patientId]
  const today = todayIsoDate(now)
  const held = scope === 'held'
  put('vital:', vitals?.entries, entry => (entry as { value: number }).value)
  // 'today': before a carry, only today's examination counts as answered — an earlier day's
  // grade or sign is replaced by the carry and has to count (and be marked) as carried.
  // 'held': what the stores hold now, which 三區塊 shows on any day; a mark is checked against it.
  put('sign:', Object.fromEntries(Object.entries(vitals?.signAnswers ?? {}).filter(([, sign]) => held || sign.examinedOn >= today)),
    sign => (sign as { value: string }).value)
  if (vitals?.nyhaClass && (held || (vitals.nyhaClass.assessedOn ?? calendarDayOf(vitals.nyhaClass.modifiedAt)) >= today)) answers.nyha = vitals.nyhaClass.value
  if (vitals?.compensationStatus) answers.compensation = vitals.compensationStatus.value
  put('echo:', useHfpefInputsStore.getState().byPatientId[patientId]?.entries, entry => (entry as { value: string }).value)
  if (usePhenotypeAnswerStore.getState().byPatientId[patientId]) answers.phenotype = true
  put('visit:', visitAnswersOf(useVisitAnswersStore.getState().byPatientId[patientId], today))
  const af = useAfAnswersStore.getState(), lipid = useNhiLipidReviewStore.getState(), prevent = usePreventStore.getState()
  put('af:', af.patientId === patientId ? af.answers : undefined)
  const coronary = useCoronaryPhaseStore.getState()
  if (coronary.patientId === patientId && coronary.answer) answers['coronary:phase'] = coronary.answer.phase
  put('lipid:', lipid.patientId === patientId ? lipid.answers : undefined)
  put('evidence:', useEvidenceOverridesStore.getState().byPatientId[patientId])
  put('prevent:', prevent.patientId === patientId ? prevent.inputs : undefined)
  put('decision:', usePhysicianDecisionsStore.getState().byPatientId[patientId], decision => (decision as { decision?: string }).decision)
  return answers
}

/** Explicitly confirmed, fill-only carry-forward. Historical results never enter the live evaluation. */
export function carryForwardCdss(patientId: string, record: CdssHistoryRecord, packId: string, packVersion: string,
  currentRecordProfile: CdssPatientProfile, choices: CarryForwardChoices): number {
  if (!patientId || record.save.pack_id !== packId || record.save.result.packVersion !== packVersion)
    throw new Error('cdss_carry_forward_incompatible')
  const now = new Date()
  const before = carryableAnswers(patientId, now)
  const today = todayIsoDate(now)
  // Validate every touched store before the first write, including pending hydration.
  // Marks still decrypting would be overwritten by this carry's own marks.
  if (!useCarriedAnswersStore.getState().hydratedPatientIds[patientId]
    || (choices.decisions && !usePhysicianDecisionsStore.getState().canCarryForward(patientId))
    || (choices.inputs && (!useClinicVitalsStore.getState().canCarryForward(patientId)
      || !useHfpefInputsStore.getState().canCarryForward(patientId)
      || !usePhenotypeAnswerStore.getState().canCarryForward(patientId)
      || useAfAnswersStore.getState().hydratedPatientId !== patientId
      || useCoronaryPhaseStore.getState().hydratedPatientId !== patientId
      || !useVisitAnswersStore.getState().hydratedPatientIds[patientId]
      || !useEvidenceOverridesStore.getState().hydratedPatientIds[patientId]
      || useNhiLipidReviewStore.getState().patientId !== patientId))) throw new Error('cdss_carry_forward_unavailable')
  if (choices.inputs) {
    const inputs = record.save.physician_inputs
    const facts = currentRecordProfile.facts
    const oldVitals = object(object(inputs.clinicVitals).entries)
    const currentVitals = useClinicVitalsStore.getState().byPatientId[patientId]?.entries ?? {}
    const oldSystolic = measurement.safeParse(oldVitals.systolic), oldDiastolic = measurement.safeParse(oldVitals.diastolic)
    const bpPair = !currentVitals.systolic && !currentVitals.diastolic && oldSystolic.success && oldDiastolic.success
      && oldSystolic.data.measuredOn === oldDiastolic.data.measuredOn
    const entries = Object.fromEntries(CLINIC_VITALS_ENTRY_KEYS.flatMap(key => {
      // Lab numbers and old examinations require a new entry at this visit.
      const fact = clinicFacts[key]
      const parsed = measurement.safeParse(oldVitals[key])
      return fact && !facts[fact] && parsed.success && parsed.data.measuredOn <= today
        && (!['systolic', 'diastolic'].includes(key) || bpPair)
        ? [[key, parsed.data]] : []
    }))
    // The NYHA grade, the signs and the compensation judgement come too, re-dated to today and marked as carried.
    useClinicVitalsStore.getState().carryForward(patientId, { ...object(inputs.clinicVitals), entries }, { exam: true, now })
    const oldEcho = object(object(inputs.hfpefInputs).entries)
    // A current echo study is kept whole; do not fill its missing parameters from an older study.
    const recordHasEcho = Boolean(facts.LVEF) || Object.values(echoFacts).some(fact => Boolean(facts[fact]))
    const latestEchoDay = Object.keys(echoFacts).flatMap(key => {
      const parsed = echo.safeParse(oldEcho[key])
      return parsed.success && parsed.data.measuredOn <= today ? [parsed.data.measuredOn] : []
    }).sort().at(-1)
    const echoEntries = Object.fromEntries(Object.entries(echoFacts).flatMap(([key, fact]) => {
      const parsed = echo.safeParse(oldEcho[key])
      return !recordHasEcho && !facts[fact] && parsed.success && parsed.data.measuredOn === latestEchoDay
        ? [[key, parsed.data]] : []
    }))
    useHfpefInputsStore.getState().carryForward(patientId, { entries: echoEntries })
    const parsedPhenotype = phenotype.safeParse(inputs.phenotypeAnswer)
    if (parsedPhenotype.success && parsedPhenotype.data.answeredOn <= today) {
      const answer = parsedPhenotype.data
      // An old entered EF must not replace this import's EF.
      if (recordHasEcho) { delete answer.lvef; delete answer.measuredOn; delete answer.choice;
        delete answer.diagnosis; delete answer.diagnosisConfirmation; delete answer.hfpEfConfirmed }
      if (answer.lvef !== undefined && (!answer.measuredOn || answer.measuredOn > today)) delete answer.lvef
      if (answer.hfSuspicion !== undefined || answer.diagnosis !== undefined || answer.choice !== undefined || answer.hfpEfConfirmed !== undefined)
        usePhenotypeAnswerStore.getState().carryForward(patientId, answer)
    }
    const af = useAfAnswersStore.getState()
    if (af.patientId === patientId && af.hydratedPatientId === patientId) {
      const old = object(inputs.afAnswers)
      for (const question of AF_CLINICAL_QUESTIONS) {
        if (typeof old[question.id] === 'boolean' && af.answers[question.id] === undefined)
          af.answer(patientId, question.id, old[question.id] as boolean)
      }
    }
    // CAD DP-01's class, kept with the day it was given: the pack ages it from there.
    const coronary = useCoronaryPhaseStore.getState()
    const oldPhase = toCoronaryPhaseAnswer(inputs.coronaryPhaseAnswer)
    if (oldPhase && oldPhase.answeredOn <= today && !coronary.answer) coronary.setAnswer(patientId, oldPhase)
    const lipid = useNhiLipidReviewStore.getState()
    if (lipid.patientId === patientId) {
      for (const [id, value] of Object.entries(object(inputs.nhiLipidReview))) {
        const provenance = object(object(inputs.nhiLipidReviewProvenance)[id])
        if (/^[a-z][a-z0-9-]{0,79}$/.test(id) && provenance.source === 'manual'
          && (value === 'yes' || value === 'no' || value === 'unknown') && lipid.answers[id] === undefined
          && storedTimestampV2.safeParse(provenance.reviewedAt).success)
          lipid.answer(patientId, id, value, { source: 'manual', reviewedAt: provenance.reviewedAt as string,
            ...(provenance.manualAction === 'selected' || provenance.manualAction === 'modified' || provenance.manualAction === 'reviewed'
              ? { manualAction: provenance.manualAction } : {}) })
      }
    }
    // Every-visit answers other than breathlessness and weight, given today as carried.
    const visit = useVisitAnswersStore.getState()
    const answeredToday = visitAnswersOf(visit.byPatientId[patientId], today) as Record<string, string | undefined>
    for (const [id, value] of Object.entries(object(inputs.visitAnswers))) {
      if (typeof value === 'string' && !EVERY_VISIT_ASK_IDS.includes(id) && answeredToday[id] === undefined) {
        const askId = id as Parameters<typeof visit.answer>[1]
        // An earlier day's identical answer, still held in a tab left open overnight, would make
        // `answer` a no-op; withdraw it first so the carried answer is dated today.
        if (useVisitAnswersStore.getState().byPatientId[patientId]?.[askId]) visit.answer(patientId, askId, null, now)
        visit.answer(patientId, askId, value, now, { packId })
      }
    }
    const evidence = useEvidenceOverridesStore.getState()
    const switchedToday = evidence.byPatientId[patientId] ?? {}
    for (const [id, enabled] of Object.entries(object(inputs.evidenceOverrides))) {
      if (typeof enabled === 'boolean' && switchedToday[id] === undefined && !['__proto__', 'constructor', 'prototype'].includes(id))
        evidence.setOverride(patientId, id, enabled)
    }
    const prevent = usePreventStore.getState()
    if (prevent.patientId === patientId) {
      for (const [key, value] of Object.entries(object(inputs.preventInputs))) {
        if (typeof value === 'string' && value !== '' && prevent.inputs[key] === undefined
          && PREVENT_CARRIED_KEYS.includes(key)) prevent.setInput(patientId, key, value)
      }
    }
  }
  if (choices.decisions) usePhysicianDecisionsStore.getState().carryForward(patientId, record.save.physician_decisions, packVersion)
  const after = carryableAnswers(patientId, now)
  const carried = Object.fromEntries(Object.entries(after).filter(([key]) => !(key in before)))
  // Marked with the saved record's own day, so the screen can say where each answer came from.
  useCarriedAnswersStore.getState().mark(patientId, carried, todayIsoDate(new Date(storedTimestampForDisplay(record.save.saved_at))), now)
  return Object.keys(carried).length
}
