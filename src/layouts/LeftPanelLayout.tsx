// Left Panel Layout (Clinical Summary) - Pluggable Architecture
// Contributors can easily add/remove/replace features by modifying the registry
"use client"

import { memo, startTransition, useEffect, useRef, useState } from "react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getEnabledTabs, getFeaturesForTab, type TabConfig } from "@/src/shared/config/feature-registry"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useRightDetail } from "@/src/application/providers/right-detail.provider"
import {
  useResourceNavigationStore,
  leftTabForResourceType,
} from "@/src/application/stores/resource-navigation.store"
import { LEFT_PANEL_TAB_THEMES } from "@/src/shared/config/ui-theme.config"
import { FhirDataIssuesBanner } from "@/features/clinical-summary/components/FhirDataIssuesBanner"
import { SdkSourceLimitationsBanner } from "@/features/clinical-summary/components/SdkSourceLimitationsBanner"
import { useLeftBrowserTourStore } from "@/features/left-browser-tour"
import {
  ClinicalTabContentFrame,
  ClinicalTabList,
  ClinicalTabTrigger,
} from "@/src/shared/components/clinical-workspace"
import { ClinicalTabActivityProvider } from "@/src/application/providers/clinical-tab-activity.provider"
import { LoaderCircle } from "lucide-react"
import { markUserTrigger, useTrackView } from "@/src/application/telemetry/usage-analytics"

// ============================================================================
// TAB CONTENT RENDERER - Renders features for a specific tab
// ============================================================================
const TabFeatureContent = memo(function TabFeatureContent({
  tabId,
  fillHeight = false,
}: {
  tabId: string
  /** The tab's feature owns the available height and its own overflow (總覽's
   *  wide 2×2 grid must fit one screen without any scrollbar). Every other tab
   *  keeps the shared vertical ScrollArea. */
  fillHeight?: boolean
}) {
  const features = getFeaturesForTab(tabId)

  if (fillHeight) {
    return (
      <div className="h-full min-h-0 overflow-hidden" data-testid={`clinical-tab-content-${tabId}`}>
        <ClinicalTabContentFrame
          className="flex h-full min-h-0 flex-col overflow-hidden pb-3 pt-0 md:pt-2"
          style={{ contain: 'inline-size' }}
        >
          {features.map(feature => {
            const Component = feature.component
            return <Component key={feature.id} />
          })}
        </ClinicalTabContentFrame>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0" data-testid={`clinical-tab-content-${tabId}`}>
      {/*
        CSS containment (`contain: inline-size`) decouples this wrapper's
        intrinsic width from its children's content size. Without this,
        Radix ScrollArea's internal `display:table; min-width:100%` wrapper
        grows with the widest child (wide tables in CumulativeLabReport),
        pushing absolute-positioned UI like the expand button off-screen.
      */}
      <ClinicalTabContentFrame
        className="space-y-2 pb-3 pt-1 md:space-y-3"
        style={{ contain: 'inline-size' }}
      >
        {features.map(feature => {
          const Component = feature.component
          return <Component key={feature.id} />
        })}
      </ClinicalTabContentFrame>
    </ScrollArea>
  )
})

// ============================================================================
// MAIN EXPORT - Clinical Summary Feature (Left Panel)
// ============================================================================
export default function ClinicalSummaryFeature() {
  const { t } = useLanguage()
  const { clearDetail } = useRightDetail()
  const tabs = getEnabledTabs()
  const defaultTab = tabs[0]?.id || 'patient'

  // Controlled (was uncontrolled defaultValue) so resource navigation — a
  // cited source clicked in the Medical Summary tab — can switch to the tab
  // owning that resource type before its anchor scroll-flashes the card.
  const [activeTab, setActiveTab] = useState(defaultTab)
  // Keep a clinical tab mounted after its first visit. This prevents the
  // Reports workspace (pivot tables, virtual lists, and their memoized data)
  // from being destroyed whenever the clinician briefly checks another tab.
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(
    () => new Set([defaultTab]),
  )
  const tourActive = useLeftBrowserTourStore((state) => state.active)
  const tourStep = useLeftBrowserTourStore((state) => state.stepId)
  const preTourTabRef = useRef<string | null>(null)
  const wasTourActiveRef = useRef(false)
  const pending = useResourceNavigationStore((s) => s.pending)
  const seq = useResourceNavigationStore((s) => s.seq)

  // Usage analytics: the active clinical tab, including the default one the
  // panel opens on. `trigger` separates a click from tour / citation navigation.
  useTrackView('left', activeTab)

  // A newly visited tab can contain a large pivot table or clinical list. Mark
  // the tab active first, paint a lightweight loading frame, then mount the
  // heavy workspace in a transition on the next frame. This keeps the tab bar
  // responsive while the initial chart is still loading and lets a second tab
  // click interrupt unfinished rendering.
  useEffect(() => {
    if (mountedTabs.has(activeTab)) return
    const tabToMount = activeTab
    let cancelled = false
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return
      startTransition(() => {
        setMountedTabs((previous) => previous.has(tabToMount)
          ? previous
          : new Set(previous).add(tabToMount))
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [activeTab, mountedTabs])

  useEffect(() => {
    if (!pending) return
    const target = leftTabForResourceType(pending.resourceType)
    if (target && tabs.some((tab) => tab.id === target)) {
      const timer = window.setTimeout(() => {
        setMountedTabs((previous) => previous.has(target)
          ? previous
          : new Set(previous).add(target))
        setActiveTab(target)
        clearDetail() // same contract as a manual tab switch
      }, 0)
      return () => window.clearTimeout(timer)
    }
    // seq re-fires this even when navigating to the same target twice.
  }, [pending, seq, tabs, clearDetail])

  // A tour step should demonstrate the actual feature rather than merely
  // pointing at a hidden tab. Preserve the user's starting tab and restore it
  // when the tour is finished or skipped.
  useEffect(() => {
    if (tourActive && !wasTourActiveRef.current) {
      preTourTabRef.current = activeTab
      wasTourActiveRef.current = true
    }

    if (!tourActive && wasTourActiveRef.current) {
      wasTourActiveRef.current = false
      const restoredTab = preTourTabRef.current ?? defaultTab
      setMountedTabs((previous) => previous.has(restoredTab)
        ? previous
        : new Set(previous).add(restoredTab))
      setActiveTab(restoredTab)
      preTourTabRef.current = null
      clearDetail()
      return
    }

    if (!tourActive || !tourStep) return

    const targetTab = (() => {
      if (tourStep === 'patient-overview') return 'overview'
      if (tourStep === 'patient-info') return 'patient'
      if (tourStep === 'visits') return 'visits'
      if (['reports', 'trend', 'imaging-ai'].includes(tourStep)) return 'reports'
      if (['medications', 'medication-timeline', 'right-pane'].includes(tourStep)) return 'meds'
      if (tourStep === 'documents') return 'documents'
      return null
    })()

    if (targetTab && tabs.some((tab) => tab.id === targetTab)) {
      setMountedTabs((previous) => previous.has(targetTab)
        ? previous
        : new Set(previous).add(targetTab))
      setActiveTab(targetTab)
    }
    if (tourStep !== 'right-pane') clearDetail()
  }, [activeTab, clearDetail, defaultTab, tabs, tourActive, tourStep])

  // Warm only the Reports shell once the browser is idle. It remains hidden,
  // but its own deferred workers can prepare counts and pivots without making
  // the first click on 「報告」 carry the entire mount cost. Browsers without
  // requestIdleCallback use a short post-paint fallback.
  const hasReportsTab = tabs.some((tab) => tab.id === 'reports')
  useEffect(() => {
    if (!hasReportsTab || mountedTabs.has('reports')) return

    let cancelled = false
    let timer: number | undefined
    let idleId: number | undefined
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const mountReports = () => {
      if (cancelled) return
      startTransition(() => {
        setMountedTabs((previous) => previous.has('reports')
          ? previous
          : new Set(previous).add('reports'))
      })
    }
    const frame = window.requestAnimationFrame(() => {
      if (browserWindow.requestIdleCallback) {
        idleId = browserWindow.requestIdleCallback(mountReports, { timeout: 1200 })
      } else {
        timer = window.setTimeout(mountReports, 160)
      }
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
      if (idleId !== undefined) browserWindow.cancelIdleCallback?.(idleId)
    }
  }, [hasReportsTab, mountedTabs])

  // Helper to get tab label (supports i18n)
  const getTabLabel = (tab: TabConfig): string => {
    const key = tab.labelKey as keyof typeof t.tabs
    return t.tabs[key] || tab.id
  }

  // Helper to get tab theme
  const getTabTheme = (tabId: string) => {
    return LEFT_PANEL_TAB_THEMES[tabId] || LEFT_PANEL_TAB_THEMES['patient']
  }
          markUserTrigger('left')

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-hidden" data-tour="left-panel">
      <SdkSourceLimitationsBanner />
      <Tabs
        value={activeTab}
        // Switching the left clinical tab dismisses any right-pane detail
        // (向右展開) opened from the previous tab — the detail is tied to that
        // tab's content, so navigating away retracts it back to the AI panel.
        onValueChange={(value) => {
          setActiveTab(value)
          clearDetail()
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Text tabs at their natural width, left-aligned like a chart's
            section index. A narrow panel scrolls the strip rather than
            truncating every label to two characters. */}
        <ClinicalTabList
          data-tour="left-tabs"
          className="scroll-hint-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map(tab => {
            const theme = getTabTheme(tab.id)
            const Icon = theme.icon
            return (
              <ClinicalTabTrigger
                key={tab.id}
                value={tab.id}
                data-tour={`left-tab-${tab.id}`}
                icon={Icon}
                iconVisibility="responsive"
                label={getTabLabel(tab)}
              />
            )
          })}
        </ClinicalTabList>

        {/* Keep the primary navigation in a stable position while the FHIR
            requests settle. The warning used to appear above the tab bar and
            move every tab under the pointer at the exact moment a clinician
            tried to navigate during loading. */}
        <FhirDataIssuesBanner />

        {tabs.map(tab => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            forceMount={mountedTabs.has(tab.id) || undefined}
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            {mountedTabs.has(tab.id) ? (
              <ClinicalTabActivityProvider active={activeTab === tab.id}>
                <TabFeatureContent tabId={tab.id} fillHeight={tab.fillHeight} />
              </ClinicalTabActivityProvider>
            ) : activeTab === tab.id ? (
              <div
                className="flex h-full min-h-40 items-start justify-center px-4 pt-12"
                role="status"
                aria-live="polite"
                aria-label={`${getTabLabel(tab)} ${t.common.loading}`}
                data-testid="clinical-tab-loading-indicator"
              >
                <div className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-muted/35 px-4 py-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                  <span>{getTabLabel(tab)} · {t.common.loading}</span>
                </div>
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
