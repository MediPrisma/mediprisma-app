import { useMemo } from "react"
import { extractEncounterIcds, type IcdCode } from "@/src/shared/utils/icd-lookup"
import {
  getEncounterChannelText,
  getEncounterKindCode,
  getEncounterKindText,
} from "@/src/shared/utils/encounter-type.utils"
import { useLanguage } from "@/src/application/providers/language.provider"
import { formatOrganizationDisplay } from "@/src/shared/utils/organization-display"
import { projectEncounterComparisons } from '@/src/shared/utils/source-record-comparison'
import { isMedcloudSource, isVghtpeSource } from '@/src/shared/utils/clinical-source-identity'
import { medicationClinicalDay } from '@/src/shared/utils/medication-calendar'

type VisitType = 'outpatient' | 'outpatient-or-emergency' | 'inpatient' | 'emergency' | 'home' | 'virtual' | 'pharmacy' | 'other'
export type VisitCareDiscipline = 'western' | 'tcm' | 'dental'

export interface VisitRecord {
  id: string
  sourceIds?: string[]
  sourceComparisonStatus?: 'candidate' | 'ambiguous' | 'confirmed'
  sourceComparisonWarnings?: string[]
  /** A North VGH visit with no cloud counterpart, in a chart that also holds
   *  cloud visits; unset when the whole chart comes from one source. */
  hospitalOnly?: boolean
  sourceRecords?: Array<{ id: string; origin?: 'hospital' | 'medcloud'; date?: string; institution?: string; department?: string; physician?: string; diagnoses: string[] }>
  type: VisitType
  /** Medical system, derived from explicit serviceType codings first. AMB only
   *  identifies an ambulatory encounter and is never evidence of western care. */
  careDiscipline: VisitCareDiscipline
  date: string
  /** Encounter.period.end — discharge date for inpatient stays; absent for
   *  single-day visits and for inpatient records with no discharge data. */
  endDate?: string
  location?: string
  institution?: string  // hospital / facility name used for filtering
  reason?: string
  /** All ICD diagnoses on the visit, in order: primary first, then secondaries. */
  icdCodes: IcdCode[]
  diagnosis?: string
  status: string
  department?: string
  physician?: string
}

/** The row already shows the hospital and cloud copies as one visit (a
 *  unique same-day, same-facility, same-ICD pair). A row that stays split, or
 *  a pair left ambiguous (e.g. WHO ICD-10 against ICD-10-CM), still asks the
 *  clinician to compare. */
export function needsSourceComparison(visit: Pick<VisitRecord, 'sourceComparisonStatus' | 'sourceIds'>): boolean {
  if (!visit.sourceComparisonStatus || visit.sourceComparisonStatus === 'confirmed') return false
  return visit.sourceComparisonStatus !== 'candidate' || (visit.sourceIds?.length ?? 0) < 2
}

const HL7_SERVICE_TYPE_SYSTEM = 'http://terminology.hl7.org/codesystem/service-type'
const SNOMED_CT_SYSTEM = 'http://snomed.info/sct'
const TW_CORE_DEPARTMENT_SYSTEMS = new Set([
  'https://twcore.mohw.gov.tw/ig/twcore/codesystem/medical-consultation-department-nhi-tw',
  'https://twcore.mohw.gov.tw/ig/twcore/codesystem/medical-treatment-department-nhi-tw',
])
// Read-only compatibility for bundles produced during the short-lived custom
// service-domain transition. New exporters must emit TW Core department #60.
const LEGACY_NHI_CLINICAL_SERVICE_DOMAIN_SYSTEM =
  'https://nhi-fhir-bridge.github.io/codesystem/clinical-service-domain'

// HL7 Service Type: Endodontic through Prosthodontic.
const HL7_DENTAL_SERVICE_CODES = new Set(['87', '88', '89', '90', '91', '92', '93', '94'])
// HL7 Service Type: Acupuncture and Chinese Herbal Medicine.
const HL7_TCM_SERVICE_CODES = new Set(['13', '18'])

// Dental specialties included by the TW Core medical-department value set.
const TW_CORE_DENTAL_SNOMED_CODES = new Set([
  '722163006', // Dentistry
  '408441001', // Endodontics
  '408461007', // Periodontics
  '394608004', // Orthodontics
  '394607009', // Pediatric dentistry
  '408465003', // Oral and maxillofacial surgery
])
const TW_CORE_DENTAL_DEPARTMENT_CODES = new Set([
  '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', 'GA',
])

function normalizeCodeSystem(system: unknown): string {
  return String(system ?? '').replace(/\/+$/, '').toLowerCase()
}

function isTwCoreDepartmentSystem(system: string): boolean {
  return TW_CORE_DEPARTMENT_SYSTEMS.has(system)
}

/**
 * NHI sources may append visit metadata to a facility display, for example
 * "臺北榮總;門診;0601160016". Visit history labels and filters only need the
 * human-readable institution name.
 */
function getInstitutionName(display: unknown, locale: string): string {
  if (typeof display !== 'string') return ''
  return formatOrganizationDisplay(display, locale)
}

function getServiceTypeConcepts(serviceType: any): any[] {
  const entries = Array.isArray(serviceType) ? serviceType : [serviceType]
  // R4 uses CodeableConcept directly. R5 uses CodeableReference, whose coded
  // form is held in `.concept`; accepting both keeps imported bundles portable.
  return entries
    .filter(Boolean)
    .map((entry: any) => entry?.concept ?? entry)
}

function localizeEncounterChannel(channel: string, locale: string): string {
  if (locale === 'zh-TW') return channel
  if (channel === 'IC卡資料') return 'NHI card data'
  if (channel === '申報資料') return 'Claims data'
  return channel
}

export function useVisitHistory(encounters: any[], icdDict?: Map<string, string>) {
  const { locale } = useLanguage()
  return useMemo<VisitRecord[]>(() => {
    if (!Array.isArray(encounters)) return []
    // Naming a visit's source only helps when the chart mixes sources.
    const mixedSources = encounters.some((encounter) => isVghtpeSource(encounter))
      && encounters.some((encounter) => isMedcloudSource(encounter) && !isVghtpeSource(encounter))

    return projectEncounterComparisons(encounters)
      .filter((encounter: any) => {
        const status = encounter.status
        // 'unknown' is included: NHI 健保存摺 IC-card inpatient stays have no
        // discharge date, so the bridge faithfully marks them status="unknown"
        // (an outpatient IC-card visit is "finished" the day it happens, but an
        // admission with no end can't be declared finished). They're still real
        // admissions — without this the visit history dropped them (4 住院 showed
        // as only 2). We still exclude voided/not-yet-happened records
        // (cancelled / entered-in-error / planned) by omission.
        return status === 'finished' || status === 'in-progress' ||
               status === 'arrived' || status === 'unknown'
      })
      .map((encounter: any) => {
        let type: VisitType = 'other'
        // Support both full-word and standard HL7 ActCode short codes (AMB, IMP, EMER…)
        const classCode = (encounter.class?.code || encounter.class?.display || '').toLowerCase()
        const reasonText = (encounter.reasonCode?.[0]?.text || '').toLowerCase()
        // NHI Taiwan may encode type in serviceType or type[].text instead of class.code
        const serviceTypeConcepts = getServiceTypeConcepts(encounter.serviceType)
        const serviceTypeCodings = serviceTypeConcepts.flatMap((concept: any) =>
          concept?.coding ?? [],
        )
        const serviceTypeDisplay = serviceTypeConcepts
          .flatMap((concept: any) => [
            concept?.text,
            ...(concept?.coding ?? []).map((coding: any) => coding?.display),
          ])
          .find(Boolean)
        const serviceTypeText = serviceTypeConcepts
          .flatMap((concept: any) => [
            concept?.text,
            ...(concept?.coding ?? []).map((coding: any) => coding?.display),
          ])
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        // Prefer the v0.9.2 kind-by-system lookup over array index — bridge
        // v0.9.1 and earlier always put kind in type[0], but FHIR R4 doesn't
        // guarantee that order, so we look it up by coding.system when
        // available and fall back to position only for legacy bundles.
        const codedKindText = getEncounterKindText(encounter)
        const kindCode = (getEncounterKindCode(encounter) || '').toLowerCase()
        const typeText = (
          codedKindText ||
          encounter.type?.[0]?.coding?.[0]?.display ||
          encounter.type?.[0]?.text ||
          ''
        ).toLowerCase()
        // Care discipline is a terminology decision: scan every coding without
        // relying on array order, display, text, or the AMB encounter class.
        const hasCodedDiscipline = (
          codings: any[],
          discipline: Exclude<VisitCareDiscipline, 'western'>,
        ) => codings.some((coding: any) => {
          const system = normalizeCodeSystem(coding?.system)
          const code = String(coding?.code ?? '').toUpperCase()

          if (system === HL7_SERVICE_TYPE_SYSTEM) {
            return discipline === 'dental'
              ? HL7_DENTAL_SERVICE_CODES.has(code)
              : discipline === 'tcm' && HL7_TCM_SERVICE_CODES.has(code)
          }
          if (system === SNOMED_CT_SYSTEM) {
            return discipline === 'dental' && TW_CORE_DENTAL_SNOMED_CODES.has(code)
          }
          if (system === LEGACY_NHI_CLINICAL_SERVICE_DOMAIN_SYSTEM) {
            return discipline === 'tcm' && code === 'TRADITIONAL-CHINESE-MEDICINE'
          }
          if (isTwCoreDepartmentSystem(system)) {
            return discipline === 'dental'
              ? TW_CORE_DENTAL_DEPARTMENT_CODES.has(code)
              : discipline === 'tcm' && code === '60'
          }
          return false
        })
        // Explicit serviceType always wins over the legacy Encounter.type kind.
        // TCM is checked before dental so the result is deterministic even for
        // a malformed CodeableConcept containing contradictory concepts.
        const serviceDiscipline: VisitCareDiscipline | undefined =
          hasCodedDiscipline(serviceTypeCodings, 'tcm')
            ? 'tcm'
            : hasCodedDiscipline(serviceTypeCodings, 'dental')
              ? 'dental'
              : undefined
        // Health Bank bridge v1.6 used explicit type codes. Retain those as a
        // read-only fallback after standard serviceType codings.
        const careDiscipline: VisitCareDiscipline =
          serviceDiscipline ?? (
            kindCode === 'tcm-outpatient'
              ? 'tcm'
              : kindCode === 'dental-outpatient'
              ? 'dental'
              : 'western'
          )
        const kindCodes = (encounter.type ?? []).flatMap((concept: any) =>
          (concept?.coding ?? []).map((coding: any) =>
            String(coding?.code ?? '').toLowerCase(),
          ),
        )

        // SDK r1 intentionally says only "門急診": AMB is a required FHIR
        // fallback, not evidence that the visit was outpatient. Detect the
        // explicit bridge kind before substring checks, otherwise "門急診"
        // is incorrectly swallowed by the emergency branch below.
        if (kindCodes.includes('outpatient-or-emergency')) {
          type = 'outpatient-or-emergency'
        }
        else if (['emer', 'emergency', 'ed'].includes(classCode) ||
            reasonText.includes('emergency') ||
            serviceTypeText.includes('急診') || typeText.includes('急診')) {
          type = 'emergency'
        }
        else if (['imp', 'inpatient', 'acute', 'ss', 'obsenc', 'prenc'].includes(classCode) ||
                 reasonText.includes('admission') || reasonText.includes('hospital') ||
                 serviceTypeText.includes('住院') || typeText.includes('住院')) {
          type = 'inpatient'
        }
        // Pharmacy refill — synthesised by synthesizePharmacyEncounters when
        // a MedicationRequest has no clinic encounter (e.g. NHI 慢箋 refills
        // dispensed at a pharmacy). Detected by the 藥局 marker in type.text;
        // must precede the generic 'AMB'→outpatient rule below since the
        // synthetic encounter uses class.code='AMB' for FHIR compliance.
        else if (typeText.includes('藥局') || serviceTypeText.includes('藥局') ||
                 classCode === 'pharm' || classCode === 'pharmacy') {
          type = 'pharmacy'
        }
        else if (['amb', 'ambulatory', 'outpatient', 'op'].includes(classCode) ||
            reasonText.includes('prenatal') || reasonText.includes('check up') || reasonText.includes('postnatal') ||
            serviceTypeText.includes('門診') || typeText.includes('門診')) {
          type = 'outpatient'
        }
        else if (['hh', 'home'].includes(classCode)) {
          type = 'home'
        }
        else if (['vr', 'virtual', 'tele'].includes(classCode)) {
          type = 'virtual'
        }
        
        const isUuid = (s: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
        const providerDisplay = getInstitutionName(encounter.serviceProvider?.display, locale)
        const locationDisplay = getInstitutionName(encounter.location?.[0]?.location?.display, locale)
        // Institution: prefer the service provider (hospital). Falls back to
        // location if the provider is missing or a raw UUID.
        const institution = (providerDisplay && !isUuid(providerDisplay))
          ? providerDisplay
          : (locationDisplay && !isUuid(locationDisplay) ? locationDisplay : '')
        const location = locationDisplay ||
                     (providerDisplay && !isUuid(providerDisplay) ? providerDisplay : '')
        
        // Extract every ICD diagnosis on the visit (primary + secondaries).
        // Falls back to reasonReference / type[].text only when no ICD codes
        // are present.
        const icdCodes = extractEncounterIcds(encounter, icdDict, locale)
        const reason = icdCodes.length > 0
          ? icdCodes.map((c) => c.description ? `${c.code} - ${c.description}` : c.code).join(', ')
          : (encounter.reasonReference?.[0]?.display || encounter.type?.[0]?.text)

        const diagnosis = encounter.diagnosis?.find((d: any) => d.rank === 1)?.condition?.display ||
                         encounter.diagnosis?.[0]?.condition?.display

        // Bridge v0.9.2 splits Encounter.type into two self-describing
        // CodeableConcepts (kind + channel) — see bridge integration
        // doc 2026-05-27. We look up the channel by coding.system rather
        // than relying on array order, since FHIR doesn't guarantee one.
        // When the channel entry is missing (pre-v0.9.2 bundles), fall
        // back to the legacy single-entry text and strip out kind words
        // so the subtitle adds info instead of duplicating the type tag.
        const v092Channel = getEncounterChannelText(encounter)
        let department = v092Channel ||
                        encounter.type?.[0]?.coding?.[0]?.display ||
                        encounter.type?.[0]?.text ||
                        serviceTypeDisplay ||
                        ''
        if (!v092Channel) {
          // Only strip kind words when we're in the legacy fallback path —
          // v0.9.2 channel text ("IC卡資料"/"申報資料") never contains kind
          // words, so stripping would be a no-op there.
          department = department.replace(/門診|住院|急診|藥局/g, '').trim()
        }
        department = localizeEncounterChannel(department, locale)

        const participant = encounter.participant?.find((p: any) =>
          p?.individual?.display || p?.actor?.display
        )
        const physician = participant?.individual?.display || participant?.actor?.display || ''
        const comparison = encounter._sourceRecordComparison
        const originalSources = encounter._sourceEncounterRecords ?? encounters
        const availableSources = comparison?.references.map((reference: string) => originalSources.find((item: any) => `Encounter/${item.id}` === reference)).filter(Boolean)

        return {
          id: encounter.id,
          sourceIds: encounter._comparisonEncounterIds,
          sourceComparisonStatus: encounter._sourceRecordComparison?.status,
          hospitalOnly: mixedSources && !comparison && isVghtpeSource(encounter) ? true : undefined,
          sourceComparisonWarnings: comparison ? [...(comparison.warnings ?? []), ...(availableSources.length < comparison.references.length ? ['source-partners-not-in-view'] : [])] : undefined,
          sourceRecords: availableSources?.map((source: any) => {
            return { id: source.id, date: medicationClinicalDay(source?.period?.start),
              origin: isVghtpeSource(source) ? 'hospital' : 'medcloud',
              institution: getInstitutionName(source?.serviceProvider?.display, locale),
              department: source?.serviceType?.text || source?.serviceType?.coding?.find((coding: any) => coding.display)?.display,
              physician: source?.participant?.find((participant: any) => participant.individual?.display)?.individual?.display,
              diagnoses: (source?.reasonCode ?? []).map((concept: any) => [concept.coding?.[0]?.system?.split('/').pop(), concept.coding?.[0]?.code,
                concept.text || concept.coding?.[0]?.display].filter(Boolean).join(' ')),
            }
          }),
          type,
          careDiscipline,
          date: encounter.period?.start || '',
          endDate: encounter.period?.end || undefined,
          location,
          institution: institution || undefined,
          reason,
          icdCodes,
          diagnosis,
          status: encounter.status,
          department: department || undefined,
          physician: physician || undefined
        }
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [encounters, icdDict, locale])
}
