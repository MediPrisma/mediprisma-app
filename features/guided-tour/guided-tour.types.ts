import type { LeftBrowserTourStepId } from '@/features/left-browser-tour/left-browser-tour.store'
import type { RightFeatureTourStepId } from '@/features/right-feature-tour/right-feature-tour.store'
import type { TourTargetSpec } from './spotlight/use-tour-target'

export type Localized = { 'zh-TW': string; en: string }

/**
 * The screen a step needs. Scenes are the step ids the panels already know how
 * to set up (open a tab, switch a report view, dock a timeline): the left and
 * right tour stores are the channel the panels listen on.
 */
export type TourScene =
  | { panel: 'left'; step: LeftBrowserTourStepId }
  | { panel: 'right'; step: RightFeatureTourStepId }
  | { panel: 'none' }

export interface TourContext {
  audience: 'medical' | 'patient'
  betaEnabled: boolean
  authenticated: boolean
  /** Tablet width and up, where the two panels sit side by side. */
  desktop: boolean
  /** Right-panel features this reader can open right now. */
  rightFeatures: ReadonlySet<string>
}

export interface GuidedTourStep extends TourTargetSpec {
  id: string
  /** Omitted: keep the previous step's screen. */
  scene?: TourScene
  highlightPadding?: number
  title: Localized
  body: Localized
  /** Plain-language copy for the 民眾 audience, where it differs. */
  patientTitle?: Localized
  patientBody?: Localized
  /** Shown instead of `body` when only the fallback target could be found. */
  fallbackBody?: Localized
  when?: (context: TourContext) => boolean
}

export type GuidedTourIcon =
  | 'start'
  | 'user'
  | 'activity'
  | 'pill'
  | 'panels'
  | 'summary'
  | 'book'
  | 'chat'
  | 'copy'
  | 'calculator'
  | 'guide'
  | 'education'
  | 'sliders'
  | 'sparkles'

export type GuidedTourId =
  | 'getting-started'
  | 'know-patient'
  | 'labs-reports'
  | 'medications'
  | 'split-view'
  | 'medical-summary'
  | 'custom-summary'
  | 'clinical-chat'
  | 'export'
  | 'calculator'
  | 'care-guidance'
  | 'education'
  | 'settings'
  | 'news-lab-trend-zoom'

export interface GuidedTourDefinition {
  id: GuidedTourId
  icon: GuidedTourIcon
  title: Localized
  description: Localized
  patientTitle?: Localized
  patientDescription?: Localized
  /** Hidden from readers for whom it would point at nothing. */
  when?: (context: TourContext) => boolean
  steps: GuidedTourStep[]
  /**
   * The chaptered custom-summary guide keeps its own engine (it opens real
   * editors as a preview); the hub hands over to it instead of running steps.
   */
  handOff?: 'custom-summary'
}

export interface WhatsNewItem {
  id: string
  title: Localized
  /** Where in the app it lives, as a breadcrumb. */
  where: Localized
  body: Localized
  /** The control the in-place hint points at, when it is on screen. */
  anchor: string
  tourId?: GuidedTourId
  /** The announcement is about the hub itself: its action opens the hub. */
  opensHub?: boolean
  when?: (context: TourContext) => boolean
}
