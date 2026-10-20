// Data preparation for the medication refill timeline.
//
// Medication rows can be grouped by the governed ATC hierarchy or by the
// prescribing/dispensing organization carried by MedicationRequest.requester.
// ATC labels are consumed from the pinned hierarchy, either through official
// drug-master terminology or the strict source-WHO-ATC fallback; this hook
// never invents level 2-4 labels by slicing a full ingredient code.
import { stripLeadingIcdCode } from '@/src/shared/utils/icd-lookup'
import { useMemo, useState } from 'react'
import { sourceComparisonNarrative } from '@/src/shared/utils/source-record-comparison'
import { medicationExpectedEnd, medicationExpectedEndTimestamp, durationToDays } from '@/src/core/utils/clinical-context-selection.utils'
import { periodToDays } from '../../utils/duration-helpers'
import { sourceSelfPurchase } from '@/src/shared/utils/medication-source-markers'
import {
  resolveHospitalMedicationName,
  hospitalMedicationDisplayName,
  type HospitalMedicationName,
} from '@/src/shared/utils/hospital-medication-names'
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import type { MedicationEntity } from '@/src/core/entities/clinical-data.entity'
import {
  isChronicPrescription,
  medicationClinicalIdentityKey,
  medicationSourceCode,
  pickLocalizedText,
  pickByLocale,
} from '../../utils/fhir-helpers'
import { displayDosageInstruction } from '../../utils/dose-helpers'

export type TimeRange = '3m' | '6m' | '1y' | '3y' | 'all'
export type TimelineGroupingMode = 'atc' | 'organization'
export type TimelineAtcLevel = '2' | '4'
export type TimelinePrescriptionType = 'chronic' | 'non-chronic' | 'unrecorded'

export interface RefillBar {
  sourceComparison?: string
  sourceComparisonUnconfirmed?: boolean
  supplyEndDay?: string
  selfPurchased?: boolean
  sourceStatus?: string
  supplyDaysUnrecorded?: boolean
  refillId: string
  startMs: number
  endMs: number
  supplyDays: number
  authoredOnIso: string
  sourceMedicationCode?: string
  frequency?: string
  pharmacy?: string
  icdCode?: string
  icdText?: string
  prescriptionType: TimelinePrescriptionType
}

interface TimelineClassification {
  key: string
  code?: string
  label: string
  nameEn?: string
  nameZh?: string
  level: 1 | 2 | 3 | 4 | 'source' | 'other'
}

export interface TimelineDrug {
  /** Unique rendered row key. Organization mode includes the organization. */
  drugKey: string
  clinicalDrugKey: string
  drugName: string
  drugProductName?: string
  drugTerminology?: MedicationEntity['drugTerminology']
  hospitalMedicationName?: HospitalMedicationName
  prescriptionType: TimelinePrescriptionType
  categoryKey: string
  categoryLabel: string
  atcLevel2?: TimelineClassification
  atcLevel4?: TimelineClassification
  organizationKey: string
  organizationLabel: string
  bars: RefillBar[]
  firstStartMs: number
  lastStartMs: number
  refillCount: number
}

export interface CategoryGroup {
  key: string
  code?: string
  label: string
  /** Keep both governed names so translated labels can disclose the WHO
   * English source without adding another persistent line to the timeline. */
  nameEn?: string
  nameZh?: string
  /** Direct drug rows. A hierarchy header may also contain child headers. */
  drugs: TimelineDrug[]
  children?: CategoryGroup[]
  depth?: number
  level?: 1 | 2 | 3 | 4 | 'source' | 'other' | 'organization'
  drugCount?: number
  /** Number of rendered drug rows whose coverage includes today. */
  currentDrugCount?: number
  chronicCount: number
  nonChronicCount: number
  unrecordedCount: number
}

export interface TimelineData {
  categories: CategoryGroup[]
  /** Flat rendered rows. Organization mode may repeat a drug by organization. */
  drugs: TimelineDrug[]
  domainStartMs: number
  domainEndMs: number
  /** Unique clinical drugs in the selected time range. */
  totalDrugs: number
  /** Rendered rows; differs from totalDrugs when a drug spans organizations. */
  totalRows: number
  chronicCount: number
  nonChronicCount: number
  unrecordedCount: number
  organizationCount: number
}

const RANGE_MONTHS: Record<TimeRange, number | null> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '3y': 36,
  all: null,
}

const FALLBACK_CATEGORY_KEY = '__other__'
const FALLBACK_ORGANIZATION_KEY = '__unknown_organization__'
const ATC_LEVEL_ONE_CODES = new Set([
  'A', 'B', 'C', 'D', 'G', 'H', 'J',
  'L', 'M', 'N', 'P', 'R', 'S', 'V',
])

type MedicationAtcData =
  | NonNullable<MedicationEntity['drugTerminology']>
  | NonNullable<MedicationEntity['atcClassification']>

function medicationAtcData(medication: any): MedicationAtcData | undefined {
  return medication?.drugTerminology ?? medication?.atcClassification
}

function recordedPrescriptionType(medication: any): TimelinePrescriptionType {
  if (isChronicPrescription(medication)) return 'chronic'

  const course = medication?.courseOfTherapyType
  const hasExplicitNonChronicCode = Array.isArray(course?.coding)
    && course.coding.some((coding: any) => {
      const code = typeof coding?.code === 'string'
        ? coding.code.trim().toLowerCase()
        : ''
      return code === 'acute' || code === 'seasonal'
    })
  const hasExplicitNonChronicText = typeof course?.text === 'string'
    && /\b(acute|seasonal)\b/i.test(course.text)

  return hasExplicitNonChronicCode || hasExplicitNonChronicText
    ? 'non-chronic'
    : 'unrecorded'
}

function resolvedPrescriptionType(
  types: Set<TimelinePrescriptionType> | undefined,
): TimelinePrescriptionType {
  if (types?.has('chronic')) return 'chronic'
  // Missing metadata wins over an explicit non-chronic record: a grouped row
  // must only say non-chronic when every represented record says so.
  if (types?.has('unrecorded')) return 'unrecorded'
  return 'non-chronic'
}

function localizedTerminologyName(
  terminology: MedicationAtcData | undefined,
  level: 2 | 4,
  locale: string,
): string {
  const nameEn = terminology?.[`atcLevel${level}NameEn`]
  const nameZh = terminology?.[`atcLevel${level}NameZh`]
  const value = locale === 'en' ? nameEn || nameZh : nameZh || nameEn
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function normalizedTerminologyName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized || undefined
}

function governedAtcClassification(
  medication: any,
  level: 2 | 4,
  locale: string,
): TimelineClassification | undefined {
  const terminology = medicationAtcData(medication)
  const codeValue = terminology?.[`atcLevel${level}Code`]
  const code = typeof codeValue === 'string'
    ? codeValue.trim().toUpperCase()
    : ''
  const pattern = level === 2
    ? /^[A-Z]\d{2}$/
    : /^[A-Z]\d{2}[A-Z]{2}$/
  const nameEn = normalizedTerminologyName(
    terminology?.[`atcLevel${level}NameEn`],
  )
  const nameZh = normalizedTerminologyName(
    terminology?.[`atcLevel${level}NameZh`],
  )
  const label = localizedTerminologyName(terminology, level, locale)
  if (!pattern.test(code) || !label) return undefined
  return {
    key: `atc-level${level}:${code}`,
    code,
    label,
    ...(nameEn ? { nameEn } : {}),
    ...(nameZh ? { nameZh } : {}),
    level,
  }
}

function primaryCategoryOf(
  medication: any,
  locale: string,
  fallbackCategoryLabel: string,
  atcCategoryLabels: Record<string, string>,
): TimelineClassification {
  const atcLevel2 = governedAtcClassification(medication, 2, locale)
  if (atcLevel2) return atcLevel2

  const sourceCategory = medication?.category?.[0]
  const sourceLabel = pickByLocale(sourceCategory, locale)?.replace(/\s+/g, ' ').trim()
  if (sourceLabel) {
    const sourceKey =
      sourceCategory?.coding?.[0]?.code ||
      sourceCategory?.coding?.[0]?.display ||
      sourceCategory?.text ||
      sourceLabel
    return {
      key: `source:${String(sourceKey).trim()}`,
      label: sourceLabel,
      level: 'source',
    }
  }

  const terminology = medicationAtcData(medication)
  const atcCode = typeof terminology?.atcCode === 'string'
    ? terminology.atcCode.trim().toUpperCase()
    : ''
  const atcGroup = atcCode.charAt(0)
  if (ATC_LEVEL_ONE_CODES.has(atcGroup)) {
    return {
      key: `atc-level1:${atcGroup}`,
      code: atcGroup,
      label: atcCategoryLabels[atcGroup] || `ATC ${atcGroup}`,
      level: 1,
    }
  }

  return {
    key: FALLBACK_CATEGORY_KEY,
    label: fallbackCategoryLabel,
    level: 'other',
  }
}

function organizationOf(
  medication: any,
  fallbackOrganizationLabel: string,
  locale: string,
): { key: string; label: string } {
  const label = typeof medication?.requester?.display === 'string'
    ? formatOrganizationDisplay(medication.requester.display, locale).replace(/\s+/g, ' ').trim()
    : ''
  if (!label) {
    return { key: FALLBACK_ORGANIZATION_KEY, label: fallbackOrganizationLabel }
  }
  return {
    key: `organization:${label.toLocaleLowerCase()}`,
    label,
  }
}

function countGroup(drugs: TimelineDrug[]) {
  return {
    chronicCount: drugs.filter((drug) => drug.prescriptionType === 'chronic').length,
    nonChronicCount: drugs.filter((drug) => drug.prescriptionType === 'non-chronic').length,
    unrecordedCount: drugs.filter((drug) => drug.prescriptionType === 'unrecorded').length,
  }
}

export function isTimelineDrugCurrent(drug: TimelineDrug, nowMs: number): boolean {
  return drug.bars.some((bar) => bar.startMs <= nowMs && bar.endMs >= nowMs)
}

function sortGroups(groups: CategoryGroup[]): CategoryGroup[] {
  return groups.sort((a, b) => {
    const aFallback = a.key === FALLBACK_CATEGORY_KEY
      || a.key === FALLBACK_ORGANIZATION_KEY
    const bFallback = b.key === FALLBACK_CATEGORY_KEY
      || b.key === FALLBACK_ORGANIZATION_KEY
    if (aFallback !== bFallback) return aFallback ? 1 : -1
    const aHasChronic = a.chronicCount > 0
    const bHasChronic = b.chronicCount > 0
    if (aHasChronic !== bHasChronic) return aHasChronic ? -1 : 1
    const countOrder = (b.drugCount ?? b.drugs.length) - (a.drugCount ?? a.drugs.length)
    return countOrder || a.key.localeCompare(b.key)
  })
}

function sortOrganizationGroups(groups: CategoryGroup[]): CategoryGroup[] {
  return groups.sort((a, b) => {
    const aFallback = a.key === FALLBACK_ORGANIZATION_KEY
    const bFallback = b.key === FALLBACK_ORGANIZATION_KEY
    if (aFallback !== bFallback) return aFallback ? 1 : -1

    const currentOrder = (b.currentDrugCount ?? 0) - (a.currentDrugCount ?? 0)
    if (currentOrder !== 0) return currentOrder

    const totalOrder = (b.drugCount ?? b.drugs.length) - (a.drugCount ?? a.drugs.length)
    return totalOrder || a.label.localeCompare(b.label)
  })
}

function childGroups(
  drugs: TimelineDrug[],
  depth: number,
): { directDrugs: TimelineDrug[]; children: CategoryGroup[] } {
  const directDrugs: TimelineDrug[] = []
  const byClassification = new Map<string, {
    classification: TimelineClassification
    drugs: TimelineDrug[]
  }>()

  for (const drug of drugs) {
    const classification = drug.atcLevel4
    if (!classification) {
      directDrugs.push(drug)
      continue
    }
    const existing = byClassification.get(classification.key)
    if (existing) existing.drugs.push(drug)
    else byClassification.set(classification.key, { classification, drugs: [drug] })
  }

  const children = [...byClassification.values()].map(({ classification, drugs: grouped }) => {
    const counts = countGroup(grouped)
    return {
      key: classification.key,
      code: classification.code,
      label: classification.label,
      nameEn: classification.nameEn,
      nameZh: classification.nameZh,
      level: 4,
      depth,
      drugs: grouped,
      children: [],
      drugCount: grouped.length,
      ...counts,
    } satisfies CategoryGroup
  })

  return { directDrugs, children: sortGroups(children) }
}

export function useMedicationTimeline(
  medications: any[],
  audience: 'medical' | 'patient',
  range: TimeRange,
  fallbackCategoryLabel: string,
  locale: string = 'zh-TW',
  atcCategoryLabels: Record<string, string> = {},
  groupingMode: TimelineGroupingMode = 'atc',
  atcLevel: TimelineAtcLevel = '4',
  fallbackOrganizationLabel: string = locale === 'en' ? 'Unknown organization' : '未提供機構',
): TimelineData {
  const [now] = useState(() => Date.now())

  return useMemo(() => {
    const empty: TimelineData = {
      categories: [],
      drugs: [],
      domainStartMs: now,
      domainEndMs: now,
      totalDrugs: 0,
      totalRows: 0,
      chronicCount: 0,
      nonChronicCount: 0,
      unrecordedCount: 0,
      organizationCount: 0,
    }
    if (!Array.isArray(medications) || medications.length === 0) return empty

    const prescriptionTypesByDrug = new Map<string, Set<TimelinePrescriptionType>>()
    for (const medication of medications) {
      if (!medication) continue
      const key = medicationClinicalIdentityKey(medication)
      if (!key) continue
      const types = prescriptionTypesByDrug.get(key) ?? new Set<TimelinePrescriptionType>()
      types.add(recordedPrescriptionType(medication))
      prescriptionTypesByDrug.set(key, types)
    }

    const months = RANGE_MONTHS[range]
    const rangeStart = months === null
      ? -Infinity
      : (() => {
          const start = new Date(now)
          start.setMonth(start.getMonth() - months)
          return start.getTime()
        })()

    const drugsMap = new Map<string, TimelineDrug>()
    const clinicalDrugKeys = new Set<string>()
    let domainMin = Infinity
    let domainMax = -Infinity

    for (const med of medications) {
      if (!med) continue
      if (['cancelled', 'entered-in-error', 'draft', 'on-hold'].includes(String(med.status).toLowerCase())) continue
      const clinicalDrugKey = medicationClinicalIdentityKey(med)
      if (!clinicalDrugKey) continue

      const startIso = med.authoredOn || med.effectiveDateTime
      if (!startIso) continue
      const startMs = new Date(startIso.length === 10 ? `${startIso}T00:00:00+08:00` : startIso).getTime()
      if (Number.isNaN(startMs) || startMs < rangeStart) continue

      const supplyEndDay = medicationExpectedEnd(med)
      const dosage = med.dosageInstruction?.[0] || med.dosage?.[0]
      const reportedDays = durationToDays(med.dispenseRequest?.expectedSupplyDuration, false)
        ?? durationToDays(dosage?.timing?.repeat?.boundsDuration, false)
        ?? periodToDays(dosage?.timing?.repeat?.boundsPeriod)
        ?? periodToDays(supplyEndDay ? { start: startIso.slice(0, 10), end: supplyEndDay } : undefined)
      const supplyDays = reportedDays ?? 1
      const exactEnd = medicationExpectedEndTimestamp(med)
      const endMs = exactEnd === undefined ? startMs + supplyDays * 86400000 : exactEnd + 1
      const prescriptionType = resolvedPrescriptionType(
        prescriptionTypesByDrug.get(clinicalDrugKey),
      )
      const hospitalMedicationName = !med.drugTerminology
        ? resolveHospitalMedicationName(med.medicationCodeableConcept || med.code)
        : undefined
      const officialProductName = audience === 'medical'
        ? med.drugTerminology?.officialNameEn || med.drugTerminology?.officialNameZh
          || (hospitalMedicationName?.status === 'normalized' ? hospitalMedicationName.productName : undefined)
        : locale === 'en'
          ? med.drugTerminology?.officialNameEn || med.drugTerminology?.officialNameZh
          : med.drugTerminology?.officialNameZh
      const ingredientName = audience === 'medical'
        ? med.drugTerminology?.ingredientText?.trim() || hospitalMedicationDisplayName(hospitalMedicationName)
        : undefined
      const drugName = ingredientName
        || officialProductName
        || pickLocalizedText(med.medicationCodeableConcept, audience, locale)
        || clinicalDrugKey
      const drugProductName =
        audience === 'medical'
        && ingredientName
        && officialProductName
        && ingredientName.localeCompare(
          officialProductName,
          undefined,
          { sensitivity: 'accent' },
        ) !== 0
          ? officialProductName
          : undefined

      const category = primaryCategoryOf(
        med,
        locale,
        fallbackCategoryLabel,
        atcCategoryLabels,
      )
      const atcLevel2 = governedAtcClassification(med, 2, locale)
      const atcLevel4 = governedAtcClassification(med, 4, locale)
      const organization = organizationOf(med, fallbackOrganizationLabel, locale)
      const rowKey = groupingMode === 'organization'
        ? `${organization.key}::${clinicalDrugKey}`
        : clinicalDrugKey

      const icdCoding = med.reasonCode?.[0]?.coding?.[0]
      const icdCode = icdCoding?.code as string | undefined
      const rawIcdText = pickByLocale(med.reasonCode?.[0], locale)
      const icdText = stripLeadingIcdCode(rawIcdText, icdCode ?? '')
      const frequency = displayDosageInstruction(dosage)
      const requesterDisplay = med.requester?.display
        ? formatOrganizationDisplay(med.requester.display, locale)
        : ''

      const bar: RefillBar = {
        sourceComparison: sourceComparisonNarrative(med),
        sourceComparisonUnconfirmed: !!med._sourceRecordComparison && med._sourceRecordComparison.status !== 'confirmed',
        supplyEndDay,
        selfPurchased: sourceSelfPurchase(med) === true,
        sourceStatus: med.status,
        supplyDaysUnrecorded: reportedDays === undefined,
        refillId: med.id || `${medicationSourceCode(med) || clinicalDrugKey}-${startIso}`,
        startMs,
        endMs,
        supplyDays,
        authoredOnIso: startIso,
        sourceMedicationCode: medicationSourceCode(med) || undefined,
        frequency: frequency || undefined,
        pharmacy: requesterDisplay || undefined,
        icdCode,
        icdText,
        prescriptionType: recordedPrescriptionType(med),
      }

      clinicalDrugKeys.add(clinicalDrugKey)
      domainMin = Math.min(domainMin, startMs)
      domainMax = Math.max(domainMax, endMs)

      const existing = drugsMap.get(rowKey)
      if (existing) {
        const isLatest = startMs >= existing.lastStartMs
        existing.bars.push(bar)
        existing.firstStartMs = Math.min(existing.firstStartMs, startMs)
        existing.lastStartMs = Math.max(existing.lastStartMs, startMs)
        existing.refillCount++
        if (isLatest) {
          existing.drugName = drugName
          existing.drugProductName = drugProductName
          existing.drugTerminology = med.drugTerminology
          existing.hospitalMedicationName = hospitalMedicationName
          existing.categoryKey = category.key
          existing.categoryLabel = category.label
          existing.atcLevel2 = atcLevel2
          existing.atcLevel4 = atcLevel4
          existing.organizationKey = organization.key
          existing.organizationLabel = organization.label
        }
      } else {
        drugsMap.set(rowKey, {
          drugKey: rowKey,
          clinicalDrugKey,
          drugName,
          drugProductName,
          drugTerminology: med.drugTerminology,
          hospitalMedicationName,
          prescriptionType,
          categoryKey: category.key,
          categoryLabel: category.label,
          atcLevel2,
          atcLevel4,
          organizationKey: organization.key,
          organizationLabel: organization.label,
          bars: [bar],
          firstStartMs: startMs,
          lastStartMs: startMs,
          refillCount: 1,
        })
      }
    }

    if (drugsMap.size === 0) return empty

    domainMax = Math.max(domainMax, now)
    if (domainMin === Infinity) domainMin = now

    const drugs = [...drugsMap.values()].sort((a, b) => {
      const rank: Record<TimelinePrescriptionType, number> = {
        chronic: 0,
        'non-chronic': 1,
        unrecorded: 2,
      }
      const prescriptionTypeOrder = rank[a.prescriptionType] - rank[b.prescriptionType]
      if (prescriptionTypeOrder !== 0) return prescriptionTypeOrder
      return a.firstStartMs - b.firstStartMs
    })

    let categories: CategoryGroup[]

    if (groupingMode === 'organization') {
      const groupsMap = new Map<string, CategoryGroup>()
      for (const drug of drugs) {
        const existing = groupsMap.get(drug.organizationKey)
        if (existing) {
          existing.drugs.push(drug)
          existing.drugCount = (existing.drugCount ?? 0) + 1
          if (drug.prescriptionType === 'chronic') existing.chronicCount++
          else if (drug.prescriptionType === 'non-chronic') existing.nonChronicCount++
          else existing.unrecordedCount++
        } else {
          groupsMap.set(drug.organizationKey, {
            key: drug.organizationKey,
            label: drug.organizationLabel,
            level: 'organization',
            depth: 0,
            drugs: [drug],
            children: [],
            drugCount: 1,
            chronicCount: drug.prescriptionType === 'chronic' ? 1 : 0,
            nonChronicCount: drug.prescriptionType === 'non-chronic' ? 1 : 0,
            unrecordedCount: drug.prescriptionType === 'unrecorded' ? 1 : 0,
          })
        }
      }
      const organizationGroups = [...groupsMap.values()]
      for (const group of organizationGroups) {
        group.currentDrugCount = group.drugs.filter(
          (drug) => isTimelineDrugCurrent(drug, now),
        ).length
        group.drugs.sort((a, b) => {
          const currentOrder = Number(isTimelineDrugCurrent(b, now))
            - Number(isTimelineDrugCurrent(a, now))
          if (currentOrder !== 0) return currentOrder

          const prescribedDateOrder = a.firstStartMs - b.firstStartMs
          if (prescribedDateOrder !== 0) return prescribedDateOrder
          const nameOrder = a.drugName.localeCompare(b.drugName, locale)
          return nameOrder || a.drugKey.localeCompare(b.drugKey)
        })
      }
      categories = sortOrganizationGroups(organizationGroups)
    } else {
      const baseGroups = new Map<string, {
        classification: TimelineClassification
        drugs: TimelineDrug[]
      }>()
      for (const drug of drugs) {
        const classification = drug.atcLevel2 ?? {
          key: drug.categoryKey,
          label: drug.categoryLabel,
          level: drug.categoryKey.startsWith('atc-level1:')
            ? 1
            : drug.categoryKey === FALLBACK_CATEGORY_KEY
              ? 'other'
              : 'source',
        } satisfies TimelineClassification
        const existing = baseGroups.get(classification.key)
        if (existing) existing.drugs.push(drug)
        else baseGroups.set(classification.key, { classification, drugs: [drug] })
      }

      categories = [...baseGroups.values()].map(({ classification, drugs: grouped }) => {
        const counts = countGroup(grouped)
        const showLevel4 = classification.level === 2
          && atcLevel === '4'
        const nested = showLevel4
          ? childGroups(grouped, 1)
          : { directDrugs: grouped, children: [] }
        return {
          key: classification.key,
          code: classification.code,
          label: classification.label,
          nameEn: classification.nameEn,
          nameZh: classification.nameZh,
          level: classification.level,
          depth: 0,
          drugs: nested.directDrugs,
          children: nested.children,
          drugCount: grouped.length,
          ...counts,
        } satisfies CategoryGroup
      })
      categories = sortGroups(categories)
    }

    return {
      categories,
      drugs,
      // A named range is a stable comparison window, not a request to zoom
      // tightly around whatever records happen to exist inside it. Keep the
      // selected lookback boundary even when the earliest medication is much
      // newer; only the open-ended "all" view follows the data minimum.
      domainStartMs: months === null ? domainMin : rangeStart,
      domainEndMs: domainMax,
      totalDrugs: clinicalDrugKeys.size,
      totalRows: drugs.length,
      chronicCount: drugs.filter((drug) => drug.prescriptionType === 'chronic').length,
      nonChronicCount: drugs.filter((drug) => drug.prescriptionType === 'non-chronic').length,
      unrecordedCount: drugs.filter((drug) => drug.prescriptionType === 'unrecorded').length,
      organizationCount: groupingMode === 'organization' ? categories.length : 0,
    }
  }, [
    medications,
    audience,
    range,
    fallbackCategoryLabel,
    locale,
    atcCategoryLabels,
    groupingMode,
    atcLevel,
    fallbackOrganizationLabel,
    now,
  ])
}
