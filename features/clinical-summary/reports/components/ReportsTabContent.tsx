// Reports Tab Content Component
//
// Virtualised list — only rows currently visible in the scroll viewport are
// rendered, regardless of total count. With 500+ rows in "全部" / "檢驗" tabs
// this is the difference between a 1.5s tab switch and an instant one. Each
// ReportRow has variable height (some expand into accordions), so we use
// @tanstack/react-virtual's dynamic-measurement mode.
//
// Scroll behaviour:
// - normal card mode uses the outer panel scroll, so tabs/search scroll away
//   with the report list instead of staying pinned above an internal scroller.
// - fullscreen mode keeps the old internal scroll because the overlay itself is
//   fixed-height.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Loader2 } from "lucide-react"
import { TabsContent } from "@/components/ui/tabs"
import { cn } from "@/src/shared/utils/cn.utils"
import type { Row } from '../types'
import { isSystolicDiastolicBloodPressureRow } from '../utils/blood-pressure-panel'
import { AdultPreventiveGroupCard } from './AdultPreventiveGroupCard'
import { CancerScreeningRow } from './CancerScreeningRow'
import { ReportRow } from './ReportRow'
import { LabReportRow } from './lab-table/LabReportRow'
import { LabTableHeader } from './lab-table/LabTableHeader'
import type { LabTableVariant } from './lab-table/lab-table-layout'

interface ReportsTabContentProps {
  value: string
  rows: Row[]
  /** Only the visible tab should attach virtual scroll observers. */
  isActive?: boolean
  /** Whether the parent top-level Reports tab is visible. Its rows remain
   *  mounted while hidden, but must not observe another tab's scrolling. */
  workspaceActive?: boolean
  /** When true, take remaining vertical space and scroll internally
   *  (used in fullscreen mode where the parent has overflow-hidden). */
  fullHeight?: boolean
  /** When true, keep this content mounted across tab switches (Radix
   *  hides inactive via CSS). Driven by parent's "visited tabs" set so
   *  unvisited tabs don't mount upfront. */
  forceMount?: true
  /** Row ids whose accordion should start open — used by the parent to
   *  auto-expand rows whose search match came from an inner observation
   *  (e.g. "RBC" inside "全套血液檢查Ⅰ"), so the user can see the matched
   *  item without an extra click. */
  defaultOpenIds?: string[]
  /** True when a search query is active, so the empty state can say "no
   *  matches" instead of the misleading "no data in this category". */
  searchActive?: boolean
  /** Active search query — forwarded to ReportRow to highlight title matches. */
  query?: string
  /** Resource navigation: Row.id to scroll to. Virtualizer-driven (off-screen
   *  rows aren't mounted, so a per-row anchor can't work here); the row is
   *  also auto-expanded and flashed. */
  scrollToId?: string | null
  /** Bump to re-trigger the scroll for the same id. */
  scrollNonce?: number
  /** Called only after the target row is actually mounted and highlighted. */
  onScrollResolved?: (nonce?: number) => void
  /** Raw report resources are being projected after the selected tab has
   *  already painted. Prevent an empty-state flash during that first visit. */
  isPreparing?: boolean
  preparingLabel?: string
  emptyLabel?: string
  noMatchesLabel?: string
  /** Lab tab: render rows on the shared column grid (flat list or day view)
   *  inside one bordered table with a column header. */
  labVariant?: LabTableVariant
}

// Stable fallback so referential equality holds when no expand list is
// provided — keeps React.memo on ReportRow skipping.
const EMPTY_OPEN_IDS: string[] = []

// Initial guess for each row's height before the virtualizer measures it.
// Most rows are single-line compact cards (~52px); a generous estimate
// keeps over-rendering low at startup but the measurement step corrects
// any drift as soon as rows are in the DOM.
const ESTIMATED_ROW_HEIGHT = 56

function findExternalScrollElement(el: HTMLElement): HTMLElement | null {
  // Every top-level clinical tab owns a height-constrained Radix viewport.
  // Bind the virtualizer to that nearest viewport even during its first layout
  // pass, before the virtual spacer has made `scrollHeight > clientHeight`.
  // Walking outward by current scroll metrics can otherwise select the shared
  // panel for one frame and leave rows frozen when the tab viewport scrolls.
  const tabViewport = el.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (tabViewport) return tabViewport

  // Fullscreen/standalone fixtures may not live inside the clinical ScrollArea.
  // Retain an overflow-ancestor fallback for those layouts.
  let lastOverflowCandidate: HTMLElement | null = null
  let parent = el.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY)) {
      lastOverflowCandidate = parent
      if (parent.scrollHeight > parent.clientHeight + 1) return parent
    }
    parent = parent.parentElement
  }
  return lastOverflowCandidate
}

function ReportsTabContentImpl({ value, rows, isActive = true, workspaceActive = true, fullHeight = false, forceMount, defaultOpenIds, searchActive, query, scrollToId, scrollNonce, onScrollResolved, isPreparing = false, preparingLabel = 'Loading', emptyLabel = 'No reports available in this category.', noMatchesLabel = 'No matching reports.', labVariant }: ReportsTabContentProps) {
  // The navigation target opens like a search hit — the user asked to SEE
  // this report, not to find its collapsed shell. The vitals tab also keeps
  // complete systolic/diastolic BP panels immediately readable; other
  // composite vital rows remain collapsed.
  const openIds = useMemo(() => {
    const base = defaultOpenIds ?? EMPTY_OPEN_IDS
    const bloodPressureIds = value === 'vitals'
      ? rows.filter(isSystolicDiastolicBloodPressureRow).map((row) => row.id)
      : EMPTY_OPEN_IDS
    const requestedIds = scrollToId ? [scrollToId] : EMPTY_OPEN_IDS
    const additions = [...new Set([...bloodPressureIds, ...requestedIds])]
      .filter((id) => !base.includes(id))
    return additions.length > 0 ? [...base, ...additions] : base
  }, [defaultOpenIds, rows, scrollToId, value])
  // Callback-ref-into-state pattern: when the scroll div attaches, React
  // calls setScrollEl with the element. That triggers a re-render whose
  // useVirtualizer call reads the now-non-null element and measures
  // immediately. A plain useRef + getScrollElement returning ref.current
  // doesn't re-render when the ref attaches, so the virtualizer's first
  // measurement happens against a null scrollElement and getVirtualItems
  // returns []. See @tanstack/react-virtual issue #846 for the workaround.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const [externalScrollEl, setExternalScrollEl] = useState<HTMLElement | null>(null)
  const [externalScrollMargin, setExternalScrollMargin] = useState(0)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns its mutable measurement callbacks here.
  const virtualizer = useVirtualizer({
    // Row measurement runs from the ref attachment/layout lifecycle. TanStack
    // Virtual's default flushSync update is invalid while React is already
    // committing that lifecycle (React 19 warns and may repeat the warning for
    // every visible row). Let React schedule the measurement rerender instead.
    useFlushSync: false,
    count: rows.length,
    // Preserve the measured first window while this force-mounted view is
    // hidden. Only detach it from the shared panel scroller; setting enabled
    // false would erase TanStack Virtual's measurement cache.
    enabled: isActive && (fullHeight ? !!scrollEl : !!externalScrollEl),
    getScrollElement: () => workspaceActive
      ? (fullHeight ? scrollEl : externalScrollEl)
      : null,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    // Keep a small buffer above/below the viewport so users don't see a
    // flash of blank when they scroll quickly. 6 rows ≈ half a screen.
    overscan: 6,
    // Stable key so virtualizer can preserve measured heights across
    // re-renders triggered by props changing — without it, every parent
    // re-render would reset the measurement cache and re-estimate.
    getItemKey: (index) => rows[index]?.id ?? index,
    scrollMargin: fullHeight ? 0 : externalScrollMargin,
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  useEffect(() => {
    if (!workspaceActive || fullHeight || !listEl || typeof window === 'undefined') return
    setExternalScrollEl(findExternalScrollElement(listEl))
  }, [workspaceActive, fullHeight, listEl])

  useEffect(() => {
    if (!isActive || !workspaceActive || fullHeight || !listEl || !externalScrollEl || typeof window === 'undefined') return
    const measure = () => {
      const listRect = listEl.getBoundingClientRect()
      const scrollRect = externalScrollEl.getBoundingClientRect()
      setExternalScrollMargin(listRect.top - scrollRect.top + externalScrollEl.scrollTop)
    }
    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(listEl)
    resizeObserver.observe(externalScrollEl)
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [isActive, workspaceActive, fullHeight, listEl, externalScrollEl, rows.length, searchActive, query])

  // Resource navigation: drive the virtualizer to the target row, then flash
  // it once mounted. setTimeout (not rAF — frozen in background tabs) gives
  // the virtualizer a beat to mount the scrolled-to row.
  useEffect(() => {
    if (!isActive || !workspaceActive || !scrollToId) return
    // In normal-card mode the virtualizer cannot scroll until its external
    // ScrollArea viewport is known. Previously this effect ran once with a
    // null viewport, the scroll became a no-op, and it never retried when the
    // viewport attached because externalScrollEl was not a dependency.
    if (!fullHeight && !externalScrollEl) return
    const rowContainer = fullHeight ? scrollEl : listEl
    if (!rowContainer) return
    const index = rows.findIndex((r) => r.id === scrollToId)
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'center' })
    const scrollBounds = fullHeight ? scrollEl : externalScrollEl
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const confirmVisible = () => {
      const el = rowContainer.querySelector(`[data-row-id="${CSS.escape(scrollToId)}"]`)
      if (el) {
        const rowRect = el.getBoundingClientRect()
        const boundsRect = scrollBounds?.getBoundingClientRect()
        const hasLayoutMetrics = rowRect.height > 0 || (boundsRect?.height ?? 0) > 0
        const visibleTop = Math.max(boundsRect?.top ?? 0, 0)
        const visibleBottom = Math.min(boundsRect?.bottom ?? window.innerHeight, window.innerHeight)
        const isActuallyVisible = !hasLayoutMetrics
          || (rowRect.bottom > visibleTop && rowRect.top < visibleBottom)

        if (isActuallyVisible) {
          setFlashId(scrollToId)
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          flashTimerRef.current = setTimeout(() => {
            setFlashId((current) => current === scrollToId ? null : current)
            flashTimerRef.current = null
          }, 2000)
          onScrollResolved?.(scrollNonce)
          return
        }
      }

      // Dynamic measurement and accordion expansion may take more than one
      // paint. Retry briefly, but never acknowledge an off-screen row; if it
      // remains invisible the store request stays pending and the caller's
      // fallback toast tells the user to locate the report manually.
      attempts += 1
      if (attempts < 18) timer = setTimeout(confirmVisible, 100)
    }
    timer = setTimeout(confirmVisible, 100)
    return () => {
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- virtualizer is a fresh object each render
  }, [isActive, workspaceActive, scrollToId, scrollNonce, onScrollResolved, fullHeight, scrollEl, listEl, externalScrollEl, rows])

  return (
    <TabsContent
      value={value}
      forceMount={forceMount}
      className={fullHeight ? 'mt-0 flex-1 min-h-0' : 'mt-0'}
    >
      {isPreparing ? (
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-border/70 bg-muted/25 px-4 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{preparingLabel}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {searchActive ? noMatchesLabel : emptyLabel}
        </div>
      ) : (
        <LabTableFrame variant={labVariant} fullHeight={fullHeight}>
        <div
          ref={fullHeight ? setScrollEl : setListEl}
          className={
            fullHeight
              ? cn('h-full overflow-y-auto', !labVariant && 'pr-1', labVariant && 'min-h-0 flex-1')
              : (labVariant ? '-mb-px' : 'pr-1')
          }
        >
          {/* Outer spacer sized to the *full* list height so the scrollbar
              reflects the real total; absolute-positioned children let the
              virtualizer place only the visible window. */}
          <div
            style={{
              height: `${totalSize}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {items.map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  key={virtualRow.key}
                  // measureElement attaches a ResizeObserver so the
                  // virtualizer learns each row's real height after mount,
                  // honouring accordion expansion / wrapping.
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-row-id={row.id}
                  className={flashId === row.id ? 'resource-flash' : undefined}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                    paddingBottom: 0,
                  }}
                >
                  {row.adultPreventiveGroup ? (
                    <AdultPreventiveGroupCard row={row} defaultOpen={openIds} query={query} showTypeBadge={value === 'all'} />
                  ) : row.group === 'cancer-screening' ? (
                    <CancerScreeningRow row={row} defaultOpen={openIds} query={query} showTypeBadge={value === 'all'} />
                  ) : labVariant ? (
                    <LabReportRow row={row} variant={labVariant} defaultOpen={openIds} query={query} />
                  ) : (
                    <ReportRow row={row} defaultOpen={openIds} query={query} showTypeBadge={value === 'all'} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
        </LabTableFrame>
      )}
    </TabsContent>
  )
}

/** The lab tab's one bordered table: column header above, rows below. Other
 *  tabs render their list bare. `overflow-clip` (not hidden) keeps the sticky
 *  header attached to the panel's scroller; the list's `-mb-px` lays the last
 *  row's divider over the frame's own bottom edge instead of doubling it. */
function LabTableFrame({ variant, fullHeight, children }: { variant?: LabTableVariant; fullHeight: boolean; children: ReactNode }) {
  if (!variant) return <>{children}</>
  return (
    <div
      data-testid="lab-table"
      data-variant={variant}
      className={cn(
        '@container overflow-clip rounded-lg border border-border bg-card',
        fullHeight && 'flex h-full flex-col',
      )}
    >
      <LabTableHeader variant={variant} />
      {children}
    </div>
  )
}

// Memoized so parent re-renders (e.g. someone above changing state that
// doesn't affect this tab's props) don't trip the .map → ReportRow chain
// on every visited tab. Combined with React.memo on ReportRow this turns
// tab switches into a pure CSS hide/show for already-mounted tabs.
export const ReportsTabContent = memo(ReportsTabContentImpl)
