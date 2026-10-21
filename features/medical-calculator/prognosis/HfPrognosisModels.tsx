'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { tr } from '../types'
import { CALCULATORS } from '../calculators'
import { CalculatorDetail } from '../components/CalculatorDetail'
import { computeAutofilledResult, resolveInput } from '../autofill-compute'
import type { Autofill } from '../hooks/use-lab-autofill.hook'
import { useCalcFavorites } from '../hooks/use-calc-favorites.hook'
import { HF_PROGNOSIS_MODELS, type PrognosisEvidence, type HfPrognosisModelId } from './models'
import { PrognosisModelDetail } from './PrognosisModelDetail'

/** The LVEF the evidence carries, as a number, where it reads as one. */
function lvefOf(evidence: PrognosisEvidence): number | undefined {
  const value = Number.parseFloat(evidence.LVEF?.value ?? '')
  return Number.isFinite(value) ? value : undefined
}

/** The row's name: a model's acronym where its full name carries one (「…（SHFM）」). */
function rowName(name: string): string {
  return /（([^（）]+)）$/.exec(name)?.[1] ?? name
}

const CHIP = 'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground'

/**
 * The HF prognosis models, one line each, drawn as the decision map draws a
 * point (clinician feedback 2026-09-28: 「能幫我改一行式畫面，而且 UI 要符合
 * 決策地圖」): a bordered row with the model's name, what it predicts, where it
 * stands, and on the right what opening it gives — the whole row is the
 * button. A model the medical calculator already implements (MAGGIC,
 * LIFE-Preserved) opens that calculator, its inputs autofilled from the
 * patient's data (「醫療計算機明明有，直接複用就好」); the row shows the result
 * once the record fills every input, else how many inputs are still empty. The
 * others open their data checklist and references, and say their formula is
 * not connected yet.
 */
export function HfPrognosisModels({ locale, evidence = {}, autofill }: {
  locale: string
  evidence?: PrognosisEvidence
  /** The page's patient data, for a linked calculator's result or empty inputs on its row. */
  autofill?: Autofill
}) {
  const [selected, setSelected] = useState<HfPrognosisModelId | null>(null)
  const { isFavorite, toggleFavorite } = useCalcFavorites()
  const en = locale === 'en'
  const lvef = lvefOf(evidence)
  // LIFE-Preserved is an HFpEF model: not offered beside an LVEF below 50%.
  const models = HF_PROGNOSIS_MODELS.filter((item) => item.id !== 'life-preserved' || lvef === undefined || lvef >= 50)
  const model = models.find(item => item.id === selected)
  const calcOf = (calculatorId: string | undefined) => (calculatorId ? CALCULATORS.find((calc) => calc.id === calculatorId) : undefined)
  const selectedCalc = calcOf(model?.calculatorId)
  return <div data-testid="hf-prognosis-models" className="min-w-0 space-y-1.5">
    <ul className="space-y-1.5">
      {models.map(item => {
        const calc = calcOf(item.calculatorId)
        const computed = calc && autofill ? computeAutofilledResult(calc, autofill) : null
        const empty = calc && autofill
          ? calc.inputs.filter((input) => !(input.type === 'number' && input.optional) && !resolveInput(input, autofill).filled).length
          : undefined
        const status = computed ? (
          <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground" data-testid={`hf-prognosis-result-${item.id}`}>
            {computed.result.value}{computed.result.unit ? ` ${computed.result.unit}` : ''}
          </span>
        ) : (
          <span className={CHIP}>
            {!calc
              ? (en ? 'Formula pending' : '公式待串接')
              : empty
                ? (en ? `${empty} to fill` : `待填 ${empty} 項`)
                : empty === 0
                  ? (en ? 'To confirm' : '待確認')
                  : (en ? 'To fill' : '待填')}
          </span>
        )
        const title = [calc ? tr(locale, calc.name) : item.name, tr(locale, item.population), computed?.result.interpretation ? tr(locale, computed.result.interpretation) : '']
          .filter(Boolean).join(' · ')
        const opens = <>
          {calc ? (en ? 'Calculator' : '計算機') : (en ? 'Data & references' : '資料與引用')}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </>
        return <li key={item.id} className="min-w-0" data-testid={`hf-prognosis-model-${item.id}`}>
          <button
            type="button"
            onClick={() => setSelected(item.id)}
            title={title}
            className="flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            data-testid={`open-prognosis-calculator-${item.id}`}
          >
            <span className="max-w-[45%] shrink-0 truncate text-sm font-medium text-foreground">{rowName(item.name)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tr(locale, item.outcome)}</span>
            {status}
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">{opens}</span>
          </button>
        </li>
      })}
    </ul>
    <Dialog open={!!model} onOpenChange={open => { if (!open) setSelected(null) }}>
      {model ? <DialogContent className="@container max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selectedCalc ? tr(locale, selectedCalc.name) : model.name}</DialogTitle>
          <DialogDescription>{`${en ? 'Medical calculator · HF prognosis' : '醫學計算機・HF 預後'} · ${tr(locale, model.population)}`}</DialogDescription>
        </DialogHeader>
        {selectedCalc ? (
          <CalculatorDetail
            calc={selectedCalc}
            onBack={() => setSelected(null)}
            isFavorite={isFavorite(selectedCalc.id)}
            onToggleFavorite={() => toggleFavorite(selectedCalc.id)}
          />
        ) : (
          <PrognosisModelDetail model={model} evidence={evidence} locale={locale} />
        )}
      </DialogContent> : null}
    </Dialog>
  </div>
}
