'use client'

import { useEffect, useState } from 'react'
import {
  isVisibleTourElement,
  isWithinViewport,
  rectFromElement,
  sameRect,
  visibleTarget,
  type Rect,
  type Viewport,
} from './tour-geometry'

export interface TourTargetSpec {
  target: string
  /** Replaces `target` from tablet width upward. */
  desktopTarget?: string
  fallbackTarget?: string
  /**
   * Resolution attempts (75 ms apart) before a broader fallback is accepted.
   * A feature tab and its row content do not mount in the same render; give
   * the intended control time to appear before settling for the fallback.
   */
  fallbackGraceAttempts?: number
  lockTargetOnceResolved?: boolean
  /**
   * An optional step never settles for a fallback: when its target has not
   * appeared within the grace period it reports `missing` so the caller can
   * skip it instead of explaining something that is not on screen.
   */
  optional?: boolean
}

export interface TourTargetState {
  targetRect: Rect | null
  usingFallback: boolean
  missing: boolean
  viewport: Viewport
}

const MAX_ATTEMPTS = 32

/** Find, follow and scroll to the element a tour step points at. */
export function useTourTarget(spec: TourTargetSpec | null, isDesktop = false): TourTargetState {
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [usingFallback, setUsingFallback] = useState(false)
  // The spec the missing verdict belongs to, so a verdict for one step is
  // never read as the verdict for the next before the search restarts.
  const [missingFor, setMissingFor] = useState<TourTargetSpec | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!spec) {
      const resetTimer = window.setTimeout(() => {
        setTargetRect(null)
        setMissingFor(null)
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const primarySelector = spec.desktopTarget && isDesktop ? spec.desktopTarget : spec.target
    let target: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const fallbackGraceAttempts = spec.fallbackGraceAttempts ?? 16

    const updateRect = () => {
      if (!target || !isVisibleTourElement(target)) return
      const nextRect = rectFromElement(target)
      setTargetRect((currentRect) => sameRect(currentRect, nextRect) ? currentRect : nextRect)
    }
    const bindTarget = (nextTarget: HTMLElement, fallback: boolean) => {
      setMissingFor(null)
      if (target === nextTarget) {
        setUsingFallback(fallback)
        updateRect()
        return
      }
      target = nextTarget
      attempts = 0
      setUsingFallback(fallback)
      resizeObserver?.disconnect()
      resizeObserver = new ResizeObserver(updateRect)
      resizeObserver.observe(target)
      // Resolve the highlight before moving the page so a step never flashes
      // at the viewport centre while its real target is already available.
      updateRect()
      if (!isWithinViewport(target)) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(updateRect, 180)
    }
    const resolve = () => {
      const primary = visibleTarget(primarySelector)
      const pastGrace = attempts >= fallbackGraceAttempts
      if (!primary && pastGrace && spec.optional) {
        setTargetRect(null)
        setMissingFor(spec)
        return
      }
      const fallback = primary || !pastGrace
        ? null
        : (spec.fallbackTarget ? visibleTarget(spec.fallbackTarget) : null)
      const nextTarget = primary ?? fallback
      if (!nextTarget) {
        if (attempts === 0) {
          setTargetRect(null)
          setMissingFor(null)
        }
        attempts += 1
        if (attempts < MAX_ATTEMPTS) timer = setTimeout(resolve, 75)
        else {
          setTargetRect(null)
          setUsingFallback(true)
          setMissingFor(spec)
        }
        return
      }
      bindTarget(nextTarget, !primary)
    }
    const refreshTarget = () => {
      if (spec.lockTargetOnceResolved && target && isVisibleTourElement(target)) {
        updateRect()
        return
      }

      const primary = visibleTarget(primarySelector)
      if (primary) {
        bindTarget(primary, false)
        return
      }

      const currentMatchesFallback = target
        && isVisibleTourElement(target)
        && !!spec.fallbackTarget
        && target.matches(spec.fallbackTarget)
      if (currentMatchesFallback) {
        updateRect()
        return
      }

      if (target) {
        target = null
        resizeObserver?.disconnect()
        attempts = 0
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(resolve, 0)
    }
    const onViewportChange = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      updateRect()
    }

    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', updateRect, true)
    // Transforms do not resize the element; refresh after a panel animation.
    window.addEventListener('animationend', updateRect, true)
    window.addEventListener('transitionend', updateRect, true)
    mutationObserver = new MutationObserver(refreshTarget)
    mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true })
    resolve()
    return () => {
      if (timer) clearTimeout(timer)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('animationend', updateRect, true)
      window.removeEventListener('transitionend', updateRect, true)
    }
  }, [isDesktop, spec])

  return { targetRect, usingFallback, missing: spec !== null && missingFor === spec, viewport }
}
