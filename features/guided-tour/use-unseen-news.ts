'use client'

import { useMemo } from 'react'
import { useTourProgress } from './guided-tour.progress'
import { availableWhatsNew } from './guided-tour.tours'
import type { WhatsNewItem } from './guided-tour.types'
import { useTourContext } from './use-tour-context'

/** Announcements this reader can open and has not acknowledged yet. */
export function useUnseenNews(): WhatsNewItem[] {
  const context = useTourContext()
  const progress = useTourProgress()
  return useMemo(() => progress.unavailable
    ? []
    : availableWhatsNew(context).filter((item) => !progress.seenNews.includes(item.id)),
  [context, progress])
}
