// Guided-tour usage analytics.
//
// WHY IT LIVES IN src/shared/config: this observes FEATURE stores. Both
// `src/application/**` and the rest of `src/shared/**` are forbidden by eslint
// from importing `@/features/*` ("features consume application hooks, not the
// reverse"); `src/shared/config` is the sanctioned composition root that wires
// features together (see feature-registry.ts / right-panel-registry.ts).
//
// Two sources: the guided-tour engine (every tour in the hub), and the
// chaptered custom-summary guide, which keeps its own engine in the right tour
// store. That store's `scene` runs are the engine's screens, not tours, and are
// not reported.
'use client'

import { useEffect } from 'react'
// The STORE modules, not the feature barrels: the barrels also export the
// tour components, which reach the auth provider and the whole Firebase SDK —
// none of which belongs in this provider-level module graph.
import { useGuidedTourStore } from '@/features/guided-tour/guided-tour.store'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'
import { trackEvent, type AnalyticsTour } from '@/src/application/telemetry/usage-analytics'

function reportEnd(tour: AnalyticsTour, outcome: 'finish' | 'abandon', stepId: string | null): void {
  trackEvent('tour_end', {
    tour,
    // `tour_outcome`, not `outcome`: GA4 registers custom dimensions per
    // parameter NAME, and `ai_result.outcome` is a different value space.
    tour_outcome: outcome,
    // `stop()` nulls stepId in the same set that ends the tour, so the step
    // the user actually closed on only exists in the PREVIOUS state.
    step: stepId ?? 'unknown',
  })
}

/**
 * Subscribe to the tour stores for the lifetime of the app. Mount exactly
 * once — a second mount would double-count every tour.
 */
export function useTourAnalytics(): void {
  useEffect(() => {
    // End is checked before start so a close-and-restart landing in one set
    // still reports in the order the user experienced it.
    const unsubscribeGuided = useGuidedTourStore.subscribe((state, previous) => {
      if (previous.tourId && (state.tourId !== previous.tourId || state.session > previous.session)) {
        reportEnd(previous.tourId, state.tourId ? 'abandon' : state.lastOutcome ?? 'abandon', previous.stepId)
      }
      if (state.tourId && state.session > previous.session) {
        trackEvent('tour_start', { tour: state.tourId })
      }
    })

    const unsubscribeCustomSummary = useRightFeatureTourStore.subscribe((state, previous) => {
      const wasGuide = previous.active && previous.kind === 'custom-summary'
      // `openCustomSummaryGuide()` sets active:false without bumping session —
      // an end only when the guide was actually running.
      if (wasGuide && (!state.active || state.kind !== 'custom-summary' || state.session > previous.session)) {
        reportEnd('custom-summary', previous.stepId === 'custom-summary-finish' ? 'finish' : 'abandon', previous.stepId)
      }
      if (state.kind === 'custom-summary' && state.session > previous.session) {
        trackEvent('tour_start', { tour: 'custom-summary' })
      }
    })

    return () => {
      unsubscribeGuided()
      unsubscribeCustomSummary()
    }
  }, [])
}
