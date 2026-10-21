// Right Panel Layout - Pluggable Architecture
// Contributors can easily add/remove/replace features by modifying the registry
"use client"

import { ComponentType, memo, ReactNode, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { MoreHorizontal, SlidersHorizontal } from "lucide-react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { getEnabledRightPanelFeatures, type RightPanelFeatureConfig } from "@/src/shared/config/right-panel-registry"
import { resolveScrollMode, tabPanelClasses } from "@/src/shared/config/right-panel-scroll"
import { groupRightPanelFeatures, isFeaturePinned, useRightPanelTabsStore } from "@/src/application/stores/right-panel-tabs.store"
import { useBetaFeatures } from "@/src/application/hooks/use-beta-features.hook"
import { RIGHT_PANEL_TAB_THEMES } from "@/src/shared/config/ui-theme.config"
// RightPanelProvider moved to AppProviders (app-level) in v0.4.0 so the
// header's overflow menu can navigate to right-panel tabs (e.g. open
// Settings → 顯示). Only useRightPanel is imported here now.
import { useRightPanel } from '@/src/application/providers/right-panel.provider'
import { CLINICAL_DECISION_SUPPORT_FEATURE_ID } from '@/features/clinical-decision-support/module'
import { PERSONALIZED_EDUCATION_FEATURE_ID } from '@/features/personalized-education/module'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'
import {
  ClinicalTabContentFrame,
  ClinicalTabList,
  ClinicalTabTrigger,
} from "@/src/shared/components/clinical-workspace"
import { usePanelScrollMemory } from "./use-panel-scroll-memory"
import { markUserTrigger, useTrackView } from "@/src/application/telemetry/usage-analytics"

// ============================================================================
// FEATURE COMPONENTS - lazy-loaded so each feature is its own chunk instead of
// all seven landing in the initial bundle. forceMounted tabs still fetch their
// chunk on panel mount (in parallel); the rest only when first opened.
// ============================================================================
const FeatureLoading = () => (
  <div className="flex h-24 items-center justify-center text-sm text-muted-foreground animate-pulse">
    …
  </div>
)
// next/dynamic options are statically analyzed — they MUST be inline object
// literals (a shared `const opts` breaks the build), hence the repetition.
const MedicalSummaryFeature = dynamic(() => import("@/features/medical-summary/Feature"), {
  ssr: false,
  loading: FeatureLoading,
})
const MedicalChatFeature = dynamic(() => import("@/features/medical-chat/Feature"), {
  ssr: false,
  loading: FeatureLoading,
})
const IpsExportFeature = dynamic(() => import("@/features/ips-export/Feature"), {
  ssr: false,
  loading: FeatureLoading,
})
const MedicalCalculatorFeature = dynamic(() => import("@/features/medical-calculator/Feature"), {
  ssr: false,
  loading: FeatureLoading,
})
const PersonalizedGuidanceFeature = dynamic(() => import("@/features/clinical-decision-support/LiveFeature"), {
  ssr: false,
  loading: FeatureLoading,
})
const PersonalizedEducationFeature = dynamic(() => import("@/features/personalized-education/LiveFeature"), {
  ssr: false,
  loading: FeatureLoading,
})
const SettingsFeature = dynamic(() => import("@/features/settings/Feature"), {
  ssr: false,
  loading: FeatureLoading,
})

// ============================================================================
// PROVIDERS - Import providers needed by features
// ============================================================================
import { DataSelectionProvider } from "@/src/application/providers/data-selection.provider"
import { AdaptiveDataDefaultsRunner } from "@/features/data-selection/AdaptiveDataDefaultsRunner"
import { AsrProvider } from "@/src/application/providers/asr.provider"
import { ClinicalInsightsConfigProvider } from "@/src/application/providers/clinical-insights-config.provider"
import { ChatTemplatesProvider } from "@/src/application/providers/chat-templates.provider"
import { ClinicalInsightsRuntimeProvider } from "@/features/clinical-insights/ClinicalInsightsRuntimeProvider"

// ============================================================================
// FEATURE COMPONENT MAP - Map feature IDs to their components
// Contributors: Add your feature component here
// ============================================================================
const FEATURE_COMPONENTS: Record<string, ComponentType> = {
  'medical-summary': MedicalSummaryFeature,
  'medical-chat': MedicalChatFeature,
  'ips-export': IpsExportFeature,
  'medical-calculator': MedicalCalculatorFeature,
  [PERSONALIZED_EDUCATION_FEATURE_ID]: PersonalizedEducationFeature,
  [CLINICAL_DECISION_SUPPORT_FEATURE_ID]: PersonalizedGuidanceFeature,
  'settings': SettingsFeature,
}

// ============================================================================
// PROVIDERS WRAPPER - Wrap all providers needed by right panel features
// Contributors: Add your providers here if needed
// ============================================================================
function RightPanelProviders({ children }: { children: ReactNode }) {
  return (
    <DataSelectionProvider>
      <AdaptiveDataDefaultsRunner />
      <AsrProvider>
        <ChatTemplatesProvider>
          <ClinicalInsightsConfigProvider>
            <ClinicalInsightsRuntimeProvider>
              {children}
            </ClinicalInsightsRuntimeProvider>
          </ClinicalInsightsConfigProvider>
        </ChatTemplatesProvider>
      </AsrProvider>
    </DataSelectionProvider>
  )
}

// ============================================================================
// MAIN EXPORT - Right Panel Feature
// ============================================================================
function RightPanelContent() {
  // RightPanelProvider lives in AppProviders now; here we only mount the
  // right-panel-specific providers (data selection, ASR, etc.). The
  // provider's defaultTab is fixed at 'medical-chat' app-wide, matching
  // what features[0]?.id resolved to previously.
  return (
    <RightPanelProviders>
      <RightPanelContentInner />
    </RightPanelProviders>
  )
}

export function RightPanelFeature() {
  return (
    <div className="@container flex h-full flex-col" data-tour="right-panel">
      <RightPanelContent />
    </div>
  )
}

export default function RightPanelLayout() {
  return <RightPanelFeature />
}

// ============================================================================
// TAB CONTENT RENDERER - Renders individual feature content
// ============================================================================
// The force-mounted panels preserve clinically reviewed state, but a top-level
// tab change used to re-render every hidden feature before the selected panel
// could paint. Feature config objects are registry constants, so memoization
// safely lets Radix toggle only the outer TabsContent visibility while each
// feature keeps its existing render tree.
const FeatureTabContent = memo(function FeatureTabContent({ feature }: { feature: RightPanelFeatureConfig }) {
  const Component = FEATURE_COMPONENTS[feature.id]
  
  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Feature &quot;{feature.id}&quot; not found. Please register it in FEATURE_COMPONENTS.
      </div>
    )
  }

  switch (resolveScrollMode(feature.scrollMode)) {
    // The whole right panel scrolls, feature tabs and all. This lets a
    // feature's own chips stay sticky against the panel's scrollport (medical
    // summary, 個人化衛教).
    case 'panel':
      return (
        <ClinicalTabContentFrame className="py-0.5 md:py-2">
          <Component />
        </ClinicalTabContentFrame>
      )

    // The feature scrolls its own regions (chat: pinned composer, scrolling
    // transcript). Give it the full height and stay out of the way.
    case 'self':
      return (
        <ClinicalTabContentFrame className="h-full py-0.5 md:py-2">
          <Component />
        </ClinicalTabContentFrame>
      )

    // Default: one scrollport around the whole feature.
    //
    // Radix renders the viewport's content in a `display:table; min-width:100%`
    // wrapper (shrink-to-fit), which GROWS to a child's max-content width. A
    // child with a wide intrinsic width can therefore stretch the whole panel
    // past the column and overflow the viewport horizontally. These panels only
    // ever scroll vertically, so force that wrapper to `display:block`
    // (= viewport width, content wraps).
    default:
      return (
        <ScrollArea className="h-full [&_[data-radix-scroll-area-viewport]>div]:!block">
          <ClinicalTabContentFrame className="py-0.5 md:py-2">
            <Component />
          </ClinicalTabContentFrame>
        </ScrollArea>
      )
  }
})

// ============================================================================
// RIGHT PANEL CONTENT - Dynamic tab rendering from registry
// ============================================================================

function RightPanelContentInner() {
  const { t } = useLanguage()
  const { audience } = useAudience()
  const { enabled: betaFeaturesEnabled } = useBetaFeatures()
  const features = getEnabledRightPanelFeatures(audience, { betaFeaturesEnabled })
  const { activeTab, setActiveTab } = useRightPanel()
  const tourActive = useRightFeatureTourStore((state) => state.active)
  const tourStep = useRightFeatureTourStore((state) => state.stepId)
  const preTourTabRef = useRef<string | null>(null)
  const wasTourActiveRef = useRef(false)
  const pinOverrides = useRightPanelTabsStore((s) => s.pinOverrides)
  const setPinned = useRightPanelTabsStore((s) => s.setPinned)

  // Each guided-tour scene opens the feature it explains. Preserve the user's original
  // right-panel tab and restore it when the tour is completed or skipped.
  useEffect(() => {
    if (tourActive && !wasTourActiveRef.current) {
      preTourTabRef.current = activeTab
      wasTourActiveRef.current = true
    }

    if (!tourActive && wasTourActiveRef.current) {
      wasTourActiveRef.current = false
      setActiveTab(preTourTabRef.current ?? 'medical-summary')
      preTourTabRef.current = null
      return
    }

    if (!tourActive || !tourStep) return
    const targetTab: Partial<Record<typeof tourStep, string>> = {
      overview: 'medical-summary',
      summary: 'medical-summary',
      'summary-settings': 'medical-summary',
      chat: 'medical-chat',
      'chat-compose': 'medical-chat',
      'chat-template': 'medical-chat',
      calculator: 'medical-calculator',
      guidance: CLINICAL_DECISION_SUPPORT_FEATURE_ID,
      education: PERSONALIZED_EDUCATION_FEATURE_ID,
      export: 'ips-export',
      settings: 'settings',
      finish: 'medical-summary',
    }
    const target = tourStep.startsWith('custom-summary')
      ? 'medical-summary'
      : targetTab[tourStep]
    if (target && features.some((feature) => feature.id === target)) {
      setActiveTab(target)
    }
  }, [activeTab, features, setActiveTab, tourActive, tourStep])

  // Pluggability guard: the provider's default (or a stale selection) may
  // point at a feature that has been unplugged in the registry — fall back
  // to the first enabled feature instead of rendering an empty panel.
  const effectiveTab = features.some(f => f.id === activeTab)
    ? activeTab
    : features[0]?.id ?? activeTab

  const { hostRef: scrollMemoryHostRef, captureBeforeSwitch } = usePanelScrollMemory(effectiveTab)
  const changeTab = (next: string) => {
    // Also reached from the overflow menu, which — unlike Radix's
    // onValueChange — fires for the tab that is already open. Marking there
    // would leave a pending flag that mislabels the NEXT right-panel view.
    if (next !== effectiveTab) markUserTrigger('right')
    captureBeforeSwitch()
    setActiveTab(next)
  }

  // Sticky mount: once a tab has been opened it stays mounted for the rest of
  // the session, so in-progress work (a half-filled calculator score, an
  // expanded guidance panel) survives a tab switch. This is the cheap half of
  // registry `forceMount` — it preserves the same state, but the feature's
  // chunk is still fetched only when the user first opens it, instead of on
  // panel mount for everyone.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  // Adjusted during render (not in an effect): React re-runs this component
  // before committing, so the newly opened tab is already force-mounted in the
  // same paint instead of one cascading render later.
  if (effectiveTab && !visitedTabs.has(effectiveTab)) {
    setVisitedTabs(new Set(visitedTabs).add(effectiveTab))
  }
  // Usage analytics: which right-panel feature is on screen, default included.
  useTrackView('right', effectiveTab)


  // Tab-bar grouping is purely registry-driven (no feature ids here):
  // [pinned…] [temp trigger for an active overflow tab?] [more ▾] [pinLocked…]
  const {
    lockedFeatures,
    unlockedFeatures,
    pinnedFeatures,
    overflowFeatures,
  } = groupRightPanelFeatures(features, pinOverrides)
  // An overflow feature can become active (menu click, or external
  // setActiveTab e.g. from the header) — give it a temporary real trigger so
  // the Radix active state has a visible anchor.
  const activeOverflowFeature = overflowFeatures.find(f => f.id === effectiveTab)

  // Helper to get tab label (supports i18n)
  const getTabLabel = (feature: RightPanelFeatureConfig): string => {
    if (
      feature.id === PERSONALIZED_EDUCATION_FEATURE_ID &&
      audience === 'medical'
    ) {
      return t.tabs.personalizedGuidance
    }

    const key = feature.tabLabel as keyof typeof t.tabs
    return t.tabs[key] || feature.name
  }

  // Helper to get tab theme
  const getTabTheme = (featureId: string) => {
    return RIGHT_PANEL_TAB_THEMES[featureId] || RIGHT_PANEL_TAB_THEMES['settings']
  }

  const renderTrigger = (feature: RightPanelFeatureConfig) => {
    const theme = getTabTheme(feature.id)
    const Icon = theme.icon
    const label = getTabLabel(feature)
    const accessibleLabel = feature.badge ? `${label} · ${feature.badge}` : label
    return (
      <ClinicalTabTrigger
        key={feature.id}
        value={feature.id}
        data-tour={`right-tab-${feature.id}`}
        icon={Icon}
        iconVisibility={feature.iconOnly ? "always" : "responsive"}
        label={label}
        labelVisibility={feature.iconOnly ? "never" : "always"}
        title={accessibleLabel}
        aria-label={accessibleLabel}
        suffix={feature.badge ? (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 px-1 py-0 text-[0.5625rem] font-bold uppercase leading-4 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            aria-hidden="true"
          >
            {feature.badge}
          </Badge>
        ) : undefined}
      />
    )
  }

  const renderMenuItemContent = (feature: RightPanelFeatureConfig) => {
    const Icon = getTabTheme(feature.id).icon
    return (
      <>
        <Icon className="h-4 w-4 shrink-0" />
        {getTabLabel(feature)}
        {feature.badge && (
          <Badge
            variant="outline"
            className="ml-auto border-amber-300 bg-amber-50 px-1 py-0 text-[0.5625rem] font-bold uppercase leading-4 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {feature.badge}
          </Badge>
        )}
      </>
    )
  }

  const showOverflowMenu = overflowFeatures.length > 0
  return (
    <Tabs
      value={effectiveTab}
      onValueChange={changeTab}
      className="flex h-full flex-col md:gap-0"
    >
      {/* Anchor for the per-tab scroll memory: it walks up from here to find
          the panel that actually scrolls. */}
      <div ref={scrollMemoryHostRef} className="hidden" aria-hidden />
      {/* Match the left clinical workspace on phones: every primary feature is
          visible in one stable, equal-width row. Pin overrides remain a
          desktop customization only, so a phone user never has to open a
          picker just to discover or switch features.

          The columns have a floor rather than `minmax(0, 1fr)`: five zh-TW
          labels fit a 375px strip, but enabling a sixth or seventh feature
          would shave every column to ~50px and clip 「醫療摘要」/「臨床決策支援」
          to two indistinguishable characters — with the full name only in a
          `title` a finger cannot open. Past the floor the strip scrolls, and
          `scroll-hint-x` says so. */}
      <ClinicalTabList
        data-tour="right-tabs"
        className="scroll-hint-x overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
      >
        {features.map(renderTrigger)}
      </ClinicalTabList>

      <ClinicalTabList
        data-tour="right-tabs"
        className="scroll-hint-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:hidden"
      >
        {pinnedFeatures.map(renderTrigger)}
        {activeOverflowFeature && renderTrigger(activeOverflowFeature)}
        {/* Keep the pluggable overflow/pin mechanism, but do not spend a whole
            toolbar column on an empty menu. A future `pinned:false` feature or
            an existing user override makes this entry reappear automatically. */}
        {showOverflowMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-tour="right-tabs-overflow"
              className="flex min-w-0 flex-none items-center justify-center gap-1.5 rounded-none px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
              title={t.tabs.more}
              aria-label={t.tabs.more}
            >
              <MoreHorizontal className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.tabs.more}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflowFeatures.map(feature => (
                <DropdownMenuItem
                  key={feature.id}
                  onSelect={() => changeTab(feature.id)}
                >
                  {renderMenuItemContent(feature)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SlidersHorizontal className="h-4 w-4 shrink-0" />
                  {t.tabs.managePinned}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {unlockedFeatures.map(feature => (
                    <DropdownMenuCheckboxItem
                      key={feature.id}
                      checked={isFeaturePinned(feature, pinOverrides)}
                      onCheckedChange={(checked) => setPinned(feature.id, checked === true)}
                      // Keep the menu open while toggling several pins in a row
                      onSelect={(e) => e.preventDefault()}
                    >
                      {renderMenuItemContent(feature)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {lockedFeatures.map(renderTrigger)}
      </ClinicalTabList>

      {features.map(feature => (
        <TabsContent
          key={feature.id}
          value={feature.id}
          data-tour={`right-content-${feature.id}`}
          className={`${tabPanelClasses(feature.scrollMode)} ${feature.contentClassName ?? ''} max-md:!mt-0 md:mt-0`}
          forceMount={feature.forceMount || visitedTabs.has(feature.id) ? true : undefined}
        >
          <FeatureTabContent feature={feature} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
