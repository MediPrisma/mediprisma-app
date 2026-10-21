import {
  GUIDED_TOUR_PROGRESS_KEY,
  markFirstRunOffered,
  markNewsSeen,
  markTourCompleted,
  readTourProgress,
} from '@/features/guided-tour/guided-tour.progress'
import { LEFT_BROWSER_TOUR_STORAGE_KEY } from '@/features/left-browser-tour/left-browser-tour.store'

describe('guided tour progress', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty for a new browser', () => {
    expect(readTourProgress()).toEqual({ completed: [], seenNews: [], offered: false })
  })

  it('does not offer the first run again to readers of the previous tours', () => {
    localStorage.setItem(LEFT_BROWSER_TOUR_STORAGE_KEY, '1')
    expect(readTourProgress().offered).toBe(true)
  })

  it('records finished tours and acknowledged announcements once each', () => {
    markTourCompleted('labs-reports')
    markTourCompleted('labs-reports')
    markNewsSeen(['a', 'b'])
    markNewsSeen(['b'])
    expect(readTourProgress()).toMatchObject({ completed: ['labs-reports'], seenNews: ['a', 'b'] })
    expect(JSON.parse(localStorage.getItem(GUIDED_TOUR_PROGRESS_KEY)!)).toMatchObject({ completed: ['labs-reports'] })
  })

  it('treats announcements as already known to a reader offered the first run', () => {
    markFirstRunOffered(['news-1', 'news-2'])
    expect(readTourProgress()).toMatchObject({ offered: true, seenNews: ['news-1', 'news-2'] })
  })

  it('survives a corrupted record', () => {
    localStorage.setItem(GUIDED_TOUR_PROGRESS_KEY, '{not json')
    expect(readTourProgress()).toEqual({ completed: [], seenNews: [], offered: false })
  })
})
