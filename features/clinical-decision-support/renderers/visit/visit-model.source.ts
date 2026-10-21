/**
 * Where the visit decision model comes from.
 *
 * The pack owns it: `buildVisitDecisionModel` reads the pack's own result (and
 * the results of the other packs its map reads — on the heart-failure page,
 * atrial fibrillation's — as `companions`) and
 * says which decision points exist, which of them are today's, and in what
 * words; `applyVisitAnswers` turns the every-visit answers into facts the
 * modules read. This file is the one seam between that and the host, so the
 * rest of the feature never imports the builder directly and a builder that
 * throws costs the clinician the map, never the page.
 */
import {
  applyFmtIntolerance as packApplyFmtIntolerance,
  applyPreviousVisit as packApplyPreviousVisit,
  applyVisitAnswers as packApplyVisitAnswers,
  buildVisitDecisionModel,
  VISIT_MAPS,
} from '@voho0000/personalized-care'
import type {
  BuildVisitDecisionModelInput,
  CdssPatientProfile,
  VisitAnswers,
  VisitDecisionModel,
  VisitMapDefinition,
} from '../../types'
import { applyHospitalMedicationVisitReview } from '../../utils/hospital-medication-visit'

type VisitModelBuilder = (input: BuildVisitDecisionModelInput) => VisitDecisionModel

/**
 * The pack's builder, when the installed package has one. Read defensively: a
 * host running against a package build that predates the visit API offers no
 * map rather than failing to load.
 */
const packBuilder = (typeof buildVisitDecisionModel === 'function'
  ? buildVisitDecisionModel
  : undefined) as VisitModelBuilder | undefined

/**
 * Whether the installed package can build a model at all. The switch offers
 * the map on that alone, so a browser that stored another layout can still
 * reach it; whether this record's model builds is known only once it is asked.
 */
export function isVisitModelSupported(): boolean {
  return packBuilder !== undefined
}

/**
 * The decision map a pack declares, or undefined when it has none. Which pages
 * have a map, and which other packs' results a map reads, are the pack's to
 * say (`VISIT_MAPS`); the host lists no pack ids of its own for either.
 */
export function visitMapOf(packId: string): VisitMapDefinition | undefined {
  return (Array.isArray(VISIT_MAPS) ? VISIT_MAPS : []).find((map) => map.packId === packId)
}

/** Whether this pack's page can open on the decision map at all. */
export function hasVisitMap(packId: string): boolean {
  return isVisitModelSupported() && visitMapOf(packId) !== undefined
}

/**
 * The `source` the page's own points carry: the model says so; a model built
 * without it is read from the pack's map, else from its first point, which is
 * always the page's own.
 */
export function pageSourceOf(model: VisitDecisionModel): string {
  return model.source ?? visitMapOf(model.packId)?.source ?? model.points[0]?.source ?? ''
}

/** The pack's answer-to-fact step: each every-visit answer becomes a fact the modules read. */
export function applyVisitAnswers(profile: CdssPatientProfile, answers: VisitAnswers): CdssPatientProfile {
  if (typeof packApplyVisitAnswers !== 'function' || Object.keys(answers).length === 0) return profile
  return packApplyVisitAnswers(profile, answers)
}

/**
 * The pillars the clinician recorded as 「不耐受」, as facts the pack reads:
 * DP-19 counts them as ESC Table 15's prognostic medication intolerance. A
 * package without the step leaves the profile as it was.
 */
export function applyFmtIntolerance(profile: CdssPatientProfile, dps: readonly string[]): CdssPatientProfile {
  if (typeof packApplyFmtIntolerance !== 'function' || dps.length === 0) return profile
  return packApplyFmtIntolerance(profile, dps)
}

/**
 * The last visit this CDSS recorded for the patient, as the pack reads it:
 * with one the page opens on 追蹤; without one the visit is the system's first
 * and asks the baseline work-up and the diagnosis. Nothing stores visits yet,
 * so the app passes none and every visit is a first one; the scenario harness
 * passes one to show a returning patient. A package without the step leaves
 * the profile as it was.
 */
export function applyPreviousVisit(profile: CdssPatientProfile, date: string | undefined): CdssPatientProfile {
  if (typeof packApplyPreviousVisit !== 'function' || !date) return profile
  return packApplyPreviousVisit(profile, date)
}

/**
 * The model for this result, or undefined when there is none to draw — the
 * package has no builder, the pack is not one the map serves, or the builder
 * threw. The caller falls back to the three sections in every such case.
 *
 * An anticoagulant known only from an unconfirmed hospital prescription stays
 * 待核對 on the map rather than 「已抗凝」 (`applyHospitalMedicationVisitReview`),
 * as the result adapter keeps it from settling the cards.
 */
export function buildVisitModel(input: BuildVisitDecisionModelInput): VisitDecisionModel | undefined {
  if (!packBuilder) return undefined
  try {
    return applyHospitalMedicationVisitReview(packBuilder(input), input.profile, input.locale)
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[cdss] visit decision model could not be built', error)
    }
    return undefined
  }
}
