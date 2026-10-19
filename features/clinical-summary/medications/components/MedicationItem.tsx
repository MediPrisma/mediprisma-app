// Wide panels use two lines. Below 456px, give the medication name and
// regimen their own lines, then align ICD / source / refills on a third.
// Text within each line remains single-line and truncates with ellipses.
import type { ReactNode } from 'react'
import { useMedicationEndDateFit } from '../hooks/useMedicationEndDateFit'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CLINICAL_SOURCE_TONE } from "@/features/clinical-summary/components/clinical-color-roles"
import { clinicalTooltipSurfaceClass } from "@/features/clinical-summary/components/clinical-metadata-styles"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { TruncatedRevealLabel } from "./TruncatedRevealLabel"
import { useResourceAnchor } from "@/src/application/hooks/use-resource-anchor.hook"
import type { ResourceNavTarget } from "@/src/application/stores/resource-navigation.store"
import { cn } from "@/src/shared/utils/cn.utils"
import { formatDate as formatCalendarDate } from "@/src/shared/utils/date.utils"
import type { MedicationExecutionPeriod, MedicationNameMode, MedicationRow } from '../types'
import {
  compactMedicationDate,
  fullMedicationDate,
} from '../utils/medication-date-display'
import {
  medicationCategoryChipClass,
  medicationChronicBadgeClass,
  medicationIcdChipClass,
  medicationIcdCodeClass,
  medicationIcdDescriptionClass,
  getMedicationDaysLeftBadgeClass,
  getMedicationStatusBadgeClass,
} from './medication-chip-styles'
import { MedicationTerminologyTooltip } from './MedicationTerminologyTooltip'
import { doseUnlessRepeated } from '../utils/dose-helpers'

interface MedicationItemProps {
  medication: MedicationRow
  /** Renders a "目前服用" chip on rows whose sourceResourceType is
   *  MedicationStatement. Driven from MedListCard's mixed-source detection
   *  — for the bridge default (all MedicationRequest) it stays off. */
  showSourceChip?: boolean
  sourceChipStatementLabel?: string
  sourceChipStatementTooltip?: string
  /** Exact source-reported inpatient execution windows. When provided, these
   *  replace the generic prescription/supply date text without changing the
   *  shared medication title, terminology, badges, or metadata layout. */
  executionPeriods?: MedicationExecutionPeriod[]
  /** Controls which single drug name is rendered. Both names remain available
   *  in the terminology tooltip so the compact row never has to show both. */
  nameMode?: MedicationNameMode
  /** Removes the individual card boundary when rows live in a shared list
   *  frame. The internal three-lane information grid stays identical. */
  grouped?: boolean
  /** The row sits under a visit header that already names its institution
   *  and diagnosis, so the row leaves both out. */
  visitContextInHeader?: boolean
  /** Optional full-height leading action, used to reveal this current drug's
   *  older prescriptions without duplicating it in the history section. */
  leadingControl?: ReactNode
  /** Makes the non-interactive area of an expandable medication row trigger
   *  the same action as its leading control. Nested controls keep their own
   *  behavior and never bubble into this row action. */
  onRowToggle?: () => void
  /** Runs only after this exact medication row claims a resource-navigation
   *  request, so a parent can open refill details without racing consumption. */
  onResourceNavigationMatch?: (
    sequence: number,
    target: ResourceNavTarget,
  ) => void
  /** Additional MedicationRequest ids represented by this row, such as older
   *  fills hidden inside its refill-history toggle. */
  resourceNavigationIds?: string[]
}

function getStatusBadge(medication: MedicationRow, mt: any, locale: string) {
  const endedStatus = {
    cancelled: locale === 'en' ? 'cancelled' : '已取消',
    'entered-in-error': locale === 'en' ? 'entered in error' : '誤植紀錄',
    stopped: locale === 'en' ? 'stopped' : '已停用',
  }[medication.status as 'cancelled' | 'entered-in-error' | 'stopped']
  if (endedStatus) return { label: endedStatus, variant: 'secondary' as const }
  if (medication.isInactive) {
    return { label: mt.statusEnded ?? 'ended', variant: 'secondary' as const }
  }
  const remainingDays = medication.displayRemainingDays ?? medication.daysRemaining
  if (remainingDays !== undefined) {
    if (remainingDays < 0 && medication.displayRemainingSource !== 'cloud-single') {
      return { label: mt.statusOverdue ?? 'overdue', variant: 'outline' as const }
    }
    if (remainingDays === 0 && medication.displayRemainingSource !== 'cloud-single') {
      return { label: mt.statusEndingToday ?? 'ending today', variant: 'outline' as const }
    }
    const template = medication.displayRemainingSource === 'cloud-single'
      ? (mt.singlePrescriptionRemainingCompact ?? mt.daysLeft ?? '{n} days left')
      : (mt.appEstimatedDaysLeft ?? mt.daysLeft ?? '{n} days left')
    return {
      label: template.replace('{n}', String(remainingDays)),
      variant: 'default' as const,
    }
  }
  return { label: medication.status, variant: 'default' as const }
}

// Compact date: "5/13/2026" → "5/13/26". Keeps year visible (matters
// clinically — last refill 2 years ago vs 2 months ago) but strips two
// digits and the trailing label noise.
function shortDate(s?: string): string {
  if (!s) return ''
  return s.replace(/(\d{1,2})\/(\d{1,2})\/(\d{2})(\d{2})/, '$1/$2/$4')
}

function sourceCalendarDate(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return formatCalendarDate(value, locale)
  const [, year, month, day] = match
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number(year), Number(month) - 1, Number(day)))
}

export function MedicationItem({
  medication,
  showSourceChip = false,
  sourceChipStatementLabel,
  sourceChipStatementTooltip,
  executionPeriods,
  nameMode = 'ingredient',
  grouped = false,
  visitContextInHeader = false,
  leadingControl,
  onRowToggle,
  onResourceNavigationMatch,
  resourceNavigationIds,
}: MedicationItemProps) {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const mt = (t.medications as any)
  const badge = getStatusBadge(medication, mt, locale)
  const chronicLabel = mt.chronic ?? '慢箋'
  const isMedical = audience === 'medical'
  const showStatementChip =
    showSourceChip && medication.sourceResourceType === 'MedicationStatement'
  const terminology = medication.drugTerminology
  const integrated = (medication.reconciledOrderIds?.length ?? 0) > 1
  const sourceLabel = integrated ? (locale === 'en' ? 'Hospital + cloud' : '院內＋雲端')
    : medication.dataOrigin === 'hospital' ? (locale === 'en' ? 'Hospital' : '院內')
      : medication.dataOrigin === 'medcloud' ? (locale === 'en' ? 'MediCloud' : '雲端') : undefined
  const sourceDescription = integrated
    ? (locale === 'en' ? 'One matched prescription, with hospital and MediCloud source records retained.' : '同一筆藥囑的院內與健保雲端資料已整合，兩邊原始紀錄均保留。')
    : (locale === 'en' ? 'This source record has not been matched to an order from the other source.' : '這筆來源紀錄尚未確認與另一來源為同筆藥囑。')
  const hasMedicationDetails = !!(terminology || medication.hospitalMedicationName || medication.nhiDrugCode || integrated)
  const billingIcdTitle = medication.icdCode
    ? `${medication.icdCode}${medication.icdText ? ` ${medication.icdText}` : ''}`
    : mt.billingIcdTooltip
  const fullMedicationTitle = [
    medication.title,
    medication.secondaryTitle,
    terminology?.atcCode ? `ATC ${terminology.atcCode}` : undefined,
  ].filter(Boolean).join(' · ')
  const displayMedicationTitle =
    nameMode === 'product' && medication.secondaryTitle
      ? medication.secondaryTitle
      : medication.title
  const displayedRemainingDays = medication.displayRemainingDays ?? medication.daysRemaining
  const showDaysLeftIndicator =
    displayedRemainingDays !== undefined && !medication.isInactive
  const frequencyTitle = medication.frequency
    ? `${mt.dosageInstructionLabel ?? mt.frequencyLabel ?? '用法用量'}：${medication.frequency}`
    : undefined
  const routeTitle = medication.route
    ? `${mt.routeLabel ?? '途徑'}：${medication.route}`
    : undefined

  // The prescription lane follows the agreed scan order: coverage window,
  // dose, frequency, then dispensed quantity. Dates yield with an ellipsis
  // before the dose, frequency and quantity lose their space.
  const scheduleParts: Array<{
    key: string
    node: React.ReactNode
    fixed: boolean
  }> = []

  const formatCompactNumber = (value: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value)

  const durationLabel = medication.durationDays !== undefined
    ? (mt.durationCompact ?? (locale.startsWith('zh') ? '{n} 天' : '{n}d'))
      .replace('{n}', formatCompactNumber(medication.durationDays))
    : ''
  const durationSuffix = durationLabel
    ? (locale.startsWith('zh') ? `（${durationLabel}）` : ` (${durationLabel})`)
    : ''

  const { regimenRef, compactEndDate } = useMedicationEndDateFit(
    Boolean(durationLabel && !medication.isInactive && !executionPeriods?.length),
    [locale, medication.startedOn, medication.endDate, durationSuffix,
      medication.dose, medication.frequency, medication.totalQuantity].join('|'),
  )

  const normalizedExecutionPeriods = (executionPeriods ?? [])
    .filter((period) => period.start || period.end)
    .filter((period, index, all) => {
      const key = `${period.start || ''}|${period.end || ''}`
      return all.findIndex(
        (candidate) => `${candidate.start || ''}|${candidate.end || ''}` === key,
      ) === index
    })

  if (normalizedExecutionPeriods.length > 0) {
    const periodLabels = normalizedExecutionPeriods.map((period) => {
      const start = period.start
        ? sourceCalendarDate(period.start, locale)
        : ''
      const end = period.end
        ? sourceCalendarDate(period.end, locale)
        : start
      if (!start) return end
      if (!end || start === end) return start
      return `${start}–${end}`
    }).filter(Boolean)
    const executionLabel = `${mt.executionPeriod ?? '執行'} ${periodLabels.join('、')}`
    const executionTitle = `${executionLabel}${durationSuffix}`
    scheduleParts.push({
      key: 'execution-period',
      fixed: false,
      node: (
        <span className="block min-w-0 truncate" title={executionTitle}>
          {executionLabel}
          {durationSuffix && (
            <span data-medication-supply-days className="tabular-nums">
              {durationSuffix}
            </span>
          )}
        </span>
      ),
    })
  } else {
    // Generic medication list: keep supply days attached to the coverage
    // window. Inpatient execution dates use the branch above because they are
    // administration windows, not supply coverage.
    const displayStart = compactMedicationDate(medication.startedOn, locale)
    const displayEnd = compactMedicationDate(medication.endDate, locale)
    const titleStart = fullMedicationDate(medication.startedOn, locale)
    const titleEnd = fullMedicationDate(medication.endDate, locale)
    if (displayStart || displayEnd) {
      const fullDateLabel = titleStart && titleEnd
        ? `${titleStart} → ${titleEnd}`
        : (titleStart || titleEnd)
      const dateTitle = `${fullDateLabel}${durationSuffix}`

      scheduleParts.push({
        key: 'date',
        // Frequency and dispensed quantity are short, high-value facts that
        // must remain visible. Let the coverage window yield first when this
        // lane is narrow; its title and expanded history retain the full range.
        fixed: false,
        node: (
          <span
            data-testid="medication-schedule-date"
            className="block min-w-0 truncate tabular-nums"
            title={dateTitle}
          >
            {/* Only a known supply duration makes the end date redundant.
                Measure the complete regimen, including this end date, before
                compacting. Invisible text retains its measurable glyph width. */}
            {displayStart || displayEnd}
            {displayStart && displayEnd && (
              <span
                data-medication-schedule-end
                aria-hidden={compactEndDate || undefined}
                className={compactEndDate ? 'absolute invisible pointer-events-none' : undefined}
              >
                {` → ${displayEnd}`}
              </span>
            )}
            {durationSuffix && (
              <span data-medication-supply-days>{durationSuffix}</span>
            )}
          </span>
        ),
      })
    } else if (durationLabel) {
      scheduleParts.push({
        key: 'duration',
        fixed: true,
        node: (
          <span data-medication-supply-days className="tabular-nums">
            {durationLabel}
          </span>
        ),
      })
    }
  }

  // The instruction follows "（28 天）" directly: the full-width bracket
  // spaces itself. A bare "28 天" (no date) or a range without a duration
  // still needs the space.
  const joinsFrequencyWithoutSpace = (previousKey?: string) =>
    (previousKey === 'date' || previousKey === 'execution-period')
    && durationSuffix.startsWith('（')
  const shownDose = doseUnlessRepeated(medication.dose, medication.frequency)
  if (shownDose) {
    scheduleParts.push({
      key: 'dose',
      fixed: true,
      node: <span>{shownDose}</span>,
    })
  }

  if (medication.frequency && frequencyTitle) {
    scheduleParts.push({
      key: 'frequency',
      fixed: true,
      node: (
        <span
          data-medication-frequency
          aria-label={frequencyTitle}
          title={frequencyTitle}
          className="font-normal text-muted-foreground"
        >
          {medication.frequency}
        </span>
      ),
    })
  }

  if (medication.totalQuantity !== undefined) {
    const quantityLabel = (mt.totalQuantityCompact
      ?? (locale.startsWith('zh') ? '總量 {n}' : 'Total {n}'))
      .replace('{n}', formatCompactNumber(medication.totalQuantity))
    scheduleParts.push({
      key: 'total-quantity',
      fixed: true,
      node: (
        <span data-medication-total-quantity className="tabular-nums">
          {quantityLabel}
        </span>
      ),
    })
  }
  const firstRefillDate = shortDate(medication.firstRefillDate)
  const refillSummary = medication.refillCount > 1
    ? (firstRefillDate
        ? (mt.refillSummarySince
          ?? (locale.startsWith('zh')
            ? '累計 {count} 次 · {date} 起'
            : '{count} refills · since {date}'))
        : (mt.refillSummary
          ?? (locale.startsWith('zh') ? '累計 {count} 次' : '{count} refills')))
      .replace('{count}', String(medication.refillCount))
      .replace('{date}', firstRefillDate)
    : ''
  const refillCompact = medication.refillCount > 1
    ? (mt.refillSummary
      ?? (locale.startsWith('zh') ? '累計 {count} 次' : '{count} refills'))
      .replace('{count}', String(medication.refillCount))
    : ''
  const rowInstitution = visitContextInHeader ? undefined : medication.pharmacy
  const showIcd = isMedical && !!medication.icdCode && !visitContextInHeader
  // Below 456px the institution, ICD and refill count share a third line.
  // With the first two in the visit header, the refill count moves up to end
  // the regimen line, and the third line is dropped when nothing else is left
  // on it rather than left blank.
  const narrowRefillOnSecondLine = visitContextInHeader && !!refillCompact
  const narrowThirdLineEmpty = visitContextInHeader
    && !medication.isChronic
    && !((medication.overlapCount ?? 0) > 0)
    && !showStatementChip
    && !sourceLabel
  // A row under a visit header has nothing left in its middle column at
  // desktop widths, so from a 720px list it folds onto one line:
  // name | dates + regimen | class chips | status + refills. Below that it
  // keeps the two-line layout (the regimen needs ~300px of its own).
  const singleLineWhenWide = visitContextInHeader

  // Resource-navigation anchor — catalog cites MedicationRequest OR
  // MedicationStatement, so this row answers to both.
  const anchorRef = useResourceAnchor(
    ['MedicationRequest', 'MedicationStatement'],
    [...new Set([medication.id, ...(resourceNavigationIds ?? []), ...(medication.reconciledOrderIds ?? [])])],
    onResourceNavigationMatch,
  )

  return (
    <div
      ref={anchorRef}
      data-medication-row-layout="three-lane"
      data-medication-row-toggle={onRowToggle ? 'true' : undefined}
      onClick={onRowToggle ? (event) => {
        const target = event.target as HTMLElement
        const interactiveTarget = target.closest(
          'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
        )
        if (interactiveTarget && event.currentTarget.contains(interactiveTarget)) return
        onRowToggle()
      } : undefined}
      className={cn(
        "relative grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.75rem] gap-x-2 gap-y-0.5 overflow-hidden py-1 leading-tight transition-colors hover:bg-secondary/45 focus-within:bg-secondary/35 dark:hover:bg-secondary/45 dark:focus-within:bg-secondary/35",
        onRowToggle && "cursor-pointer",
        grouped || leadingControl ? "min-h-11 pl-9 pr-3" : "px-3",
        grouped
          ? "rounded-none border-0 bg-transparent"
          : "rounded-md border border-border/70 bg-muted/40 dark:border-border/80 dark:bg-muted/30",
        singleLineWhenWide
          && "@min-[45rem]:min-h-8 @min-[45rem]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,0.6fr)_8.5rem] @min-[45rem]:content-center",
      )}
    >
      {leadingControl && (
        <div className="absolute inset-y-0 left-0 flex w-9 items-stretch">
          {leadingControl}
        </div>
      )}
      {/* Medication/prescription lane: drug + route, then the full regimen.
          The identity wrapper dissolves into the row grid at every width. */}
      <div
        data-medication-cell="identity"
        className="contents"
      >
        <div className="col-span-2 col-start-1 row-start-1 flex h-4 min-w-0 items-center @min-[456px]:col-span-1">
          <MedicationTerminologyTooltip medication={medication} enabled>
            <span
              className={cn(
                "flex min-w-0 flex-1 items-baseline gap-1",
                hasMedicationDetails && "cursor-help",
              )}
              title={fullMedicationTitle}
              tabIndex={hasMedicationDetails ? 0 : undefined}
            >
              <span
                className="min-w-0 truncate text-[0.8125rem] font-semibold tracking-[-0.005em]"
              >
                {displayMedicationTitle}
              </span>
            </span>
          </MedicationTerminologyTooltip>
          {medication.selfPurchased && (
            <span className="ml-1 shrink-0 rounded-sm bg-muted px-1 text-[max(12px,0.75rem)] font-medium text-foreground/80">
              {locale.startsWith('zh') ? '自費／自購' : 'Self-pay'}
            </span>
          )}
          {medication.route && routeTitle ? (
            <span
              data-medication-route
              aria-label={routeTitle}
              title={routeTitle}
              className="ml-2 shrink-0 text-[0.6875rem] font-semibold text-foreground/80"
            >
              {medication.route}
            </span>
          ) : null}
        </div>

        <div
          data-medication-schedule
          className="contents whitespace-nowrap text-[0.6875rem] text-muted-foreground"
        >
          <div
            ref={regimenRef}
            data-medication-regimen
            className={cn(
              "relative col-span-3 col-start-1 row-start-2 flex h-4 min-w-0 items-center overflow-hidden whitespace-nowrap @min-[456px]:col-span-1",
              singleLineWhenWide && "@min-[45rem]:col-start-2 @min-[45rem]:row-start-1",
            )}
          >
            {scheduleParts.map((part, index) => (
              <span
                key={part.key}
                className={cn(
                  "inline-flex min-w-0 items-center",
                  part.fixed ? "shrink-0" : "shrink",
                )}
              >
                {index > 0 && (
                  <span
                    aria-hidden
                    data-medication-frequency-total-gap={
                      part.key === 'total-quantity'
                      && scheduleParts[index - 1]?.key === 'frequency'
                        ? 'true'
                        : undefined
                    }
                    data-medication-date-frequency-join={
                      part.key === 'frequency'
                      && joinsFrequencyWithoutSpace(scheduleParts[index - 1]?.key)
                        ? 'true'
                        : undefined
                    }
                    className="whitespace-pre"
                  >
                    {part.key === 'frequency'
                      && joinsFrequencyWithoutSpace(scheduleParts[index - 1]?.key)
                      ? ''
                      : ' '}
                  </span>
                )}
                {part.node}
              </span>
            ))}
            {/* Inside the regimen so the end-date fit measures both: the end
                date is dropped only when it and the count don't both fit. The
                leading spaces are text, so the gap is measured too. */}
            {narrowRefillOnSecondLine && (
              <span
                data-medication-refill-inline
                title={refillSummary}
                className="ml-auto shrink-0 whitespace-pre text-[0.625rem] tabular-nums text-muted-foreground/75 @min-[456px]:hidden"
              >
                {'  '}{refillCompact}
              </span>
            )}
          </div>
          <div
            data-medication-classification
            className={cn(
              "col-start-2 row-start-3 flex h-4 min-w-0 items-center gap-1 overflow-hidden @min-[456px]:row-start-2",
              narrowThirdLineEmpty && "@max-[456px]:hidden",
              singleLineWhenWide && "@min-[45rem]:col-start-3 @min-[45rem]:row-start-1",
            )}
          >
            {rowInstitution && (
              <TruncatedRevealLabel
                data-testid="medication-institution"
                text={rowInstitution}
                className={cn(
                  "inline-flex h-4 min-w-0 max-w-[8.5rem] shrink items-center text-[0.6875rem]",
                  CLINICAL_SOURCE_TONE,
                )}
              />
            )}
            {/* A clinician reading TAMSULOSIN does not need "未分類治療藥物"
                beside it; the class is the most derivable of the four facts on
                this line, so narrow rows spend that width on the institution
                instead and keep the class in the expanded detail. */}
            {medication.category && (
              <span
                title={medication.category}
                className={cn(medicationCategoryChipClass, "hidden shrink @min-[456px]:inline-flex")}
              >
                <span className="truncate">{medication.category}</span>
              </span>
            )}
            {medication.isChronic && (
              <span
                data-medication-chronic-slot
                data-visible="true"
                title={mt.chronicTooltip ?? 'Continuous long term therapy'}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0 text-[0.625rem] font-medium",
                  medicationChronicBadgeClass,
                )}
              >
                {chronicLabel}
              </span>
            )}
            {sourceLabel && (
              <TapTooltip
                asChild
                content={sourceDescription}
                contentClassName={`${clinicalTooltipSurfaceClass} max-w-[min(90vw,26rem)] whitespace-normal text-[max(12px,0.75rem)]`}
              >
                <span tabIndex={0} className="inline-flex shrink-0 cursor-help items-center rounded-sm bg-muted px-1 text-[max(12px,0.75rem)] font-medium text-foreground/80">
                  {sourceLabel}
                </span>
              </TapTooltip>
            )}
            {/* 慢箋 early-refill merge indicator: an earlier same-drug fill from
                the SAME institution is still inside its window and was folded
                into this row (one continuing prescription). Cross-institution
                same-drug rows are never merged — that would mask a potential
                duplicate-therapy signal. */}
            {(medication.overlapCount ?? 0) > 0 && (
              <span
                title={mt.renewedTooltip ?? 'Previous fill from the same institution still in window; showing the latest fill of one continuing prescription.'}
                className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-1.5 py-0 text-[0.625rem] font-medium text-muted-foreground"
              >
                {mt.renewed ?? '已續領'}
              </span>
            )}
            {showStatementChip && (
              <span
                title={sourceChipStatementTooltip ?? 'MedicationStatement (currently taking, per source)'}
                className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0 text-[0.625rem] font-medium text-primary"
              >
                {sourceChipStatementLabel ?? '目前服用'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ICD has a smaller flexible column; long descriptions must never
          establish a minimum width that squeezes the medication name. */}
      <div
        data-medication-cell="clinical"
        className={cn(
          "col-start-1 row-start-3 flex h-4 min-w-0 items-center overflow-hidden @min-[456px]:col-start-2 @min-[456px]:row-start-1",
          narrowThirdLineEmpty && "@max-[456px]:hidden",
          singleLineWhenWide && "@min-[45rem]:hidden",
        )}
      >
        <div
          data-medication-context
          data-medication-diagnosis
          className="flex h-4 min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap"
        >
          {showIcd && (
            <TapTooltip
              asChild
              content={billingIcdTitle}
              contentTestId="medication-icd-tooltip"
              contentClassName={cn(
                clinicalTooltipSurfaceClass,
                'max-w-[min(90vw,28rem)] whitespace-normal break-words text-xs leading-relaxed',
              )}
            >
              <button
                type="button"
                aria-label={billingIcdTitle}
                className={cn(medicationIcdChipClass, 'overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50')}
              >
                <span className={cn(medicationIcdCodeClass, 'max-w-full truncate')}>{medication.icdCode}</span>
                {medication.icdText && (
                  <span className={medicationIcdDescriptionClass}>
                    {medication.icdText}
                  </span>
                )}
              </button>
            </TapTooltip>
          )}
        </div>

      </div>

      {/* Supply lane: a fixed-width status/readout pair. Keeping both values
          in one column prevents short and long medicine names from shifting
          the clinically time-sensitive information. */}
      <div
        data-medication-cell="supply"
        className={cn(
          "col-start-3 row-start-1 row-span-2 contents w-[4.75rem] min-w-0 flex-col items-stretch @min-[456px]:flex",
          // Status stays at the right edge; the refill count sits to its left.
          singleLineWhenWide
            && "@min-[45rem]:col-start-4 @min-[45rem]:row-span-1 @min-[45rem]:w-auto @min-[45rem]:flex-row-reverse @min-[45rem]:items-center @min-[45rem]:gap-1.5",
        )}
      >
        <div
          className={cn(
            "col-start-3 row-start-1 flex h-4 items-center",
            singleLineWhenWide && "@min-[45rem]:w-[4.75rem] @min-[45rem]:shrink-0",
          )}
        >
          <Badge
            variant={badge.variant}
            className={cn(
              "h-4 w-full min-w-0 shrink-0 justify-center overflow-hidden px-1 py-0 text-[0.625rem]",
              showDaysLeftIndicator
                ? getMedicationDaysLeftBadgeClass(displayedRemainingDays!)
                : getMedicationStatusBadgeClass(
                    medication.isInactive ? 'ended' : medication.status,
                  ),
            )}
          >
            <span className="truncate">{badge.label}</span>
          </Badge>
        </div>
        <div
          className={cn(
            "col-start-3 row-start-3 flex h-4 min-w-0 items-center justify-end overflow-hidden text-[0.625rem] tabular-nums text-muted-foreground/75",
            (narrowRefillOnSecondLine || narrowThirdLineEmpty) && "@max-[456px]:hidden",
            singleLineWhenWide && "@min-[45rem]:flex-1",
          )}
        >
          {refillCompact && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="max-w-full truncate" tabIndex={0}>
                  {refillCompact}
                </span>
              </TooltipTrigger>
              <TooltipContent
                className={cn(
                  clinicalTooltipSurfaceClass,
                  "max-w-[min(90vw,20rem)] whitespace-normal text-xs leading-relaxed",
                )}
              >
                {refillSummary}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
