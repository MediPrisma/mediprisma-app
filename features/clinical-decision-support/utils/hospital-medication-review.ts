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
  return applyHospitalMedicationReview(result, profile, locale)
}

export function applyHospitalMedicationReview(
  result: CdssResult, profile: HospitalAwareCdssProfile, locale: CdssLocale,
): CdssResult {
  const evidence = profile.hospitalMedicationEvidence ?? []
  const pendingEvidence = evidence.filter(isPendingHospitalMedication)
  const unresolved = evidence.filter((entry) => !entry.ingredientName
    && (entry.useState === 'confirmed-current' || isPendingHospitalMedication(entry)))
  const pending = Object.entries(profile.medicationClassContexts ?? {}).filter(([, context]) =>
    context?.state === 'active-order-unconfirmed' || context?.state === 'historical-record-current-status-unknown'
      || (context?.state === 'uncertain' && unresolved.length > 0))
  // AF's DOAC/VKA regimens have no medication class context.
  if (!evidence.length || (!pending.length && !pendingEvidence.length && !unresolved.length)) return result
  const pendingClasses = new Set(pending.map(([classId]) => classId))
  const pendingKeys = new Set(pending.map(([, context]) => context!.factKey))
  const sourceKey = (source: CdssFactSource) => `${source.resourceType}:${source.resourceId}`
  const pendingSources = new Set(pendingEvidence.map((entry) => sourceKey(entry.source)))
  for (const [key, fact] of Object.entries(profile.facts)) {
    if (fact.sources?.some((source) => pendingSources.has(sourceKey(source)))) pendingKeys.add(key)
  }
  if (unresolved.length) for (const key of HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS) pendingKeys.add(key)
  const english = locale === 'en'
  const label = english ? 'Confirm current medication use' : '核對目前用藥'
  const message = english
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
        const incompleteMedicationRow = unresolved.length > 0 && row.category === 'medication'
          && (row.direction === 'against' || row.direction === 'unknown')
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
        const rowSources = [...new Map([...(row.sources ?? []), ...sources.map((entry) => entry.source)]
          .map((source) => [sourceKey(source), source])).values()]
        return { ...row,
          direction: possibleSafetyExposure ? row.direction : 'unknown' as const,
          defaultEnabled: possibleSafetyExposure ? row.defaultEnabled : false,
          value: possibleSafetyExposure ? [row.value, useLabel].filter(Boolean).join(english ? '; ' : '；')
            : incompleteMedicationRow && !sources.length
            ? english ? 'Unresolved hospital ingredients; reconcile medications first' : '院內成分未確認，需先核對用藥'
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
    const affected = changedTable || item.patientEvidence.some((entry) => entry.factKeys.some((key) => pendingKeys.has(key)))
    if (!affected) return item
    // MRA hyperkalemia and AF interaction/dose checks need no evidence table to
    // be valid safety findings. Never downgrade their native status/priority.
    if (item.domain === 'safety' && (item.status === 'actionable' || item.status === 'review')) return { ...item, evidenceTables,
      recommendation: `${item.recommendation} ${message}`,
      ...(item.visitDecision?.actions.some((action) => action.decisionKind === 'prescribed' || action.decisionKind === 'dose-adjusted')
        ? { visitDecision: undefined } : {}),
      nextActions: [...item.nextActions, message],
      clinicalReviewItems: [...new Set([...(item.clinicalReviewItems ?? []), label])],
    }
    // Maps read visitDecision first. Remove start/titrate actions based on
    // unconfirmed use and retain reconciliation in every layout/copy output.
    return { ...item, evidenceTables, status: 'needs-data', visitDecision: undefined,
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
