"use client"

import { Check, ChevronDown, Minus, X } from 'lucide-react'
import { cn } from '@/src/shared/utils/cn.utils'
import type { CriterionSummary, DiagnosticSummary } from '../physician-input-contract'
import type { CdssRecommendation, EvidenceItem } from '../types'

/**
 * The ESC 2026 §5.2.2 criteria as three quiet rows, for the map's diagnosis
 * card (clinician feedback 2026-09-27: 「畫面太花」, and 「table 10 內容是什麼要
 * 能點開來被看到」).
 *
 * Each row says where its criterion stands with one small icon and a word, and
 * names what supports it — the Table 10 parameters by name and value, not a
 * count. A row with more behind it opens in place onto its own evidence rows,
 * each with the value and threshold the pack printed. No boxes, no tinted
 * backgrounds: the only colour is the state icon, and the icon's shape says
 * the same thing for a reader who cannot see the colour.
 */

const TABLE_OF: Readonly<Record<string, string>> = {
  'symptoms-signs': 'hfpef-symptoms-signs',
  lvef: 'hfpef-lvef-criterion',
  'objective-abnormality': 'hfpef-objective-abnormality',
}

/** 「LA enlargement（LAVI）」 → 「LAVI」: the short name a clinician reads a value by. */
function shortLabel(label: string): string {
  const inner = /（([^（）]+)）\s*$/.exec(label)?.[1]
  if (inner && /^[\x20-\x7E′]+$/.test(inner)) return inner
  return label.replace(/（病人自述）$/, '')
}

/** 「15；門檻 >9 at rest…」 → 「15」; 「680 pg/mL（2026-09-20）（…）」 → 「680 pg/mL」. */
function shortValue(value: string | undefined): string | undefined {
  const head = value?.split('；')[0]?.split('（')[0]?.trim()
  return head || undefined
}

function StateMark({ state, isEnglish }: { state: CriterionSummary['state'] | 'counted' | 'not-counted' | 'against' | 'none'; isEnglish: boolean }) {
  const words: Record<typeof state, string> = {
    met: isEnglish ? 'met' : '成立',
    counted: isEnglish ? 'supports' : '支持',
    'not-counted': isEnglish ? 'supports, switched off' : '支持（未計入）',
    refuted: isEnglish ? 'contradicted' : '有反證',
    against: isEnglish ? 'against' : '反對',
    undetermined: isEnglish ? 'to assess' : '待評估',
    none: isEnglish ? 'not recorded' : '未取得',
  }
  const icon = state === 'met' || state === 'counted' || state === 'not-counted'
    ? <Check className={cn('h-3.5 w-3.5', state === 'not-counted' ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300')} aria-hidden="true" />
    : state === 'refuted' || state === 'against'
      ? <X className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" aria-hidden="true" />
      : <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
  return (
    <span className="mt-0.5 inline-flex shrink-0" title={words[state]}>
      {icon}
      <span className="sr-only">{words[state]}</span>
    </span>
  )
}

function EvidenceRows({ items, isEnglish }: { items: readonly EvidenceItem[]; isEnglish: boolean }) {
  const pick = (item: EvidenceItem) => (isEnglish ? item.label.en : item.label.zh)
  const shown = items.filter((item) => item.direction !== 'unknown' || item.value)
  const absent = items.filter((item) => item.direction === 'unknown' && !item.value)
  return (
    <div className="mt-1 space-y-1 pb-1.5 pl-5" data-testid="cdss-hf-hfpef-criterion-evidence">
      <ul className="space-y-1">
        {shown.map((item) => (
          <li key={item.id} className="flex gap-1.5 text-[11px] leading-4" data-direction={item.direction}>
            <StateMark
              state={item.direction === 'supports' ? (item.defaultEnabled ? 'counted' : 'not-counted') : item.direction === 'against' ? 'against' : 'undetermined'}
              isEnglish={isEnglish}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{pick(item)}</span>
              {item.value ? <span className="text-muted-foreground">{isEnglish ? ': ' : '：'}{item.value}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {absent.length > 0 ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          {isEnglish ? 'Not recorded: ' : '未取得：'}
          {absent.map(pick).join(isEnglish ? ', ' : '、')}
        </p>
      ) : null}
    </div>
  )
}

export function HfpEfCriteriaList({
  summary,
  card,
  isEnglish,
  symptomsHint,
}: {
  summary: DiagnosticSummary
  card: CdssRecommendation
  isEnglish: boolean
  /** Where the symptoms and signs are answered on this page. */
  symptomsHint: string
}) {
  const tables = card.evidenceTables ?? []
  const met = summary.criteria.filter((criterion) => criterion.state === 'met').length
  return (
    <div className="space-y-1" data-testid="cdss-hf-hfpef-criteria">
      <p className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
        <span>{isEnglish ? 'HFpEF criteria (ESC 2026 §5.2.2)' : 'HFpEF 診斷條件（ESC 2026 §5.2.2）'}</span>
        <span className="tabular-nums" data-testid="cdss-hf-hfpef-criteria-count">
          {isEnglish ? `${met}/${summary.criteria.length} met` : `${met}/${summary.criteria.length} 成立`}
        </span>
      </p>
      <ul className="divide-y divide-border/60 border-y border-border/60">
        {summary.criteria.map((criterion) => {
          const items = tables.find((table) => table.concept === TABLE_OF[criterion.id])?.items ?? []
          const supporting = items.filter((item) => item.direction === 'supports' && item.defaultEnabled)
          const named = supporting
            .map((item) => [shortLabel(isEnglish ? item.label.en : item.label.zh), criterion.id === 'symptoms-signs' ? undefined : shortValue(item.value)].filter(Boolean).join(' '))
          const line = criterion.id === 'lvef'
            ? [shortValue(supporting[0]?.value ?? items[0]?.value), supporting[0]?.date ?? items[0]?.date].filter(Boolean).join(isEnglish ? ', ' : '，')
            : named.length > 0
              ? named.slice(0, 4).join('・') + (named.length > 4 ? (isEnglish ? ` +${named.length - 4}` : ` 等 ${named.length} 項`) : '')
              : criterion.id === 'symptoms-signs' ? symptomsHint : (isEnglish ? 'nothing recorded yet' : '尚無資料')
          // The symptoms and signs are ticked right below; the LVEF is one value.
          const opens = criterion.id === 'objective-abnormality' && items.length > 0
          const row = (
            <>
              <StateMark state={criterion.state} isEnglish={isEnglish} />
              <span className="shrink-0 font-medium text-foreground @min-[40rem]:w-[10.5rem]">{criterion.label}</span>
              <span className="min-w-0 flex-1 text-muted-foreground" data-testid={`cdss-hf-hfpef-criterion-line-${criterion.id}`}>{line}</span>
            </>
          )
          return (
            <li key={criterion.id} data-testid={`cdss-hf-hfpef-criterion-${criterion.id}`} data-state={criterion.state}>
              {opens ? (
                <details className="group">
                  <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-start gap-x-1.5 py-1.5 text-xs leading-5 [&::-webkit-details-marker]:hidden">
                    {row}
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary">
                      Table 10
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </span>
                  </summary>
                  <EvidenceRows items={items} isEnglish={isEnglish} />
                </details>
              ) : (
                <div className="flex min-h-9 flex-wrap items-start gap-x-1.5 py-1.5 text-xs leading-5">{row}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
