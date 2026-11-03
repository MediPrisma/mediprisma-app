'use client'
/**
 * The hypertension page's risk calculators as the 計算機 panel shows them (plan
 * 05 §19, owner 2026-11-03). None is the generic calculator form: the host
 * computes PREVENT, the ACC/AHA Pooled Cohort Equations and the HPA (國健署)
 * reconstruction from one shared set of inputs (`buildRiskInputs`: record,
 * ICD codes, the host's rules, today's answers, the clinician's entries), so
 * each panel shows that reading — the figure first, large, with its level —
 * and the 共用輸入 panel lets the clinician confirm or change every input once
 * for all three (owner: 「提供一個 common 的輸入面板…套用多項公式」). What is typed
 * here is the same store the lipid card's PREVENT 檢核 writes. Each result
 * panel hands its result up (`onResult`) so it can be attached to today's
 * plan the way the heart-failure prognosis models are.
 */
import { createContext, useContext, useEffect } from 'react'
import { HpaRiskResults } from '@/features/medical-calculator/components/HpaRiskResults'
import type { CalcResult } from '@/features/medical-calculator/types'
import { PreventFieldsEditor, PreventReadingContext, RiskFieldsEditor } from '../PreventRiskSummary'
import { usePreventStore } from '../../stores/prevent-inputs.store'
import type { HpaReading, PceReading } from '../../utils/htn-risk-readings'
import type { PreventReading } from '../../utils/prevent-reading'
import { RISK_FIELD_GROUPS } from '../../utils/risk-inputs'

export const HpaReadingContext = createContext<HpaReading | undefined>(undefined)
export const PceReadingContext = createContext<PceReading | undefined>(undefined)

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

/** The 2018 ACC/AHA cholesterol-guideline band of a PCE result. */
function pceBand(risk: number) {
  return risk < 5 ? { zh: '低風險（<5%）', en: 'Low (<5%)', level: 'low' as const }
    : risk < 7.5 ? { zh: '邊緣風險（5–<7.5%）', en: 'Borderline (5–<7.5%)', level: 'moderate' as const }
      : risk < 20 ? { zh: '中等風險（7.5–<20%）', en: 'Intermediate (7.5–<20%)', level: 'moderate' as const }
        : { zh: '高風險（≥20%）', en: 'High (≥20%)', level: 'high' as const }
}

/** The note a PCE reading attaches to the plan, or null while there is no result. */
export function pceCalcResult(reading: PceReading): CalcResult | null {
  const result = reading.result
  if (result.status !== 'ready' || result.risk10 === undefined) return null
  const band = pceBand(result.risk10)
  return {
    numericValue: result.risk10,
    value: result.risk10.toFixed(1),
    unit: '%',
    interpretation: { zh: `10 年 ASCVD（ACC/AHA Pooled Cohort，${band.zh}）`, en: `10-year ASCVD (ACC/AHA Pooled Cohort, ${band.en.toLowerCase()})` },
    severity: band.level,
    extra: [{ label: { zh: '使用係數', en: 'Equations' }, value: result.equations === 'aa' ? 'African American' : 'White' }],
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
          ? 'The base model ends at ASCVD (Khan 2024 Table S12). The AHA 2025 threshold of 7.5% reads total CVD, which this host does not compute yet, so the pack reads the ASCVD figure one-sidedly: 7.5% or more counts as increased risk, less excludes nothing. The inputs below are shared with the Pooled Cohort Equations and the HPA cardiovascular risk prediction.'
          : '基礎模型的終點是 ASCVD（Khan 2024 Table S12）；AHA 2025 的 7.5% 門檻讀的是 total CVD，本系統尚未接入，所以規則以單向方式讀此值：≥7.5% 視為 increased risk，未達不排除。下方的輸入與 Pooled Cohort 方程式、國健署心血管風險預測公式共用。'}
      </p>
      <PreventFieldsEditor reading={reading} locale={locale} {...(patientId ? { patientId } : {})} />
    </section>
  )
}

/** The ACC/AHA Pooled Cohort Equations at DP-08: a reference beside PREVENT. */
export function PceVisitPanel({ isEnglish, onResult }: { isEnglish: boolean; onResult?: (result: CalcResult | null) => void }) {
  const reading = useContext(PceReadingContext)
  const patientId = usePreventStore((state) => state.patientId)
  const locale = isEnglish ? 'en' : 'zh-TW'
  useEffect(() => { onResult?.(reading ? pceCalcResult(reading) : null) }, [onResult, reading])
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read the Pooled Cohort Equations from.' : '沒有可供 Pooled Cohort 方程式讀取的病歷。'}</p>
  const result = reading.result
  const issues = result.issues.map((key) => reading.fields.find((field) => field.input.key === key)?.input.label[isEnglish ? 'en' : 'zh'] ?? key).join(isEnglish ? ', ' : '、')
  const band = result.status === 'ready' && result.risk10 !== undefined ? pceBand(result.risk10) : undefined
  const level = band ? LEVEL_WORDS[band.level] : undefined
  return (
    <section className="space-y-3" data-testid="cdss-htn-pce-panel">
      <Headline
        testId="cdss-htn-pce-headline"
        caption={isEnglish ? '10-year hard ASCVD risk (2013 ACC/AHA Pooled Cohort Equations)' : '10 年 hard ASCVD 風險（2013 ACC/AHA Pooled Cohort 方程式）'}
        value={result.status === 'ready' && result.risk10 !== undefined ? result.risk10.toFixed(1) : '—'}
        {...(result.status === 'ready' ? { unit: '%' } : {})}
        {...(band && level ? { tone: level.tone, badge: { text: isEnglish ? band.en : band.zh, className: level.badge } } : {})}
        {...(result.status === 'ready'
          ? { note: isEnglish ? `${result.equations === 'aa' ? 'African American' : 'White'} equations` : `使用${result.equations === 'aa' ? '非裔美國人' : '白人'}係數` }
          : { note: result.status === 'ineligible'
            ? (isEnglish ? `Not applicable: ${issues}. The equations are for primary prevention at 40–79.` : `不適用：${issues}。方程式只用於 40–79 歲初級預防。`)
            : (isEnglish ? `To confirm: ${issues}.` : `待核對：${issues}。`) })}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'Goff 2013 Appendix 7 Table A; the bands are the 2018 ACC/AHA cholesterol guideline\'s (<5, 5–7.5, 7.5–20, ≥20%). Published for White and African American adults only: Taiwanese patients default to 「other」 and are read with the White equations, which have overestimated risk in Asian cohorts. The pack shows the figure beside PREVENT and reads no threshold from it. The inputs are the shared ones (open 共用輸入 to confirm them).'
          : 'Goff 2013 附錄 7 Table A；風險帶依 2018 ACC/AHA 血脂指引（<5、5–7.5、7.5–20、≥20%）。只發表白人與非裔美國人係數：台灣病人預設「其他族裔」、以白人係數估算，亞裔族群曾報告高估。規則只把數字與 PREVENT 並列顯示，不以它判定門檻。輸入即共用輸入（要核對請開「共用輸入」）。'}
      </p>
      <RiskFieldsEditor fields={reading.fields} locale={locale} {...(patientId ? { patientId } : {})} />
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
          ? 'HPA cardiovascular risk prediction, reconstructed locally (not the official coefficients); 35–70 years, no prior coronary disease or stroke. The pack shows the MACE estimate as a Taiwanese reference; a grade of high opens the SBP <120 choice at DP-09 as this pack\'s operational definition. Every input is a shared one (open 共用輸入 to change it).'
          : '國健署心血管風險預測公式的本地重建版（非官方係數）；適用 35–70 歲、無既往冠心病或中風。規則把 MACE 當台灣族群參考顯示；等級「高」時 DP-09 開放 SBP <120 選項（本 pack 操作定義）。所有輸入都是共用輸入（要改請開「共用輸入」）。'}
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

/** One line per calculator: its figure, or what keeps it from one. */
function CalculatorStanding({ isEnglish }: { isEnglish: boolean }) {
  const prevent = useContext(PreventReadingContext)
  const pce = useContext(PceReadingContext)
  const hpa = useContext(HpaReadingContext)
  const word = (status: string, issues: readonly string[], ready: string | undefined) => {
    if (ready) return ready
    if (status === 'ineligible' || status === 'existing' || status === 'outside') return isEnglish ? 'not applicable' : '不適用'
    if (status === 'needs-data' || status === 'missing') return isEnglish ? `${issues.length} to confirm` : `待核對 ${issues.length} 項`
    return isEnglish ? 'to confirm' : '待核對'
  }
  const rows = [
    { id: 'prevent', name: 'PREVENT-ASCVD', value: prevent ? word(prevent.result.status, prevent.result.issues, prevent.result.status === 'ready' && prevent.result.risk10 !== undefined ? `${prevent.result.risk10.toFixed(1)}%` : undefined) : '—' },
    { id: 'pce', name: 'ACC/AHA PCE', value: pce ? word(pce.result.status, pce.result.issues, pce.result.status === 'ready' && pce.result.risk10 !== undefined ? `${pce.result.risk10.toFixed(1)}%` : undefined) : '—' },
    { id: 'hpa', name: isEnglish ? 'HPA MACE' : '國健署 MACE', value: hpa?.mace ? word(hpa.mace.status, hpa.mace.missing ?? [], hpa.mace.status === 'estimated' && hpa.mace.risk !== undefined ? `${hpa.mace.risk}%${hpa.mace.level ? (isEnglish ? ` ${hpa.mace.level}` : `（${LEVEL_WORDS[hpa.mace.level].zh.slice(0, 1)}）`) : ''}` : undefined) : '—' },
  ]
  return (
    <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm" data-testid="cdss-htn-risk-standing">
      {rows.map((row) => (
        <div key={row.id} className="min-w-0">
          <dt className="truncate text-xs font-medium text-muted-foreground">{row.name}</dt>
          <dd className="font-semibold tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The 共用輸入 panel: every input the three calculators read, grouped, each
 * with where it came from and the calculators it feeds, to confirm or change
 * once for all of them. The three results stand at the top so a change is
 * seen to land.
 */
export function RiskInputsPanel({ isEnglish }: { isEnglish: boolean }) {
  const reading = useContext(PreventReadingContext)
  const patientId = usePreventStore((state) => state.patientId)
  const locale = isEnglish ? 'en' : 'zh-TW'
  if (!reading) return <p className="text-sm text-muted-foreground">{isEnglish ? 'No record to read the inputs from.' : '沒有可供讀取輸入的病歷。'}</p>
  const shared = reading.shared
  return (
    <section className="space-y-4" data-testid="cdss-htn-risk-inputs-panel">
      <CalculatorStanding isEnglish={isEnglish} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {isEnglish
          ? 'One set of inputs for PREVENT, the ACC/AHA Pooled Cohort Equations and the HPA cardiovascular risk prediction. Each is filled from the best source the record has — a diagnosis code (locked), a lab or vital, today\'s clinic measurement, today\'s answer on the page, or a rule read off the prescriptions — and says so under the field. A rule\'s inference is a proposal: confirm it, or change it; your own entry wins everywhere.'
          : 'PREVENT、ACC/AHA Pooled Cohort 方程式與國健署心血管風險預測公式共用這一組輸入。每格由病歷能給的最佳來源帶入——診斷碼（鎖定）、檢驗或生命徵象、門診今日量測、今日頁面上的回答、或由處方推論的規則——並在欄位下方標明。規則推論只是提案：請確認或修改；您自己輸入的值在三個公式都優先。'}
      </p>
      {RISK_FIELD_GROUPS.map((group) => {
        const fields = group.keys.map((key) => shared.fields.find((field) => field.input.key === key)).filter((field): field is NonNullable<typeof field> => Boolean(field))
        if (!fields.length) return null
        return (
          <section key={group.id} aria-label={isEnglish ? group.title.en : group.title.zh} className="space-y-2">
            <h4 className="text-sm font-semibold">{isEnglish ? group.title.en : group.title.zh}</h4>
            <RiskFieldsEditor fields={fields} locale={locale} showUsedBy {...(patientId ? { patientId } : {})} />
          </section>
        )
      })}
    </section>
  )
}
