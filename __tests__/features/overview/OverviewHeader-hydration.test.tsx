/**
 * 總覽's date window must hydrate cleanly when the server's calendar day is
 * not the reader's.
 *
 * Reported 2026-10-05 at 00:30 Asia/Taipei: the server printed
 * 「2026/07/04 – 2026/10/04」 (its own UTC day) and the browser
 * 「2026/07/05 – 2026/10/05」, so React rejected the header during hydration.
 * The window ends on the reader's today, which the server cannot know — a
 * static export even prints the day it was built — so the header must keep
 * the dates out of the server HTML and fill them in once hydrated.
 */
import { act, useLayoutEffect } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { render, screen } from '@testing-library/react'
import { OverviewHeader } from '@/features/clinical-summary/overview/components/OverviewHeader'
import { useOverviewWindow } from '@/features/clinical-summary/overview/hooks/useOverviewWindow'
import { buildOverviewWindow } from '@/features/clinical-summary/overview/utils/overview-selectors'

jest.mock('@/src/application/providers/language.provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zhTW: translations } = require('@/src/shared/i18n/locales/zh-TW')
  return { useLanguage: () => ({ t: translations, locale: 'zh-TW' }) }
})

// 00:30 on 2026-10-05 in Taipei, when UTC is still on 2026-10-04.
const NOW = Date.parse('2026-10-04T16:30:00Z')
const READER_RANGE = '2026/07/05 – 2026/10/05'
const SERVER_RANGE = '2026/07/04 – 2026/10/04'
// A real date, not the all-zero stand-in that holds the label's width.
const ANY_REAL_DATE = /[1-9]\d{3}\/\d{2}\/\d{2}/

/** The card's own wiring: the live day clock feeding the header. */
type HeaderModules = {
  OverviewHeader: typeof OverviewHeader
  useOverviewWindow: typeof useOverviewWindow
}

function headerOnTodaysWindow({ OverviewHeader: Header, useOverviewWindow: useWindow }: HeaderModules) {
  return function OverviewHeaderOnTodaysWindow() {
    const { window, setMonths } = useWindow()
    return <Header window={window} onRangeChange={setMonths} />
  }
}

/**
 * Server HTML from a server running in UTC.
 *
 * `npm test` pins TZ=Asia/Taipei for the whole process and Node ignores a TZ
 * change made inside a test, so the server's calendar is reproduced through
 * its wall clock instead: at instant T a UTC server reads the same date and
 * time that Taipei reads at T − 8 h. The pass also gets a module registry of
 * its own, as a separate process would, so the day clock's shared snapshot
 * cannot leak into the browser's hydration.
 */
function renderOnUtcServer(): string {
  jest.setSystemTime(NOW + new Date(NOW).getTimezoneOffset() * 60_000)
  let html = ''
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { renderToString } = require('react-dom/server')
    const Harness = headerOnTodaysWindow({
      OverviewHeader: require('@/features/clinical-summary/overview/components/OverviewHeader').OverviewHeader,
      useOverviewWindow: require('@/features/clinical-summary/overview/hooks/useOverviewWindow').useOverviewWindow,
    })
    /* eslint-enable @typescript-eslint/no-require-imports */
    html = renderToString(<Harness />)
  })
  jest.setSystemTime(NOW)
  return html
}

const Harness = headerOnTodaysWindow({ OverviewHeader, useOverviewWindow })

describe('OverviewHeader date window across server and browser time zones', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    container.remove()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('reproduces the reported clock: the UTC day and the Taipei day differ', () => {
    expect(new Date(NOW).toISOString().slice(0, 10)).toBe('2026-10-04')
    expect(buildOverviewWindow(3, NOW)).toEqual({ months: 3, startDay: '2026-07-05', endDay: '2026-10-05' })
  })

  it('keeps every date out of the server HTML', () => {
    const html = renderOnUtcServer()

    expect(html).toContain('近3個月總覽')
    expect(html).not.toContain(SERVER_RANGE)
    expect(html).not.toMatch(ANY_REAL_DATE)
  })

  it('hydrates without a mismatch and then shows the reader\'s window', async () => {
    container.innerHTML = renderOnUtcServer()
    const recoverableErrors: unknown[] = []
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root = hydrateRoot(container, <Harness />, {
        onRecoverableError: (error) => { recoverableErrors.push(error) },
      })
    })

    expect(recoverableErrors).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    expect(container.textContent).toContain(READER_RANGE)
    expect(container.textContent).not.toContain(SERVER_RANGE)
    expect(container.querySelector('.invisible')).toBeNull()
  })

  it('holds the width of the dates while they are pending, hidden from view and assistive tech', () => {
    const html = renderOnUtcServer()
    container.innerHTML = html

    const pending = container.querySelector('span.tabular-nums.invisible')
    // Same glyph count as 「2026/07/05 – 2026/10/05」 under tabular numerals.
    expect(pending?.textContent).toBe('0000/00/00 – 0000/00/00')
  })

  it('prints the window in the first commit when the card mounts in the browser', () => {
    // Opening 總覽 after the page has loaded is not a hydration; the dates
    // must be there before the first paint, not one effect later.
    let firstCommitText = ''
    function FirstCommit() {
      useLayoutEffect(() => { firstCommitText = document.body.textContent ?? '' }, [])
      return null
    }

    render(<><Harness /><FirstCommit /></>)

    expect(firstCommitText).toContain(READER_RANGE)
    expect(screen.getByText(READER_RANGE)).toBeVisible()
  })
})
