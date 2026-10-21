/**
 * The eleven synthetic scenario bundles under `app/dev/cdss-scenarios/bundles`,
 * read the way the app reads them: the bundle through the app's own import
 * parser (`LocalBundleService.parse`), the entities through
 * `createFhirCdssPatientProfile`, the host's AF calculators (CrCl,
 * CHA₂DS₂-VA, HAS-BLED) applied as LiveFeature applies them, the every-visit
 * answers through the pack's `applyVisitAnswers`, and the model from the pack's
 * own `buildVisitDecisionModel` — the AF result built alongside as the
 * heart-failure page's companion when the AF pack applies.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ATRIAL_FIBRILLATION_GUIDELINE_PACK,
  HEART_FAILURE_GUIDELINE_PACK,
  applyFmtIntolerance,
  applyPreviousVisit,
  applyVisitAnswers,
  buildVisitDecisionModel,
} from '@voho0000/personalized-care'
import { createFhirCdssPatientProfile } from '@voho0000/personalized-care-fhir'
import { LocalBundleService } from '@/src/infrastructure/fhir/services/local-bundle.service'
import { applyAfCalculatorResults } from '@/features/clinical-decision-support/utils/af-calculators'
import { applyPhenotypeAnswer } from '@/features/clinical-decision-support/utils/apply-phenotype-answer'
import { applyClinicVitals } from '@/features/clinical-decision-support/utils/apply-clinic-vitals'
import { todayIsoDate, type ClinicVitals } from '@/features/clinical-decision-support/stores/clinic-vitals.store'
import type { PhenotypeAnswer } from '@/features/clinical-decision-support/stores/phenotype-answer.store'
import type {
  CdssPatientProfile,
  CdssResult,
  VisitAnswers,
  VisitDecisionModel,
} from '@/features/clinical-decision-support/types'

/** The visit date every scenario was written against. */
export const SCENARIO_NOW = new Date('2026-09-27T09:00:00+08:00')

/** Every term HF DP-06 reads from the clinic examination: the four signs and hypoperfusion. */
export const DP06_EXAM_TERMS = ['orthopnea', 'paroxysmal-nocturnal-dyspnea', 'jvp', 'rales', 'pitting-edema', 'hypoperfusion'] as const

/**
 * The examination in the room on the scenario's day, as the clinic-vitals
 * store holds it: every DP-06 term looked for, those in `found` present.
 */
export function examToday(found: readonly string[] = []): ClinicVitals {
  const modifiedAt = SCENARIO_NOW.toISOString()
  const examinedOn = todayIsoDate(SCENARIO_NOW)
  return {
    entries: {},
    signAnswers: Object.fromEntries(DP06_EXAM_TERMS.map((term) => [term, { value: found.includes(term) ? 'present' : 'absent', modifiedAt, examinedOn }])),
  }
}

/**
 * Runs `body` on the scenario's day: DP-06 reads today's examination only, and
 * an answer the stores stamp with the real clock would read as another day's.
 */
export function atScenarioDay<T>(body: () => T): T {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  jest.setSystemTime(new Date('2026-09-27T10:00:00+08:00'))
  try {
    return body()
  } finally {
    jest.useRealTimers()
  }
}

const BUNDLE_DIR = path.join(process.cwd(), 'app', 'dev', 'cdss-scenarios', 'bundles')

export type ScenarioId =
  | 'p1-suspected-hfpef' | 'p2-new-hfref' | 'p3-new-af' | 'p4-stable-optimised'
  | 'p5-titrating-af' | 'p6-hyperkalaemia' | 'p7-worsening-congestion' | 'p8-post-discharge'
  | 'p9-hfpef-af-dose' | 'p10-improved-ef' | 'p11-af-dabigatran-renal'

export interface ScenarioRun {
  profile: CdssPatientProfile
  result: CdssResult
  companion?: CdssResult
  model: VisitDecisionModel
}

/** The profile LiveFeature would hand the packs for this bundle, before the answers — on the scenario's day, or `now`. */
export function scenarioProfile(id: ScenarioId, now: Date = SCENARIO_NOW): CdssPatientProfile {
  const bundle = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, `${id}.json`), 'utf8'))
  const parsed = LocalBundleService.parse(bundle)
  if (!parsed) throw new Error(`${id}: the bundle did not parse`)
  const { patient, collection } = parsed
  const record = createFhirCdssPatientProfile({
    patient,
    conditions: collection.conditions,
    encounters: collection.encounters,
    observations: collection.observations,
    medications: collection.medications,
    allergies: collection.allergies,
    carePlans: collection.carePlans,
    procedures: collection.procedures,
    immunizations: collection.immunizations,
    diagnosticReports: collection.diagnosticReports,
    documentReferences: collection.documentReferences,
    now,
  })
  return applyAfCalculatorResults(record)
}

/**
 * The stored previous visit a returning scenario brings in (`previousVisit` in
 * the harness index), as the harness hands it to LiveFeature.
 */
export function scenarioPreviousVisit(id: ScenarioId): string | undefined {
  const index = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'index.json'), 'utf8')) as { id: string; previousVisit?: string }[]
  return index.find((item) => item.id === id)?.previousVisit
}

/**
 * The model the decision map draws for this scenario on the given page. A
 * returning scenario carries its stored visit; `firstVisit` drops it — the
 * same patient on the system's first visit.
 */
export function scenarioRun(
  id: ScenarioId,
  { page = 'hf', answers = {}, phenotype, intolerant = [], firstVisit = false, afAnswers, clinicVitals, now }: { page?: 'hf' | 'af'; answers?: VisitAnswers; phenotype?: PhenotypeAnswer; intolerant?: readonly string[]; firstVisit?: boolean; afAnswers?: CdssPatientProfile['afClinicalAnswers']; clinicVitals?: ClinicVitals; now?: Date } = {},
): ScenarioRun {
  // The DP-00/DP-01 answer reaches the pack as the app hands it: facts on the
  // profile; so does a pillar marked 「不耐受」, the stored previous visit, and
  // the AF page's answers (AF DP-01 among them).
  const previous = firstVisit ? undefined : scenarioPreviousVisit(id)
  const loaded = scenarioProfile(id, now)
  const withAf = afAnswers ? { ...loaded, afClinicalAnswers: afAnswers } : loaded
  // The vitals and signs measured in the room, as LiveFeature applies them: before the phenotype answer.
  const answered = applyFmtIntolerance(applyPhenotypeAnswer(applyClinicVitals(applyVisitAnswers(withAf, answers), clinicVitals), phenotype), intolerant)
  const profile = previous ? applyPreviousVisit(answered, previous) : answered
  if (page === 'af') {
    const result = ATRIAL_FIBRILLATION_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
    return {
      profile,
      result,
      model: buildVisitDecisionModel({ packId: 'atrial-fibrillation-cdss', result, profile, locale: 'zh-TW' }),
    }
  }
  const result = HEART_FAILURE_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
  const companion = ATRIAL_FIBRILLATION_GUIDELINE_PACK.applies(profile)
    ? ATRIAL_FIBRILLATION_GUIDELINE_PACK.build({ profile, locale: 'zh-TW' })
    : undefined
  return {
    profile,
    result,
    ...(companion ? { companion } : {}),
    model: buildVisitDecisionModel({
      packId: 'heart-failure-cdss',
      result,
      profile,
      companions: companion ? { [companion.packId]: companion } : {},
      locale: 'zh-TW',
    }),
  }
}
