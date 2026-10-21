// Medical Calculator Feature — MDCalc-style calculators in the right panel.
//
// Master/detail: a searchable, specialty-filterable list grouped by category →
// a detail view whose inputs auto-fill from the current patient's observations.
// Each card carries MDCalc-style purpose tags (Diagnosis/Prognosis/Formula…)
// and disease tags. Favorites/Recent mirror MDCalc's own nav model.
"use client"

import { Suspense, useMemo, useState } from "react"
import { Search, ChevronRight, Calculator, Star, Clock, Loader2, Users, Stethoscope } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { CALCULATORS, getCalcTags } from "./calculators"
import { CATEGORY_LABELS, PURPOSE_LABELS, tr, trAlt, type CalculatorDef, type Severity } from "./types"
import { CalculatorDetail } from "./components/CalculatorDetail"
import { HfSamdCard, HfSamdPage, HfSamdSession, type HfSamdSessionState } from './prognosis/HfSamdCalculator'
import { useLabAutofill, type Autofill } from "./hooks/use-lab-autofill.hook"
import { useCalcFavorites, useCalcRecent } from "./hooks/use-calc-favorites.hook"
import { computeAutofilledResult, relevanceScore } from "./autofill-compute"
import { buildCalcList, forAudience as visibleForAudience, specialtiesPresent, type CalcFilter } from "./list-logic"

// Severity → value text colour for the inline card result.
const SEV_TEXT: Record<Severity, string> = {
  normal: "text-emerald-600 dark:text-emerald-400",
  low: "text-sky-600 dark:text-sky-400",
  moderate: "text-amber-600 dark:text-amber-400",
  high: "text-red-600 dark:text-rose-300",
}

// An autofilled result is flagged stale past this age — old enough that
// silently trusting it (e.g. an eGFR built off a year-old creatinine) could
// mislead a glance at the card without opening the detail view.
const STALE_DAYS = 90

function daysAgo(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

export default function MedicalCalculatorFeature() {
  return <Suspense fallback={null}><HfSamdSession>{samd => <MedicalCalculatorContent samd={samd} />}</HfSamdSession></Suspense>
}

function MedicalCalculatorContent({ samd }: { samd: HfSamdSessionState }) {
  const { locale } = useLanguage()
  const { audience } = useAudience()
  const { autofill, isLoading: patientDataLoading, error: patientDataError } = useLabAutofill()
  const { favorites, toggleFavorite, isFavorite } = useCalcFavorites()
  const { recent, markUsed } = useCalcRecent()
  const zh = locale === "zh-TW"
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<CalcFilter>("all")

  const visible = useMemo(() => visibleForAudience(CALCULATORS, audience), [audience])

  const selected = useMemo(
    () => visible.find((c) => c.id === selectedId) ?? null,
    [selectedId, visible],
  )

  const openCalculator = (id: string) => {
    setSelectedId(id)
    markUsed(id)
  }

  const specialties = useMemo(() => specialtiesPresent(visible), [visible])

  // Relevance for the "for this patient" view: how well the loaded data drives
  // each calculator (recomputed when the patient's observations change).
  const relevance = useMemo(
    () => new Map(visible.map((c) => [c.id, relevanceScore(c, autofill)])),
    [visible, autofill],
  )
  const relevantCount = useMemo(() => [...relevance.values()].filter((s) => s > 0).length, [relevance])

  const list = useMemo(
    () => buildCalcList({ calcs: visible, filter, query, favorites, recent, relevance }),
    [visible, filter, query, favorites, recent, relevance],
  )
  const flatList = list.mode === "flat" ? list.flat : null
  const grouped = list.grouped

  const showSamd = samd.allowed && audience === 'medical' && (filter === 'all' || filter === 'cardiac') && (!query.trim() || /hf|heart|心衰|北榮|samd|tvgh|預後|prognos|死亡|mortality/i.test(query))

  if (selectedId === 'tvgh-hf-samd' && samd.allowed && audience === 'medical') {
    return <HfSamdPage locale={locale} state={samd.state} onBack={() => setSelectedId(null)} />
  }

  if (selected) {
    return (
      <div>
        <CalculatorDetail
          calc={selected}
          onBack={() => setSelectedId(null)}
          isFavorite={isFavorite(selected.id)}
          onToggleFavorite={() => toggleFavorite(selected.id)}
        />
      </div>
    )
  }

  const isEmpty = flatList !== null ? flatList.length === 0 : grouped.length === 0

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={zh ? "搜尋計算機 / 疾病…" : "Search calculators / disease…"}
          className="h-9 pl-8"
        />
      </div>

      {/* Filter chips — Favorites / Recent (MDCalc-style) + specialty (科別) */}
      <div className="-mx-1 flex flex-wrap gap-1 px-1 pb-1">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          {zh ? "全部" : "All"}
        </FilterChip>
        {/* "For this patient": calculators the loaded data can already drive.
            While the chart is still loading the count is not zero — it is
            unknown, so show a pending chip rather than silently omitting it
            (which reads as "nothing applies to this patient"). */}
        {patientDataLoading ? (
          <FilterChip active={false} disabled onClick={() => {}}>
            <Loader2 className="h-3 w-3 animate-spin" />
            {zh ? "此病人 …" : "For patient …"}
          </FilterChip>
        ) : relevantCount > 0 && (
          <FilterChip active={filter === "relevant"} onClick={() => setFilter("relevant")}>
            <Stethoscope className="h-3 w-3" />
            {zh ? `此病人 ${relevantCount}` : `For patient ${relevantCount}`}
          </FilterChip>
        )}
        <FilterChip active={filter === "favorites"} onClick={() => setFilter("favorites")}>
          <Star className="h-3 w-3" />
          {zh ? "常用" : "Favorites"}
        </FilterChip>
        <FilterChip active={filter === "recent"} onClick={() => setFilter("recent")}>
          <Clock className="h-3 w-3" />
          {zh ? "最近" : "Recent"}
        </FilterChip>
        {/* In patient mode every calculator is already patient-appropriate, so
            the chip only helps a clinician spot hand-off tools (medical mode). */}
        {audience === "medical" && (
          <FilterChip active={filter === "patient"} onClick={() => setFilter("patient")}>
            <Users className="h-3 w-3" />
            {zh ? "民眾可填" : "Patient-fillable"}
          </FilterChip>
        )}
        {specialties.map((cat) => (
          <FilterChip key={cat} active={filter === cat} onClick={() => setFilter(cat)}>
            {tr(locale, CATEGORY_LABELS[cat])}
          </FilterChip>
        ))}
      </div>

      {showSamd && <HfSamdCard locale={locale} state={samd.state} onOpen={() => setSelectedId('tvgh-hf-samd')} />}

      {isEmpty && !showSamd ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {flatList !== null
            ? filter === "favorites"
              ? (zh ? "尚無常用計算機 — 點卡片上的 ⭐ 加入。" : "No favorites yet — tap ⭐ on a calculator to add it.")
              : filter === "recent"
                ? (zh ? "尚無最近使用的計算機。" : "No recently used calculators yet.")
                : filter === "relevant"
                  // An empty "for this patient" list means three different
                  // things; saying "no calculator applies" while the chart is
                  // still loading (or failed to load) would state a clinical
                  // fact the app has not established.
                  ? patientDataLoading
                    ? (zh ? "病人資料載入中…" : "Loading patient data…")
                    : patientDataError
                      ? (zh ? "無法讀取病人資料，暫時無法判斷可帶入的計算機。" : "Couldn't read patient data, so applicable calculators are unknown.")
                      : (zh ? "目前載入的資料尚無法直接帶入任一計算機。" : "The loaded data can't drive any calculator yet.")
                  : (zh ? "找不到符合的計算機。" : "No matching calculators.")
            : (zh ? "找不到符合的計算機。" : "No matching calculators.")}
        </div>
      ) : flatList !== null ? (
        <div className="space-y-1.5">
          {flatList.map((c) => (
            <CalculatorCard
              key={c.id}
              calc={c}
              locale={locale}
              autofill={autofill}
              isFavorite={isFavorite(c.id)}
              patientFillable={audience === "medical" && (c.audience === "patient" || c.audience === "both")}
              onToggleFavorite={() => toggleFavorite(c.id)}
              onOpen={() => openCalculator(c.id)}
            />
          ))}
        </div>
      ) : (
        grouped.map(({ cat, items }) => (
          <div key={cat} className="space-y-1.5">
            {/* Sticky so the current specialty stays visible while scrolling a long list. */}
            <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
              {tr(locale, CATEGORY_LABELS[cat])}
            </div>
            {items.map((c) => (
              <CalculatorCard
                key={c.id}
                calc={c}
                locale={locale}
                autofill={autofill}
                isFavorite={isFavorite(c.id)}
                patientFillable={audience === "medical" && (c.audience === "patient" || c.audience === "both")}
                onToggleFavorite={() => toggleFavorite(c.id)}
                onOpen={() => openCalculator(c.id)}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function CalculatorCard({
  calc: c,
  locale,
  autofill,
  isFavorite,
  patientFillable,
  onToggleFavorite,
  onOpen,
}: {
  calc: CalculatorDef
  locale: string
  autofill: Autofill
  isFavorite: boolean
  /** In medical mode, flags a calculator a patient could self-complete (a
   *  questionnaire like GDS-15/PHQ-9) so the clinician can spot hand-off tools. */
  patientFillable: boolean
  onToggleFavorite: () => void
  onOpen: () => void
}) {
  const zh = locale === "zh-TW"
  const tags = getCalcTags(c.id)
  // Inline result for fully data-driven calculators (no clinical input needed).
  const auto = computeAutofilledResult(c, autofill)
  const staleDays = auto?.asOf ? daysAgo(auto.asOf) : null
  const isStale = staleDays !== null && staleDays > STALE_DAYS

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className="cursor-pointer rounded-lg border-border py-0 shadow-none transition-colors hover:bg-muted/50 hover:shadow-none"
    >
      <CardContent className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          title={zh ? (isFavorite ? "移除常用" : "加入常用") : (isFavorite ? "Remove from favorites" : "Add to favorites")}
          aria-label={zh ? "加入常用" : "Add to favorites"}
          className="-ml-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <Star className={`h-4 w-4 ${isFavorite ? "fill-amber-400 text-amber-500" : ""}`} />
        </button>
        <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          {(tags.purpose.length > 0 || tags.diseases.length > 0 || patientFillable) && (
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {patientFillable && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-px text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                  {zh ? "民眾可填" : "Patient-fillable"}
                </span>
              )}
              {tags.purpose.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/75" />
                  {tr(locale, PURPOSE_LABELS[p])}
                </span>
              ))}
              {tags.diseases.map((d, i) => (
                <span key={i} className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                  {tr(locale, d)}
                </span>
              ))}
            </div>
          )}
          <div className="truncate text-sm font-medium">
            {tr(locale, c.name)}
            {trAlt(locale, c.name) && (
              <span className="ml-1.5 font-normal text-muted-foreground">{trAlt(locale, c.name)}</span>
            )}
          </div>
          {c.blurb && (
            <div className="truncate text-xs text-muted-foreground">{tr(locale, c.blurb)}</div>
          )}
        </div>
        {auto && (
          <div className="mt-0.5 min-w-0 shrink-0 text-right leading-tight">
            <div className={`truncate text-sm font-bold tabular-nums ${auto.result.severity ? SEV_TEXT[auto.result.severity] : "text-foreground"}`}>
              {auto.result.value}
            </div>
            {auto.result.unit && (
              <div className="max-w-[80px] truncate text-[9px] leading-none text-muted-foreground">{auto.result.unit}</div>
            )}
            {auto.asOf && (
              <div className={`max-w-[80px] truncate text-[9px] leading-none ${isStale ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {isStale && "⚠ "}{auto.asOf.slice(0, 10)}
              </div>
            )}
          </div>
        )}
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  )
}

function FilterChip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-70 ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}
