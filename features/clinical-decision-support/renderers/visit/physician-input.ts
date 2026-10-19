/**
 * A decision-map action that also answers a card's structured question.
 *
 * The pack may mark an action with `physicianInput` — DP-00 「HFrEF／HFpEF／
 * 還不確定」 answer `hf-suspicion`, DP-34 「確認 HFpEF」 answers
 * `hfpef-diagnosis-confirmation`
 * — so pressing it is the same answer the card's own control writes, handed
 * back through the same phenotype-answer store, and the pack recomputes from
 * it. This file only translates the request kind and option id into that
 * store's shape; the ids are wire identifiers, the same ones
 * `PhysicianInputRequestPanel` writes, never clinical wording.
 */
import { todayIsoDate } from '../../stores/clinic-vitals.store'
import type { PhenotypeAnswer } from '../../stores/phenotype-answer.store'
import type { CoronaryPhaseAnswer } from '../../stores/coronary-phase.store'
import type { VisitAction } from '../../types'

export type VisitPhysicianInput = NonNullable<VisitAction['physicianInput']>

/**
 * The answer after DP-00 「診斷：HFrEF 還是 HFpEF？」, whichever control asked
 * it — the card's radio, the assessment's question 1, the map's row, or the
 * HFpEF confirmation, which is the same diagnosis reached the long way.
 *
 * A phenotype is the clinician's diagnosis, written the way the pack already
 * reads one: 「HFrEF」 is 「LVEF <50%」 plus a confirmed diagnosis (the pack
 * then opens HFrEF over whatever LVEF the record holds); 「HFpEF」 is 「LVEF
 * ≥50%」 plus the HFpEF confirmation. 「還不確定」 is the old 「懷疑」: it opens
 * the work-up and takes back whatever an earlier choice here had written.
 * The legacy 「否」 is still read, so an answer stored before it went away
 * keeps its meaning.
 */
export function diagnosisAnswer(
  optionId: string | undefined,
  current: PhenotypeAnswer | undefined,
  now: Date,
  isEnglish = false,
): PhenotypeAnswer | undefined {
  if (optionId !== 'hfref' && optionId !== 'hfpef' && optionId !== 'suspected' && optionId !== 'not-suspected') return undefined
  const answeredOn = todayIsoDate(now)
  const { diagnosis: previous, ...rest } = current ?? { answeredOn }
  // Take back only what an earlier choice on this question wrote.
  const base: PhenotypeAnswer = { ...rest, answeredOn }
  if (previous === 'hfrEF') {
    delete base.diagnosisConfirmation
    if (base.choice === 'reduced') delete base.choice
  }
  if (previous === 'hfpEF') {
    delete base.hfpEfConfirmed
    if (base.choice === 'preserved') delete base.choice
  }
  if (optionId === 'hfref') {
    return {
      ...base,
      hfSuspicion: 'suspected',
      diagnosis: 'hfrEF',
      choice: 'reduced',
      diagnosisConfirmation: {
        method: 'current',
        confirmedAt: now.toISOString(),
        basis: isEnglish ? "HFrEF: the clinician's judgement" : 'HFrEF：醫師臨床判斷',
      },
    }
  }
  if (optionId === 'hfpef') {
    return { ...base, hfSuspicion: 'suspected', diagnosis: 'hfpEF', choice: 'preserved', hfpEfConfirmed: true }
  }
  return { ...base, hfSuspicion: optionId }
}

/** Which DP-00 option an answer stands for, by the ids the pack publishes. */
export function diagnosisOptionOf(answer: PhenotypeAnswer | undefined): string | undefined {
  if (answer?.diagnosis === 'hfrEF') return 'hfref'
  if (answer?.diagnosis === 'hfpEF') return 'hfpef'
  return answer?.hfSuspicion
}

/**
 * The AF answers an AF DP-01 press writes. 「AF」, 「AFL」 and 「都有」 are each
 * a confirmed diagnosis — `diagnosisConfirmed` true, the answer the AF card's
 * 「AF／flutter 診斷」 row writes — with `atrialFibrillation` and
 * `atrialFlutter` saying which the patient has. Undefined for any other input.
 */
export function afAnswersForInput(
  input: VisitPhysicianInput,
): { id: 'diagnosisConfirmed' | 'atrialFibrillation' | 'atrialFlutter'; value: boolean }[] | undefined {
  if (input.request !== 'af-diagnosis') return undefined
  const has = { af: [true, false], flutter: [false, true], both: [true, true] }[input.optionId ?? '']
  if (!has) return undefined
  return [
    { id: 'diagnosisConfirmed', value: true },
    { id: 'atrialFibrillation', value: has[0] },
    { id: 'atrialFlutter', value: has[1] },
  ]
}

const CORONARY_PHASES = new Set(['acs-recent', 'pci-recent', 'chronic-mi', 'chronic-stable', 'unsure'])

/**
 * The input a CAD DP-01 press writes: the class, and — from the 「知道年月？」
 * field beside the table — the month or year the clinician knew, carried in the
 * option id as `phase@YYYY-MM` so it travels the same path the class does.
 */
export function coronaryPhaseInput(phase: CoronaryPhaseAnswer['phase'], eventMonth?: string): VisitPhysicianInput {
  return { request: 'cad-phase', optionId: eventMonth ? `${phase}@${eventMonth}` : phase }
}

/**
 * The CAD DP-01 answer a press writes — the class and the day it was given,
 * which the pack reads its 「1 年內」 back from — or undefined for any other
 * input. 「還不確定」 is an answer too: it says the question was seen.
 */
export function coronaryPhaseForInput(input: VisitPhysicianInput, now: Date): CoronaryPhaseAnswer | undefined {
  if (input.request !== 'cad-phase') return undefined
  const [phase, eventMonth] = (input.optionId ?? '').split('@')
  if (!CORONARY_PHASES.has(phase)) return undefined
  const month = eventMonth && /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(eventMonth) ? eventMonth : undefined
  return {
    phase: phase as CoronaryPhaseAnswer['phase'],
    answeredOn: todayIsoDate(now),
    ...(month && (phase === 'acs-recent' || phase === 'pci-recent') ? { eventMonth: month } : {}),
  }
}

/**
 * The phenotype answer after `input`, or undefined when the input is not one
 * this host knows how to write — in which case nothing is written and the
 * card's own control remains the way to answer.
 */
export function phenotypeAnswerForInput(
  input: VisitPhysicianInput,
  current: PhenotypeAnswer | undefined,
  now: Date,
): PhenotypeAnswer | undefined {
  const answeredOn = todayIsoDate(now)
  switch (input.request) {
    case 'hf-suspicion':
      return diagnosisAnswer(input.optionId, current, now)
    case 'hfpef-diagnosis-confirmation':
      return diagnosisAnswer('hfpef', current, now)
    case 'lvef-phenotype':
      return input.optionId === 'reduced' || input.optionId === 'preserved' || input.optionId === 'unknown'
        ? { ...(current ?? {}), choice: input.optionId, answeredOn }
        : undefined
    default:
      return undefined
  }
}
