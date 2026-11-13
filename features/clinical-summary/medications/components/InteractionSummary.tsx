// 交互作用 — a quiet section above the medication list. It never opens by
// itself and never blocks: cross-visit pairs that need a decision are listed,
// same-visit pairs (the prescriber chose them), low-grade pairs and drugs the
// service could not check sit behind one disclosure.
import { useState } from 'react'
import { AlertTriangle, Ban, ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import type { MedicationRow } from '../types'
import type { InteractionFinding, InteractionReview } from '../utils/interaction-check'

interface InteractionSummaryProps {
  review: InteractionReview
  rows: MedicationRow[]
}

const text = 'text-[max(13px,0.8125rem)]'
const meta = 'text-[max(12px,0.75rem)] text-muted-foreground'
const badge = 'inline-flex h-5 items-center rounded-sm border px-1.5 text-[max(12px,0.75rem)] tabular-nums'
const avoidTone = 'border-destructive/35 bg-destructive/10 text-destructive dark:bg-destructive/15'
const actTone = 'border-orange-400 bg-orange-100 text-orange-950 dark:border-orange-500/60 dark:bg-orange-500/20 dark:text-orange-100'

export function InteractionSummary({ review, rows }: InteractionSummaryProps) {
  const { locale } = useLanguage()
  const en = locale === 'en'
  const [openId, setOpenId] = useState<string | null>(null)
  const [showRest, setShowRest] = useState(false)
  const byId = new Map(rows.map(row => [row.id, row]))
  const sides = (ids: string[]) => ids.map(id => byId.get(id)).filter((row): row is MedicationRow => !!row)
  const names = (ids: string[]) => [...new Set(sides(ids).map(row => row.title))].join('、')
  const origin = (row: MedicationRow) => row.dataOrigin === 'hospital' ? (en ? 'Hospital' : '院內')
    : row.dataOrigin === 'medcloud' ? (en ? 'MediCloud' : '雲端')
      : row.dataOrigin === 'integrated' ? (en ? 'Hospital + cloud' : '院內＋雲端') : ''

  const primary = review.findings.filter(f => f.tier !== 'note' && !f.samePrescription)
  const rest = review.findings.filter(f => f.tier === 'note' || f.samePrescription)
  const unchecked = sides(review.uncheckedRowIds)
  const avoid = primary.filter(f => f.tier === 'avoid').length
  const act = primary.length - avoid
  const checked = review.checkedRowIds.length
  const total = checked + unchecked.length
  const restLabel = [
    rest.length ? (en ? `${rest.length} other` : `其他 ${rest.length} 項`) : '',
    unchecked.length ? (en ? `${unchecked.length} not checked` : `${unchecked.length} 項未檢核`) : '',
  ].filter(Boolean).join(en ? ', ' : '、')

  const finding = (f: InteractionFinding, quiet: boolean) => {
    const open = openId === f.id
    const Icon = f.tier === 'avoid' ? Ban : AlertTriangle
    return (
      <li key={f.id} className="border-t border-border/60">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpenId(open ? null : f.id)}
          className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]"
        >
          <Icon
            aria-hidden
            className={cn('mt-0.5 h-3.5 w-3.5 shrink-0',
              quiet ? 'text-muted-foreground' : f.tier === 'avoid' ? 'text-destructive' : 'text-orange-600 dark:text-orange-300')}
          />
          <span className="min-w-0 flex-1">
            <span className={cn('block break-words', text, quiet ? 'text-foreground/80' : 'font-medium text-foreground')}>
              {names(f.rowIdsA)} × {names(f.rowIdsB)}
            </span>
            {f.action && <span className={cn('block text-foreground/80', text, open ? 'break-words' : 'truncate')}>{f.action}</span>}
          </span>
          {f.samePrescription && <span className={cn('shrink-0', meta)}>{en ? 'Same visit' : '同次開立'}</span>}
        </button>
        {open && (
          <div className={cn('space-y-0.5 px-2.5 pb-2 pl-8 leading-relaxed', meta)}>
            {f.mechanism && <p className="break-words text-foreground/80">{f.mechanism}</p>}
            {[...sides(f.rowIdsA), ...sides(f.rowIdsB)].map(row => (
              <p key={row.id} className="break-words">
                {[row.title, origin(row), row.pharmacy, row.startedOn].filter(Boolean).join(' · ')}
              </p>
            ))}
            {f.source && <p>{en ? 'Source: ' : '來源：'}{f.source}</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <section aria-label={en ? 'Drug interactions' : '交互作用'} className="rounded-md border border-border/70">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <h3 className={cn('font-medium text-foreground', text)}>{en ? 'Interactions' : '交互作用'}</h3>
        {avoid > 0 && <span className={cn(badge, avoidTone)}>{en ? `Avoid ${avoid}` : `避免併用 ${avoid}`}</span>}
        {act > 0 && <span className={cn(badge, actTone)}>{en ? `Review ${act}` : `需處理 ${act}`}</span>}
        {primary.length === 0 && <span className={meta}>{en ? 'None across visits' : '跨次開立未發現'}</span>}
        <span className={cn('ml-auto tabular-nums', meta)}>
          {en ? `Checked ${checked}/${total}` : `已檢核 ${checked}／${total} 項`}
        </span>
      </div>
      {primary.length > 0 && <ul>{primary.map(f => finding(f, false))}</ul>}
      {restLabel && (
        <div className="border-t border-border/60">
          <button
            type="button"
            aria-expanded={showRest}
            onClick={() => setShowRest(!showRest)}
            className={cn('flex w-full items-center gap-1 px-2.5 py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]', meta)}
          >
            {showRest ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
            {restLabel}
          </button>
          {showRest && (
            <ul>
              {rest.map(f => finding(f, true))}
              {unchecked.map(row => (
                <li key={row.id} className={cn('break-words border-t border-border/60 px-2.5 py-1.5 pl-8', meta)}>
                  <span className="text-foreground/80">{row.title}</span>
                  {' · '}{[origin(row), en ? 'not checked: ingredient not matched' : '未檢核：成分未對到'].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
