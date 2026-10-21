import { anticoagulationOnProfile } from './hospital-medication-profile'
import type { CdssLocale, CdssPatientProfile, DecisionPointView, VisitDecisionModel } from '../types'
import type { HospitalAwareCdssProfile, HospitalUnconfirmedAnticoagulation } from './hospital-medication-profile'

/**
 * AF's 「要不要抗凝」 question (AF DP-07), wherever a map shows it: the AF
 * page's own point, or the heart-failure page's DP-14 when it folds that point
 * in (the fold carries the owner's decision id).
 */
const OAC_WHETHER = 'af-oac-whether'
/** The pack's suffix on a CHA₂DS₂-VA verdict while an anticoagulant is on the profile. */
const ON_IT_SUFFIXES = [' · 已在用', ' · on it']

/** The regimen as the AF map names it (「apixaban 5 mg bid」). */
function regimenLabel(regimen: HospitalUnconfirmedAnticoagulation['regimens'][number]): string {
  const frequency = regimen.timesPerDay === 2 ? 'bid' : regimen.timesPerDay === 1 ? 'qd' : undefined
  return [regimen.ingredient, regimen.doseMg !== undefined ? `${regimen.doseMg} mg` : undefined, frequency]
    .filter(Boolean).join(' ')
}

/**
 * The visit map's counterpart of `applyHospitalMedicationReview`.
 *
 * The AF map settles 「要不要抗凝」 (已抗凝／已定, CHA₂DS₂-VA 「已在用」) from any
 * anticoagulant regimen on the profile. Where every anticoagulant there comes
 * from an unconfirmed hospital prescription, that point stays 待核對: the
 * prescription's agent and dose as information, 核對目前用藥 as what it waits
 * on, and no action — neither 「已抗凝」 nor 「開始抗凝」. The regimen itself
 * stays on the profile, so interaction, dose and bleeding checks still read
 * it as possible exposure. Nothing else in the model changes.
 */
export function applyHospitalMedicationVisitReview(
  model: VisitDecisionModel, profile: CdssPatientProfile, locale: CdssLocale,
): VisitDecisionModel {
  const unresolvedDiagnoses = (profile as HospitalAwareCdssProfile).excludedClinicalRecordVariants?.some(row => row.resourceType === 'Condition')
  if (unresolvedDiagnoses) {
    // These HF points derive their negative conclusion directly from the
    // absence of an established AF diagnosis. Quarantined source diagnoses
    // cannot establish that absence. Other native positive decisions and the
    // native AF score's existing unknown-item handling remain unchanged.
    const points = model.points.map(point => {
      if (point.state !== 'not-applicable' || !['hf-af-anticoagulation', 'hf-af-rate-rhythm'].includes(point.semanticId)) return point
      return {
        ...point,
        state: 'info' as const,
        headline: locale === 'en' ? 'Diagnosis source records unresolved' : '診斷來源尚待核對',
        why: locale === 'en' ? 'Unresolved source diagnoses cannot establish whether AF is present or absent.' : '診斷來源仍有未決版本或衝突，尚不能據此判定有無心房顫動。',
        actions: [],
        needsData: [...new Set([...(point.needsData ?? []), locale === 'en' ? 'Reconcile source records' : '核對診斷來源紀錄'])],
      }
    })
    if (points.some((point, index) => point !== model.points[index])) model = { ...model, points }
  }
  const unresolvedInventory = (profile as HospitalAwareCdssProfile).hospitalMedicationInventoryUnresolved
  const variantPending = unresolvedInventory && !anticoagulationOnProfile(profile)
  const pending = (profile as HospitalAwareCdssProfile).hospitalMedicationUnconfirmedAnticoagulation
    ?? (variantPending ? { regimens: [], sources: unresolvedInventory.sources } : undefined)
  if (!pending) return model
  const english = locale === 'en'
  const first = pending.regimens[0]
  const recorded = pending.sources[0]?.value
  const label = first ? regimenLabel(first) : recorded !== undefined ? String(recorded) : 'OAC'
  const date = first?.date ?? pending.sources[0]?.date
  // The same words the result adapter uses for every module it holds back.
  const reconcile = english ? 'Confirm current medication use' : '核對目前用藥'
  const verdictSuffix = english ? ' · hospital prescription to confirm' : ' · 院內處方待核對'
  const review = (point: DecisionPointView): DecisionPointView => {
    if ((point.decisionId ?? point.semanticId) !== OAC_WHETHER) return point
    const verdict = point.scoreTable?.verdict
    const onIt = verdict !== undefined ? ON_IT_SUFFIXES.find((suffix) => verdict.endsWith(suffix)) : undefined
    // 「≥2 建議抗凝 · 已在用」 → 「≥2 建議抗凝 · 院內處方待核對」, and not yet the patient's conclusion.
    const scoreTable = point.scoreTable && (onIt || variantPending)
      ? { ...point.scoreTable, ...(onIt ? { verdict: `${verdict!.slice(0, -onIt.length)}${verdictSuffix}` } : {}), pending: true }
      : point.scoreTable
    if (!variantPending && point.state !== 'done') return scoreTable === point.scoreTable ? point : { ...point, scoreTable: scoreTable! }
    // 「已抗凝」 has no next step and no 「what changes the answer」; neither applies while use is unconfirmed.
    const { next: _next, changesIf: _changesIf, ...rest } = point
    return {
      ...rest,
      state: 'info',
      headline: variantPending ? english ? 'Medication inventory unresolved' : '來源用藥未釐清' : english ? `${label}: use to confirm` : `${label}：使用待核對`,
      why: variantPending ? english ? 'Medication source versions or conflicts are unresolved. Neither anticoagulant use nor absence is established; reconcile before deciding whether to start or change treatment.' : '來源用藥版本或衝突未釐清，尚不能判定已使用或未使用抗凝藥；治療決策前需先核對。' : english
        ? `Hospital prescription${date ? ` (${date})` : ''}; current use needs confirmation. Confirm actual use before starting or changing anticoagulation`
        : `院內處方${date ? `（${date}）` : ''}，目前使用待確認；開始或調整抗凝前先核對實際用藥`,
      ...(point.chain ? {
        chain: point.chain.map((step) => step.id === 'whether'
          ? { ...step, state: 'current' as const, text: english ? 'Use to confirm' : '使用待核對' }
          : step.state === 'done' ? { ...step, state: 'later' as const } : step),
      } : {}),
      actions: [],
      needsData: [...new Set([...(point.needsData ?? []), reconcile])],
      ...(scoreTable ? { scoreTable } : {}),
    }
  }
  const points = model.points.map(review)
  // The AF follow-up status line names the regimen (「AF 追蹤：apixaban 5 mg bid」).
  const headline = model.source === 'af' && first && model.headline.includes(label)
    ? model.headline.replace(label, english ? `${label} (use to confirm)` : `${label}（使用待核對）`)
    : model.headline
  return points.every((point, index) => point === model.points[index]) && headline === model.headline
    ? model
    : { ...model, headline, points }
}
