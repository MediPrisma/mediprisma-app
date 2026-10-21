// Observation Block Component - compact single-row display
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { Observation } from '../types'
import { getCodeableConceptText, getValueWithUnit, getOriginalValueWithUnit, getReferenceRangeText } from '../utils/fhir-helpers'
import { getAnalyteDisplayForMode } from '@/src/shared/utils/lab-analyte-display.utils'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import {
  getInterpretationTag,
  getReferenceRangeComparison,
  checkReferenceRangeAbnormal,
  isInterpretationAbnormal,
  isReferenceRangeAssessmentUnavailable,
  type ReferenceRangeComparison,
} from '@voho0000/clinical-lab-normalization/interpretation'
import { CompactLabResultRow } from '@/features/clinical-summary/components/CompactLabResultRow'
import { useReportNameMode } from '../context/report-name-mode.context'
import { isInferredObservationUnit } from '@/src/shared/utils/observation-provenance.utils'
import {
  ObservationLongitudinalAction,
  ObservationLongitudinalAffordance,
  rowLongitudinalHandlers,
  useObservationLongitudinal,
} from './ObservationLongitudinalAction'
import { useCompactLayout } from '@/src/shared/hooks/layout/use-compact-layout.hook'
import type { ProcedureSpecialMaterialEntity } from '@/src/core/entities/clinical-data.entity'
import { ProcedureMaterialsSection } from './ProcedureMaterialsSection'

interface ObservationBlockProps {
  observation: Observation
  /** Visually marks this observation as a child of a report header while
   * keeping the value/reference columns aligned with the rest of the table. */
  nested?: boolean
}

const BLOOD_PRESSURE_PANEL_CODES = new Set(['85354-9', '55284-4'])

function isBloodPressurePanel(observation: Observation): boolean {
  const codings = observation.code?.coding ?? []
  if (codings.some((coding) => BLOOD_PRESSURE_PANEL_CODES.has(coding.code ?? ''))) {
    return true
  }

  const labels = [
    observation.code?.text,
    ...codings.map((coding) => coding.display),
  ]
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.replace(/\s+/g, ' ').trim().toLowerCase())

  return labels.some((label) =>
    label === 'blood pressure'
    || label === 'blood pressure panel'
    || label === 'blood pressure systolic and diastolic'
    || label === '血壓'
    || label === '血壓面板',
  )
}

function ObsRow({
  name,
  value,
  originalValue,
  interp,
  refText,
  referenceComparison,
  referenceComparisonLabel,
  referenceComparisonTooltip,
  rangeUnassessed,
  rangeUnassessedLabel,
  rangeUnassessedTooltip,
  titleAction,
  isLongText,
  refRangeAbnormal,
  nested,
  rowAction,
}: {
  name: string
  value: string
  originalValue?: string
  interp: ReturnType<typeof getInterpretationTag>
  refText: string
  referenceComparison?: ReferenceRangeComparison | null
  referenceComparisonLabel?: string
  referenceComparisonTooltip?: string
  rangeUnassessed?: boolean
  rangeUnassessedLabel?: string
  rangeUnassessedTooltip?: string
  titleAction?: ReactNode
  isLongText?: boolean
  refRangeAbnormal?: boolean
  nested?: boolean
  /** Set on the single-panel layout, where the ROW opens the trend instead of
   *  the icon — see ReportRow for the same wiring on the flat lists. */
  rowAction?: { ariaLabel: string; onClick: (event: MouseEvent<HTMLElement>) => void; onKeyDown: (event: KeyboardEvent<HTMLElement>) => void }
}) {
  // Interpretation wins when present; the structured-range flag is only a
  // fallback for when the source shipped no interpretation at all.
  const isAbnormal = interp ? isInterpretationAbnormal(interp) : !!refRangeAbnormal

  return (
    <CompactLabResultRow
      title={name}
      value={value}
      abnormal={isAbnormal}
      referenceText={refText}
      referenceComparison={referenceComparison ?? undefined}
      referenceComparisonLabel={referenceComparisonLabel}
      referenceComparisonTooltip={referenceComparisonTooltip}
      rangeUnassessed={rangeUnassessed}
      rangeUnassessedLabel={rangeUnassessedLabel}
      rangeUnassessedTooltip={rangeUnassessedTooltip}
      valueMaxWidthClassName={isLongText ? "max-w-[12rem]" : "max-w-[9rem]"}
      className={`rounded-none border-0 bg-transparent px-2.5 py-1.5 hover:bg-muted/60${rowAction ? ' cursor-pointer' : ''}`}
      titleColumnClassName={nested ? "pl-4" : undefined}
      titleActions={titleAction}
      role={rowAction ? 'button' : undefined}
      tabIndex={rowAction ? 0 : undefined}
      ariaLabel={rowAction?.ariaLabel}
      onClick={rowAction?.onClick}
      onKeyDown={rowAction?.onKeyDown}
      trailingContent={originalValue && originalValue !== value ? (
        <span className="sr-only">原始值: {originalValue}</span>
      ) : undefined}
    />
  )
}

export function ObservationBlock({ observation, nested = false }: ObservationBlockProps) {
  // Display label is audience-aware: medical → canonical short code
  // (Na / K / BUN …); patient → long-form name in the active UI language
  // (中文：「鈉 / 鉀 / 尿素氮」; en: "Sodium / Potassium / BUN"). Sort and
  // categorisation upstream still use the canonical key, so switching
  // audience changes the label without re-ordering rows.
  // Non-canonical rows (cultures, antibiotic susceptibilities, free-text
  // reports) keep their bridge-sent text unchanged.
  const { audience } = useAudience()
  const { locale, t } = useLanguage()
  const nameMode = useReportNameMode()
  const title = getAnalyteDisplayForMode(observation, audience, locale, nameMode)
  const interp = getInterpretationTag(observation.interpretation)
  const ref = getReferenceRangeText(observation.referenceRange)
  const referenceComparison = getReferenceRangeComparison(observation)
  const hasComponents = Array.isArray(observation.component) && observation.component.length > 0
  const flattenBloodPressureComponents = hasComponents && isBloodPressurePanel(observation)
  const isReportSummary = observation.code?.text === 'Report Summary'
  // Procedure detail container: the row header already shows the title + date,
  // so render only the attribute rows (no redundant title/value line, no trend).
  const detailsOnly = (observation as { _detailsOnly?: boolean })._detailsOnly === true

  // Value fallback order: numeric → free text → coded value (valueCodeableConcept,
  // e.g. mCODE cancer-staging "T2a" / tumour-marker status) → em-dash.
  const codedValue = getCodeableConceptText(observation.valueCodeableConcept)
  const primaryValue = observation.valueQuantity
    ? getValueWithUnit(observation.valueQuantity)
    : observation.valueString || codedValue || '—'
  const originalPrimaryValue = observation.valueQuantity
    ? getOriginalValueWithUnit(observation.valueQuantity)
    : observation.valueString || codedValue || '—'
  const isLongText = !observation.valueQuantity && (observation.valueString?.length ?? 0) > 80
  const inferredUnitLabel = isInferredObservationUnit(observation)
    ? (locale.startsWith('zh') ? ' · 推估單位' : ' · inferred unit')
    : ''
  const detailSourceId = `observation-longitudinal:${observation.id || `${title}:${observation.effectiveDateTime || ''}`}`

  // Single-panel layout: the row opens the trend, exactly as in the flat report
  // lists. Without this the 36px icon button sat inside a ~24px row and was
  // clipped to a target smaller than the box it declared — the row is the honest
  // target, and a ~343px-wide one is easier to hit than the icon ever was.
  // Desktop keeps the icon button untouched.
  const compactLayout = useCompactLayout()
  const longitudinal = useObservationLongitudinal({
    observation,
    title: title || '檢驗項目',
    sourceId: detailSourceId,
  })
  const rowHandlers = rowLongitudinalHandlers(longitudinal.show)
  // Only the main row carries a trend (component sub-rows have none), so the
  // row-tap follows exactly the same condition as the icon it replaces.
  const rowOpensTrend = compactLayout && !hasComponents && longitudinal.available

  // Procedure detail container: flat list of attribute rows, no main row.
  // Components flagged `_isSubHeader` (a grouped session's sub-procedure name)
  // render as a bold divider heading instead of a name/value row.
  if (detailsOnly && hasComponents) {
    return (
      <div className={`flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 px-2.5 py-2 ${nested ? 'pl-6' : ''}`}>
        {observation.component!.map((component, idx) => {
          const procedureChild = component as typeof component & {
            _isProcedureChild?: boolean
            _procedureCodeLabel?: string
            _procedureSourceLabel?: string
            _procedureSource?: string
            _procedureDateLabel?: string
            _procedureDate?: string
          }
          if (procedureChild._isProcedureChild) {
            const heading = getCodeableConceptText(component.code) || '—'
            const codeValue = component.valueString || '—'
            return (
              <div
                key={idx}
                className="mt-1 grid min-w-0 basis-full grid-cols-1 gap-x-4 gap-y-0.5 border-t pt-2 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.5fr)]"
              >
                <div className="min-w-0 text-[0.8125rem] font-semibold leading-snug text-foreground sm:row-span-2">
                  {heading}
                </div>
                <div className="min-w-0 text-xs leading-snug text-foreground">
                  <span className="min-w-0">
                    <span className="mr-1 text-muted-foreground">
                      {procedureChild._procedureCodeLabel}
                    </span>
                    <span className="font-semibold break-words">{codeValue}</span>
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs leading-snug">
                  <span className="whitespace-nowrap">
                    <span className="mr-1 text-muted-foreground">
                      {procedureChild._procedureSourceLabel}
                    </span>
                    <span className="font-medium text-foreground">
                      {procedureChild._procedureSource}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="mr-1 text-muted-foreground">
                      {procedureChild._procedureDateLabel}
                    </span>
                    <span className="font-medium text-foreground">
                      {procedureChild._procedureDate}
                    </span>
                  </span>
                </div>
              </div>
            )
          }
          const materialSection = component as typeof component & {
            _isProcedureMaterials?: boolean
            _materials?: ProcedureSpecialMaterialEntity[]
            _materialsProcedureTitle?: string
          }
          if (materialSection._isProcedureMaterials && materialSection._materials?.length) {
            return (
              <ProcedureMaterialsSection
                key={idx}
                materials={materialSection._materials}
                procedureTitle={materialSection._materialsProcedureTitle}
              />
            )
          }
          if ((component as { _isSubHeader?: boolean })._isSubHeader) {
            const heading = getCodeableConceptText(component.code) || '—'
            return (
              <div
                key={idx}
                className={`mt-2 border-t pt-2 pr-2 text-sm font-semibold text-foreground ${nested ? 'pl-6' : 'pl-2'}`}
              >
                {heading}
              </div>
            )
          }
          const cName = getAnalyteDisplayForMode(component, audience, locale, nameMode)
          const cValue = component.valueQuantity
            ? getValueWithUnit(component.valueQuantity)
            : component.valueString || getCodeableConceptText(component.valueCodeableConcept) || '—'
          // Procedure attributes are descriptive clinical text, not compact
          // lab values. Give the value column all remaining width and wrap it
          // instead of applying CompactLabResultRow's 9rem truncation.
          return (
            <div
              key={idx}
              className="flex min-w-0 max-w-full items-baseline gap-x-1.5 text-[0.8125rem] leading-snug"
            >
              <span className="shrink-0 text-muted-foreground">
                {cName || '—'}
              </span>
              <span className="min-w-0 whitespace-normal break-words font-semibold text-foreground">
                {cValue}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  // Report Summary block: show as plain text, no trend
  if (isReportSummary) {
    return (
      <div className={`text-xs text-muted-foreground py-1 whitespace-pre-wrap leading-relaxed ${nested ? 'pl-6 pr-2' : 'px-2'}`}>
        {observation.valueString}
        {Array.isArray(observation.component) && observation.component.map((c, i) => (
          <div key={i} className="mt-1">
            <span className="font-medium text-foreground/70">{getCodeableConceptText(c.code)}: </span>
            {c.valueString}
          </div>
        ))}
      </div>
    )
  }

  const referenceStrings = t.reports.referenceComparison

  return (
    <div>
        {/* Main observation row */}
        {!flattenBloodPressureComponents && (
          <ObsRow
            name={title || '—'}
            value={`${primaryValue}${inferredUnitLabel}`}
            originalValue={originalPrimaryValue}
            interp={interp}
            refText={ref}
            referenceComparison={referenceComparison}
            referenceComparisonLabel={referenceComparison === 'high'
              ? referenceStrings.above
              : referenceStrings.below}
            referenceComparisonTooltip={referenceStrings.tooltip}
            titleAction={!hasComponents ? (
              rowOpensTrend ? (
                <ObservationLongitudinalAffordance
                  mode={longitudinal.mode}
                  isActive={longitudinal.isActive}
                />
              ) : (
                <ObservationLongitudinalAction
                  observation={observation}
                  title={title || '檢驗項目'}
                  sourceId={detailSourceId}
                  className="shrink-0"
                />
              )
            ) : undefined}
            rowAction={rowOpensTrend ? {
              ariaLabel: longitudinal.describe(`${title || '—'} ${primaryValue}${inferredUnitLabel}`),
              onClick: rowHandlers.onClick,
              onKeyDown: rowHandlers.onKeyDown,
            } : undefined}
            isLongText={isLongText}
            refRangeAbnormal={checkReferenceRangeAbnormal(observation)}
            rangeUnassessed={isReferenceRangeAssessmentUnavailable(observation)}
            rangeUnassessedLabel={referenceStrings.unassessed}
            rangeUnassessedTooltip={referenceStrings.unassessedTooltip}
            nested={nested}
          />
        )}

        {/* Component sub-rows */}
        {hasComponents && (
          <div className={flattenBloodPressureComponents
            ? 'space-y-0'
            : 'ml-4 mt-0.5 space-y-0 border-l pl-1.5'}>
            {observation.component!.map((component, idx) => {
              const cName = getAnalyteDisplayForMode(component, audience, locale, nameMode)
              const cCoded = getCodeableConceptText(component.valueCodeableConcept)
              const cValue = component.valueQuantity
                ? getValueWithUnit(component.valueQuantity)
                : component.valueString || cCoded || '—'
              const cOriginal = component.valueQuantity
                ? getOriginalValueWithUnit(component.valueQuantity)
                : component.valueString || cCoded || '—'
              const cInterp = getInterpretationTag(component.interpretation)
              const cRef = getReferenceRangeText(component.referenceRange)
              const cReferenceComparison = getReferenceRangeComparison(component)
              return (
                <ObsRow
                  key={idx}
                  name={cName || '—'}
                  value={cValue}
                  originalValue={cOriginal}
                  interp={cInterp}
                  refText={cRef}
                  referenceComparison={cReferenceComparison}
                  referenceComparisonLabel={cReferenceComparison === 'high'
                    ? referenceStrings.above
                    : referenceStrings.below}
                  referenceComparisonTooltip={referenceStrings.tooltip}
                  refRangeAbnormal={checkReferenceRangeAbnormal(component)}
                  rangeUnassessed={isReferenceRangeAssessmentUnavailable(component)}
                  rangeUnassessedLabel={referenceStrings.unassessed}
                  rangeUnassessedTooltip={referenceStrings.unassessedTooltip}
                  nested={nested}
                />
              )
            })}
          </div>
        )}
    </div>
  )
}
