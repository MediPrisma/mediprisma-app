'use client'

import { useLeftBrowserTourStore } from '@/features/left-browser-tour/left-browser-tour.store'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'
import type { TourScene } from './guided-tour.types'

function endRightScene(): void {
  const right = useRightFeatureTourStore.getState()
  // The custom-summary guide owns its own run; only end a scene.
  if (right.active && right.kind === 'scene') right.stop()
}

/**
 * Put the panels in the state a step needs. Only one panel shows a scene at a
 * time: on a phone that decides which panel is on screen, and each panel
 * gives the reader's own tab back when its scene ends.
 */
export function applyTourScene(scene: TourScene): void {
  if (scene.panel === 'left') {
    endRightScene()
    useLeftBrowserTourStore.getState().showScene(scene.step)
  } else if (scene.panel === 'right') {
    useLeftBrowserTourStore.getState().stop()
    useRightFeatureTourStore.getState().showScene(scene.step)
  } else {
    clearTourScenes()
  }
}

export function clearTourScenes(): void {
  useLeftBrowserTourStore.getState().stop()
  endRightScene()
}
