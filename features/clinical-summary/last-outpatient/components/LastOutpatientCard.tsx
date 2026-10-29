"use client"

import { useState } from "react"
import { isAbnormalInterpretationLabel } from "@voho0000/clinical-lab-normalization/interpretation"
import { FeatureCard } from "@/src/shared/components"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ReportRow } from "@/features/clinical-summary/reports/components/ReportRow"
import type { EncounterObservation } from "@/features/clinical-summary/visit-history/components/EncounterObservationCard"
import { useLanguage } from "@/src/application/providers/language.provider"
import { useRightPanel } from "@/src/application/providers/right-panel.provider"
import { cn } from "@/src/shared/utils/cn.utils"
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

function visitLabel(visit: HospitalOutpatientVisit): string {
  return [visitDay(visit.date), visit.department, visit.physician].filter(Boolean).join(' · ')
}

function shortDay(day: string): string {
  return day.slice(5).replace('-', '/')
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
}: {
  groups: Array<{ categoryId: string | null; tests: EncounterObservation[] }>
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
                  <span role="cell" className={cn(cell, 'font-medium')}>{test.title}</span>
                  <span role="cell" className={cell}>
                    <ValueCell result={test} comparison={comparisons.get(test.id)} comparisonStrings={comparisonStrings} range={rangeText(test.referenceText)} />
                  </span>
                  <span role="cell" className={cn(cell, RANGE_COLUMN, 'text-xs tabular-nums text-muted-foreground')}>{rangeText(test.referenceText)}</span>
                  <span role="cell" className={cn(cell, 'flex flex-col leading-tight')}>
                    {prior && (
                      <>
                        <span className="tabular-nums text-foreground/80">{prior.value}</span>
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
  const { revealTab } = useRightPanel()
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [onlyAbnormal, setOnlyAbnormal] = useState(false)
  const {
    isLoading,
    reportsPending,
    clinicianName,
    clinicianMatched,
    visits,
    visit,
    details,
    priorValues,
    rangeComparisons,
    sharedCount,
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

  const picker = visits.length > 1 && visit ? (
    <Select value={visit.id} onValueChange={setSelectedVisitId}>
      <SelectTrigger size="sm" aria-label={strings.visitPicker} className="h-8 text-xs tabular-nums">
        {/* The visit's department and physician are in the line below; the
            closed picker only needs the date, so the card title keeps its row. */}
        <SelectValue>{visitDay(visit.date)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {visits.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id} className="text-xs">
            {visitLabel(candidate)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : undefined

  return (
    <FeatureCard
      title={strings.title}
      featureId="last-outpatient"
      isLoading={isLoading}
      isEmpty={!visit}
      emptyMessage={strings.empty}
      headerAction={picker}
    >
      {visit && (
        <div className="space-y-4" data-testid="last-outpatient">
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
            {/* Always reachable here: set the name, or change it after picking. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 py-1 text-sm"
              title={clinicianName ? undefined : strings.setNameHint}
              onClick={() => revealTab('settings', { settingsTab: 'display' })}
            >
              {clinicianName ? strings.changeName : strings.setName}
            </Button>
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
      )}
    </FeatureCard>
  )
}
