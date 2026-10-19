'use client'

import { useEffect } from 'react'
import type { CdssAssessmentChange } from '@/src/shared/contracts/cdss-gateway-event'
import { CLINIC_VITALS_ENTRY_KEYS, useClinicVitalsStore } from '../stores/clinic-vitals.store'
import { usePhenotypeAnswerStore } from '../stores/phenotype-answer.store'
import { usePhysicianDecisionsStore } from '../stores/physician-decisions.store'
import { useHfpefInputsStore } from '../stores/hfpef-inputs.store'
import { useEvidenceOverridesStore } from '../stores/evidence-overrides.store'
import { useAfAnswersStore } from '../stores/af-answers.store'
import { useCoronaryPhaseStore } from '../stores/coronary-phase.store'
import { useNhiLipidReviewStore } from '../stores/nhi-lipid-review.store'
import { usePreventStore } from '../stores/prevent-inputs.store'
import { DECISION_REASONS } from '../renderers/heart-failure-visit-flow'
import { recordCdssEvent } from './cdss-gateway'
import { isCollectorSite } from '@/src/application/telemetry/collector'

const SIGN_TERMS = [
  'exertional-dyspnea', 'orthopnea', 'paroxysmal-nocturnal-dyspnea',
  'fatigue-exercise-intolerance', 'reported-ankle-swelling', 'abdominal-bloating',
  'nocturnal-cough', 'bendopnea', 'reported-weight-gain', 'rales', 'jvp',
  'pitting-edema', 'third-heart-sound', 'hepatojugular-reflux', 'ascites', 'hepatomegaly',
] as const
const ECHO_KEYS = [
  'averageEe', 'e', 'septalE', 'lateralE', 'trv', 'pasp', 'gls',
  'lavi', 'lvmi', 'rwt', 'wall',
] as const
const CLINIC_LAB_KEYS = new Set(['potassium', 'eGFR', 'sodium', 'NTproBNP', 'hemoglobin'])
const safeTarget = (value: string) => /^[a-z][a-z0-9-]{0,79}$/.test(value)
const reasonIds = new Set(DECISION_REASONS.map((reason) => reason.id))

function changed(
  changes: CdssAssessmentChange[], field_id: string,
  before: unknown, after: string | number | boolean | null | undefined,
  target_id?: string, measured_on?: string,
) {
  if (before === after || !safeTarget(field_id) || (target_id && !safeTarget(target_id))) return
  changes.push({ field_id, ...(target_id ? { target_id } : {}),
    value: after ?? null, ...(measured_on && /^\d{4}-\d{2}-\d{2}$/.test(measured_on) ? { measured_on } : {}) })
}

function sendChanges(patientId: string, packId: string, changes: CdssAssessmentChange[]) {
  for (let index = 0; index < changes.length; index += 32) {
    recordCdssEvent(patientId, packId, { kind: 'assessment', changes: changes.slice(index, index + 32) })
  }
}

/** Subscriptions start only after local hydration, so old answers are not new actions. */
export function useCdssGateway(input: {
  patientId?: string
  packId: string
  ready: boolean
}): void {
  const { patientId, packId, ready } = input

  useEffect(() => {
    if (!patientId || !ready || !isCollectorSite()) return
    const unsubs = [
      useClinicVitalsStore.subscribe((next, previous) => {
        const before = previous.byPatientId[patientId]
        const after = next.byPatientId[patientId]
        if (before === after || !after) return
        const changes: CdssAssessmentChange[] = []
        for (const key of CLINIC_VITALS_ENTRY_KEYS) {
          const prior = before?.entries[key]
          const current = after.entries[key]
          if (prior?.value !== current?.value || prior?.measuredOn !== current?.measuredOn) {
            if (CLINIC_LAB_KEYS.has(key)) {
              recordCdssEvent(patientId, packId, { kind: 'interaction', action: 'manual_test_value_changed', target: key.toLowerCase() })
            } else {
              changed(changes, `clinic-${key.toLowerCase()}`, prior?.value, current?.value, undefined, current?.measuredOn)
            }
          }
        }
        changed(changes, 'nyha-class', before?.nyhaClass?.value, after.nyhaClass?.value)
        changed(changes, 'compensation-status', before?.compensationStatus?.value, after.compensationStatus?.value)
        for (const term of SIGN_TERMS) {
          changed(changes, `sign-${term}`, before?.signAnswers[term]?.value, after.signAnswers[term]?.value)
        }
        sendChanges(patientId, packId, changes)
      }),
      usePhenotypeAnswerStore.subscribe((next, previous) => {
        const before = previous.byPatientId[patientId]
        const after = next.byPatientId[patientId]
        if (before === after || !after) return
        const changes: CdssAssessmentChange[] = []
        changed(changes, 'hf-suspicion', before?.hfSuspicion, after.hfSuspicion)
        changed(changes, 'lvef-phenotype', before?.choice, after.choice)
        if (before?.lvef !== after.lvef || before?.measuredOn !== after.measuredOn) {
          recordCdssEvent(patientId, packId, { kind: 'interaction', action: 'manual_test_value_changed', target: 'lvef' })
        }
        changed(changes, 'hfpef-confirmation', before?.hfpEfConfirmed, after.hfpEfConfirmed)
        sendChanges(patientId, packId, changes)
      }),
      usePhysicianDecisionsStore.subscribe((next, previous) => {
        const before = previous.byPatientId[patientId] ?? {}
        const after = next.byPatientId[patientId] ?? {}
        if (before === after) return
        const changes: CdssAssessmentChange[] = []
        for (const target of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (!safeTarget(target)) continue
          changed(changes, 'decision-kind', before[target]?.decision, after[target]?.decision, target)
          changed(changes, 'decision-reason-count', before[target]?.reasons.length, after[target]?.reasons.length, target)
          for (const reason of reasonIds) {
            const wasSelected = before[target]?.reasons.includes(reason) ?? false
            const isSelected = after[target]?.reasons.includes(reason) ?? false
            changed(changes, `reason-${reason}`, wasSelected, isSelected, target)
          }
          if (before[target]?.note !== after[target]?.note) {
            changes.push({ field_id: 'decision-note-edited', target_id: target,
              value: Boolean(after[target]?.note) })
          }
        }
        sendChanges(patientId, packId, changes)
      }),
      useHfpefInputsStore.subscribe((next, previous) => {
        const before = previous.byPatientId[patientId]
        const after = next.byPatientId[patientId]
        if (before === after || !after) return
        for (const key of ECHO_KEYS) {
          const prior = before?.entries[key]
          const current = after.entries[key]
          if (prior?.value === current?.value && prior?.measuredOn === current?.measuredOn) continue
          recordCdssEvent(patientId, packId, { kind: 'interaction', action: 'manual_test_value_changed', target: `echo-${key.toLowerCase()}` })
        }
      }),
      useEvidenceOverridesStore.subscribe((next, previous) => {
        const before = previous.byPatientId[patientId] ?? {}
        const after = next.byPatientId[patientId] ?? {}
        if (before === after) return
        for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (before[id] === after[id]) continue
          // Evidence row IDs may contain source details. Only the click and its
          // state cross the boundary; no evidence text or source identifier.
          recordCdssEvent(patientId, packId, { kind: 'interaction', action: 'evidence_toggled',
            ...(after[id] !== undefined ? { enabled: after[id] } : {}) })
        }
      }),
      useAfAnswersStore.subscribe((next, previous) => {
        if (next.patientId !== patientId || previous.patientId !== patientId || next.answers === previous.answers) return
        const changes: CdssAssessmentChange[] = []
        for (const id of new Set([...Object.keys(previous.answers), ...Object.keys(next.answers)])) {
          if (!safeTarget(id)) continue
          changed(changes, 'af-answer', previous.answers[id], next.answers[id], id)
        }
        sendChanges(patientId, packId, changes)
      }),
      useCoronaryPhaseStore.subscribe((next, previous) => {
        if (next.patientId !== patientId || previous.patientId !== patientId || next.answer === previous.answer) return
        const changes: CdssAssessmentChange[] = []
        changed(changes, 'cad-phase', previous.answer?.phase, next.answer?.phase)
        sendChanges(patientId, packId, changes)
      }),
      useNhiLipidReviewStore.subscribe((next, previous) => {
        if (next.patientId !== patientId || next.answers === previous.answers) return
        const changes: CdssAssessmentChange[] = []
        for (const id of new Set([...Object.keys(previous.answers), ...Object.keys(next.answers)])) {
          if (!safeTarget(id) || next.provenance[id]?.source === 'ai') continue
          changed(changes, 'lipid-criterion', previous.answers[id], next.answers[id], id)
          if (previous.answers[id] === next.answers[id]
            && next.provenance[id]?.source === 'manual'
            && previous.provenance[id] !== next.provenance[id]) {
            changes.push({ field_id: 'lipid-criterion-reviewed', target_id: id, value: true })
          }
        }
        sendChanges(patientId, packId, changes)
      }),
      usePreventStore.subscribe((next, previous) => {
        if (next.patientId !== patientId || previous.patientId !== patientId || next.inputs === previous.inputs) return
        const changes: CdssAssessmentChange[] = []
        for (const id of new Set([...Object.keys(previous.inputs), ...Object.keys(next.inputs)])) {
          if (!safeTarget(id)) continue
          const value = next.inputs[id]
          if (value === undefined || ['yes', 'no', 'female', 'male'].includes(value)) {
            changed(changes, 'prevent-choice', previous.inputs[id], value, id)
          }
        }
        sendChanges(patientId, packId, changes)
      }),
    ]
    return () => unsubs.forEach((unsubscribe) => unsubscribe())
  }, [patientId, packId, ready])

}
