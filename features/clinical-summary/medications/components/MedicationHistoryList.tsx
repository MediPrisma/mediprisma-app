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
import { compactMedicationDate } from '../utils/medication-date-display'
import { MedicationItem } from './MedicationItem'

export type { MedicationHistoryGroup } from '../hooks/useGroupedMedications'

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
function isInjectable(m: MedicationRow): boolean {
  const route = (m.route || '').trim()
  if (route) {
    if (INJECTION_ABBR.has(route.toUpperCase())) return true
    if (INJECTION_RE.test(route)) return true
  }
  return INJECTION_RE.test(`${m.title || ''} ${m.secondaryTitle || ''}`)
}

/** Sortable YYYY-MM-DD for a display date, only when it is unambiguous
 *  (year first, as zh-TW renders "2026/8/5"). Month/day-first locale strings
 *  ("10/1/2026", "1/10/2026") can't be told apart, so they return '' rather
 *  than a guess. Rows built by useMedicationRows carry *Iso fields and never
 *  reach this fallback. */
export function dateSortKey(value?: string): string {
  const match = value?.trim().match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})(?!\d)/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function startDayOf(m?: MedicationRow): string {
  return m?.startedOnIso || dateSortKey(m?.startedOn)
}

function latestDayOf(m?: MedicationRow): string {
  return m?.endDateIso || dateSortKey(m?.endDate || m?.stoppedOn) || startDayOf(m)
}

/** One outpatient visit ≈ the latest fill's start day + institution. Drugs
 *  prescribed at the same visit share it, so the list can band them together.
 *  Falls back to the drug key when the start day is unknown or ambiguous — an
 *  undated row is never merged into a neighbouring visit. */
export function visitKeyOf(group: MedicationHistoryGroup): string {
  const started = startDayOf(group.medications[0])
  if (!started) return `drug:${group.key}`
  return `${started}|${(group.medications[0]?.pharmacy ?? '').trim()}`
}

/** Newest visit first; drugs from one visit stay adjacent (institution, then
 *  the fill that ran longest), so visit bands are contiguous. */
function compareHistoryGroups(a: MedicationHistoryGroup, b: MedicationHistoryGroup): number {
  const aLatest = a.medications[0]
  const bLatest = b.medications[0]
  const byVisitDate = (startDayOf(bLatest) || latestDayOf(bLatest))
    .localeCompare(startDayOf(aLatest) || latestDayOf(aLatest))
  if (byVisitDate !== 0) return byVisitDate
  const byInstitution = (aLatest?.pharmacy ?? '').localeCompare(bLatest?.pharmacy ?? '')
  if (byInstitution !== 0) return byInstitution
  return latestDayOf(bLatest).localeCompare(latestDayOf(aLatest))
}

export interface VisitBand {
  /** Alternates 0/1 each time the visit changes. */
  band: 0 | 1
  /** First drug of a visit (other than the very first row). */
  visitStart: boolean
}

/** Alternating band per visit for an already-sorted list. */
export function assignVisitBands(groups: MedicationHistoryGroup[]): VisitBand[] {
  let band: 0 | 1 = 0
  let previous: string | undefined
  return groups.map((group, index) => {
    const key = visitKeyOf(group)
    const changed = index > 0 && key !== previous
    if (changed) band = band === 0 ? 1 : 0
    previous = key
    return { band, visitStart: changed }
  })
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
  groups: MedicationHistoryGroup[]
  nameMode?: MedicationNameMode
}

export function MedicationHistoryList({
  groups,
  nameMode = 'ingredient',
}: MedicationHistoryListProps) {
  const { t } = useLanguage()
  const mt = (t.medications as any)
  const [showInjectables, setShowInjectables] = useState(false)
  const pending = useResourceNavigationStore((s) => s.pending)
  const navSeq = useResourceNavigationStore((s) => s.seq)

  // Sort by visit, newest first, so drugs prescribed together sit together
  // and can share a background band (scanning by eye: "which visit was this").
  const { regular, injectable } = useMemo(() => {
    const sorted = [...groups].sort(compareHistoryGroups)
    const reg: MedicationHistoryGroup[] = []
    const inj: MedicationHistoryGroup[] = []
    for (const g of sorted) {
      // Same drug name across refills → consistent classification; `.some`
      // still catches a group whose route was only recorded on some refills.
      ;(g.medications.some(isInjectable) ? inj : reg).push(g)
    }
    return { regular: reg, injectable: inj }
  }, [groups])

  // Bands are computed over the full list so idle-time batch reveal never
  // re-colours rows that are already on screen.
  const regularBands = useMemo(() => assignVisitBands(regular), [regular])
  const injectableBands = useMemo(() => assignVisitBands(injectable), [injectable])

  const regularRenderKey = useMemo(
    () => regular.map((group) => group.key).join('\u001f'),
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
    const targetInRegular = regular.findIndex((group) =>
      group.medications.some((medication) => medication.id === pending.resourceId),
    )
    const targetInInjectables = injectable.some((group) =>
      group.medications.some((medication) => medication.id === pending.resourceId),
    )
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
          {visibleRegular.map((group, index) => (
            <HistoryRow
              key={group.key}
              group={group}
              mt={mt}
              nameMode={nameMode}
              visitBand={regularBands[index]}
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
              {injectable.length}
            </span>
          </button>
          {showInjectables && (
            <ul
              data-medication-list-surface="grouped"
              className="@container divide-y divide-border/70 overflow-hidden border-t border-border/60 bg-muted/30"
            >
              {injectable.map((group, index) => (
                <HistoryRow
                  key={group.key}
                  group={group}
                  mt={mt}
                  nameMode={nameMode}
                  visitBand={injectableBands[index]}
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
  group,
  mt,
  nameMode,
  visitBand,
}: {
  group: MedicationHistoryGroup
  mt: any
  nameMode: MedicationNameMode
  visitBand?: VisitBand
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const latest = group.medications[0]
  const canExpand = group.medications.length > 1
  const historyMedication = {
    ...latest,
    refillCount: group.count,
  }
  const toggleLabel = (open
    ? (mt.hideMedicationHistory ?? '收合 {name} 的過往用藥紀錄（{count}）')
    : (mt.showMedicationHistory ?? '顯示 {name} 的過往用藥紀錄（{count}）'))
    .replace('{name}', group.name)
    .replace('{count}', String(group.count))
  const toggleHistory = useCallback(() => setOpen((current) => !current), [])
  const openForNavigation = useCallback(() => setOpen(true), [])
  const tinted = visitBand?.band === 1
  return (
    <li
      className={cn(
        'relative min-w-0',
        tinted && 'bg-sky-500/[0.07] dark:bg-sky-400/[0.09]',
      )}
      data-visit-band={visitBand?.band}
      data-visit-start={visitBand?.visitStart || undefined}
    >
      {visitBand && (
        // Left bar repeats the band in a non-colour cue (shape + contrast) so
        // visits stay separable for colour-blind readers and in print.
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px]',
            tinted ? 'bg-sky-500/70 dark:bg-sky-400/70' : 'bg-border',
          )}
        />
      )}
      {visitBand?.visitStart && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-foreground/20"
        />
      )}
      <MedicationItem
        medication={historyMedication}
        nameMode={nameMode}
        grouped
        onRowToggle={canExpand ? toggleHistory : undefined}
        resourceNavigationIds={group.medications.map((medication) => medication.id)}
        onResourceNavigationMatch={canExpand ? openForNavigation : undefined}
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
          medications={group.medications}
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
        if (medication.dose) scheduleParts.push({ key: 'dose', text: medication.dose })
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
          const previousKey = scheduleParts[partIndex - 1]?.key
          const separator = part.key === 'frequency'
            && (previousKey === 'date' || previousKey === 'duration')
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
