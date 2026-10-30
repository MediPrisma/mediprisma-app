"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { isAbnormalInterpretationLabel } from "@voho0000/clinical-lab-normalization/interpretation"
import { FeatureCard } from "@/src/shared/components"
import { Button } from "@/components/ui/button"
import { ReportRow } from "@/features/clinical-summary/reports/components/ReportRow"
import { ObservationLongitudinalAction } from "@/features/clinical-summary/reports/components/ObservationLongitudinalAction"
import type { EncounterObservation } from "@/features/clinical-summary/visit-history/components/EncounterObservationCard"
import { useLanguage } from "@/src/application/providers/language.provider"
import { cn } from "@/src/shared/utils/cn.utils"
import { ClinicianNamePicker } from "./ClinicianNamePicker"
import { useLastOutpatient, type HospitalOutpatientVisit } from "../hooks/useLastOutpatient"
import { isSameClinician, type PriorLabValue } from "../utils/last-outpatient"

type LabResult = { interpretationLabel?: string; refRangeAbnormal?: boolean }

// The app's one abnormal rule (as in the reports tab): the source's
// interpretation decides when present; the reference range only when absent.
function isAbnormal(result: LabResult): boolean {
  return result.interpretationLabel
    ? isAbnormalInterpretationLabel(result.interpretationLabel)
    : !!result.refRangeAbnormal
}

function hasAbnormal(test: EncounterObservation): boolean {
  return isAbnormal(test) || test.components.some(isAbnormal)
}

// A short source flag beside the value, so an abnormal result never reads by
// colour alone.
const FLAG_CODES: Record<string, string> = {
  High: 'H',
  'Critical High': 'HH',
  Low: 'L',
  'Critical Low': 'LL',
  Abnormal: 'A',
  Positive: '+',
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))
}

function visitDay(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/')
}

function shortDay(day: string): string {
  return day.slice(5).replace('-', '/')
}

const COLLAPSED_KEY = 'mediprisma:last-outpatient:visit-list-collapsed'

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

function writeCollapsed(collapsed: boolean) {
  try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* private mode */ }
}

type VisitListStrings = {
  label: string
  youTemplate: string
  noResults: string
  pending: string
  itemCount: string
  visitCount: string
  visitCountShort: string
  collapse: string
  expand: string
}

/** Every hospital outpatient visit, newest first, any physician: pick one to
 *  read what it ordered. In a wide panel it is a column down the left, by
 *  year, that folds to a narrow rail; in a narrow one it is a row of chips.
 *  A visit with nothing linked yet is muted, once the reports are imported. */
function VisitList({
  visits,
  selectedId,
  itemCounts,
  clinicianName,
  reportsPending,
  collapsed,
  onCollapsedChange,
  strings,
  onSelect,
}: {
  visits: HospitalOutpatientVisit[]
  selectedId: string
  itemCounts: Map<string, number>
  clinicianName: string | null
  /** Reports still importing: no visit can be called empty yet. */
  reportsPending: boolean
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  strings: VisitListStrings
  onSelect: (id: string) => void
}) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])
  const countLabel = strings.visitCount.replace('{count}', String(visits.length))
  return (
    <>
      {/* Folded (wide panels only): a rail that opens the column again. */}
      {collapsed && (
        <div className="hidden shrink-0 flex-col items-center gap-2 border-r border-border pr-2 @[44rem]/lo:flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={strings.expand}
            title={strings.expand}
            onClick={() => onCollapsedChange(false)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="whitespace-nowrap text-xs text-muted-foreground">{strings.visitCountShort.replace('{count}', String(visits.length))}</span>
        </div>
      )}
      <nav
        aria-label={strings.label}
        className={cn(
          'min-w-0 @[44rem]/lo:w-60 @[44rem]/lo:shrink-0 @[44rem]/lo:border-r @[44rem]/lo:border-border @[44rem]/lo:pr-3',
          collapsed && '@[44rem]/lo:hidden',
        )}
      >
        <div className="mb-1 hidden items-center justify-between gap-2 @[44rem]/lo:flex">
          <span className="text-xs font-semibold text-muted-foreground">{countLabel}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={strings.collapse}
            title={strings.collapse}
            onClick={() => onCollapsedChange(true)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div
          role="group"
          aria-label={strings.label}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 @[44rem]/lo:mx-0 @[44rem]/lo:max-h-[34rem] @[44rem]/lo:flex-col @[44rem]/lo:gap-0.5 @[44rem]/lo:overflow-y-auto @[44rem]/lo:overflow-x-visible @[44rem]/lo:px-0"
        >
          {visits.map((candidate, index) => {
            const selected = candidate.id === selectedId
            const count = itemCounts.get(candidate.id) ?? 0
            const empty = !reportsPending && count === 0
            const physician = candidate.physician && isSameClinician(candidate.physician, clinicianName)
              ? strings.youTemplate.replace('{name}', candidate.physician)
              : candidate.physician
            const year = candidate.date.slice(0, 4)
            const newYear = index === 0 || visits[index - 1].date.slice(0, 4) !== year
            const status = reportsPending && count === 0
              ? strings.pending
              : empty ? strings.noResults : strings.itemCount.replace('{count}', String(count))
            return (
              <Fragment key={candidate.id}>
                {newYear && (
                  <span className="hidden px-1.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground @[44rem]/lo:block">
                    {year}
                  </span>
                )}
                <button
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(candidate.id)}
                  className={cn(
                    'flex min-h-[44px] shrink-0 flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors @[44rem]/lo:w-full',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary bg-accent text-accent-foreground' : 'border-border hover:bg-muted/60 @[44rem]/lo:border-transparent',
                  )}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className={cn('text-sm font-semibold tabular-nums', empty && !selected && 'text-muted-foreground')}>
                      {visitDay(candidate.date)}
                    </span>
                    <span className="hidden text-xs text-muted-foreground @[44rem]/lo:inline">{status}</span>
                  </span>
                  <span className="max-w-[12rem] truncate text-xs text-muted-foreground @[44rem]/lo:max-w-full">
                    {[candidate.department, physician].filter(Boolean).join(' · ')}
                    {/* In the chip row the status shares the second line. */}
                    {empty && <span className="@[44rem]/lo:hidden">{` · ${strings.noResults}`}</span>}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </div>
      </nav>
    </>
  )
}

function FlagLabel({ label }: { label?: string }) {
  if (!label) return null
  return (
    <span className="shrink-0 text-[0.6875rem] font-semibold text-clinical-abnormal" title={label}>
      {FLAG_CODES[label] ?? label}
    </span>
  )
}

type ComparisonStrings = { above: string; below: string; tooltip: string }

type LabColumns = { item: string; current: string; range: string; previous: string }

// One table for every category, so names, values, ranges and previous results
// line up down the whole section; a category is a heading row, not a box.
// A narrow panel drops the range column and shows the range under the value.
const LAB_GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.7fr)] items-baseline gap-x-3 @[36rem]/labs:grid-cols-[minmax(0,1.3fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]'
const RANGE_COLUMN = 'hidden @[36rem]/labs:block'

// "12.6 g/dL" → number and unit, so the unit can recede beside the figure.
function splitValue(value: string): { figure: string; unit: string } {
  const match = value.match(/^([<>≤≥]?\s*[-+]?[\d.,]+)\s*(.*)$/)
  return match ? { figure: match[1].replace(/\s+/g, ''), unit: match[2] } : { figure: value, unit: '' }
}

// The range as written, without the bracket chrome the source wraps it in.
function rangeText(text?: string): string {
  return (text ?? '').replace(/^\[(.*)\]$/, '$1').trim()
}

function ValueCell({
  result,
  comparison,
  comparisonStrings,
  range,
}: {
  result: LabResult & { value: string }
  range: string
  comparison?: 'high' | 'low'
  comparisonStrings: ComparisonStrings
}) {
  const abnormal = isAbnormal(result)
  const { figure, unit } = splitValue(result.value)
  // Never colour alone: the source's flag, or ↑/↓ when only the range says so.
  const flag = result.interpretationLabel && abnormal
    ? <FlagLabel label={result.interpretationLabel} />
    : !result.interpretationLabel && comparison
      ? (
        <span
          className="text-[0.6875rem] font-semibold text-clinical-abnormal"
          title={comparisonStrings.tooltip}
          aria-label={comparison === 'high' ? comparisonStrings.above : comparisonStrings.below}
        >
          {comparison === 'high' ? '↑' : '↓'}
        </span>
      )
      : null
  return (
    <span className="min-w-0">
      <span className="whitespace-nowrap">
        <span className={cn('font-semibold tabular-nums', abnormal ? 'text-clinical-abnormal' : 'text-foreground')}>{figure}</span>
        {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
        {flag && <span className="ml-1.5">{flag}</span>}
      </span>
      {range && <span className="block text-[0.6875rem] tabular-nums text-muted-foreground @[36rem]/labs:hidden">{range}</span>}
    </span>
  )
}

function LabTable({
  groups,
  categoryLabel,
  priorValues,
  comparisons,
  comparisonStrings,
  columns,
  sourceObservations,
}: {
  groups: Array<{ categoryId: string | null; tests: EncounterObservation[] }>
  sourceObservations: Map<string, any>
  categoryLabel: (id: string | null) => string
  priorValues: Map<string, PriorLabValue>
  comparisons: Map<string, 'high' | 'low'>
  comparisonStrings: ComparisonStrings
  columns: LabColumns
}) {
  const cell = 'min-w-0 break-words'
  return (
    <div role="table" aria-label={columns.item} className="@container/labs overflow-hidden rounded-md border border-border/80 bg-card text-sm">
      <div role="row" className={cn(LAB_GRID, 'border-b border-border/80 bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground')}>
        <span role="columnheader">{columns.item}</span>
        <span role="columnheader">{columns.current}</span>
        <span role="columnheader" className={RANGE_COLUMN}>{columns.range}</span>
        <span role="columnheader">{columns.previous}</span>
      </div>
      {groups.map((group, index) => (
        <div role="rowgroup" key={group.categoryId ?? `other-${index}`}>
          <div role="row" className="border-b border-border/60 px-3 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground">
            <span role="cell">{categoryLabel(group.categoryId)}</span>
          </div>
          {group.tests.map((test) => {
            const prior = priorValues.get(test.id)
            return (
              <div key={test.id} className="border-b border-border/50 last:border-b-0">
                <div role="row" className={cn(LAB_GRID, 'px-3 py-1.5')}>
                  <span role="cell" className={cn(cell, 'flex items-center gap-1 font-medium')}>
                    <span className="min-w-0 break-words">{test.title}</span>
                    {/* The reports tab's own trend / history pane for this result. */}
                    <ObservationLongitudinalAction
                      observation={sourceObservations.get(test.id)}
                      title={test.title}
                      sourceId={`last-outpatient:observation-longitudinal:${test.id}`}
                      className="shrink-0"
                    />
                  </span>
                  <span role="cell" className={cell}>
                    <ValueCell result={test} comparison={comparisons.get(test.id)} comparisonStrings={comparisonStrings} range={rangeText(test.referenceText)} />
                  </span>
                  <span role="cell" className={cn(cell, RANGE_COLUMN, 'text-xs tabular-nums text-muted-foreground')}>{rangeText(test.referenceText)}</span>
                  <span role="cell" className={cn(cell, 'flex flex-col leading-tight')}>
                    {prior && (
                      <>
                        <span className="tabular-nums text-foreground/80">
                          {prior.value}
                          {prior.unit && <span className="ml-1 text-xs text-muted-foreground">{prior.unit}</span>}
                        </span>
                        <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{shortDay(prior.date)}</span>
                      </>
                    )}
                  </span>
                </div>
                {test.components.map((component) => (
                  <div role="row" key={component.id} className={cn(LAB_GRID, 'px-3 py-1 pl-6 text-[0.8125rem]')}>
                    <span role="cell" className={cn(cell, 'text-foreground/90')}>{component.title}</span>
                    <span role="cell" className={cell}>
                      <ValueCell result={component} comparison={comparisons.get(component.id)} comparisonStrings={comparisonStrings} range={rangeText(component.referenceText)} />
                    </span>
                    <span role="cell" className={cn(cell, RANGE_COLUMN, 'text-xs tabular-nums text-muted-foreground')}>{rangeText(component.referenceText)}</span>
                    <span role="cell" />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function LastOutpatientCard() {
  const { t } = useLanguage()
  const strings = t.lastOutpatient
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [onlyAbnormal, setOnlyAbnormal] = useState(false)
  // Folded or not is remembered per browser; read after mount (no storage on the server).
  const [listCollapsed, setListCollapsed] = useState(false)
  useEffect(() => { setListCollapsed(readCollapsed()) }, [])
  const {
    isLoading,
    reportsPending,
    clinicianName,
    clinicianMatched,
    visits,
    itemCounts,
    visit,
    details,
    priorValues,
    rangeComparisons,
    sharedCount,
    sourceObservations,
  } = useLastOutpatient(selectedVisitId)

  const categoryLabel = (id: string | null): string =>
    (t.reports.cumulativeCategories as Record<string, string>)[id ?? 'other'] || id || ''

  const tests = details?.tests ?? []
  const reports = details?.reports ?? []
  const abnormalCount = tests.filter(hasAbnormal).length
  const groups = (details?.testGroups ?? [])
    .map((group) => ({ ...group, tests: onlyAbnormal ? group.tests.filter(hasAbnormal) : group.tests }))
    .filter((group) => group.tests.length > 0)
  const isYours = !!visit && isSameClinician(visit.physician, clinicianName)


  return (
    <FeatureCard
      title={strings.title}
      featureId="last-outpatient"
      isLoading={isLoading}
      isEmpty={!visit}
      emptyMessage={strings.empty}
    >
      {visit && (
        <div className="@container/lo" data-testid="last-outpatient">
        <div className="flex flex-col gap-4 @[44rem]/lo:flex-row @[44rem]/lo:items-start">
          {visits.length > 1 && (
            <VisitList
              visits={visits}
              selectedId={visit.id}
              itemCounts={itemCounts}
              clinicianName={clinicianName}
              reportsPending={reportsPending}
              collapsed={listCollapsed}
              onCollapsedChange={(next) => { setListCollapsed(next); writeCollapsed(next) }}
              strings={{
                label: strings.visitPicker,
                youTemplate: strings.physicianYou,
                noResults: strings.noResults,
                pending: strings.visitPending,
                itemCount: strings.visitItemCount,
                visitCount: strings.visitCount,
                visitCountShort: strings.visitCountShort,
                collapse: strings.collapseVisits,
                expand: strings.expandVisits,
              }}
              onSelect={setSelectedVisitId}
            />
          )}
          <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[max(15px,1rem)] font-semibold tabular-nums">{visitDay(visit.date)}</span>
              {visit.department && <span className="font-medium">{visit.department}</span>}
              {visit.physician && (
                <span className="text-sm text-foreground/80">
                  {isYours ? fill(strings.physicianYou, { name: visit.physician }) : visit.physician}
                </span>
              )}
              {visit.institution && <span className="text-sm text-muted-foreground">{visit.institution}</span>}
            </div>
            {clinicianName && !clinicianMatched && (
              <p className="text-sm text-muted-foreground">{fill(strings.noMatch, { name: clinicianName })}</p>
            )}
            {/* Pick the name right here; the same menu is in 設定. A new name
                opens that clinician's own last visit. */}
            <ClinicianNamePicker idPrefix="last-outpatient-name" inline onChange={() => setSelectedVisitId(null)} />
          </div>

          {tests.length === 0 && reports.length === 0 ? (
            <p className="text-sm text-muted-foreground" role={reportsPending ? 'status' : undefined}>
              {reportsPending ? strings.reportsPending : strings.empty}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {fill(strings.summary, { count: tests.length + reports.length })}
                  {abnormalCount > 0 && (
                    <>
                      {' · '}
                      <span className="font-medium text-clinical-abnormal">
                        {fill(strings.abnormalCount, { count: abnormalCount })}
                      </span>
                    </>
                  )}
                  {sharedCount > 0 && <> · {fill(strings.sharedCount, { count: sharedCount })}</>}
                  {reportsPending && <> · {strings.reportsPending}</>}
                </p>
                {tests.length > 0 && (
                  <div className="flex gap-1" role="group" aria-label={strings.filterLabel}>
                    {([[true, strings.abnormal], [false, strings.all]] as const).map(([value, label]) => (
                      <Button
                        key={label}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-pressed={onlyAbnormal === value}
                        onClick={() => setOnlyAbnormal(value)}
                        className={cn(
                          'h-8 rounded-full px-3 text-xs',
                          onlyAbnormal === value && 'border-primary bg-accent text-accent-foreground hover:bg-accent',
                        )}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {tests.length > 0 && (
                <section className="space-y-2" aria-labelledby="last-outpatient-labs">
                  <h3 id="last-outpatient-labs" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {strings.labs}
                  </h3>
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{strings.noAbnormal}</p>
                  ) : (
                    <LabTable
                      groups={groups}
                      categoryLabel={categoryLabel}
                      priorValues={priorValues}
                      comparisons={rangeComparisons}
                      comparisonStrings={t.reports.referenceComparison}
                      columns={{ item: strings.labItem, current: strings.labCurrent, range: strings.labRange, previous: strings.previousLabel }}
                      sourceObservations={sourceObservations}
                    />
                  )}
                </section>
              )}

              {reports.length > 0 && (
                <section className="space-y-2" aria-labelledby="last-outpatient-reports">
                  <h3 id="last-outpatient-reports" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {strings.reports}
                  </h3>
                  <div className="grid min-w-0 max-w-full gap-0 overflow-hidden">
                    {reports.map((report) => (
                      <div key={report.id} className="min-w-0 max-w-full overflow-hidden">
                        <ReportRow row={report.row} defaultOpen={[]} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          </div>
        </div>
        </div>
      )}
    </FeatureCard>
  )
}
