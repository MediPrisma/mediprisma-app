'use client'

// What this browser has already seen: finished tours, acknowledged
// announcements, and whether the first-run offer was made. Best effort: when
// storage is unavailable everything counts as seen, so nobody is offered the
// same tour on every visit.
import { useSyncExternalStore } from 'react'
import { hasSeenLeftBrowserTour } from '@/features/left-browser-tour/left-browser-tour.store'

export const GUIDED_TOUR_PROGRESS_KEY = 'mediprisma-guided-tour-v2'
const PROGRESS_CHANGED_EVENT = 'mediprisma:guided-tour-progress'

export interface TourProgress {
  completed: readonly string[]
  seenNews: readonly string[]
  /** The first-run offer was shown (accepted or not). */
  offered: boolean
  /** True when storage is unavailable: offers and hints stay quiet. */
  unavailable?: boolean
}

const EMPTY: TourProgress = { completed: [], seenNews: [], offered: false }
const UNAVAILABLE: TourProgress = { completed: [], seenNews: [], offered: true, unavailable: true }
// SSR and hydration: assume everything was seen so nothing flashes open.
const SERVER: TourProgress = { ...UNAVAILABLE }

let cachedKey: string | undefined
let cachedProgress: TourProgress = EMPTY

function parse(raw: string | null): TourProgress {
  if (!raw) {
    // Readers of the previous tours have met the guided tour already; the new
    // hub is announced to them instead of offered as a first run.
    return hasSeenLeftBrowserTour() ? { ...EMPTY, offered: true } : EMPTY
  }
  try {
    const value = JSON.parse(raw) as Partial<TourProgress>
    return {
      completed: Array.isArray(value.completed) ? value.completed.filter((id) => typeof id === 'string') : [],
      seenNews: Array.isArray(value.seenNews) ? value.seenNews.filter((id) => typeof id === 'string') : [],
      offered: value.offered === true,
    }
  } catch {
    return EMPTY
  }
}

export function readTourProgress(): TourProgress {
  if (typeof window === 'undefined') return SERVER
  let raw: string | null
  try {
    raw = localStorage.getItem(GUIDED_TOUR_PROGRESS_KEY)
  } catch {
    return UNAVAILABLE
  }
  // A stable object per stored value, as useSyncExternalStore requires.
  const key = raw ?? `legacy:${hasSeenLeftBrowserTour()}`
  if (key !== cachedKey) {
    cachedKey = key
    cachedProgress = parse(raw)
  }
  return cachedProgress
}

function write(update: (progress: TourProgress) => TourProgress): void {
  if (typeof window === 'undefined') return
  const current = readTourProgress()
  if (current.unavailable) return
  const next = update(current)
  try {
    localStorage.setItem(GUIDED_TOUR_PROGRESS_KEY, JSON.stringify({
      completed: next.completed,
      seenNews: next.seenNews,
      offered: next.offered,
    }))
  } catch {
    // Best effort; the session simply forgets.
  }
  window.dispatchEvent(new Event(PROGRESS_CHANGED_EVENT))
}

export function markTourCompleted(tourId: string): void {
  write((progress) => progress.completed.includes(tourId)
    ? progress
    : { ...progress, completed: [...progress.completed, tourId] })
}

export function markNewsSeen(ids: readonly string[]): void {
  write((progress) => {
    const missing = ids.filter((id) => !progress.seenNews.includes(id))
    return missing.length ? { ...progress, seenNews: [...progress.seenNews, ...missing] } : progress
  })
}

/** The first-run offer was made. Announcements up to now are not news to a new reader. */
export function markFirstRunOffered(currentNewsIds: readonly string[]): void {
  write((progress) => ({
    ...progress,
    offered: true,
    seenNews: [...new Set([...progress.seenNews, ...currentNewsIds])],
  }))
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(PROGRESS_CHANGED_EVENT, onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(PROGRESS_CHANGED_EVENT, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function useTourProgress(): TourProgress {
  return useSyncExternalStore(subscribe, readTourProgress, () => SERVER)
}
