'use client'
/**
 * The hypertension page's two risk calculators as the 計算機 panel shows them
 * (plan 05 §19, owner 2026-11-03). Neither is the generic calculator form: the
 * host already computes both from the record and the PREVENT answers
 * (`applyHtnRiskReadings`), so the panel shows that reading — the figure
 * first, large, with its level — and lets the clinician complete the PREVENT
 * answers the pack's facts are built from. What is typed here is the same
 * store the lipid card's PREVENT 檢核 writes. Each panel hands its result up
 * (`onResult`) so it can be attached to today's plan the way the heart-failure
 * prognosis models are (owner 2026-11-03: 「資料要能夠回寫，按照和心衰竭模型
 * 同樣的模式」).
 */
import { createContext, useContext, useEffect } from 'react'
import { HpaRiskResults } from '@/features/medical-calculator/components/HpaRiskResults'
import type { CalcResult } from '@/features/medical-calculator/types'
import { PreventFieldsEditor, PreventReadingContext } from '../PreventRiskSummary'
import { usePreventStore } from '../../stores/prevent-inputs.store'
import type { HpaReading } from '../../utils/htn-risk-readings'
import type { PreventReading } from '../../utils/prevent-reading'

export const HpaReadingContext = createContext<HpaReading | undefined>(undefined)

const LEVEL_WORDS = {
  low: { zh: '低風險', en: 'Low risk', tone: 'text-emerald-700 dark:text-emerald-400', badge: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
  moderate: { zh: '中風險', en: 'Moderate risk', tone: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
  high: { zh: '高風險', en: 'High risk', tone: 'text-red-700 dark:text-red-400', badge: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' },
} as const

/** The figure first: large, with what it is and the level beside it. */
function Headline({ caption, value, unit, badge, tone, note, testId }: {
  caption: string
  value: string
  unit?: string
  badge?: { text: string; className: string }
  tone?: string
  note?: string
  testId: string
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3" role="status" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{caption}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`text-4xl font-semibold tabular-nums leading-none ${tone ?? 'text-foreground'}`}>
          {value}{unit ? <span className="ml-0.5 text-xl font-medium">{unit}</span> : null}
        </span>
        {badge ? <span className={`rounded px-2 py-0.5 text-sm font-semibold ${badge.className}`}>{badge.text}</span> : null}
      </p>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
    </div>
  )
}

/** The note a PREVENT reading attaches to the plan, or null while there is no result. */
export function preventCalcResult(reading: PreventReading): CalcResult | null {
  const result = reading.result
  if (result.status !== 'ready' || result.risk10 === undefined) return null
  return {
    numericValue: result.risk10,
    value: result.risk10.toFixed(1),
    unit: '%',
    interpretation: { zh: '10 年 ASCVD（PREVENT 基礎模型）', en: '10-year ASCVD (PREVENT base model)' },
    extra: [{ label: { zh: '30 年 ASCVD', en: '30-year ASCVD' }, value: result.risk30 === undefined ? '—' : `${result.risk30.toFixed(1)}%` }],
  }
}

/** The note an HPA reading attaches to the plan, or null while MACE is not estimated. */
export function hpaCalcResult(reading: HpaReading): CalcResult | null {
  const mace = reading.mace
  if (!mace || mace.status !== 'estimated' || mace.risk === undefined || !mace.level) return null
  const level = LEVEL_WORDS[mace.level]
  return {
    numericValue: mace.risk,
    value: String(mace.risk),
    unit: '%',
    interpretation: { zh: `10 年重大心血管事件（MACE）${level.zh}`, en: `10-year MACE, ${level.en.toLowerCase()}` },
    severity: mace.level,
    extra: [{ label: { zh: '模型', en: 'Model' }, value: '國健署心血管風險預測公式（本地重建版）' }],
  }
}

/** PREVENT at DP-08: the ASCVD result the pack shows, and the inputs behind it. */
export function PreventVisitPanel({ isEnglish, onResult }: { isEnglish: boolean; onResult?: (result: CalcResult | null) => void }) {
  const reading = useContext(PreventReadingContext)
  const patientId = usePreventStore((state) => state.patientId)
  const locale = isEnglish ? 'en' : 'zh-TW'
  useEffect(() => { onResult?.(reading ? preventCalcResult(reading) : null) }, [onResult, reading])
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read PREVENT from.' : '沒有可供 PREVENT 讀取的病歷。'}</p>
  const result = reading.result
  const issues = result.issues.map((key) => reading.fields.find((field) => field.input.key === key)?.input.label[isEnglish ? 'en' : 'zh'] ?? key).join(isEnglish ? ', ' : '、')
  return (
    <section className="space-y-3" data-testid="cdss-htn-prevent-panel">
      {result.status === 'ready' ? (
        <Headline
          testId="cdss-htn-prevent-headline"
          caption={isEnglish ? '10-year ASCVD risk (PREVENT base model)' : '10 年 ASCVD 風險（PREVENT 基礎模型）'}
          value={result.risk10!.toFixed(1)}
          unit="%"
          tone="text-primary"
          {...(result.risk30 !== undefined ? { note: isEnglish ? `30-year ASCVD ${result.risk30.toFixed(1)}%` : `30 年 ASCVD ${result.risk30.toFixed(1)}%` } : {})}
        />
      ) : (
        <Headline
          testId="cdss-htn-prevent-headline"
          caption={isEnglish ? '10-year ASCVD risk (PREVENT base model)' : '10 年 ASCVD 風險（PREVENT 基礎模型）'}
          value="—"
          note={result.status === 'ineligible'
            ? (isEnglish ? `Not applicable: ${issues}. The model is for primary prevention.` : `不適用：${issues}。此模型只用於初級預防。`)
            : (isEnglish ? `To confirm: ${issues}. No result reaches the pack until then.` : `待核對：${issues}。核對完成前不會把結果交給規則。`)}
        />
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'The base model ends at ASCVD (Khan 2024 Table S12). The AHA 2025 threshold of 7.5% reads total CVD, which this host does not compute yet, so the pack shows this value and reads no threshold from it. The history answers below also feed the HPA cardiovascular risk prediction.'
          : '基礎模型的終點是 ASCVD（Khan 2024 Table S12）；AHA 2025 的 7.5% 門檻讀的是 total CVD，本系統尚未接入，所以規則只顯示此值、不以它判定門檻。下方的病史回答同時供國健署心血管風險預測公式使用。'}
      </p>
      <PreventFieldsEditor reading={reading} locale={locale} {...(patientId ? { patientId } : {})} />
    </section>
  )
}

const SOURCE_WORDS = {
  physician: { zh: '醫師填', en: 'physician' },
  record: { zh: '病歷', en: 'record' },
  none: { zh: '未填', en: 'empty' },
} as const

/** 國健署心血管風險預測公式 at DP-08: the MACE estimate first, the five outcomes under it. */
export function HpaVisitPanel({ isEnglish, onResult }: { isEnglish: boolean; onResult?: (result: CalcResult | null) => void }) {
  const reading = useContext(HpaReadingContext)
  useEffect(() => { onResult?.(reading ? hpaCalcResult(reading) : null) }, [onResult, reading])
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read the HPA model from.' : '沒有可供國健署模型讀取的病歷。'}</p>
  const mace = reading.mace
  const level = mace?.level ? LEVEL_WORDS[mace.level] : undefined
  const why = !mace ? ''
    : mace.status === 'existing' ? (isEnglish ? 'Not applicable: prior coronary disease or stroke; the model estimates first events.' : '不適用：已有冠心病或中風，此模型估計的是首次事件。')
      : mace.status === 'outside' ? (isEnglish ? `Not applicable: ${(mace.outside ?? []).join(', ')} outside the model's range (35–70 years).` : `不適用：${(mace.outside ?? []).map((key) => ({ age: '年齡', sbp: '收縮壓' })[key] ?? key).join('、')}超出模型範圍（35–70 歲）。`)
        : mace.status === 'missing' ? (isEnglish ? `To fill: ${(mace.missing ?? []).join(', ')}.` : `待填：${(mace.missing ?? []).map((key) => reading.fields.find((field) => field.key === key)?.label.zh ?? key).join('、')}。`)
          : ''
  return (
    <section className="space-y-3" data-testid="cdss-htn-hpa-panel">
      <Headline
        testId="cdss-htn-hpa-headline"
        caption={isEnglish ? '10-year major cardiovascular event (MACE) risk' : '10 年重大心血管事件（MACE）風險'}
        value={mace?.status === 'estimated' && mace.risk !== undefined ? String(mace.risk) : '—'}
        {...(mace?.status === 'estimated' ? { unit: '%' } : {})}
        {...(level ? { tone: level.tone, badge: { text: isEnglish ? level.en : level.zh, className: level.badge } } : {})}
        {...(mace?.status === 'estimated'
          ? (mace.nearBoundary ? { note: isEnglish ? 'Close to a grade boundary; the grade is uncertain.' : '接近分級界線，等級不確定。' } : {})
          : { note: why || (isEnglish ? 'MACE not estimated for these inputs.' : 'MACE 目前無法估計。') })}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'HPA cardiovascular risk prediction, reconstructed locally (not the official coefficients); 35–70 years, no prior coronary disease or stroke. The pack shows the MACE estimate as a Taiwanese reference and reads no threshold from it. History fields come from the PREVENT answers (open PREVENT to change them); measurements come from the record.'
          : '國健署心血管風險預測公式的本地重建版（非官方係數）；適用 35–70 歲、無既往冠心病或中風。規則只把 MACE 當台灣族群參考顯示，不以它判定門檻。病史欄位來自 PREVENT 的回答（要改請開 PREVENT），量測值來自病歷。'}
      </p>
      <HpaRiskResults values={reading.values} locale={isEnglish ? 'en' : 'zh-TW'} />
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-primary">{isEnglish ? 'Inputs read' : '讀到的輸入'}</summary>
        <ul className="grid gap-1 text-xs text-muted-foreground @min-[40rem]:grid-cols-2">
          {reading.fields.map((field) => (
            <li key={field.key}>
              {field.label[isEnglish ? 'en' : 'zh']}：{field.value || '—'}{field.unit && field.value ? ` ${field.unit}` : ''}
              {' · '}{SOURCE_WORDS[field.source][isEnglish ? 'en' : 'zh']}{field.date ? ` · ${field.date.slice(0, 10)}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
