"use client"

import { createContext, type ReactNode } from 'react'

/**
 * What the page around the CDSS lends the decision map (決策地圖 v2, the
 * pocket-handbook page). Over the whole window (`?visit=book`, or 全螢幕 from
 * the panel) it draws its own header, and the disease tabs go into it, so the
 * clinician switches page there as on the prototype. Without one it stays in
 * the panel, unless the address asks for the whole window.
 */
export interface VisitBookChrome {
  tabs?: ReactNode
  /** Full window: lend the visible header to the existing snapshot save button. */
  onSaveTarget?: (target: HTMLDivElement | null) => void
  /**
   * Chosen as 決策地圖 v2 in the layout switch: the page stays inside the
   * CDSS panel, beside the patient's record, under the panel's own disease
   * and layout switches — not over the whole window.
   */
  inline?: boolean
  /** Inline: open the same page over the whole window (owner request 2026-10-01). */
  onExpand?: () => void
  /** Over the whole window, opened from the panel: back to the panel. */
  onCollapse?: () => void
}

export const VisitBookChromeContext = createContext<VisitBookChrome | null>(null)

/** Whether this page was opened with the decision map over the whole window (`?visit=book`). */
export function isVisitBookMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('visit') === 'book'
}
