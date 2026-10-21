"use client"

// 檢驗 — a compact analyte × collection-day pivot.
//
// The 報告 tab's LabPivotTable is transposed (rows = dates, columns = tests)
// and owns its own scrolling/virtualisation, neither of which fits a card that
// must not scroll. This section therefore renders its own grid from the SAME
// LabPivot model (buildLabPivots) and reuses the cell tones — no second pivot
// builder, and no app-side abnormal determiner: `cell.isAbnormal` comes from
// the source's own interpretation / reference range.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { ClipboardCopy, FlaskConical, Pencil, TrendingUp } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import type { OverviewLabMode } from '@/src/application/stores/outpatient-prefs.store'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  buildLabPivots,
  primaryCellRecord,
  recordDisplayValue,
  type LabCell,
  type LabCellRecord,
  type LabRow,
} from '@/src/shared/utils/lab-pivot.utils'
import { useLabTrendOpener } from '@/features/clinical-summary/reports/hooks/useLabTrendOpener'
import { preloadCumulativeLabTrendModule } from '@/features/clinical-summary/reports/components/cumulative-lab-trend-loader'
import type { OverviewLabRow, OverviewLabsData } from '../hooks/useOverviewData'
import type { OverviewSectionFit } from '../overview.types'
import { OVERVIEW_SECTION_DOM_ID } from '../overview.types'
import { OverviewSectionCard } from './OverviewSectionCard'
import {
  OverviewEmptyRow,
  OverviewExpandButton,
  OverviewFullListDialog,
  OverviewTruncationNote,
} from './OverviewSectionParts'
import { OVERVIEW_EMPTY_CLASS, overviewChipClass } from './overview-styles'
import { PinnedLabsEditorDialog } from './PinnedLabsEditorDialog'
import { selectPinnedOverviewRows, systemDefaultPinnedLabIds } from '../utils/overview-selectors'

type LabMode = OverviewLabMode

const NO_OBSERVATIONS: readonly any[] = []

function shortDayLabel(day: string): string {
  return day.length >= 10 ? `${day.slice(5, 7)}/${day.slice(8, 10)}` : day
}

/**
 * One value per cell, plus a marker when the day held more.
 *
 * `buildLabPivots` deliberately keeps every same-analyte/same-day record and
 * renders them as "37.87 / 37.63" — right for the 累積報告, which is the audit
 * view, but in a ~57px overview column that string is the only thing that
 * truncates, and it truncates into a number nobody can read.
 *
 * The FIRST valid record is the one shown. For eGFR — where these pairs mostly
 * come from — the second value is the NHI's own automatic calculation
 * alongside the reporting lab's, not a revision of it, so "latest wins" would
 * quietly prefer the derived number over the reported one.
 *
 * The shown value carries ITS OWN comparator and flag (primaryCellRecord): the
 * cell's merged flag belongs to "some record that day", and gluing another
 * record's ↑ to a normal number is a clinical error. Entered-in-error and
 * cancelled records never show. When another valid record of the day is
 * abnormal, the count marker says so in the abnormal colour, and the tooltip
 * lists every value with its own unit and flag.
 */
function flagArrow(record: LabCellRecord): string {
  if (!record.isAbnormal) return ''
  if (record.interpretationCode?.startsWith('H')) return ' ↑'
  if (record.interpretationCode?.startsWith('L')) return ' ↓'
  return ''
}

function summariseCell(cell: LabCell): {
  shown: string
  record: LabCellRecord
  total: number
  otherAbnormal: boolean
  everyValue: string
} | null {
  const primary = primaryCellRecord(cell)
  if (!primary) return null
  const { record, valid } = primary
  return {
    shown: recordDisplayValue(record),
    record,
    total: valid.length,
    otherAbnormal: valid.some((other) => other !== record && other.isAbnormal),
    everyValue: valid
      .map((each) => `${recordDisplayValue(each)}${flagArrow(each)}${each.unit ? ` ${each.unit}` : ''}`)
      .join(' / '),
  }
}

// A cell narrow enough to clip its content is the one place the pivot hides
// something. `title` alone was not enough: it waits on the browser's own delay
// and never appears for touch or keyboard. TapTooltip is the component the
// clinical rows already use for exactly this — hover, tap and focus all reveal
// the full text. Applied only past this length so the ~70 short numeric cells
// of a full pivot do not each mount a tooltip they will never show.
const OVERVIEW_LAB_TOOLTIP_MIN_CHARS = 8

function CellText({ text, className }: { text: string; className?: string }) {
  if (text.length < OVERVIEW_LAB_TOOLTIP_MIN_CHARS) {
    return <span className={className}>{text}</span>
  }
  return (
    <TapTooltip
      content={text}
      aria-label={text}
      asChild
      contentClassName="max-h-[60vh] max-w-[min(90vw,24rem)] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed"
    >
      <span tabIndex={0} className={className}>{text}</span>
    </TapTooltip>
  )
}

/** Keep the newest (rightmost) dates visible when the viewport changes. */
function LabScrollRegion({ children, dateKey }: { children: ReactNode; dateKey: string }) {
  const { t, locale } = useLanguage()
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1)
      element.scrollLeft = element.scrollWidth
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [dateKey])
  return (
    <div className="min-w-0 max-w-full shrink-0">
      {overflow && (
        <p className="mb-1 text-xs text-muted-foreground">
          {locale === 'zh-TW' ? '左右捲動查看其他日期' : 'Scroll horizontally for other dates'}
        </p>
      )}
      <div ref={ref} role="region" aria-label={t.overview.sections.labs} tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {children}
      </div>
    </div>
  )
}

export function OverviewLabsSection({
  data,
  fit,
  flash = false,
  headingRef,
}: {
  data: OverviewLabsData
  fit: OverviewSectionFit
  flash?: boolean
  headingRef?: Ref<HTMLDivElement>
}) {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const { audience } = useAudience()
  const { revealTab } = useRightPanel()
  const prefs = useOutpatientPrefs()
  // The last mode chosen is remembered, so a clinician who reads 「自訂」
  // opens every next patient on it.
  const mode: LabMode = prefs.labMode ?? 'pinned'
  const setMode = prefs.setLabMode
  const [listOpen, setListOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const pinnedIds = useMemo(() => prefs.pinnedLabs ?? [], [prefs.pinnedLabs])
  const systemDefaultIds = useMemo(() => systemDefaultPinnedLabIds(), [])

  // The whole chart, pivoted once and only after first paint: it only adds
  // the trend buttons, never the card's own values, so the card must not
  // wait for it.
  const allObservations = data.allObservations ?? NO_OBSERVATIONS
  const deferredObservations = useDeferredValue(allObservations, NO_OBSERVATIONS)
  const fullPivots = useMemo(
    () => (deferredObservations.length ? buildLabPivots(deferredObservations as any[]) : null),
    [deferredObservations],
  )
  const { openTrend, activeTrendSourceId, trendDialog } = useLabTrendOpener({ observations: allObservations as any[] })
  // A row's trend is the cumulative report's trend for the same analyte: same
  // series, same chartability rule (`trendChartable` from the pivot build).
  const trendRows = useMemo(() => {
    const byMapKey = new Map<string, LabRow>()
    const byTestKey = new Map<string, LabRow>()
    for (const pivot of Object.values(fullPivots ?? {})) {
      for (const row of pivot.rows) {
        if (!row.trendChartable) continue
        byMapKey.set(`${pivot.category.id}|${row.mapKey}`, row)
        if (!byTestKey.has(`${pivot.category.id}|${row.testKey}`)) byTestKey.set(`${pivot.category.id}|${row.testKey}`, row)
      }
    }
    return { byMapKey, byTestKey }
  }, [fullPivots])
  const trendRowFor = (row: OverviewLabRow): LabRow | undefined => {
    // 自訂 rows with nothing in the window carry no pivot mapKey.
    if (row.mapKey.startsWith('pinned-empty:')) {
      return row.testKey ? trendRows.byTestKey.get(`${row.categoryId}|${row.testKey}`) : undefined
    }
    // The overview prefixes the pivot's mapKey with its category.
    const prefix = `${row.categoryId}:`
    const pivotMapKey = row.mapKey.startsWith(prefix) ? row.mapKey.slice(prefix.length) : row.mapKey
    return trendRows.byMapKey.get(`${row.categoryId}|${pivotMapKey}`)
  }
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardWidth, setCardWidth] = useState(0)
  useEffect(() => {
    const element = cardRef.current
    if (!element) return
    const measure = () => setCardWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data.rows.length, mode])
  // 「常用」 only makes sense while the standard panels actually have rows in
  // range; otherwise the card would look empty for a filter the patient's data
  // cannot satisfy.
  const effectiveMode: LabMode = mode === 'pinned' && data.pinnedRowCount === 0 ? 'all' : mode
  const isMine = effectiveMode === 'mine'

  // 「自訂」 is the same pivot as the other three filters — the clinician's
  // own rows, in their order, over the same collection-day columns.
  const matched = useMemo(() => {
    if (isMine) return selectPinnedOverviewRows(pinnedIds, data.rows, data.columns.length)
    return data.rows.filter((row) => {
      if (effectiveMode === 'pinned' && !row.isPinned) return false
      if (effectiveMode === 'abnormal' && !row.hasAbnormal) return false
      return true
    })
  }, [data.rows, data.columns.length, effectiveMode, isMine, pinnedIds])
  const mineHasResults = isMine && matched.some((row) => row.cells.some(Boolean))

  // Row budget. Category dividers are charged where they actually occur —
  // reserving one per category up-front would leave most of the card empty,
  // since a truncated list only reaches the first couple of categories.
  // Every matched analyte renders; the card scrolls. The pivot's own header
  // row stays put because it is inside the scrolling grid's first rows — see
  // the sticky treatment below.
  const shown = matched
  const hidden = 0
  const columns = data.columns
  const cardColumnCount = Math.max(1, Math.floor((cardWidth - 112) / 72))


  // Zebra striping is derived up-front so the JSX stays a pure map (no
  // mutation during render), and it restripes per list — the dialog shows more
  // rows than the card, so the banding has to be computed for what is actually
  // being drawn.
  const withZebra = (rows: OverviewLabRow[]) => rows.map((row, index) => ({
    row,
    zebra: index % 2 === 0 ? 'bg-card' : 'bg-muted/20',
    startsGroup: index === 0 || rows[index - 1].categoryId !== row.categoryId,
  }))

  // 檢驗 always lands in the 累積報告 — the flat 全部 list is a per-report
  // index and cannot show an analyte over time, which is the whole reason the
  // reader clicked away from a truncated pivot. The panel is the one the first
  // visible row belongs to, so the destination matches what they were reading.
  const target = {
    resourceType: 'Observation',
    resourceId: data.navResourceId,
    tabLabel: t.tabs.reports,
    reportView: 'cumulative' as const,
    cumulativeCategoryId: shown.find((row) => row.categoryId)?.categoryId ?? data.rows[0]?.categoryId,
    seeAllLabel: strings.labs.seeAllCumulative,
  }

  // One renderer for the card and the full-length dialog (see
  // OverviewExpandButton): the card draws what fits, the dialog draws every
  // matched analyte, and neither can drift from the other.
  const showCategories = effectiveMode === 'all' || effectiveMode === 'abnormal'

  const renderPivot = (rows: OverviewLabRow[], expanded = false) => {
    // Filter before applying the card's date budget so empty pinned days
    // cannot displace older days that actually contain common results.
    const eligibleIndexes = columns.map((_, index) => index).filter(index =>
      rows.some(row => Boolean(row.cells[index])),
    )
    const visibleIndexes = expanded ? eligibleIndexes : eligibleIndexes.slice(-cardColumnCount)
    const visibleColumns = visibleIndexes.map(index => columns[index])
    const gridTemplate = expanded
      ? `7rem repeat(${Math.max(1, visibleColumns.length)}, minmax(4.5rem, 1fr))`
      : `7rem repeat(${Math.max(1, visibleColumns.length)}, minmax(0, 1fr))`
    const grid = (
    <div className="grid w-full" style={{ gridTemplateColumns: gridTemplate, minWidth: expanded ? `${7 + visibleColumns.length * 4.5}rem` : undefined }}>
      <div className="sticky left-0 z-10 flex items-center overflow-hidden border-b border-r border-border bg-muted px-2 py-[3px] text-[0.6875rem] font-semibold leading-3 tracking-wide text-foreground">
        {strings.labs.analyte}
      </div>
      {visibleColumns.map((column, index) => (
        <div
          key={column.day}
          className={cn(
            'flex flex-col items-center justify-center overflow-hidden border-b border-border bg-muted px-1 py-[3px] text-center text-muted-foreground',
            index > 0 && 'border-l',
          )}
        >
          <span className="block whitespace-nowrap text-[0.6875rem] font-bold leading-3 tabular-nums tracking-wide">
            {shortDayLabel(column.day)}
          </span>
          {column.institution && (
            <span
              className="block w-16 max-w-full truncate text-[0.5625rem] font-medium leading-[11px]"
              title={column.institution}
            >
              {column.institution}
            </span>
          )}
        </div>
      ))}
      {withZebra(rows).map(({ row, zebra, startsGroup }) => {
        // Category headings only in 「全部」. There they earn their row: the
        // list runs to every analyte the window holds and 血液／生化 is how a
        // reader finds their way down it. In 「常用」 the eight rows are the
        // whole list and a heading would just be one fewer result on screen.
        const nodes = []
        if (showCategories && startsGroup) {
          nodes.push(
            <div
              key={`group-${row.categoryId}`}
              className="col-span-full overflow-hidden bg-muted/70 px-2 py-px text-[0.6875rem] font-bold leading-3 tracking-wide text-muted-foreground"
            >
              <span className="sticky left-0 inline-block bg-muted px-2">{row.categoryLabel}</span>
            </div>,
          )
        }
        // The analyte name opens the same trend the 累積報告 column header
        // opens, when the whole chart makes one chartable.
        const trendRow = trendRowFor(row)
        const sourceId = trendRow ? `cumulative-trend:${row.categoryId}:${trendRow.mapKey}` : undefined
        const trendLabel = locale.startsWith('zh') ? `查看 ${row.name} 趨勢` : `View ${row.name} trend`
        const unit = row.unit && (
          <span className="shrink-0 whitespace-nowrap text-[0.5625rem] text-muted-foreground">
            {row.unit}
          </span>
        )
        nodes.push(
          <div
            key={`${row.mapKey}-name`}
            className={cn(
              'sticky left-0 z-10 border-r border-border',
              sourceId && sourceId === activeTrendSourceId ? 'bg-primary/10' : 'bg-card',
              !trendRow && 'flex max-w-48 flex-wrap items-baseline gap-x-1 px-2 py-0.5 leading-[14px]',
            )}
          >
            {trendRow && sourceId ? (
              <button
                type="button"
                data-detail-source-id={sourceId}
                onPointerEnter={preloadCumulativeLabTrendModule}
                onFocus={preloadCumulativeLabTrendModule}
                onClick={() => {
                  // The full list is a modal; the trend opens beside it.
                  if (expanded) setListOpen(false)
                  openTrend({
                    categoryId: row.categoryId,
                    mapKey: trendRow.mapKey,
                    testKey: trendRow.testKey,
                    displayName: trendRow.displayName,
                    nameMode: 'standardized',
                    sourceId,
                    title: row.name,
                  })
                }}
                aria-label={trendLabel}
                title={trendLabel}
                className="flex h-full w-full min-w-0 flex-wrap items-baseline gap-x-1 px-2 py-0.5 text-left leading-[14px] hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="min-w-0 truncate text-xs font-medium text-foreground">{row.name}</span>
                {unit}
                <TrendingUp aria-hidden="true" className="h-3 w-3 shrink-0 self-center text-primary" />
              </button>
            ) : (
              <>
                <CellText
                  text={row.name}
                  className="truncate text-xs font-medium text-foreground"
                />
                {unit}
              </>
            )}
          </div>,
        )
        visibleIndexes.forEach((sourceIndex, index) => {
          const cell = row.cells[sourceIndex]
          const key = `${row.mapKey}-${visibleColumns[index]?.day ?? index}`
          const summary = cell ? summariseCell(cell) : null
          if (!summary) {
            nodes.push(
              <div
                key={key}
                aria-hidden="true"
                className={cn(
                  'bg-muted/50 px-1 py-1 leading-[14px]',
                  index > 0 && 'border-l border-border',
                )}
                style={{ backgroundImage: 'var(--clinical-missing-data-pattern)' }}
              />,
            )
            return
          }
          const { shown, record, total, otherAbnormal, everyValue } = summary
          // Narrative microbiology results must not size an entire date column.
          // Numeric values keep their intrinsic width and are never truncated.
          const numeric = /^(?:[<>]=?|[≤≥])?\s*[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s*%?$/.test(shown.trim())
          const valueText = `${shown}${flagArrow(record)}`
          nodes.push(
            <div
              key={key}
              className={cn(
                'min-w-0 flex items-center justify-center px-2 py-0.5 text-center text-xs leading-[14px] tabular-nums',
                index > 0 && 'border-l border-border',
                record.isAbnormal
                  ? 'bg-clinical-abnormal/[0.06] font-bold text-clinical-abnormal'
                  : cn('text-foreground', zebra),
              )}
              title={everyValue}
            >
              {numeric ? (
                <span className="whitespace-nowrap">{valueText}</span>
              ) : (
                <CellText text={valueText} className="block min-w-0 max-w-full truncate" />
              )}
              {total > 1 && (
                // One character, so the value keeps the column. "+1"
                // cost twice this and pushed 37.87 into an ellipsis.
                <sup
                  aria-label={(otherAbnormal ? strings.labs.sameDayOtherAbnormal : strings.labs.sameDayCount).replace('{count}', String(total))}
                  className={cn(
                    'shrink-0 text-[0.5rem] leading-none',
                    otherAbnormal ? 'font-bold text-clinical-abnormal' : 'font-normal text-muted-foreground',
                  )}
                >
                  {total}
                </sup>
              )}
            </div>,
          )
        })
        return nodes
      })}
    </div>
    )
    return expanded ? (
      <LabScrollRegion dateKey={columns.map(column => column.day).join('|')}>{grid}</LabScrollRegion>
    ) : (
      <div className="min-w-0 overflow-hidden rounded-md border border-border">{grid}</div>
    )
  }

  // One definition, two places: the card header and the expanded dialog, both
  // driving the same mutually exclusive display mode.
  const filterChips = (
    <>
      <button
        type="button"
        aria-pressed={effectiveMode === 'abnormal'}
        className={overviewChipClass(effectiveMode === 'abnormal')}
        onClick={() => setMode('abnormal')}
      >
        {strings.labs.abnormalOnly}
      </button>
      <button
        type="button"
        aria-pressed={effectiveMode === 'pinned'}
        className={overviewChipClass(effectiveMode === 'pinned')}
        onClick={() => setMode('pinned')}
      >
        {strings.labs.pinned}
      </button>
      <button
        type="button"
        aria-pressed={isMine}
        className={overviewChipClass(isMine)}
        onClick={() => setMode('mine')}
      >
        {strings.labs.mine}
      </button>
      <button
        type="button"
        aria-pressed={effectiveMode === 'all'}
        className={overviewChipClass(effectiveMode === 'all')}
        onClick={() => setMode('all')}
      >
        {strings.labs.all}
      </button>
    </>
  )

  // 「自訂」 keeps the card header identical to the other filters; its two
  // actions sit on the footer line, beside the route to the 累積報告.
  const mineActions = (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setEditorOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <Pencil aria-hidden="true" className="h-3 w-3" />
        {strings.labs.editPinned}
      </button>
      {audience === 'medical' && (
        <button
          type="button"
          onClick={() => {
            // From the clinician's own lab list, straight to their own
            // formats: 複製 → 帶回紀錄 → 我的格式, whatever was open before.
            prefs.setHandoffMode('custom')
            revealTab('ips-export', { exportTab: 'emr' })
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/50 px-2 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ClipboardCopy aria-hidden="true" className="h-3 w-3" />
          {strings.labs.handoff}
        </button>
      )}
    </span>
  )

  const mineEmpty = (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-3 py-4">
      <p className="text-xs text-muted-foreground">{strings.myLabs.empty}</p>
      <button
        type="button"
        onClick={() => setEditorOpen(true)}
        className="rounded-md border border-primary/60 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {strings.myLabs.emptyAction}
      </button>
    </div>
  )

  const editor = editorOpen ? (
    <PinnedLabsEditorDialog
      open
      onOpenChange={setEditorOpen}
      initialIds={prefs.pinnedLabs ?? systemDefaultIds}
      systemDefaultIds={systemDefaultIds}
      onSave={(ids) => {
        prefs.setPinnedLabs(ids)
        setMode('mine')
      }}
    />
  ) : null

  return (
    <OverviewSectionCard
      id={OVERVIEW_SECTION_DOM_ID.labs}
      icon={FlaskConical}
      title={strings.sections.labs}
      count={strings.counts.labs
        .replace('{results}', String(data.resultCount))
        .replace('{days}', String(columns.length + data.hiddenDayCount))}
      bounded={fit.bounded}
      flash={flash}
      headingRef={headingRef}
      actions={(
        <>
          {filterChips}
          <OverviewExpandButton
            label={t.overview.expandList}
            onClick={() => setListOpen(true)}
            disabled={matched.length === 0 || columns.length === 0 || (isMine && !mineHasResults)}
          />
        </>
      )}
    >
      {editor}
      {trendDialog}
      {isMine && pinnedIds.length === 0 ? mineEmpty : isMine && !mineHasResults ? (
        <>
          <div className={OVERVIEW_EMPTY_CLASS}>{strings.myLabs.noneInRange}</div>
          <div className="flex justify-end">{mineActions}</div>
        </>
      ) : shown.length === 0 || columns.length === 0 ? (
        <OverviewEmptyRow hasWindowData={data.rows.length > 0 || data.unpivotedCount > 0} />
      ) : (
        <>
          <div ref={cardRef} className={cn('min-w-0', fit.bounded && 'min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]')}>
            {renderPivot(shown)}
          </div>
          {/* The same footer the other three cards use. 「常用」 is a chosen
              short list rather than a fitting artefact, so the route to the
              full record is offered whether or not anything was cut. */}
          {isMine ? (
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <OverviewTruncationNote hiddenCount={hidden} target={target} always />
              {mineActions}
            </div>
          ) : (
            <OverviewTruncationNote hiddenCount={hidden} target={target} always />
          )}
          <OverviewFullListDialog
            open={listOpen}
            onOpenChange={setListOpen}
            title={strings.sections.labs}
            filters={filterChips}
            subtitle={strings.counts.labs
              .replace('{results}', String(data.resultCount))
              .replace('{days}', String(columns.length + data.hiddenDayCount))}
          >
            {renderPivot(matched, true)}
          </OverviewFullListDialog>
        </>
      )}
    </OverviewSectionCard>
  )
}
