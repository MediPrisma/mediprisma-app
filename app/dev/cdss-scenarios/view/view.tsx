'use client'
// Dev-only: the real CDSS feature (LiveFeature) over the imported scenario
// bundle, at the width of the right panel, without the sign-in shell.
import LiveFeature from '@/features/clinical-decision-support/LiveFeature'
import { QueryProvider } from '@/src/application/providers/query-provider'
import { ThemeProvider } from '@/src/application/providers/theme.provider'
import { FontSizeProvider } from '@/src/application/providers/font-size.provider'
import { LanguageProvider } from '@/src/application/providers/language.provider'
import { AudienceProvider } from '@/src/application/providers/audience.provider'
import { AuthProvider } from '@/src/application/providers/auth.provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEffect, useSyncExternalStore } from 'react'
import { installMeasure } from './measure'
import { SCENARIO_PAGE_PACK, installSimulate } from './simulate'
import { getCdssDecisionTimings } from '@/features/clinical-decision-support/stores/cdss-decision-timing.store'
import index from '../bundles/index.json'
import { DataSelectionProvider } from '@/src/application/providers/data-selection.provider'
import { cn } from '@/src/shared/utils/cn.utils'

// StrictMode runs effects twice in development; measure once per page load.
let measuring = false

/** The scenario's stored previous visit, if it brings one (the loader sets it). */
function readPreviousVisit(): string | undefined {
  try {
    return sessionStorage.getItem('sim-previous-visit') || undefined
  } catch {
    return undefined
  }
}

const PREVIOUS_VISIT_EVENT = 'sim-previous-visit'
const subscribePreviousVisit = (callback: () => void) => {
  window.addEventListener(PREVIOUS_VISIT_EVENT, callback)
  return () => window.removeEventListener(PREVIOUS_VISIT_EVENT, callback)
}
const subscribeNothing = () => () => {}

/** The panel's width and scrolling, from the query string (dev only). */
function readPanel(): { width?: number; scroll: boolean } {
  if (typeof window === 'undefined') return { scroll: false }
  const params = new URLSearchParams(window.location.search)
  const width = Number(params.get('w'))
  return { ...(Number.isFinite(width) && width > 0 ? { width } : {}), scroll: params.get('scroll') === 'panel' }
}

export default function View() {
  // sessionStorage is not there during the server render: LiveFeature mounts
  // once the browser's value is known, so it mounts once.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const panel: { width?: number; scroll: boolean } = hydrated ? readPanel() : { scroll: false }
  const previousVisit = useSyncExternalStore(subscribePreviousVisit, readPreviousVisit, () => undefined)
  // Either standing for the same patient: the system's first visit, or a
  // return with a stored visit three months back.
  const togglePreviousVisit = () => {
    try {
      if (previousVisit) sessionStorage.removeItem('sim-previous-visit')
      else sessionStorage.setItem('sim-previous-visit', '2026-06-26')
    } catch { /* nothing to flip without storage */ }
    window.dispatchEvent(new Event(PREVIOUS_VISIT_EVENT))
  }
  useEffect(() => {
    installMeasure()
    installSimulate()
    // The in-memory decision timings, for the measurement to read back.
    ;(window as unknown as { __cdssDecisionTimings: typeof getCdssDecisionTimings }).__cdssDecisionTimings = getCdssDecisionTimings
    const id = sessionStorage.getItem('sim-current')
    if (!id || sessionStorage.getItem('sim-auto') !== '1' || measuring) return
    measuring = true
    const scenario = index.find((s) => s.id === id)
    const w = window as unknown as { __cdssMeasure: () => unknown }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    void (async () => {
      for (let i = 0; i < 40 && !document.querySelector('[data-testid^="cdss-section-module-"], [data-testid="cdss-hf-visit-flow"], [data-testid="cdss-af-visit-flow"], [data-testid^="cdss-visit-"]'); i += 1) await sleep(500)
      await sleep(1500)
      // Open the scenario's disease; heart failure is already on screen.
      const packId = SCENARIO_PAGE_PACK[scenario?.page as keyof typeof SCENARIO_PAGE_PACK]
      if (packId) {
        document.querySelector<HTMLButtonElement>(`[data-testid="cdss-disease-switch-${packId}"]`)?.click()
        await sleep(2500)
      }
      const result = w.__cdssMeasure()
      const variant = sessionStorage.getItem('sim-variant')
      // The 'new' run also walks the visit as a cardiologist would: answers,
      // then every queued decision's primary button.
      const simulation = variant === 'new' && scenario?.visit
        ? await (window as unknown as { __cdssSimulate: (visit: unknown) => Promise<unknown> }).__cdssSimulate(scenario.visit)
        : undefined
      await fetch('/api/dev-sim-log', { method: 'POST', body: JSON.stringify({ id, variant, at: new Date().toISOString(), result, simulation }) })
      sessionStorage.removeItem('sim-current')
      if (!JSON.parse(sessionStorage.getItem('sim-queue') || '[]').length) sessionStorage.removeItem('sim-auto')
      window.location.href = '/dev/cdss-scenarios'
    })()
  }, [])
  return (
    <QueryProvider>
      <ThemeProvider>
        <FontSizeProvider>
          <LanguageProvider>
            <AudienceProvider>
              <AuthProvider>
              <TooltipProvider>
              <DataSelectionProvider>
                <div className="flex min-h-screen justify-end bg-muted/30">
                  {/* `?w=700` sets the panel's width, and `?scroll=panel` makes it scroll on its own
                      under the viewport, as the app's right panel does. */}
                  <aside
                    data-testid="sim-right-panel"
                    className={cn('@container w-[880px] max-w-full border-l border-border bg-background p-3', panel.scroll && 'h-screen overflow-y-auto overscroll-y-contain')}
                    style={panel.width ? { width: `${panel.width}px` } : undefined}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <a href="/dev/cdss-scenarios" className="underline">← 換病人</a>
                      <span data-testid="sim-previous-visit">{previousVisit ? `模擬：有上次 CDSS 紀錄（${previousVisit}）` : '模擬：CDSS 首次接觸這位病人'}</span>
                      <button type="button" onClick={togglePreviousVisit} className="rounded border border-border px-2 py-0.5" data-testid="sim-previous-visit-toggle">
                        {previousVisit ? '改看首次' : '改看有上次紀錄'}
                      </button>
                    </div>
                    {hydrated ? <LiveFeature key={previousVisit ?? 'first'} {...(previousVisit ? { previousCdssVisit: previousVisit } : {})} /> : null}
                  </aside>
                </div>
              </DataSelectionProvider>
              </TooltipProvider>
              </AuthProvider>
            </AudienceProvider>
          </LanguageProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </QueryProvider>
  )
}
