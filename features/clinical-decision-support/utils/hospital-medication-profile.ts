import {
  classifyCurrentMedications,
  createFhirCdssPatientProfile,
  type FhirCdssProfileInput,
  type HostMedication,
} from '@voho0000/personalized-care-fhir'
import type { CdssFactSource, CdssMedicationClassId, CdssPatientProfile } from '../types'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import {
  resolveHospitalMedicationName,
  type HospitalMedicationName,
} from '@/src/shared/utils/hospital-medication-names'

export type HospitalMedicationUseState =
  | 'confirmed-current' | 'active-order-unconfirmed'
  | 'historical-record-current-status-unknown' | 'on-hold' | 'not-current'

export interface HospitalMedicationEvidence {
  /** Same minimal citation shape as other CDSS facts; never a raw resource. */
  source: CdssFactSource
  fromOfficialTerminology: boolean
  name: HospitalMedicationName
  useState: HospitalMedicationUseState
  ingredientName?: string
  classIds: readonly CdssMedicationClassId[]
  factKey: string
}

type AfMedicationRegimen = NonNullable<CdssPatientProfile['afMedicationRegimens']>[number]

/** Anticoagulation the record shows only through unconfirmed hospital prescriptions. */
export interface HospitalUnconfirmedAnticoagulation {
  /** The DOAC/VKA regimens that rest only on those prescriptions, in profile order. */
  regimens: readonly AfMedicationRegimen[]
  /** The prescriptions themselves, as cited everywhere else. */
  sources: readonly CdssFactSource[]
}

export type HospitalAwareCdssProfile = CdssPatientProfile & {
  hospitalMedicationEvidence?: readonly HospitalMedicationEvidence[]
  hospitalMedicationPolicyVersion?: string
  /** Classes with an unconfirmed prescription: eligible for safety exposure checks. */
  hospitalMedicationPossibleExposureClasses?: readonly CdssMedicationClassId[]
  /**
   * Present when every anticoagulant on the profile comes from an unconfirmed
   * hospital prescription. Safety checks read `afMedicationRegimens` as possible
   * exposure; the decision map must keep 「要不要抗凝」 待核對 rather than read
   * the same regimen as a settled anticoagulation decision.
   */
  hospitalMedicationUnconfirmedAnticoagulation?: HospitalUnconfirmedAnticoagulation
}

export const HOSPITAL_MEDICATION_POLICY_VERSION = 'vgh-cdss-medications-20261001-v2'

/** Native exposure facts used outside medication class contexts, including AF. */
export const HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS = [
  'currentNsaid', 'currentPotentialHfWorseningMedication',
  'currentHyperkalemiaRiskMedication', 'currentPotentialNephrotoxin',
  'currentDoac', 'currentVitaminKAntagonist', 'currentOralAnticoagulant',
  'currentAntiplatelet', 'medicationListOverview',
] as const

export function isPendingHospitalMedication(item: HospitalMedicationEvidence): boolean {
  return item.useState === 'active-order-unconfirmed'
    || item.useState === 'historical-record-current-status-unknown'
}

/** The native pack's exposure checks require a positive class state. This
 * evaluation-only projection keeps possible exposures visible to those checks;
 * the returned result is reconciled before rendering. The source profile still
 * distinguishes unconfirmed use, and therapeutic decisions cannot start/titrate
 * a drug from this projection alone. It carries no raw medication resources. */
export function createHospitalMedicationEvaluationProfile(profile: HospitalAwareCdssProfile): CdssPatientProfile {
  if (!profile.hospitalMedicationPossibleExposureClasses?.length) return profile
  const medicationClassContexts = { ...profile.medicationClassContexts }
  for (const classId of profile.hospitalMedicationPossibleExposureClasses) {
    const context = medicationClassContexts[classId]
    if (context) medicationClassContexts[classId] = { ...context, state: 'confirmed-current' }
  }
  return { ...profile, medicationClassContexts }
}

const EXCLUDED = new Set(['cancelled', 'entered-in-error'])
const NOT_CURRENT = new Set(['stopped', 'completed', 'not-taken'])

/** The AF regimen ingredients the visit map counts as anticoagulation (DOACs and warfarin). */
const ANTICOAGULANT_INGREDIENTS = new Set(['apixaban', 'dabigatran', 'edoxaban', 'rivaroxaban', 'warfarin'])
const isAnticoagulantRegimen = (regimen: AfMedicationRegimen) => ANTICOAGULANT_INGREDIENTS.has(regimen.ingredient)

/** What the AF visit map reads as 「已抗凝」: an anticoagulant regimen, a current DOAC/VKA class, or a VKA fact. */
function anticoagulationOnProfile(profile: Pick<CdssPatientProfile, 'afMedicationRegimens' | 'medicationClassContexts' | 'facts'>): boolean {
  return Boolean(profile.afMedicationRegimens?.some(isAnticoagulantRegimen))
    || (['direct-oral-anticoagulant', 'vitamin-k-antagonist'] as CdssMedicationClassId[])
      .some((classId) => profile.medicationClassContexts?.[classId]?.state === 'confirmed-current')
    || Boolean(profile.facts.currentVitaminKAntagonist)
}

const ANTICOAGULANT_FACT_KEYS = ['currentDoac', 'currentVitaminKAntagonist', 'currentOralAnticoagulant'] as const

/** A validityPeriod is a dispensing window, not evidence of taking a drug.
 * https://hl7.org/fhir/R4/medicationrequest-definitions.html#MedicationRequest.dispenseRequest.validityPeriod
 * No arbitrary age cutoff or cloud-prescription grace period is applied to an
 * EHR order. An explicit active MedicationStatement can confirm current use. */
function hospitalUseState(medication: MedicationEntity, now: Date): HospitalMedicationUseState {
  const status = medication.status?.trim().toLowerCase() ?? ''
  if (EXCLUDED.has(status) || NOT_CURRENT.has(status)) return 'not-current'
  if (status === 'on-hold') return 'on-hold'
  const written = Date.parse(medication.authoredOn ?? '')
  const future = Number.isFinite(written) && written > now.getTime()
  if (medication._sourceResourceType === 'MedicationStatement' && status === 'active' && !future) {
    return 'confirmed-current'
  }
  const end = Date.parse(medication.dispenseRequest?.validityPeriod?.end ?? '')
  return Number.isFinite(end) && end < now.getTime()
    ? 'historical-record-current-status-unknown'
    : 'active-order-unconfirmed'
}

function sourceFor(medication: MedicationEntity, ingredientName?: string): CdssFactSource {
  const rawName = medication.medicationCodeableConcept?.text
    || medication.medicationCodeableConcept?.coding?.find((coding) => coding.display)?.display
    || medication.medicationReference?.display || '未命名藥物'
  return {
    resourceType: medication._sourceResourceType ?? 'MedicationRequest',
    resourceId: medication.id,
    date: medication.authoredOn?.slice(0, 10),
    status: medication.status,
    value: ingredientName ? `${ingredientName} (${rawName})` : rawName,
    coding: medication.medicationCodeableConcept?.coding,
    facility: medication._sourceResourceType === 'MedicationStatement'
      ? medication.informationSource?.display : medication.requester?.display,
    sourceSystem: medication.sourceSystem,
  }
}

export function hospitalMedicationUseLabel(state: HospitalMedicationUseState, english = false): string {
  const labels: Record<HospitalMedicationUseState, [string, string]> = {
    'confirmed-current': ['用藥清單確認使用中', 'Current use documented in a medication statement'],
    'active-order-unconfirmed': ['有開立紀錄，目前使用待確認', 'Prescription recorded; current use needs confirmation'],
    'historical-record-current-status-unknown': ['歷史處方，目前使用待確認', 'Historical prescription; current use needs confirmation'],
    'on-hold': ['來源標示暫停中', 'On hold in the source record'],
    'not-current': ['來源標示已結束／停用', 'Ended or stopped in the source record'],
  }
  return labels[state][english ? 1 : 0]
}

/** CDSS-only copies. Nothing here changes imported resources, medication rows,
 * grouping, the official NHI terminology, or the patient's original status. */
export function createHospitalAwareCdssPatientProfile(
  input: Omit<FhirCdssProfileInput, 'medications'> & { medications: MedicationEntity[] },
): HospitalAwareCdssProfile {
  const now = input.now ?? new Date()
  const evidence: HospitalMedicationEvidence[] = []
  const internalStatuses = new Map<string, string | undefined>()
  const internalUseStates = new Map<string, HospitalMedicationUseState>()
  const medications = input.medications.map((source, index): HostMedication => {
    const name = resolveHospitalMedicationName(source.medicationCodeableConcept)
    if (!name) return source
    const useState = hospitalUseState(source, now)
    const ingredientName = source.drugTerminology?.ingredientText
      || (name.status === 'normalized' ? name.ingredientName : undefined)
    // HostMedication accepts an ingredient-only input. Do not manufacture the
    // official master source, a snapshot, an NHI product code, or an ATC code.
    const normalized: HostMedication = ingredientName && !source.drugTerminology
      ? { ...source, drugTerminology: { ingredientText: ingredientName } }
      : { ...source }
    if (useState !== 'confirmed-current' && useState !== 'on-hold'
      && !EXCLUDED.has(source.status?.trim().toLowerCase() ?? '')) {
      // The released cloud adapter promotes active orders (and recently
      // completed supplies) to current use. Quarantine this CDSS-only copy from
      // that shortcut while keeping its prescription history available. Facts
      // below restore the real source status and express the EHR uncertainty.
      // A unique non-current marker lets the native timeline preserve record
      // identity even when names and dates coincide. Restore it everywhere
      // before exposing the profile; this is never an imported FHIR status.
      const internalStatus = `draft:mediprisma-hospital:${index}`
      internalStatuses.set(internalStatus, source.status?.trim().toLowerCase() || undefined)
      internalUseStates.set(internalStatus, useState)
      normalized.status = internalStatus
    }
    const classIds = [...new Set(classifyCurrentMedications([normalized], now).classified.map((item) => item.classId))]
    evidence.push({ source: sourceFor(source, ingredientName), fromOfficialTerminology: Boolean(source.drugTerminology),
      name, useState, ingredientName, classIds, factKey: `hospitalMedication:${source._sourceResourceType ?? 'MedicationRequest'}:${source.id}` })
    return normalized
  })
  const profile = createFhirCdssPatientProfile({ ...input, medications, now })
  if (!evidence.length) return profile

  const facts = { ...profile.facts }
  const contexts = { ...profile.medicationClassContexts }
  // Restore status through the per-record marker, without ambiguous name/date
  // matching or rerunning the native adapter with a different current-use set.
  const restoreTimelineStatus = <T extends { status?: string }>(record: T): T =>
    internalStatuses.has(record.status ?? '')
      ? { ...record, status: internalStatuses.get(record.status ?? '') } : record
  for (const [classId, context] of Object.entries(contexts)) {
    if (!context) continue
    contexts[classId as CdssMedicationClassId] = { ...context,
      prescriptions: context.prescriptions?.map(restoreTimelineStatus),
      undatedPrescriptions: context.undatedPrescriptions?.map(restoreTimelineStatus),
    }
  }
  // Dedicated native medication contexts (for example Forxiga coverage) also
  // carry a status. Restore it and keep their actual use explicitly unconfirmed.
  const medicationContexts = profile.medicationContexts && Object.fromEntries(
    Object.entries(profile.medicationContexts).map(([key, context]) => {
      const state = internalUseStates.get(context.status ?? '')
      return [key, { ...restoreTimelineStatus(context),
        ...(state ? { useState: state === 'not-current' ? 'not_current' as const : 'active_order_unconfirmed' as const } : {}),
      }]
    }),
  )
  const byId = new Map(evidence.map((item) => [`${item.source.resourceType}:${item.source.resourceId}`, item]))
  // The class matcher read derived ingredient evidence; citations continue to
  // carry the original resource identity, coding, date, and status.
  for (const [key, fact] of Object.entries(facts)) {
    if (fact.sources?.length) facts[key] = {
      ...fact, sources: fact.sources.map((source) => {
        const item = byId.get(`${source.resourceType}:${source.resourceId}`)
        return item ? item.source : source
      }),
    }
  }
  for (const item of evidence) {
    if (EXCLUDED.has(item.source.status?.trim().toLowerCase() ?? '')) continue
    const originZh = item.fromOfficialTerminology ? '健保藥品主檔'
      : item.name.source === 'verified-product-alias' ? '已查證商品成分對照' : '來源藥名明列成分'
    const originEn = item.fromOfficialTerminology ? 'Official NHI drug master'
      : item.name.source === 'verified-product-alias' ? 'Verified product ingredient alias' : 'Ingredient stated in the source name'
    const name = item.ingredientName || item.name.productName || '未命名藥物'
    facts[item.factKey] = {
      zh: `${name}；${hospitalMedicationUseLabel(item.useState)}；${item.ingredientName ? originZh : '成分未確認'}（${item.name.version}）`,
      en: `${name}; ${hospitalMedicationUseLabel(item.useState, true)}; ${item.ingredientName ? originEn : 'Ingredient unresolved'} (${item.name.version})`,
      date: item.source.date,
      sources: [item.source],
    }
  }
  const uncertain = evidence.filter((item) => item.useState === 'active-order-unconfirmed'
    || item.useState === 'historical-record-current-status-unknown')
  const confirmedHypoglycemiaClass = ['insulin', 'sulfonylurea'].some((classId) => {
    const state = contexts[classId as CdssMedicationClassId]?.state
    return state === 'confirmed-current' || state === 'on-hold'
  })
  for (const classId of new Set(uncertain.flatMap((item) => item.classIds))) {
    const context = contexts[classId]
    if (!context || context.state === 'confirmed-current' || context.state === 'on-hold') continue
    const matching = uncertain.filter((item) => item.classIds.includes(classId))
    const names = [...new Set(matching.map((item) => item.ingredientName || item.name.productName || '未命名藥物'))]
    // Use the explicit uncertainty states rather than collapsing an EHR order
    // into the national cloud adapter's two-state prescription model.
    contexts[classId] = { ...context,
      state: matching.some((item) => item.useState === 'active-order-unconfirmed')
        ? 'active-order-unconfirmed' : 'historical-record-current-status-unknown',
      medicationNames: names,
    }
    // Keep the use-state fact separate from the native possible-exposure facts.
    // A prescription cannot establish actual use, nor a negative safety finding.
    const factKey = context.factKey.startsWith('hfHarmful') ? `hospitalMedicationClass:${classId}` : context.factKey
    if (factKey === 'hypoglycemiaRiskMedications' && confirmedHypoglycemiaClass) continue
    facts[factKey] = {
      zh: `院內處方：${names.join('、')}；目前使用待確認`,
      en: `Hospital prescription: ${names.join(', ')}; current use needs confirmation`,
      sources: matching.map((item) => item.source),
    }
  }
  const unresolved = evidence.filter((item) => !item.ingredientName
    && (item.useState === 'confirmed-current' || item.useState === 'active-order-unconfirmed'
      || item.useState === 'historical-record-current-status-unknown'))
  // An unresolved EHR ingredient cannot establish a negative class finding.
  // Keep known current/held classes intact and expose the incomplete inventory.
  if (unresolved.length) for (const [classId, context] of Object.entries(contexts)) {
    if (!context || context.state !== 'not-found') continue
    contexts[classId as CdssMedicationClassId] = { ...context, state: 'uncertain' }
    if (!context.factKey.startsWith('hfHarmful')
      && !(context.factKey === 'hypoglycemiaRiskMedications' && confirmedHypoglycemiaClass)) facts[context.factKey] = {
      zh: '院內藥物成分辨識不完整，目前用藥需核對',
      en: 'Hospital ingredient mapping is incomplete; reconcile current medications',
      sources: unresolved.map((item) => item.source),
    }
  }
  if (unresolved.length && ['insulin', 'sulfonylurea'].every((classId) => {
    const state = contexts[classId as CdssMedicationClassId]?.state
    return state !== 'confirmed-current' && state !== 'on-hold'
  })) facts.hypoglycemiaRiskMedications = {
    zh: '院內藥物成分辨識不完整，無法確認是否使用胰島素或磺醯脲',
    en: 'Hospital ingredient mapping is incomplete; insulin or sulfonylurea use cannot be determined',
    sources: unresolved.map((item) => item.source),
  }
  // Do not erase prescriptions from direct exposure derivations (AF regimens,
  // NSAIDs, potassium/renal risks, antiplatelets, and the medication inventory).
  // Ended/cancelled hospital records stay excluded. Only unconfirmed records
  // enter this second native pass as possible exposure, never as actual use.
  const pendingById = new Set(uncertain.filter((item) => {
    const status = item.source.status?.trim().toLowerCase() ?? ''
    return status === 'active' || status === 'unknown' || status === ''
  }).map((item) => `${item.source.resourceType}:${item.source.resourceId}`))
  const exposureProfile = uncertain.length ? createFhirCdssPatientProfile({ ...input, now,
    medications: medications.map((item) => pendingById.has(`${item._sourceResourceType ?? 'MedicationRequest'}:${item.id}`)
      ? { ...item, status: 'active' } : item),
  }) : profile
  const restoreSource = (source: CdssFactSource): CdssFactSource =>
    byId.get(`${source.resourceType}:${source.resourceId}`)?.source ?? source
  const exposureKeys = [...HOSPITAL_MEDICATION_EXPOSURE_FACT_KEYS,
    ...Object.keys(exposureProfile.facts).filter((key) => key.startsWith('hfHarmful'))]
  for (const key of exposureKeys) {
    const fact = exposureProfile.facts[key]
    if (!fact) continue
    const pendingSources = fact.sources?.filter((source) => pendingById.has(`${source.resourceType}:${source.resourceId}`)) ?? []
    facts[key] = { ...fact, sources: fact.sources?.map(restoreSource),
      ...(pendingSources.length ? {
        zh: `用藥暴露紀錄（院內使用待確認）：${fact.zh}`,
        en: `Medication exposure record (hospital use unconfirmed): ${fact.en}`,
      } : {}),
    }
  }
  const possibleExposureClasses = [...new Set(uncertain.flatMap((item) => item.classIds))]
    .filter((classId) => exposureProfile.medicationClassContexts?.[classId]?.state === 'confirmed-current'
      && contexts[classId]?.state !== 'confirmed-current' && contexts[classId]?.state !== 'on-hold')
  const isPending = (source: CdssFactSource) => pendingById.has(`${source.resourceType}:${source.resourceId}`)
  const pendingOnly = (regimen: AfMedicationRegimen) => regimen.sources.length > 0 && regimen.sources.every(isPending)
  // Regimens with a confirmed source first: wherever one regimen names the
  // patient's anticoagulant, it is a confirmed one, not a pending order's.
  const afMedicationRegimens = exposureProfile.afMedicationRegimens
    && [...exposureProfile.afMedicationRegimens]
      .sort((a, b) => Number(pendingOnly(a)) - Number(pendingOnly(b)))
      .map((regimen) => ({ ...regimen, sources: regimen.sources.map(restoreSource) }))
  // The decision map reads any anticoagulant regimen as a settled decision
  // (「已抗凝」, DP-07 已定). Name the anticoagulation that rests only on
  // unconfirmed hospital prescriptions so the map keeps it 待核對; the regimens
  // stay on the profile for interaction, dose and bleeding checks.
  // Only pending records differ between the two passes, so an anticoagulant
  // that the confirmed pass lacks rests on unconfirmed prescriptions alone.
  const anticoagulantRegimens = (afMedicationRegimens ?? []).filter(isAnticoagulantRegimen)
  const unconfirmedAnticoagulation = !anticoagulationOnProfile(profile)
    && anticoagulationOnProfile({ afMedicationRegimens, medicationClassContexts: contexts, facts })
    ? {
        regimens: anticoagulantRegimens,
        sources: [...new Map([
          ...anticoagulantRegimens.flatMap((regimen) => regimen.sources),
          ...ANTICOAGULANT_FACT_KEYS.flatMap((key) => facts[key]?.sources ?? []),
        ].filter(isPending).map((source) => [`${source.resourceType}:${source.resourceId}`, source])).values()],
      }
    : undefined
  return { ...profile, facts, medicationContexts, medicationClassContexts: contexts, hospitalMedicationEvidence: evidence,
    hospitalMedicationPolicyVersion: HOSPITAL_MEDICATION_POLICY_VERSION,
    hospitalMedicationPossibleExposureClasses: possibleExposureClasses, afMedicationRegimens,
    ...(unconfirmedAnticoagulation ? { hospitalMedicationUnconfirmedAnticoagulation: unconfirmedAnticoagulation } : {}) }
}
