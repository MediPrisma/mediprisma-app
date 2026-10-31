'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { rectFromElement, visibleTarget, type Rect } from './spotlight/tour-geometry'
import { useGuidedTourStore } from './guided-tour.store'
import { markNewsSeen } from './guided-tour.progress'
import type { WhatsNewItem } from './guided-tour.types'
import { useUnseenNews } from './use-unseen-news'

const CHECK_INTERVAL_MS = 1500
const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"]'
const CARD_WIDTH = 320

/**
 * Announces a new feature beside the control itself, the first time the
 * reader has that control on screen. One hint per visit, never over a tour or
 * a dialog, and never on routes that must stay silent (the caller decides).
 */
export function WhatsNewHint({ eligible }: { eligible: boolean }) {
  const { locale } = useLanguage()
  const unseen = useUnseenNews()
  const startTour = useGuidedTourStore((state) => state.start)
  const openHub = useGuidedTourStore((state) => state.openHub)
  const [shown, setShown] = useState<{ item: WhatsNewItem; rect: Rect } | null>(null)
  const usedRef = useRef(false)
  const english = locale === 'en'

  // Wait for an unseen item's control to be on screen.
  useEffect(() => {
    if (!eligible || shown || usedRef.current || unseen.length === 0) return
    const check = () => {
      if (document.querySelector(MODAL_SELECTOR)) return
      for (const item of unseen) {
        const element = visibleTarget(item.anchor)
        if (!element) continue
        const rect = rectFromElement(element)
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue
        usedRef.current = true
        setShown({ item, rect })
        return
      }
    }
    const timer = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [eligible, shown, unseen])

  // Follow the control while the hint is up. A dialog opening over the page,
  // or the control leaving it, withdraws the hint without acknowledging it,
  // so it can return on a later visit.
  useEffect(() => {
    if (!shown) return
    const update = () => {
      const element = document.querySelector(MODAL_SELECTOR) ? null : visibleTarget(shown.item.anchor)
      if (!element) {
        setShown(null)
        return
      }
      const rect = rectFromElement(element)
      setShown((current) => current && (current.rect.top !== rect.top || current.rect.left !== rect.left)
        ? { ...current, rect }
        : current)
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [shown])

  // A tour or dialog taking over withdraws the hint without acknowledging it.
  useEffect(() => {
    if (!eligible && shown) {
      const timer = window.setTimeout(() => setShown(null), 0)
      return () => window.clearTimeout(timer)
    }
  }, [eligible, shown])

  if (!shown) return null
  const { item, rect } = shown
  const dismiss = () => {
    markNewsSeen([item.id])
    setShown(null)
  }
  const showMe = () => {
    markNewsSeen([item.id])
    setShown(null)
    if (item.tourId) startTour(item.tourId)
    else if (item.opensHub) openHub()
  }

  const margin = 12
  const viewportWidth = window.innerWidth
  const below = rect.bottom + 180 < window.innerHeight
  const left = Math.max(margin, Math.min(viewportWidth - CARD_WIDTH - margin, rect.left + rect.width / 2 - CARD_WIDTH / 2))
  const cardStyle = below
    ? { top: rect.bottom + 12, left, width: Math.min(CARD_WIDTH, viewportWidth - margin * 2) }
    : { bottom: window.innerHeight - rect.top + 12, left, width: Math.min(CARD_WIDTH, viewportWidth - margin * 2) }

  return (
    <>
      <span
        aria-hidden="true"
        data-whats-new-ring
        className="pointer-events-none fixed z-[60] rounded-lg border-2 border-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)] motion-safe:animate-pulse"
        style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <section
        role="status"
        aria-labelledby="whats-new-title"
        data-testid="whats-new-hint"
        className="fixed z-[60] rounded-xl border bg-card p-4 shadow-xl"
        style={cardStyle}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {english ? 'New' : '新功能'}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={dismiss}
            className="-mr-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:h-11 max-md:w-11"
            aria-label={english ? 'Dismiss' : '關閉提示'}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <h2 id="whats-new-title" className="mt-1.5 text-[15px] font-semibold leading-snug">
          {english ? item.title.en : item.title['zh-TW']}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {english ? item.body.en : item.body['zh-TW']}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="max-md:min-h-[44px]" onClick={dismiss}>
            {english ? 'Got it' : '知道了'}
          </Button>
          {(item.tourId || item.opensHub) && (
            <Button size="sm" className="max-md:min-h-[44px]" onClick={showMe}>
              {item.opensHub ? (english ? 'Open Tours' : '打開導覽中心') : (english ? 'Show me' : '帶我看看')}
            </Button>
          )}
        </div>
      </section>
    </>
  )
}
