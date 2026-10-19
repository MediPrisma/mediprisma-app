"use client"

import { useCallback, useMemo, useState } from 'react'
import { Calculator, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { CALCULATORS } from '@/features/medical-calculator/calculators'
import { CalculatorDetail } from '@/features/medical-calculator/components/CalculatorDetail'
import { computeAutofilledResult, resolveInput } from '@/features/medical-calculator/autofill-compute'
import { useLabAutofill } from '@/features/medical-calculator/hooks/use-lab-autofill.hook'
import { useCalcFavorites } from '@/features/medical-calculator/hooks/use-calc-favorites.hook'
import { HF_PROGNOSIS_MODELS, type HfPrognosisModelId, type PrognosisEvidence } from '@/features/medical-calculator/prognosis/models'
import { PrognosisModelDetail } from '@/features/medical-calculator/prognosis/PrognosisModelDetail'
import { tr, type CalcResult, type CalculatorDef } from '@/features/medical-calculator/types'
import type { DecisionPointView } from '../../types'
import type { VisitCalculatorNote } from '../../stores/visit-calculator-notes.store'
import { ABSENT_STATES } from './visit-decisions'
import styles from './VisitCalculators.module.css'

/**
 * One calculator the heart-failure guideline uses, and the decision point it
 * serves. `prognosis` names a model of the HF prognosis catalog — the ones
 * the calculator implements open it, the others their data checklist. `note`
 * marks the ones whose result may be attached to the point as a note.
 */
interface VisitCalculatorEntry {
  id: string
  dp: string
  /** The page the point belongs to, when not this one: DP-14 on the HF page is AF's. */
  source?: DecisionPointView['source']
  calculatorId?: string
  prognosis?: HfPrognosisModelId
  /** Shown only when the page has this point (AF's calculators, behind DP-14). */
  needsPoint?: boolean
  note?: boolean
}

/**
 * The heart-failure page's calculators, in the order of its chapters. Owner
 * decision 2026-10-19: one way in — the 「計算機」 button at the head of the
 * page — and the map itself stays as it is (「幫我留C就好」).
 */
export const HF_VISIT_CALCULATORS: readonly VisitCalculatorEntry[] = [
  { id: 'hfa-peff', dp: 'DP-34', calculatorId: 'hfa-peff' },
  { id: 'h2fpef', dp: 'DP-34', calculatorId: 'h2fpef' },
  { id: 'cha2ds2-va', dp: 'DP-14', source: 'af', calculatorId: 'cha2ds2-va', needsPoint: true },
  { id: 'crcl', dp: 'DP-14', source: 'af', calculatorId: 'crcl-cockcroft-gault', needsPoint: true },
  { id: 'has-bled', dp: 'DP-14', source: 'af', calculatorId: 'has-bled', needsPoint: true },
  { id: 'maggic', dp: 'DP-19', prognosis: 'maggic', note: true },
  { id: 'life-preserved', dp: 'DP-19', prognosis: 'life-preserved', note: true },
  { id: 'shfm', dp: 'DP-19', prognosis: 'shfm' },
  { id: 'gwtg-hf', dp: 'DP-19', prognosis: 'gwtg-hf' },
]

type RowStatus = 'computed' | 'to-fill' | 'to-confirm' | 'data-only' | 'not-applicable'

/** A model's acronym where its full name carries one (「…（SHFM）」). */
function shortName(name: string): string {
  return /（([^（）]+)）$/.exec(name)?.[1] ?? name
}

/** The line a note writes to the plan: the calculator, its result, its first two rows. */
export function calculatorNoteText(name: string, result: CalcResult, locale: string): string {
  const head = `${name} ${result.value}${result.unit ? ` ${result.unit}` : ''}`
  const rows = (result.extra ?? []).slice(0, 2).map((row) => `${tr(locale, row.label)} ${row.value}`)
  const partial = result.completeness?.complete === false ? (locale === 'zh-TW' ? '（部分輸入未填）' : ' (some inputs empty)') : ''
  return [head, ...rows].join(locale === 'zh-TW' ? '・' : ' · ') + partial
}

interface CalculatorRow {
  entry: VisitCalculatorEntry
  calc?: CalculatorDef
  model?: (typeof HF_PROGNOSIS_MODELS)[number]
  name: string
  /** A model with no formula connected: its status does not depend on the record. */
  fixed?: RowStatus
  chapter: string
}

/**
 * The list's rows with where each stands for this patient. Mounted only while
 * the list is open, so the record is read for it then and not on every draw
 * of the page.
 */
function CalculatorRows({ groups, isEnglish, onChoose }: {
  groups: readonly (readonly [string, readonly CalculatorRow[]])[]
  isEnglish: boolean
  onChoose: (row: CalculatorRow) => void
}) {
  const { autofill } = useLabAutofill()
  const statusOf = (row: CalculatorRow): { status: RowStatus; value?: string } => {
    if (row.fixed || !row.calc) return { status: row.fixed ?? 'data-only' }
    const computed = computeAutofilledResult(row.calc, autofill)
    if (computed) return { status: 'computed', value: `${computed.result.value}${computed.result.unit ? ` ${computed.result.unit}` : ''}` }
    const empty = row.calc.inputs.filter((input) => !(input.type === 'number' && input.optional) && !resolveInput(input, autofill).filled).length
    // Every input filled from the record, a judgement still the clinician's.
    return empty ? { status: 'to-fill', value: String(empty) } : { status: 'to-confirm' }
  }
  const statusWord = (status: RowStatus, value?: string) => {
    if (status === 'computed') return isEnglish ? 'Computed' : '已算'
    if (status === 'to-fill') return isEnglish ? `${value} to fill` : `待填 ${value}`
    if (status === 'to-confirm') return isEnglish ? 'To confirm' : '待確認'
    if (status === 'data-only') return isEnglish ? 'Data only' : '僅資料'
    return isEnglish ? 'Admission only' : '住院時適用'
  }
  return (
    <div className="max-h-[min(70dvh,560px)] overflow-y-auto pb-1">
      {groups.map(([chapter, items]) => (
        <section key={chapter} aria-label={chapter}>
          <h3 className="px-4 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{chapter}</h3>
          <ul>
            {items.map((row) => {
              const { status, value } = statusOf(row)
              return (
                <li key={row.entry.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(row)}
                    className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-border px-4 py-1.5 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${status === 'not-applicable' ? 'text-muted-foreground' : 'text-foreground'}`}
                    data-testid={`cdss-book-calculator-${row.entry.id}`}
                    data-status={status}
                  >
                    <span className="min-w-0 truncate">
                      {row.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">→ {row.entry.dp}</span>
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{status === 'computed' ? value : '—'}</span>
                    <span className={`whitespace-nowrap rounded px-1.5 text-xs ${status === 'computed' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : status === 'to-fill' || status === 'to-confirm' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
                      {statusWord(status, value)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function VisitCalculators({
  isEnglish,
  points,
  sourceOfPage,
  lvef,
  evidence = {},
  chapterOf,
  goTo,
  attached,
  onAttach,
}: {
  isEnglish: boolean
  points: readonly DecisionPointView[]
  sourceOfPage: DecisionPointView['source']
  /** The page's LVEF: LIFE-Preserved is offered only at 50% or above. */
  lvef?: number
  /** The record's values for a model whose formula is not connected. */
  evidence?: PrognosisEvidence
  /** The chapter a point sits in, for the list's groups. */
  chapterOf: (dp: string, source?: DecisionPointView['source']) => string | undefined
  /** Brings the point into view on the page. */
  goTo: (dp: string, source?: DecisionPointView['source']) => void
  /** The calculators already attached today. */
  attached: ReadonlySet<string>
  onAttach?: (note: Omit<VisitCalculatorNote, 'at'>) => void
}) {
  const locale = isEnglish ? 'en' : 'zh-TW'
  const { isFavorite, toggleFavorite } = useCalcFavorites()
  const [listOpen, setListOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<CalcResult | null>(null)

  const pointOf = useCallback((dp: string, source?: DecisionPointView['source']) => (
    points.find((point) => point.dp === dp && point.source === (source ?? sourceOfPage))
  ), [points, sourceOfPage])
  const rows = useMemo(() => HF_VISIT_CALCULATORS.flatMap((entry): CalculatorRow[] => {
    const point = pointOf(entry.dp, entry.source)
    if (entry.needsPoint && (!point || ABSENT_STATES.has(point.state))) return []
    if (entry.prognosis === 'life-preserved' && lvef !== undefined && lvef < 50) return []
    const model = entry.prognosis ? HF_PROGNOSIS_MODELS.find((item) => item.id === entry.prognosis) : undefined
    const calc: CalculatorDef | undefined = CALCULATORS.find((item) => item.id === (entry.calculatorId ?? model?.calculatorId))
    // A prognosis model by its own name (「MAGGIC」), not the calculator's longer one.
    const name = shortName(model?.name ?? (calc ? tr(locale, calc.name) : entry.id))
    // GWTG-HF reads the admission's values, never today's chart.
    const fixed: RowStatus | undefined = calc ? undefined : model?.setting === 'hf-admission' ? 'not-applicable' : 'data-only'
    return [{ entry, calc, model, name, fixed, chapter: chapterOf(entry.dp, entry.source) ?? (isEnglish ? 'Other' : '其他') }]
  }), [chapterOf, isEnglish, locale, lvef, pointOf])
  const groups = useMemo(() => {
    const byChapter = new Map<string, CalculatorRow[]>()
    for (const row of rows) byChapter.set(row.chapter, [...(byChapter.get(row.chapter) ?? []), row])
    return [...byChapter.entries()]
  }, [rows])

  const open = rows.find((row) => row.entry.id === selected)
  const choose = (row: CalculatorRow) => {
    setListOpen(false)
    setResult(null)
    goTo(row.entry.dp, row.entry.source)
    setSelected(row.entry.id)
  }
  const close = () => {
    setSelected(null)
    setResult(null)
  }
  const dpLabel = (entry: VisitCalculatorEntry) => pointOf(entry.dp, entry.source)?.label
  if (!rows.length) return null

  return (
    <>
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={styles.trigger}
            aria-label={isEnglish ? `Calculators, ${rows.length} available` : `計算機，${rows.length} 個可用`}
            data-testid="cdss-book-calculators"
          >
            <Calculator aria-hidden="true" className={styles.icon} />
            {isEnglish ? 'Calculators' : '計算機'}
            <span className={styles.count}>{rows.length}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          // Over the whole window the page is a layer of its own (z-index 60).
          className="z-[70] w-[min(440px,calc(100vw-2rem))] p-0"
          // Esc closes the list, not the whole-window page behind it.
          onEscapeKeyDown={(event) => { event.preventDefault(); setListOpen(false) }}
          data-testid="cdss-book-calculator-list"
        >
          <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
            <span className="text-sm font-semibold">{isEnglish ? 'Calculators for this patient' : '此病人可用的計算機'}</span>
            <span className="text-xs text-muted-foreground">{isEnglish ? 'By chapter' : '依章節排列'}</span>
          </div>
          <CalculatorRows groups={groups} isEnglish={isEnglish} onChoose={choose} />
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {isEnglish
              ? 'Opens the calculator beside its decision point. Scores never change a recommendation.'
              : '點一列：跳到該 DP 並開啟計算機。分數不改變指引建議。'}
          </p>
        </PopoverContent>
      </Popover>

      <Dialog open={Boolean(open)} onOpenChange={(next) => { if (!next) close() }}>
        {open ? (
          <DialogContent
            overlayClassName="z-[70]"
            onEscapeKeyDown={(event) => { event.preventDefault(); close() }}
            // A sheet from the bottom on a phone, a panel on the right beside the page from 768px.
            className="@container z-[70] top-auto right-0 bottom-0 left-0 flex max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-b-none rounded-t-xl p-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 md:top-0 md:left-auto md:h-dvh md:max-h-dvh md:w-[min(520px,100vw)] md:rounded-none"
            data-testid="cdss-book-calculator-panel"
          >
            <div className="border-b border-border px-5 pt-4 pb-3 pr-12">
              <DialogDescription className="text-xs">
                {open.entry.source && open.entry.source !== sourceOfPage ? `${open.entry.source.toUpperCase()} ` : ''}{open.entry.dp}{dpLabel(open.entry) ? ` ${dpLabel(open.entry)}` : ''}
              </DialogDescription>
              <DialogTitle className="text-lg">{open.calc ? tr(locale, open.calc.name) : open.model?.name}</DialogTitle>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {open.calc ? (
                <CalculatorDetail
                  calc={open.calc}
                  onBack={close}
                  isFavorite={isFavorite(open.calc.id)}
                  onToggleFavorite={() => toggleFavorite(open.calc!.id)}
                  onResult={setResult}
                  selectContentClassName="z-[80]"
                />
              ) : open.model ? (
                <PrognosisModelDetail model={open.model} evidence={evidence} locale={locale} />
              ) : null}
            </div>
            {open.entry.note && open.calc && onAttach ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <button
                  type="button"
                  disabled={!result}
                  onClick={() => {
                    if (!result || !open.calc) return
                    onAttach({ calculatorId: open.calc.id, dp: open.entry.dp, source: open.entry.source ?? sourceOfPage, text: calculatorNoteText(open.name, result, locale) })
                    close()
                  }}
                  className="inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
                  data-testid="cdss-book-calculator-attach"
                >
                  {attached.has(open.calc.id)
                    ? (isEnglish ? `Replace the note on ${open.entry.dp}` : `更新 ${open.entry.dp} 的附註`)
                    : (isEnglish ? `Attach to ${open.entry.dp}` : `附註到 ${open.entry.dp}`)}
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">
                  {isEnglish ? "A note in today's plan; the recommendation does not change." : '只附註在今天的計畫，不改變指引建議。'}
                </span>
              </div>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
