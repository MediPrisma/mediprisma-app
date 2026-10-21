// Right Panel Feature Registry - Central configuration for right panel features
// This allows contributors to easily add/remove/replace features in the right panel
import { CDSS_AVAILABLE } from './optional-capabilities'
import { CLINICAL_DECISION_SUPPORT_MODULE } from '@/features/clinical-decision-support/module'
import { PERSONALIZED_EDUCATION_MODULE } from '@/features/personalized-education/module'

import type { RightPanelScrollMode } from '@/src/shared/config/right-panel-scroll'

export interface RightPanelFeatureConfig {
  id: string
  name: string
  /** The tab label (supports i18n key or direct string) */
  tabLabel: string
  /** Display order (lower = first) */
  order: number
  /** Whether this feature is enabled */
  enabled: boolean
  /** Experimental feature hidden unless the user explicitly enables Beta features. */
  beta?: boolean
  /** Roles allowed to see this feature. Omit to show it to both roles. */
  audiences?: ReadonlyArray<'medical' | 'patient'>
  /**
   * Default tab-bar placement (default true). false = starts in the "more"
   * overflow menu. The menu is hidden when overflow is empty and appears
   * automatically for a false default or a saved user override.
   */
  pinned?: boolean
  /**
   * Always pinned: rendered after the "more" menu and excluded from the
   * customize list (user overrides are ignored). Used by settings so the
   * pin-management entry point can never hide itself.
   */
  pinLocked?: boolean
  /** Render the tab trigger icon-only at every width (name kept in title/aria). */
  iconOnly?: boolean
  /** Optional compact status badge shown beside the tab label. */
  badge?: string
  /** Optional: force mount the tab content (useful for chat to preserve state) */
  forceMount?: boolean
  /**
   * Optional EXTRA classes for the tab panel. Structural layout — how the panel
   * sizes itself and where scrolling happens — is derived from `scrollMode` by
   * RightPanelLayout; do not restate it here.
   */
  contentClassName?: string
  /**
   * Where this feature's content scrolls. Drives BOTH the wrapper the layout
   * renders and the panel's own sizing, so the two can never disagree.
   *
   * feature (default): the layout wraps the content in a ScrollArea.
   * panel: the whole right panel scrolls, feature tabs and all.
   * self: the feature scrolls its own regions internally (chat).
   */
  scrollMode?: RightPanelScrollMode
}

/**
 * Right Panel Features Registry
 *
 * Components are NOT part of this config — they are mapped by id (and
 * lazy-loaded) in RightPanelLayout's FEATURE_COMPONENTS.
 *
 * To add a new feature:
 * 1. Create your feature component in features/your-feature/
 * 2. Add an entry here (id, tabLabel, order) with enabled: true
 * 3. Register the component in FEATURE_COMPONENTS in RightPanelLayout.tsx
 *
 * To remove a feature: set enabled: false.
 */
export const RIGHT_PANEL_FEATURES: RightPanelFeatureConfig[] = [
  {
    // Zero-click AI briefing (narrative + safety + decisions + timeline).
    // First tab AND the app's default landing tab; set enabled: false to
    // unplug it — RightPanelLayout falls back to the first enabled feature.
    id: 'medical-summary',
    name: 'Medical Summary',
    tabLabel: 'medicalSummary',
    order: 0,
    enabled: true,
    // AI result + scroll position must survive tab switches (result is also
    // cached, but forceMount avoids re-running effects on every visit).
    forceMount: true,
    // Let the outer panel own scrolling so the feature tabs leave the viewport
    // while the summary's inner card-navigation bar can remain sticky.
    scrollMode: 'panel',
  },
  {
    id: 'medical-chat',
    name: 'Medical Chat',
    tabLabel: 'noteChat', // i18n key from translations
    order: 1,
    enabled: true,
    forceMount: true,
    // Chat owns its scrolling: a pinned composer with a scrolling transcript
    // above it, not one long scrollport.
    scrollMode: 'self',
    contentClassName: 'overflow-hidden',
  },
  PERSONALIZED_EDUCATION_MODULE.rightPanel,
  { ...CLINICAL_DECISION_SUPPORT_MODULE.rightPanel, enabled: CDSS_AVAILABLE },
  {
    id: 'ips-export',
    name: 'IPS Export',
    tabLabel: 'ipsExport',
    order: 6,
    enabled: true,
    // AI-inferred suggestions + per-item confirmations are expensive (LLM call)
    // and clinically reviewed state — they must survive tab switches.
    // useInferredProblems resets them when the loaded patient changes.
    forceMount: true,
  },
  {
    id: 'medical-calculator',
    name: 'Medical Calculator',
    tabLabel: 'medicalCalculator',
    order: 4,
    enabled: true,
    // Deliberately NOT forceMount: that would pull the 57-calculator chunk on
    // panel mount for every user. Half-filled scores are still preserved —
    // RightPanelLayout keeps any tab mounted once it has been opened.
  },
  {
    // Gear tab: always the right-most trigger (after the "more" menu), never
    // hideable — it stays reachable no matter how tabs are customized.
    id: 'settings',
    name: 'Settings',
    tabLabel: 'settings',
    order: 7,
    enabled: true,
    pinLocked: true,
  },
]

/**
 * Get enabled right panel features sorted by order
 */
export function getEnabledRightPanelFeatures(
  audience?: 'medical' | 'patient',
  options: { betaFeaturesEnabled?: boolean } = {},
): RightPanelFeatureConfig[] {
  return RIGHT_PANEL_FEATURES
    .filter((feature) => (
      feature.enabled
      // The Beta switch is the whole gate. Being signed in is deliberately NOT
      // part of it (owner decision, 2026-09): a visitor turns Beta on in
      // 設定 → 顯示與關於 and the experimental tabs appear, account or not.
      // The route exclusion the unattended Medcloud hand-off needs is applied
      // where `betaFeaturesEnabled` is resolved (`useBetaFeatures`), not here —
      // this function stays pure and window-free.
      && (!feature.beta || options.betaFeaturesEnabled === true)
      && (!audience || !feature.audiences || feature.audiences.includes(audience))
    ))
    .sort((a, b) => a.order - b.order)
}

/**
 * Get right panel feature by ID
 */
export function getRightPanelFeatureById(id: string): RightPanelFeatureConfig | undefined {
  return RIGHT_PANEL_FEATURES.find(feature => feature.id === id)
}

// NOTE: the former registerRightPanelFeature/disableRightPanelFeature runtime
// mutators were removed — they mutated this module-level array with no React
// reactivity, so calling them never re-rendered the panel. Edit the array above
// (build-time config) instead.
