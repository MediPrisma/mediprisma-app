"use client"

import { ScoreInterpretation } from './ScoreInterpretation'
import { HpaRiskResults } from './HpaRiskResults'
import { DoacDoseResults } from './DoacDoseResults'
import { DoacPeriopResults } from './DoacPeriopResults'
import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { ArrowLeft, RotateCw, Sparkles, Clock, AlertTriangle, Loader2, Star, Users, Lightbulb, Copy, Check, ChevronDown, Table2, ExternalLink } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLanguage } from "@/src/application/providers/language.provider"
import type { CalculatorDef, CalcResult, CalcValues, Severity } from "../types"
import { tr, trAlt, inputVisible, visibleValues } from "../types"
import { useLabAutofill, type Autofill } from "../hooks/use-lab-autofill.hook"
import { getCalcInfo, getCalcScoring } from "../calculators"
import type { CalcScoring, ScoringGrid, GridColor } from "../calculators"
import { formatNum, resolveInput } from "../autofill-compute"
import { resultToClipboardText, resultToFullClipboardText, isImplausible, coherenceSpan, type ClipboardInputRow } from "../format"
import { useCopyToClipboard } from "@/src/shared/hooks/use-copy-to-clipboard"
import { useResourceNavigationStore } from "@/src/application/stores/resource-navigation.store"

const SEVERITY_STYLES: Record<Severity, string> = {
  normal: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  low: "bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300",
  moderate: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  high: "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300",
}

/** Defensive guard around a calculator's `compute()` — a single formula bug
 *  (a hand-authored edge case someone missed) must degrade to "can't compute"
 *  for that one calculator, not crash the whole detail view / right panel. */
function safeCompute(
  calc: CalculatorDef,
  values: CalcValues,
): { result: ReturnType<CalculatorDef['compute']>; crashed: boolean } {
  try {
    return { result: calc.compute(values), crashed: false }
  } catch (err) {
    console.error(`[medical-calculator] compute() threw for "${calc.id}":`, err)
    // `crashed` keeps this distinguishable from "not enough inputs yet".
    // Both used to render as a blank result area, which told a clinician who
    // had filled every field that they hadn't.
    return { result: null, crashed: true }
  }
}

/** How long ago, in the words a badge has room for: 「45 天前」「5 個月前」「2 年前」. */
export function agoText(days: number, zh: boolean): string {
  if (days < 60) return zh ? `${days} 天前` : `${days} d ago`
  if (days < 730) return zh ? `${Math.floor(days / 30)} 個月前` : `${Math.floor(days / 30)} mo ago`
  return zh ? `${Math.floor(days / 365)} 年前` : `${Math.floor(days / 365)} y ago`
}

interface FilledInfo {
  date: string
  /** Unit the source observation reported the value in. */
  sourceUnit: string
  /** True when the value was numerically converted into the expected unit. */
  changed: boolean
  /** The original (pre-conversion) source value, for the "from X" hint. */
  origValue: number
  /** True when the source unit differs and could NOT be converted → real ⚠. */
  unconvertible: boolean
  /** Source-report provenance (test name / LOINC / facility / obs id). */
  source?: { testName?: string; loinc?: string; facility?: string; obsId?: string; resourceType?: 'Condition' | 'Encounter' | 'Observation' | 'DiagnosticReport' | 'MedicationRequest' | 'MedicationStatement' }
}

/** Seed a calculator's inputs from patient data. Delegates the per-input
 *  resolution + unit conversion to the shared `resolveInput` (autofill-compute)
 *  — the SAME function the list uses — then unpacks it into the three maps this
 *  view renders: `values` (field contents), `filled` (auto-fill badge info),
 *  and `units` (the unit label to show, which reflects the real source unit for
 *  equivalent-unit fills). */
function seed(calc: CalculatorDef, autofill: Autofill): {
  values: CalcValues
  filled: Record<string, FilledInfo>
  units: Record<string, string>
} {
  const values: CalcValues = {}
  const filled: Record<string, FilledInfo> = {}
  const units: Record<string, string> = {}
  for (const input of calc.inputs) {
    const r = resolveInput(input, autofill)
    values[input.key] = r.value
    if (input.type === "number") units[input.key] = r.displayUnit
    if (r.filled) {
      filled[input.key] = {
        date: r.date, sourceUnit: r.sourceUnit, changed: r.changed, origValue: r.origValue, unconvertible: r.unconvertible, source: r.source,
      }
    }
  }
  return { values, filled, units }
}

export function CalculatorDetail({
  calc,
  onBack,
  isFavorite,
  onToggleFavorite,
  onResult,
  selectContentClassName,
}: {
  calc: CalculatorDef
  onBack: () => void
  /** Lifted to the parent (single `useCalcFavorites()` instance) so toggling
   *  here and the list's ⭐ stay in sync — two independent hook instances
   *  each backed by their own localStorage-hook state would not notify each
   *  other on change. */
  isFavorite: boolean
  onToggleFavorite: () => void
  /** The result as the clinician's inputs stand, for a host that keeps it (the decision map's 附註). */
  onResult?: (result: CalcResult | null) => void
  /** For a host that stacks the calculator above another fixed layer: its option lists must open above it too. */
  selectContentClassName?: string
}) {
  const { locale } = useLanguage()
  const {
    autofill,
    isLoading: patientDataLoading,
    error: patientDataError,
    retry: retryPatientData,
    patientId,
  } = useLabAutofill()
  // Questionnaire-style calculators (GDS-15, PHQ-9…) have no `source` on any
  // input, so a loading chart tells the user nothing — keep their view quiet.
  const calcUsesPatientData = useMemo(
    () => calc.inputs.some((input) => !!input.source),
    [calc],
  )

  const initial = useMemo(() => seed(calc, autofill), [calc, autofill])
  const [values, setValues] = useState<CalcValues>(initial.values)
  // Which keys currently hold an auto-filled value (cleared on manual edit).
  const [filled, setFilled] = useState<Record<string, FilledInfo>>(initial.filled)
  // Unit each field is shown in — reflects the actual FHIR source unit for
  // equivalent-unit fills. Persists across manual edits (same scale).
  const [displayUnits, setDisplayUnits] = useState<Record<string, string>>(initial.units)

  // Opening a calculator while the chart is still loading used to seed the
  // inputs from an empty autofill and never revisit it — the fields stayed
  // blank for good, with the "Refill" button hidden because nothing was
  // filled. Re-seed the fields the clinician has not typed in when a newer
  // autofill arrives (a weight just added in the CDSS, a chart that finished
  // loading); what they typed stays — for the same patient only. Another
  // patient starts over, so no typed value is computed with someone else's
  // chart. Adjusted during render (not in an effect) so the values land in
  // the same paint.
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set())
  const [seededFrom, setSeededFrom] = useState(initial)
  const [seededFor, setSeededFor] = useState(patientId)
  if (initial !== seededFrom || patientId !== seededFor) {
    const samePatient = patientId === seededFor
    setSeededFrom(initial)
    setSeededFor(patientId)
    if (!samePatient) setEdited(new Set())
    const kept = samePatient ? edited : new Set<string>()
    const keep = <T,>(next: Record<string, T>, prev: Record<string, T>) => {
      const out = { ...next }
      for (const key of kept) {
        if (key in prev) out[key] = prev[key]
        else delete out[key]
      }
      return out
    }
    setValues((prev) => keep(initial.values, prev))
    setFilled((prev) => keep(initial.filled, prev))
    setDisplayUnits((prev) => keep(initial.units, prev))
  }

  const setValue = useCallback((key: string, value: string) => {
    setEdited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    setValues((prev) => ({ ...prev, [key]: value }))
    setFilled((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const refill = useCallback(() => {
    const s = seed(calc, autofill)
    setEdited(new Set())
    setValues(s.values)
    setFilled(s.filled)
    setDisplayUnits(s.units)
  }, [calc, autofill])

  // What the rules read: an input that does not apply right now is blank.
  const effective = useMemo(() => visibleValues(calc.inputs, values), [calc, values])
  const { result, crashed: computeCrashed } = useMemo(() => safeCompute(calc, effective), [calc, effective])
  useEffect(() => {
    onResult?.(computeCrashed ? null : result)
  }, [computeCrashed, onResult, result])
  const hasAnyAutofill = Object.keys(filled).length > 0
  const info = getCalcInfo(calc.id)
  const scoring = getCalcScoring(calc.id)
  // Warn when the auto-filled values that should share one draw/day actually
  // span more than the calculator's coherence window (e.g. FENa mixing today's
  // urine with an old serum). Only auto-filled fields carry a date.
  const coherence = useMemo(
    () => (calc.coherence ? coherenceSpan(calc.coherence.keys.map((k) => filled[k]?.date), calc.coherence.windowDays) : null),
    [calc, filled],
  )
  const { copied, copy } = useCopyToClipboard()

  const zh = locale === "zh-TW"
  const isHpa = calc.id === 'hpa-chronic-risk-reconstruction'
  const detailRef = useRef<HTMLDivElement>(null)
  const hpaResultRef = useRef<HTMLDivElement>(null)
  const inputGroups = isHpa ? [
    { key: 'basic', title: zh ? '基本資料' : 'Basic information', hint: zh ? '本地已驗算年齡為 35–70 歲。' : 'Locally checked for ages 35–70.', keys: ['gender', 'age', 'height', 'weight', 'waist'] },
    { key: 'history', title: zh ? '病史與吸菸' : 'History and smoking', hint: zh ? '病史請依曾經確診的情形填寫，不以這次血壓或血糖判定；不確定可先留空。' : 'Use previously diagnosed conditions, not today’s BP or glucose. Leave unknown history unanswered.', keys: ['diabetes', 'hbp', 'smoke', 'prior_cvd'] },
    { key: 'labs', title: zh ? '血壓與檢驗' : 'Blood pressure and labs', hint: zh ? '核對數值、單位與來源日期；血糖請使用空腹檢驗。' : 'Check values, units and source dates; use a fasting glucose result.', keys: ['sbp', 'glu', 'chol', 'tg', 'ldlc', 'hdlc'] },
  ].map((group) => ({ ...group, inputs: group.keys.flatMap((key) => calc.inputs.filter((input) => input.key === key)) }))
    : calc.inputGroups ? [
      ...calc.inputGroups.map((group) => ({
        key: group.key,
        title: tr(locale, group.title),
        hint: group.hint ? tr(locale, group.hint) : '',
        summary: group.summary,
        inputs: group.keys.flatMap((key) => calc.inputs.filter((input) => input.key === key)),
      })),
      // An input no group names still shows, last.
      { key: 'other', title: '', hint: '', inputs: calc.inputs.filter((input) => !calc.inputGroups!.some((group) => group.keys.includes(input.key))) },
    ].filter((group) => group.inputs.length)
    : [{ key: 'all', title: '', hint: '', inputs: calc.inputs }]

  // Jump to the source report in the left panel (reuses the shared nav store
  // that medical-summary's citations use — switches to the reports tab and
  // flashes the report row the value came from).
  const jumpToSource = useCallback((src: FilledInfo["source"], label: string, date: string) => {
    if (!src?.obsId) return
    useResourceNavigationStore.getState().navigate({
      resourceType: src.resourceType ?? "Observation",
      resourceId: src.obsId,
      display: src.testName || label,
      date: date || undefined,
    })
  }, [])

  // Detailed clipboard export: the result + each input's value/unit and (when
  // auto-filled) its source date + report name — for an auditable note.
  const buildFullCopy = useCallback((): string => {
    if (!result) return ""
    const rows: ClipboardInputRow[] = calc.inputs.filter((inp) => inputVisible(inp, values)).map((inp) => {
      const raw = values[inp.key] ?? ""
      let value = raw
      if (inp.type === "select" && raw !== "") {
        value = tr(locale, inp.options.find((o) => o.value === raw)?.label ?? { en: raw, zh: raw })
      }
      const unit = inp.type === "number" ? (displayUnits[inp.key] || inp.unit) : undefined
      const f = filled[inp.key]
      const src = [f?.date ? f.date.slice(0, 10) : "", f?.source?.testName ?? ""].filter(Boolean).join(" · ")
      return { label: tr(locale, inp.label), value, unit, source: src || undefined }
    })
    return resultToFullClipboardText(calc, result, locale, rows)
  }, [calc, result, values, displayUnits, filled, locale])

  return (
    <div ref={detailRef} className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 gap-1 px-2">
          <ArrowLeft className="h-4 w-4" />
          {zh ? "返回" : "Back"}
        </Button>
        <div className="min-w-0 flex-1">
          <div className={`${isHpa ? 'break-words' : 'truncate'} text-sm font-semibold`}>{tr(locale, calc.name)}</div>
          {trAlt(locale, calc.name) && (
            <div className={`${isHpa ? 'break-words' : 'truncate'} text-xs font-normal text-muted-foreground`}>{trAlt(locale, calc.name)}</div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleFavorite}
          className="h-8 w-8 shrink-0 p-0"
          title={zh ? (isFavorite ? "移除常用" : "加入常用") : (isFavorite ? "Remove from favorites" : "Add to favorites")}
          aria-label={zh ? "加入常用" : "Add to favorites"}
        >
          <Star className={`h-4 w-4 ${isFavorite ? "fill-amber-400 text-amber-500" : ""}`} />
        </Button>
        {hasAnyAutofill && (
          <Button variant="outline" size="sm" onClick={refill} className="h-8 gap-1 px-2" title={zh ? "重新帶入病人資料" : "Refill from patient"}>
            <RotateCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{zh ? "重新帶入" : "Refill"}</span>
          </Button>
        )}
      </div>

      {/* Blurb is only shown when there's no "When to use" — otherwise the two
          restate the same one-liner (the useWhen box is the richer version). */}
      {calc.blurb && !info.useWhen && (
        <p className="text-xs text-muted-foreground">{tr(locale, calc.blurb)}</p>
      )}

      {/* When to use — patient population / indication (MDCalc "When to Use"). */}
      {info.useWhen && (
        <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 dark:border-sky-500/25 dark:bg-sky-500/10">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="min-w-0 text-xs leading-relaxed text-sky-900 dark:text-sky-200">
            <span className="font-semibold">{zh ? "適用時機　" : "When to use　"}</span>
            {tr(locale, info.useWhen)}
          </div>
        </div>
      )}

      {/* Why the fields are empty. Without this, an un-filled creatinine reads
          as "this patient has no creatinine on file" when the chart is in fact
          still loading or failed to load — a blank that states a clinical fact
          the app has not established. */}
      {calcUsesPatientData && patientDataLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          {zh
            ? "病人資料載入中，尚未自動帶入。空白欄位不代表沒有這項檢驗。"
            : "Loading patient data — autofill is pending. An empty field does not mean the result is absent."}
        </div>
      )}
      {calcUsesPatientData && !patientDataLoading && patientDataError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {zh
              ? "無法讀取病人資料，自動帶入已停用；空白欄位不代表沒有這項檢驗，請自行填入或重試。"
              : "Couldn't read patient data, so autofill is off. An empty field does not mean the result is absent — enter values manually or retry."}
          </span>
          <button
            type="button"
            onClick={() => { void retryPatientData() }}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-destructive/40 px-2 font-medium transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            {zh ? "重試" : "Retry"}
          </button>
        </div>
      )}

      {/* Temporal-coherence warning: auto-filled values span different reports. */}
      {coherence && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            {isHpa ? (zh
              ? `提醒：檢驗日期相差 ${coherence.spanDays} 天（${coherence.earliest} ～ ${coherence.latest}）。仍會顯示可估算的結果，請核對這些數值是否能代表目前狀況。`
              : `Lab dates are ${coherence.spanDays} days apart (${coherence.earliest} – ${coherence.latest}). Available estimates remain visible; check whether these values reflect the current situation.`) : zh
              ? `注意：自動帶入的數值來自相差 ${coherence.spanDays} 天的不同報告（${coherence.earliest} ～ ${coherence.latest}）。此公式應使用同一次／同日的檢驗，請確認一致性。`
              : `Heads-up: the auto-filled values are from reports ${coherence.spanDays} days apart (${coherence.earliest} – ${coherence.latest}). This formula expects one same-day draw — verify they belong together.`}
          </div>
        </div>
      )}

      {/* Result — compact so it doesn't dominate the panel. */}
      {isHpa ? (
        <div ref={hpaResultRef} tabIndex={-1}>
          <HpaRiskResults values={effective} locale={locale} onReviewField={(key) => detailRef.current?.querySelector<HTMLElement>(`#calc-${key}`)?.focus()} />
        </div>
      ) : calc.id === 'doac-dose-nvaf' ? (
        <DoacDoseResults values={effective} locale={locale} onReviewField={(key) => detailRef.current?.querySelector<HTMLElement>(`#calc-${key}`)?.focus()} />
      ) : calc.id === 'doac-periop' ? (
        <DoacPeriopResults values={effective} locale={locale} onReviewField={(key) => detailRef.current?.querySelector<HTMLElement>(`#calc-${key}`)?.focus()} />
      ) : (
      <div className={`relative rounded-lg border border-border px-3 py-2.5 ${result?.severity ? SEVERITY_STYLES[result.severity] : ""}`}>
        {result && (
          <div className="absolute right-2 top-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => copy(resultToClipboardText(calc, result, locale))}
              title={zh ? "複製結果（一行，可貼入病歷）" : "Copy result (one line)"}
              aria-label={zh ? "複製結果" : "Copy result"}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium opacity-70 transition-colors hover:bg-current/10 hover:opacity-100"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? (zh ? "已複製" : "Copied") : (zh ? "複製" : "Copy")}</span>
            </button>
            <button
              type="button"
              onClick={() => copy(buildFullCopy())}
              title={zh ? "複製結果＋依據與來源（多行）" : "Copy result + inputs & sources (multi-line)"}
              aria-label={zh ? "複製含依據" : "Copy with inputs"}
              className="inline-flex items-center rounded-md px-1.5 py-1 text-[11px] font-medium opacity-70 transition-colors hover:bg-current/10 hover:opacity-100"
            >
              {zh ? "含依據" : "Full"}
            </button>
          </div>
        )}
        {result ? (
          <div className="space-y-0.5">
            <div className="flex items-baseline gap-1.5 pr-28">
              <span className="text-2xl font-bold leading-none tabular-nums">{result.value}</span>
              {result.unit && <span className="text-xs font-medium opacity-80">{result.unit}</span>}
            </div>
            {result.interpretation && (
              <div className="text-sm font-medium leading-snug">{tr(locale, result.interpretation)}</div>
            )}
            {result.extra && result.extra.length > 0 && (
              <div className="space-y-0.5 pt-1">
                {result.extra.map((row, i) => (
                  <div key={i} className="flex justify-between gap-3 text-xs opacity-90">
                    <span>{tr(locale, row.label)}</span>
                    <span className="font-medium tabular-nums">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
            <ScoreInterpretation result={result} isEnglish={!zh} />
          </div>
        ) : computeCrashed ? (
          <div className="text-sm text-destructive">
            {zh
              ? "無法計算此分數（公式發生錯誤）。請改用其他工具或人工核算，不要以空白視為正常。"
              : "Couldn't compute this score (the formula errored). Use another tool or calculate manually — do not read the blank as normal."}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {zh ? "請填入所有必要欄位以計算。" : "Enter the required inputs to calculate."}
          </div>
        )}
      </div>
      )}

      {/* Inputs */}
      <div className="space-y-3">
        {inputGroups.map((group) => {
          const inputs = group.inputs.filter((input) => inputVisible(input, values))
          if (!inputs.length) return null
          const folded = 'summary' in group && group.summary ? group.summary(effective, inputs.map((input) => input.key)) : undefined
          const fields = inputs.map((input) => {
          const fill = filled[input.key]
          const expectedUnit = input.type === "number" ? input.unit : undefined
          const unit = input.type === "number" ? (displayUnits[input.key] || input.unit) : undefined
          const range = input.type === "number" ? input.normalRange : undefined
          const placeholder = range
            ? (zh ? `正常 ${range.low}–${range.high}` : `Normal ${range.low}–${range.high}`)
            : undefined
          const implausible = input.type === "number" && isImplausible(input, values[input.key] ?? "")
          const ageDays = fill?.date && Number.isFinite(Date.parse(fill.date)) ? Math.floor((Date.now() - Date.parse(fill.date)) / 86_400_000) : undefined
          const staleDays = input.staleAfterDays !== undefined && ageDays !== undefined && ageDays > input.staleAfterDays ? ageDays : undefined
          return (
            <div key={input.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`calc-${input.key}`} className="text-xs font-medium">
                  {tr(locale, input.label)}
                  {unit ? <span className="ml-1 text-muted-foreground">({unit})</span> : null}
                </Label>
                {fill && (
                  fill.unconvertible ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
                      title={zh ? `來源單位 ${fill.sourceUnit} 無法自動換算為 ${expectedUnit}，請確認數值` : `Source unit ${fill.sourceUnit} can't be auto-converted to ${expectedUnit} — verify`}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {fill.date ? fill.date.slice(0, 10) : ""} · {fill.sourceUnit}
                    </span>
                  ) : staleDays !== undefined ? (
                    // Used as filled, never withheld: the date turns amber and says how old it is.
                    <span
                      className="flex shrink-0 items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
                      title={zh ? `自動帶入的資料已 ${staleDays} 天（超過 ${input.staleAfterDays} 天），建議確認或重新量測` : `Auto-filled from ${staleDays} days ago (over ${input.staleAfterDays}); confirm or re-measure`}
                      data-testid={`calc-stale-${input.key}`}
                    >
                      <Clock className="h-3 w-3" />
                      {fill.date.slice(0, 10)} · {agoText(staleDays, zh)}
                    </span>
                  ) : (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                      title={zh ? "自病人資料自動帶入" : "Auto-filled from patient data"}
                    >
                      <Sparkles className="h-3 w-3" />
                      {fill.date ? fill.date.slice(0, 10) : (zh ? "自動" : "auto")}
                      {fill.changed && (
                        <span className="text-muted-foreground" title={zh ? "已自來源單位換算" : "converted from source unit"}>
                          ({formatNum(fill.origValue)} {fill.sourceUnit})
                        </span>
                      )}
                    </span>
                  )
                )}
              </div>
              {input.type === "select" ? (
                <Select value={values[input.key] ?? ""} onValueChange={(v) => setValue(input.key, v)}>
                  <SelectTrigger id={`calc-${input.key}`} className={isHpa ? 'min-h-11 w-full sm:min-h-9' : 'h-9 max-w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate'}>
                    <SelectValue placeholder={zh ? "請選擇…" : "Select…"} />
                  </SelectTrigger>
                  <SelectContent className={selectContentClassName}>
                    {input.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {tr(locale, opt.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : input.type === "datetime" || input.type === "time" ? (
                <Input
                  id={`calc-${input.key}`}
                  type={input.type === "datetime" ? "datetime-local" : "time"}
                  value={values[input.key] ?? ""}
                  onChange={(e) => setValue(input.key, e.target.value)}
                  className={isHpa ? 'h-11 sm:h-9' : 'h-9'}
                />
              ) : (
                <>
                  <Input
                    id={`calc-${input.key}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={values[input.key] ?? ""}
                    onChange={(e) => setValue(input.key, e.target.value)}
                    placeholder={placeholder}
                    className={`${isHpa ? 'h-11 sm:h-9' : 'h-9'} ${implausible ? "border-amber-500 focus-visible:ring-amber-500/50" : ""}`}
                    aria-invalid={implausible || undefined}
                  />
                  {implausible && (
                    <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {zh ? "數值遠超出正常範圍，請確認是否輸入有誤。" : "Value is far outside the normal range — double-check for a typo."}
                    </p>
                  )}
                </>
              )}

              {/* Source-report provenance: test name / LOINC / facility + a link
                  back to the original report in the left panel. */}
              {fill?.source && (fill.source.testName || fill.source.loinc || fill.source.facility || fill.source.obsId) && (
                <div className={`flex flex-wrap items-center gap-x-1.5 text-muted-foreground ${input.source?.kind === "hfpefClinical" ? "text-xs leading-relaxed" : "text-[10px] leading-tight"}`}>
                  <span className="font-medium">{zh ? "來源" : "Source"}:</span>
                  {fill.source.testName && <span className={input.source?.kind === "hfpefClinical" ? "break-words" : "truncate max-w-[45%]"}>{fill.source.testName}</span>}
                  {fill.source.loinc && <span>· LOINC {fill.source.loinc}</span>}
                  {fill.source.facility && <span className="truncate max-w-[35%]">· {fill.source.facility}</span>}
                  {fill.source.obsId && (
                    <button
                      type="button"
                      onClick={() => jumpToSource(fill.source, tr(locale, input.label), fill.date)}
                      className="inline-flex items-center gap-0.5 text-sky-600 hover:underline dark:text-sky-400"
                      title={zh ? "在左側定位來源紀錄" : "Locate the source record in the left panel"}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      {input.source?.kind === "hfpefClinical" ? (zh ? "查看來源" : "View source") : (zh ? "查看原報告" : "View report")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
          return folded ? (
            // Remounted when `open` flips, so a group that now needs the reader opens itself.
            <details key={`${group.key}:${folded.open}`} open={folded.open} className="group/fold min-w-0 rounded-md border" data-testid={`calc-group-${group.key}`}>
              <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 text-sm font-semibold">{group.title}</span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{tr(locale, folded.text)}</span>
                <ChevronDown className="h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform group-open/fold:rotate-180" aria-hidden="true" />
              </summary>
              <div className="space-y-3 border-t px-3 py-2.5">
                {group.hint && <p className="text-xs leading-relaxed text-muted-foreground">{group.hint}</p>}
                {fields}
              </div>
            </details>
          ) : (
            <fieldset key={group.key} className="min-w-0 space-y-3">
              {group.title && <legend className="mb-1 pt-2 text-sm font-semibold">{group.title}</legend>}
              {group.hint && <p className="text-xs leading-relaxed text-muted-foreground">{group.hint}</p>}
              {fields}
            </fieldset>
          )
        })}
      </div>

      {isHpa && (
        <Button variant="outline" className="min-h-11 w-full" onClick={() => {
          hpaResultRef.current?.focus({ preventScroll: true })
          hpaResultRef.current?.scrollIntoView({ block: 'start' })
        }}>{zh ? '回到風險結果' : 'Back to risk results'}</Button>
      )}

      {/* Pearls / pitfalls — caveats & when NOT to rely on this (MDCalc-style). */}
      {info.caveats && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-500/25 dark:bg-amber-500/10">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            <span className="font-semibold">{zh ? "注意事項　" : "Pearls / pitfalls　"}</span>
            {tr(locale, info.caveats)}
          </div>
        </div>
      )}

      {/* 計算說明 / Scoring — collapsible per-factor points table (only when
          authored; default collapsed so it doesn't dominate the panel). */}
      {scoring && <ScoringDetails scoring={scoring} locale={locale} />}

      {calc.reference && (
        <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
          {calc.reference}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {zh
          ? "⚠ 計算結果僅供臨床參考，數值以病人最近一次檢驗自動帶入，請務必核對單位與臨床情境後判斷。"
          : "⚠ For clinical reference only. Values are auto-filled from the most recent result — verify units and context before acting."}
      </p>
    </div>
  )
}

/** Collapsible "計算說明 / Scoring" — the per-factor points table plus the
 *  score→outcome mapping, for calculators whose points are hidden behind banded
 *  numeric inputs (e.g. the HCC risk score). Native <details> = no extra state. */
function ScoringDetails({ scoring, locale }: { scoring: CalcScoring; locale: string }) {
  const zh = locale === "zh-TW"
  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground/80 [&::-webkit-details-marker]:hidden">
        <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {zh ? "計算說明" : "Scoring"}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t px-3 py-2.5">
        {scoring.formula && (
          <div className="rounded border bg-muted/40 px-2 py-1.5 text-xs leading-relaxed">
            <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{zh ? "公式" : "Formula"}</div>
            <div className="whitespace-pre-wrap font-mono text-[11px]">{tr(locale, scoring.formula)}</div>
          </div>
        )}
        {scoring.grid && <ScoringGridView grid={scoring.grid} locale={locale} />}
        {(scoring.factors ?? []).map((f, i) => (
          <div key={i}>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{tr(locale, f.label)}</div>
            <div className="overflow-hidden rounded border">
              {f.options.map((o, j) => (
                <div
                  key={j}
                  className={`flex items-center justify-between gap-3 px-2 py-1 text-xs ${j % 2 ? "bg-muted/40" : ""}`}
                >
                  <span className="min-w-0 truncate">{tr(locale, o.label)}</span>
                  <span className="shrink-0 font-medium tabular-nums">{o.points}{zh ? " 分" : " pt"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {scoring.outcome && (
          <div>
            <div className="overflow-hidden rounded border">
              <div className="flex items-center justify-between gap-3 bg-muted/60 px-2 py-1 text-[11px] font-semibold">
                <span>{tr(locale, scoring.outcome.scoreHeader)}</span>
                <span>{tr(locale, scoring.outcome.outcomeHeader)}</span>
              </div>
              {scoring.outcome.rows.map((r, i) => (
                <div key={i} className={`flex items-center justify-between gap-3 px-2 py-1 text-xs ${i % 2 ? "bg-muted/40" : ""}`}>
                  <span className="shrink-0 tabular-nums">{r.score}</span>
                  <span className="text-right font-medium">{tr(locale, r.outcome)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {scoring.note && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">{tr(locale, scoring.note)}</p>
        )}
      </div>
    </details>
  )
}

// KDIGO-style heat-map colours. Fixed (standard clinical colour code), so they
// read the same in light and dark mode.
const GRID_CELL_COLOR: Record<GridColor, string> = {
  green: "bg-green-500 text-white",
  yellow: "bg-yellow-300 text-black",
  orange: "bg-orange-400 text-black",
  red: "bg-red-500 text-white",
  deepred: "bg-red-800 text-white",
}

/** Renders a colour-coded matrix (e.g. the KDIGO GFR × albuminuria heat map).
 *  Scrolls horizontally on narrow panels rather than overflowing. */
function ScoringGridView({ grid, locale }: { grid: ScoringGrid; locale: string }) {
  const nCols = grid.cols.length
  return (
    <div>
      {grid.caption && (
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{tr(locale, grid.caption)}</div>
      )}
      {grid.colAxis && (
        <div className="mb-0.5 text-center text-[10px] font-medium text-muted-foreground">{tr(locale, grid.colAxis)}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-[11px]">
          <thead>
            <tr>
              <th className="border bg-muted/60 px-1.5 py-1 text-left align-bottom text-[9px] font-medium leading-tight text-muted-foreground">
                {grid.rowAxis ? tr(locale, grid.rowAxis) : ""}
              </th>
              {grid.cols.map((c, i) => (
                <th key={i} className="border bg-muted/60 px-1.5 py-1 font-semibold">
                  <div>{tr(locale, c.label)}</div>
                  {c.sub && <div className="text-[9px] font-normal text-muted-foreground">{tr(locale, c.sub)}</div>}
                </th>
              ))}
            </tr>
            {(grid.colSubRows ?? []).map((sr, i) => (
              <tr key={`sr-${i}`}>
                <th className="border bg-muted/30 px-1.5 py-0.5 text-left text-[9px] font-medium text-muted-foreground">{tr(locale, sr.label)}</th>
                {sr.cells.map((cell, j) => (
                  <td key={j} className="border bg-muted/20 px-1.5 py-0.5 text-[9px] text-muted-foreground">{cell}</td>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {grid.rows.map((r, ri) => (
              <tr key={ri}>
                <th className="border bg-muted/40 px-1.5 py-1 text-left text-[10px] font-medium leading-tight">
                  <div>{tr(locale, r.label)}</div>
                  {r.sub && <div className="text-[9px] font-normal text-muted-foreground">{tr(locale, r.sub)}</div>}
                </th>
                {(grid.cells[ri] ?? []).slice(0, nCols).map((cell, ci) => (
                  <td key={ci} className={`border px-1.5 py-1.5 font-bold ${GRID_CELL_COLOR[cell.color]}`}>
                    {tr(locale, cell.text)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid.legend && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{tr(locale, grid.legend)}</p>
      )}
    </div>
  )
}
