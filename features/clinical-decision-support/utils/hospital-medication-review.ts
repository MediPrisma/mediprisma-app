import type { CdssFactSource, CdssLocale, CdssMedicationClassId, CdssRecommendation, CdssResult, ClinicalGuidelinePack } from '../types'
import {
  createHospitalMedicationEvaluationProfile,
  HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS,
  isPendingHospitalMedication,
  type HospitalAwareCdssProfile,
} from './hospital-medication-profile'

const HARMFUL_ROWS: Readonly<Record<string, CdssMedicationClassId>> = {
  'hf-harm:nsaid': 'nsaid-or-cox2-inhibitor',
  'hf-harm:non-dhp-ccb': 'non-dihydropyridine-calcium-channel-blocker',
  'hf-harm:thiazolidinedione': 'thiazolidinedione',
  'hf-harm:saxagliptin': 'saxagliptin',
  'hf-harm:antiarrhythmic': 'hf-avoided-antiarrhythmic',
}

/** Every live pack (including companions and English builds) uses this seam.
 * Native safety checks see possible exposure; the displayed profile keeps its
 * unconfirmed use states. Reconcile therapeutic actions before returning them. */
export function buildHospitalAwareCdssResult(
  pack: ClinicalGuidelinePack, profile: HospitalAwareCdssProfile, locale: CdssLocale,
): CdssResult {
  const result = pack.build({ profile: createHospitalMedicationEvaluationProfile(profile), locale })
  return applyUnresolvedRecordTherapyReview(applyHospitalMedicationReview(result, profile, locale), profile, locale)
}

/** No condition/allergy/visit/procedure version is chosen as a contraindication
 * verdict. Preserve verified safety results; defer non-safety treatment actions. */
export function applyUnresolvedRecordTherapyReview(result: CdssResult, profile: HospitalAwareCdssProfile, locale: CdssLocale): CdssResult {
  const unresolved = profile.excludedClinicalRecordVariants?.filter(item => ['Condition', 'AllergyIntolerance', 'Encounter', 'Procedure'].includes(item.resourceType)) ?? []
  if (!unresolved.length) return result
  const label = locale === 'en' ? 'Reconcile unresolved source records' : '核對未決來源紀錄'
  const message = locale === 'en'
    ? 'Condition, allergy, encounter or procedure source versions are unresolved. Reconcile eligibility and contraindications before starting or adjusting therapy; verified safety evidence remains available.'
    : '診斷、過敏、就醫或處置來源版本尚未釐清，開始或調整治療前需核對適用條件及禁忌；已確認的安全證據仍可使用。'
  const adapt = (item: CdssRecommendation): CdssRecommendation => {
    const therapy = item.domain === 'medication' || item.presentationType === 'medication'
      || item.visitDecision?.actions.some(action => action.decisionKind === 'prescribed' || action.decisionKind === 'dose-adjusted')
    const positiveSafety = item.domain === 'safety' && (item.status === 'actionable' || item.status === 'review')
      && (item.patientEvidence.some(entry => entry.sources?.length)
        || item.evidenceTables?.some(table => table.items.some(row => row.direction === 'supports' && row.sources?.length)))
    if (item.domain === 'safety' ? positiveSafety : !therapy) return item
    const reconcileEvidence = (entries: typeof item.patientEvidence) => entries.map(entry => !entry.sources?.length ? { ...entry, value: message } : entry)
    const evidenceTables = item.evidenceTables?.map(table => {
      const items = table.items.map(row => row.direction === 'against' && !row.sources?.length
        ? { ...row, direction: 'unknown' as const, defaultEnabled: false, value: message } : row)
      const enabled = items.filter(row => profile.evidenceOverrides?.[row.id] ?? row.defaultEnabled)
      return { ...table, items, supportsCount: enabled.filter(row => row.direction === 'supports').length,
        againstCount: enabled.filter(row => row.direction === 'against').length, unknownCount: items.filter(row => row.direction === 'unknown').length }
    })
    return { ...item, patientEvidence: reconcileEvidence(item.patientEvidence), evidenceTables, status: 'needs-data', visitDecision: undefined,
      title: label + (item.moduleName ? ': ' + item.moduleName : ''), recommendation: message, rationale: message, nextActions: [message],
      missingData: [...new Set([...(item.missingData ?? []), label])],
      clinicalReviewItems: [...new Set([...(item.clinicalReviewItems ?? []), label])],
      ...(item.semanticRule ? { semanticRule: { ...item.semanticRule, patientData: reconcileEvidence(item.semanticRule.patientData), decisionLogic: message, clinicalConclusion: message } } : {}) }
  }
  return { ...result, recommendations: result.recommendations.map(adapt), automatedChecks: result.automatedChecks?.map(check => {
    if (!check.recommendation) return check
    const recommendation = adapt(check.recommendation)
    return recommendation === check.recommendation ? check : { ...check, label: recommendation.title, value: recommendation.recommendation, recommendation }
  }) }
}

export function applyHospitalMedicationReview(
  result: CdssResult, profile: HospitalAwareCdssProfile, locale: CdssLocale,
): CdssResult {
  const excluded = profile.excludedClinicalRecordVariants?.filter(item => item.resourceType === 'MedicationRequest' || item.resourceType === 'MedicationStatement') ?? []
  const variantSources: CdssFactSource[] = excluded.map(item => ({ resourceType: item.resourceType as CdssFactSource['resourceType'], resourceId: item.resourceId ?? item.sourceId ?? '' }))
  const evidence = profile.hospitalMedicationEvidence ?? []
  const pendingEvidence = evidence.filter(isPendingHospitalMedication)
  const unresolved = evidence.filter((entry) => !entry.ingredientName
    && (entry.useState === 'confirmed-current' || isPendingHospitalMedication(entry)))
  const pending = Object.entries(profile.medicationClassContexts ?? {}).filter(([, context]) =>
    context?.state === 'active-order-unconfirmed' || context?.state === 'historical-record-current-status-unknown'
      || (context?.state === 'uncertain' && (unresolved.length > 0 || excluded.length > 0)))
  // AF's DOAC/VKA regimens have no medication class context.
  if (!excluded.length && (!evidence.length || (!pending.length && !pendingEvidence.length && !unresolved.length))) return result
  const pendingClasses = new Set(pending.map(([classId]) => classId))
  const pendingKeys = new Set(pending.map(([, context]) => context!.factKey))
  const sourceKey = (source: CdssFactSource) => `${source.resourceType}:${source.resourceId}`
  const pendingSources = new Set(pendingEvidence.map((entry) => sourceKey(entry.source)))
  for (const [key, fact] of Object.entries(profile.facts)) {
    if (fact.sources?.some((source) => pendingSources.has(sourceKey(source)))) pendingKeys.add(key)
  }
  if (unresolved.length || excluded.length) for (const key of HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS) pendingKeys.add(key)
  const english = locale === 'en'
  const label = english ? 'Confirm current medication use' : '核對目前用藥'
  const message = excluded.length ? english
    ? 'Medication source records have unresolved versions or conflicts. Reconcile actual use and dose before deciding a medicine is absent, starting it, or increasing it; other verified evidence remains available.'
    : '來源用藥有未決版本或衝突，判定未使用、開始或加量前需核對實際用藥與劑量；其他已確認證據仍可使用。'
    : english
    ? 'Hospital prescriptions may still be in use. Confirm actual use, dose, and stop/hold status before starting or increasing medication; possible exposure remains included in safety checks.'
    : '院內處方仍可能正在使用。開始或加量前，先核對實際用藥、劑量與停藥／暫停狀態；安全判讀持續納入可能的用藥暴露。'

  const adapt = (item: CdssRecommendation): CdssRecommendation => {
    let changedTable = false
    const evidenceTables = item.evidenceTables?.map((table) => {
      const items = table.items.map((row) => {
        const classId = HARMFUL_ROWS[row.id]
        const matching = classId && pendingClasses.has(classId)
          ? profile.medicationClassContexts?.[classId]?.state === 'uncertain' ? unresolved
            : pendingEvidence.filter((entry) => entry.classIds.includes(classId))
          : []
        const sourceMatches = pendingEvidence.filter((entry) => row.sources?.some((source) => sourceKey(source) === sourceKey(entry.source)))
        const incompleteMedicationRow = (unresolved.length > 0 || excluded.length > 0) && row.category === 'medication'
          && (row.direction === 'against' || row.direction === 'unknown' || (excluded.length > 0 && (!row.sources?.length || row.sources.every(source => variantSources.some(variant => sourceKey(source) === sourceKey(variant))))))
        if (!matching.length && !sourceMatches.length && !incompleteMedicationRow) return row
        changedTable = true
        const sources = matching.length ? matching : sourceMatches
        const names = [...new Set(sources.map((entry) => entry.ingredientName
          || entry.name.recordedGenericName || entry.name.recordedProductName).filter(Boolean))]
        // Positive native safety evidence is a possible exposure, not a negative
        // finding. Keep its direction and physician override so alerts survive.
        const possibleSafetyExposure = item.domain === 'safety' && row.direction === 'supports'
          && (matching.length > 0 || sourceMatches.length > 0)
        const useLabel = english ? `Current use needs confirmation${names.length ? `: ${names.join(', ')}` : ''}`
          : `目前使用待確認${names.length ? `：${names.join('、')}` : ''}`
        const rowSources = [...new Map([...(row.sources ?? []), ...sources.map((entry) => entry.source), ...(incompleteMedicationRow ? variantSources : [])]
          .map((source) => [sourceKey(source), source])).values()]
        return { ...row,
          direction: possibleSafetyExposure ? row.direction : 'unknown' as const,
          defaultEnabled: possibleSafetyExposure ? row.defaultEnabled : false,
          value: possibleSafetyExposure ? [row.value, useLabel].filter(Boolean).join(english ? '; ' : '；')
            : incompleteMedicationRow && !sources.length
            ? excluded.length ? english ? 'Unresolved source-record variants; reconcile medications first' : '來源用藥版本或衝突未釐清，需先核對用藥'
              : english ? 'Unresolved hospital ingredients; reconcile medications first' : '院內成分未確認，需先核對用藥'
            : english ? `Current use needs confirmation${names.length ? `: ${names.join(', ')}` : ''}`
              : `目前使用待確認${names.length ? `：${names.join('、')}` : ''}`,
          sources: rowSources.length ? rowSources : row.sources,
        }
      })
      if (items.every((row, index) => row === table.items[index])) return table
      const enabled = items.filter((row) => profile.evidenceOverrides?.[row.id] ?? row.defaultEnabled)
      return { ...table, items,
        supportsCount: enabled.filter((row) => row.direction === 'supports').length,
        againstCount: enabled.filter((row) => row.direction === 'against').length,
        unknownCount: items.filter((row) => row.direction === 'unknown').length,
      }
    })
    const affected = changedTable || (item.overviewEvidenceFactKey && pendingKeys.has(item.overviewEvidenceFactKey)) || item.patientEvidence.some((entry) => entry.factKeys.some((key) => pendingKeys.has(key)))
    if (!affected) return item
    const reconcileEvidence = (entries: typeof item.patientEvidence) => entries.map(entry => excluded.length && entry.factKeys.some(key => pendingKeys.has(key))
      ? { ...entry, value: message, sources: [...(entry.sources ?? []), ...variantSources] } : entry)
    const patientEvidence = reconcileEvidence(item.patientEvidence)
    const semanticRule = excluded.length && item.semanticRule ? { ...item.semanticRule,
      patientData: reconcileEvidence(item.semanticRule.patientData), decisionLogic: message, clinicalConclusion: message,
    } : item.semanticRule
    // MRA hyperkalemia and AF interaction/dose checks need no evidence table to
    // be valid safety findings. Never downgrade their native status/priority.
    if (item.domain === 'safety' && (item.status === 'actionable' || item.status === 'review')) return { ...item, evidenceTables, patientEvidence, semanticRule,
      recommendation: `${item.recommendation} ${message}`,
      ...(item.visitDecision?.actions.some((action) => action.decisionKind === 'prescribed' || action.decisionKind === 'dose-adjusted')
        ? { visitDecision: undefined } : {}),
      nextActions: [...item.nextActions, message],
      clinicalReviewItems: [...new Set([...(item.clinicalReviewItems ?? []), label])],
    }
    // Maps read visitDecision first. Remove start/titrate actions based on
    // unconfirmed use and retain reconciliation in every layout/copy output.
    return { ...item, evidenceTables, patientEvidence, semanticRule, status: 'needs-data', visitDecision: undefined,
      title: `${label}${english ? ': ' : '：'}${item.moduleName || item.title}`,
      recommendation: message, rationale: message, nextActions: [message],
      missingData: [...new Set([...(item.missingData ?? []), label])],
      clinicalReviewItems: [...new Set([...(item.clinicalReviewItems ?? []), label])],
    }
  }
  return { ...result,
    recommendations: result.recommendations.map(adapt),
    automatedChecks: result.automatedChecks?.map((check) => {
      if (!check.recommendation) return check
      const recommendation = adapt(check.recommendation)
      return recommendation === check.recommendation ? check
        : { ...check, label: recommendation.title, value: recommendation.recommendation, recommendation }
    }),
  }
}
