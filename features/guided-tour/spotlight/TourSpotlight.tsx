'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cn } from '@/src/shared/utils/cn.utils'
import { placeCard, type Rect, type Viewport } from './tour-geometry'

interface TourSpotlightProps {
  targetRect: Rect | null
  viewport: Viewport
  highlightPadding?: number
  labelledBy: string
  describedBy: string
  /** Escape, or any other request to leave the tour. */
  onDismiss: () => void
  /** Receives focus when the spotlight opens and whenever focus strays. */
  initialFocusRef: RefObject<HTMLElement | null>
  /** Marks the highlight for tests and styling hooks. */
  highlightId?: string
  /**
   * The target is still being looked for: keep the card out of sight so a
   * step never flashes up centred before it is skipped or placed.
   */
  pending?: boolean
  children: ReactNode
}

/**
 * The dimmed page with a hole around the step's target, and the step card
 * beside it. Keyboard focus stays in the card: the page behind may hold real
 * editors opened for the demonstration and must not be typed into.
 */
export function TourSpotlight({
  targetRect,
  viewport,
  highlightPadding = 6,
  labelledBy,
  describedBy,
  onDismiss,
  initialFocusRef,
  highlightId = 'highlight',
  pending = false,
  children,
}: TourSpotlightProps) {
  const cardRef = useRef<HTMLElement>(null)
  const [cardHeight, setCardHeight] = useState(260)
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const focusCard = () => initialFocusRef.current?.focus({ preventScroll: true })
    const frame = window.requestAnimationFrame(focusCard)
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) focusCard()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        dismissRef.current()
      } else if (event.key === 'Tab') {
        const controls = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? [])
        if (!controls.length) return
        const index = controls.indexOf(document.activeElement as HTMLElement)
        const nextIndex = event.shiftKey
          ? (index <= 0 ? controls.length - 1 : index - 1)
          : (index + 1) % controls.length
        event.preventDefault()
        controls[nextIndex].focus({ preventScroll: true })
      }
    }
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('keydown', onKeyDown, true)
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [initialFocusRef])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const observer = new ResizeObserver(() => setCardHeight(card.getBoundingClientRect().height))
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  const cardStyle = useMemo(
    () => placeCard(targetRect, viewport, cardHeight),
    [cardHeight, targetRect, viewport],
  )

  const paddedRect = targetRect ? {
    top: Math.max(0, targetRect.top - highlightPadding),
    left: Math.max(0, targetRect.left - highlightPadding),
    right: Math.min(viewport.width, targetRect.right + highlightPadding),
    bottom: Math.min(viewport.height, targetRect.bottom + highlightPadding),
  } : null

  return (
    <div className="fixed inset-0 z-[100]" aria-live="polite">
      {paddedRect ? (
        <>
          <div className="fixed left-0 right-0 top-0 bg-black/55" style={{ height: paddedRect.top }} />
          <div className="fixed left-0 bg-black/55" style={{ top: paddedRect.top, width: paddedRect.left, height: paddedRect.bottom - paddedRect.top }} />
          <div className="fixed right-0 bg-black/55" style={{ top: paddedRect.top, left: paddedRect.right, height: paddedRect.bottom - paddedRect.top }} />
          <div className="fixed bottom-0 left-0 right-0 bg-black/55" style={{ top: paddedRect.bottom }} />
          <div
            data-tour-overlay={highlightId}
            className="pointer-events-none fixed rounded-lg border-2 border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)] transition-all duration-200 motion-reduce:transition-none"
            style={{
              top: paddedRect.top,
              left: paddedRect.left,
              width: paddedRect.right - paddedRect.left,
              height: paddedRect.bottom - paddedRect.top,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/55" />
      )}

      <section
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-tour-card-state={pending ? 'pending' : 'placed'}
        className={cn(
          'fixed z-[101] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border bg-card p-4 shadow-2xl outline-none transition-opacity duration-150 motion-reduce:transition-none',
          pending && 'pointer-events-none opacity-0',
        )}
        style={cardStyle}
      >
        {children}
      </section>
    </div>
  )
}
