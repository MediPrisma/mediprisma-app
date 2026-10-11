"use client"

// One category of the 累積報告 as a transposed pivot (matches VGH 累積報告):
// rows = collection dates newest-first, columns = tests grouped by subgroup.
//
// Extracted from CumulativeLabReport.tsx (2026-09-05) when the stacked 直式
// layout landed: the same table is now rendered once per category inside one
// page-level scroller, so its own vertical scrolling / sticky header / row
// virtualization all have to be switchable off. See the `stacked` prop.
import { memo, useEffect, useMemo, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { TrendingUp } from "lucide-react"
import { ReportSourceProgramBadge } from "./ReportSourceProgramBadge"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import type { LabPivot } from "../hooks/useLabPivot"
import { cellDisplayValue } from "@/src/shared/utils/lab-pivot.utils"
import { isParaproteinTextKey, paraproteinTextBadge } from "@/src/shared/utils/paraprotein-analytes"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { LabSubgroup } from "@/src/shared/utils/lab-categories"
import { getLabRowDisplayParts } from "@/src/shared/utils/lab-analyte-display.utils"
import type { AnalyteNameMode } from "@voho0000/clinical-lab-normalization/display"
import { preloadCumulativeLabTrendModule } from "./cumulative-lab-trend-loader"
import { InfoHint } from "@/src/shared/components/InfoHint"

export interface OpenTrendTarget {
  categoryId: string
  mapKey: string
  testKey: string
  displayName: string
  nameMode: AnalyteNameMode
  title: string
  sourceId: string
}

// A chemistry pivot is mostly empty cells (tens of thousands of them on a
// years-of-data panel). One shared style object keeps React from allocating —
// and diffing — a new one per cell on every render.
const MISSING_DATA_CELL_STYLE = {
  backgroundImage: 'var(--clinical-missing-data-pattern)',
} as const

// Date rows below this count render in full: virtualization costs a scroll
// subscription plus per-row measurement, which is pure overhead on the short
// panels most patients have — and keeps existing behaviour bit-identical there.
const VIRTUALIZE_DATE_ROW_THRESHOLD = 60
// Compact single-line row at text-xs with py-1. Rows carrying a per-cell unit
// or "推估單位" line are taller; measureElement corrects the estimate on mount.
const ESTIMATED_DATE_ROW_HEIGHT = 28
// The virtualizer measures the scroll container, which also holds the sticky
// header. That makes its computed window a superset of the truly visible rows
// (the header covers the top of the viewport), never a subset — so a modest
// overscan is enough and no scrollMargin correction is needed.
const DATE_ROW_OVERSCAN = 8

export function formatDateLabel(d: string): string {
  return d.length >= 10 ? `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}` : d
}

function isMissingLabValue(value: string | undefined): boolean {
  const trimmed = value?.trim()
  return !trimmed || trimmed === '—'
}

function EmptyCell({ mapKey, label }: { mapKey: string; label: string }) {
  return (
    <td
      key={mapKey}
      className="border-l bg-muted/50 px-1 py-1 text-center"
      title={label}
      aria-label={label}
      style={MISSING_DATA_CELL_STYLE}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">&nbsp;</span>
    </td>
  )
}

export const LabPivotTable = memo(function LabPivotTable({
  pivot,
  fullHeight = false,
  stacked = false,
  focusAnalyteKey,
  focusDate,
  focusNonce,
  nameMode,
  activeTrendSourceId,
  onOpenTrend,
}: {
  pivot: LabPivot
  fullHeight?: boolean
  /** 直式 layout: the page owns vertical scrolling, so this table only scrolls
   *  sideways. The header row cannot stay sticky against a scroller it does
   *  not own (an accepted trade — the section heading names the panel), and
   *  row virtualization is off because the range selector already bounds the
   *  row count and a virtualized block would fight the page scroll. */
  stacked?: boolean
  focusAnalyteKey?: string
  focusDate?: string
  focusNonce?: number
  nameMode: AnalyteNameMode
  activeTrendSourceId?: string
  onOpenTrend: (target: OpenTrendTarget) => void
}) {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  // Callback-ref-into-state (not useRef): the virtualizer must re-measure on
  // the render in which the scroll container attaches, and a ref assignment
  // does not schedule one. Same workaround as ReportsTabContent.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const categoryLabels = (t.reports as any).cumulativeCategories || {}
  const subgroupLabels = (t.reports as any).cumulativeSubgroups || {}
  const categoryLabel = categoryLabels[pivot.category.id] || pivot.category.id
  const subgroupLabel = (sgId: string) => subgroupLabels[sgId] || sgId
  const missingValueLabel = locale.startsWith('zh') ? '無資料' : 'No data'
  // Recognized analytes use the same audience-aware display map as report
  // cards, so internal keys such as CA / EGFR(M) never leak into this surface.
  // Unknown tests retain their full language-aware source label. Patient mode
  // can split a long name and its abbreviation across two header lines.

  useEffect(() => {
    if (!focusAnalyteKey) return
    const container = scrollEl
    if (!container) return
    const header = Array.from(
      container.querySelectorAll<HTMLElement>('[data-lab-test-key]'),
    ).find((element) => element.dataset.labTestKey === focusAnalyteKey)
    if (!header) return

    const focusedCell = focusDate
      ? Array.from(container.querySelectorAll<HTMLElement>('[data-lab-cell]')).find(
          (element) => element.dataset.labTestKey === focusAnalyteKey
            && element.dataset.labDate === focusDate,
        )
      : undefined
    focusedCell?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' })

    const centeredLeft = header.offsetLeft
      - (container.clientWidth / 2)
      + (header.offsetWidth / 2)
    container.scrollTo({ left: Math.max(0, centeredLeft), behavior: 'smooth' })
  }, [focusAnalyteKey, focusDate, focusNonce, pivot.category.id, pivot.rows, scrollEl])

  // Transposed layout (matches VGH 累積報告): dates = rows, tests = columns.
  // Group columns by subgroup; render a top-row of subgroup headers spanning
  // their member columns.
  //
  // Memoized on `pivot` because the unit pass walks EVERY cell of every
  // column: on a years-of-data chemistry panel that is tens of thousands of
  // cells, and this component re-renders on unrelated parent state (tab
  // measurement, focus, dialog open).
  const { groupedColumns, flatTests, inferredUnitInHeader } = useMemo(() => {
    const subgroups = pivot.category.subgroups || []
    const columns: { sg: LabSubgroup | null; tests: typeof pivot.rows }[] = []
    if (subgroups.length > 0) {
      for (const sg of subgroups) {
        const members = pivot.rows.filter((r) => r.subgroupId === sg.id)
        if (members.length > 0) columns.push({ sg, tests: members })
      }
      const orphans = pivot.rows.filter((r) => !r.subgroupId || !subgroups.some((s) => s.id === r.subgroupId))
      if (orphans.length > 0) columns.push({ sg: null, tests: orphans })
    } else {
      columns.push({ sg: null, tests: pivot.rows })
    }
    const tests = columns.flatMap((g) => g.tests)
    return {
      groupedColumns: columns,
      flatTests: tests,
      inferredUnitInHeader: new Map(
        tests.map((test) => {
          const unitBearingCells = [...test.values.values()].filter(
            (cell) => !isMissingLabValue(cell.value) && !!cell.unit,
          )
          return [
            test.mapKey,
            !!test.unit &&
              unitBearingCells.length > 0 &&
              unitBearingCells.every((cell) => cell.unitInferred),
          ] as const
        }),
      ),
    }
  }, [pivot])

  // Every date row × analyte column is real DOM. A chemistry panel with years
  // of data is hundreds of rows × dozens of columns — tens of thousands of
  // cells — and visited categories stay mounted, so the cost never goes away
  // after a tab switch. Past the threshold only the scrolled-to window renders.
  const shouldVirtualizeRows = !stacked && pivot.dates.length > VIRTUALIZE_DATE_ROW_THRESHOLD
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns its mutable measurement callbacks here.
  const rowVirtualizer = useVirtualizer({
    // Measurement runs from the ref-attachment lifecycle; TanStack's default
    // flushSync update is invalid while React is already committing it.
    useFlushSync: false,
    count: pivot.dates.length,
    enabled: shouldVirtualizeRows && !!scrollEl,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_DATE_ROW_HEIGHT,
    overscan: DATE_ROW_OVERSCAN,
    getItemKey: (index) => pivot.dates[index] ?? index,
  })

  // When there are no columns at all (no pinned columns and no data) show the
  // empty-state message. If there are columns but no data dates, fall through
  // so the column headers still render with a "no data" body row.
  if (pivot.rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4 text-center">
        {t.reports.noData}
      </div>
    )
  }

  // 直式: no vertical scroller of its own — the left panel (or the fullscreen
  // wrapper) is the single vertical scroller for the whole report.
  const heightClass = stacked
    ? ''
    : fullHeight ? 'max-h-[calc(100vh-220px)] overflow-y-auto' : 'max-h-[60vh] overflow-y-auto'
  const hasSubgroups = groupedColumns.some((g) => g.sg !== null)

  const virtualRows = shouldVirtualizeRows ? rowVirtualizer.getVirtualItems() : []
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0

  // `measureRef` is only passed on the virtualized path — it is TanStack's
  // measureElement, which needs the data-index attribute to identify the row.
  const renderDateRow = (
    date: string,
    dateIdx: number,
    measureRef?: (node: HTMLTableRowElement | null) => void,
  ) => (
    <tr
      key={date}
      data-index={dateIdx}
      data-lab-date-row={date}
      ref={measureRef}
      className={dateIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20'}
    >
      {/* The sticky date column must remain opaque so horizontally
          scrolling values never show through it. Keep it on the card
          surface rather than the darker app canvas: dense dark-mode
          tables then read as one calm sheet instead of black stripes. */}
      <td className="sticky left-0 z-10 bg-card border-r px-2 py-1 font-medium whitespace-nowrap">
        {formatDateLabel(date)}
        {flatTests.some(test => {
          const cell = test.values.get(date)
          return cell?.sourceProvenance === 'nhi-medicloud'
            || cell?.sourceRecords?.some(record => record.provenance === 'nhi-medicloud')
        }) && (
          <InfoHint
            aria-label={locale.startsWith('zh') ? '本日期含健保雲端圖形化查詢結果' : 'This date includes NHI MediCloud results'}
            className="ml-1 -my-1 h-6 w-6 align-middle text-primary/80"
            contentClassName="max-w-sm"
          >
            {locale.startsWith('zh')
              ? '本日期包含健保雲端圖形化查詢結果'
              : 'This date includes graphical lab results from NHI MediCloud'}
          </InfoHint>
        )}
        {flatTests.some(test => test.values.get(date)?.adultPreventive) && (
          <span className="ml-1 inline-flex"
            title={locale.startsWith('zh') ? '本日期包含成人健檢來源結果，不代表同日所有檢驗皆為成人健檢。' : 'This date includes adult preventive-care results; other same-day tests may have a different source.'}
            aria-label={locale.startsWith('zh') ? '含成人健檢結果' : 'Includes adult preventive-care results'}>
            <ReportSourceProgramBadge sourceProgram="adult-preventive" label={locale.startsWith('zh') ? '成健' : 'Preventive'} />
          </span>
        )}
      </td>
      {flatTests.map((test) => {
        const cell = test.values.get(date)
        const showInferredUnitInHeader =
          inferredUnitInHeader.get(test.mapKey) === true
        if (!cell) {
          return <EmptyCell key={test.mapKey} mapKey={test.mapKey} label={missingValueLabel} />
        }
        if (isMissingLabValue(cell.value)) {
          return <EmptyCell key={test.mapKey} mapKey={test.mapKey} label={missingValueLabel} />
        }
        const isFocusedCell = focusDate === date && test.testKey === focusAnalyteKey
        if (isParaproteinTextKey(test.testKey)) {
          // IEP / IFE report text: one clamped line holding a short badge
          // (IgG-κ / 陰性 / 見報告) on a button that opens the full report —
          // every folded record with its analyte — by click, tap or keyboard
          // (never hover-only). Fixed width; no abnormal colouring, the text
          // is not graded.
          const records = cell.allValues ?? (cell.sourceRecords?.map((record) => record.value) ?? [cell.value])
          const zh = locale.startsWith('zh')
          const badge = paraproteinTextBadge(records, zh ? 'zh-TW' : 'en')
          const columnName = getLabRowDisplayParts(test, audience, locale, nameMode).name
          return (
            <td
              key={test.mapKey}
              data-lab-cell=""
              data-lab-text-cell=""
              data-lab-test-key={test.testKey}
              data-lab-date={date}
              data-evidence-focus={isFocusedCell ? 'true' : undefined}
              className={`border-l px-1 py-1 text-center text-foreground ${isFocusedCell ? 'relative bg-primary/15 ring-2 ring-inset ring-primary' : ''}`}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={zh
                      ? `${columnName} ${formatDateLabel(date)}：${badge}，查看完整報告`
                      : `${columnName} ${formatDateLabel(date)}: ${badge}, view full report`}
                    className="mx-auto block min-h-[1.75rem] rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span data-lab-text-clamp="" className="block max-w-[7.5rem] truncate">{badge}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  role="dialog"
                  aria-label={`${columnName} ${formatDateLabel(date)}`}
                  className="w-80 max-w-[90vw] text-left text-xs"
                >
                  <div className="mb-1 font-medium">{columnName} · {formatDateLabel(date)}</div>
                  <ul className="space-y-1 whitespace-pre-wrap break-words">
                    {records.map((record, index) => <li key={index}>{record}</li>)}
                  </ul>
                </PopoverContent>
              </Popover>
            </td>
          )
        }
        const cls = cell.isAbnormal ? 'text-clinical-abnormal font-medium' : 'text-foreground'
        return (
          <td
            key={test.mapKey}
            data-lab-cell=""
            data-lab-test-key={test.testKey}
            data-lab-date={date}
            data-evidence-focus={isFocusedCell ? 'true' : undefined}
            className={`border-l px-1 py-1 text-center ${cls} ${isFocusedCell ? 'relative bg-primary/15 ring-2 ring-inset ring-primary' : ''}`}
            title={cell.interpretationCode ? `Interpretation: ${cell.interpretationCode}` : undefined}
          >
            <span>{cellDisplayValue(cell)}</span>
            {!test.unit && cell.unit && (
              <div className="text-[0.625rem] font-normal leading-tight text-muted-foreground whitespace-nowrap">
                {cell.unit}
              </div>
            )}
            {cell.unitInferred && !showInferredUnitInHeader && (
              <div
                className="text-[0.5625rem] font-normal leading-tight text-sky-700 dark:text-sky-300 whitespace-nowrap"
                title={locale.startsWith('zh')
                  ? '健康存摺 SDK 未提供單位；此單位由轉換器依規則推估'
                  : 'The SDK did not provide a unit; the converter inferred it under an audited policy'}
              >
                {locale.startsWith('zh') ? '推估單位' : 'inferred unit'}
              </div>
            )}
          </td>
        )
      })}
    </tr>
  )

  return (
    <div
      ref={setScrollEl}
      role="region"
      aria-label={locale.startsWith('zh')
        ? `${categoryLabel}累積檢驗表，可水平捲動`
        : `${categoryLabel} cumulative lab table, scrolls horizontally`}
      tabIndex={0}
      className={`w-full max-w-full overflow-x-auto ${heightClass} rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-muted/30`}
      style={{ scrollbarWidth: 'thin' }}
    >
      <table className="text-xs border-collapse w-max min-w-full">
        {/* z-layering for the dual-sticky table: header row (z-20) must sit
            ABOVE the sticky date column (z-10) or the scrolling dates paint
            over the column names; the top-left corner cell (z-30) stays above
            both. */}
        <thead className={stacked ? undefined : 'sticky top-0 z-20'}>
          {/* Subgroup header row */}
          {hasSubgroups && (
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-30 bg-muted border-b border-r px-2 py-1.5 text-left font-semibold whitespace-nowrap min-w-[64px]"
              >
                {categoryLabel}
              </th>
              {groupedColumns.map((g, i) =>
                g.sg ? (
                  <th
                    key={`sg-${g.sg.id}`}
                    colSpan={g.tests.length}
                    className="border-b border-l bg-muted/70 p-1 text-center text-[0.6875rem] font-bold tracking-wide text-muted-foreground"
                  >
                    {subgroupLabel(g.sg.id)}
                  </th>
                ) : (
                  <th
                    key={`sg-other-${i}`}
                    colSpan={g.tests.length}
                    className="border-b border-l bg-muted/70 p-1 text-center text-[0.6875rem] font-bold tracking-wide text-muted-foreground"
                  >
                    {(t.reports as any).otherSubgroup ?? 'Other'}
                  </th>
                )
              )}
            </tr>
          )}
          {/* Test name header row */}
          <tr>
            {!hasSubgroups && (
              <th className="sticky left-0 z-30 bg-muted border-b border-r px-2 py-1.5 text-left font-semibold whitespace-nowrap min-w-[64px]">
                {categoryLabel}
              </th>
            )}
            {flatTests.map((test) => {
              const { name, abbr } = getLabRowDisplayParts(test, audience, locale, nameMode)
              const isFocused = test.testKey === focusAnalyteKey
              const sourceId = `cumulative-trend:${pivot.category.id}:${test.mapKey}`
              const isTrendActive = activeTrendSourceId === sourceId
              const canTrend = test.trendChartable === true
              const showInferredUnitInHeader =
                inferredUnitInHeader.get(test.mapKey) === true
              const heading = (
                <>
                  <div className="flex items-start justify-center gap-1 leading-tight">
                    <span className="max-w-[4.5rem] break-words">{name}</span>
                    {canTrend && (
                      <TrendingUp className="mt-px h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    )}
                  </div>
                  {(abbr || test.unit) && (
                    <div className="text-[0.625rem] font-normal text-muted-foreground leading-tight whitespace-nowrap">
                      {abbr ?? ''}{abbr && test.unit ? ' · ' : ''}{test.unit ?? ''}
                    </div>
                  )}
                  {showInferredUnitInHeader && (
                    <div
                      className="text-[0.5625rem] font-normal leading-tight text-sky-700 dark:text-sky-300 whitespace-nowrap"
                      title={locale.startsWith('zh')
                        ? '健康存摺 SDK 未提供單位；此欄單位由轉換器依規則推估'
                        : 'The SDK did not provide a unit; this column unit was inferred under an audited policy'}
                    >
                      {locale.startsWith('zh') ? '推估單位' : 'inferred unit'}
                    </div>
                  )}
                </>
              )
              return (
                <th
                  key={test.mapKey}
                  data-lab-test-key={test.testKey}
                  data-trend-active={isTrendActive ? 'true' : undefined}
                  className={isFocused || isTrendActive
                    ? "min-w-[46px] border-b-2 border-b-primary border-l bg-primary/10 p-0 text-center align-bottom font-semibold text-foreground"
                    : "min-w-[46px] border-b border-l bg-muted/80 p-0 text-center align-bottom font-medium"}
                >
                  {canTrend ? (
                    <button
                      type="button"
                      data-detail-source-id={sourceId}
                      onPointerEnter={preloadCumulativeLabTrendModule}
                      onFocus={preloadCumulativeLabTrendModule}
                      onClick={() => onOpenTrend({
                        categoryId: pivot.category.id,
                        mapKey: test.mapKey,
                        testKey: test.testKey,
                        displayName: test.displayName,
                        nameMode,
                        sourceId,
                        title: abbr ? `${name} (${abbr})` : name,
                      })}
                      className="flex min-h-11 w-full min-w-11 flex-col items-center justify-end px-1 py-1.5 transition-colors hover:bg-primary/10 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      aria-label={locale.startsWith('zh')
                        ? `查看 ${name} 趨勢`
                        : `View ${name} trend`}
                      title={locale.startsWith('zh') ? `查看 ${name} 趨勢` : `View ${name} trend`}
                    >
                      {heading}
                    </button>
                  ) : (
                    <div className="flex min-h-11 min-w-11 flex-col items-center justify-end px-1 py-1.5">
                      {heading}
                    </div>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {pivot.dates.length === 0 && (
            <tr>
              <td
                colSpan={flatTests.length + 1}
                className="p-4 text-center text-sm text-muted-foreground"
              >
                {t.reports.noData}
              </td>
            </tr>
          )}
          {/* Padding-row virtualization rather than absolute positioning: a
              <tbody> must hold contiguous rows for the sticky header and
              sticky date column to keep their column alignment, so the
              off-screen range collapses into two zero-content spacer rows.
              Column widths are still driven by the always-rendered headers
              (min-w-[46px]), so the visible window cannot re-flow them. */}
          {shouldVirtualizeRows ? (
            <>
              {paddingTop > 0 && (
                <tr aria-hidden="true" style={{ height: paddingTop }}>
                  <td colSpan={flatTests.length + 1} className="p-0" />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const date = pivot.dates[virtualRow.index]
                if (date === undefined) return null
                return renderDateRow(
                  date,
                  virtualRow.index,
                  rowVirtualizer.measureElement,
                )
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true" style={{ height: paddingBottom }}>
                  <td colSpan={flatTests.length + 1} className="p-0" />
                </tr>
              )}
            </>
          ) : (
            pivot.dates.map((date, dateIdx) => renderDateRow(date, dateIdx))
          )}
        </tbody>
      </table>
    </div>
  )
})
