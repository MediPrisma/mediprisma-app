"use client"

import { useState, type ReactNode } from "react"
import { isAbnormalInterpretationLabel } from "@voho0000/clinical-lab-normalization/interpretation"
import { FeatureCard } from "@/src/shared/components"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CompactLabResultRow } from "@/features/clinical-summary/components/CompactLabResultRow"
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

function ResultRow({
  result,
  comparison,
  comparisonStrings,
  trailing,
}: {
  result: LabResult & { title: string; value: string; referenceText?: string; refRangeUnassessed?: boolean }
  comparison?: 'high' | 'low'
  comparisonStrings: ComparisonStrings
  trailing?: ReactNode
}) {
  const abnormal = isAbnormal(result)
  const flagged = !!result.interpretationLabel && abnormal
  return (
    <CompactLabResultRow
      title={result.title}
      value={result.value}
      abnormal={abnormal}
      referenceText={result.referenceText}
      referenceComparison={!result.interpretationLabel ? comparison : undefined}
      referenceComparisonLabel={comparison === 'high' ? comparisonStrings.above : comparisonStrings.below}
      referenceComparisonTooltip={comparisonStrings.tooltip}
      rangeUnassessed={result.refRangeUnassessed}
      afterValue={flagged ? <FlagLabel label={result.interpretationLabel} /> : undefined}
      trailingContent={trailing}
      adaptivePhoneLayout
      alignedDesktopColumns
    />
  )
}

function LabRow({
  test,
  prior,
  previousTemplate,
  comparisons,
  comparisonStrings,
}: {
  test: EncounterObservation
  prior?: PriorLabValue
  previousTemplate: string
  comparisons: Map<string, 'high' | 'low'>
  comparisonStrings: ComparisonStrings
}) {
  return (
    <div>
      <ResultRow
        result={test}
        comparison={comparisons.get(test.id)}
        comparisonStrings={comparisonStrings}
        trailing={prior ? (
          <span className="whitespace-nowrap text-[0.6875rem] tabular-nums text-muted-foreground">
            {fill(previousTemplate, { value: prior.value, date: shortDay(prior.date) })}
          </span>
        ) : undefined}
      />
      {test.components.length > 0 && (
        <div className="ml-4">
          {test.components.map((component) => (
            <ResultRow
              key={component.id}
              result={component}
              comparison={comparisons.get(component.id)}
              comparisonStrings={comparisonStrings}
            />
          ))}
        </div>
      )}
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
            {!clinicianName && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 py-1 text-sm"
                title={strings.setNameHint}
                onClick={() => revealTab('settings', { settingsTab: 'display' })}
              >
                {strings.setName}
              </Button>
            )}
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
                  {/* Two columns only once a row keeps its value, range and previous
                      result on one line; the split panel stays single-column. */}
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{strings.noAbnormal}</p>
                  ) : (
                    <div className="grid gap-x-6 gap-y-3 @[72rem]:grid-cols-2">
                      {groups.map((group, index) => (
                        <div key={group.categoryId ?? `other-${index}`} className="min-w-0 space-y-1">
                          <div className="px-0.5 text-[max(12px,0.75rem)] font-medium text-muted-foreground">
                            {categoryLabel(group.categoryId)}
                          </div>
                          <div className="divide-y divide-border/70 rounded-md border border-border/80 bg-card/45 px-2">
                            {group.tests.map((test) => (
                              <LabRow
                                key={test.id}
                                test={test}
                                prior={priorValues.get(test.id)}
                                previousTemplate={strings.previous}
                                comparisons={rangeComparisons}
                                comparisonStrings={t.reports.referenceComparison}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
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
