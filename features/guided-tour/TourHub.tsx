'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  Activity,
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  FileText,
  GraduationCap,
  HeartPulse,
  MessageSquare,
  Pill,
  Play,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useAudience } from '@/src/application/providers/audience.provider'
import { useRightFeatureTourStore } from '@/features/right-feature-tour/right-feature-tour.store'
import { cn } from '@/src/shared/utils/cn.utils'
import { takeHubOpener, useGuidedTourStore } from './guided-tour.store'
import { markNewsSeen, useTourProgress } from './guided-tour.progress'
import {
  TASK_TOUR_IDS,
  availableWhatsNew,
  getGuidedTour,
  isTourAvailable,
  resolveTourSteps,
  tourDescription,
  tourTitle,
} from './guided-tour.tours'
import type { GuidedTourDefinition, GuidedTourIcon, GuidedTourId, Localized } from './guided-tour.types'
import { useTourContext } from './use-tour-context'

const ICONS: Record<GuidedTourIcon, LucideIcon> = {
  start: Play,
  user: UserRound,
  activity: Activity,
  pill: Pill,
  panels: Columns2,
  summary: FileText,
  book: BookOpen,
  chat: MessageSquare,
  copy: Copy,
  calculator: Calculator,
  guide: HeartPulse,
  education: GraduationCap,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
}

/** The visible hub entry: the header button, or 更多 where the header is compact. */
const HUB_ENTRY_SELECTORS = ['[data-tour="tour-hub-button"]', '[data-tour="header-more"]']

function hubEntry(): HTMLElement | null {
  const entries = HUB_ENTRY_SELECTORS
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((element): element is HTMLElement => element !== null)
  return entries.find((element) => element.getClientRects().length > 0) ?? entries[0] ?? null
}

function handedOver(): boolean {
  const right = useRightFeatureTourStore.getState()
  return useGuidedTourStore.getState().tourId !== null
    || right.launcherOpen
    || (right.active && right.kind === 'custom-summary')
}

function text(value: Localized, locale: string): string {
  return locale === 'en' ? value.en : value['zh-TW']
}

/** Start a tour from the hub, handing the custom-summary guide to its own engine. */
export function launchGuidedTour(tour: GuidedTourDefinition): void {
  const right = useRightFeatureTourStore.getState()
  if (right.kind === 'custom-summary' && right.active) right.stop()
  if (tour.handOff === 'custom-summary') {
    useGuidedTourStore.getState().closeHub()
    right.openCustomSummaryGuide()
    return
  }
  useGuidedTourStore.getState().start(tour.id)
}

/**
 * The tour hub: the one-minute getting-started tour, what is new, and a tour
 * per task. It lists only what the current reader can open.
 */
export function TourHub() {
  const { locale } = useLanguage()
  const { setAudience } = useAudience()
  const context = useTourContext()
  const progress = useTourProgress()
  const open = useGuidedTourStore((state) => state.hubOpen)
  const closeHub = useGuidedTourStore((state) => state.closeHub)
  const english = locale === 'en'

  const gettingStarted = getGuidedTour('getting-started')
  const tasks = useMemo(() => TASK_TOUR_IDS
    .map((id) => getGuidedTour(id))
    .filter((tour): tour is GuidedTourDefinition => Boolean(tour) && isTourAvailable(tour!, context)),
  [context])
  const announcements = useMemo(() => availableWhatsNew(context), [context])
  // The announcement of the hub itself is read by opening the hub.
  const news = useMemo(() => announcements.filter((item) => !item.opensHub), [announcements])
  const doneCount = tasks.filter((tour) => progress.completed.includes(tour.id)).length

  // The hub has no DialogTrigger (it opens from the header, the 更多 menu or a
  // hint), so focus goes back to where it was, or to the hub's entry.
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const opener = takeHubOpener()
    // A started tour or guide takes focus into its own card.
    if (handedOver()) return
    const target = opener?.isConnected ? opener : hubEntry()
    target?.focus({ preventScroll: true })
  }

  // Opening the hub is reading the announcements: they stop counting as new
  // once it closes, while their rows stay listed for the visit.
  const shownNewsRef = useRef<string[]>([])
  useEffect(() => {
    if (open) {
      shownNewsRef.current = announcements.map((item) => item.id)
      return
    }
    if (shownNewsRef.current.length) {
      markNewsSeen(shownNewsRef.current)
      shownNewsRef.current = []
    }
  }, [announcements, open])

  const stepLabel = (tour: GuidedTourDefinition) => {
    if (tour.handOff === 'custom-summary') return english ? '6 chapters' : '6 章'
    const count = resolveTourSteps(tour, context).length
    return english ? `${count} ${count === 1 ? 'step' : 'steps'}` : `${count} 步`
  }

  const startTour = (id: GuidedTourId) => {
    const tour = getGuidedTour(id)
    if (tour) launchGuidedTour(tour)
  }

  const audienceLabel = context.audience === 'medical'
    ? (english ? 'Clinician' : '醫療人員')
    : (english ? 'Patient' : '民眾')

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeHub() }}>
      <DialogContent
        data-testid="tour-hub"
        onCloseAutoFocus={restoreFocus}
        overlayClassName="bg-black/25"
        className={cn(
          'flex max-h-[min(860px,calc(100dvh-4.5rem))] flex-col gap-0 overflow-hidden p-0',
          // Phone: a sheet from the bottom edge. Wider: a panel under the header button.
          'max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl',
          'sm:top-16 sm:right-4 sm:left-auto sm:max-w-[440px] sm:translate-x-0 sm:translate-y-0 sm:rounded-xl',
        )}
      >
        <div className="border-b px-5 pb-3 pt-4 pr-12">
          <DialogTitle className="text-lg font-semibold">{english ? 'Tours' : '導覽中心'}</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed">
            {english
              ? 'Each takes under a minute. Tours only change the view; they never edit the record or call AI.'
              : '每段 1 分鐘內。導覽只切換畫面，不修改病歷，也不會呼叫 AI。'}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
          {gettingStarted && (
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{text(tourTitle(gettingStarted, context), locale)}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                  {stepLabel(gettingStarted)} · {text(tourDescription(gettingStarted, context), locale)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {progress.completed.includes('getting-started') && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {english ? 'Done' : '已完成'}
                  </span>
                )}
                <Button size="sm" variant={progress.completed.includes('getting-started') ? 'outline' : 'default'} className="min-h-[36px] max-sm:min-h-[44px]" onClick={() => startTour('getting-started')}>
                  {progress.completed.includes('getting-started') ? (english ? 'Replay' : '重看') : (english ? 'Start' : '開始')}
                </Button>
              </div>
            </div>
          )}

          {news.length > 0 && (
            <section aria-labelledby="tour-hub-news">
              <h3 id="tour-hub-news" className="flex items-center gap-2 px-1.5 pb-1.5 text-xs font-semibold text-muted-foreground">
                {english ? 'New' : '新功能'}
              </h3>
              <ul className="space-y-1.5">
                {news.map((item) => {
                  const unseen = !progress.seenNews.includes(item.id)
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          markNewsSeen([item.id])
                          if (item.tourId) startTour(item.tourId)
                        }}
                        className="flex min-h-[52px] w-full items-center gap-3 rounded-lg bg-primary/[0.06] px-2.5 py-2 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', unseen ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {text(item.title, locale)}
                            {unseen && <span className="sr-only">{english ? ' (new)' : '（新）'}</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{text(item.where, locale)}</span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-primary">{english ? 'Show me' : '帶我看'}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="tour-hub-tasks">
            <div className="flex items-center justify-between px-1.5 pb-1">
              <h3 id="tour-hub-tasks" className="text-xs font-semibold text-muted-foreground">
                {english ? 'Learn by task' : '依任務學習'}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {english ? `${doneCount} of ${tasks.length} viewed` : `已看過 ${doneCount} / ${tasks.length}`}
              </span>
            </div>
            <ul>
              {tasks.map((tour) => {
                const Icon = ICONS[tour.icon]
                const done = progress.completed.includes(tour.id)
                return (
                  <li key={tour.id} className="border-b border-border/60 last:border-b-0">
                    <button
                      type="button"
                      data-tour-hub-item={tour.id}
                      onClick={() => startTour(tour.id)}
                      className="flex min-h-[52px] w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{text(tourTitle(tour, context), locale)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{text(tourDescription(tour, context), locale)}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stepLabel(tour)}</span>
                      {done ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">{english ? 'Viewed' : '已看過'}</span>
                        </span>
                      ) : (
                        <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-border" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground max-sm:pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <span>
            {english ? 'Shown for: ' : '依目前身份顯示：'}{audienceLabel}
            {context.betaEnabled ? (english ? ' · Beta on' : ' · Beta 已開啟') : ''}
          </span>
          <button
            type="button"
            className="min-h-[36px] rounded px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setAudience(context.audience === 'medical' ? 'patient' : 'medical')}
          >
            {context.audience === 'medical'
              ? (english ? 'Switch to patient' : '切換為民眾')
              : (english ? 'Switch to clinician' : '切換為醫療人員')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
