// Improved Medication List Component with Collapsible Sections
"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useResourceNavigationStore } from "@/src/application/stores/resource-navigation.store"
import { cn } from "@/src/shared/utils/cn.utils"
import type { MedicationNameMode, MedicationRow } from '../types'
import { MedicationItem } from './MedicationItem'
import { VisitBandMarks, VisitHeader } from './VisitBandMarks'
import {
  assignRowVisitBands,
  compareRowsByVisit,
  rowsPerVisit,
  startDayOf,
  visitKeyOfRow,
  visitBandTintClass,
} from '../utils/visit-bands'
import {
  MedicationHistoryDetails,
  MedicationHistoryList,
  isInjectable,
  type HistoryListGroup,
} from './MedicationHistoryList'
import {
  medicationGroupKey,
  useGroupedMedications,
  type MedicationHistoryGroup,
} from '../hooks/useGroupedMedications'

interface MedicationListProps {
  medications: MedicationRow[]
  isLoading: boolean
  error: Error | null
  /** When true, MedicationItem renders a "目前服用" chip on rows that came
   *  from a FHIR MedicationStatement (rather than a MedicationRequest).
   *  Set by MedListCard only when the list is mixed-source; pure single-source
   *  lists are signalled via a card-level banner instead. */
  showSourceChip?: boolean
  sourceChipStatementLabel?: string
  sourceChipStatementTooltip?: string
  nameMode?: MedicationNameMode
  showNameModeSwitch?: boolean
  onNameModeChange?: (mode: MedicationNameMode) => void
  /** Actions about the 使用中 list (複製｜編輯), at the end of its header. */
  activeActions?: ReactNode
  /** The rows before a search or class filter, when one is on: visit
   *  headers then compare the matches with the visit's total ("1／3 項"). */
  unfilteredMedications?: MedicationRow[]
}

export function MedicationList({
  medications,
  isLoading,
  error,
  showSourceChip = false,
  sourceChipStatementLabel,
  sourceChipStatementTooltip,
  nameMode = 'ingredient',
  showNameModeSwitch = false,
  onNameModeChange,
  activeActions,
  unfilteredMedications,
}: MedicationListProps) {
  const { t, locale } = useLanguage()
  const mt = (t.medications as any)
  const [showActive, setShowActive] = useState(true)
  const [showInactive, setShowInactive] = useState(true)
  const [openActiveHistories, setOpenActiveHistories] = useState<Set<string>>(
    () => new Set(),
  )
  const activeListId = useId()
  const inactiveListId = useId()
  const nameModeSwitchId = useId()
  const {
    activeMedications,
    activeHistoryByMedicationId = new Map<string, MedicationHistoryGroup>(),
    inactiveMedicationGroups,
  } = useGroupedMedications(medications)
  // Display order only: newest visit first, drugs from one visit adjacent so
  // they can share a band. Overview and copy-text keep the grouped order.
  const activeByVisit = useMemo(
    () => [...activeMedications].sort(compareRowsByVisit),
    [activeMedications],
  )
  const activeBands = useMemo(() => assignRowVisitBands(activeByVisit), [activeByVisit])
  // 用藥歷史 lists every fill under its own visit: stopped drugs, plus the
  // earlier fills of current drugs, so each visit shows every drug it
  // prescribed. (No 使用中 badge: the list above already names them.)
  // Those earlier fills carry the drug's current fills too, so their row opens
  // every fill its 「累計 n 次」 counts, as a stopped drug's row does.
  const historyGroups = useMemo(() => {
    const attached = new Map<string, HistoryListGroup>()
    for (const group of activeHistoryByMedicationId.values()) {
      if (attached.has(group.key)) continue
      const currentFills = medications.filter(
        (row) => !row.isInactive && medicationGroupKey(row) === group.key,
      )
      attached.set(group.key, { ...group, currentFills })
    }
    return [...inactiveMedicationGroups, ...attached.values()]
  }, [activeHistoryByMedicationId, inactiveMedicationGroups, medications])
  // Totals before the filter, in the unit each list shows (rows): 使用中
  // counts its current-therapy rows; 用藥歷史 counts every ended fill, one
  // row each, split as its lists are (injectables apart).
  const unfilteredGrouped = useGroupedMedications(unfilteredMedications ?? medications)
  const visitTotals = useMemo(() => {
    if (!unfilteredMedications) return undefined
    const pastFills = unfilteredMedications.filter((row) => row.isInactive)
    const injectableDrugs = new Set(pastFills.filter(isInjectable).map(medicationGroupKey))
    const isInjectableDrug = (row: MedicationRow) => injectableDrugs.has(medicationGroupKey(row))
    return {
      active: rowsPerVisit(unfilteredGrouped.activeMedications),
      regular: rowsPerVisit(pastFills.filter((row) => !isInjectableDrug(row))),
      injectable: rowsPerVisit(pastFills.filter(isInjectableDrug)),
    }
  }, [unfilteredMedications, unfilteredGrouped])
  const pending = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)

  useEffect(() => {
    if (!pending || !['MedicationRequest', 'MedicationStatement'].includes(pending.resourceType)) return
    const targetInActive = activeMedications.some((medication) =>
      medication.id === pending.resourceId || medication.reconciledOrderIds?.includes(pending.resourceId),
    )
    // Every earlier fill has its own row in 用藥歷史, under its visit, so a
    // citation of one opens the history section and lands on that row.
    const targetInHistory = historyGroups.some((group) =>
      group.medications.some((medication) => medication.id === pending.resourceId || medication.reconciledOrderIds?.includes(pending.resourceId)),
    )
    if (!targetInActive && !targetInHistory) return
    const timer = window.setTimeout(() => {
      if (targetInActive) setShowActive(true)
      if (targetInHistory) setShowInactive(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [
    pending,
    navSeq,
    activeMedications,
    historyGroups,
  ])

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t.common.loading}</div>
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </div>
    )
  }

  if (medications.length === 0) {
    return <div className="text-sm text-muted-foreground">{mt.noData}</div>
  }

  // Every ended fill the history lists, including earlier fills of current drugs.
  const totalInactive = historyGroups.reduce((sum, group) => sum + group.count, 0)
  const nameDisplay = mt.nameDisplay ?? {
    label: '藥名顯示方式',
    ingredient: '成分名',
    product: '商品名',
  }

  // 成分名／商品名 applies to the history too, so it shows even when nothing
  // is running (then beside the actions, above the history).
  const nameModeSwitch = showNameModeSwitch && onNameModeChange ? (
    <div
      role="group"
      aria-label={nameDisplay.label}
      className="inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground md:min-h-8"
    >
      <button
        type="button"
        onClick={() => onNameModeChange('ingredient')}
        aria-pressed={nameMode === 'ingredient'}
        className={cn(
          'rounded-sm px-1 py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          nameMode === 'ingredient' && 'font-medium text-foreground',
        )}
      >
        {nameDisplay.ingredient}
      </button>
      <label
        htmlFor={nameModeSwitchId}
        className="inline-flex h-[32px] w-9 cursor-pointer items-center justify-center md:h-8"
      >
        <Switch
          id={nameModeSwitchId}
          checked={nameMode === 'product'}
          onCheckedChange={(checked) => onNameModeChange(checked ? 'product' : 'ingredient')}
          aria-label={nameDisplay.label}
        />
      </label>
      <button
        type="button"
        onClick={() => onNameModeChange('product')}
        aria-pressed={nameMode === 'product'}
        className={cn(
          'rounded-sm px-1 py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          nameMode === 'product' && 'font-medium text-foreground',
        )}
      >
        {nameDisplay.product}
      </button>
    </div>
  ) : null

  return (
    <div className="space-y-4">
      {medications.some(medication => medication.currentnessUncertain) && (
        <p className="text-xs text-muted-foreground">{locale === 'en' ? 'Some medication status is unconfirmed. These records remain below with an uncertainty or conflict label; neither current use nor stopping is established.' : '有用藥狀態待確認；下方仍保留原始紀錄及狀態差異標示，尚不能直接判定仍在服用或已停用。'}</p>
      )}
      {/* Nothing running, but the actions still apply — a long-term script
          that just ran out is still 現在用藥 to the copy. */}
      {activeMedications.length === 0 && (nameModeSwitch || activeActions) && (
        // Wraps on a narrow phone: no title shares this row, and neither
        // control may shrink, so a second line beats clipping one off-screen.
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1" data-testid="medication-list-controls">
          {nameModeSwitch}
          {activeActions}
        </div>
      )}
      {/* Currently in use Medications */}
      {activeMedications.length > 0 && (
        <div className="space-y-1 md:space-y-1.5">
          <div className="flex min-h-[32px] items-center justify-between gap-2 md:min-h-8">
            <h3 className="min-w-0 text-sm font-semibold text-foreground">
              <button
                type="button"
                aria-expanded={showActive}
                aria-controls={activeListId}
                onClick={() => setShowActive((visible) => !visible)}
                className="-ml-2 inline-flex min-h-[32px] min-w-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:min-h-8"
              >
                {showActive
                  ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                  : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="truncate">
                  {mt.currentlyInUse} ({activeMedications.length})
                </span>
              </button>
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              {nameModeSwitch}
              {activeActions}
            </div>
          </div>
          {showActive && (
            <ul
              id={activeListId}
              data-medication-list-surface="grouped"
              className="@container divide-y divide-border/70 overflow-hidden border-y border-border/70"
            >
              {activeByVisit.map((medication, index) => {
                const visitBand = activeBands[index]
                const history = activeHistoryByMedicationId.get(medication.id)
                const historyOpen = openActiveHistories.has(medication.id)
                const historyDetailsId = `${activeListId}-${medication.id}-history`
                const historyToggleLabel = (historyOpen
                  ? (mt.hideMedicationHistory ?? '收合 {name} 的過往用藥紀錄（{count}）')
                  : (mt.showMedicationHistory ?? '顯示 {name} 的過往用藥紀錄（{count}）'))
                  .replace('{name}', medication.title)
                  .replace('{count}', String(history?.count ?? 0))
                const toggleHistory = () => setOpenActiveHistories((current) => {
                  const next = new Set(current)
                  if (next.has(medication.id)) next.delete(medication.id)
                  else next.add(medication.id)
                  return next
                })

                return (
                  <li
                    key={medication.id}
                    className={cn('relative min-w-0', visitBand.band === 1 && visitBandTintClass)}
                    data-visit-band={visitBand.band}
                    data-visit-start={visitBand.visitStart || undefined}
                  >
                    <VisitBandMarks band={visitBand} />
                    {visitBand.headerCount > 0 && (
                      <VisitHeader
                        rows={activeByVisit.slice(index, index + visitBand.headerCount)}
                        count={visitBand.headerCount}
                        total={visitTotals?.active.get(visitKeyOfRow(medication, medication.id || String(index)))}
                      />
                    )}
                    <MedicationItem
                      medication={medication}
                      showSourceChip={showSourceChip}
                      sourceChipStatementLabel={sourceChipStatementLabel}
                      sourceChipStatementTooltip={sourceChipStatementTooltip}
                      nameMode={nameMode}
                      grouped
                      visitContextInHeader={!!startDayOf(medication)}
                      onRowToggle={history ? toggleHistory : undefined}
                      // Answers only for its own prescription: earlier fills
                      // have their own rows in 用藥歷史. A citation asking to
                      // expand this drug's history still opens it here.
                      onResourceNavigationMatch={history ? ((_sequence, target) => {
                        if (!target.expandMedicationHistory) return
                        setShowActive(true)
                        setOpenActiveHistories((current) => {
                          const next = new Set(current)
                          next.add(medication.id)
                          return next
                        })
                      }) : undefined}
                      leadingControl={history ? (
                        // Stretches to the row (44px two-line, 32px when the
                        // row folds onto one line) so the chevron stays centred.
                        <button
                          type="button"
                          aria-expanded={historyOpen}
                          aria-controls={historyDetailsId}
                          aria-label={historyToggleLabel}
                          title={historyToggleLabel}
                          onClick={toggleHistory}
                          className="inline-flex w-full self-stretch items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                        >
                          <ChevronRight
                            className={cn(
                              'h-4 w-4 transition-transform',
                              historyOpen && 'rotate-90',
                            )}
                            aria-hidden
                          />
                        </button>
                      ) : undefined}
                    />
                    {history && historyOpen && (
                      <MedicationHistoryDetails
                        id={historyDetailsId}
                        medications={history.medications}
                        nameMode={nameMode}
                        className="border-t border-border/60 bg-background/30 px-2.5 py-1.5 pl-9"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Inactive Medications - Collapsible */}
      {historyGroups.length > 0 && (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showInactive}
            aria-controls={inactiveListId}
            onClick={() => setShowInactive((visible) => !visible)}
            className="w-full justify-between px-0 hover:bg-transparent"
          >
            <div className="flex items-center gap-2">
              {showInactive ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="text-sm font-semibold">
                {mt.history} ({totalInactive} {locale === 'en' ? 'records' : '筆紀錄'})
              </span>
            </div>
          </Button>

          {showInactive && (
            <div id={inactiveListId}>
              <MedicationHistoryList
                groups={historyGroups}
                visitTotals={visitTotals}
                nameMode={nameMode}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
