"use client"

// Cumulative lab report view (VGH 累積報告 style).
// Pivot: rows = dates (newest first), columns = tests.
//
// Two layouts share this shell, switched from the toolbar and remembered per
// device (cumulative-report-prefs.store):
//   • 直式 (stacked, DEFAULT) — every category as a section in one scroll,
//     bounded by the 顯示範圍 selector. See CumulativeStackedView.
//   • 分頁 (tabs) — the original one-category-at-a-time sub-tabs.
// Both read the SAME category order, so 微生物 never sits above 尿液 in one
// layout and below it in the other.
//
// Expand/fullscreen is handled at the parent level (ReportsCard) so the
// whole Reports section can be enlarged, not just this view.
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Loader2, TrendingUp } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useLabPivot, type LabPivot } from "../hooks/useLabPivot"
import { useReportNameMode } from "../context/report-name-mode.context"
import { preloadCumulativeLabTrendModule } from "./cumulative-lab-trend-loader"
import { useLabTrendOpener } from "../hooks/useLabTrendOpener"

import {
  SUBTAB_LIST_CLASSES,
  SUBTAB_TRIGGER_CLASSES,
} from "@/src/shared/config/ui-theme.config"
import { AnalyteSearchBox } from "./AnalyteSearchBox"
import { ReportNameModeSwitch } from "./ReportNameModeSwitch"
import { MicrobiologyCumulativeView } from "./MicrobiologyCumulativeView"
import { LabPivotTable } from "./LabPivotTable"
import { CumulativeStackedView } from "./CumulativeStackedView"
import {
  CumulativeLayoutToggle,
  CumulativeRangeSelector,
} from "./CumulativeRangeSelector"
import { useCumulativeReportPrefsStore } from "@/src/application/stores/cumulative-report-prefs.store"
import {
  DEFAULT_CUMULATIVE_CATEGORY_ORDER,
  moveCumulativeCategory,
  resolveCumulativeCategoryOrder,
} from "../utils/cumulative-order.utils"
import type { TrendWindow } from "../utils/trend-time-scale"
import { LabDataReportButton } from "@/features/lab-data-report"

interface CumulativeLabReportProps {
  observations: any[]
  /** Naming-mode control is owned by ReportsCard so it remains available
   *  while cumulative data is preparing, but positioned in this toolbar. */
  nameModeControl?: ReactNode
  /** When true, allow table to take more vertical space (e.g., parent fullscreen mode) */
  fullHeight?: boolean
  /** Active category id, lifted to the parent so the selected sub-tab (生化 …)
   *  survives the fullscreen toggle — which remounts this component and would
   *  otherwise reset the selection back to the first category (血液). When
   *  omitted the component falls back to its own internal state. */
  activeCategoryId?: string
  onCategoryChange?: (id: string) => void
  /** The category actually rendered — the parent-controlled id when it is
   *  usable, otherwise this component's own fallback. Reported separately from
   *  `onCategoryChange` (which is the user's explicit pick) so a consumer can
   *  observe the resolved default without being told a selection was made. */
  onActiveCategoryResolved?: (id: string) => void
  /** Canonical test key to horizontally reveal (e.g. CRP) after navigation. */
  focusAnalyteKey?: string
  /** Collection date whose analyte cell should be highlighted. */
  focusDate?: string
  /** Re-triggers focus when the same analyte is requested again. */
  focusNonce?: number
  /** Last range explicitly selected by the user; shared across analytes. */
  trendWindow?: TrendWindow
  onTrendWindowChange?: (window: TrendWindow) => void
}

export const CumulativeLabReport = memo(function CumulativeLabReport({
  observations,
  nameModeControl,
  fullHeight = false,
  activeCategoryId,
  onCategoryChange,
  onActiveCategoryResolved,
  focusAnalyteKey,
  focusDate,
  focusNonce,
  trendWindow,
  onTrendWindowChange,
}: CumulativeLabReportProps) {
  const nameMode = useReportNameMode()
  const pivots = useLabPivot(observations, nameMode)
  const { t } = useLanguage()
  const { openTrend, activeTrendSourceId, trendDialog } = useLabTrendOpener({
    observations,
    preferDialog: fullHeight,
    trendWindow,
    onTrendWindowChange,
  })
  // Memoized because the `|| {}` fallback would otherwise hand a fresh object
  // to every memo that reads it, once per render.
  const categoryLabels = useMemo(
    () => (t.reports as any).cumulativeCategories || {},
    [t.reports],
  )

  const layoutMode = useCumulativeReportPrefsStore((state) => state.layoutMode)
  const setLayoutMode = useCumulativeReportPrefsStore((state) => state.setLayoutMode)
  const range = useCumulativeReportPrefsStore((state) => state.range)
  const setRange = useCumulativeReportPrefsStore((state) => state.setRange)
  const persistedOrder = useCumulativeReportPrefsStore((state) => state.categoryOrder)
  const setCategoryOrder = useCumulativeReportPrefsStore((state) => state.setCategoryOrder)
  const resetCategoryOrder = useCumulativeReportPrefsStore((state) => state.resetCategoryOrder)
  const isStacked = layoutMode === 'stacked'

  // Reports is itself mounted during an idle period by LeftPanelLayout. Start
  // the optional chart chunk immediately after the cumulative table's first
  // paint; waiting for a second idle deadline can leave the first trend click
  // racing a still-unloaded chart on busy or slower machines.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const preload = () => {
      if (!cancelled) preloadCumulativeLabTrendModule()
    }
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(preload, 0)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  // Show every category, even when the patient has no data — pinnedColumns
  // ensures key analytes still appear as empty column headers so users can see
  // what's expected to be there. Ordering is the clinician's (persisted).
  const nonEmpty = useMemo(() => {
    const available = DEFAULT_CUMULATIVE_CATEGORY_ORDER.filter((id) => !!pivots[id])
    return resolveCumulativeCategoryOrder(persistedOrder, available)
      .map((id) => pivots[id])
      .filter((p): p is LabPivot => !!p)
  }, [persistedOrder, pivots])

  // Split into primary categories and hiddenByDefault ones (blood gas, and
  // future extra groups). Tabs layout only: 直式 shows every category, because
  // a section costs one line of height, not a slot in a crowded tab strip.
  const visibleCats = useMemo(() => nonEmpty.filter((p) => !p.category.hiddenByDefault), [nonEmpty])
  const hiddenCats = useMemo(() => nonEmpty.filter((p) => p.category.hiddenByDefault), [nonEmpty])

  const [internalActiveId, setInternalActiveId] = useState<string>(() => visibleCats[0]?.category.id || nonEmpty[0]?.category.id || 'cbc')
  // Single focus channel fed by both sources — the parent's props (AI-citation
  // navigation) and the in-table analyte search. Whichever acted last wins, and
  // `seq` always advances so re-picking the same analyte re-runs the centring
  // effect in LabPivotTable. `categoryId` is carried too: the stacked layout
  // has no "active tab" to infer the owning section from.
  // `key` is optional: a citation can point at a whole panel (「見生化」) with
  // no analyte, and 直式 still has to scroll that section into view.
  const [focusRequest, setFocusRequest] = useState<{ categoryId?: string; key?: string; date?: string; seq: number } | null>(
    () => (focusAnalyteKey || activeCategoryId
      ? { categoryId: activeCategoryId, key: focusAnalyteKey, date: focusDate, seq: 0 }
      : null),
  )
  const [seenPropNonce, setSeenPropNonce] = useState(focusNonce)
  // The parent-controlled category (AI-citation navigation, fullscreen remount)
  // is a scroll request of its own in 直式: 分頁 switches the tab through
  // `activeId`, but a stacked section only moves on screen if asked to.
  const [seenCategoryId, setSeenCategoryId] = useState(activeCategoryId)
  if (focusNonce !== seenPropNonce) {
    setSeenPropNonce(focusNonce)
    setSeenCategoryId(activeCategoryId)
    if (focusAnalyteKey) {
      setFocusRequest((previous) => ({
        categoryId: activeCategoryId,
        key: focusAnalyteKey,
        date: focusDate,
        seq: (previous?.seq ?? 0) + 1,
      }))
    }
  } else if (activeCategoryId !== seenCategoryId) {
    setSeenCategoryId(activeCategoryId)
    if (activeCategoryId) {
      setFocusRequest((previous) => ({
        categoryId: activeCategoryId,
        key: undefined,
        seq: (previous?.seq ?? 0) + 1,
      }))
    }
  }
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set())
  const tabsViewportRef = useRef<HTMLDivElement>(null)
  const allTabsMeasureRef = useRef<HTMLDivElement>(null)
  const [hasRoomForAll, setHasRoomForAll] = useState(false)
  // Prefer the parent-controlled id (survives the fullscreen remount) when it
  // points at a category that still has data; otherwise use internal state.
  const activeId = (activeCategoryId && nonEmpty.some((p) => p.category.id === activeCategoryId))
    ? activeCategoryId
    : internalActiveId
  const activeIsMicrobiology = !isStacked && activeId === 'microbio'
  // Tell the parent which category is on screen, including the fallback it
  // never chose. Effect (not render) so the parent's setState is committed
  // outside this component's render pass. In 直式 the stacked view reports its
  // own scrollspy position through the same channel.
  useEffect(() => {
    if (!isStacked && activeId) onActiveCategoryResolved?.(activeId)
  }, [activeId, isStacked, onActiveCategoryResolved])
  // A category's table remains mounted after the first visit. New categories
  // select immediately and show a compact preparation state for one paint,
  // keeping a large table mount out of the pointer/keyboard event itself.
  const [readyCategoryIds, setReadyCategoryIds] = useState<Set<string>>(
    () => new Set([activeId]),
  )
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null)

  useEffect(() => {
    if (isStacked) return
    const categoryToPrepare = pendingCategoryId
      ?? (readyCategoryIds.has(activeId) ? null : activeId)
    if (!categoryToPrepare || readyCategoryIds.has(categoryToPrepare)) return
    let timer: number | undefined
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        startTransition(() => {
          setReadyCategoryIds((previous) => previous.has(categoryToPrepare)
            ? previous
            : new Set(previous).add(categoryToPrepare))
          setPendingCategoryId((current) => current === categoryToPrepare ? null : current)
        })
      }, 0)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [activeId, isStacked, pendingCategoryId, readyCategoryIds])

  // Measure the real tab bar rather than relying on a screen-size breakpoint:
  // the left report pane can be resized independently from the window. The
  // invisible probe contains every category with the same typography and
  // spacing as the real tabs. If it fits, minority panels can be surfaced
  // directly and the 「查看更多」 picker is unnecessary.
  const measurementKey = nonEmpty
    .map((p) => `${p.category.id}:${categoryLabels[p.category.id] || p.category.id}:${p.dates.length}`)
    .join('|')

  useEffect(() => {
    if (isStacked) return
    const viewport = tabsViewportRef.current
    const allTabs = allTabsMeasureRef.current
    if (!viewport || !allTabs) return

    let disposed = false
    const measure = () => {
      if (disposed) return
      setHasRoomForAll(allTabs.scrollWidth <= viewport.clientWidth + 1)
    }

    measure()

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure)
    observer?.observe(viewport)
    observer?.observe(allTabs)
    window.addEventListener('resize', measure)

    // A late-loading webfont can change label widths without resizing the
    // viewport. ResizeObserver normally catches it; fonts.ready is a fallback
    // for browsers that do not report that intrinsic-size change.
    void document.fonts?.ready.then(measure)

    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [isStacked, measurementKey, activeId])

  // A hidden category is "shown" once all tabs fit, the user picked it
  // (revealedIds), or it's the active tab (e.g. a fullscreen remount restored a
  // blood-gas selection — Radix renders nothing for a value with no matching
  // trigger/content).
  const isHiddenShown = (id: string) => hasRoomForAll || revealedIds.has(id) || id === activeId
  const shownHidden = hiddenCats.filter((p) => isHiddenShown(p.category.id))
  // Preserve the clinician's order across the primary/extra split: the tab
  // strip must read in the same sequence as the stacked sections.
  const shownIds = new Set([...visibleCats, ...shownHidden].map((p) => p.category.id))
  const shownCats = nonEmpty.filter((p) => shownIds.has(p.category.id))
  // Hidden groups not yet surfaced → the dropdown's menu items. When empty, the
  // 「查看更多」 button disappears (all extras are already tabs).
  const pickableHidden = hiddenCats.filter((p) => !isHiddenShown(p.category.id))

  const setActiveId = (id: string) => {
    setInternalActiveId(id)
    if (!readyCategoryIds.has(id)) setPendingCategoryId(id)
    onCategoryChange?.(id)
  }

  // Picking an analyte from the search box switches category and focuses the
  // column. The nonce must change on every pick so choosing the same analyte
  // twice re-runs the centring effect.
  const pickAnalyte = (hit: { categoryId: string; testKey: string }) => {
    if (!isStacked && hiddenCats.some((p) => p.category.id === hit.categoryId)) {
      setRevealedIds((previous) => {
        if (previous.has(hit.categoryId)) return previous
        const next = new Set(previous)
        next.add(hit.categoryId)
        return next
      })
    }
    if (!isStacked) setActiveId(hit.categoryId)
    setFocusRequest((previous) => ({
      categoryId: hit.categoryId,
      key: hit.testKey,
      date: undefined,
      seq: (previous?.seq ?? 0) + 1,
    }))
  }
  const revealCategory = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setActiveId(id)
  }

  // Order edits resolve against the categories that exist right now, so a
  // move never silently drops a category the saved order had not seen.
  const availableIds = useMemo(() => nonEmpty.map((p) => p.category.id), [nonEmpty])
  const moveCategory = useCallback((id: string, direction: -1 | 1) => {
    const current = resolveCumulativeCategoryOrder(persistedOrder, availableIds)
    const next = moveCumulativeCategory(current, id, direction)
    if (next === current) return
    setCategoryOrder(next)
  }, [availableIds, persistedOrder, setCategoryOrder])

  // One 回報 for the whole report: it sends every lab panel, and the
  // clinician may tick which panels look wrong (chips in this order).
  const reportPanels = useMemo(
    () => nonEmpty
      .filter((pivot) => pivot.dates.length > 0)
      .map((pivot) => ({ id: pivot.category.id, label: categoryLabels[pivot.category.id] || pivot.category.id })),
    [categoryLabels, nonEmpty],
  )

  const stackedEntries = useMemo(
    () => nonEmpty.map((pivot) => ({
      pivot,
      label: categoryLabels[pivot.category.id] || pivot.category.id,
    })),
    [categoryLabels, nonEmpty],
  )

  if (nonEmpty.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4 text-center">
        No cumulative lab data available.
      </div>
    )
  }

  const layoutToggle = (
    <CumulativeLayoutToggle value={layoutMode} onChange={setLayoutMode} />
  )

  return (
    <div className={fullHeight
      ? '@container flex h-full flex-col min-w-0 w-full max-w-full overflow-hidden'
      : '@container space-y-3 min-w-0 w-full max-w-full overflow-clip'}
    >
      {/* Cumulative utilities share one responsive row: finder left, layout +
          naming mode right. The middle cell carries the trend hint in 分頁 and
          the 顯示範圍 selector in 直式 (which is the control a clinician
          retunes while reading). */}
      <div className="mb-1 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @min-[390px]:grid-cols-[minmax(140px,160px)_minmax(0,1fr)_auto] @min-[480px]:grid-cols-[minmax(200px,220px)_minmax(0,1fr)_auto] @min-[640px]:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_auto]">
        {activeIsMicrobiology ? (
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {(t.reports as any).microbiologyCumulative?.toolbarLabel ?? '依採檢日追蹤'}
          </span>
        ) : (
          <AnalyteSearchBox
            pivots={nonEmpty}
            categoryLabels={categoryLabels}
            nameMode={nameMode}
            onPick={pickAnalyte}
            className="w-full min-w-0 @min-[390px]:max-w-[160px] @min-[480px]:max-w-[220px] @min-[640px]:max-w-[260px]"
          />
        )}
        {isStacked ? (
          <div className="hidden min-w-0 justify-self-center @min-[1040px]:flex">
            <CumulativeRangeSelector value={range} onChange={setRange} />
          </div>
        ) : (
          <span data-tour="cumulative-trend-hint" className="hidden min-w-0 max-w-full items-center justify-self-center gap-1 overflow-hidden text-[0.6875rem] text-muted-foreground @min-[390px]:inline-flex">
            {activeIsMicrobiology ? (
              <span className="min-w-0 truncate">
                {(t.reports as any).microbiologyCumulative?.hint ?? '點列查看完整原文'}
              </span>
            ) : (
              <>
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="block min-w-0 truncate @min-[480px]:hidden">
                  {(t.reports as any).cumulativeTrend?.hintShort ?? '查看趨勢'}
                </span>
                <span className="hidden min-w-0 truncate @min-[480px]:block">
                  {(t.reports as any).cumulativeTrend?.hint ?? '點檢驗名稱查看趨勢'}
                </span>
              </>
            )}
          </span>
        )}
        <div className="col-start-2 flex items-center gap-2 justify-self-end @min-[390px]:col-start-3">
          {layoutToggle}
          {nameModeControl ?? <ReportNameModeSwitch responsiveLabels />}
          {reportPanels.length > 0 && (
            <LabDataReportButton
              panels={reportPanels}
              observations={observations}
              nameMode={nameMode}
            />
          )}
        </div>
      </div>
      {/* The range options measure ~410px, beside a 220px finder and the
          回報 + layout + naming controls (~370px): only a wide panel
          (≥1040px, e.g. fullscreen) fits them in the utility row. Everything
          narrower gets its own scrollable pill row directly under it. */}
      {isStacked && (
        <div className="mb-1 flex min-w-0 shrink-0 @min-[1040px]:hidden">
          <CumulativeRangeSelector value={range} onChange={setRange} scrollable />
        </div>
      )}
      {isStacked ? (
        <div className={fullHeight
          ? 'min-h-0 flex-1 w-full min-w-0 overflow-y-auto overscroll-contain'
          : 'w-full min-w-0'}
        >
          <CumulativeStackedView
            entries={stackedEntries}
            observations={observations}
            nameMode={nameMode}
            range={range}
            focusRequest={focusRequest?.categoryId
              ? { categoryId: focusRequest.categoryId, key: focusRequest.key, date: focusRequest.date, seq: focusRequest.seq }
              : null}
            activeTrendSourceId={activeTrendSourceId}
            onOpenTrend={openTrend}
            onMove={moveCategory}
            onResetOrder={resetCategoryOrder}
            canResetOrder={persistedOrder !== null}
            onActiveCategoryChange={onActiveCategoryResolved}
            onCategoryChange={onCategoryChange}
          />
        </div>
      ) : (
      <Tabs value={activeId} onValueChange={setActiveId} className={fullHeight ? 'flex h-full w-full min-w-0 flex-col overflow-hidden' : 'w-full min-w-0 overflow-hidden'}>
        <div className="relative flex min-w-0 items-center gap-2">
          <TabsList
            ref={tabsViewportRef}
            aria-label={(t.reports as any).cumulative ?? '累積報告分類'}
            className={`${SUBTAB_LIST_CLASSES} !flex min-w-0 flex-1 snap-x !flex-nowrap !justify-start gap-0 overflow-x-auto max-md:!min-h-[36px] max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30`}
          >
            {shownCats.map((p) => {
              const label = categoryLabels[p.category.id] || p.category.id
              return (
                <TabsTrigger
                  key={p.category.id}
                  value={p.category.id}
                  className={`${SUBTAB_TRIGGER_CLASSES} !min-w-fit !flex-none snap-start whitespace-nowrap text-xs max-md:!min-h-[36px]`}
                >
                  {label} ({p.dates.length})
                </TabsTrigger>
              )
            })}
            {/* 「查看更多」 dropdown — a picker over hiddenByDefault groups (blood
                gas, and future extra groups). Selecting an item reveals it as a
                real tab and switches to it; the button hides once every extra is
                already shown. A dropdown (not an all-or-nothing toggle) so more
                cumulative-report groups can be added without cluttering the bar. */}
            {pickableHidden.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] !min-w-fit !flex-none snap-start items-center gap-0.5 whitespace-nowrap px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:!min-h-[36px] xl:min-h-[24px]"
                  >
                    {(t.reports as any).cumulativeShowMore || 'More'}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[8rem]">
                  {pickableHidden.map((p) => {
                    const label = categoryLabels[p.category.id] || p.category.id
                    return (
                      <DropdownMenuItem
                        key={p.category.id}
                        onSelect={() => revealCategory(p.category.id)}
                        className="text-xs"
                      >
                        {label} ({p.dates.length})
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </TabsList>
          {/* Intrinsic-width probe used only to decide whether every category
              fits in one row. Fixed positioning keeps it out of both layout
              and the horizontal scroll area; aria-hidden keeps the duplicate
              labels out of the accessibility tree. */}
          <div
            ref={allTabsMeasureRef}
            data-cumulative-tabs-measure=""
            aria-hidden="true"
            className="fixed left-0 top-0 invisible pointer-events-none flex w-max items-center gap-1 p-1"
          >
            {nonEmpty.map((p) => {
              const label = categoryLabels[p.category.id] || p.category.id
              return (
                <span
                  key={p.category.id}
                  className={`inline-flex h-7 items-center justify-center whitespace-nowrap rounded-lg border border-transparent px-2 text-xs ${p.category.id === activeId ? 'font-semibold' : 'font-medium'}`}
                >
                  {label} ({p.dates.length})
                </span>
              )
            })}
          </div>
        </div>
        {shownCats.map((p) => (
          <TabsContent
            key={p.category.id}
            value={p.category.id}
            forceMount={readyCategoryIds.has(p.category.id) || undefined}
            className={fullHeight ? 'mt-1 flex-1 min-h-0 min-w-0 w-full max-w-full overflow-hidden' : 'mt-1 min-w-0 w-full max-w-full overflow-hidden'}
          >
            {readyCategoryIds.has(p.category.id) ? (
              p.category.id === 'microbio' ? (
                <MicrobiologyCumulativeView
                  observations={observations}
                  nameMode={nameMode}
                  fullHeight={fullHeight}
                />
              ) : (
                <LabPivotTable
                  pivot={p}
                  fullHeight={fullHeight}
                  focusAnalyteKey={p.category.id === activeId ? focusRequest?.key : undefined}
                  focusDate={p.category.id === activeId ? focusRequest?.date : undefined}
                  focusNonce={focusRequest?.seq}
                  nameMode={nameMode}
                  activeTrendSourceId={activeTrendSourceId}
                  onOpenTrend={openTrend}
                />
              )
            ) : (
              <div
                role="status"
                aria-live="polite"
                className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-border/70 bg-muted/25 px-4 text-sm text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{t.common.loading}</span>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      )}
      {trendDialog}
    </div>
  )
})
