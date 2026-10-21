"use client"

import { useMemo, useSyncExternalStore } from 'react'

/** A date's local calendar day, `YYYY-MM-DD`. */
export function localDayKey(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function today(): string {
  return localDayKey(new Date())
}

/**
 * Re-reads the day at the next local midnight, and whenever the page comes
 * back into view — a laptop closed overnight runs no timers, so the midnight
 * one alone would fire late or not at all.
 */
function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(() => {
      onChange()
      schedule()
    }, midnight.getTime() - now.getTime() + 1000)
  }
  schedule()
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onChange)
  return () => {
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onChange)
  }
}

/**
 * Today's local day, re-rendering once when it turns. What this visit asked
 * and decided belongs to one day: a page left open overnight must not carry
 * yesterday's 「無出血」 or 「開始 MRA」 into today (#166 review).
 */
export function useLocalDay(): string {
  return useSyncExternalStore(subscribe, today, today)
}

/**
 * A clock reading for 「today」 that is taken again when the day turns, and not
 * otherwise, so everything comparing a record with today follows the day
 * without re-rendering on every tick.
 */
export function useTodayNow(): Date {
  const day = useLocalDay()
  // `day` is the reason to read the clock again, not an input to the reading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Date(), [day])
}
