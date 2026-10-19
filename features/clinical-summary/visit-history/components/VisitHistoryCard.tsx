"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, AlertCircle, X } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CARD_BORDER_CLASSES } from "@/src/shared/config/ui-theme.config"
import { cn } from "@/src/shared/utils/cn.utils"
import { dateSearchTokens } from "@/src/shared/utils/date.utils"
import { buildIcdDictionary } from "@/src/shared/utils/icd-lookup"
import { useVisitHistory, type VisitCareDiscipline } from "../hooks/useVisitHistory"
import { useEncounterDetails } from "../hooks/useEncounterDetails"
import { useClinicalNotes } from "../hooks/useClinicalNotes"
import { useVisitStats } from "../hooks/useVisitStats"
import { useMedicationRows } from "@/features/clinical-summary/medications/hooks/useMedicationRows"
import { useDocumentSummaries } from "@/features/clinical-summary/document-summary/hooks/useDocumentSummaries"
import { useDocumentSummaryStrings } from "@/features/clinical-summary/document-summary/utils/strings"
import type { DocumentEntry } from "@/features/clinical-summary/document-summary/types"
import { VisitItem } from "./VisitItem"
import { InstitutionFilterSelect } from "./InstitutionFilterSelect"
import { useResourceNavigationStore } from "@/src/application/stores/resource-navigation.store"
import {
  navigationEncounterId,
  visibleCountForNavigation,
} from "../utils/source-navigation"

type VisitTypeFilter = 'all' | 'outpatient' | 'outpatient-or-emergency' | 'inpatient' | 'emergency' | 'pharmacy'
type CareDisciplineFilter = 'all' | VisitCareDiscipline
type SortMode = 'date-desc' | 'date-asc' | 'abnormal'
type ContentFlag = 'medications' | 'tests' | 'reports' | 'procedures' | 'discharge'

const FILTER_TYPES: VisitTypeFilter[] = ['all', 'outpatient', 'outpatient-or-emergency', 'inpatient', 'emergency', 'pharmacy']
const CARE_DISCIPLINES: CareDisciplineFilter[] = ['all', 'western', 'tcm', 'dental']

export function VisitHistoryCard() {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const {
    encounters = [],
    medications = [],
    diagnosticReports = [],
    observations = [],
    procedures = [],
    conditions = [],
    documentReferences = [],
    compositions = [],
    resourceReady,
    error,
  } = useClinicalData()
  // A visit row renders its own medications, orders, reports and notes inline,
  // so this card waits for exactly those types — showing the encounter spine
  // early would make a half-loaded visit look like a visit with nothing in it.
  // Types it never renders (allergies, imaging, immunizations, consents,
  // devices, care plans) no longer hold it back.
  const isLoading = !resourceReady.encounters
    || !resourceReady.medications
    || !resourceReady.diagnosticReports
    || !resourceReady.observations
    || !resourceReady.procedures
    || !resourceReady.conditions
    || !resourceReady.documentReferences
    || !resourceReady.compositions

  // ── State ──────────────────────────────────────────────────────────────
  // Set (not a single id) so several visits can stay expanded at once —
  // opening one no longer collapses the others.
  const [expandedVisitIds, setExpandedVisitIds] = useState<Set<string>>(new Set())
  const [careDisciplineFilter, setCareDisciplineFilter] = useState<CareDisciplineFilter>('all')
  const [typeFilter, setTypeFilter] = useState<VisitTypeFilter>('all')
  const [institutionFilter, setInstitutionFilter] = useState<string>('all')
  const [contentFlags, setContentFlags] = useState<Set<ContentFlag>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('date-desc')
  // Progressive render: a full 健保存摺 can carry hundreds of encounters, and
  // rendering every VisitItem at once floods the DOM. Show a bounded window and
  // let the user page in more. (Filters/search usually narrow it below the cap.)
  const VISIT_PAGE_SIZE = 25
  const [visibleCount, setVisibleCount] = useState(VISIT_PAGE_SIZE)
  const pendingNavigation = useResourceNavigationStore((state) => state.pending)
  const navigationSequence = useResourceNavigationStore((state) => state.seq)
  const toggleVisit = useCallback((visitId: string) => {
    setExpandedVisitIds((previous) => {
      const next = new Set(previous)
      if (next.has(visitId)) next.delete(visitId)
      else next.add(visitId)
      return next
    })
  }, [])

  // ── Data derivation ────────────────────────────────────────────────────
  const clinicalNotes = useClinicalNotes(documentReferences, compositions)
  // Build the exact same audience-aware medication view model used by the
  // dedicated 用藥 tab. Encounter details keep the raw resources only for
  // their Encounter links; names, terminology, categories and status display
  // all come from this shared row model.
  const medicationRows = useMedicationRows(medications, audience, locale)
  const icdDict = useMemo(() => buildIcdDictionary(conditions, locale, encounters), [conditions, locale, encounters])
  const encounterDetails = useEncounterDetails(
    medications, diagnosticReports, observations, procedures,
    clinicalNotes, conditions, locale, audience, medicationRows, icdDict,
  )
  // ICD dict prefers Chinese when UI is zh-TW; English coding[].display when UI is en.
  const visitHistory = useVisitHistory(encounters, icdDict)
  const visitStats = useVisitStats(encounterDetails)

  // Documents that reference an Encounter (e.g. 出院病摘 / discharge summaries)
  // are surfaced inline on their linked visit. Keyed by encounter id so each
  // VisitItem can pull its own.
  const docStrings = useDocumentSummaryStrings()
  const { entries: documentEntries } = useDocumentSummaries(docStrings.docTypes)
  const docsByEncounter = useMemo(() => {
    const map = new Map<string, DocumentEntry[]>()
    for (const e of documentEntries) {
      const encId = e.encounterRef?.split('/').pop()
      if (!encId) continue
      const arr = map.get(encId) ?? []
      arr.push(e)
      map.set(encId, arr)
    }
    return map
  }, [documentEntries])
  const hasAnyDischargeSummary = useMemo(
    () => documentEntries.some((e) => e.isDischargeSummary),
    [documentEntries],
  )

  // Unique institutions for the dropdown
  const institutions = useMemo(() => {
    const set = new Set<string>()
    for (const v of visitHistory) if (v.institution) set.add(v.institution)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [visitHistory])

  // Counts per type filter (always reflect type only; institution / content
  // filters narrow the result list but the per-type chip count remains stable
  // for orientation).
  const counts = useMemo(() => {
    const c = {
      all: visitHistory.length,
      outpatient: 0,
      'outpatient-or-emergency': 0,
      inpatient: 0,
      emergency: 0,
      pharmacy: 0,
    }
    for (const v of visitHistory) {
      if (v.type === 'outpatient') c.outpatient++
      else if (v.type === 'outpatient-or-emergency') c['outpatient-or-emergency']++
      else if (v.type === 'inpatient') c.inpatient++
      else if (v.type === 'emergency') c.emergency++
      else if (v.type === 'pharmacy') c.pharmacy++
    }
    return c
  }, [visitHistory])

  const careDisciplineCounts = useMemo(() => {
    const counts: Record<CareDisciplineFilter, number> = {
      all: visitHistory.length,
      western: 0,
      tcm: 0,
      dental: 0,
    }
    for (const visit of visitHistory) counts[visit.careDiscipline]++
    return counts
  }, [visitHistory])

  // ── Filter + sort pipeline ─────────────────────────────────────────────
  const filteredVisits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const wantsMedications = contentFlags.has('medications')
    const wantsTests = contentFlags.has('tests')
    const wantsReports = contentFlags.has('reports')
    const wantsProcs = contentFlags.has('procedures')
    const wantsDischarge = contentFlags.has('discharge')

    const result = visitHistory.filter((v) => {
      // care discipline (western medicine / TCM / dentistry)
      if (careDisciplineFilter !== 'all' && v.careDiscipline !== careDisciplineFilter) return false
      // type
      if (typeFilter !== 'all' && v.type !== typeFilter) return false
      // institution
      if (institutionFilter !== 'all' && v.institution !== institutionFilter) return false
      // content flags
      if (wantsMedications || wantsTests || wantsReports || wantsProcs) {
        const s = visitStats.get(v.id)
        if (!s) return false
        if (wantsMedications && !s.hasMedications) return false
        if (wantsTests && !s.hasTests) return false
        if (wantsReports && !s.hasReports) return false
        if (wantsProcs && !s.hasProcedures) return false
      }
      // 含出院病摘 — only visits with a linked 出院病摘 / discharge summary.
      if (wantsDischarge) {
        const docs = docsByEncounter.get(v.id)
        if (!docs?.some((d) => d.isDischargeSummary)) return false
      }
      // search across visit-level fields + content (tests, medications,
      // procedures, diagnoses) + the visit date in multiple common formats
      if (q) {
        const parts: string[] = [
          v.institution, v.location, v.department, v.diagnosis, v.physician, v.reason,
        ].filter(Boolean) as string[]
        // Gregorian + 民國(ROC) date tokens so 2025/11/20 and 114/11/20 both match.
        if (v.date) parts.push(...dateSearchTokens(v.date))
        const d = encounterDetails.get(v.id)
        if (d) {
          for (const t of d.tests) {
            if (t.title) parts.push(t.title)
            if (t.value) parts.push(t.value)
            if (Array.isArray(t.components)) {
              for (const c of t.components) {
                if (c.title) parts.push(c.title)
                if (c.value) parts.push(c.value)
              }
            }
          }
          for (const m of d.medications) {
            if (m.title) parts.push(m.title)
            if (m.searchHaystack) parts.push(m.searchHaystack)
          }
          for (const p of d.procedures) {
            if (p.title) parts.push(p.title)
          }
          for (const dx of d.diagnoses) {
            if (dx.title) parts.push(dx.title)
            if (dx.code) parts.push(dx.code)
          }
        }
        const haystack = parts.join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    // sort
    const cmp = (() => {
      if (sortMode === 'date-asc') {
        return (a: typeof result[number], b: typeof result[number]) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      }
      if (sortMode === 'abnormal') {
        return (a: typeof result[number], b: typeof result[number]) => {
          const ab = visitStats.get(a.id)?.abnormalCount ?? 0
          const bb = visitStats.get(b.id)?.abnormalCount ?? 0
          if (ab !== bb) return bb - ab
          return new Date(b.date).getTime() - new Date(a.date).getTime()
        }
      }
      return (a: typeof result[number], b: typeof result[number]) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    })()

    return [...result].sort(cmp)
  }, [
    visitHistory,
    careDisciplineFilter,
    typeFilter,
    institutionFilter,
    contentFlags,
    searchQuery,
    sortMode,
    visitStats,
    docsByEncounter,
    encounterDetails,
  ])

  // Procedure resources render inside their parent visit rather than as
  // top-level cards. Reveal that visit first; once expanded, ProcedureRow's
  // resource anchor consumes the pending request and pinpoints the exact row.
  // The same reveal step also makes older Encounter citations navigable when
  // progressive rendering has not mounted their row yet.
  useEffect(() => {
    const encounterId = navigationEncounterId(pendingNavigation, procedures)
    if (!encounterId) return

    const navigationVisibleCount = visibleCountForNavigation(
      visitHistory,
      encounterId,
      VISIT_PAGE_SIZE,
    )
    if (!navigationVisibleCount) return

    // Schedule after the current commit: the navigation request itself is an
    // external store update, and the destination reveal is its UI response.
    const revealTimer = window.setTimeout(() => {
      setTypeFilter('all')
      setCareDisciplineFilter('all')
      setInstitutionFilter('all')
      setContentFlags(new Set())
      setSearchQuery('')
      setSortMode('date-desc')
      setVisibleCount(navigationVisibleCount)

      if (pendingNavigation?.resourceType === 'Procedure') {
        setExpandedVisitIds((previous) => {
          if (previous.has(encounterId)) return previous
          const next = new Set(previous)
          next.add(encounterId)
          return next
        })
      }
    }, 0)

    return () => window.clearTimeout(revealTimer)
  }, [pendingNavigation, navigationSequence, procedures, visitHistory])

  const visibleVisits = filteredVisits.slice(0, visibleCount)
  const remainingVisits = filteredVisits.length - visibleVisits.length

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleFilterChange = (f: VisitTypeFilter) => {
    setTypeFilter(f)
    setExpandedVisitIds(new Set())
    setVisibleCount(VISIT_PAGE_SIZE)
  }
  const handleCareDisciplineFilterChange = (f: CareDisciplineFilter) => {
    setCareDisciplineFilter(f)
    setExpandedVisitIds(new Set())
    setVisibleCount(VISIT_PAGE_SIZE)
  }
  const toggleContent = (f: ContentFlag) => {
    setContentFlags((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f); else next.add(f)
      return next
    })
    setExpandedVisitIds(new Set())
    setVisibleCount(VISIT_PAGE_SIZE)
  }
  const clearAllFilters = () => {
    setCareDisciplineFilter('all')
    setTypeFilter('all')
    setInstitutionFilter('all')
    setContentFlags(new Set())
    setSearchQuery('')
    setSortMode('date-desc')
    setVisibleCount(VISIT_PAGE_SIZE)
  }
  const hasActiveFilters =
    careDisciplineFilter !== 'all' ||
    typeFilter !== 'all' ||
    institutionFilter !== 'all' ||
    contentFlags.size > 0 ||
    searchQuery.trim() !== '' ||
    sortMode !== 'date-desc'

  const vt = (t.visitHistory as any)

  // ── Render ────────────────────────────────────────────────────────────
  // No CardHeader/title here — the 就診紀錄 tab label already identifies this
  // card, so the heading would be redundant. Mobile spacing mirrors the
  // compact FeatureCard rhythm; md+ keeps the established desktop density.
  return (
    <Card className={`${CARD_BORDER_CLASSES.clinical} gap-2 py-2 md:py-3`} data-tour="visits-card">
      <CardContent className="px-3 sm:px-5">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t.common.loading}</div>
        ) : error ? (
          <div className="text-sm text-destructive">
            {error instanceof Error ? error.message : t.errors.fetchClinicalData}
          </div>
        ) : visitHistory.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t.procedures.noData}</div>
        ) : (
          <div className="space-y-2 md:space-y-3">
            {/* ── Search + sort row (sort isn't a filter, so it stays here;
                the actual filters live on the row below). ────────────────── */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 md:flex md:flex-wrap">
              <div className="relative min-w-0 md:flex-1 md:min-w-[160px]">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setVisibleCount(VISIT_PAGE_SIZE)
                  }}
                  placeholder={vt.searchPlaceholder}
                  // 16px on phones: anything smaller makes iOS Safari zoom on focus.
                  className="min-h-[36px] w-full rounded-md border bg-background py-0 pl-7 pr-7 text-[16px] focus:outline-none focus:ring-2 focus:ring-ring/40 md:min-h-0 md:py-1.5 md:text-xs [&::-webkit-search-cancel-button]:appearance-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      setVisibleCount(VISIT_PAGE_SIZE)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center max-md:-m-2 max-md:min-h-[36px] max-md:min-w-[36px] max-md:p-2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={(e) => {
                  setSortMode(e.target.value as SortMode)
                  setVisibleCount(VISIT_PAGE_SIZE)
                }}
                className="min-h-[36px] rounded-md border bg-background px-2 py-0 text-[16px] focus:outline-none focus:ring-2 focus:ring-ring/40 md:min-h-0 md:py-1.5 md:text-xs"
                aria-label={vt.sortLabel}
              >
                <option value="date-desc">{vt.sortDateDesc}</option>
                <option value="date-asc">{vt.sortDateAsc}</option>
                <option value="abnormal">{vt.sortAbnormal}</option>
              </select>
            </div>

            {/* ── Filters row: keep every filter in one compact horizontal strip.
                On narrow phones the strip, rather than the whole card, owns
                horizontal scrolling; the result count remains pinned at right. */}
            <div className="flex items-center gap-1">
              <div
                data-testid="visit-filter-strip"
                role="group"
                aria-label={vt.filtersLabel ?? '就診篩選'}
                className="scroll-hint-x flex min-w-0 flex-1 touch-pan-x flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-visible md:bg-none"
              >
              {/* NHI care discipline is independent from visit setting:
                  e.g. both western and dental records can be outpatient. */}
              <CompactFilterSelect
                value={careDisciplineFilter}
                aria-label={vt.careDisciplineLabel}
                triggerLabel={careDisciplineFilter === 'all'
                  ? vt.careDisciplineCompact
                  : vt.careDisciplines[careDisciplineFilter]}
                options={CARE_DISCIPLINES.map((discipline) => ({
                  value: discipline,
                  label: discipline === 'all'
                    ? vt.careDisciplineCompact
                    : `${vt.careDisciplines[discipline]} (${careDisciplineCounts[discipline]})`,
                }))}
                onValueChange={(value) => handleCareDisciplineFilterChange(
                  value as CareDisciplineFilter,
                )}
              />
              {/* 就診類型 is single-select (擇一), so a dropdown is both
                  semantically right and far more compact than five chips; counts
                  stay visible inside each option, e.g. "門診 (117)". */}
              <CompactFilterSelect
                value={typeFilter}
                aria-label={(vt as any).typeLabel ?? '就診類型'}
                triggerLabel={typeFilter === 'all' ? vt.typeCompact : vt.badges[typeFilter]}
                options={FILTER_TYPES.flatMap((f) => {
                  const label = f === 'all' ? vt.typeCompact : vt.badges[f]
                  const count = counts[f]
                  if (f !== 'all' && count === 0) return []
                  return [{ value: f, label: f === 'all' ? label : `${label} (${count})` }]
                })}
                onValueChange={(value) => handleFilterChange(value as VisitTypeFilter)}
              />
              {institutions.length > 0 && (
                <InstitutionFilterSelect
                  value={institutionFilter}
                  institutions={institutions}
                  allLabel={vt.institutionCompact}
                  ariaLabel={vt.institutionAll}
                  onValueChange={(value) => {
                    setInstitutionFilter(value)
                    setExpandedVisitIds(new Set())
                    setVisibleCount(VISIT_PAGE_SIZE)
                  }}
                />
              )}
              {/* Divider between the single-select filters and the content toggles */}
              <span className="mx-0.5 h-4 w-px shrink-0 bg-border @max-[36rem]:hidden" aria-hidden />
              <ContentToggle
                label={vt.medications}
                accessibleLabel={vt.hasMedications}
                active={contentFlags.has('medications')}
                onClick={() => toggleContent('medications')}
              />
              <ContentToggle
                label={vt.tests}
                accessibleLabel={vt.hasTests}
                active={contentFlags.has('tests')}
                onClick={() => toggleContent('tests')}
              />
              <ContentToggle
                label={vt.examReportsShort}
                accessibleLabel={vt.hasReports}
                active={contentFlags.has('reports')}
                onClick={() => toggleContent('reports')}
              />
              <ContentToggle
                label={vt.procedures}
                accessibleLabel={vt.hasProcedures}
                active={contentFlags.has('procedures')}
                onClick={() => toggleContent('procedures')}
              />
              {/* 含出院病摘 — only offered when the dataset actually has one
                  (discharge summaries are inpatient-only and relatively rare). */}
              {hasAnyDischargeSummary && (
                <ContentToggle
                  label={(vt as any).dischargeShort ?? '病摘'}
                  accessibleLabel={(vt as any).hasDischarge ?? '含出院病摘'}
                  active={contentFlags.has('discharge')}
                  onClick={() => toggleContent('discharge')}
                />
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  aria-label={vt.clearFilters}
                  title={vt.clearFilters}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground @max-[36rem]:size-[28px] @max-[36rem]:justify-center @max-[36rem]:p-0"
                >
                  <X className="h-3 w-3" />
                  <span className="@max-[36rem]:hidden">{vt.clearFiltersShort}</span>
                </button>
              )}
              </div>
              {/* Result count — right-aligned at the end of the filters row. */}
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {hasActiveFilters
                  ? `${filteredVisits.length} / ${visitHistory.length} ${vt.recordsUnit}`
                  : `${visitHistory.length} ${vt.recordsUnit}`}
              </span>
            </div>

            {/* ── Visit list ─────────────────────────────────────────── */}
            {filteredVisits.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <AlertCircle className="h-5 w-5" />
                <span>{vt.noMatch}</span>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted"
                  >
                    {vt.clearFilters}
                  </button>
                )}
              </div>
            ) : (
              // Match the report list's dense rhythm: rows sit directly against
              // each other, while each VisitItem keeps its own border/radius.
              // more collapsed visits fit on screen at once. border-t keeps the
              // filters visually separated from the list now that the standalone
              // count row (which carried that divider) is gone.
              <div className="space-y-0 border-t pt-1 md:pt-1.5">
                {visibleVisits.map((visit) => (
                  <VisitItem
                    key={visit.id}
                    visit={visit}
                    details={encounterDetails.get(visit.id)}
                    documents={docsByEncounter.get(visit.id)}
                    abnormalCount={visitStats.get(visit.id)?.abnormalCount ?? 0}
                    isExpanded={expandedVisitIds.has(visit.id)}
                    onToggle={toggleVisit}
                  />
                ))}
                {remainingVisits > 0 && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + VISIT_PAGE_SIZE)}
                    className="w-full rounded-md border border-dashed py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {(vt.showMore ?? '顯示更多')} ({remainingVisits})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ContentToggle({
  label, accessibleLabel, active, onClick,
}: { label: string; accessibleLabel: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      aria-pressed={active}
      title={accessibleLabel}
      className={cn(
        // Narrow containers keep the full px-2 rather than dropping to px-1:
        // the width the three selects gave up (56/56/112px → 4/4/5.25rem) is
        // spent here so the chips read as tappable pills instead of bare
        // labels. px-2 is already rem-based, so a chip scales with the
        // user-settable root font exactly like the selects do.
        // Default-state strip math at the 12px phone baseline / 375px, against
        // the strip's MEASURED 305px clientWidth (the 「39 筆」 count + outer
        // gap take ~38px of the row):
        // 48+48+63 + 4×32 + 6 gaps ×3 = 305px — an exact fit, one row, no
        // horizontal scrolling. Any widening here re-clips the last chip, so
        // re-measure rather than eyeball if these paddings change. At a larger
        // root font on a narrow phone the strip may scroll; flex-nowrap still
        // guarantees one row.
        "inline-flex min-h-[28px] shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

function CompactFilterSelect({
  value,
  triggerLabel,
  options,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  value: string
  triggerLabel: string
  options: Array<{ value: string; label: string }>
  onValueChange: (value: string) => void
  'aria-label': string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        title={triggerLabel}
        // Phone width must be REM, not px: the root font-size is user-settable
        // (font-size.provider.tsx, 12–20px), and text-xs/gap/padding all scale
        // with it — a literal px box would keep its size while the label grew,
        // truncating 醫別 to 醫∨. Every trigger label and option value is 2 CJK
        // glyphs (醫別/西醫/門診/藥局…), so the content is
        // 2 (border) + px-1 + 2 glyphs + gap-1 + chevron ≈ 3.4rem + 2px,
        // i.e. 41px at the 12px phone baseline — 4rem (48px @12, 64px @16,
        // 80px @20) clears it at every step while freeing width for the
        // content chips later in the strip.
        className="min-h-[36px] w-[4rem] shrink-0 gap-1 bg-background px-1 py-0 text-xs shadow-none data-[size=sm]:h-auto md:min-h-7 md:w-[3.75rem] md:gap-1.5 md:px-1.5 md:py-1"
      >
        <SelectValue>
          <span className="block min-w-0 truncate">{triggerLabel}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
