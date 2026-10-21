'use client'

import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calculator, ChevronRight, ArrowLeft } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useMedcloudHfDryRun } from '@/src/application/hooks/hf-risk/use-medcloud-hf-dry-run.hook'
import { useHfIntranet } from '@/src/application/hooks/hf-risk/use-hf-intranet.hook'
import { HfMedcloudDetail } from './HfMedcloudDryRun'
import { hfHorizon, hfPercentage, scoredRun } from './HfPredictionResult'
import { HF_DRY_RUN_CLAIMS } from '@/src/core/hf-risk/contract'

export type HfSamdSessionState = { allowed: boolean; state: ReturnType<typeof useMedcloudHfDryRun> }

/** Session state survives list filters and opening other calculators. */
export function HfSamdSession({ children }: { children: (session: HfSamdSessionState) => ReactNode }) {
  const params = useSearchParams()
  const sites = params?.getAll('site') ?? []
  const hospitalSite = sites.length === 1 && sites[0] === 'vghtpe'
  const intranet = useHfIntranet(hospitalSite)
  const state = useMedcloudHfDryRun()
  return children({ allowed: hospitalSite || intranet, state })
}

export function HfSamdCalculator({ locale }: { locale: string }) {
  return <HfSamdSession>{session => <HfSamdNavigation locale={locale} session={session} />}</HfSamdSession>
}

function HfSamdNavigation({ locale, session }: { locale: string; session: HfSamdSessionState }) {
  const [open, setOpen] = useState(false)
  if (!session.allowed) return null
  return open ? <HfSamdPage locale={locale} state={session.state} onBack={() => setOpen(false)} /> :
    <HfSamdCard locale={locale} state={session.state} onOpen={() => setOpen(true)} />
}

export function HfSamdPage({ locale, state, onBack }: { locale: string; state: HfSamdSessionState['state']; onBack: () => void }) {
  const en = locale === 'en'
  return <section className="@container space-y-2" aria-label={en ? 'TVGH research trial HF calculator' : '北榮研究試用 HF 計算機'}>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="min-h-11 gap-1 px-2">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{en ? 'Back' : '返回'}
      </Button>
      <h2 className="text-sm text-muted-foreground">{en ? 'Calculators / HF outpatient prognosis' : '計算機 / HF 門診預後模型'}</h2>
    </div>
    <HfMedcloudDetail locale={locale} state={state} />
  </section>
}

export function HfSamdCard({ locale, state, onOpen }: { locale: string; state: HfSamdSessionState['state']; onOpen: () => void }) {
  const en = locale === 'en'
  const title = en ? 'HF outpatient prognosis' : 'HF 門診預後模型'
  const scores = HF_DRY_RUN_CLAIMS.map(claim => ({ claim, score: scoredRun(state.runs?.[claim]) })).filter(item => item.score)
  return (
    <Card className="rounded-lg border-border py-0 shadow-none" data-testid="hf-samd-calculator-card">
      <button type="button" onClick={onOpen} className="min-h-11 w-full rounded-lg text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-start gap-2 px-3 py-2.5">
          <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="mb-1 flex flex-wrap gap-1">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{en ? 'TVGH research trial' : '北榮研究試用'}</span>
              <span className="text-xs text-muted-foreground">{en ? 'Research pilot' : '研究試辦'}</span>
            </span>
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{en ? 'Risk of death within 1 and 3 months of the visit, calculated together. Inputs are checked automatically and gaps reported.' : '就診後 1 個月與 3 個月內死亡風險，一次算出；執行時自動檢查資料，缺漏會顯示提醒。'}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span aria-live="polite" aria-atomic="true" className="text-right text-xs text-muted-foreground">{scores.length ? scores.map(({ claim, score }) => <span key={claim} className="block tabular-nums">{hfHorizon(claim, en)} <span className="font-semibold text-foreground">{hfPercentage(score!.probability, locale)}</span></span>) : state.busy ? (en ? 'Processing…' : '處理中…') : (en ? 'Not calculated' : '尚未計算')}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
        </span>
      </button>
    </Card>
  )
}
