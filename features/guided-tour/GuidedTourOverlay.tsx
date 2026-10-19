'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import { TourSpotlight } from './spotlight/TourSpotlight'
import { useTourTarget } from './spotlight/use-tour-target'
import { useGuidedTourStore } from './guided-tour.store'
import { markTourCompleted } from './guided-tour.progress'
import { getGuidedTour, resolveTourSteps, tourTitle } from './guided-tour.tours'
import type { GuidedTourStep, Localized, TourScene } from './guided-tour.types'
import { applyTourScene, clearTourScenes } from './tour-scenes'
import { useTourContext } from './use-tour-context'

function text(value: Localized, locale: string): string {
  return locale === 'en' ? value.en : value['zh-TW']
}

/** A step without its own scene keeps the screen of the step before it. */
function sceneAt(steps: GuidedTourStep[], index: number): TourScene {
  for (let i = index; i >= 0; i -= 1) {
    const scene = steps[i]?.scene
    if (scene) return scene
  }
  return { panel: 'none' }
}

function sceneKey(scene: TourScene): string {
  return scene.panel === 'none' ? 'none' : `${scene.panel}:${scene.step}`
}

/**
 * Runs the active guided tour: sets each step's screen, points at its control
 * and skips a step whose control this record does not have.
 */
export function GuidedTourOverlay() {
  const { locale } = useLanguage()
  const context = useTourContext()
  const tourId = useGuidedTourStore((state) => state.tourId)
  const stepId = useGuidedTourStore((state) => state.stepId)
  const setStep = useGuidedTourStore((state) => state.setStep)
  const stop = useGuidedTourStore((state) => state.stop)
  const openHub = useGuidedTourStore((state) => state.openHub)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const directionRef = useRef<1 | -1>(1)

  const tour = tourId ? getGuidedTour(tourId) : undefined
  const steps = useMemo(() => tour ? resolveTourSteps(tour, context) : [], [context, tour])
  const foundIndex = steps.findIndex((item) => item.id === stepId)
  const stepIndex = foundIndex < 0 ? 0 : foundIndex
  const step = tour ? steps[stepIndex] : undefined
  const scene = sceneAt(steps, stepIndex)
  const activeSceneKey = tour && step ? sceneKey(scene) : null
  const sceneRef = useRef(scene)
  useEffect(() => { sceneRef.current = scene })

  const { targetRect, usingFallback, missing, viewport } = useTourTarget(step ?? null, context.desktop)

  const finish = useCallback(() => {
    if (tourId) markTourCompleted(tourId)
    stop('finish')
  }, [stop, tourId])
  const abandon = useCallback(() => stop('abandon'), [stop])

  const move = useCallback((direction: 1 | -1) => {
    directionRef.current = direction
    const target = stepIndex + direction
    if (target >= steps.length) finish()
    else if (target < 0) {
      // Nothing to go back to: carry on forward instead.
      directionRef.current = 1
      if (stepIndex + 1 < steps.length) setStep(steps[stepIndex + 1].id)
      else finish()
    } else setStep(steps[target].id)
  }, [finish, setStep, stepIndex, steps])

  useEffect(() => {
    if (!tour) return
    if (steps.length === 0) {
      stop('abandon')
      return
    }
    if (step && step.id !== stepId) setStep(step.id)
  }, [setStep, step, stepId, steps.length, stop, tour])

  useEffect(() => {
    if (activeSceneKey) applyTourScene(sceneRef.current)
    else clearTourScenes()
  }, [activeSceneKey])

  useEffect(() => {
    if (missing) move(directionRef.current)
  }, [missing, move])

  if (!tour || !step) return null

  const isLast = stepIndex === steps.length - 1
  const isGettingStarted = tour.id === 'getting-started'
  const english = locale === 'en'

  return (
    <TourSpotlight
      targetRect={targetRect}
      viewport={viewport}
      highlightPadding={step.highlightPadding}
      labelledBy="guided-tour-title"
      describedBy="guided-tour-body"
      onDismiss={abandon}
      initialFocusRef={nextButtonRef}
      highlightId="guided-highlight"
      pending={!targetRect && !missing}
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {text(tourTitle(tour, context), locale)}
        </span>
        <span aria-hidden="true" className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((item, index) => (
            <span key={item.id} className={cn('h-1 rounded-full', index <= stepIndex ? 'bg-primary' : 'bg-border')} />
          ))}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stepIndex + 1} / {steps.length}</span>
        <button
          type="button"
          data-tour-control="guided-close"
          onClick={abandon}
          className="-mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:h-11 max-md:w-11"
          aria-label={english ? 'Close tour' : '關閉導覽'}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <h2 id="guided-tour-title" className="mt-2.5 text-base font-semibold leading-snug">
        {text(step.title, locale)}
      </h2>
      <p id="guided-tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {text(usingFallback && step.fallbackBody ? step.fallbackBody : step.body, locale)}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2">
        {isGettingStarted ? (
          <Button variant="ghost" size="sm" className="-ml-2 max-md:min-h-[44px]" onClick={abandon}>
            {english ? 'Skip tour' : '略過導覽'}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            data-tour-control="guided-hub"
            className="-ml-2 gap-1 max-md:min-h-[44px]"
            onClick={() => { abandon(); openHub() }}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {english ? 'All tours' : '導覽中心'}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button
            data-tour-control="guided-back"
            variant="outline"
            size="sm"
            onClick={() => move(-1)}
            disabled={stepIndex === 0}
            className={cn('gap-1 max-md:min-h-[44px]', stepIndex === 0 && 'invisible')}
          >
            {english ? 'Back' : '上一步'}
          </Button>
          <Button
            ref={nextButtonRef}
            data-tour-control="guided-next"
            size="sm"
            onClick={() => move(1)}
            className="gap-1 max-md:min-h-[44px]"
          >
            {isLast ? (english ? 'Done' : '完成') : (english ? 'Next' : '下一步')}
            {!isLast && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </TourSpotlight>
  )
}
