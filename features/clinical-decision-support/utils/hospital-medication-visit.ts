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
 * prescription's agent and dose as information, 院內用藥紀錄 as what it waits
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
        headline: locale === 'en' ? 'Diagnosis content unavailable' : '診斷內容未提供',
        why: locale === 'en' ? 'Available diagnosis content does not establish whether AF is present or absent.' : '可用診斷內容不足以判定有無心房顫動。',
        actions: [],
        needsData: point.needsData,
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
  const verdictSuffix = english ? ' · hospital prescription record' : ' · 院內處方紀錄'
  const review = (point: DecisionPointView): DecisionPointView => {
    if ((point.decisionId ?? point.semanticId) !== OAC_WHETHER) return point
    const verdict = point.scoreTable?.verdict
    const onIt = verdict !== undefined ? ON_IT_SUFFIXES.find((suffix) => verdict.endsWith(suffix)) : undefined
    // 「≥2 建議抗凝 · 已在用」 → 「≥2 建議抗凝 · 院內處方紀錄」, and not yet the patient's conclusion.
    const scoreTable = point.scoreTable && (onIt || variantPending)
      ? { ...point.scoreTable, ...(onIt ? { verdict: `${verdict!.slice(0, -onIt.length)}${verdictSuffix}` } : {}), pending: true }
      : point.scoreTable
    if (!variantPending && point.state !== 'done') return scoreTable === point.scoreTable ? point : { ...point, scoreTable: scoreTable! }
    // 「已抗凝」 has no next step and no 「what changes the answer」; neither applies while use is unconfirmed.
    const { next: _next, changesIf: _changesIf, ...rest } = point
    return {
      ...rest,
      state: 'info',
      headline: variantPending ? english ? 'Medication content unavailable' : '藥品內容未提供' : english ? `${label}: hospital record` : `${label}：院內紀錄`,
      why: variantPending ? english ? 'Medication content is unavailable. Anticoagulant use or absence cannot be inferred from the available record.' : '藥品內容未提供，無法從現有紀錄判定是否使用抗凝藥。' : english
        ? `Hospital prescription${date ? ` (${date})` : ''}; use status not recorded; available prescription facts are included in medication and safety assessment`
        : `院內處方${date ? `（${date}）` : ''}，紀錄未提供使用狀態；已納入用藥與安全判讀`,
      ...(point.chain ? {
        chain: point.chain.map((step) => step.id === 'whether'
          ? { ...step, state: 'current' as const, text: english ? 'Hospital record' : '院內紀錄' }
          : step.state === 'done' ? { ...step, state: 'later' as const } : step),
      } : {}),
      actions: [],
      needsData: point.needsData,
      ...(scoreTable ? { scoreTable } : {}),
    }
  }
  const points = model.points.map(review)
  // The AF follow-up status line names the regimen (「AF 追蹤：apixaban 5 mg bid」).
  const headline = model.source === 'af' && first && model.headline.includes(label)
    ? model.headline.replace(label, english ? `${label} (hospital record)` : `${label}（院內紀錄）`)
    : model.headline
  return points.every((point, index) => point === model.points[index]) && headline === model.headline
    ? model
    : { ...model, headline, points }
}
