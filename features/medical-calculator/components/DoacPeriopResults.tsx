import { ExternalLink } from 'lucide-react'
import type { CalcValues, L } from '../types'
import { DOAC_RULES_VERSION, LABEL_SOURCES, crclLabel } from '../doac-dose-model'
import {
  GUIDELINE_SOURCES,
  PERIOP_FIELD_LABELS,
  calculatePeriop,
  formatLocal,
  isLabelCite,
  type AnyCite,
  type GuidelineCite,
  type PeriopLine,
  type PeriopResult,
} from '../doac-periop-model'
import { Cite as LabelCiteView } from './DoacDoseResults'

const STATE: Record<PeriopResult['state'], { zh: string; en: string; style: string }> = {
  timed: { zh: '依出血風險分級', en: 'By bleeding risk', style: 'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300' },
  ablation: { zh: 'AF 消融', en: 'AF ablation', style: 'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300' },
  'no-hours': { zh: '無可用停藥時數', en: 'No interval applies', style: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
  emergency: { zh: '緊急手術', en: 'Emergency', style: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
  missing: { zh: '待補資料', en: 'Needs inputs', style: 'bg-muted text-muted-foreground' },
}

const FIELD_KEY: Record<string, string> = { CrCl: 'scr', anaesthesia: 'traumatic_puncture' }

function GuidelineCiteView({ cite, zh }: { cite: GuidelineCite; zh: boolean }) {
  const source = cite.source === 'ehra' ? 'EHRA 2021' : 'ASRA 2025'
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline">{`${source} ${cite.section} · p.${cite.page}`}</summary>
      <blockquote className="mt-1 border-l-2 border-border pl-2 text-[11px] italic leading-snug text-muted-foreground">“{cite.quote}”</blockquote>
      {cite.figure && <p className="mt-1 pl-2 text-[11px] leading-snug text-muted-foreground">{zh ? cite.figure.zh : cite.figure.en}</p>}
    </details>
  )
}

function CiteView({ cite, zh }: { cite: AnyCite; zh: boolean }) {
  return isLabelCite(cite) ? <LabelCiteView cite={cite} /> : <GuidelineCiteView cite={cite} zh={zh} />
}

function Line({ item, zh }: { item: PeriopLine; zh: boolean }) {
  return (
    <li className="text-xs leading-snug">
      <span>{zh ? item.text.zh : item.text.en}</span>
      {item.cites.map((cite, index) => <CiteView key={index} cite={cite} zh={zh} />)}
    </li>
  )
}

function Chips({ keys, zh, onReviewField }: { keys: string[]; zh: boolean; onReviewField?: (key: string) => void }) {
  if (!keys.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
      <span>{zh ? '待填：' : 'To fill:'}</span>
      {keys.map((key) => {
        const label: L | undefined = PERIOP_FIELD_LABELS[key]
        return (
          <button
            key={key}
            type="button"
            disabled={!onReviewField}
            onClick={() => onReviewField?.(FIELD_KEY[key] ?? key)}
            className="rounded border border-border px-1.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label ? (zh ? label.zh : label.en) : key}
          </button>
        )
      })}
    </div>
  )
}

function Times({ label, dates }: { label: string; dates: Date[] }) {
  if (!dates.length) return null
  return (
    <p className="text-xs leading-snug">
      {label}
      <span className="tabular-nums">{dates.map(formatLocal).join('、')}</span>
    </p>
  )
}

/**
 * The plan for stopping the current DOAC before a procedure and restarting
 * it: the interval and where it came from, the clock times from the patient's
 * own dose times, and every restart condition. Nothing here says a patient may
 * proceed.
 */
export function DoacPeriopResults({ values, locale, onReviewField }: {
  values: CalcValues
  locale: string
  onReviewField?: (key: string) => void
}) {
  const zh = locale === 'zh-TW'
  const plan = calculatePeriop(values)
  const state = STATE[plan.state]
  return (
    <section aria-label={zh ? 'DOAC 手術前後停藥' : 'DOAC peri-procedural plan'} className="overflow-hidden rounded-lg border border-border" data-testid="doac-periop-results" data-state={plan.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b bg-muted/40 px-3 py-2">
        <h3 className="text-sm font-semibold">
          {plan.agent ?? (zh ? '未選 DOAC' : 'No DOAC chosen')}
          {plan.crcl ? ` · CrCl ${crclLabel(plan.crcl.value)} mL/min${plan.crcl.source === 'manual' ? (zh ? '（手動）' : ' (manual)') : ''}` : ''}
        </h3>
        <span className={`rounded px-1.5 text-xs ${state.style}`}>{zh ? state.zh : state.en}</span>
      </div>
      {plan.cautions.length > 0 && (
        <ul className="space-y-1 border-b border-amber-300 bg-amber-50/70 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="doac-periop-cautions">
          {plan.cautions.map((item, index) => <Line key={index} item={item} zh={zh} />)}
        </ul>
      )}
      <div className="divide-y divide-border">
        <div className="px-3 py-2" data-testid="doac-periop-hold">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h4 className="text-sm font-medium">{zh ? '術前停藥' : 'Before'}</h4>
            {plan.holdHours !== undefined && (
              <span className="text-base font-semibold tabular-nums">
                {plan.troughOnly
                  ? (zh ? `不提前停藥・谷底約 ${plan.holdHours} 小時` : `Not stopped early · trough about ${plan.holdHours} h`)
                  : (zh ? `最後一劑距手術 ≥${plan.holdHours} 小時` : `Last dose ≥${plan.holdHours} h before`)}
              </span>
            )}
          </div>
          {plan.basis.length > 0 && <ul className="mt-1 space-y-1">{plan.basis.map((item, index) => <Line key={index} item={item} zh={zh} />)}</ul>}
          {plan.troughOnly && plan.lastDose && (
            <div className="mt-1 space-y-0.5 rounded border border-border bg-muted/30 px-2 py-1" data-testid="doac-periop-clock">
              <p className="text-xs leading-snug">{zh ? '最後一劑（照常服用）：' : 'Last dose (taken as usual): '}<span className="font-medium tabular-nums">{formatLocal(plan.lastDose)}</span>{zh ? `，距開始 ${plan.hoursFromLastDose?.toFixed(1)} 小時` : `, ${plan.hoursFromLastDose?.toFixed(1)} h before the start`}</p>
            </div>
          )}
          {plan.lastDoseBy && (
            <div className="mt-1 space-y-0.5 rounded border border-border bg-muted/30 px-2 py-1" data-testid="doac-periop-clock">
              <p className="text-xs leading-snug">{zh ? '最晚服藥：' : 'Last dose by: '}<span className="font-medium tabular-nums">{formatLocal(plan.lastDoseBy)}</span></p>
              {plan.lastDose && <p className="text-xs leading-snug">{zh ? '最後一劑：' : 'Last dose taken: '}<span className="font-medium tabular-nums">{formatLocal(plan.lastDose)}</span></p>}
              <Times label={zh ? `跳過 ${plan.skippedBefore.length} 劑（至開始時刻）：` : `Skip ${plan.skippedBefore.length} doses (to the start): `} dates={plan.skippedBefore} />
            </div>
          )}
          <Chips keys={plan.missing} zh={zh} onReviewField={onReviewField} />
        </div>
        {(plan.state === 'timed' || plan.state === 'ablation') && (
          <div className="px-3 py-2" data-testid="doac-periop-resume">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h4 className="text-sm font-medium">{zh ? '術後恢復（取各條件最晚者）' : 'Restart (the latest condition)'}</h4>
              {plan.resume.earliest && <span className="text-base font-semibold tabular-nums">{zh ? `最早 ${formatLocal(plan.resume.earliest)}` : `From ${formatLocal(plan.resume.earliest)}`}</span>}
            </div>
            <ul className="mt-1 space-y-1">{plan.resume.lines.map((item, index) => <Line key={index} item={item} zh={zh} />)}</ul>
            {plan.resume.firstDose && (
              <div className="mt-1 space-y-0.5 rounded border border-border bg-muted/30 px-2 py-1">
                <Times label={plan.troughOnly ? (zh ? `處置當下到恢復前不服用、不補服 ${plan.resume.skippedAfter.length} 劑：` : `Not taken nor made up from the procedure to the restart, ${plan.resume.skippedAfter.length}: `) : (zh ? `術後再跳過 ${plan.resume.skippedAfter.length} 劑：` : `Skip ${plan.resume.skippedAfter.length} more after: `)} dates={plan.resume.skippedAfter} />
                {plan.resume.delayed && <p className="text-xs leading-snug">{zh ? `${formatLocal(plan.resume.delayed)} 那一劑延到恢復時服用，之後照原時間。` : `The ${formatLocal(plan.resume.delayed)} dose is taken at the restart instead, then the usual times.`}</p>}
                <p className="text-xs leading-snug">{zh ? '恢復的第一劑：' : 'First dose back: '}<span className="font-medium tabular-nums">{formatLocal(plan.resume.firstDose)}</span>{plan.resume.dose ? (zh ? `（${plan.resume.dose.zh}；需確認止血）` : ` (${plan.resume.dose.en}; once haemostasis is confirmed)`) : null}</p>
              </div>
            )}
          </div>
        )}
        {plan.pending.length > 0 && (
          <div className="px-3 py-2">
            <p className="text-xs text-muted-foreground">{zh ? '時刻與恢復時間還需要：' : 'Clock times and restart still need:'}</p>
            <Chips keys={plan.pending} zh={zh} onReviewField={onReviewField} />
          </div>
        )}
        {plan.notes.length > 0 && (
          <div className="px-3 py-2" data-testid="doac-periop-notes">
            <ul className="space-y-1">{plan.notes.map((item, index) => <Line key={index} item={item} zh={zh} />)}</ul>
          </div>
        )}
      </div>
      <p className="border-t px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {zh
          ? `依 EHRA 2021、ASRA 2025（第 5 版）與 EU SmPC · ${DOAC_RULES_VERSION}。時數是最低間隔；最後決定由手術、麻醉團隊依個別出血與栓塞風險判斷，並以書面告知病人與相關醫師。`
          : `EHRA 2021, ASRA 2025 (5th edition) and the EU SmPC · ${DOAC_RULES_VERSION}. Intervals are minimums; the surgical and anaesthetic team decides by the individual bleeding and thrombotic risk, and writes the plan down for the patient and the physicians involved.`}
      </p>
      <ul className="border-t px-3 py-2 text-xs">
        {Object.values(GUIDELINE_SOURCES).map((source) => (
          <li key={source.url}>
            <a className="inline-flex min-h-8 items-center gap-1 text-primary underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              {source.title}
            </a>
            <span className="ml-1 text-muted-foreground">（{source.citation}）</span>
          </li>
        ))}
        {plan.agent && (
          <li>
            <a className="inline-flex min-h-8 items-center gap-1 text-primary underline underline-offset-4" href={LABEL_SOURCES[plan.agent].url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              {LABEL_SOURCES[plan.agent].title}
            </a>
          </li>
        )}
      </ul>
    </section>
  )
}
