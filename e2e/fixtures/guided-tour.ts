import type { Page } from '@playwright/test'
import { WHATS_NEW } from '../../features/guided-tour/guided-tour.news'

const PROGRESS_KEY = 'mediprisma-guided-tour-v2'

/**
 * Start with the first-run tour offer made and every announcement read, so no
 * offer dialog or in-place hint covers what a test clicks. Register it after
 * any init script that clears storage.
 */
export async function quietGuidedTours(page: Page): Promise<void> {
  const progress = JSON.stringify({ completed: [], seenNews: WHATS_NEW.map((item) => item.id), offered: true })
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value)
  }, [PROGRESS_KEY, progress] as const)
}
