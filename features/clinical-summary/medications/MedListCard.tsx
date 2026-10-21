// MedListCard
//   ┌─ Top tabs (like ReportsCard):  用藥 │ 過敏 │ 疫苗
//   │     ↓ 用藥 selected
//   │       Inner toggle: [清單 | 時間軸]
//   │     ↓ 過敏 selected
//   │       Active allergies list (was AllergiesCard)
//   │     ↓ 疫苗 selected
//   │       Vaccine list (point events, no timeline)
//
// AllergiesCard is no longer a separate card — registered as disabled in
// feature-registry. The three concerns are clinically related (drug + drug
// reaction + drug-derived prophylaxis) so consolidating them under one
// header keeps the left panel scannable.
"use client"

import { useEffect, useMemo, useState } from "react"
import { Info, PanelRight, Search, X } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useRightDetail } from "@/src/application/providers/right-detail.provider"
import { useAudience } from "@/src/application/providers/audience.provider"
import { FeatureCard } from "@/src/shared/components"
import { RIGHT_PANE_ACTION_CLASSES, SUBTAB_LIST_CLASSES, SUBTAB_TRIGGER_CLASSES } from "@/src/shared/config/ui-theme.config"
import { cn } from "@/src/shared/utils/cn.utils"
import { useMedications } from './hooks/useMedications'
import { useMedicationRows } from './hooks/useMedicationRows'
import { useMedicationSourceMix } from './hooks/useMedicationSourceMix'
import { useVaccineRows } from './hooks/useVaccineRows'
import { useAllergies } from '../allergies/hooks/useAllergies'
import { useActiveAllergies } from '../allergies/hooks/useActiveAllergies'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { useResourceNavigationStore } from '@/src/application/stores/resource-navigation.store'
import { useClinicalTabActivity } from '@/src/application/providers/clinical-tab-activity.provider'
import { markUserTrigger, trackEvent, useTrackView } from '@/src/application/telemetry/usage-analytics'
import { MedicationList } from './components/MedicationList'
import { MedCopyButtons, MedCopyDialogs, useMedCopyActions } from './components/MedCopyActions'
import { useCurrentMedCopySources } from '@/features/clinical-summary/overview/hooks/useCurrentMedCopySources'
import { MedicationRemainingSupplyList } from './components/MedicationRemainingSupplyList'
import { VaccineList } from './components/VaccineList'
import { MedicationTimeline } from './timeline/MedicationTimeline'
import {
  MedicationCategoryFilter,
  UNCATEGORIZED_MEDICATION_KEY,
} from './components/MedicationCategoryFilter'
import { AllergyList } from '../allergies/components/AllergyList'
import { useLeftBrowserTourStore } from '@/features/left-browser-tour'
import type { MedicationNameMode } from './types'
import {
  partitionMedicationRecords,
  relatedMedicationNavigationTarget,
} from './utils/remaining-supply'
import type { MedicationRemainingSummaryEntity } from '@/src/core/entities/clinical-data.entity'
import { isCoagulationOrSurgeryRelevant } from './utils/medication-category-priority'

type DataTab = 'medications' | 'allergies' | 'vaccines'
type MedView = 'list' | 'timeline' | 'remaining'

// Right-pane detail source id for the medication timeline (one per app).
const MED_TIMELINE_ID = 'med-timeline'

export function MedListCard() {
  const { t, locale } = useLanguage()
  const { audience } = useAudience()
  const mt = (t.medications as any)

  const { medications, isLoading: medsLoading, error: medsError } = useMedications()
  const { allergies, isLoading: allergiesLoading, error: allergiesError } = useAllergies()
  // FHIR R4 Immunization resources — distinct from MedicationRequests that
  // happen to be vaccine products. Bridge ships these from 疾病管制署.
  const {
    immunizations,
    medicationRemainingSummaries = [],
  } = useClinicalData()
  const {
    prescriptions: prescriptionMedications,
  } = useMemo(
    () => partitionMedicationRecords(medications),
    [medications],
  )
  const rows = useMedicationRows(prescriptionMedications, audience, locale)
  // 複製現在用藥 — the 總覽 card's 複製｜編輯, here on the 使用中 header, pasting
  // the same text. Medical only, like the card. It copies the whole current
  // list whatever the search or 藥理類別 filter shows: it is the chart's
  // medication section, not a selection.
  const canCopy = audience === 'medical'
  const copySources = useCurrentMedCopySources(prescriptionMedications, audience, locale, canCopy)
  const copyState = useMedCopyActions(copySources, 'meds_tab')
  const sourceMix = useMedicationSourceMix(rows)
  const vaccines = useVaccineRows(immunizations, audience, locale)
  const activeAllergies = useActiveAllergies(allergies)

  const [tab, setTab] = useState<DataTab>('medications')
  const [view, setView] = useState<MedView>('list')
  const [nameMode, setNameMode] = useState<MedicationNameMode>('ingredient')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set())
  const tourActive = useLeftBrowserTourStore((state) => state.active)
  const tourStep = useLeftBrowserTourStore((state) => state.stepId)
  const pendingNav = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)
  const navigateToResource = useResourceNavigationStore((s) => s.navigate)

  // Usage analytics: the 用藥 inner view (清單 / 時間軸 / 健保餘藥), default
  // included. Programmatic resets (citation navigation, tour, the empty
  // remaining-supply fallback) report as `auto`. Gated on the clinical tab
  // being on screen — this card stays mounted after its first visit.
  const clinicalTabActive = useClinicalTabActivity()
  useTrackView('meds', view, clinicalTabActive)

  useEffect(() => {
    if (!pendingNav || ![
      'MedicationRequest',
      'MedicationStatement',
      'AllergyIntolerance',
      'Immunization',
    ].includes(pendingNav.resourceType)) return
    const timer = window.setTimeout(() => {
      setTab(
        pendingNav.resourceType === 'AllergyIntolerance'
          ? 'allergies'
          : pendingNav.resourceType === 'Immunization'
            ? 'vaccines'
            : 'medications',
      )
      setView('list')
      setSearchQuery('')
      setSelectedCategories(new Set())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pendingNav, navSeq])

  // 用藥 search — matches the bilingual searchHaystack on each row (drug name
  // 中/英, NHI code, drug class, indication ICD, 機構, date incl. 民國). Both
  // the list and the timeline view are filtered from the same query.
  const q = searchQuery.trim().toLowerCase()
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; priority: boolean }>()
    for (const row of rows) {
      const label = row.category?.trim() || (mt.categoryUnclassified ?? '未分類')
      const value = row.category?.trim() || UNCATEGORIZED_MEDICATION_KEY
      const current = counts.get(value)
      counts.set(value, {
        label,
        count: (current?.count ?? 0) + 1,
        priority: Boolean(current?.priority) || isCoagulationOrSurgeryRelevant(row),
      })
    }
    return [...counts.entries()]
      .map(([value, option]) => ({ value, ...option }))
      .sort((a, b) => Number(b.priority) - Number(a.priority)
        || a.label.localeCompare(b.label, locale))
  }, [locale, mt.categoryUnclassified, rows])
  const activeSelectedCategories = useMemo(() => {
    const available = new Set(categoryOptions.map((option) => option.value))
    return new Set([...selectedCategories].filter((value) => available.has(value)))
  }, [categoryOptions, selectedCategories])
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (q && !row.searchHaystack.includes(q)) return false
    if (activeSelectedCategories.size === 0) return true
    const categoryKey = row.category?.trim() || UNCATEGORIZED_MEDICATION_KEY
    return activeSelectedCategories.has(categoryKey)
  }), [activeSelectedCategories, q, rows])
  const filteredMedications = useMemo(() => {
    if (!q && activeSelectedCategories.size === 0) return prescriptionMedications
    const ids = new Set(filteredRows.map((r) => r.id))
    return prescriptionMedications.filter((m: any) => ids.has(m?.id))
  }, [activeSelectedCategories, prescriptionMedications, filteredRows, q])
  const filteredRemainingSupplySummaries = useMemo(() => {
    if (!q) return medicationRemainingSummaries
    return medicationRemainingSummaries.filter((summary) => [
      summary.atc5Name,
      summary.groupName,
      summary.groupIdentifier,
      summary.drugGroupCode,
      summary.sameIngredientDosageFormEndDate,
      summary.calculatedAt,
      summary.adherenceExpectedRemainingDays,
    ].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [medicationRemainingSummaries, q])

  const tabMedicationsLabel = mt.tabMedications ?? '用藥'
  const tabAllergiesLabel = mt.tabAllergies ?? t.allergies.title
  const tabVaccinesLabel = mt.tabVaccines ?? '疫苗'
  const listLabel = mt.viewList ?? '清單'
  const timelineLabel = mt.viewTimeline ?? '時間軸'
  const remainingViewLabel = mt.remainingSupplyView ?? '健保署餘藥計算'
  const hasProductNames = rows.some((row) => Boolean(row.secondaryTitle))
  const hasMedicationFilters = Boolean(q) || activeSelectedCategories.size > 0

  // 向右展開：push the timeline into the right pane so the list (left) and the
  // timeline (right) show side-by-side. Kept in sync with the search filter.
  const { detail: rightDetail, toggleDetail, showDetail } = useRightDetail()
  const isTimelineRight = rightDetail?.sourceId === MED_TIMELINE_ID
  const timelineTitle = `${tabMedicationsLabel} · ${timelineLabel}`
  const openTimelineRight = () => {
    // A pure click with no state to observe, so it reports itself.
    trackEvent('view_open', { area: 'meds', id: 'timeline-right', trigger: 'user' })
    toggleDetail({
      sourceId: MED_TIMELINE_ID,
      title: timelineTitle,
      node: <MedicationTimeline medications={filteredMedications} />,
    })
  }
  useEffect(() => {
    if (rightDetail?.sourceId === MED_TIMELINE_ID) {
      showDetail({
        sourceId: MED_TIMELINE_ID,
        title: timelineTitle,
        node: <MedicationTimeline medications={filteredMedications} />,
      })
    }
    // re-sync only when the filtered set changes (not on every rightDetail tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMedications])

  useEffect(() => {
    if (view !== 'remaining' || medicationRemainingSummaries.length > 0) return
    const timer = window.setTimeout(() => setView('list'), 0)
    return () => window.clearTimeout(timer)
  }, [medicationRemainingSummaries.length, view])

  const viewRelatedMedication = (
    summary: MedicationRemainingSummaryEntity,
    reference: string,
  ) => {
    const target = relatedMedicationNavigationTarget(summary, reference)
    if (!target) return
    setView('list')
    setSearchQuery('')
    window.setTimeout(() => {
      navigateToResource(target)
    }, 0)
  }

  useEffect(() => {
    if (!tourActive || !tourStep || ![
      'medications',
      'medication-timeline',
      'right-pane',
    ].includes(tourStep)) return

    const timer = window.setTimeout(() => {
      setTab('medications')
      setSearchQuery('')
      setSelectedCategories(new Set())
      setView(tourStep === 'medication-timeline' ? 'timeline' : 'list')

      if (tourStep === 'right-pane' && rows.length > 0) {
        showDetail({
          sourceId: MED_TIMELINE_ID,
          title: timelineTitle,
          node: <MedicationTimeline medications={filteredMedications} />,
        })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [filteredMedications, rows.length, showDetail, timelineTitle, tourActive, tourStep])
  // IPS-source hint copy. Bridge data (the dominant source) never triggers
  // this UI — the strings only render when an IPS bundle is loaded.
  const sourceHintStatement: string = mt.sourceHintStatement
    ?? '此清單來自匯入文件，標示為病人目前服用中的藥物'
  const sourceChipStatement: string = mt.sourceChipStatement ?? '目前服用'

  // Card-level isEmpty: only suppress the whole card when ALL three concerns
  // are empty (otherwise we'd hide allergies just because there's no meds).
  const isEmpty = rows.length === 0
    && medicationRemainingSummaries.length === 0
    && vaccines.length === 0
    && activeAllergies.length === 0

  // FeatureCard expects a single isLoading / error pair — combine the two
  // queries pessimistically: any loading → show loading; any error → show
  // first non-null error.
  const isLoading = medsLoading || allergiesLoading
  const error = medsError || allergiesError

  const tabConfigs: Array<{ value: DataTab; label: string; count: number }> = [
    { value: 'medications', label: tabMedicationsLabel, count: rows.length },
    { value: 'allergies',   label: tabAllergiesLabel,   count: activeAllergies.length },
    { value: 'vaccines',    label: tabVaccinesLabel,    count: vaccines.length },
  ]

  return (
    <FeatureCard
      // No title — the top tab bar (用藥 / 過敏 / 疫苗) already labels the
      // active concern; a separate redundant header would only burn space.
      title=""
      featureId="medications"
      className="pt-1 shadow-none hover:shadow-none md:pt-1"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage={t.medications.noData}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as DataTab)} className="w-full gap-0">
        <TabsList
          data-tour="medication-tabs"
          className={cn(SUBTAB_LIST_CLASSES, "!flex !justify-start mb-1 w-full min-w-0 shrink-0 !flex-nowrap gap-0 overflow-x-auto !min-h-[32px] [@media(pointer:coarse)]:!min-h-[44px]")}
        >
          {tabConfigs.map((c) => (
            <TabsTrigger
              key={c.value}
              value={c.value}
              className={cn(
                SUBTAB_TRIGGER_CLASSES,
                '!h-auto !flex-1 !min-w-fit inline-flex items-center gap-1 whitespace-nowrap !min-h-[32px] [@media(pointer:coarse)]:!min-h-[44px]',
              )}
            >
              {c.label}
              <span className="text-[0.6875rem] font-normal tabular-nums text-muted-foreground">
                {c.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="medications" className="mt-0 space-y-2">
          {/* Outside the list, which a search with no match unmounts. */}
          {canCopy && <MedCopyDialogs state={copyState} />}
          <div data-tour="medication-toolbar" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 md:flex md:flex-wrap md:justify-between md:gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="inline-flex h-[36px] min-w-0 gap-0.5 text-xs md:h-auto">
                {([
                  'list',
                  'timeline',
                  ...(medicationRemainingSummaries.length > 0 ? ['remaining' as const] : []),
                ] as MedView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-tour={v === 'timeline' ? 'medication-timeline-switch' : v === 'remaining' ? 'medication-remaining-switch' : undefined}
                    onClick={() => {
                      // Plain buttons: clicking the active view still fires.
                      if (v !== view) markUserTrigger('meds')
                      setView(v)
                      setSearchQuery('')
                    }}
                    aria-label={v === 'remaining' ? remainingViewLabel : undefined}
                    className={cn(
                      'h-[36px] min-w-0 rounded-md px-2 py-0 transition-colors md:h-auto md:px-2.5 md:py-1',
                      view === v
                        ? 'bg-foreground/[0.07] text-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v === 'list' ? listLabel : v === 'timeline' ? timelineLabel : (
                      <>
                        <span className="hidden sm:inline">{remainingViewLabel}</span>
                        <span className="sm:hidden">
                          {mt.remainingSupplyViewCompact ?? '健保餘藥'}
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
              {/* 向右展開：時間軸移到右側面板，與左側清單並排（桌機限定） */}
              {rows.length > 0 && view !== 'remaining' && (
                <button
                  type="button"
                  data-tour="medication-open-right"
                  onClick={openTimelineRight}
                  title={mt.openTimelineRight ?? '時間軸移到右側面板並排顯示'}
                  aria-label={mt.openTimelineRight ?? '時間軸移到右側面板'}
                  className={cn(
                    RIGHT_PANE_ACTION_CLASSES,
                    'gap-1 px-2 py-1 text-xs font-medium',
                    isTimelineRight && '!opacity-100 border-border bg-foreground/[0.07] text-foreground',
                  )}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Bilingual search — matches drug name (中/英), NHI code, class,
                indication, 機構 and date (西元/民國); filters both views. */}
            <div className={cn(
              "relative min-w-0 md:min-w-[160px] md:flex-1",
              !(view !== 'remaining' && categoryOptions.length > 0) && "max-md:col-span-2",
            )}>
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
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
                placeholder={view === 'remaining'
                  ? (mt.remainingSupplySearchPlaceholder ?? '搜尋 ATC5、同成分同劑型名稱、日期…')
                  : (mt.searchPlaceholder ?? '搜尋藥名、分類、適應症、機構、日期…')}
                className="h-[36px] w-full rounded-md border bg-background py-0 pl-7 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40 max-md:text-[16px] md:h-auto md:py-1 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label={mt.clearSearch ?? '清除'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center max-md:-m-2 max-md:min-h-[36px] max-md:min-w-[36px] max-md:p-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {view !== 'remaining' && categoryOptions.length > 0 && (
              <MedicationCategoryFilter
                label={mt.categoryFilterLabel ?? '藥理類別'}
                clearLabel={mt.categoryFilterClear ?? '清除全部'}
                selectedCountLabel={mt.categoryFilterSelected ?? '已選 {count}'}
                priorityGroupLabel={mt.categoryFilterCoagulationPriority ?? '凝血／手術注意'}
                otherGroupLabel={mt.categoryFilterOtherCategories ?? '其他類別'}
                searchPlaceholder={mt.categoryFilterSearchPlaceholder ?? '搜尋類別…'}
                searchClearLabel={mt.categoryFilterSearchClear ?? '清除類別搜尋'}
                noMatchesLabel={mt.categoryFilterNoMatches ?? '找不到符合的類別'}
                options={categoryOptions}
                selected={activeSelectedCategories}
                onSelectedChange={setSelectedCategories}
                className="max-md:px-2"
                compactLabel
              />
            )}
          </div>
          {/* Card-level source hint: surfaces only when every row originated
              from a MedicationStatement (typical IPS dataset). Mixed lists
              fall through to the per-row chip rendered inside MedicationItem. */}
          {view !== 'remaining' && sourceMix === 'statement-only' && (
            <div className="flex items-start gap-1.5 px-0.5 text-[0.6875rem] text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-[1px]" aria-hidden />
              <span>{sourceHintStatement}</span>
            </div>
          )}
          {hasMedicationFilters && (
            view === 'remaining'
              ? filteredRemainingSupplySummaries.length === 0
              : filteredRows.length === 0
          ) ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {mt.searchNoMatch ?? '無符合的藥物'}
            </div>
          ) : (
            <div className="space-y-4">
              {view === 'list' ? (
                filteredRows.length > 0 && (
                  <MedicationList
                    medications={filteredRows}
                    unfilteredMedications={hasMedicationFilters ? rows : undefined}
                    isLoading={false}
                    error={null}
                    showSourceChip={sourceMix === 'mixed'}
                    sourceChipStatementLabel={sourceChipStatement}
                    sourceChipStatementTooltip={sourceHintStatement}
                    nameMode={nameMode}
                    showNameModeSwitch={hasProductNames}
                    onNameModeChange={setNameMode}
                    activeActions={canCopy ? <MedCopyButtons state={copyState} /> : undefined}
                  />
                )
              ) : view === 'timeline' ? (
                <div data-tour="medication-timeline">
                  <MedicationTimeline medications={filteredMedications} />
                </div>
              ) : (
                <MedicationRemainingSupplyList
                  summaries={filteredRemainingSupplySummaries}
                  onViewRelated={viewRelatedMedication}
                />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="allergies" className="mt-0">
          <AllergyList allergies={activeAllergies} isLoading={false} error={null} />
        </TabsContent>

        <TabsContent value="vaccines" className="mt-0">
          <VaccineList vaccines={vaccines} />
        </TabsContent>
      </Tabs>
    </FeatureCard>
  )
}
