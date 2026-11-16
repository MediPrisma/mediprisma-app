// 交互作用 — the hospital interaction check in the 安全 tab. It never opens by
// itself and never blocks. Every cross-visit pair and every avoid pair is
// listed; drugs the service could not check are named in the open, so "none
// found" never hides "not checked". Only same-visit pairs below avoid (the
// prescriber chose them) sit behind one disclosure. Each pair carries the
// service's own grade in its own colour (orange, yellow, blue — no red alarm
// badges, the same restraint as 開藥注意), and 避免併用 as a separate solid tag
// when the text says so, since the grade alone misses those.
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import type { MedicationRow } from '../types'
import { attentionFindings, stillCoveredUntil, type InteractionFinding, type InteractionReview, type InteractionSeverity } from '../utils/interaction-check'

interface InteractionSummaryProps {
  review: InteractionReview
  rows: MedicationRow[]
}

const text = 'text-[max(13px,0.8125rem)]'
const meta = 'text-[max(12px,0.75rem)] text-muted-foreground'
const tag = 'mt-px inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[max(11px,0.6875rem)]'
const avoidTone = 'border-amber-600 bg-amber-600 font-medium text-white dark:border-amber-500 dark:bg-amber-500 dark:text-amber-950'
const SEVERITY_TONE: Record<InteractionSeverity, string> = {
  high: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-100',
  moderate: 'border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-500/40 dark:bg-yellow-500/15 dark:text-yellow-100',
  low: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100',
  unknown: 'border-border bg-muted/60 text-muted-foreground',
}
const SEVERITY_LABEL: Record<InteractionSeverity, [string, string]> = {
  high: ['高度', 'High'],
  moderate: ['中度', 'Moderate'],
  low: ['輕度', 'Low'],
  unknown: ['未分級', 'Unrated'],
}

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
  const ended = new Set(review.endedRowIds)
  // A long-term drug whose supply ran out: when it ran out, and how far a
  // 慢簽's later fills, possibly from a pharmacy, could reach.
  const endedNote = (row: MedicationRow) => {
    if (!ended.has(row.id)) return ''
    const covered = stillCoveredUntil(row)
    const day = (iso?: string) => iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : ''
    return covered && covered !== row.endDateIso
      ? (en ? `supply to ${day(row.endDateIso)}, refills to ${day(covered)}` : `院內藥用到 ${day(row.endDateIso)}，慢箋可續領至 ${day(covered)}`)
      : (en ? `ran out ${day(row.endDateIso)}` : `${day(row.endDateIso)} 已用完`)
  }

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
          <span className="flex shrink-0 flex-col items-start gap-0.5">
            {f.tier === 'avoid' && <span className={cn(tag, avoidTone)}>{en ? 'Avoid' : '避免併用'}</span>}
            <span className={cn(tag, SEVERITY_TONE[f.severity])}>{SEVERITY_LABEL[f.severity][en ? 1 : 0]}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block break-words', text, quiet ? 'text-foreground/80' : 'font-medium text-foreground')}>
              {names(f.rowIdsA)} × {names(f.rowIdsB)}
            </span>
            {f.action && <span className={cn('block text-foreground/80', text, open ? 'break-words' : 'truncate')}>{f.action}</span>}
          </span>
          {(f.involvesEnded || f.samePrescription) && (
            <span className={cn('shrink-0 text-right', meta)}>
              {f.involvesEnded && <span className="block">{en ? 'Ran out' : '已用完'}</span>}
              {f.samePrescription && <span className="block">{en ? 'Same visit' : '同次開立'}</span>}
            </span>
          )}
        </button>
        {open && (
          <div className={cn('space-y-0.5 px-2.5 pb-2 pl-8 leading-relaxed', meta)}>
            {f.mechanism && <p className="break-words text-foreground/80">{f.mechanism}</p>}
            {[...sides(f.rowIdsA), ...sides(f.rowIdsB)].map(row => (
              <p key={row.id} className="break-words">
                {[row.title, origin(row), row.pharmacy, row.startedOn, endedNote(row)].filter(Boolean).join(' · ')}
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
        {ended.size > 0 && (
          <p className={cn('mt-0.5', meta)}>
            {en
              ? `Includes ${ended.size} long-term drug${ended.size > 1 ? 's' : ''} that ran out recently — confirm before renewing`
              : `含 ${ended.size} 項最近用完的長期用藥（慢箋期間內或用完 14 天內），續開前請確認是否仍在服用`}
          </p>
        )}
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
      <LocalPreparationNote rowIds={review.localRowIds} rows={rows} className="mx-2.5 my-2" />
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

/** One quiet line naming the skin and ear preparations left out of the check,
 *  each name once. Shown whether or not the check could run. */
export function LocalPreparationNote({ rowIds, rows, className }: { rowIds: string[]; rows: MedicationRow[]; className?: string }) {
  const { locale } = useLanguage()
  const byId = new Map(rows.map(row => [row.id, row]))
  const names = [...new Set(rowIds.map(id => byId.get(id)?.title).filter((title): title is string => !!title))]
  if (!names.length) return null
  return (
    <p className={cn('break-words', meta, className)}>
      {locale === 'en' ? `Skin and ear preparations not checked: ${names.join(', ')}` : `外用藥不列入檢核：${names.join('、')}`}
    </p>
  )
}
