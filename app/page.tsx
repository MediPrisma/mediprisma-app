// app/page.tsx
"use client"

import { AppProviders } from "@/src/application/providers/app-providers"
import { useLanguage } from "@/src/application/providers/language.provider"
import { FirstRunOnboardingDialog } from "./_components/FirstRunOnboardingDialog"
import { HeaderOverflowMenu } from "@/src/shared/components/HeaderOverflowMenu"
import { ImportBundleButton } from "@/features/import-bundle/ImportBundleButton"
import { HeaderAuthButton } from "@/features/auth"
import { OVERVIEW_WIDE_PANEL_PX } from "@/features/clinical-summary/overview/overview.types"
import { WorkspacePanelsProvider } from "@/src/application/providers/workspace-panels.provider"
import { hasUnseenSummary, useSummaryActivityStore } from "@/src/application/stores/summary-activity.store"
import { elapsedSeconds, useSecondTick } from "@/src/shared/hooks/use-second-tick.hook"
import { EmailVerificationBanner } from "@/features/auth/components/EmailVerificationBanner"
import { WelcomeOnboarding } from "./_components/WelcomeOnboarding"
import { RightDetailPane } from "./_components/RightDetailPane"
import { RightDetailProvider, useRightDetail } from "@/src/application/providers/right-detail.provider"
import { ErrorBoundary } from "@/src/shared/components/ErrorBoundary"
import ClinicalSummaryFeature from "@/src/layouts/LeftPanelLayout"
import { RightPanelFeature } from "@/src/layouts/RightPanelLayout"
import { useResizableLayout } from "@/src/shared/hooks/layout/use-resizable-layout.hook"
import { useResponsiveView } from "@/src/shared/hooks/layout/use-responsive-view.hook"
import { useBackDismissibleLayer } from "@/src/shared/hooks/layout/use-back-dismissible-layer.hook"
import { usePatient } from "@/src/application/hooks/patient/use-patient-query.hook"
import { useResourceNavigationStore } from "@/src/application/stores/resource-navigation.store"
import { useRightPanel } from "@/src/application/providers/right-panel.provider"
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type UIEvent } from "react"
import { AiDemographicsGateProvider } from "@/src/application/providers/ai-demographics-gate.provider"
import { AiDemographicsGateDialog } from "@/features/medical-summary/components/AiDemographicsGateDialog"
import { useLeftBrowserTourStore } from "@/features/left-browser-tour"
import { RightFeatureTour, useRightFeatureTourStore } from "@/features/right-feature-tour"
import {
  GuidedTourOverlay,
  TourHub,
  TourHubMenuItem,
} from "@/features/guided-tour"
import { useUnseenNews } from "@/features/guided-tour/use-unseen-news"
import { applyPilotPackIdsFromUrl } from "@/features/clinical-decision-support/guideline-packs/pilot-gate"
import { NetworkStatusBanner } from "@/src/shared/components/NetworkStatusBanner"
import { ProgressiveImportStatus } from "@/features/import-bundle/components/ProgressiveImportStatus"
import { BUNDLE_CHANGED_EVENT } from "@/src/shared/utils/reset-on-bundle-change"
import {
  ClinicalMobilePanelSwitcher,
  ClinicalPatientContext,
  ClinicalWorkspaceDivider,
  ClinicalWorkspaceMain,
  ClinicalWorkspacePanel,
  ClinicalWorkspaceRail,
  ClinicalWorkspaceRoot,
} from "@/src/shared/components/clinical-workspace"

// Closing a right-side detail is a PageContent-only presentation change. Keep
// the two large workspaces from rendering again during that first paint; their
// own context/store updates still render them when their data actually changes.
const StableClinicalSummaryFeature = memo(ClinicalSummaryFeature)
const StableRightPanelFeature = memo(RightPanelFeature)

// The split's centre stop, and the slack that keeps a divider dragged to
// 49.7% from reading as "not centred".
const EVEN_SPLIT_PCT = 50
const SPLIT_EPSILON_PCT = 1

function PageContent() {
  const { t } = useLanguage()

  // Resizable layout logic (extracted to custom hook)
  const {
    leftWidth, containerRef, handleMouseDown, setLeftWidth,
    resetPreferredWidth, preferredWidthReachable,
  } = useResizableLayout({
    initialWidth: 50,
    minWidth: 30,
    maxWidth: 70,
    // 總覽 lays its four sections out as a 2×2 grid once its container reaches
    // OVERVIEW_WIDE_BREAKPOINT_PX; an even split leaves most displays a few
    // pixels short of it, so the landing view falls back to the stacked list
    // for want of ~30px. Ask for just enough on mount. A display that cannot
    // reach it inside the 70% cap keeps the even split (see the hook).
    preferLeftContentPx: OVERVIEW_WIDE_PANEL_PX,
  })

  // Responsive view logic (extracted to custom hook)
  // Two-panel split kicks in at 768px (md) so iPad-portrait tablets get the
  // resizable + collapsible split instead of the phone single-column tab view.
  // Below 768 = phone tab switcher. Keep this in sync with the md: classes below.
  const { mobileView, setMobileView, isLargeScreen } = useResponsiveView<'left' | 'right'>('left', 768)

  const navPending = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)

  // Panel collapse (lg only): collapse either side to give the other full width.
  // null = normal resizable split. Kept in-session (not persisted) to avoid the
  // SSR/localStorage hydration mismatch class of bugs.
  // The reader's own choice, and nothing else. Whether a panel is actually
  // collapsed right now is derived below — keeping the two apart is what lets
  // the automatic behaviour switch itself off permanently the moment they
  // express a preference, without a second state to keep in step.
  const [chosenCollapse, setChosenCollapse] = useState<'left' | 'right' | null>(null)
  const [collapseChosen, setCollapseChosen] = useState(false)
  const setCollapsedByUser = useCallback((panel: 'left' | 'right' | null) => {
    setCollapseChosen(true)
    setChosenCollapse(panel)
  }, [])

  // A display too small to fit 總覽's 2×2 even at the split's maximum gets the
  // whole width instead of a layout that cannot appear — and gets it back the
  // moment the window (or the zoom level) makes the split viable again.
  // Derived rather than stored: an effect that wrote this into state would
  // cascade a second render on every resize, and would have to be unwound
  // correctly when the reader overrode it.

  // Divider controls step, they do not jump. Once the split opens wider than
  // half (the overview asks for ~64% so its 2×2 fits), a single click that
  // went straight to a collapsed panel skipped the one position most people
  // actually want next — the even split. So each control first travels back to
  // centre, and only collapses that side on the click after. Coming from the
  // far side there is no centre left to travel to, so it collapses at once.
  const stepsToCentre = (direction: 'left' | 'right') => (
    direction === 'left'
      ? leftWidth > EVEN_SPLIT_PCT + SPLIT_EPSILON_PCT
      : leftWidth < EVEN_SPLIT_PCT - SPLIT_EPSILON_PCT
  )
  const stepLeft = () => (
    stepsToCentre('left') ? setLeftWidth(EVEN_SPLIT_PCT) : setCollapsedByUser('left')
  )
  const stepRight = () => (
    stepsToCentre('right') ? setLeftWidth(EVEN_SPLIT_PCT) : setCollapsedByUser('right')
  )
  const stepLeftLabel = stepsToCentre('left')
    ? t.header.evenSplit
    : t.header.collapseClinicalSummary
  const stepRightLabel = stepsToCentre('right')
    ? t.header.evenSplit
    : t.header.collapseFeatures

  // A summary that finished while the feature panel was collapsed has no way
  // to announce itself — the panel IS its only surface. The rail says so, and
  // opening it acknowledges the run. Nothing here starts a generation:
  // `autoGenerate` stays false by default, so this is silent unless the
  // clinician turned auto-generate on or pressed 產生摘要 themselves.
  const summaryGenerating = useSummaryActivityStore((state) => state.isGenerating)
  const summaryStartedAt = useSummaryActivityStore((state) => state.startedAt)
  const summaryCompletedAt = useSummaryActivityStore((state) => state.completedAt)
  const summaryAcknowledgedAt = useSummaryActivityStore((state) => state.acknowledgedAt)
  const acknowledgeSummary = useSummaryActivityStore((state) => state.acknowledge)
  const leftTourActive = useLeftBrowserTourStore((state) => state.active)
  const rightTourActive = useRightFeatureTourStore((state) => state.active)
  const anyTourActive = leftTourActive || rightTourActive
  const tourWasActiveRef = useRef(false)
  const preTourLayoutRef = useRef<{
    mobileView: 'left' | 'right'
    collapsed: 'left' | 'right' | null
  } | null>(null)

  // Guided tours make their corresponding panel visible, then return the
  // user's mobile/collapsed layout when the tour is closed or completed.
  useEffect(() => {
    if (anyTourActive) {
      if (!tourWasActiveRef.current) {
        tourWasActiveRef.current = true
        // The reader's CHOICE is what a tour must give back; the automatic
        // narrow-display collapse re-derives itself either way.
        preTourLayoutRef.current = { mobileView, collapsed: chosenCollapse }
      }
      setMobileView(rightTourActive ? 'right' : 'left')
      // Tour state is an external store event; revealing its panel is the
      // synchronization this effect owns.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChosenCollapse(null)
      return
    }
    if (tourWasActiveRef.current) {
      tourWasActiveRef.current = false
      const previous = preTourLayoutRef.current
      preTourLayoutRef.current = null
      if (previous) {
        setMobileView(previous.mobileView)
        setChosenCollapse(previous.collapsed)
      }
    }
  }, [anyTourActive, chosenCollapse, mobileView, rightTourActive, setMobileView])

  // Resource navigation (cited source clicked in the Medical Summary tab): the
  // target lives in the LEFT panel, so make sure it's visible BEFORE its
  // tab/anchor react to the same request — flip the phone single-column view to
  // 臨床摘要, and on desktop un-collapse the left panel if it was hidden (the
  // anchor can't scroll into a display:none column).
  useEffect(() => {
    if (!navPending) return
    setMobileView('left')
    // Resource-navigation requests come from an external store and must make
    // the target panel visible before anchor scrolling runs.
    // Only the reader's own choice can hide the clinical panel, so clearing
    // that choice is enough here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChosenCollapse((c) => (c === 'left' ? null : c))
  }, [navPending, navSeq, setMobileView])

  // The opposite direction: a control in the clinical summary sent the reader
  // to a right-panel task (總覽 → 帶回病歷). Flip the phone view to 功能 and
  // reopen a collapsed right panel — asking for it is the reader choosing it.
  const { revealSeq } = useRightPanel()
  useEffect(() => {
    if (!revealSeq) return
    setMobileView('right')
    // A request from an external context must make the panel visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChosenCollapse((c) => (c === 'right' ? null : c))
    setCollapseChosen(true)
  }, [revealSeq, setMobileView])

  const unseenNewsCount = useUnseenNews().length

  // Onboarding detection: when neither SMART nor a local bundle is available,
  // the data hooks return `patient: null` with no error. Show a welcome
  // screen instead of empty / failing panels.
  const { patient, loading: patientLoading, error: patientError } = usePatient()
  const showOnboarding = !patientLoading && !patient && !patientError
  const dataLoaded = !!patient && !patientLoading && !patientError
  // Tours never offer themselves over the chart: they wait in 更多 → 導覽中心
  // until the clinician asks for one.

  // Right-pane detail: a left-panel card can push its expanded detail here
  // instead of expanding downward (see RightDetailProvider). When set, the right
  // section shows the detail (✕ returns to the AI features). Cleared on patient
  // change so one patient's detail never lingers onto the next.
  const { detail, clearDetail } = useRightDetail()
  const [closingDetailSourceId, setClosingDetailSourceId] = useState<string | null>(null)
  const deferredDetailClearFrameRef = useRef<number | null>(null)
  const deferredDetailClearTimerRef = useRef<number | null>(null)
  const detailVisible = !!detail && detail.sourceId !== closingDetailSourceId

  // What is actually collapsed right now. Derived, never stored: an effect
  // writing this into state would cascade a render on every resize and would
  // have to be unwound when the reader overrode it.
  //
  // A display too small to fit 總覽's 2×2 even at the split's maximum gets the
  // whole width instead of a layout that cannot appear, and gets it back the
  // moment the window or the zoom level makes the split viable again. Two
  // things switch that off: the reader choosing a collapse state themselves,
  // and a detail pane, which needs the right column to be there at all.
  const collapsed: 'left' | 'right' | null = collapseChosen
    ? chosenCollapse
    : (preferredWidthReachable === false && !detailVisible ? 'right' : chosenCollapse)

  const summaryReady = collapsed === 'right'
    && hasUnseenSummary({ completedAt: summaryCompletedAt, acknowledgedAt: summaryAcknowledgedAt })
  const summaryBusy = collapsed === 'right' && summaryGenerating

  // Seconds since the run began, ticking only while a collapsed rail is the
  // one thing that can report it — the open panel shows its own progress, and
  // nothing ticks when no run is in flight.
  //
  const summaryTick = useSecondTick(summaryBusy && !!summaryStartedAt)
  const summaryElapsed = elapsedSeconds(summaryBusy ? summaryStartedAt : null, summaryTick)
  useEffect(() => {
    if (collapsed !== 'right') acknowledgeSummary()
  }, [acknowledgeSummary, collapsed])
  const detailOverlayRef = useRef<HTMLDivElement | null>(null)
  const leftPanelRef = useRef<HTMLElement | null>(null)
  const detailOriginScrollRef = useRef<{
    sourceId: string
    viewport: HTMLElement
    scrollTop: number
    focusTarget: HTMLElement | null
    anchorRowId: string | null
    anchorOffsetTop: number | null
  } | null>(null)
  const detailOriginRestoreFrameRef = useRef<number | null>(null)
  // Which detail has already pulled the phone over to the 「功能」 panel.
  // Without it the reveal effect re-fires on every `isLargeScreen` flip, so
  // rotating a phone across the 768 breakpoint with a detail still open
  // yanks the reader out of whatever panel they had navigated back to.
  const lastRevealedDetailSourceIdRef = useRef<string | null>(null)
  const pendingDetailOriginRestoreRef = useRef<string | null>(null)

  const captureDetailOrigin = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (isLargeScreen) return
    const eventTarget = event.target instanceof Element ? event.target : null
    const action = eventTarget?.closest<HTMLElement>('[data-detail-source-id]')
    const sourceId = action?.dataset.detailSourceId
    if (!action || !sourceId) return

    // Capture synchronously in the originating click. Waiting for the detail
    // state effect is too late on iOS: the left panel may already be hidden
    // and its scroll position clamped before that effect reads the viewport.
    const viewport = action.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const anchorRow = action.closest<HTMLElement>('[data-row-id]')
    detailOriginScrollRef.current = {
      sourceId,
      viewport,
      scrollTop: viewport.scrollTop,
      focusTarget: action,
      anchorRowId: anchorRow?.dataset.rowId ?? null,
      anchorOffsetTop: anchorRow
        ? anchorRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top
        : null,
    }
  }, [isLargeScreen])

  // A detail action originates in the clinical-summary panel. In the phone
  // layout the shared detail pane lives behind the separate 「功能」 switcher,
  // so merely updating the detail slot looks like a dead button. Reveal that
  // panel for every newly requested detail; desktop keeps its split view.
  useEffect(() => {
    if (!detail) {
      lastRevealedDetailSourceIdRef.current = null
      return
    }
    if (isLargeScreen) return
    if (lastRevealedDetailSourceIdRef.current === detail.sourceId) return
    lastRevealedDetailSourceIdRef.current = detail.sourceId
    const alreadyCaptured = detailOriginScrollRef.current?.sourceId === detail.sourceId
    const viewport = alreadyCaptured
      ? null
      : leftPanelRef.current?.querySelector<HTMLElement>(
          '[role="tabpanel"][data-state="active"] [data-slot="scroll-area-viewport"]',
        )
    if (!alreadyCaptured && viewport) {
      const focusTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      const anchorRow = focusTarget?.closest<HTMLElement>('[data-row-id]') ?? null
      detailOriginScrollRef.current = {
        sourceId: detail.sourceId,
        viewport,
        scrollTop: viewport.scrollTop,
        focusTarget,
        anchorRowId: anchorRow?.dataset.rowId ?? null,
        anchorOffsetTop: anchorRow
          ? anchorRow.getBoundingClientRect().top - viewport.getBoundingClientRect().top
          : null,
      }
    }
    setMobileView('right')
  }, [detail, isLargeScreen, setMobileView])

  useLayoutEffect(() => {
    const sourceId = pendingDetailOriginRestoreRef.current
    if (isLargeScreen || mobileView !== 'left' || !sourceId) return
    const origin = detailOriginScrollRef.current
    if (!origin || origin.sourceId !== sourceId) {
      pendingDetailOriginRestoreRef.current = null
      return
    }

    if (detailOriginRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(detailOriginRestoreFrameRef.current)
    }

    // The panel is visible again at this point. TanStack Virtual can publish
    // several corrected measurements while rebuilding its visible window, so
    // keep the exact scroll position and source row anchored during that short
    // settling period. An explicit scroll event removes the old requirement
    // for the clinician to nudge the page before the correct rows appear.
    let framesLeft = 30
    let focusRestored = false
    const restoreOrigin = () => {
      origin.viewport.scrollTop = origin.scrollTop
      origin.viewport.dispatchEvent(new Event('scroll'))

      const anchorRow = origin.anchorRowId
        ? Array.from(origin.viewport.querySelectorAll<HTMLElement>('[data-row-id]'))
            .find((row) => row.dataset.rowId === origin.anchorRowId) ?? null
        : null
      if (anchorRow && origin.anchorOffsetTop !== null) {
        const currentOffset = anchorRow.getBoundingClientRect().top
          - origin.viewport.getBoundingClientRect().top
        const correction = currentOffset - origin.anchorOffsetTop
        if (Number.isFinite(correction) && Math.abs(correction) > 0.5) {
          origin.viewport.scrollTop += correction
          origin.viewport.dispatchEvent(new Event('scroll'))
        }
      }

      const focusTarget = origin.focusTarget?.isConnected
        ? origin.focusTarget
        : origin.viewport.querySelector<HTMLElement>(
            `[data-detail-source-id="${CSS.escape(sourceId)}"]`,
          )
      if (!focusRestored && focusTarget) {
        focusTarget.focus({ preventScroll: true })
        focusRestored = true
      }

      framesLeft -= 1
      if (framesLeft > 0) {
        detailOriginRestoreFrameRef.current = window.requestAnimationFrame(restoreOrigin)
      } else {
        detailOriginRestoreFrameRef.current = null
        pendingDetailOriginRestoreRef.current = null
      }
    }
    restoreOrigin()

    return () => {
      if (detailOriginRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(detailOriginRestoreFrameRef.current)
        detailOriginRestoreFrameRef.current = null
      }
    }
  }, [isLargeScreen, mobileView])

  const cancelDeferredDetailClear = useCallback(() => {
    if (deferredDetailClearFrameRef.current !== null) {
      window.cancelAnimationFrame(deferredDetailClearFrameRef.current)
      deferredDetailClearFrameRef.current = null
    }
    if (deferredDetailClearTimerRef.current !== null) {
      window.clearTimeout(deferredDetailClearTimerRef.current)
      deferredDetailClearTimerRef.current = null
    }
  }, [])

  const closeDetailAfterPaint = useCallback(() => {
    if (!detail) return
    const sourceId = detail.sourceId
    cancelDeferredDetailClear()

    // On phones the detail temporarily switches from the clinical browser to
    // the separate 「功能」 panel. Closing is a back action, so return to the
    // originating clinical panel immediately; the active left sub-tab and its
    // scroll position stay mounted and therefore resume exactly where the
    // clinician opened the detail.
    if (!isLargeScreen) {
      pendingDetailOriginRestoreRef.current = sourceId
      setMobileView('left')
    }

    // First paint: reveal the already-mounted feature panel and hide the trend.
    // The expensive chart/table cleanup runs only after the browser has shown
    // that response, so the button itself feels immediate.
    setClosingDetailSourceId(sourceId)
    deferredDetailClearFrameRef.current = window.requestAnimationFrame(() => {
      deferredDetailClearFrameRef.current = null
      deferredDetailClearTimerRef.current = window.setTimeout(() => {
        deferredDetailClearTimerRef.current = null
        clearDetail(sourceId)
        setClosingDetailSourceId(null)
      }, 0)
    })
  }, [cancelDeferredDetailClear, clearDetail, detail, isLargeScreen, setMobileView])

  // Android's hardware back and iOS' edge swipe are how phone readers close
  // the top layer. Both used to leave the app outright, taking the loaded
  // bundle and every AI result with them. Treat "the phone is showing
  // something other than the clinical browser" as one dismissible layer:
  // back closes the detail if one is open, otherwise returns to 臨床摘要.
  const phoneLayerOpen = !isLargeScreen && (detailVisible || mobileView === 'right')
  const dismissPhoneLayer = useCallback(() => {
    if (detail) {
      closeDetailAfterPaint()
      return
    }
    setMobileView('left')
  }, [closeDetailAfterPaint, detail, setMobileView])
  useBackDismissibleLayer(phoneLayerOpen, dismissPhoneLayer)

  useEffect(() => () => {
    cancelDeferredDetailClear()
    if (detailOriginRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(detailOriginRestoreFrameRef.current)
    }
  }, [cancelDeferredDetailClear])

  useEffect(() => {
    if (!detail || !isLargeScreen) return
    const timer = window.setTimeout(() => {
      setChosenCollapse((current) => (current === 'right' ? null : current))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [detail, isLargeScreen])
  useEffect(() => {
    clearDetail()
  }, [patient?.id, clearDetail])
  useEffect(() => {
    const clearSnapshotDetail = () => {
      cancelDeferredDetailClear()
      setClosingDetailSourceId(null)
      clearDetail()
    }
    window.addEventListener(BUNDLE_CHANGED_EVENT, clearSnapshotDetail)
    return () => window.removeEventListener(BUNDLE_CHANGED_EVENT, clearSnapshotDetail)
  }, [cancelDeferredDetailClear, clearDetail])
  // A new patient is a new reading task, so the split goes back to the width
  // the landing view wants — even though importing over an open chart never
  // unmounts the workspace. Without this, one visit to 「回到左右各半」 kept
  // every patient loaded afterwards at half width.
  useEffect(() => {
    // Same shape as the resource-navigation effect above: an identity change
    // arriving from outside React resets layout choices exactly once. There is
    // nothing to derive this from — the previous patient's chosen split is not
    // a function of the new patient's props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapseChosen(false)
    setChosenCollapse(null)
    resetPreferredWidth()
  }, [patient?.id, resetPreferredWidth])
  useEffect(() => {
    if (rightTourActive) clearDetail()
  }, [clearDetail, rightTourActive])

  // The feature panel stays mounted behind the detail, but hiding it collapses
  // this section's scrollHeight, which clamps scrollTop to 0. Remember where
  // the clinician was reading and put them back when the detail closes —
  // otherwise every trend peek costs them their place in a long summary.
  const rightPanelRef = useRef<HTMLElement | null>(null)
  const featureScrollTopRef = useRef(0)
  const hadDetailRef = useRef(false)
  // Track the reading position continuously rather than reading it when the
  // detail opens: by the time any effect runs, React has already hidden the
  // feature panel, the section's scrollHeight has collapsed and the browser
  // has clamped scrollTop to 0 — so the position is gone before we could
  // sample it.
  const handleRightPanelScroll = useCallback((event: UIEvent<HTMLElement>) => {
    if (detailVisible) return
    featureScrollTopRef.current = event.currentTarget.scrollTop
  }, [detailVisible])

  useLayoutEffect(() => {
    if (!detailVisible) return
    const panel = rightPanelRef.current
    const overlay = detailOverlayRef.current
    if (!panel || !overlay) return
    // The panel keeps its feature scroll position while the absolute detail
    // layer is open. Align that layer with the currently visible scrollport
    // before paint instead of forcing the underlying workspace back to zero.
    overlay.style.top = `${panel.scrollTop}px`
  }, [detail?.sourceId, detailVisible])

  useLayoutEffect(() => {
    const panel = rightPanelRef.current
    const hasDetail = detailVisible
    const hadDetail = hadDetailRef.current
    hadDetailRef.current = hasDetail
    if (!panel) return
    if (hasDetail || !hadDetail) return

    // Coming back from the detail. The panel's cards re-lay out over the next
    // few frames (several mount deferred), so a single assignment lands while
    // the panel is still short and gets clamped back to 0. Re-apply until it
    // sticks, with a hard frame budget so this can never spin.
    const target = featureScrollTopRef.current
    if (target <= 0) return
    let framesLeft = 30
    let frame = 0
    const restore = () => {
      panel.scrollTop = target
      framesLeft -= 1
      if (Math.abs(panel.scrollTop - target) > 1 && framesLeft > 0) {
        frame = requestAnimationFrame(restore)
      }
    }
    restore()
    return () => cancelAnimationFrame(frame)
  }, [detailVisible])

  return (
    <ClinicalWorkspaceRoot>
      {/* One quiet bar. The patient is the headline; the product mark and
          every utility (import, audience, language, tours, account) step back
          to icons and the 更多 menu so nothing here competes with the chart. */}
      <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 max-md:h-[52px] sm:px-4">
        <h1 className="flex shrink-0 items-center gap-2 max-[359px]:hidden">
          <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icon.svg?v=3`} alt="" className="h-5 w-5 object-contain" />
          <span className={patient ? 'sr-only' : 'text-sm font-semibold tracking-tight text-foreground'}>MediPrisma</span>
        </h1>
        <ClinicalPatientContext patient={patient} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ImportBundleButton iconOnlyOnMobile />
          <HeaderAuthButton />
          <HeaderOverflowMenu
            hasNews={unseenNewsCount > 0}
            tourMenu={<TourHubMenuItem disabled={!dataLoaded} />}
          />
        </div>
      </header>

      
      {/* Email Verification Banner */}
      <div className="px-3 sm:px-6">
        <EmailVerificationBanner />
        <NetworkStatusBanner />
        <ProgressiveImportStatus />
      </div>
      
      {/* Onboarding state: replace panels with welcome screen */}
      {showOnboarding ? (
        <main className="flex flex-1 overflow-auto">
          <WelcomeOnboarding />
        </main>
      ) : (
      <>
      <ClinicalMobilePanelSwitcher
        activePanel={mobileView}
        leftLabel={t.header.clinicalSummary}
        rightLabel={t.header.features}
        onChange={setMobileView}
      />

      <WorkspacePanelsProvider collapsed={collapsed} setCollapsed={setCollapsedByUser}>
      <ClinicalWorkspaceMain ref={containerRef}>
        {/* Left collapsed rail (lg only) — the WHOLE strip is clickable to expand */}
        {collapsed === 'left' && (
          <ClinicalWorkspaceRail
            onClick={() => setCollapsedByUser(null)}
            label={t.header.expandClinicalSummary}
            iconDirection="right"
          >
            {t.header.clinicalSummary}
          </ClinicalWorkspaceRail>
        )}

        {/* Left Panel - Clinical Summary */}
        <ClinicalWorkspacePanel
          ref={leftPanelRef}
          onClickCapture={captureDetailOrigin}
          aria-label={t.header.clinicalSummary}
          mobileActive={mobileView === 'left'}
          preserveMobileLayoutWhenInactive={!isLargeScreen && detailVisible}
          desktopState={
            collapsed === 'left'
              ? 'collapsed'
              : collapsed === 'right'
                ? 'fill'
                : 'split'
          }
          desktopWidth={
            isLargeScreen && collapsed === null ? `${leftWidth}%` : undefined
          }
        >
          {/* Per-panel boundary: a render crash in one panel must not white-screen the other */}
          <ErrorBoundary>
            <StableClinicalSummaryFeature />
          </ErrorBoundary>
        </ClinicalWorkspacePanel>

        {/* Resizable Divider with always-visible collapse controls. Hidden on mobile. */}
        {collapsed === null && (
          <ClinicalWorkspaceDivider
            label={t.header.resizePanels}
            onDragStart={handleMouseDown}
            onCollapseLeft={stepLeft}
            onCollapseRight={stepRight}
            leftCollapseLabel={stepLeftLabel}
            rightCollapseLabel={stepRightLabel}
            showCollapseActions={!detailVisible}
          />
        )}

        {/* Right Panel - Tabs (Medical Note / Data Selection) */}
        <ClinicalWorkspacePanel
          ref={rightPanelRef}
          onScroll={handleRightPanelScroll}
          aria-label={t.header.features}
          className={detailVisible ? "relative overflow-y-hidden" : "relative"}
          mobileActive={mobileView === 'right'}
          desktopState={
            collapsed === 'right'
              ? 'collapsed'
              : collapsed === 'left'
                ? 'fill'
                : 'split'
          }
          desktopWidth={
            isLargeScreen && collapsed === null
              ? `calc(${100 - leftWidth}% - 1px)`
              : undefined
          }
        >
          <ErrorBoundary>
            {/* Keep the feature panel laid out underneath the detail overlay.
                Removing it from layout made every close synchronously rebuild
                this large clinical workspace on slower devices. `inert` and
                aria-hidden keep the covered controls out of pointer, keyboard,
                and assistive-technology navigation without discarding their
                layout, in-flight AI stream, or local input state. */}
            <div
              className="contents"
              aria-hidden={detailVisible}
              inert={detailVisible || undefined}
            >
              <StableRightPanelFeature />
            </div>
            {detail && (
              <div
                ref={detailOverlayRef}
                className={detailVisible
                  ? 'absolute inset-x-0 z-30 h-full bg-panel'
                  : 'hidden'}
              >
                <RightDetailPane title={detail.title} onClose={closeDetailAfterPaint}>
                  {detail.node}
                </RightDetailPane>
              </div>
            )}
          </ErrorBoundary>
        </ClinicalWorkspacePanel>

        {/* Detail-mode rail (向右展開): the detail occupies the right column in
            place of the AI 功能 panel, so the collapse control sits here at the
            far right — clicking it brings the 功能 panel back (same as closing
            the detail). Only when not already collapsed. */}
        {detailVisible && collapsed === null && (
          <ClinicalWorkspaceRail
            onClick={closeDetailAfterPaint}
            label={t.header.expandFeatures}
            iconDirection="left"
          >
            {t.header.features}
          </ClinicalWorkspaceRail>
        )}

        {/* Right collapsed rail (lg only) — the WHOLE strip is clickable to
            expand. While it is the only thing standing in for the feature
            panel, it also reports a summary that finished out of sight. */}
        {collapsed === 'right' && (
          <ClinicalWorkspaceRail
            onClick={() => setCollapsedByUser(null)}
            label={summaryBusy
              ? t.header.summaryRunning
              : summaryReady ? t.header.summaryReadyExpand : t.header.expandFeatures}
            iconDirection="left"
            badge={summaryReady}
            busy={summaryBusy}
            note={summaryBusy
              ? t.header.summaryElapsed.replace('{seconds}', String(summaryElapsed))
              : undefined}
          >
            {summaryBusy
              ? t.header.summaryRunning
              : summaryReady ? t.header.summaryReady : t.header.features}
          </ClinicalWorkspaceRail>
        )}
      </ClinicalWorkspaceMain>
      </WorkspacePanelsProvider>
      </>
      )}

      <FirstRunOnboardingDialog />
      <GuidedTourOverlay />
      <TourHub />
      <RightFeatureTour />
    </ClinicalWorkspaceRoot>
  )
}

export default function Page() {
  // Pilot packs are a URL switch, read once at app start in the same spirit as
  // the SMART launch params: `?pilotPacks=heart-failure-cdss` shows this browser
  // a pack the package ships disabled, `?pilotPacks=` clears it, and the
  // Medcloud launch route honours neither (the gate itself refuses there).
  // Read during this first render rather than from an effect, so the pack
  // registry already answers correctly the first time a feature asks it.
  useState(() => {
    if (typeof window !== 'undefined') applyPilotPackIdsFromUrl(window.location.search)
    return null
  })

  return (
    <AppProviders>
      <ErrorBoundary>
        <AiDemographicsGateProvider>
          <RightDetailProvider>
            <PageContent />
          </RightDetailProvider>
          <AiDemographicsGateDialog />
        </AiDemographicsGateProvider>
      </ErrorBoundary>
    </AppProviders>
  )
}
