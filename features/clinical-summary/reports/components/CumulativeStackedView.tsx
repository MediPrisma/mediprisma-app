"use client"

// 直式 (stacked) cumulative report — every category as a <section> in ONE
// vertical scroll instead of twelve sub-tabs.
//
// Why this is the default: a clinician reading a chart moves between panels
// (CBC → 生化 → 尿液) far more often than they read one panel in depth, and
// the tabbed layout charged a click plus a re-orientation for every move. The
// price is height, which the 顯示範圍 selector controls globally (default: the
// latest three collection dates per category) and 「查看更多」 lifts per section.
//
// Layout contract for the tables inside: the left panel (or the fullscreen
// wrapper) is the ONLY vertical scroller. Sections do not scroll, tables keep
// their horizontal scroll and their sticky date column, and the column header
// gives up stickiness — an accepted trade, since the section heading already
// names the panel and the range keeps most sections a few rows tall.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { getLabRowDisplayParts } from "@/src/shared/utils/lab-analyte-display.utils"
import type { AnalyteNameMode } from "@voho0000/clinical-lab-normalization/display"
import type { LabPivot } from "../hooks/useLabPivot"
import { LabPivotTable, type OpenTrendTarget } from "./LabPivotTable"
import { MicrobiologyCumulativeView } from "./MicrobiologyCumulativeView"
import { CumulativeCategoryJumpBar } from "./CumulativeCategoryJumpBar"
import { CumulativeSectionOrderControls } from "./CumulativeOrderPanel"
import { useCumulativeRangeLabels } from "./CumulativeRangeSelector"
import {
  filterDatesByCumulativeRange,
  cumulativeRangeLatestCount,
  type CumulativeRangeId,
} from "../utils/cumulative-range.utils"
import { splitPivotIntoStackedPanels } from "../utils/cumulative-panels.utils"

// Off-screen sections skip layout/paint until they scroll near the viewport.
// The intrinsic size is a rough "header + a few rows" placeholder so the
// scrollbar stays sane before a section has ever been rendered.
const SECTION_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 220px',
} as CSSProperties
// The jump bar is sticky at the top of the scroller, so a section scrolled to
// by a chip must stop below it rather than under it.
const HEADING_SCROLL_MARGIN: CSSProperties = { scrollMarginTop: '2.75rem' }
// Longest 「預期欄位：…」 list worth reading in one muted line.
const MAX_EXPECTED_COLUMN_NAMES = 12

export interface StackedCategoryEntry {
  pivot: LabPivot
  label: string
}

export const CumulativeStackedView = memo(function CumulativeStackedView({
  entries,
  observations,
  nameMode,
  range,
  focusRequest,
  activeTrendSourceId,
  onOpenTrend,
  onMove,
  onResetOrder,
  canResetOrder,
  onActiveCategoryChange,
  onCategoryChange,
}: {
  /** Already in the clinician's chosen order. */
  entries: StackedCategoryEntry[]
  observations: any[]
  nameMode: AnalyteNameMode
  range: CumulativeRangeId
  /** Analyte column to reveal, plus the section that owns it. `seq` advances on
   *  every request so re-picking the same analyte scrolls again. */
  focusRequest?: { categoryId: string; key?: string; date?: string; seq: number } | null
  activeTrendSourceId?: string
  onOpenTrend: (target: OpenTrendTarget) => void
  onMove: (id: string, direction: -1 | 1) => void
  onResetOrder: () => void
  canResetOrder: boolean
  onActiveCategoryChange?: (id: string) => void
  /** The clinician's explicit pick (a jump chip). Same channel the tab strip
   *  uses, so ReportsCard can mark the user trigger and remember the choice. */
  onCategoryChange?: (id: string) => void
}) {
  // Expansion is per-section and deliberately NOT persisted: it answers "let
  // me see the rest of THIS panel right now", not a standing preference.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | undefined>(() => entries[0]?.pivot.category.id)
  const sectionRefs = useRef(new Map<string, HTMLElement>())

  const registerSection = useCallback((id: string, node: HTMLElement | null) => {
    if (node) sectionRefs.current.set(id, node)
    else sectionRefs.current.delete(id)
  }, [])

  // "Today" is read once per range change, not per render: a stable reference
  // date keeps the window comparison identical across every section in one
  // pass, and re-slicing on every render would rebuild each pivot. `range` is
  // deliberately the only trigger — a long-open workspace that crosses
  // midnight re-reads the clock the next time the clinician retunes the range.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `range` is the intended re-read trigger, not an input to the value.
  const today = useMemo(() => new Date(), [range])

  const scrollToCategory = useCallback((id: string) => {
    const node = sectionRefs.current.get(id)
    if (!node) return
    // The heading carries scroll-margin-top so the sticky jump bar does not
    // cover it. jsdom has no scrollIntoView, hence the guard.
    node.querySelector<HTMLElement>('[data-cumulative-section-heading]')
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }, [])

  const jumpToCategory = useCallback((id: string) => {
    scrollToCategory(id)
    onCategoryChange?.(id)
  }, [onCategoryChange, scrollToCategory])

  const jumpEntries = useMemo(
    () => entries.map(({ pivot, label }) => ({
      id: pivot.category.id,
      label,
      dateCount: pivot.dates.length,
    })),
    [entries],
  )

  // Scrollspy: mark the chip for the section the clinician is actually
  // reading. The observer root is the viewport (not the panel) because the
  // scrolling ancestor differs between the docked panel and the fullscreen
  // overlay; a viewport-rooted band near the top answers the same question in
  // both. Absent in jsdom, where the seeded first-section value stands.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const nodes = entries
      .map((entry) => sectionRefs.current.get(entry.pivot.category.id))
      .filter((node): node is HTMLElement => !!node)
    if (nodes.length === 0) return

    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = (record.target as HTMLElement).dataset.cumulativeSection
          if (!id) continue
          if (record.isIntersecting) visible.set(id, record.boundingClientRect.top)
          else visible.delete(id)
        }
        if (visible.size === 0) return
        // Topmost section inside the band wins — that is the one whose header
        // the clinician just scrolled past.
        const [topmost] = [...visible.entries()].sort((a, b) => a[1] - b[1])
        setActiveId(topmost[0])
      },
      // A thin band under the sticky bar: a section is "current" from the
      // moment its top crosses it until the next section takes over.
      { rootMargin: '-8% 0px -80% 0px', threshold: 0 },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [entries])

  // Telemetry (useTrackView in ReportsCard) consumes the same "category on
  // screen" channel in both layouts. Effect, not render, so the parent's
  // setState commits outside this component's render pass.
  useEffect(() => {
    if (activeId) onActiveCategoryChange?.(activeId)
  }, [activeId, onActiveCategoryChange])

  // An analyte pick / AI citation must land on the right SECTION first; the
  // pivot table then centres the column horizontally on its own.
  const focusSeq = focusRequest?.seq
  const focusCategoryId = focusRequest?.categoryId
  useEffect(() => {
    if (!focusCategoryId) return
    scrollToCategory(focusCategoryId)
  }, [focusCategoryId, focusSeq, scrollToCategory])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="min-w-0">
      <CumulativeCategoryJumpBar
        entries={jumpEntries}
        activeId={activeId}
        onJump={jumpToCategory}
        onMove={onMove}
        onReset={onResetOrder}
        canReset={canResetOrder}
      />
      {entries.map(({ pivot, label }, index) => (
        <CumulativeSection
          key={pivot.category.id}
          pivot={pivot}
          label={label}
          observations={observations}
          nameMode={nameMode}
          range={range}
          today={today}
          expanded={expandedIds.has(pivot.category.id)}
          onToggleExpanded={() => toggleExpanded(pivot.category.id)}
          isFirst={index === 0}
          isLast={index === entries.length - 1}
          onMove={(direction) => onMove(pivot.category.id, direction)}
          focusAnalyteKey={focusRequest?.categoryId === pivot.category.id ? focusRequest.key : undefined}
          focusDate={focusRequest?.categoryId === pivot.category.id ? focusRequest.date : undefined}
          focusNonce={focusRequest?.seq}
          activeTrendSourceId={activeTrendSourceId}
          onOpenTrend={onOpenTrend}
          registerSection={registerSection}
        />
      ))}
    </div>
  )
})

function CumulativeSection({
  pivot,
  label,
  observations,
  nameMode,
  range,
  today,
  expanded,
  onToggleExpanded,
  isFirst,
  isLast,
  onMove,
  focusAnalyteKey,
  focusDate,
  focusNonce,
  activeTrendSourceId,
  onOpenTrend,
  registerSection,
}: {
  pivot: LabPivot
  label: string
  observations: any[]
  nameMode: AnalyteNameMode
  range: CumulativeRangeId
  today: Date
  expanded: boolean
  onToggleExpanded: () => void
  isFirst: boolean
  isLast: boolean
  onMove: (direction: -1 | 1) => void
  focusAnalyteKey?: string
  focusDate?: string
  focusNonce?: number
  activeTrendSourceId?: string
  onOpenTrend: (target: OpenTrendTarget) => void
  registerSection: (id: string, node: HTMLElement | null) => void
}) {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const strings = (t.reports as any).cumulativeStacked ?? {}
  const rangeLabels = useCumulativeRangeLabels()
  const categoryId = pivot.category.id

  // A wide category (生化) may declare several stacked panels; each panel owns
  // its own date list, so the range is applied per panel. Only the date column
  // is re-sliced; every row keeps its full value map, so this is a shallow
  // projection rather than a pivot rebuild.
  const panels = useMemo(() => splitPivotIntoStackedPanels(pivot), [pivot])
  const rangedPanels = useMemo<LabPivot[]>(
    () => panels.map((panel) => {
      const rangedDates = expanded ? panel.dates : filterDatesByCumulativeRange(panel.dates, range, today)
      const visible = focusDate && panel.dates.includes(focusDate) && !rangedDates.includes(focusDate)
        ? panel.dates.filter((date) => rangedDates.includes(date) || date === focusDate)
        : rangedDates
      return visible.length === panel.dates.length ? panel : { ...panel, dates: visible }
    }),
    [expanded, focusDate, panels, range, today],
  )

  const totalDates = pivot.dates.length
  // The section reports the widest panel: "顯示最新 3 筆" / "其餘 N 筆" describe
  // what the clinician can still reveal, and one 查看更多 expands every panel.
  const shownDates = Math.max(0, ...rangedPanels.map((panel) => panel.dates.length))
  const hiddenDates = Math.max(0, ...panels.map((panel, index) => panel.dates.length - rangedPanels[index].dates.length))
  const rangeInWindowCount = Math.max(
    0,
    ...panels.map((panel) => filterDatesByCumulativeRange(panel.dates, range, today).length),
  )
  const rangeLabel = rangeLabels[range]

  const statusText = (() => {
    if (totalDates === 0) return strings.noDates ?? '無資料'
    if (expanded || range === 'all') {
      return (strings.showingAll ?? '已展開全部 {count} 筆').replace('{count}', String(totalDates))
    }
    if (cumulativeRangeLatestCount(range) !== null) {
      return (strings.showingLatest ?? '顯示最新 {count} 筆').replace('{count}', String(shownDates))
    }
    return (strings.showingWindow ?? '{range} {count} 筆')
      .replace('{range}', rangeLabel)
      .replace('{count}', String(shownDates))
  })()
  const dateCountText = (strings.dateCount ?? '{count} 個日期')
    .replace('{count}', String(totalDates))

  // Expected columns for an empty category come from the pivot's own pinned
  // stub rows, so the wording never drifts from what the table would show.
  // (Original-name mode injects no stubs — then the plain sentence is used.)
  const expectedColumnNames = useMemo(() => {
    if (totalDates > 0) return []
    return pivot.rows.slice(0, MAX_EXPECTED_COLUMN_NAMES).map((row) => (
      getLabRowDisplayParts(row, audience, locale, nameMode).name
    ))
  }, [audience, locale, nameMode, pivot.rows, totalDates])

  const isMicrobiology = categoryId === 'microbio'

  return (
    <section
      ref={(node) => registerSection(categoryId, node)}
      data-cumulative-section={categoryId}
      aria-labelledby={`cumulative-section-${categoryId}`}
      className="mt-2.5"
      // A section asked to reveal a column must be laid out NOW: the table's
      // horizontal centring reads offsetLeft, which is 0 for a section whose
      // rendering content-visibility has skipped.
      style={focusAnalyteKey ? undefined : SECTION_STYLE}
    >
      <div className="mb-1 flex items-center justify-between gap-1.5">
        <h3
          id={`cumulative-section-${categoryId}`}
          data-cumulative-section-heading=""
          className="min-w-0 truncate text-sm font-semibold text-foreground"
          style={HEADING_SCROLL_MARGIN}
        >
          {label}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {totalDates === 0 ? statusText : `${dateCountText} · ${statusText}`}
          </span>
        </h3>
        <CumulativeSectionOrderControls
          label={label}
          isFirst={isFirst}
          isLast={isLast}
          onMove={onMove}
        />
      </div>

      {totalDates === 0 ? (
        <div className="rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
          {expectedColumnNames.length > 0
            ? (strings.emptyWithColumns ?? '此分類尚無檢驗資料（預期欄位：{columns}）')
              .replace('{columns}', expectedColumnNames.join('、'))
            : (strings.empty ?? '此分類尚無檢驗資料')}
        </div>
      ) : isMicrobiology ? (
        // The microbiology grid derives its own event rows from the same
        // observations, so it applies the range itself rather than being handed
        // a date list built from a different projection of the same data.
        <MicrobiologyCumulativeView
          observations={observations}
          nameMode={nameMode}
          embedded
          range={expanded ? undefined : range}
          rangeToday={today}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rangedPanels.map((panel, index) => (
            <LabPivotTable
              key={index}
              stacked
              pivot={panel}
              focusAnalyteKey={focusAnalyteKey}
              focusDate={focusDate}
              focusNonce={focusNonce}
              nameMode={nameMode}
              activeTrendSourceId={activeTrendSourceId}
              onOpenTrend={onOpenTrend}
            />
          ))}
        </div>
      )}

      {range !== 'all' && (hiddenDates > 0 || expanded) && totalDates > 0 && (
        <div className="mt-1 flex justify-center">
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={`cumulative-section-${categoryId}`}
            className="inline-flex min-h-[26px] items-center gap-1 rounded-md px-2.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:min-h-[36px]"
          >
            {expanded
              ? (strings.showLess ?? '收合 · 回到{range}（{count} 筆）')
                .replace('{range}', rangeLabel)
                .replace('{count}', String(rangeInWindowCount))
              : (strings.showMore ?? '查看更多 · 其餘 {count} 筆')
                .replace('{count}', String(hiddenDates))}
            {expanded
              ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
              : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
          </button>
        </div>
      )}
    </section>
  )
}
