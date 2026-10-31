// MedicationHistoryList — 已停用（用藥歷史）的統一列表。
//
// 收合列與「現在用藥」共用 MedicationItem，讓藥名、用法、總量、天數、日期、
// 機構、分類與診斷保持同一閱讀位置。歷史區只額外保留展開控制，展開後才顯示
// 每次處方明細。
//
// 注射劑分流：靜脈／肌肉／皮下注射（多為住院或急性期給藥）依「給藥途徑」抓出，
// 收進獨立、預設收合的子區塊，避免把口服常規用藥淹沒。注意：這是依 route 判斷，
// 不等於「住院」——真正的門診/住院情境需要 Encounter 連結（bridge 資料層），此處
// 不臆測。
"use client"

import { startTransition, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { ChevronRight, Syringe } from 'lucide-react'
import { useAudience } from "@/src/application/providers/audience.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useResourceNavigationStore } from "@/src/application/stores/resource-navigation.store"
import { cn } from "@/src/shared/utils/cn.utils"
import type { MedicationNameMode, MedicationRow } from '../types'
import type { MedicationHistoryGroup } from '../hooks/useGroupedMedications'
import {
  bandsFromVisitKeys,
  compareRowsByVisit,
  startDayOf,
  visitBandTintClass,
  visitKeyOfRow,
  type VisitBand,
} from '../utils/visit-bands'
import { VisitBandMarks, VisitHeader } from './VisitBandMarks'
import { compactMedicationDate } from '../utils/medication-date-display'
import { MedicationItem } from './MedicationItem'
import { doseUnlessRepeated } from '../utils/dose-helpers'

export type { MedicationHistoryGroup } from '../hooks/useGroupedMedications'
export {
  assignVisitBands,
  dateSortKey,
  visitKeyOf,
  type VisitBand,
} from '../utils/visit-bands'

/** SNOMED-mapped injection route abbreviations (see route-display.ts). */
const INJECTION_ABBR = new Set(['IV', 'IM', 'SC'])
// Injection keywords across the route display string (source free text or the
// patient-locale label) AND the drug name — TW product names spell it out
// (注射液 / 注射劑 / 針), which is the most reliable signal when route is blank.
const INJECTION_RE = /注射|點滴|靜脈|肌肉|皮下|針劑|inject|intraven|intramus|subcut|infusion/i

// The history section is open by default, so keep its first render bounded to
// roughly one scroll viewport. Remaining groups are appended during browser
// idle time instead of competing with the current-medication rows for first
// paint. Individual prescription details remain collapsed until requested.
const INITIAL_HISTORY_GROUP_COUNT = 12
const HISTORY_GROUP_BATCH_SIZE = 24

/** Route- and name-based heuristic for an injectable / infusion medication.
 *  NOT an inpatient detector — route only. */
export function isInjectable(m: MedicationRow): boolean {
  const route = (m.route || '').trim()
  if (route) {
    if (INJECTION_ABBR.has(route.toUpperCase())) return true
    if (INJECTION_RE.test(route)) return true
  }
  return INJECTION_RE.test(`${m.title || ''} ${m.secondaryTitle || ''}`)
}

/** One row of the history list: a single fill, under the visit that
 *  prescribed it, carrying its drug's group for the refill count and the
 *  expandable list of the drug's other fills. Every visit therefore lists
 *  every drug it prescribed (owner, 2026-10-13), even when the drug was
 *  filled again later. */
interface HistoryEntry {
  key: string
  group: HistoryListGroup
  fill: MedicationRow
}

/** A drug's ended fills, one row each. `currentFills` are that drug's
 *  current prescriptions (rows of 使用中, not of this list): an expanded row
 *  lists them with the ended fills, so it opens every fill it counts. */
export type HistoryListGroup = MedicationHistoryGroup & { currentFills?: MedicationRow[] }

function visitKeyOfEntry(entry: HistoryEntry): string {
  return visitKeyOfRow(entry.fill, entry.key)
}

/** Fills of the visit that starts at `index` (empty for rows that don't
 *  start a visit). Uses the full list, so counts stay correct while later
 *  rows are still being revealed in idle batches. */
function visitRowsAt(
  entries: HistoryEntry[],
  bands: VisitBand[],
  index: number,
): MedicationRow[] | undefined {
  const count = bands[index]?.headerCount ?? 0
  if (!count) return undefined
  return entries.slice(index, index + count).map((entry) => entry.fill)
}

/** Compact "start → end" shared with the collapsed medication row. */
function dateRangeOf(m: MedicationRow, locale: string): string {
  if (m.startedOn && m.endDate) {
    return `${compactMedicationDate(m.startedOn, locale)} → ${compactMedicationDate(m.endDate, locale)}`
  }
  return compactMedicationDate(
    m.endDate || m.stoppedOn || m.startedOn,
    locale,
  )
}

interface MedicationHistoryListProps {
  /** Drug groups whose fills the list shows: stopped drugs, plus the earlier
   *  fills of current drugs (no badge: 使用中 above lists those drugs). */
  groups: HistoryListGroup[]
  /** Drugs per visit before a search or class filter, when one is on, split
   *  as the lists are: visit headers then compare the matches with the
   *  visit's total ("1／3 項"). */
  visitTotals?: { regular: Map<string, number>; injectable: Map<string, number> }
  nameMode?: MedicationNameMode
}

export function MedicationHistoryList({
  groups,
  visitTotals,
  nameMode = 'ingredient',
}: MedicationHistoryListProps) {
  const { t } = useLanguage()
  const mt = (t.medications as any)
  const [showInjectables, setShowInjectables] = useState(false)
  const pending = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)

  // One row per fill, sorted by visit, newest first, so drugs prescribed
  // together sit together and share a background band.
  const { regular, injectable } = useMemo(() => {
    const entries: Array<HistoryEntry & { injectable: boolean }> = []
    for (const group of groups) {
      // Same drug across refills → one classification; `.some` still catches
      // a drug whose route was only recorded on some refills.
      const groupInjectable = group.medications.some(isInjectable)
      group.medications.forEach((fill, index) => {
        entries.push({
          key: `${group.key}\u001f${fill.id || index}`,
          group,
          fill,
          injectable: groupInjectable,
        })
      })
    }
    entries.sort((a, b) => compareRowsByVisit(a.fill, b.fill))
    return {
      regular: entries.filter((entry) => !entry.injectable),
      injectable: entries.filter((entry) => entry.injectable),
    }
  }, [groups])
  const injectableDrugCount = useMemo(
    () => new Set(injectable.map((entry) => entry.group.key)).size,
    [injectable],
  )

  // Bands are computed over the full list so idle-time batch reveal never
  // re-colours rows that are already on screen.
  const regularBands = useMemo(() => bandsFromVisitKeys(regular.map(visitKeyOfEntry)), [regular])
  const injectableBands = useMemo(() => bandsFromVisitKeys(injectable.map(visitKeyOfEntry)), [injectable])

  const regularRenderKey = useMemo(
    () => regular.map((entry) => entry.key).join('\u001f'),
    [regular],
  )
  const initialRegularCount = Math.min(INITIAL_HISTORY_GROUP_COUNT, regular.length)
  const [regularRenderWindow, setRegularRenderWindow] = useState({
    key: '',
    count: INITIAL_HISTORY_GROUP_COUNT,
  })
  const visibleRegularCount = regularRenderWindow.key === regularRenderKey
    ? Math.min(regularRenderWindow.count, regular.length)
    : initialRegularCount
  const visibleRegular = regular.slice(0, visibleRegularCount)

  useEffect(() => {
    if (visibleRegularCount >= regular.length) return

    let cancelled = false
    let idleId: number | undefined
    let timer: number | undefined
    const browserWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const revealNextBatch = () => {
      if (cancelled) return
      startTransition(() => {
        setRegularRenderWindow((current) => {
          const currentCount = current.key === regularRenderKey
            ? current.count
            : initialRegularCount
          return {
            key: regularRenderKey,
            count: Math.min(
              currentCount + HISTORY_GROUP_BATCH_SIZE,
              regular.length,
            ),
          }
        })
      })
    }

    if (browserWindow.requestIdleCallback) {
      idleId = browserWindow.requestIdleCallback(revealNextBatch, { timeout: 600 })
    } else {
      timer = window.setTimeout(revealNextBatch, 80)
    }

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (idleId !== undefined) browserWindow.cancelIdleCallback?.(idleId)
    }
  }, [initialRegularCount, regular.length, regularRenderKey, visibleRegularCount])

  useEffect(() => {
    if (!pending || !['MedicationRequest', 'MedicationStatement'].includes(pending.resourceType)) return
    const targetInRegular = regular.findIndex((entry) => entry.fill.id === pending.resourceId || entry.fill.reconciledOrderIds?.includes(pending.resourceId))
    const targetInInjectables = injectable.some((entry) => entry.fill.id === pending.resourceId || entry.fill.reconciledOrderIds?.includes(pending.resourceId))
    if (targetInRegular < 0 && !targetInInjectables) return
    const timer = window.setTimeout(() => {
      if (targetInInjectables) setShowInjectables(true)
      if (targetInRegular >= 0) {
        setRegularRenderWindow((current) => current.key === regularRenderKey
          ? { ...current, count: Math.max(current.count, targetInRegular + 1) }
          : { key: regularRenderKey, count: targetInRegular + 1 })
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pending, navSeq, injectable, regular, regularRenderKey])

  return (
    <div className="max-h-[28rem] space-y-2 overflow-y-auto scrollbar-thin-persistent pr-1">
      {regular.length > 0 && (
        <ul
          data-medication-list-surface="grouped"
          className="@container divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-muted/40 dark:bg-muted/30"
        >
          {visibleRegular.map((entry, index) => (
            <HistoryRow
              key={entry.key}
              entry={entry}
              mt={mt}
              nameMode={nameMode}
              visitBand={regularBands[index]}
              visitRows={visitRowsAt(regular, regularBands, index)}
              visitTotal={visitTotals?.regular.get(visitKeyOfEntry(entry))}
            />
          ))}
        </ul>
      )}

      {injectable.length > 0 && (
        <div className="rounded-md border border-dashed border-border/70">
          <button
            type="button"
            onClick={() => setShowInjectables((o) => !o)}
            aria-expanded={showInjectables}
            title={mt.injectablesTooltip}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 shrink-0 transition-transform", showInjectables && "rotate-90")}
              aria-hidden
            />
            <Syringe className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{mt.injectablesHeader ?? '注射／點滴用藥'}</span>
            <span className="rounded-full bg-muted px-1.5 py-0 tabular-nums text-foreground/70">
              {injectableDrugCount}
            </span>
          </button>
          {showInjectables && (
            <ul
              data-medication-list-surface="grouped"
              className="@container divide-y divide-border/70 overflow-hidden border-t border-border/60 bg-muted/30"
            >
              {injectable.map((entry, index) => (
                <HistoryRow
                  key={entry.key}
                  entry={entry}
                  mt={mt}
                  nameMode={nameMode}
                  visitBand={injectableBands[index]}
                  visitRows={visitRowsAt(injectable, injectableBands, index)}
                  visitTotal={visitTotals?.injectable.get(visitKeyOfEntry(entry))}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  mt,
  nameMode,
  visitBand,
  visitRows,
  visitTotal,
}: {
  entry: HistoryEntry
  mt: any
  nameMode: MedicationNameMode
  visitBand?: VisitBand
  visitRows?: MedicationRow[]
  visitTotal?: number
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const { group, fill } = entry
  // Every fill of the drug, current ones included, newest first.
  const allFills = useMemo(
    () => (group.currentFills?.length
      ? [...group.currentFills, ...group.medications].sort(compareRowsByVisit)
      : group.medications),
    [group],
  )
  const canExpand = allFills.length > 1
  const historyMedication = {
    ...fill,
    // The drug's own count over every fill (as its 使用中 row shows), not
    // just the ended fills grouped here.
    refillCount: Math.max(fill.refillCount ?? 1, allFills.length),
  }
  const toggleLabel = (open
    ? (mt.hideMedicationHistory ?? '收合 {name} 的過往用藥紀錄（{count}）')
    : (mt.showMedicationHistory ?? '顯示 {name} 的過往用藥紀錄（{count}）'))
    .replace('{name}', group.name)
    .replace('{count}', String(allFills.length))
  const toggleHistory = useCallback(() => setOpen((current) => !current), [])
  const tinted = visitBand?.band === 1
  return (
    <li
      className={cn(
        'relative min-w-0',
        tinted && visitBandTintClass,
      )}
      data-visit-band={visitBand?.band}
      data-visit-start={visitBand?.visitStart || undefined}
    >
      {visitBand && <VisitBandMarks band={visitBand} />}
      {visitBand && visitBand.headerCount > 0 && visitRows && (
        <VisitHeader rows={visitRows} count={visitBand.headerCount} total={visitTotal} />
      )}
      <MedicationItem
        medication={historyMedication}
        nameMode={nameMode}
        grouped
        visitContextInHeader={!!visitBand && !!startDayOf(fill)}
        onRowToggle={canExpand ? toggleHistory : undefined}
        // Each fill has its own row now, so a row answers only for its fill;
        // a citation asking for the drug's history still expands it here.
        resourceNavigationIds={[fill.id]}
        onResourceNavigationMatch={canExpand ? ((_sequence, target) => {
          if (target.expandMedicationHistory) setOpen(true)
        }) : undefined}
        leadingControl={canExpand ? (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          </button>
        ) : undefined}
      />

      {canExpand && open && (
        <MedicationHistoryDetails
          id={detailsId}
          medications={allFills}
          nameMode={nameMode}
          className="border-t border-border/60 bg-background/30 px-2.5 py-1.5 pl-9"
        />
      )}
    </li>
  )
}

export function MedicationHistoryDetails({
  medications,
  nameMode = 'ingredient',
  className,
  id,
}: {
  medications: MedicationRow[]
  nameMode?: MedicationNameMode
  className?: string
  id?: string
}) {
  const { audience } = useAudience()
  const { t, locale } = useLanguage()
  const mt = (t.medications as any)
  const isMedical = audience === 'medical'
  const formatCompactNumber = (value: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value)

  return (
    <div id={id} className={cn('space-y-1', className)}>
      {medications.map((medication, index) => {
        const scheduleParts: Array<{ key: string; text: string }> = []
        const metadataParts: string[] = []
        const range = dateRangeOf(medication, locale)
        const durationLabel = medication.durationDays !== undefined
          ? (mt.durationCompact ?? (locale.startsWith('zh') ? '{n} 天' : '{n}d'))
            .replace('{n}', formatCompactNumber(medication.durationDays))
          : ''
        const durationSuffix = durationLabel
          ? (locale.startsWith('zh') ? `（${durationLabel}）` : ` (${durationLabel})`)
          : ''
        if (range) scheduleParts.push({ key: 'date', text: `${range}${durationSuffix}` })
        else if (durationLabel) scheduleParts.push({ key: 'duration', text: durationLabel })
        const shownDose = doseUnlessRepeated(medication.dose, medication.frequency)
        if (shownDose) scheduleParts.push({ key: 'dose', text: shownDose })
        if (medication.route) scheduleParts.push({ key: 'route', text: medication.route })
        if (medication.frequency) {
          scheduleParts.push({ key: 'frequency', text: medication.frequency })
        }
        if (medication.totalQuantity !== undefined) {
          scheduleParts.push({
            key: 'total-quantity',
            text: (mt.totalQuantityCompact
              ?? (locale.startsWith('zh') ? '總量 {n}' : 'Total {n}'))
              .replace('{n}', formatCompactNumber(medication.totalQuantity)),
          })
        }
        // Keep each fill aligned with the same ingredient/product switch as
        // the group heading. Product mode still preserves brand/package
        // switches between fills; missing names fall back to the available one.
        const medicationName = nameMode === 'product'
          ? medication.secondaryTitle || medication.title
          : medication.title || medication.secondaryTitle
        if (medicationName) metadataParts.push(medicationName)
        if (medication.pharmacy) metadataParts.push(medication.pharmacy)
        if (isMedical && medication.icdCode) {
          metadataParts.push(
            `${medication.icdCode}${medication.icdText ? ` ${medication.icdText}` : ''}`,
          )
        }
        const scheduleText = scheduleParts.reduce((text, part, partIndex) => {
          if (partIndex === 0) return part.text
          // Only "（28 天）" spaces itself; a bare "28 天" needs the space.
          const separator = part.key === 'frequency' && text.endsWith('）')
            ? ''
            : ' '
          return `${text}${separator}${part.text}`
        }, '')
        const text = [scheduleText, ...metadataParts].filter(Boolean).join(' · ')
        return (
          <MedicationHistoryDetail
            key={medication.id || index}
            text={text || (mt.noDetail ?? '')}
          />
        )
      })}
    </div>
  )
}

function MedicationHistoryDetail({ text }: { text: string }) {
  return (
    <div className="rounded-sm px-1 py-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
      {text}
    </div>
  )
}
