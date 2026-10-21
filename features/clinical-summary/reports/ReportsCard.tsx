// Refactored ReportsCard Component
"use client"

import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  SUBTAB_LIST_CLASSES,
  SUBTAB_TRIGGER_CLASSES,
} from "@/src/shared/config/ui-theme.config"
import { Maximize2, Minimize2, Search, X, Loader2 } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import {
  useResourceNavigationStore,
  type ResourceNavTarget,
} from "@/src/application/stores/resource-navigation.store"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { useReportsData } from './hooks/useReportsData'
import { useOrphanObservations } from './hooks/useOrphanObservations'
import { useProcedureRows } from './hooks/useProcedureRows'
import { useGroupedRows } from './hooks/useGroupedRows'
import { useReportTabCounts } from './hooks/useReportTabCounts'
import { groupMultiRegionStudies } from './utils/multi-region-grouping'
import { groupLabReportsByDay } from './utils/lab-day-grouping'
import { ReportsTabContent } from './components/ReportsTabContent'
import { CumulativeLabReport } from './components/CumulativeLabReport'
import type { Row } from './types'
import { rowInnerMatch, rowMatchesSearch } from './utils/report-search'
import { categorizeObservation, LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'
import { getLabPivotTestIdentity } from '@/src/shared/utils/lab-pivot.utils'
import { cn } from '@/src/shared/utils/cn.utils'
import { ReportNameModeProvider } from './context/report-name-mode.context'
import { ReportNameModeSwitch } from './components/ReportNameModeSwitch'
import { REPORT_ACTIVE_CONTROL_TONE } from './components/report-color-roles'
import {
  PROCEDURE_CATEGORY_CODES,
  type ProcedureCategoryCode,
} from './utils/procedure-category'
import type { AnalyteNameMode } from '@voho0000/clinical-lab-normalization/display'
import { useLeftBrowserTourStore } from '@/features/left-browser-tour'
import type { TrendWindow } from './utils/trend-time-scale'
import { useClinicalTabActivity } from '@/src/application/providers/clinical-tab-activity.provider'
import { groupCancerScreeningRows } from './utils/cancer-screening-grouping'
import { markUserTrigger, useTrackView } from '@/src/application/telemetry/usage-analytics'
import { groupAdultPreventiveRows } from './utils/adult-preventive-grouping'

// Stable empty array so React.memo / virtualizer keep skipping when no
// search match needs expansion. Recreating [] every render would break
// referential equality on the prop.
const EMPTY_EXPANDED_IDS: string[] = []
const EMPTY_RESOURCES: any[] = []
const CUMULATIVE_CATEGORY_IDS = new Set(LAB_CATEGORIES.map((category) => category.id))
const NAME_MODE_TABS = new Set(['cumulative', 'all', 'lab', 'imaging', 'pathology', 'vitals'])
type ProcedureCategoryFilter = 'all' | 'uncategorized' | ProcedureCategoryCode
type RawPreparationPriority = 'idle' | 'after-paint'
// Clip rounded edges without creating a scroll container: the cumulative
// category bar must stick to the report panel's actual scrolling viewport.
const REPORT_CARD_CLASS = 'overflow-clip rounded-none border-0 bg-transparent shadow-none hover:shadow-none'

interface CumulativeSourceFocus {
  categoryId: string
  analyteKey?: string
  date?: string
}

/** Resolve one cited Observation to the exact cumulative-report column and
 * collection-date row. Explicit destinations still win; Table 1 only needs to
 * ask for the cumulative view and the report workspace can derive the rest
 * from the original FHIR resource without duplicating lab-normalisation rules. */
export function resolveCumulativeSourceFocus(
  target: ResourceNavTarget | null | undefined,
  observations: readonly any[],
): CumulativeSourceFocus | null {
  if (target?.reportView !== 'cumulative') return null
  if (target.cumulativeCategoryId && CUMULATIVE_CATEGORY_IDS.has(target.cumulativeCategoryId)) {
    return {
      categoryId: target.cumulativeCategoryId,
      analyteKey: target.cumulativeAnalyteKey,
      date: target.date?.slice(0, 10),
    }
  }
  if (target.resourceType !== 'Observation') return null
  const observation = observations.find((candidate) => candidate?.id === target.resourceId)
  if (!observation) return null
  const category = categorizeObservation(observation)
  if (!category || !CUMULATIVE_CATEGORY_IDS.has(category.id)) return null
  const identity = getLabPivotTestIdentity(observation, category.id, 'standardized')
  return {
    categoryId: category.id,
    analyteKey: identity.testKey,
    date: (observation.effectiveDateTime ?? target.date)?.slice(0, 10),
  }
}

export function ReportsCard() {
  const { t } = useLanguage()
  const clinicalTabActive = useClinicalTabActivity()
  const {
    diagnosticReports = [],
    imagingStudies = [],
    observations = [],
    procedures = [],
    compositions = [],
    resourceReady,
    error,
  } = useClinicalData()
  // Per-type gate: the tabs mix four resource types, and a row set built while
  // one of them is still in flight would read as "no reports". The rest of the
  // chart (medications, encounters, documents…) is none of this card's business.
  const isLoading = !resourceReady.diagnosticReports
    || !resourceReady.imagingStudies
    || !resourceReady.observations
    || !resourceReady.procedures
  const [activeTab, setActiveTab] = useState("cumulative")
  const tourActive = useLeftBrowserTourStore((state) => state.active)
  const tourStep = useLeftBrowserTourStore((state) => state.stepId)
  // The cumulative destination only needs Observation pivots. Defer the much
  // heavier raw-report pipeline (DR grouping, narrative dedup, orphan rows,
  // day grouping) until a raw tab is actually requested.
  const initialPendingReport = useResourceNavigationStore.getState().pending
  const [rawReportsEnabled, setRawReportsEnabled] = useState(false)
  const [rawPreparationPriority, setRawPreparationPriority] =
    useState<RawPreparationPriority | null>(() => (
      initialPendingReport && initialPendingReport.reportView !== 'cumulative'
        ? 'after-paint'
        : null
    ))
  // The shell and tabs should be able to commit before the cumulative pivot is
  // constructed. When Reports has been idle-mounted by the outer workspace,
  // this preparation finishes invisibly; on an immediate user click, a compact
  // loading state gets the first paint instead of a frozen old tab.
  const [cumulativeReady, setCumulativeReady] = useState(false)
  // Keep the large report arrays behind a tab-local snapshot. React Query can
  // settle while Reports is hidden; feeding those fresh arrays straight into
  // the cumulative table would still rebuild its pivots off-screen and block
  // the primary tab bar. The snapshot advances only after Reports is visible
  // and its loading frame has painted.
  const [cumulativeSource, setCumulativeSource] = useState(() => ({
    diagnosticReports: EMPTY_RESOURCES,
    imagingStudies: EMPTY_RESOURCES,
    observations: EMPTY_RESOURCES,
    procedures: EMPTY_RESOURCES,
  }))
  const cumulativeSourceIsCurrent =
    cumulativeSource.diagnosticReports === diagnosticReports
    && cumulativeSource.imagingStudies === imagingStudies
    && cumulativeSource.observations === observations
    && cumulativeSource.procedures === procedures
  const cumulativePrepared = cumulativeReady && cumulativeSourceIsCurrent
  // Lifted here (not inside CumulativeLabReport) so the selected cumulative
  // sub-category (生化 …) survives the fullscreen toggle, which remounts the
  // reports content under a different parent.
  const initialCumulativeFocus = resolveCumulativeSourceFocus(
    useResourceNavigationStore.getState().pending,
    observations,
  )
  const [cumulativeCategoryId, setCumulativeCategoryId] = useState<string | undefined>(
    () => initialCumulativeFocus?.categoryId,
  )
  const [cumulativeFocus, setCumulativeFocus] = useState<{
    analyteKey: string
    date?: string
    nonce: number
  } | null>(() => initialCumulativeFocus?.analyteKey
    ? {
        analyteKey: initialCumulativeFocus.analyteKey,
        date: initialCumulativeFocus.date,
        nonce: useResourceNavigationStore.getState().seq,
      }
    : null)
  // A trend range is a comparison preference, not an analyte default. Keep the
  // user's explicit choice while they move between tests or fullscreen modes.
  const [cumulativeTrendWindow, setCumulativeTrendWindow] = useState<TrendWindow>()
  // The category actually on screen, reported back by the table. Kept separate
  // from `cumulativeCategoryId` (the parent-controlled selection) because the
  // table falls back to its own first-non-empty category when the parent has
  // none — which is the case for every session until the first manual pick.
  const [resolvedCumulativeCategory, setResolvedCumulativeCategory] =
    useState<string | undefined>()
  const cumulativeNameModeControl = useMemo(
    () => <ReportNameModeSwitch responsiveLabels />,
    [],
  )
  const handleCumulativeCategoryChange = useCallback((categoryId: string) => {
    markUserTrigger('cumulative')
    setCumulativeCategoryId(categoryId)
    setCumulativeFocus(null)
  }, [])
  // Tabs the user has visited at least once in this session. We forceMount
  // only these so the *first* paint of ReportsCard (e.g. when the user
  // switches from "病人資訊" to "報告") doesn't have to mount 500+ rows of
  // every sub-tab at once — only the default tab gets work upfront. Once
  // a sub-tab is visited, it stays mounted so subsequent tab switches are
  // instant (the original perf goal).
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['cumulative']))
  // A raw tab is selected immediately. If its shared row projection has not
  // finished warming yet, that tab shows a small preparation state while the
  // heavy work begins only after the selected state has painted.
  const [pendingTab, setPendingTab] = useState<string | null>(null)
  const handleTabChange = (val: string) => {
    markUserTrigger('reports')
    setSearchQuery("")
    setActiveTab(val)
    setVisitedTabs(prev => prev.has(val) ? prev : new Set(prev).add(val))
    if (val !== 'cumulative' && !rawReportsEnabled) {
      setPendingTab(val)
      setRawPreparationPriority('after-paint')
    } else {
      setPendingTab(null)
    }
  }
  const [expanded, setExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [procedureCategoryFilter, setProcedureCategoryFilter] =
    useState<ProcedureCategoryFilter>('all')
  const [nameMode, setNameMode] = useState<AnalyteNameMode>('standardized')

  // Usage analytics. Both are gated on `clinicalTabActive`: this card stays
  // mounted once the 報告 clinical tab has been visited, so without the gate it
  // would report once per session while the left panel reports every visit.
  //
  // The cumulative category comes from the table's own resolved default (see
  // `onActiveCategoryResolved`), not from `cumulativeCategoryId`, which stays
  // undefined until the user picks — the default category is the most-viewed
  // one by definition. It is additionally gated on the cumulative sub-tab
  // being selected, because CumulativeLabReport stays force-mounted while the
  // user reads 全部 / 檢驗 / 影像.
  useTrackView('reports', activeTab, clinicalTabActive)
  useTrackView(
    'cumulative',
    resolvedCumulativeCategory,
    clinicalTabActive && activeTab === 'cumulative',
  )

  useEffect(() => {
    // Idle-mount only the lightweight Reports shell. Preparing the cumulative
    // pivot while this top-level tab is hidden makes the final clinical-data
    // delivery compete with the tab bar for the main thread. Wait until the
    // clinician actually opens Reports, paint its loading state, then prepare
    // the pivot in a transition.
    if (
      !clinicalTabActive
      || isLoading
      || (cumulativeReady && cumulativeSourceIsCurrent)
    ) return
    let timer: number | undefined
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        startTransition(() => {
          setCumulativeSource({
            diagnosticReports,
            imagingStudies,
            observations,
            procedures,
          })
          setCumulativeReady(true)
        })
      }, 0)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    clinicalTabActive,
    cumulativeReady,
    cumulativeSourceIsCurrent,
    diagnosticReports,
    imagingStudies,
    isLoading,
    observations,
    procedures,
  ])

  useEffect(() => {
    if (rawReportsEnabled) return
    // The cumulative view already has lightweight counts and Observation
    // pivots. Do not build every raw report row merely because the browser is
    // momentarily idle: that background projection can block a workspace tab
    // click while the initial chart is still loading. A concrete raw tab,
    // resource navigation, or tour step sets the preparation priority and gets
    // the same after-paint loading behavior on demand.
    const priority = rawPreparationPriority
    if (priority === null) return

    let cancelled = false
    let timer: number | undefined
    let idleId: number | undefined
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const enableRawReports = () => {
      if (cancelled) return
      startTransition(() => {
        setRawReportsEnabled(true)
        setRawPreparationPriority(null)
        setPendingTab(null)
      })
    }
    const frame = window.requestAnimationFrame(() => {
      if (priority === 'idle' && browserWindow.requestIdleCallback) {
        idleId = browserWindow.requestIdleCallback(enableRawReports, { timeout: 1400 })
      } else {
        timer = window.setTimeout(
          enableRawReports,
          priority === 'after-paint' ? 0 : 160,
        )
      }
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (timer !== undefined) window.clearTimeout(timer)
      if (idleId !== undefined) browserWindow.cancelIdleCallback?.(idleId)
    }
  }, [rawPreparationPriority, rawReportsEnabled])

  // Open a concrete raw-report view for the trend / imaging tour steps. The
  // report card unmounts when the outer tour moves away, so its normal default
  // is restored naturally after the tour.
  useEffect(() => {
    if (!tourActive || !tourStep) return
    const target = tourStep === 'reports'
      ? 'cumulative'
      : tourStep === 'trend'
        ? 'all'
        : tourStep === 'imaging-ai'
          ? 'imaging'
          : null
    if (!target) return
    const timer = window.setTimeout(() => {
      if (target !== 'cumulative' && !rawReportsEnabled) {
        setRawPreparationPriority('after-paint')
        setPendingTab(target)
      }
      setSearchQuery('')
      setActiveTab(target)
      setVisitedTabs((previous) => previous.has(target) ? previous : new Set(previous).add(target))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [rawReportsEnabled, tourActive, tourStep])
  // The same preference follows the user across report views whose titles can
  // be normalized. Procedures have no matching control, so they retain their
  // established standardized labels.
  const effectiveNameMode: AnalyteNameMode = NAME_MODE_TABS.has(activeTab)
    ? nameMode
    : 'standardized'

  // The source resources are already cached by useClinicalData. Build only a
  // lightweight identity/category index here so tab counts are useful on the
  // cumulative view without paying for report text decoding, localization, or
  // full Row construction. The exact rendered counts take over as soon as the
  // raw-report pipeline is enabled.
  const initialTabCounts = useReportTabCounts(
    cumulativePrepared ? cumulativeSource.diagnosticReports : EMPTY_RESOURCES,
    cumulativePrepared ? cumulativeSource.imagingStudies : EMPTY_RESOURCES,
    cumulativePrepared ? cumulativeSource.observations : EMPTY_RESOURCES,
    cumulativePrepared ? cumulativeSource.procedures : EMPTY_RESOURCES,
    !rawReportsEnabled,
    compositions,
  )

  const { reportRows, seenIds } = useReportsData(
    rawReportsEnabled ? diagnosticReports : EMPTY_RESOURCES,
    rawReportsEnabled ? imagingStudies : EMPTY_RESOURCES,
    effectiveNameMode,
  )
  const procedureRows = useProcedureRows(
    rawReportsEnabled ? procedures : EMPTY_RESOURCES,
  )

  const orphanRows = useOrphanObservations(
    rawReportsEnabled ? observations : EMPTY_RESOURCES,
    seenIds,
    effectiveNameMode,
    rawReportsEnabled ? compositions : EMPTY_RESOURCES,
  )

  // ── Resource navigation (cited DiagnosticReport/Observation in the
  // Medical Summary tab) ────────────────────────────────────────────────
  // Rows are virtualised AND live behind sub-tabs, so this card claims the
  // navigation itself: pick the sub-tab containing the row, then hand the
  // row id to ReportsTabContent which scrolls/expands/flashes it.
  const [navTarget, setNavTarget] = useState<{ id: string; tab: string; nonce: number } | null>(null)
  const resolveNavTarget = useCallback((nonce?: number) => {
    if (nonce === undefined) return
    const state = useResourceNavigationStore.getState()
    if (state.pending && state.seq === nonce) state.consume()
    setNavTarget((current) => current?.nonce === nonce ? null : current)
  }, [])

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [...reportRows, ...orphanRows, ...procedureRows] as Row[]
    all.sort((a, b) => {
      const dateA = a.obs[0]?.effectiveDateTime
      const dateB = b.obs[0]?.effectiveDateTime
      const timeA = dateA ? new Date(dateA).getTime() : 0
      const timeB = dateB ? new Date(dateB).getTime() : 0
      return timeB - timeA
    })
    // Detect same-title rows sharing the same calendar date → need time for disambiguation
    const titleDateCount = new Map<string, number>()
    for (const row of all) {
      const dateOnly = row.effectiveDate
        ? new Date(row.effectiveDate).toISOString().slice(0, 10)
        : ''
      const key = `${row.title}|${dateOnly}`
      titleDateCount.set(key, (titleDateCount.get(key) || 0) + 1)
    }
    for (const row of all) {
      const dateOnly = row.effectiveDate
        ? new Date(row.effectiveDate).toISOString().slice(0, 10)
        : ''
      const key = `${row.title}|${dateOnly}`
      if ((titleDateCount.get(key) || 0) > 1) row.showTime = true
    }

    // Detect possible duplicates: same title + date + institution + single-obs value
    const dupKey = (row: Row) => {
      const dateOnly = row.effectiveDate
        ? new Date(row.effectiveDate).toISOString().slice(0, 10)
        : ''
      const singleValue = row.obs.length === 1
        ? (row.obs[0]?.valueQuantity?.value ?? row.obs[0]?.valueString ?? '')
        : ''
      return `${row.title}|${dateOnly}|${row.institution ?? ''}|${singleValue}`
    }
    const dupCount = new Map<string, number>()
    for (const row of all) {
      const k = dupKey(row)
      dupCount.set(k, (dupCount.get(k) || 0) + 1)
    }
    for (const row of all) {
      if ((dupCount.get(dupKey(row)) || 0) > 1) row.isPossibleDuplicate = true
    }

    return groupCancerScreeningRows(all)
  }, [reportRows, orphanRows, procedureRows])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => rowMatchesSearch(row, q))
  }, [rows, searchQuery])

  // Ids of rows whose match came from inner observations — we auto-expand
  // their accordions so the user can see what was matched without an extra
  // click. Rows that matched on their own title don't need expansion.
  const expandedRowIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return EMPTY_EXPANDED_IDS
    const ids: string[] = []
    for (const row of filteredRows) {
      // Skip if the row itself already matches on title — no need to expand.
      if (row.title.toLowerCase().includes(q)) continue
      if (
        rowInnerMatch(row, q)
        || row.groupedRows?.some((member) => rowMatchesSearch(member, q))
      ) ids.push(row.id)
    }
    // Preserve referential equality across renders when nothing changes so
    // React.memo on ReportRow keeps skipping.
    return ids.length === 0 ? EMPTY_EXPANDED_IDS : ids
  }, [filteredRows, searchQuery])

  const groupedRows = useGroupedRows(filteredRows)
  // The All tab reads one adult preventive-care encounter as one expandable
  // source document. Category tabs keep their existing specialized grouping.
  const allRows = useMemo(
    () => groupAdultPreventiveRows(groupedRows.all),
    [groupedRows.all],
  )

  const procedureCategoryCounts = useMemo(() => {
    const counts: Record<Exclude<ProcedureCategoryFilter, 'all'>, number> = {
      'surgical-procedure': 0,
      'major-procedure': 0,
      'outpatient-treatment': 0,
      uncategorized: 0,
    }
    for (const row of groupedRows.procedures) {
      counts[row.procedureCategory ?? 'uncategorized'] += 1
    }
    return counts
  }, [groupedRows.procedures])

  const filteredProcedureRows = useMemo(() => {
    if (procedureCategoryFilter === 'all') return groupedRows.procedures
    return groupedRows.procedures.filter(
      (row) => (row.procedureCategory ?? 'uncategorized') === procedureCategoryFilter,
    )
  }, [groupedRows.procedures, procedureCategoryFilter])

  const procedureCategoryOptions = useMemo(() => {
    // Some embedded/test language providers may expose only the Reports
    // namespace. Keep the card renderable until a procedure tab is present.
    const labels = t.procedures ?? {
      categoryAll: 'All',
      categoryUncategorized: 'Uncategorized',
      categoryLabels: {
        'surgical-procedure': 'Surgical procedure',
        'major-procedure': 'Major procedure',
        'outpatient-treatment': 'Outpatient treatment',
      },
    }
    const options: Array<{
      value: ProcedureCategoryFilter
      label: string
      count: number
    }> = [{
      value: 'all',
      label: labels.categoryAll,
      count: groupedRows.procedures.length,
    }]

    for (const code of PROCEDURE_CATEGORY_CODES) {
      const count = procedureCategoryCounts[code]
      if (count > 0 || procedureCategoryFilter === code) {
        options.push({
          value: code,
          label: labels.categoryLabels[code],
          count,
        })
      }
    }

    if (
      procedureCategoryCounts.uncategorized > 0
      || procedureCategoryFilter === 'uncategorized'
    ) {
      options.push({
        value: 'uncategorized',
        label: labels.categoryUncategorized,
        count: procedureCategoryCounts.uncategorized,
      })
    }
    return options
  }, [
    groupedRows.procedures.length,
    procedureCategoryCounts,
    procedureCategoryFilter,
    t,
  ])

  // Apply multi-region NHI study grouping to the imaging tab. Same-day
  // same-code studies (typical CT/MRI multi-region exams that NHI bills
  // under one code without a body-part field) collapse into a single
  // synthetic group row that ReportRow dispatches to MultiRegionStudyCard.
  // See features/.../utils/multi-region-grouping.ts and bridge v0.17.1's
  // SMART-side guidance for the rationale.
  const imagingRows = useMemo(
    () => groupMultiRegionStudies(groupedRows.imaging),
    [groupedRows.imaging],
  )

  // Lab tab: 健保存摺 ships one DR per analyte, so the default view folds
  // same-(collection day, institution, source program) reports into one
  // LabDayGroupCard —
  // the hospital's「一天一張檢驗單」reading unit. The flat single-item list
  // stays one toggle away. Grouping runs on the FILTERED rows so a search
  // shows day groups containing exactly the matching members.
  const [labByDay, setLabByDay] = useState(true)
  const labRows = useMemo(
    () => (labByDay ? groupLabReportsByDay(groupedRows.lab) : groupedRows.lab),
    [groupedRows.lab, labByDay],
  )

  const tabConfigs = useMemo(() => {
    const { tabs: reportTabs } = t.reports
    const cumulativeLabel = (reportTabs as any).cumulative || 'Cumulative'
    const exactCounts = {
      all: allRows.length,
      lab: labRows.length,
      imaging: imagingRows.length,
      pathology: groupedRows.pathology.length,
      cancerScreening: groupedRows.cancerScreening.length,
      vitals: groupedRows.vitals.length,
      procedures: filteredProcedureRows.length,
    }
    const displayCounts = rawReportsEnabled ? exactCounts : initialTabCounts
    const withCount = (label: string, count?: number) => (
      typeof count === 'number' ? `${label} (${count})` : label
    )
    const configs = [
      { value: "cumulative", label: cumulativeLabel, rows: [] as Row[], isCumulative: true },
      { value: "all", label: withCount(reportTabs.all, displayCounts?.all), rows: allRows, isCumulative: false },
      // Badge count follows the active view (day groups vs single items),
      // matching the imaging precedent: the number shown = cards clickable.
      { value: "lab", label: withCount(reportTabs.lab, displayCounts?.lab), rows: labRows, isCumulative: false },
      // Tab badge count reflects the post-grouping list (a 6-row multi-region
      // CT now reads as 1 row in the badge), so the number a user sees and
      // the cards they can click on match.
      { value: "imaging", label: withCount(reportTabs.imaging, displayCounts?.imaging), rows: imagingRows, isCumulative: false },
      { value: "pathology", label: withCount(reportTabs.pathology, displayCounts?.pathology), rows: groupedRows.pathology, isCumulative: false },
      { value: "cancer-screening", label: withCount(reportTabs.cancerScreening, displayCounts?.cancerScreening), rows: groupedRows.cancerScreening, isCumulative: false },
      { value: "vitals", label: withCount(reportTabs.vitals, displayCounts?.vitals), rows: groupedRows.vitals, isCumulative: false },
      { value: "procedures", label: withCount(reportTabs.procedures, displayCounts?.procedures), rows: filteredProcedureRows, isCumulative: false },
    ]
    // Keep the frequent report views in a stable order, including empty
    // Pathology and Cancer screening tabs; only hide Procedures when that
    // source type is absent.
    return configs.filter(
      // Use the underlying resources rather than lazy-built rows so users can
      // open Procedures directly from the default cumulative view.
      (config) => config.value !== "procedures" || procedures.length > 0,
    )
  }, [
    allRows,
    filteredProcedureRows,
    groupedRows,
    imagingRows,
    initialTabCounts,
    labRows,
    procedures.length,
    rawReportsEnabled,
    t,
  ])

  // Claim DiagnosticReport / Observation navigations. Row.id is the DR id;
  // orphan-observation rows carry the obs id, so match either directly or
  // via a member observation. Runs before the early returns below so hook
  // order stays stable across loading states.
  const navPending = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)
  const consumeNav = useResourceNavigationStore((s) => s.consume)
  const cumulativeSourceFocus = useMemo(
    () => resolveCumulativeSourceFocus(navPending, observations),
    [navPending, observations],
  )
  useEffect(() => {
    if (
      !clinicalTabActive
      || !navPending
      || (navPending.reportView === 'cumulative' && cumulativeSourceFocus)
      || rawReportsEnabled
    ) return
    if (!['DiagnosticReport', 'ImagingStudy', 'Observation'].includes(navPending.resourceType)) return
    const timer = window.setTimeout(() => setRawPreparationPriority('after-paint'), 0)
    return () => window.clearTimeout(timer)
  }, [clinicalTabActive, cumulativeSourceFocus, navPending, rawReportsEnabled])

  useEffect(() => {
    // ReportsCard is intentionally mounted in the background so opening the
    // workspace stays responsive. Leave navigation pending while this shell is
    // hidden: LeftPanelLayout owns the top-level tab switch, and only the
    // visible destination may acknowledge and consume the request.
    if (!clinicalTabActive || !navPending) return
    if (navPending.reportView === 'cumulative' && cumulativeSourceFocus) {
      const { categoryId, analyteKey, date } = cumulativeSourceFocus
      consumeNav()
      // Consuming the store request re-runs this effect immediately. Schedule
      // the local view switch independently so that rerender cannot cancel it.
      setTimeout(() => {
        setSearchQuery('')
        setPendingTab(null)
        setActiveTab('cumulative')
        setVisitedTabs((prev) => prev.has('cumulative') ? prev : new Set(prev).add('cumulative'))
        setCumulativeCategoryId(categoryId)
        setCumulativeFocus(analyteKey
          ? { analyteKey, date, nonce: navSeq }
          : null)
        setNavTarget(null)
      }, 0)
      return
    }
    if (!['DiagnosticReport', 'ImagingStudy', 'Observation'].includes(navPending.resourceType)) return
    const hit = rows.find(
      (r) => r.id === navPending.resourceId
        || r.diagnosticReportIds?.includes(navPending.resourceId)
        || r.imagingStudyIds?.includes(navPending.resourceId)
        || r.obs.some((o) => o?.id === navPending.resourceId),
    )
    if (!hit) return // unclaimed → the generic fallback toast explains
    const preferredTabValue = navPending.reportTab
      ?? (hit.group === 'cancer-screening' ? 'cancer-screening' : undefined)
    const containsHit = (candidate: Row) => candidate.id === hit.id
      || candidate.groupedRows?.some((member) => member.id === hit.id)
    const tab = tabConfigs.find((c) => (
      c.value === preferredTabValue && c.rows.some(containsHit)
    )) || tabConfigs.find((c) => !c.isCumulative && c.rows.some(containsHit))
    if (!tab) return
    const targetRow = tab.rows.find(containsHit)
    // Do not use handleTabChange: requestAnimationFrame is frozen in
    // backgrounded tabs. A timer preserves that behaviour while keeping the
    // external-store effect free of synchronous local-state cascades.
    setTimeout(() => {
      setSearchQuery('')
      setActiveTab(tab.value)
      setVisitedTabs((prev) => (prev.has(tab.value) ? prev : new Set(prev).add(tab.value)))
      setNavTarget({ id: targetRow?.id ?? hit.id, tab: tab.value, nonce: navSeq })
    }, 0)
  }, [clinicalTabActive, cumulativeSourceFocus, navPending, navSeq, rows, tabConfigs, consumeNav])

  if (isLoading) {
    return (
      <Card className={REPORT_CARD_CLASS}>
        <CardHeader>
          <CardTitle>{t.reports.title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t.common.loading}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={REPORT_CARD_CLASS}>
        <CardHeader>
          <CardTitle>{t.reports.title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          {t.common.error}: {error?.message || t.errors.unknown}
        </CardContent>
      </Card>
    )
  }

  // `rows` is intentionally empty while raw-report work is deferred on the
  // cumulative tab. It is therefore NOT a valid empty-data signal. Check the
  // underlying clinical resources instead so lazy loading cannot hide the
  // entire ReportsCard (including the cumulative Observation pivot).
  const hasReportResources = diagnosticReports.length > 0
    || imagingStudies.length > 0
    || observations.length > 0
    || procedures.length > 0
  if (!hasReportResources) {
    return (
      <Card className={REPORT_CARD_CLASS}>
        <CardHeader>
          <CardTitle>{t.reports.title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t.reports.noData}
        </CardContent>
      </Card>
    )
  }

  const expandButton = (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      aria-label={expanded ? 'Minimize' : 'Expand to fullscreen'}
      className="reveal-on-hover absolute right-2 top-2 z-30 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:top-1.5 max-md:!min-h-[36px] max-md:!min-w-[36px] lg:min-h-8 lg:min-w-8 @min-[1160px]:px-2"
      title={expanded ? 'Minimize' : 'Expand to fullscreen'}
    >
      {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      <span className="hidden @min-[1160px]:inline">{expanded ? 'Minimize' : 'Fullscreen'}</span>
    </button>
  )

  const reportsContent = (
    <ReportNameModeProvider value={effectiveNameMode} onChange={setNameMode}>
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className={`${expanded ? 'flex h-full w-full min-w-0 flex-col overflow-hidden' : 'w-full min-w-0'} ${activeTab === 'cumulative' ? 'gap-0' : ''}`}
      >
        {/* Report views stay directly discoverable at every width. Phones own
            one horizontal scroller here instead of hiding frequent clinical
            comparisons behind a picker; the fullscreen action keeps its
            reserved space at the right edge. */}
        <TabsList data-tour="report-tabs" className={`${SUBTAB_LIST_CLASSES} !flex !justify-start shrink-0 ${activeTab === 'cumulative' ? 'mb-0.5' : 'mb-2'} !flex-nowrap w-full min-w-0 scroll-hint-x touch-pan-x overflow-x-auto overscroll-x-contain gap-0 pr-12 max-md:pr-[3.25rem] max-md:!min-h-[36px] max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden @min-[1160px]:pr-28 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full`}>
          {tabConfigs.map((tab) => {
            // Spinner appears only while a first-time raw view is being
            // prepared. The selected tab itself changes immediately.
            const showSpinner = pendingTab === tab.value
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                data-tour={`report-tab-${tab.value}`}
                className={`${SUBTAB_TRIGGER_CLASSES} !flex-none !min-w-fit whitespace-nowrap capitalize max-md:!min-h-[36px]`}
              >
                {showSpinner && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                {tab.label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Search bar — hidden on cumulative tab */}
        {activeTab !== "cumulative" && (
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-72">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={activeTab === 'cancer-screening'
                    ? t.reports.cancerScreeningRow.searchPlaceholder
                    : '搜尋檢驗名稱、結果、機構、日期...'}
                  className="w-full rounded-md border border-input bg-background pl-8 pr-8 py-1.5 text-sm max-md:text-[16px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center max-md:-m-2 max-md:min-h-[36px] max-md:min-w-[36px] max-md:p-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {(activeTab === 'all' || activeTab === 'imaging' || activeTab === 'pathology' || activeTab === 'vitals') && (
                <ReportNameModeSwitch className="shrink-0" />
              )}
            </div>
            {searchQuery.trim() && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                顯示 {filteredRows.length} / 共 {rows.length} 筆
              </p>
            )}
            {/* Lab view toggle — 依採檢日 folds the NHI one-DR-per-analyte
                fragmentation into one card per (day × institution); 單項列表
                is the original flat list. Lab tab only. */}
            {activeTab === "lab" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ReportNameModeSwitch />

                <span className="h-4 w-px bg-border" aria-hidden />

                <div className="inline-flex items-center gap-0.5" role="group" aria-label={(t.reports as any).labViewLabel}>
                  {([
                    { byDay: true, label: (t.reports as any).byCollectionDay, title: (t.reports as any).byCollectionDayTooltip },
                    { byDay: false, label: (t.reports as any).flatList, title: undefined },
                  ] as const).map((opt) => (
                    <button
                      key={String(opt.byDay)}
                      type="button"
                      onClick={() => setLabByDay(opt.byDay)}
                      title={opt.title}
                      aria-pressed={labByDay === opt.byDay}
                      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                        labByDay === opt.byDay
                          ? REPORT_ACTIVE_CONTROL_TONE
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeTab === "procedures" && (
              <div
                className="mt-2 flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={t.procedures.categoryFilterLabel}
              >
                {procedureCategoryOptions.map((option) => {
                  const active = procedureCategoryFilter === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setProcedureCategoryFilter(option.value)}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        active
                          ? "bg-foreground/[0.07] font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span>{option.label}</span>
                      <span
                        className={cn(
                          "min-w-4 text-center text-[0.6875rem] font-normal tabular-nums text-muted-foreground",
                        )}
                      >
                        {option.count}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tabConfigs.map((tab) => {
          // Only forceMount tabs the user has actually visited. Unvisited tabs
          // fall back to Radix's default "render only when active", which means
          // their 500+ rows aren't paid for on the initial mount of ReportsCard.
          const keepMounted = visitedTabs.has(tab.value) || undefined
          return tab.isCumulative ? (
            <TabsContent
              key={tab.value}
              value={tab.value}
              forceMount={keepMounted}
              className={expanded ? 'mt-0 flex-1 min-h-0 min-w-0 w-full max-w-full overflow-hidden' : 'mt-0 min-w-0 w-full max-w-full overflow-clip'}
            >
              {cumulativePrepared ? (
                <CumulativeLabReport
                  onActiveCategoryResolved={setResolvedCumulativeCategory}
                  observations={cumulativeSource.observations}
                  fullHeight={expanded}
                  activeCategoryId={cumulativeCategoryId}
                  onCategoryChange={handleCumulativeCategoryChange}
                  focusAnalyteKey={cumulativeFocus?.analyteKey}
                  focusDate={cumulativeFocus?.date}
                  focusNonce={cumulativeFocus?.nonce}
                  trendWindow={cumulativeTrendWindow}
                  onTrendWindowChange={setCumulativeTrendWindow}
                  nameModeControl={cumulativeNameModeControl}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex min-h-[44px] justify-end lg:min-h-8">
                    <ReportNameModeSwitch />
                  </div>
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-border/70 bg-muted/25 px-4 text-sm text-muted-foreground"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>{t.common.loading}</span>
                  </div>
                </div>
              )}
            </TabsContent>
          ) : (
            <ReportsTabContent
              key={tab.value}
              value={tab.value}
              rows={tab.rows}
              isActive={activeTab === tab.value}
              workspaceActive={clinicalTabActive}
              fullHeight={expanded}
              forceMount={keepMounted}
              defaultOpenIds={expandedRowIds}
              searchActive={!!searchQuery.trim()}
              query={searchQuery}
              scrollToId={navTarget?.tab === tab.value ? navTarget.id : null}
              scrollNonce={navTarget?.nonce}
              onScrollResolved={resolveNavTarget}
              isPreparing={!rawReportsEnabled}
              preparingLabel={t.common.loading}
              emptyLabel={t.reports.emptyCategory}
              noMatchesLabel={t.reports.noSearchResults}
            />
          )
        })}
      </Tabs>
    </ReportNameModeProvider>
  )

  if (expanded) {
    return (
      <>
        {/* Placeholder to maintain layout in original spot */}
        <Card className={`${REPORT_CARD_CLASS} pointer-events-none opacity-30`}>
          <CardContent className="px-4 pb-4 h-40 flex items-center justify-center text-muted-foreground">
            <Maximize2 className="h-6 w-6 mr-2" />
            <span className="text-sm">Reports expanded — click outside to close</span>
          </CardContent>
        </Card>

        {/* Fullscreen overlay */}
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm p-4 sm:p-6 flex flex-col"
          onClick={() => setExpanded(false)}
        >
          <div
            className="@container relative flex-1 w-full max-w-7xl mx-auto min-h-0 bg-background rounded-lg border shadow-lg p-4 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {expandButton}
            {reportsContent}
          </div>
        </div>
      </>
    )
  }

  return (
    // Phones keep the two tab rows visually connected while larger layouts
    // retain the roomier card inset.
    <Card className={`${REPORT_CARD_CLASS} reveal-scope @container relative w-full max-w-full pt-1 md:pt-3`}>
      {expandButton}
      <CardContent className="min-w-0 px-0.5 pb-3">
        {reportsContent}
      </CardContent>
    </Card>
  )
}
