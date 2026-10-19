"use client"

// 總覽 — one page holding the last N months of labs, narrative reports,
// medications and visits, with all four sections weighted equally.
//
// Two presentations from one component:
//   • narrow  (< 960px of container): stacked, page scrolls, four tiles at the
//     top act as both counters and jump targets.
//   • wide    (≥ 960px): a 2×2 grid that must fit on screen — neither the page
//     nor any card scrolls, so each card renders only the rows that fit and
//     summarises the rest with 「另 N 項 · 在○○分頁看全部 →」.
//
// The switch is driven by a ResizeObserver rather than a CSS container query
// because the wide layout needs the measured HEIGHT anyway (to decide row
// budgets); one observer answers both questions and keeps them in sync.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { formatDate } from '@/src/shared/utils/date.utils'
import { LoadingSkeleton } from '@/src/shared/components/LoadingSkeleton'
import { ErrorMessage } from '@/src/shared/components/ErrorMessage'
import { useOverviewWindow } from './hooks/useOverviewWindow'
import { useOverviewData } from './hooks/useOverviewData'
import type { OverviewRangeMonths } from './utils/overview-selectors'
import { OverviewHeader } from './components/OverviewHeader'
import { OverviewNavTiles } from './components/OverviewNavTiles'
import { OverviewLabsSection } from './components/OverviewLabsSection'
import { OverviewReportsSection } from './components/OverviewReportsSection'
import { OverviewMedsSection } from './components/OverviewMedsSection'
import { OverviewVisitsSection } from './components/OverviewVisitsSection'
import type { OverviewSectionFit } from './overview.types'
import {
  OVERVIEW_SECTION_DOM_ID,
  OVERVIEW_WIDE_BREAKPOINT_PX,
  type OverviewSectionId,
} from './overview.types'

/** Container width at which the stacked page becomes the 2×2 grid. */
/** Below this a 2×2 cell is too short to be worth the density; stay stacked. */
const OVERVIEW_WIDE_MIN_HEIGHT_PX = 420

const useIsomorphicLayoutEffect =
  typeof globalThis.window === 'undefined' ? useEffect : useLayoutEffect

const SECTION_IDS: OverviewSectionId[] = ['labs', 'reports', 'meds', 'visits']

export function OverviewCard() {
  const { t, locale } = useLanguage()
  const strings = t.overview
  const { window: overviewWindow, setMonths } = useOverviewWindow()
  const data = useOverviewData(overviewWindow)
  const rangeChosenByUserRef = useRef(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef<Partial<Record<OverviewSectionId, HTMLDivElement | null>>>({})
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [cellHeights, setCellHeights] = useState<Partial<Record<OverviewSectionId, number>>>({})
  const [flashed, setFlashed] = useState<OverviewSectionId | null>(null)

  // Start with the compact three-month view when it contains any of the
  // clinician's common analytes. Otherwise widen progressively to six months,
  // then one year, stopping as soon as a common result appears. A later
  // explicit range choice is authoritative despite an empty 常用 set.
  useEffect(() => {
    if (
      rangeChosenByUserRef.current
      || data.isLoading
      || data.error
      || data.labs.pinnedRowCount > 0
    ) return
    if (overviewWindow.months === 3) setMonths(6)
    else if (overviewWindow.months === 6) setMonths(12)
  }, [data.error, data.isLoading, data.labs.pinnedRowCount, overviewWindow.months, setMonths])

  const handleRangeChange = useCallback((months: OverviewRangeMonths) => {
    rangeChosenByUserRef.current = true
    setMonths(months)
  }, [setMonths])

  useIsomorphicLayoutEffect(() => {
    const element = rootRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      setSize((previous) => (
        previous
          && Math.abs(previous.width - box.width) < 1
          && Math.abs(previous.height - box.height) < 1
          ? previous
          : { width: box.width, height: box.height }
      ))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const isWide = !!size
    && size.width >= OVERVIEW_WIDE_BREAKPOINT_PX
    && size.height >= OVERVIEW_WIDE_MIN_HEIGHT_PX

  // In the bounded layout each section decides its own row budget, so what it
  // needs is the height of its card's CONTENT box — not the cell, which also
  // holds the card frame and header. The card primitive marks that box with
  // `data-slot="card-content"`, so the cell resolves it rather than every
  // section having to thread a ref back up.
  useIsomorphicLayoutEffect(() => {
    if (!isWide || typeof ResizeObserver === 'undefined') {
      setCellHeights((previous) => (Object.keys(previous).length === 0 ? previous : {}))
      return
    }
    const observer = new ResizeObserver((entries) => {
      setCellHeights((previous) => {
        let next = previous
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.overviewCell as OverviewSectionId | undefined
          if (!id) continue
          const height = entry.contentRect.height
          if (previous[id] !== undefined && Math.abs(previous[id]! - height) < 1) continue
          if (next === previous) next = { ...previous }
          next[id] = height
        }
        return next
      })
    })
    for (const id of SECTION_IDS) {
      const cell = cellRefs.current[id]
      const content = cell?.querySelector<HTMLElement>('[data-slot="card-content"]')
      if (!content) continue
      content.dataset.overviewCell = id
      observer.observe(content)
    }
    return () => observer.disconnect()
    // `data` is in the deps because a section that was empty renders no card
    // content box until it has rows; re-resolving keeps the budget accurate.
  }, [data, isWide])

  const registerCell = useCallback(
    (id: OverviewSectionId) => (element: HTMLDivElement | null) => {
      cellRefs.current[id] = element
    },
    [],
  )

  const jumpTo = useCallback((section: OverviewSectionId) => {
    document
      .getElementById(OVERVIEW_SECTION_DOM_ID[section])
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlashed(section)
  }, [])

  useEffect(() => {
    if (!flashed) return
    const timer = globalThis.setTimeout(() => setFlashed(null), 2100)
    return () => globalThis.clearTimeout(timer)
  }, [flashed])

  const fits = useMemo<Record<OverviewSectionId, OverviewSectionFit>>(() => ({
    labs: { bounded: isWide, availablePx: cellHeights.labs },
    reports: { bounded: isWide, availablePx: cellHeights.reports },
    meds: { bounded: isWide, availablePx: cellHeights.meds },
    visits: { bounded: isWide, availablePx: cellHeights.visits },
  }), [cellHeights, isWide])

  const labs = <OverviewLabsSection data={data.labs} fit={fits.labs} flash={flashed === 'labs'} />
  const reports = (
    <OverviewReportsSection data={data.reports} fit={fits.reports} flash={flashed === 'reports'} />
  )
  const meds = <OverviewMedsSection data={data.meds} fit={fits.meds} flash={flashed === 'meds'} />
  const visits = (
    <OverviewVisitsSection
      data={data.visits}
      window={overviewWindow}
      fit={fits.visits}
      flash={flashed === 'visits'}
    />
  )

  return (
    <div
      ref={rootRef}
      data-testid="overview-card"
      data-tour="overview-card"
      data-overview-layout={isWide ? 'grid' : 'stacked'}
      className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden"
    >
      <OverviewHeader window={overviewWindow} onRangeChange={handleRangeChange} />

      {/* Nothing in range in any of the four sections: name the newest record
          the chart holds so the clinician knows to widen rather than wondering
          whether the import failed. */}
      {!data.isLoading && !data.error && data.isEmpty && data.latestDataDay && (
        <div className="shrink-0 text-xs text-muted-foreground">
          {strings.emptyAll.replace('{date}', formatDate(data.latestDataDay, locale))}
        </div>
      )}

      {data.error ? (
        <ErrorMessage error={data.error} context="overview" />
      ) : data.isLoading ? (
        <LoadingSkeleton />
      ) : isWide ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[repeat(2,minmax(0,1fr))] gap-3 overflow-hidden">
          <OverviewCell id="labs" register={registerCell}>{labs}</OverviewCell>
          <OverviewCell id="reports" register={registerCell}>{reports}</OverviewCell>
          <OverviewCell id="meds" register={registerCell}>{meds}</OverviewCell>
          <OverviewCell id="visits" register={registerCell}>{visits}</OverviewCell>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-1">
          <OverviewNavTiles data={data} onJump={jumpTo} />
          {labs}
          {reports}
          {meds}
          {visits}
          <div className="pt-1 text-[0.6875rem] text-muted-foreground">{strings.footnote}</div>
        </div>
      )}
    </div>
  )
}

function OverviewCell({
  id,
  register,
  children,
}: {
  id: OverviewSectionId
  register: (id: OverviewSectionId) => (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  return (
    <div ref={register(id)} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      {children}
    </div>
  )
}
