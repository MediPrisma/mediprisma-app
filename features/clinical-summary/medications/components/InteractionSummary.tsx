// 交互作用 — the hospital interaction check in the 安全 tab. It never opens by
// itself and never blocks. Every cross-visit pair and every avoid pair is
// listed; drugs the service could not check are named in the open, so "none
// found" never hides "not checked". Only same-visit pairs below avoid (the
// prescriber chose them) sit behind one disclosure. Quiet styling: no red
// alarm badges, the same restraint as 開藥注意.
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import type { MedicationRow } from '../types'
import { attentionFindings, type InteractionFinding, type InteractionReview } from '../utils/interaction-check'

interface InteractionSummaryProps {
  review: InteractionReview
  rows: MedicationRow[]
}

const text = 'text-[max(13px,0.8125rem)]'
const meta = 'text-[max(12px,0.75rem)] text-muted-foreground'
const tag = 'mt-px inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[max(11px,0.6875rem)]'
const avoidTone = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
const otherTone = 'border-border bg-muted/60 text-muted-foreground'

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

  const primary = attentionFindings(review)
  const rest = review.findings.filter(f => !primary.includes(f))
  const unchecked = sides(review.uncheckedRowIds)
  const avoid = primary.filter(f => f.tier === 'avoid').length
  const checked = review.checkedRowIds.length
  const total = checked + unchecked.length
  const status = primary.length > 0
    ? (en
      ? `${primary.length} to review${avoid ? ` (${avoid} avoid)` : ''} · checked ${checked}/${total}`
      : `需注意 ${primary.length} 項${avoid ? `（避免併用 ${avoid}）` : ''} · 已檢核 ${checked}／${total} 項`)
    : unchecked.length > 0
      ? (en
        ? `None among the ${checked} checked · ${unchecked.length} not checked`
        : `已檢核的 ${checked} 項之間未發現，${unchecked.length} 項未檢核`)
      : (en ? `Checked ${checked}/${total} · none to review` : `已檢核 ${checked}／${total} 項，未發現需注意的交互作用`)

  const finding = (f: InteractionFinding, quiet: boolean) => {
    const open = openId === f.id
    return (
      <li key={f.id} className="border-t border-border/60">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpenId(open ? null : f.id)}
          className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]"
        >
          <span className={cn(tag, f.tier === 'avoid' ? avoidTone : otherTone)}>
            {f.tier === 'avoid' ? (en ? 'Avoid' : '避免併用') : (en ? 'Review' : '需注意')}
          </span>
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
      <div className="px-2.5 py-1.5">
        <h3 className={cn('font-medium text-foreground', text)}>
          {en ? 'Interactions' : '交互作用'}
          <span className={cn('font-normal', meta)}>{en ? ' · VGH pharmacy database' : ' · 北榮藥劑部資料庫'}</span>
        </h3>
        <p className={cn('mt-0.5 tabular-nums text-foreground/80', text)}>{status}</p>
      </div>
      {primary.length > 0 && <ul>{primary.map(f => finding(f, false))}</ul>}
      {unchecked.length > 0 && (
        <div className={cn('mx-2.5 my-2 rounded-md border border-dashed border-border px-2.5 py-1.5', meta)}>
          <p className="text-foreground/80">
            {en ? `Not checked (${unchecked.length}) — ingredient not matched:` : `未檢核 ${unchecked.length} 項（成分未對到）：`}
          </p>
          <ul>
            {unchecked.map(row => (
              <li key={row.id} className="break-words">
                {[row.title, origin(row)].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rest.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            aria-expanded={showRest}
            onClick={() => setShowRest(!showRest)}
            className={cn('flex w-full items-center gap-1 px-2.5 py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-[44px]', meta)}
          >
            {showRest ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
            {en ? `Same visit: ${rest.length}` : `同次開立 ${rest.length} 項`}
          </button>
          {showRest && <ul>{rest.map(f => finding(f, true))}</ul>}
        </div>
      )}
    </section>
  )
}
