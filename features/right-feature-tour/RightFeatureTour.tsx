'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useAuth } from '@/src/application/providers/auth.provider'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useBetaFeatures } from '@/src/application/hooks/use-beta-features.hook'
import { cn } from '@/src/shared/utils/cn.utils'
import { TourSpotlight } from '@/features/guided-tour/spotlight/TourSpotlight'
import { useTourTarget } from '@/features/guided-tour/spotlight/use-tour-target'
import {
  CUSTOM_SUMMARY_CHAPTERS,
  type RightFeatureTourStepId,
  useRightFeatureTourStore,
} from './right-feature-tour.store'

import { getRightTourSteps } from './right-feature-tour.steps'
import { CustomSummaryTourLauncher } from './CustomSummaryTourLauncher'

function localeText(value: { 'zh-TW': string; en: string }, locale: string): string {
  return locale === 'en' ? value.en : value['zh-TW']
}

/**
 * The chaptered custom-summary guide. The other right-panel steps are scenes
 * that the guided-tour engine drives through the same store; it renders their
 * cards itself, so this component draws only the custom-summary guide.
 */
export function RightFeatureTour() {
  const { locale } = useLanguage()
  const { audience } = useAudience()
  const { user } = useAuth()
  const { enabled: betaFeaturesEnabled } = useBetaFeatures()
  const active = useRightFeatureTourStore((state) => state.active)
  const kind = useRightFeatureTourStore((state) => state.kind)
  const stepId = useRightFeatureTourStore((state) => state.stepId)
  const stop = useRightFeatureTourStore((state) => state.stop)
  const setStep = useRightFeatureTourStore((state) => state.setStep)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const guideActive = active && kind === 'custom-summary'

  const steps = useMemo(
    () => getRightTourSteps('custom-summary', { medical: audience === 'medical', authenticated: Boolean(user), betaEnabled: betaFeaturesEnabled }),
    [audience, betaFeaturesEnabled, user],
  )
  const stepIndex = Math.max(0, steps.findIndex((item) => item.id === stepId))
  const step = guideActive ? steps[stepIndex] : undefined
  const chapter = CUSTOM_SUMMARY_CHAPTERS.findLast((item) => (
    steps.findIndex((candidate) => candidate.id === item.step) <= stepIndex
  ))?.step ?? 'custom-summary'
  const { targetRect, usingFallback, viewport } = useTourTarget(step ?? null)

  useEffect(() => {
    if (!guideActive || !step || step.id === stepId) return
    setStep(step.id)
  }, [guideActive, setStep, step, stepId])

  const finish = useCallback(() => stop(), [stop])

  if (!guideActive || !step) return <CustomSummaryTourLauncher />

  const goBack = () => setStep(steps[Math.max(0, stepIndex - 1)].id)
  const goNext = () => {
    if (stepIndex >= steps.length - 1) finish()
    else setStep(steps[stepIndex + 1].id)
  }

  return (
    <TourSpotlight
      targetRect={targetRect}
      viewport={viewport}
      highlightPadding={step.highlightPadding}
      labelledBy="right-tour-title"
      describedBy="right-tour-description"
      onDismiss={finish}
      initialFocusRef={nextButtonRef}
      highlightId="right-highlight"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {locale === 'en' ? 'Detailed guide' : '詳盡導覽'} · {stepIndex + 1} / {steps.length}
        </span>
        <button
          type="button"
          data-tour-control="right-close"
          onClick={finish}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={locale === 'en' ? 'Close tour' : '關閉導覽'}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{locale === 'en' ? 'Chapter' : '章節'}</span>
        <select
          aria-label={locale === 'en' ? 'Guide chapter' : '導覽章節'}
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-[44px]"
          value={chapter}
          onChange={(event) => setStep(event.target.value as RightFeatureTourStepId)}
        >
          {CUSTOM_SUMMARY_CHAPTERS.map((item) => <option key={item.step} value={item.step}>{locale === 'en' ? item.en : item.zh}</option>)}
        </select>
      </label>
      <h2 id="right-tour-title" className="text-base font-semibold leading-snug">
        {localeText(step.title, locale)}
      </h2>
      <p id="right-tour-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {localeText(usingFallback && step.fallbackBody ? step.fallbackBody : step.body, locale)}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={finish}>
          {locale === 'en' ? 'Skip' : '略過'}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            data-tour-control="right-back"
            variant="outline"
            size="sm"
            onClick={goBack}
            disabled={stepIndex === 0}
            className={cn('gap-1', stepIndex === 0 && 'invisible')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {locale === 'en' ? 'Back' : '上一步'}
          </Button>
          <Button ref={nextButtonRef} data-tour-control="right-next" size="sm" onClick={goNext} className="gap-1">
            {stepIndex === steps.length - 1
              ? (locale === 'en' ? 'Finish' : '完成')
              : (locale === 'en' ? 'Next' : '下一步')}
            {stepIndex < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </TourSpotlight>
  )
}
