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

/** Every quarantined non-medication decision input can affect eligibility or
 * contraindications, including document narratives and care plans. Medication
 * uncertainty has its own review below. Preserve verified safety results. */
export function applyUnresolvedRecordTherapyReview(result: CdssResult, profile: HospitalAwareCdssProfile, locale: CdssLocale): CdssResult {
  const unresolved = profile.excludedClinicalRecordVariants?.filter(item => !['MedicationRequest', 'MedicationStatement'].includes(item.resourceType)) ?? []
  if (!unresolved.length) return result
  const label = locale === 'en' ? 'Clinical content unavailable' : '臨床內容未提供'
  const message = locale === 'en'
    ? 'Clinical content is unavailable for some eligibility or contraindication facts; verified safety evidence remains available.'
    : '部分適用條件或禁忌缺少臨床內容，已確認的安全證據仍可使用。'
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
      title: label + (item.moduleName ? ': ' + item.moduleName : ''), recommendation: message, rationale: message, nextActions: [],
      missingData: item.missingData,
      clinicalReviewItems: item.clinicalReviewItems,
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
  const contents = profile.unresolvedClinicalMedicationContents ?? []
  const unresolvedRecordCount = excluded.length + contents.length
  const variantSources: CdssFactSource[] = excluded.map(item => ({ resourceType: item.resourceType as CdssFactSource['resourceType'], resourceId: item.resourceId ?? item.sourceId ?? '' })).concat(contents.map(item => item.source))
  const evidence = profile.hospitalMedicationEvidence ?? []
  const pendingEvidence = evidence.filter(isPendingHospitalMedication)
  const unresolved = evidence.filter((entry) => !entry.ingredientName
    && (entry.useState === 'confirmed-current' || isPendingHospitalMedication(entry)))
  const pending = Object.entries(profile.medicationClassContexts ?? {}).filter(([, context]) =>
    context?.state === 'active-order-unconfirmed' || context?.state === 'historical-record-current-status-unknown'
      || (context?.state === 'uncertain' && (unresolved.length > 0 || unresolvedRecordCount > 0)))
  // AF's DOAC/VKA regimens have no medication class context.
  if (!unresolvedRecordCount && (!evidence.length || (!pending.length && !pendingEvidence.length && !unresolved.length))) return result
  const pendingClasses = new Set(pending.map(([classId]) => classId))
  const pendingKeys = new Set(pending.map(([, context]) => context!.factKey))
  const sourceKey = (source: CdssFactSource) => `${source.resourceType}:${source.resourceId}`
  const pendingSources = new Set(pendingEvidence.map((entry) => sourceKey(entry.source)))
  for (const [key, fact] of Object.entries(profile.facts)) {
    if (fact.sources?.some((source) => pendingSources.has(sourceKey(source)))) pendingKeys.add(key)
  }
  if (unresolved.length || unresolvedRecordCount) for (const key of HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS) pendingKeys.add(key)
  const english = locale === 'en'
  const label = english ? 'Hospital medication record' : '院內用藥紀錄'
  const message = unresolvedRecordCount ? english
    ? 'Medication content is unavailable. Available records remain included in safety checks; missing ingredients or doses are not inferred.'
    : '藥品內容未提供。系統依可用紀錄進行安全判讀，不推定缺少的成分、劑量或未用藥。'
    : english
    ? 'Hospital prescription status is not fully recorded. Available prescription facts remain included in medication and safety assessment; missing use status is not inferred.'
    : '院內處方未完整記載使用狀態。系統已依可用處方內容進行用藥與安全判讀，不推定缺少的使用狀態。'

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
        const incompleteMedicationRow = (unresolved.length > 0 || unresolvedRecordCount > 0) && row.category === 'medication'
          && (row.direction === 'against' || row.direction === 'unknown' || (unresolvedRecordCount > 0 && (!row.sources?.length || row.sources.every(source => variantSources.some(variant => sourceKey(source) === sourceKey(variant))))))
        if (!matching.length && !sourceMatches.length && !incompleteMedicationRow) return row
        changedTable = true
        const sources = matching.length ? matching : sourceMatches
        const names = [...new Set(sources.map((entry) => entry.ingredientName
          || entry.name.recordedGenericName || entry.name.recordedProductName).filter(Boolean))]
        // Positive native safety evidence is a possible exposure, not a negative
        // finding. Keep its direction and physician override so alerts survive.
        const possibleSafetyExposure = item.domain === 'safety' && row.direction === 'supports'
          && (matching.length > 0 || sourceMatches.length > 0)
        const useLabel = english ? `Hospital prescription record${names.length ? `: ${names.join(', ')}` : ''}`
          : `院內處方紀錄${names.length ? `：${names.join('、')}` : ''}`
        const rowSources = [...new Map([...(row.sources ?? []), ...sources.map((entry) => entry.source), ...(incompleteMedicationRow ? variantSources : [])]
          .map((source) => [sourceKey(source), source])).values()]
        return { ...row,
          direction: possibleSafetyExposure ? row.direction : 'unknown' as const,
          defaultEnabled: possibleSafetyExposure ? row.defaultEnabled : false,
          value: possibleSafetyExposure ? [row.value, useLabel].filter(Boolean).join(english ? '; ' : '；')
            : incompleteMedicationRow && !sources.length
            ? unresolvedRecordCount ? english ? 'Medication content unavailable' : '藥品內容未提供'
              : english ? 'Hospital ingredient not recorded' : '院內紀錄未提供成分'
            : english ? `Hospital prescription record${names.length ? `: ${names.join(', ')}` : ''}`
              : `院內處方紀錄${names.length ? `：${names.join('、')}` : ''}`,
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
    const reconcileEvidence = (entries: typeof item.patientEvidence) => entries.map(entry => unresolvedRecordCount && entry.factKeys.some(key => pendingKeys.has(key))
      ? { ...entry, value: message, sources: [...(entry.sources ?? []), ...variantSources] } : entry)
    const patientEvidence = reconcileEvidence(item.patientEvidence)
    const semanticRule = unresolvedRecordCount && item.semanticRule ? { ...item.semanticRule,
      patientData: reconcileEvidence(item.semanticRule.patientData), decisionLogic: message, clinicalConclusion: message,
    } : item.semanticRule
    // MRA hyperkalemia and AF interaction/dose checks need no evidence table to
    // be valid safety findings. Never downgrade their native status/priority.
    if (item.domain === 'safety' && (item.status === 'actionable' || item.status === 'review')) return { ...item, evidenceTables, patientEvidence, semanticRule,
      recommendation: `${item.recommendation} ${message}`,
      ...(item.visitDecision?.actions.some((action) => action.decisionKind === 'prescribed' || action.decisionKind === 'dose-adjusted')
        ? { visitDecision: undefined } : {}),
      nextActions: item.nextActions,
      clinicalReviewItems: item.clinicalReviewItems,
    }
    // Maps read visitDecision first. Remove start/titrate actions based on
    // unconfirmed use and retain reconciliation in every layout/copy output.
    return { ...item, evidenceTables, patientEvidence, semanticRule, status: 'needs-data', visitDecision: undefined,
      title: `${label}${english ? ': ' : '：'}${item.moduleName || item.title}`,
      recommendation: message, rationale: message, nextActions: [],
      missingData: item.missingData,
      clinicalReviewItems: item.clinicalReviewItems,
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
