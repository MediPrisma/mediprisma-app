import type { AnalyteNameMode } from '@voho0000/clinical-lab-normalization/display'
import { isParaproteinTextKey } from '@/src/shared/utils/paraprotein-analytes'
import { categorizeObservation } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { normalizeAnalyteUnit } from '@/src/shared/utils/unit-scale'
import { compactLabTrendUnit as compactUnit, labTrendGroupKey } from '@/src/shared/utils/lab-trend-group.utils'
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
}

export type LabTrendUnavailableReason =
  | 'insufficient-points'
  | 'mixed-units'
  | 'mixed-specimens'

export interface LabTrendSeries {
  selection: LabTrendSelection
  points: LabTrendPoint[]
  /** Exact results across all groups. Use groupLabTrendPoints before drawing. */
  chartPoints: LabTrendPoint[]
  /** At least one unit/specimen group contains enough comparable points. */
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
  // Preserve the existing comparison for a range attached to its own result.
  // Cross-result grouping has a separate, case-preserving unit identity.
  const rangeUnitKey = (unit: string | undefined) => compactUnit(unit).toLowerCase()

  const normalizeBound = (
    value: number | undefined,
    boundUnit: string | undefined,
  ): number | undefined => {
    if (value === undefined) return undefined
    const sourceUnit = boundUnit || rawPointUnit
    const normalized = normalizeAnalyteUnit(testKey, value, sourceUnit, context)
    if (pointWasNormalized) {
      return normalized && rangeUnitKey(normalized.unit) === rangeUnitKey(pointUnit)
        ? normalized.value
        : undefined
    }
    return rangeUnitKey(sourceUnit) === rangeUnitKey(pointUnit) ? value : undefined
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

export interface LabTrendGroup extends LabTrendCompatibility {
  key: string
  specimen?: string
  points: LabTrendPoint[]
  chartPoints: LabTrendPoint[]
  sharedReferenceRange?: LabTrendReferenceRange
  referenceRangesVary: boolean
}

function summarizeReferenceRanges(chartPoints: LabTrendPoint[]) {
  const signatures = new Set(chartPoints.map(point => rangeSignature(point.referenceRange)))
  const allHaveRange = chartPoints.length > 0 && chartPoints.every(point => (
    point.referenceRange?.low !== undefined || point.referenceRange?.high !== undefined
  ))
  const sharedReferenceRange = allHaveRange && signatures.size === 1 ? chartPoints[0]?.referenceRange : undefined
  return { sharedReferenceRange, referenceRangesVary: chartPoints.some(point => point.referenceRange) && !sharedReferenceRange }
}

/** Each group is independently charted; no line, delta or range crosses units
 * or blood-gas specimens. Comparator results remain in their group's history. */
export function groupLabTrendPoints(points: LabTrendPoint[], categoryId: string): LabTrendGroup[] {
  const buckets = new Map<string, LabTrendPoint[]>()
  for (const point of points) {
    const key = labTrendGroupKey(point.unit, point.specimen, categoryId)
    const bucket = buckets.get(key) ?? []
    bucket.push(point)
    buckets.set(key, bucket)
  }
  return [...buckets].map(([key, groupPoints]) => {
    const sorted = [...groupPoints].sort((a, b) => a.timestamp - b.timestamp || a.effectiveTime.localeCompare(b.effectiveTime) || a.id.localeCompare(b.id))
    const chartPoints = sorted.filter(point => point.plotEligible)
    return {
      key, points: sorted, chartPoints,
      ...assessLabTrendCompatibility(chartPoints, categoryId),
      unit: sorted[0]?.unit,
      specimen: categoryId === 'bloodgas' ? sorted[0]?.specimen : undefined,
      ...summarizeReferenceRanges(chartPoints),
    }
  }).sort((a, b) => (
    Number(b.chartable) - Number(a.chartable)
    || (b.chartPoints.at(-1)?.timestamp ?? b.points.at(-1)?.timestamp ?? 0) - (a.chartPoints.at(-1)?.timestamp ?? a.points.at(-1)?.timestamp ?? 0)
    || b.chartPoints.length - a.chartPoints.length
    || a.key.localeCompare(b.key)
  ))
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
    })
  })

  points.sort((left, right) => (
    left.timestamp - right.timestamp
    || left.effectiveTime.localeCompare(right.effectiveTime)
    || left.id.localeCompare(right.id)
  ))

  const chartPoints = points.filter((point) => point.plotEligible)
  const compatibility = assessLabTrendCompatibility(chartPoints, selection.categoryId)
  const groups = groupLabTrendPoints(points, selection.categoryId)
  const chartable = groups.some(group => group.chartable)
  const { sharedReferenceRange, referenceRangesVary } = summarizeReferenceRanges(
    compatibility.mixedUnits || compatibility.mixedSpecimens ? [] : chartPoints,
  )

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
    chartable,
    unavailableReason: chartable ? undefined : compatibility.unavailableReason,
    unit: compatibility.unit,
    mixedUnits: compatibility.mixedUnits,
    mixedSpecimens: compatibility.mixedSpecimens,
    sharedReferenceRange,
    referenceRangesVary,
    sameDayMultiple,
    excluded,
  }
}
