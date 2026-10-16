import type { AnalyteNameMode } from '@voho0000/clinical-lab-normalization/display'
import { isParaproteinTextKey } from '@/src/shared/utils/paraprotein-analytes'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { hasUnrecognizedEgfrUnit, normalizeAnalyteUnit } from '@/src/shared/utils/unit-scale'
import {
  getAuditedReferenceRangeBounds,
  getInterpretationCode,
  isObservationAbnormal,
} from '@voho0000/clinical-lab-normalization/interpretation'
import { isInferredObservationUnit } from '@/src/shared/utils/observation-provenance.utils'
import { FHIR_SYSTEMS } from '@/src/shared/constants/fhir-systems.constants'

export interface LabTrendSelection {
  categoryId: string
  mapKey: string
  testKey: string
  displayName: string
  nameMode: AnalyteNameMode
}

/**
 * Numeric laboratory observations occasionally arrive before their local/NHI
 * code has been added to the cumulative-report taxonomy. Keep those scalar
 * results on the audited trend surface instead of sending them back to the
 * legacy history/chart dialog.
 */
export const UNCATEGORIZED_LAB_TREND_CATEGORY = '__uncategorized__'

export interface LabTrendReferenceRange {
  low?: number
  high?: number
  text?: string
}

export interface LabTrendPoint {
  id: string
  effectiveTime: string
  issuedTime?: string
  timestamp: number
  value: number
  rawValue: number
  unit?: string
  rawUnit?: string
  comparator?: string
  status?: string
  interpretationCode?: string
  abnormal: boolean
  critical: boolean
  preliminary: boolean
  corrected: boolean
  referenceRange?: LabTrendReferenceRange
  performer?: string
  specimen?: string
  unitInferred: boolean
  plotEligible: boolean
  plotExclusionReason?: 'unrecognized-unit'
}

export type LabTrendUnavailableReason =
  | 'insufficient-points'
  | 'mixed-units'
  | 'mixed-specimens'

export interface LabTrendSeries {
  selection: LabTrendSelection
  points: LabTrendPoint[]
  chartPoints: LabTrendPoint[]
  chartable: boolean
  unavailableReason?: LabTrendUnavailableReason
  unit?: string
  mixedUnits: boolean
  mixedSpecimens: boolean
  sharedReferenceRange?: LabTrendReferenceRange
  referenceRangesVary: boolean
  sameDayMultiple: boolean
  excluded: {
    invalidStatus: number
    missingDate: number
    nonNumeric: number
    comparator: number
  }
}

export interface LabTrendCompatibility {
  chartable: boolean
  unavailableReason?: LabTrendUnavailableReason
  unit?: string
  mixedUnits: boolean
  mixedSpecimens: boolean
}

const INVALID_STATUSES = new Set(['entered-in-error', 'cancelled'])
const PRELIMINARY_STATUSES = new Set(['registered', 'preliminary'])
const CORRECTED_STATUSES = new Set(['amended', 'corrected'])
const CRITICAL_CODES = new Set(['HH', 'LL', 'AA', 'CRIT-HI', 'CRIT-LO'])

function normalizeStatus(status: unknown): string | undefined {
  if (typeof status !== 'string') return undefined
  const normalized = status.trim().toLowerCase()
  return normalized || undefined
}

function observationEffectiveTime(observation: any): string | undefined {
  return observation?.effectiveDateTime
    || observation?.effectivePeriod?.start
    || observation?.issued
}

function compactUnit(unit: string | undefined): string {
  if (!unit) return '__missing__'
  return unit
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/μ/g, 'µ')
    .toLowerCase() || '__missing__'
}

/**
 * Assess whether a specific set of visible points can safely form one line.
 * The same rule is used for the complete series and for each selected time
 * window, so incompatible older history does not suppress a safe recent trend.
 */
export function assessLabTrendCompatibility(
  points: ReadonlyArray<Pick<LabTrendPoint, 'unit' | 'specimen'>>,
  categoryId: string,
): LabTrendCompatibility {
  const units = new Set(points.map((point) => compactUnit(point.unit)))
  const mixedUnits = units.size > 1
  const specimenKeys = new Set(points.map((point) => (
    point.specimen?.normalize('NFKC').trim().toLowerCase() || '__missing__'
  )))
  const mixedSpecimens = categoryId === 'bloodgas' && specimenKeys.size > 1

  let unavailableReason: LabTrendUnavailableReason | undefined
  if (mixedUnits) unavailableReason = 'mixed-units'
  else if (mixedSpecimens) unavailableReason = 'mixed-specimens'
  else if (points.length < 2) unavailableReason = 'insufficient-points'

  return {
    chartable: !unavailableReason,
    unavailableReason,
    unit: mixedUnits ? undefined : points[0]?.unit,
    mixedUnits,
    mixedSpecimens,
  }
}

function loincCode(observation: any): string | undefined {
  return observation?.code?.coding?.find(
    (coding: any) => coding?.system === FHIR_SYSTEMS.LOINC,
  )?.code
}

function conversionUnit(observation: any): string | undefined {
  const quantity = observation?.valueQuantity
  if (!quantity) return undefined
  return quantity.system === FHIR_SYSTEMS.UCUM
    ? quantity.code || quantity.unit
    : quantity.unit || quantity.code
}

function normalizeRange(
  observation: any,
  testKey: string,
  pointUnit: string | undefined,
  pointWasNormalized: boolean,
): LabTrendReferenceRange | undefined {
  const bounds = getAuditedReferenceRangeBounds(observation?.referenceRange)
  const range = observation?.referenceRange?.[0]
  if (!bounds && !range?.text) return undefined

  const context = { loincCode: loincCode(observation) }
  const rawPointUnit = conversionUnit(observation)

  const normalizeBound = (
    value: number | undefined,
    boundUnit: string | undefined,
  ): number | undefined => {
    if (value === undefined) return undefined
    const sourceUnit = boundUnit || rawPointUnit
    const normalized = normalizeAnalyteUnit(testKey, value, sourceUnit, context)
    if (pointWasNormalized) {
      return normalized && compactUnit(normalized.unit) === compactUnit(pointUnit)
        ? normalized.value
        : undefined
    }
    return compactUnit(sourceUnit) === compactUnit(pointUnit) ? value : undefined
  }

  const low = normalizeBound(bounds?.low, range?.low?.unit)
  const high = normalizeBound(bounds?.high, range?.high?.unit)
  if (low === undefined && high === undefined && !range?.text) return undefined

  return {
    ...(low !== undefined ? { low } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(typeof range?.text === 'string' && range.text.trim()
      ? { text: range.text.trim() }
      : {}),
  }
}

function rangeSignature(range: LabTrendReferenceRange | undefined): string {
  if (!range || (range.low === undefined && range.high === undefined)) return '__missing__'
  return `${range.low ?? ''}|${range.high ?? ''}`
}

function sourceMatchesSelection(
  observation: any,
  selection: LabTrendSelection,
): boolean {
  const category = categorizeObservation(observation)
  const categoryId = category?.id ?? UNCATEGORIZED_LAB_TREND_CATEGORY
  if (categoryId !== selection.categoryId) return false
  const identity = getLabPivotTestIdentity(
    observation,
    category?.id,
    selection.nameMode,
  )
  return identity.mapKey === selection.mapKey
}

/**
 * Build a safety-audited trend series from the same raw Observations that feed
 * the cumulative report. It deliberately does not reuse the legacy history
 * dialog, whose raw units and one-global-reference-range assumptions can be
 * misleading for multi-institution data.
 */
export function buildLabTrendSeries(
  observations: any[],
  selection: LabTrendSelection,
): LabTrendSeries {
  const points: LabTrendPoint[] = []
  const excluded = {
    invalidStatus: 0,
    missingDate: 0,
    nonNumeric: 0,
    comparator: 0,
  }

  // A folded IEP / IFE report column mixes analytes (IgG and IgA lanes): it
  // is never a numeric series.
  const foldedReport = isParaproteinTextKey(selection.testKey)
  observations.forEach((observation, index) => {
    if (foldedReport) return
    if (!sourceMatchesSelection(observation, selection)) return

    const status = normalizeStatus(observation?.status)
    if (status && INVALID_STATUSES.has(status)) {
      excluded.invalidStatus += 1
      return
    }

    const effectiveTime = observationEffectiveTime(observation)
    const timestamp = effectiveTime ? new Date(effectiveTime).getTime() : Number.NaN
    if (!effectiveTime || !Number.isFinite(timestamp)) {
      excluded.missingDate += 1
      return
    }

    const rawValue = observation?.valueQuantity?.value
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      excluded.nonNumeric += 1
      return
    }

    const rawUnit = conversionUnit(observation)
    const unrecognizedUnit = hasUnrecognizedEgfrUnit(selection.testKey, rawUnit)
    const normalized = normalizeAnalyteUnit(
      selection.testKey,
      rawValue,
      rawUnit,
      { loincCode: loincCode(observation) },
    )
    const value = normalized?.value ?? rawValue
    const unit = normalized?.unit ?? rawUnit
    const comparator = typeof observation?.valueQuantity?.comparator === 'string'
      ? observation.valueQuantity.comparator
      : undefined
    if (comparator) excluded.comparator += 1

    const interpretationCode = getInterpretationCode(observation?.interpretation) || undefined
    const performer = observation?.performer
      ?.map((entry: any) => entry?.display)
      .filter(Boolean)
      .join('、') || undefined
    const specimen = observation?.specimen?.display || observation?.specimen?.reference

    points.push({
      id: observation?.id || observation?.sourceId || `trend-${index}-${effectiveTime}`,
      effectiveTime,
      issuedTime: observation?.issued,
      timestamp,
      value,
      rawValue,
      unit,
      rawUnit,
      comparator,
      status,
      interpretationCode,
      abnormal: isObservationAbnormal(observation),
      critical: !!interpretationCode && CRITICAL_CODES.has(interpretationCode),
      preliminary: !!status && PRELIMINARY_STATUSES.has(status),
      corrected: !!status && CORRECTED_STATUSES.has(status),
      referenceRange: normalizeRange(
        observation,
        selection.testKey,
        unit,
        !!normalized,
      ),
      performer,
      specimen,
      unitInferred: isInferredObservationUnit(observation),
      plotEligible: !comparator,
      ...(unrecognizedUnit ? { plotExclusionReason: 'unrecognized-unit' as const } : {}),
    })
  })

  // Only prefer recognized units when there is an eligible recognized point.
  // Otherwise preserve the existing compatibility rule for the entire series;
  // this fix must not hide an already-available uniform-unit trend.
  const hasRecognizedPoint = points.some((point) => point.plotEligible && !point.plotExclusionReason)
  for (const point of points) {
    if (hasRecognizedPoint && point.plotExclusionReason) point.plotEligible = false
    else if (!hasRecognizedPoint) delete point.plotExclusionReason
  }

  points.sort((left, right) => (
    left.timestamp - right.timestamp
    || left.effectiveTime.localeCompare(right.effectiveTime)
    || left.id.localeCompare(right.id)
  ))

  const chartPoints = points.filter((point) => point.plotEligible)
  const compatibility = assessLabTrendCompatibility(chartPoints, selection.categoryId)

  const rangeSignatures = new Set(chartPoints.map((point) => rangeSignature(point.referenceRange)))
  const allHaveNumericRange = chartPoints.length > 0 && chartPoints.every((point) => (
    point.referenceRange?.low !== undefined || point.referenceRange?.high !== undefined
  ))
  const sharedReferenceRange = allHaveNumericRange && rangeSignatures.size === 1
    ? chartPoints[0]?.referenceRange
    : undefined
  const hasAnyRange = chartPoints.some((point) => point.referenceRange)
  const referenceRangesVary = hasAnyRange && !sharedReferenceRange

  const dayCounts = new Map<string, number>()
  for (const point of points) {
    const day = point.effectiveTime.slice(0, 10)
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
  }
  const sameDayMultiple = [...dayCounts.values()].some((count) => count > 1)

  return {
    selection,
    points,
    chartPoints,
    chartable: compatibility.chartable,
    unavailableReason: compatibility.unavailableReason,
    unit: compatibility.unit,
    mixedUnits: compatibility.mixedUnits,
    mixedSpecimens: compatibility.mixedSpecimens,
    sharedReferenceRange,
    referenceRangesVary,
    sameDayMultiple,
    excluded,
  }
}
