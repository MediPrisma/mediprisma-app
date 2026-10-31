'use client'

import { useEffect, useMemo, useState } from 'react'
import { Map, Play, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useGuidedTourStore } from './guided-tour.store'
import { markFirstRunOffered, useTourProgress } from './guided-tour.progress'
import { WHATS_NEW, getGuidedTour, resolveTourSteps } from './guided-tour.tours'
import { useTourContext } from './use-tour-context'

/**
 * Offered once per browser, after the first-run onboarding: the five-step
 * core loop. Everything else waits in the hub until the reader wants it.
 */
export function FirstRunTourOffer({ eligible }: { eligible: boolean }) {
  const { locale } = useLanguage()
  const context = useTourContext()
  const progress = useTourProgress()
  const start = useGuidedTourStore((state) => state.start)
  const [open, setOpen] = useState(false)
  const english = locale === 'en'

  const steps = useMemo(() => {
    const tour = getGuidedTour('getting-started')
    return tour ? resolveTourSteps(tour, context) : []
  }, [context])

  useEffect(() => {
    if (!eligible || progress.offered || progress.unavailable) return
    const timer = window.setTimeout(() => {
      setOpen(true)
      // Recording the offer as it opens keeps a reload from offering it again.
      markFirstRunOffered(WHATS_NEW.map((item) => item.id))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [eligible, progress.offered, progress.unavailable])

  const begin = () => {
    setOpen(false)
    start('getting-started')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg gap-4" showCloseButton={false} data-testid="first-run-tour-offer">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-3 text-xl leading-snug">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Map className="h-5 w-5" aria-hidden="true" />
            </span>
            {english ? 'Walk through the core flow in a minute' : '用 1 分鐘走一遍核心流程'}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {english
              ? `${steps.length} steps, from the overview to the AI summary and back to the source. Pick up the rest from Tours whenever you need it.`
              : `${steps.length} 個步驟：從病人總覽到 AI 摘要，再到如何核對原始紀錄。其他功能之後需要時再從「導覽」挑著看。`}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-1">
          {steps.map((step, index) => (
            <li key={step.id} className="flex min-h-9 items-center gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                {index + 1}
              </span>
              {english ? step.title.en : step.title['zh-TW']}
            </li>
          ))}
        </ol>
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <span>
            {english
              ? 'The tour only changes the view. It never edits records or starts AI.'
              : '導覽只切換畫面，不修改病歷，也不會自動呼叫 AI。'}
          </span>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground max-sm:order-last">
            {english ? 'Replay anytime from Tours in the header' : '隨時可從頁首「導覽」重看'}
          </span>
          <div className="flex gap-2 max-sm:w-full max-sm:flex-col-reverse">
            <Button variant="ghost" className="min-h-[44px]" onClick={() => setOpen(false)}>
              {english ? 'Not now' : '之後再說'}
            </Button>
            <Button className="min-h-[44px] gap-2" onClick={begin}>
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              {english ? 'Start (about 1 min)' : '開始（約 1 分鐘）'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
