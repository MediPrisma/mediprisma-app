"use client"

// Lab-tab rows on the shared column grid (see lab-table-layout.ts).
//
// One dispatcher for everything the 檢驗 tab lists:
//   • a single result          → one LabResultLine with its own source + date
//   • a multi-analyte panel    → a header on the same columns + member lines
//   • a collection-day group   → a day header + one line per analyte
// Rows the grid cannot express faithfully — images, NHI viewer links, shared
// narratives, long free text, empty reports — keep the full ReportRow, so no
// capability is lost for the rare report that carries one.

import { memo, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/src/shared/utils/cn.utils'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useRightDetail } from '@/src/application/providers/right-detail.provider'
import { getAnalyteDisplayForMode } from '@/src/shared/utils/lab-analyte-display.utils'
import { HighlightText } from '@/src/shared/components/HighlightText'
import type { Observation, Row } from '../../types'
import { formatDate } from '../../utils/fhir-helpers'
import { countAbnormalInRows } from '../../utils/lab-day-grouping'
import { useReportNameMode } from '../../context/report-name-mode.context'
import {
  BridgeDupBadge,
  CopyableRightDetailTitle,
  ReportPanelDetail,
  ReportRow,
  countAbnormal,
  formatDisplayDate,
  formatTimeOnly,
} from '../ReportRow'
import { ReportInstitutionLabel, formatReportInstitution } from '../ReportInstitutionLabel'
import { NhiMedicloudSourceIndicator } from '../NhiMedicloudSourceIndicator'
import { ReportSourceProgramBadge } from '../ReportSourceProgramBadge'
import { LAB_ROW_BASE, LAB_TABLE_LAYOUT, type LabTableVariant } from './lab-table-layout'
import { LabRowMenu, getLabResultParts, useLabCopy, type LabRowMenuItem } from './lab-result-cells'
import { LabResultLine } from './LabResultLine'

interface LabReportRowProps {
  row: Row
  variant: LabTableVariant
  defaultOpen: string[]
  query?: string
}

function isNarrative(observation: Observation): boolean {
  return observation.code?.text === 'Report Summary'
    || (!observation.valueQuantity && (observation.valueString?.length ?? 0) > 80)
    || (observation as { _detailsOnly?: boolean })._detailsOnly === true
}

/** Reports whose content the column grid cannot carry without dropping a
 *  capability — these keep the full ReportRow. */
function needsFullReportRow(row: Row): boolean {
  return row.obs.length === 0
    || (row.images?.length ?? 0) > 0
    || (row.viewerActions?.length ?? 0) > 0
    || (row.sharedReportSources?.length ?? 0) > 1
    || row.obs.some(isNarrative)
}

function isSingleResult(row: Row): boolean {
  return row.obs.length === 1 && !(row.obs[0].component?.length)
}

function useRowSource(row: Row) {
  const { t, locale } = useLanguage()
  const tr = t.reports
  const medicloud = row.sourceProvenance === 'nhi-medicloud'
  const sourceProgramLabel = tr.sourcePrograms?.adultPreventive
  const duplicateNote = row.isPossibleDuplicate ? (
    <span className="whitespace-nowrap text-amber-700 dark:text-amber-400">⚠ 可能重複</span>
  ) : null
  const node = (
    <span className="flex min-w-0 items-center gap-1">
      <ReportSourceProgramBadge
        sourceProgram={row.sourceProgram}
        label={sourceProgramLabel}
        shortLabel={tr.sourcePrograms?.adultPreventiveShort}
        className="px-1 py-0"
      />
      {medicloud ? (
        <NhiMedicloudSourceIndicator institution={row.institution} compact className="min-w-0 max-w-full" />
      ) : row.institution ? (
        <ReportInstitutionLabel institution={row.institution} locale={locale} className="min-w-0 text-muted-foreground dark:text-muted-foreground [&_svg]:hidden" />
      ) : null}
      {row.bridgeDupCount && row.bridgeDupCount > 0 ? <BridgeDupBadge count={row.bridgeDupCount} /> : null}
      {duplicateNote}
    </span>
  )
  const text = row.institution
    ? formatReportInstitution(row.institution, locale)
    : medicloud ? tr.sourceProvenance.nhiMedicloud.compactLabel : ''
  return { node, text, duplicateNote }
}

function FullReportRow({ row, defaultOpen, query, hideMeta }: { row: Row; defaultOpen: string[]; query?: string; hideMeta?: boolean }) {
  return (
    <div data-testid="lab-full-report-row" className="border-b border-border/70 px-1.5 py-1">
      <ReportRow row={row} defaultOpen={defaultOpen} query={query} hideMeta={hideMeta} />
    </div>
  )
}

function SingleResultRow({ row, query }: { row: Row; query?: string }) {
  const source = useRowSource(row)
  const observation = row.obs[0]
  return (
    <LabResultLine
      variant="flat"
      observation={observation}
      title={row.title}
      query={query}
      longitudinal={{
        sourceId: `report-longitudinal:${row.id}:${observation?.id || 'first'}`,
        reportTitle: row.title,
        reportLookupTitle: row.rawTitle,
      }}
      source={source.node}
      sourceText={source.text}
      date={formatDisplayDate(row.effectiveDate, row.showTime)}
      note={source.duplicateNote}
      dataTour="report-tour-row"
    />
  )
}

interface MemberLine {
  key: string
  observation: Observation
  title: string
  hasSeries: boolean
}

function usePanelMembers(observations: Observation[]): MemberLine[] {
  const { locale } = useLanguage()
  const { audience } = useAudience()
  const nameMode = useReportNameMode()
  return useMemo(() => {
    const lines: MemberLine[] = []
    observations.forEach((observation, index) => {
      const title = getAnalyteDisplayForMode(observation, audience, locale, nameMode)
      const components = observation.component ?? []
      const hasOwnValue = !!(observation.valueQuantity || observation.valueString || observation.valueCodeableConcept)
      if (components.length === 0 || hasOwnValue) {
        lines.push({ key: `obs-${observation.id ?? index}`, observation, title, hasSeries: components.length === 0 })
      }
      components.forEach((component, componentIndex) => {
        lines.push({
          key: `obs-${observation.id ?? index}-c${componentIndex}`,
          observation: component as Observation,
          title: getAnalyteDisplayForMode(component, audience, locale, nameMode),
          hasSeries: false,
        })
      })
    })
    return lines
  }, [observations, audience, locale, nameMode])
}

function panelCopyText(title: string, members: MemberLine[], date: string): string {
  const lines = members.map((member) => {
    const parts = getLabResultParts(member.observation)
    return `${member.title} ${[parts.value, parts.unit].filter(Boolean).join(' ')}`
  })
  return [date ? `${title}（${date}）` : title, ...lines].join('\n')
}

function PanelRow({ row, defaultOpen, query }: { row: Row; defaultOpen: string[]; query?: string }) {
  const { t } = useLanguage()
  const strings = t.reports.labTable
  const layout = LAB_TABLE_LAYOUT.flat
  const source = useRowSource(row)
  const copy = useLabCopy()
  const members = usePanelMembers(row.obs)
  const abnormalCount = countAbnormal(row.obs)
  const dateLabel = formatDisplayDate(row.effectiveDate, row.showTime)

  const autoOpen = defaultOpen.includes(row.id)
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? autoOpen

  // 向右展開 — kept for panels of three or more analytes, as before.
  const { detail: rightDetail, toggleDetail } = useRightDetail()
  const panelSourceId = `report:${row.id}`
  const rightActive = rightDetail?.sourceId === panelSourceId
  const canOpenRight = row.obs.length >= 3

  const menuItems: LabRowMenuItem[] = [
    ...(canOpenRight ? [{
      key: 'right',
      label: rightActive ? strings.closeRight : strings.openRight,
      onSelect: () => toggleDetail({
        sourceId: panelSourceId,
        title: <CopyableRightDetailTitle title={row.title} dateLabel={dateLabel} />,
        node: <ReportPanelDetail key={panelSourceId} observations={row.obs} sharedReportSources={row.sharedReportSources} />,
      }),
    }] : []),
    { key: 'copy-panel', label: strings.copyPanel, onSelect: () => void copy(panelCopyText(row.title, members, dateLabel)) },
    { key: 'copy-name', label: strings.copyName, onSelect: () => void copy(row.title) },
  ]

  const countLabel = strings.itemCount.replace('{n}', String(row.obs.length))
  const abnormalLabel = abnormalCount > 0 ? t.reports.abnormalCount.replace('{n}', String(abnormalCount)) : ''

  return (
    <div data-testid="lab-panel">
      <div
        data-testid="lab-panel-header"
        className={cn(LAB_ROW_BASE, layout.grid, layout.gap, rightActive ? 'bg-primary/5' : 'bg-muted/30')}
      >
        {/* The title runs over the result / unit / flag tracks — a panel row
            has no value of its own, and real panel names run long (half the
            雲端病歷 order names are wider than 270px). The count follows it. */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setManualOpen(!open)}
          data-tour="report-tour-row"
          className={cn(
            layout.panelTitle,
            'flex min-w-0 items-baseline rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        >
          <span className={cn('flex shrink-0 justify-start self-center text-muted-foreground', layout.panelChevron)}>
            <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          </span>
          <span className={cn('min-w-0 font-semibold', open ? 'whitespace-normal break-words' : 'truncate')} title={row.title}>
            <HighlightText text={row.title} query={query} />
          </span>
          <span data-testid="lab-panel-count" className="ml-2 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {countLabel}
          </span>
          {abnormalLabel && (
            <span data-testid="lab-panel-abnormal" className="ml-1.5 shrink-0 whitespace-nowrap text-xs font-semibold text-clinical-abnormal">
              {abnormalLabel}
            </span>
          )}
        </button>
        <div className={cn(layout.wideOnly, layout.range)} />
        <div className={cn(layout.wideOnly, layout.meta, '@container min-w-0 text-xs text-muted-foreground')}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex min-w-0 flex-1 items-center">{source.node}</span>
            {dateLabel && <span className="shrink-0 whitespace-nowrap tabular-nums">{dateLabel}</span>}
          </span>
        </div>
        <LabRowMenu items={menuItems} label={strings.moreActions} className={layout.menu} />
        <div className={cn(layout.narrowOnly, 'col-start-2 col-end-7 row-start-2 flex min-w-0 items-baseline justify-end gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground')}>
          {source.duplicateNote}
          {source.text && <span className="min-w-0 truncate">{source.text}</span>}
          {dateLabel && <span>{dateLabel}</span>}
        </div>
      </div>
      {open && members.map((member) => (
        <LabResultLine
          key={member.key}
          variant="flat"
          level="member"
          observation={member.observation}
          title={member.title}
          query={query}
          longitudinal={member.hasSeries ? {
            sourceId: `observation-longitudinal:${member.observation.id || `${member.title}:${member.observation.effectiveDateTime || ''}`}`,
          } : undefined}
        />
      ))}
    </div>
  )
}

function DaySection({ row, defaultOpen, query }: { row: Row; defaultOpen: string[]; query?: string }) {
  const { t, locale } = useLanguage()
  const tr = t.reports
  const { audience } = useAudience()
  const nameMode = useReportNameMode()
  const members = useMemo(() => row.groupedRows ?? [], [row.groupedRows])
  const source = useRowSource(row)

  const autoOpen = !!query?.trim() || members.some((member) => defaultOpen.includes(member.id))
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? autoOpen

  // Panels flatten to their analytes: a day's lab sheet reads as one list.
  // Reports the grid cannot carry stay whole (FullReportRow).
  const entries = useMemo(() => {
    const out: Array<{ kind: 'line'; key: string; member: Row; observation: Observation; title: string; first: boolean } | { kind: 'full'; key: string; member: Row }> = []
    for (const member of members) {
      if (needsFullReportRow(member)) {
        out.push({ kind: 'full', key: member.id, member })
        continue
      }
      member.obs.forEach((observation, index) => {
        const label = getAnalyteDisplayForMode(observation, audience, locale, nameMode)
        out.push({
          kind: 'line',
          key: `${member.id}::obs${index}`,
          member,
          observation,
          title: label && label !== '—' ? label : member.title,
          // The duplicate signals describe the report, not each analyte.
          first: index === 0,
        })
      })
    }
    return out
  }, [members, audience, locale, nameMode])

  const abnormalCount = useMemo(() => countAbnormalInRows(members), [members])
  const itemCount = useMemo(() => members.reduce((n, m) => n + Math.max(1, m.obs.length), 0), [members])
  const labelId = (id: string) => id !== 'other'
    ? ((tr.cumulativeCategories as Record<string, string> | undefined)?.[id] ?? id)
    : ((tr.otherSubgroup as string) || 'Other')
  const labelIds = row.dayGroupLabelIds ?? (row.dayGroupCategoryId ? [row.dayGroupCategoryId] : [])
  const categoryLabel = labelIds.length ? labelIds.map(labelId).join('・') : ((tr.otherSubgroup as string) || 'Other')
  const allOpen = useMemo(() => [...new Set([...defaultOpen, ...members.map((m) => m.id)])], [defaultOpen, members])

  return (
    <div data-testid="lab-day-section">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen(!open)}
        data-tour="report-tour-row"
        className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/70 bg-muted/40 px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <span data-testid="lab-day-date" className="whitespace-nowrap font-semibold tabular-nums text-foreground">
            {formatDate(row.effectiveDate)}
          </span>
          <span data-testid="lab-day-category" className="whitespace-nowrap text-foreground">{categoryLabel}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{source.node}</span>
        </span>
        <span data-testid="lab-day-metrics" className="ml-auto flex shrink-0 items-baseline gap-3 text-xs tabular-nums">
          <span data-testid="lab-day-item-count" className="text-muted-foreground">
            {tr.labTable.itemCount.replace('{n}', String(itemCount))}
          </span>
          <span data-testid="lab-day-abnormal-count" className="min-w-[3.5rem] text-right font-semibold text-clinical-abnormal">
            {abnormalCount > 0 ? tr.abnormalCount.replace('{n}', String(abnormalCount)) : ''}
          </span>
        </span>
      </button>
      {open && entries.map((entry) => entry.kind === 'full' ? (
        <FullReportRow key={entry.key} row={entry.member} defaultOpen={allOpen} query={query} hideMeta />
      ) : (
        <LabResultLine
          key={entry.key}
          variant="day"
          observation={entry.observation}
          title={entry.title}
          query={query}
          longitudinal={{
            sourceId: `report-longitudinal:${entry.key}:${entry.observation.id || 'first'}`,
            reportTitle: entry.member.title,
            reportLookupTitle: entry.member.rawTitle,
          }}
          timeLabel={entry.member.showTime ? formatTimeOnly(entry.member.effectiveDate) : undefined}
          note={entry.first && (entry.member.isPossibleDuplicate || entry.member.bridgeDupCount) ? (
            <>
              {entry.member.bridgeDupCount ? <BridgeDupBadge count={entry.member.bridgeDupCount} /> : null}
              {entry.member.isPossibleDuplicate && (
                <span className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-400">⚠ 可能重複</span>
              )}
            </>
          ) : undefined}
        />
      ))}
    </div>
  )
}

function LabReportRowImpl({ row, variant, defaultOpen, query }: LabReportRowProps) {
  if (row.dayGroup) return <DaySection row={row} defaultOpen={defaultOpen} query={query} />
  if (needsFullReportRow(row)) {
    return <FullReportRow row={row} defaultOpen={defaultOpen} query={query} hideMeta={variant === 'day'} />
  }
  if (isSingleResult(row)) return <SingleResultRow row={row} query={query} />
  return <PanelRow row={row} defaultOpen={defaultOpen} query={query} />
}

export const LabReportRow = memo(LabReportRowImpl)
