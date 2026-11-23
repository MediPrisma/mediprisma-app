"use client"

import { ScoreInterpretation } from '@/features/medical-calculator/components/ScoreInterpretation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  todayIsoDate,
} from '../stores/clinic-vitals.store'
import type { HfpefInputsPatch } from '../stores/hfpef-inputs.store'
import type {
  HfpefDerivedIndices,
  HfpefInputReading,
  HfpefReading,
  HfpefScoreId,
  HfpefScoreReading,
  HfpefSection,
} from '../utils/hfpef-scores'

/**
 * 補完心超數值: the calculator's own inputs, and what each one came from.
 *
 * The report is the first source and the clinician the second, which is the
 * order this dialog shows them in: every row states where its number came from
 * and when it was measured, so a value nobody can trace is never among them.
 * What the clinician types is applied to this patient's record of typed values
 * and recomputes the scores and criterion (iii) — it is not written to the
 * chart, and an unchanged row writes nothing at all.
 */

const SECTION_LABELS: Readonly<Record<HfpefSection, { zh: string; en: string }>> = {
  functional: { zh: 'Functional（功能）', en: 'Functional' },
  morphological: { zh: 'Morphological（結構）', en: 'Morphological' },
  biomarker: { zh: 'Biomarker（生物標記）', en: 'Biomarker' },
  clinical: { zh: '臨床', en: 'Clinical' },
}

/** Which inputs each tab shows, in the order the guideline reads them. */
const TAB_SECTIONS: Readonly<Record<HfpefScoreId, readonly HfpefSection[]>> = {
  'hfa-peff': ['functional', 'morphological', 'biomarker'],
  h2fpef: ['clinical', 'functional'],
}

const TAB_KEYS: Readonly<Record<HfpefScoreId, readonly string[]>> = {
  'hfa-peff': ['averageEe', 'e', 'septalE', 'lateralE', 'trv', 'gls', 'lavi', 'laVolume', 'lvmi', 'lvMass', 'height', 'weight', 'rwt', 'wall', 'rhythm', 'ntprobnp', 'bnp'],
  h2fpef: ['bmi', 'age', 'af', 'antihypertensives', 'ee', 'pasp'],
}

/** What a select's stored value reads as. */
/** What a derived index was computed from, for the row and the summary. */
const DERIVED_BASIS: Readonly<Record<'lavi' | 'lvmi', { zh: string; en: string }>> = {
  lavi: { zh: 'LA 容積÷BSA', en: 'LA volume ÷ BSA' },
  lvmi: { zh: 'LV 質量÷BSA', en: 'LV mass ÷ BSA' },
}

function derivedFor(key: string, derived: HfpefDerivedIndices | undefined): string | undefined {
  return key === 'lavi' || key === 'lvmi' ? derived?.[key] : undefined
}

const SELECT_TEXT: Readonly<Record<string, { zh: string; en: string }>> = {
  sr: { zh: '竇性', en: 'Sinus' },
  af: { zh: '心房顫動', en: 'Atrial fibrillation' },
  yes: { zh: '是', en: 'Yes' },
  no: { zh: '否', en: 'No' },
}


function SourceChip({
  reading,
  isEnglish,
  derived,
  onOrderNtProBnp,
}: {
  reading: HfpefInputReading
  isEnglish: boolean
  /** The index the calculator scored from body size, when none was stated. */
  derived?: string
  onOrderNtProBnp?: () => void
}) {
  if (reading.value === undefined && derived && (reading.key === 'lavi' || reading.key === 'lvmi')) {
    const basis = DERIVED_BASIS[reading.key]
    return (
      <span className="flex flex-wrap items-center gap-1.5" data-testid={`cdss-hf-hfpef-derived-${reading.key}`}>
        <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
          {isEnglish ? 'Derived' : '推算'}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {isEnglish
            ? `Not stated in the report; derived from ${basis.en}: ${derived}`
            : `報告未直接提供，已由 ${basis.zh} 推算：${derived}`}
        </span>
      </span>
    )
  }
  if (reading.value === undefined) {
    // A laboratory value nobody has drawn is ordered, not typed; an echo
    // parameter the report did not print is simply not there.
    const isLab = reading.key === 'ntprobnp' || reading.key === 'bnp'
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
          {isLab
            ? (isEnglish ? 'No value in the record' : '紀錄無值')
            : (isEnglish ? 'Not reported' : '報告未提供')}
        </span>
        {isLab && onOrderNtProBnp ? (
          <button
            type="button"
            className="min-h-7 rounded-md px-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOrderNtProBnp}
            data-testid="cdss-hf-hfpef-order-ntprobnp"
          >
            {isEnglish ? 'Order it under today’s actions →' : '在今日處置開單 →'}
          </button>
        ) : null}
      </span>
    )
  }
  const entered = reading.origin === 'physician'
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'rounded px-1.5 py-px text-[11px]',
          entered
            ? 'bg-primary/10 font-medium text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {entered
          ? (isEnglish ? 'Entered by you' : '你輸入')
          : (isEnglish ? 'Auto-filled' : '自動帶入')}
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {(isEnglish ? reading.sourceEn : reading.sourceZh) ?? ''}
        {reading.derivationZh ?? ''}
      </span>
    </span>
  )
}

function ScoreSummary({
  score,
  isEnglish,
}: {
  score: HfpefScoreReading | undefined
  isEnglish: boolean
}) {
  if (!score) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="cdss-hf-hfpef-score-none">
        {isEnglish
          ? 'Not enough inputs for the calculator to score.'
          : '目前的輸入不足，計算機無法計分。'}
      </p>
    )
  }
  const headroom = score.upper - score.score
  return (
    <div data-testid={`cdss-hf-hfpef-dialog-score-${score.id}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold text-foreground">{score.name}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {score.upper > score.score ? `${score.score}–${score.upper}` : score.score}
          {isEnglish ? '/' : '／'}
          {score.maximum}
        </span>
        <span className="text-xs text-muted-foreground">
          {isEnglish ? score.bandEn : score.bandZh}
        </span>
      </p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        {score.components
          .map((part) => `${isEnglish ? part.en : part.zh} ${part.detail}`)
          .join(' · ')}
      </p>
      {score.missing.length > 0 ? (
        <p
          className="mt-0.5 text-[11px] leading-4 text-amber-800 dark:text-amber-300"
          data-testid={`cdss-hf-hfpef-dialog-missing-${score.id}`}
        >
          {isEnglish
            ? `Not reported: ${score.missingEn.join(', ')} — at most +${headroom} more; a missing item can only raise the score.`
            : `報告未提供：${score.missingZh.join('、')}：最多再 +${headroom}，缺項只會讓分數更高`}
        </p>
      ) : null}
      {score.derived ? (
        <p
          className="mt-0.5 text-[11px] leading-4 text-muted-foreground"
          data-testid={`cdss-hf-hfpef-dialog-derived-${score.id}`}
        >
          {isEnglish
            ? `Not stated in the report, derived for scoring: ${[
              score.derived.lavi ? `LAVI ${score.derived.lavi} (${DERIVED_BASIS.lavi.en})` : '',
              score.derived.lvmi ? `LVMI ${score.derived.lvmi} (${DERIVED_BASIS.lvmi.en})` : '',
              score.derived.bsa ? `BSA ${score.derived.bsa} (Du Bois, height and weight)` : '',
            ].filter(Boolean).join(', ')}`
            : `報告未直接提供，已推算計分：${[
              score.derived.lavi ? `LAVI ${score.derived.lavi}（${DERIVED_BASIS.lavi.zh}）` : '',
              score.derived.lvmi ? `LVMI ${score.derived.lvmi}（${DERIVED_BASIS.lvmi.zh}）` : '',
              score.derived.bsa ? `BSA ${score.derived.bsa}（Du Bois，身高、體重）` : '',
            ].filter(Boolean).join('、')}`}
        </p>
      ) : null}
      <ScoreInterpretation result={score} isEnglish={isEnglish} />
    </div>
  )
}

export interface HfpefInputsDialogProps {
  initialTab?: HfpefScoreId
  open: boolean
  onOpenChange: (open: boolean) => void
  reading: HfpefReading
  isEnglish: boolean
  now: Date
  onApply: (patch: HfpefInputsPatch) => void
  /** Takes the reader to the row that orders an NT-proBNP, where there is one. */
  onOrderNtProBnp?: () => void
}

export function HfpefInputsDialog({
  initialTab = 'hfa-peff',
  open,
  onOpenChange,
  reading,
  isEnglish,
  now,
  onApply,
  onOrderNtProBnp,
}: HfpefInputsDialogProps) {
  const [tab, setTab] = useState<HfpefScoreId>(initialTab)
  // A draft, keyed by input: only what the reader changes is applied, so an
  // auto-filled value stays the report's and never becomes 「你輸入」.
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({})

  const byKey = new Map(reading.inputs.map((item) => [item.key, item]))
  const rowsFor = (section: HfpefSection) => TAB_KEYS[tab]
    .map((key) => byKey.get(key))
    .filter((item): item is HfpefInputReading => Boolean(item) && item!.section === section)

  const close = () => {
    setDraft({})
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className="max-w-[44rem] gap-3 p-4"
        data-testid="cdss-hf-hfpef-dialog"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">
            {isEnglish ? 'Complete the echo values' : '補完心超數值'}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-4">
            {isEnglish
              ? 'Auto-filled values come from the latest echocardiography and ECG reports; anything you change is marked 「entered by you」 and dated.'
              : '自動帶入的值來自最新一份心超與 ECG 報告；你改過的會標「你輸入」並記日期。'}
          </DialogDescription>
        </DialogHeader>

        <div
          className="inline-flex w-fit rounded-md border border-border bg-muted/30 p-0.5"
          role="group"
          aria-label={isEnglish ? 'Choose a score' : '選擇分數'}
        >
          {(['hfa-peff', 'h2fpef'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              className={cn(
                'inline-flex min-h-8 items-center rounded px-2.5 text-xs font-medium transition-colors',
                tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setTab(id)}
              data-testid={`cdss-hf-hfpef-tab-${id}`}
            >
              {id === 'hfa-peff' ? 'HFA-PEFF（0–6）' : 'H₂FPEF（0–9）'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {TAB_SECTIONS[tab].map((section) => {
            const rows = rowsFor(section)
            if (rows.length === 0) return null
            return (
              <section key={section} data-testid={`cdss-hf-hfpef-section-${section}`}>
                <h4 className="border-b border-border pb-1 text-[11px] font-semibold text-muted-foreground">
                  {isEnglish ? SECTION_LABELS[section].en : SECTION_LABELS[section].zh}
                </h4>
                <ul className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <li
                      key={row.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                      data-testid={`cdss-hf-hfpef-row-${row.key}`}
                      data-origin={row.origin}
                    >
                      <span className="w-[11rem] shrink-0 text-xs text-foreground">
                        {isEnglish ? row.en : row.zh}
                        {row.unit ? (
                          <span className="ml-1 text-[11px] text-muted-foreground">{row.unit}</span>
                        ) : null}
                      </span>
                      {['rhythm', 'af', 'antihypertensives', 'sex'].includes(row.key) ? <select className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm" aria-label={isEnglish ? row.en : row.zh} value={draft[row.key] ?? row.value ?? ''} onChange={event => setDraft(current => ({ ...current, [row.key]: event.target.value }))} data-testid={`cdss-hf-hfpef-input-${row.key}`}>
                        <option value="">{isEnglish ? 'Not assessed' : '未評估'}</option>
                        {(row.key === 'rhythm' ? ['sr', 'af'] : row.key === 'sex' ? ['male', 'female'] : ['yes', 'no']).map(value => <option key={value} value={value}>{SELECT_TEXT[value] ? (isEnglish ? SELECT_TEXT[value].en : SELECT_TEXT[value].zh) : value}</option>)}
                      </select> : (
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          className="h-8 w-24 px-2 text-sm tabular-nums md:text-sm"
                          aria-label={isEnglish ? row.en : row.zh}
                          placeholder={row.value ?? '—'}
                          value={draft[row.key] ?? row.value ?? ''}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            [row.key]: event.target.value,
                          }))}
                          data-testid={`cdss-hf-hfpef-input-${row.key}`}
                        />
                      )}
                      <button type="button" className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setDraft(current => ({ ...current, [row.key]: '' }))}>{isEnglish ? 'Restore default' : '恢復預設'}</button>
                      <SourceChip
                        reading={row}
                        isEnglish={isEnglish}
                        derived={tab === 'hfa-peff' ? derivedFor(row.key, reading.hfaPeff?.derived) : undefined}
                        onOrderNtProBnp={onOrderNtProBnp
                          ? () => { close(); onOrderNtProBnp() }
                          : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        <div className="rounded-md border border-border bg-muted/[0.12] px-2.5 py-2">
          <ScoreSummary
            score={tab === 'hfa-peff' ? reading.hfaPeff : reading.h2fpef}
            isEnglish={isEnglish}
          />
        </div>

        <p className="text-[11px] leading-4 text-muted-foreground">
          {isEnglish
            ? `Applying writes the value, its source and its date to this patient's record of entered values; the HFpEF card's scores and criterion (iii) recompute from them. Nothing is written to the chart.`
            : '套用後寫進此病人的輸入紀錄（值、來源、日期），HFpEF 卡的分數與條件 (iii) 一起重算；不寫回病歷。'}
        </p>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={close}
            data-testid="cdss-hf-hfpef-dialog-cancel"
          >
            {isEnglish ? 'Cancel' : '取消'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={() => {
              const measuredOn = todayIsoDate(now)
              const patch: Record<string, { value: string; measuredOn?: string } | null> = {}
              for (const [key, value] of Object.entries(draft)) {
                const trimmed = value.trim()
                // An emptied box withdraws the entry: the report's value stands
                // again rather than the box recording a blank of its own.
                patch[key] = trimmed ? { value: trimmed, measuredOn } : null
              }
              onApply(patch)
              close()
            }}
            data-testid="cdss-hf-hfpef-dialog-apply"
          >
            {isEnglish ? 'Apply to the reading' : '套用到判定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
