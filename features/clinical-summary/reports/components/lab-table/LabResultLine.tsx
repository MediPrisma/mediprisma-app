"use client"

import type { ReactNode } from 'react'
import {
  isObservationAbnormal,
  isReferenceRangeAssessmentUnavailable,
} from '@voho0000/clinical-lab-normalization/interpretation'
import { cn } from '@/src/shared/utils/cn.utils'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useCompactLayout } from '@/src/shared/hooks/layout/use-compact-layout.hook'
import { HighlightText } from '@/src/shared/components/HighlightText'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import type { Observation } from '../../types'
import { getReferenceRangeText } from '../../utils/fhir-helpers'
import {
  ObservationLongitudinalAffordance,
  rowLongitudinalHandlers,
  useObservationLongitudinal,
} from '../ObservationLongitudinalAction'
import { LAB_ROW_BASE, LAB_TABLE_LAYOUT, stripRangeBrackets, type LabTableVariant } from './lab-table-layout'
import {
  LabFlagMark,
  LabRowMenu,
  RangeUnassessedMark,
  getLabFlag,
  getLabResultParts,
  useLabCopy,
  type LabRowMenuItem,
} from './lab-result-cells'

export interface LabResultLineProps {
  variant: LabTableVariant
  observation: Observation
  title: string
  query?: string
  /** `member` = an analyte inside an open panel: indented under the panel name,
   *  no source/date of its own (the panel header carries them). */
  level?: 'top' | 'member'
  /** Trend/history detail identity. Omit to render the name as plain text
   *  (component sub-results have no series of their own). */
  longitudinal?: {
    sourceId: string
    reportTitle?: string
    reportLookupTitle?: string
  }
  /** Source column content (institution, program, duplicate warnings). */
  source?: ReactNode
  /** Plain text for the source on the narrow second line. */
  sourceText?: string
  date?: string
  /** Day view: same-analyte serials on one day still need their draw time. */
  timeLabel?: string
  /** Trailing note on the narrow second line (e.g. a duplicate warning). */
  note?: ReactNode
  dataTour?: string
}

export function LabResultLine({
  variant,
  observation,
  title,
  query,
  level = 'top',
  longitudinal: longitudinalSource,
  source,
  sourceText,
  date,
  timeLabel,
  note,
  dataTour,
}: LabResultLineProps) {
  const { t, locale } = useLanguage()
  const layout = LAB_TABLE_LAYOUT[variant]
  const strings = t.reports.labTable
  const referenceStrings = t.reports.referenceComparison
  const compactLayout = useCompactLayout()
  const copy = useLabCopy()

  const parts = getLabResultParts(observation)
  const abnormal = isObservationAbnormal(observation)
  const flag = getLabFlag(observation, locale, { above: referenceStrings.above, below: referenceStrings.below })
  const rangeText = stripRangeBrackets(getReferenceRangeText(observation.referenceRange))
  const rangeUnassessed = isReferenceRangeAssessmentUnavailable(observation)
  // Short text results ("Negative", ">40") sit in the value column like a
  // number. A longer one reads as a phrase, not a figure: it starts at the
  // value column, runs left-to-right over the unit (and the flag, when there is
  // none), and wraps rather than squeezing the name or truncating.
  const longText = parts.isText && parts.value.length > 8
  // 未判讀 answers the same question as ↑H / ↓L — "was this value judged?" — so
  // it lives in the flag column, not in front of the range text.
  const showUnassessed = !flag && rangeUnassessed
  const longTextTakesFlag = longText && !flag && !showUnassessed

  const detail = useObservationLongitudinal({
    observation: longitudinalSource ? observation : null,
    title: title || (locale.startsWith('zh') ? '檢驗項目' : 'Result'),
    sourceId: longitudinalSource?.sourceId ?? 'lab-table:none',
    reportTitle: longitudinalSource?.reportTitle,
    reportLookupTitle: longitudinalSource?.reportLookupTitle,
  })
  const canOpen = !!longitudinalSource && detail.available
  // Single-panel layout: the whole row is the tap target (same rule as every
  // other report row). Desktop: the name is the button.
  const rowOpens = compactLayout && canOpen
  const rowHandlers = rowLongitudinalHandlers(detail.show)

  const resultText = [parts.value, parts.unit].filter(Boolean).join(' ')
  const copyLine = [
    `${title} ${resultText}`,
    flag ? `(${flag.label})` : '',
    rangeText ? `${strings.referencePrefix} ${rangeText}` : '',
    timeLabel || date || '',
  ].filter(Boolean).join(' ')

  const menuItems: LabRowMenuItem[] = [
    ...(canOpen ? [{ key: 'trend', label: detail.actionLabel, onSelect: detail.show }] : []),
    { key: 'copy-result', label: strings.copyResult, onSelect: () => void copy(copyLine) },
    { key: 'copy-name', label: strings.copyName, onSelect: () => void copy(title) },
  ]

  const nameNode = (
    <>
      <span className="min-w-0 truncate">
        <HighlightText text={title} query={query} />
      </span>
      {canOpen && (
        <ObservationLongitudinalAffordance
          mode={detail.mode}
          isActive={detail.isActive}
          className="h-3.5 w-3.5 opacity-70"
        />
      )}
    </>
  )

  const rangeContent = rangeText ? <span className="line-clamp-2 break-words" title={rangeText}>{rangeText}</span> : null

  // A very long phrase is clamped to three lines; the whole text stays one tap
  // away.
  const valueNode = longText && parts.value.length > 60 ? (
    <TapTooltip
      content={parts.value}
      aria-label={parts.value}
      contentClassName="max-w-[min(90vw,24rem)] whitespace-normal break-words text-xs leading-relaxed"
      className="block min-w-0 max-w-full text-left"
    >
      <span className="line-clamp-3">{parts.value}</span>
    </TapTooltip>
  ) : parts.value

  return (
    <div
      data-testid="lab-result-line"
      data-level={level}
      data-tour={dataTour}
      role={rowOpens ? 'button' : undefined}
      tabIndex={rowOpens ? 0 : undefined}
      aria-label={rowOpens ? detail.describe(`${title} ${resultText}`) : undefined}
      onClick={rowOpens ? rowHandlers.onClick : undefined}
      onKeyDown={rowOpens ? rowHandlers.onKeyDown : undefined}
      className={cn(
        LAB_ROW_BASE,
        layout.grid,
        rowOpens && 'cursor-pointer',
        detail.isActive ? 'bg-primary/5' : 'hover:bg-muted/40',
      )}
    >
      <div className="col-start-1 row-start-1" aria-hidden="true" />

      <div className={cn('col-start-2 row-start-1 flex min-w-0 items-center gap-1.5', level === 'member' && 'pl-1')}>
        {level === 'member' && (
          <span aria-hidden="true" className="-mt-2.5 h-3 w-2 shrink-0 border-b border-l border-border" />
        )}
        {canOpen && !rowOpens ? (
          <button
            type="button"
            onClick={detail.show}
            title={detail.describe(title)}
            data-testid="lab-result-name"
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-sm text-left hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              detail.isActive ? 'font-medium text-primary' : 'text-foreground',
            )}
          >
            {nameNode}
          </button>
        ) : (
          <span
            data-testid="lab-result-name"
            title={title}
            className={cn('flex min-w-0 items-center gap-1', detail.isActive && 'font-medium text-primary')}
          >
            {nameNode}
          </span>
        )}
        {timeLabel && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeLabel}</span>
        )}
        {/* The day view has no source column, so its notes ride with the name. */}
        {variant === 'day' && note && <span className="flex shrink-0 items-center gap-1">{note}</span>}
      </div>

      <div
        data-testid="lab-result-value"
        data-text-result={longText ? 'long' : undefined}
        className={cn(
          'col-start-3 row-start-1 min-w-0 font-semibold tabular-nums',
          longText
            ? cn('max-w-[12rem] whitespace-normal break-words text-left leading-snug', longTextTakesFlag ? 'col-end-6' : 'col-end-5')
            : 'whitespace-nowrap text-right',
          abnormal ? 'text-clinical-abnormal' : 'text-foreground',
        )}
      >
        {valueNode}
      </div>
      {!longText && (
        <div data-testid="lab-result-unit" className="col-start-4 row-start-1 min-w-0 truncate text-xs text-muted-foreground" title={parts.unit || undefined}>
          {parts.unit}
        </div>
      )}
      {!longTextTakesFlag && (
        <div className="col-start-5 row-start-1 text-center text-xs tabular-nums">
          {showUnassessed ? (
            <RangeUnassessedMark label={referenceStrings.unassessed} tooltip={referenceStrings.unassessedTooltip} />
          ) : (
            <LabFlagMark flag={flag} rangeTooltip={referenceStrings.tooltip} />
          )}
        </div>
      )}

      <div data-testid="lab-result-range" className={cn(layout.wideOnly, layout.range, 'min-w-0 text-xs text-muted-foreground')}>
        {rangeContent}
      </div>
      <div className={cn(layout.wideOnly, layout.source, 'min-w-0 text-xs text-muted-foreground')}>
        {source}
      </div>
      <div className={cn(layout.wideOnly, layout.date, 'whitespace-nowrap text-xs tabular-nums text-muted-foreground')}>
        {date}
      </div>
      <LabRowMenu items={menuItems} label={strings.moreActions} className={layout.menu} />

      <div className={cn(layout.narrowOnly, 'col-start-2 col-end-7 row-start-2 flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground')}>
        <span className="min-w-0 flex-1">{rangeContent}</span>
        {(sourceText || date || (variant === 'flat' && note)) && (
          <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap tabular-nums">
            {variant === 'flat' && note}
            {sourceText && <span className="max-w-[9rem] truncate">{sourceText}</span>}
            {date && <span>{date}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
