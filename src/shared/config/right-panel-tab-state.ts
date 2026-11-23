import type { ReactNode } from 'react'

/**
 * Live state a right-panel feature may report for its own tab, through the
 * registry's `useTabState`. RightPanelLayout applies it to whatever feature
 * reports it and never names a feature.
 */
export interface RightPanelTabState {
  /** Leave the tab out entirely (e.g. a service this workstation cannot use). */
  hidden?: boolean
  /** Keep the tab but grey it: the feature is there and explains itself. */
  dimmed?: boolean
  /** Short status for the tab's accessible name and hover title. */
  status?: string
  /** Compact element after the label (a count, a dot). Decorative: `status`
   *  carries the meaning for assistive technology. */
  suffix?: ReactNode
}
