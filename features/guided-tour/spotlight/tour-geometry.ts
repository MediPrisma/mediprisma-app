// Geometry shared by every guided tour: which element a step points at, where
// it is, and where the step's card can sit without covering it.

export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number }
export type Viewport = { width: number; height: number }

export function isVisibleTourElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return element.isConnected
    && !element.closest('[hidden], [aria-hidden="true"]')
    && rect.width > 2
    && rect.height > 2
    && style.display !== 'none'
    && style.visibility !== 'hidden'
}

export function visibleTarget(selector: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisibleTourElement) ?? null
}

export function rectFromElement(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function isWithinViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const margin = 16
  return rect.top >= margin
    && rect.left >= margin
    && rect.bottom <= window.innerHeight - margin
    && rect.right <= window.innerWidth - margin
}

export function sameRect(left: Rect | null, right: Rect): boolean {
  if (!left) return false
  return Math.abs(left.top - right.top) < 0.5
    && Math.abs(left.left - right.left) < 0.5
    && Math.abs(left.right - right.right) < 0.5
    && Math.abs(left.bottom - right.bottom) < 0.5
}

export type CardPlacement =
  | { left: string; top: string; transform: string }
  | { left: number; top: number; width: number }

/**
 * Beside the target when there is room, otherwise below, otherwise above.
 * Without a target the card is centred.
 */
export function placeCard(
  targetRect: Rect | null,
  viewport: Viewport,
  cardHeight: number,
  preferredWidth = 360,
): CardPlacement {
  if (!targetRect || viewport.width === 0 || viewport.height === 0) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }
  const margin = 16
  const gap = 16
  // Landscape phones have little vertical room. Use the space beside the
  // target when it can still fit a readable card, leaving the target clear.
  const sideSpace = Math.max(targetRect.left, viewport.width - targetRect.right) - gap - margin
  const width = Math.min(preferredWidth, viewport.width - margin * 2,
    viewport.height < 500 && sideSpace >= 240 ? sideSpace : preferredWidth)
  let left: number
  let top: number
  if (targetRect.right + gap + width <= viewport.width - margin) {
    left = targetRect.right + gap
    top = targetRect.top + targetRect.height / 2 - cardHeight / 2
  } else if (targetRect.left - gap - width >= margin) {
    left = targetRect.left - gap - width
    top = targetRect.top + targetRect.height / 2 - cardHeight / 2
  } else if (targetRect.bottom + gap + cardHeight <= viewport.height - margin) {
    left = targetRect.left + targetRect.width / 2 - width / 2
    top = targetRect.bottom + gap
  } else {
    left = targetRect.left + targetRect.width / 2 - width / 2
    top = targetRect.top - gap - cardHeight
  }
  left = Math.max(margin, Math.min(viewport.width - width - margin, left))
  top = Math.max(margin, Math.min(viewport.height - cardHeight - margin, top))
  return { left, top, width }
}
