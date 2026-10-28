// ProblemListCard — patient problem / diagnosis list.
//
// Shows ALL fetched conditions (no category filter), so it works for BOTH:
//   - bridge-tagged `problem-list-item` conditions (健保存摺 重大傷病), and
//   - standard FHIR servers / the SMART sandbox, where conditions are usually
//     category `encounter-diagnosis` (or have no category at all).
// A clinicalStatus filter (default: Active) keeps the card focused — general
// FHIR sources carry lots of `resolved` history that would otherwise flood it.
//
// Visit codes — each claim's primary ICD-10 code (Encounter.reasonCode[0]) and
// the hospital's own statusless encounter-diagnosis Conditions — merge into
// one 就診診斷 list, one row per diagnosis. Only the remaining Conditions
// (重大傷病, statused problem-list items) stay on the recorded list with its
// status filter; when they are absent, the card is the one visit list.
"use client"

import { useMemo, useState } from 'react'
import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useDiagnosis } from '../diagnosis/hooks/useDiagnosis'
import { useDiagnosisRows } from '../diagnosis/hooks/useDiagnosisRows'
import { DiagnosisList } from '../diagnosis/components/DiagnosisList'
import { useVisitDiagnoses } from './hooks/useVisitDiagnoses'
import { VisitDiagnosisList } from './components/VisitDiagnosisList'
import { isVisitCodeCondition } from './utils/visit-diagnoses'
import { FilterPills } from './components/FilterPills'
import { buildIcdDictionary } from '@/src/shared/utils/icd-lookup'

type StatusFilter = 'active' | 'resolved' | 'all'

// FHIR clinicalStatus value set (hl7.org/fhir/valueset-condition-clinical).
const ACTIVE_STATUSES = new Set(['active', 'recurrence', 'relapse'])
const RESOLVED_STATUSES = new Set(['resolved', 'inactive', 'remission'])

function matchesFilter(clinicalStatus: string | undefined, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const s = (clinicalStatus || '').toLowerCase()
  // 'active' also keeps unknown/blank status — don't silently hide it.
  if (filter === 'active') return s === '' || ACTIVE_STATUSES.has(s)
  return RESOLVED_STATUSES.has(s)
}

export function ProblemListCard() {
  const { t, locale } = useLanguage()
  const { conditions, encounters, isLoading, error } = useDiagnosis()
  const visitDiagnoses = useVisitDiagnoses(conditions)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const tt = (t as any).problemList || {}
  const recordedConditions = useMemo(
    () => (Array.isArray(conditions) ? conditions.filter((c: any) => !isVisitCodeCondition(c)) : []),
    [conditions]
  )

  const filteredConditions = useMemo(
    () => recordedConditions.filter((c: any) => matchesFilter(c?.clinicalStatus, statusFilter)),
    [recordedConditions, statusFilter]
  )
  const icdDict = useMemo(() => buildIcdDictionary(conditions, locale, encounters), [conditions, locale, encounters])
  const rows = useDiagnosisRows(filteredConditions, locale, icdDict, encounters)

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'active', label: tt.filterActive || 'Active' },
    { key: 'resolved', label: tt.filterResolved || 'Resolved' },
    { key: 'all', label: tt.filterAll || 'All' },
  ]

  const hasConditions = recordedConditions.length > 0
  const hasVisitDiagnoses = visitDiagnoses.rows.length > 0
  // With no Condition to show, wait for encounters before calling the card empty.
  const loading = isLoading || (!hasConditions && !visitDiagnoses.isReady)

  return (
    <FeatureCard
      title={tt.title || 'Problem List'}
      featureId="problem-list"
      isLoading={loading}
      error={error}
      isEmpty={!hasConditions && !hasVisitDiagnoses}
      emptyMessage={tt.noData || 'No problem list items.'}
    >
      <div data-testid="problem-list-card">
        {/* Cap the visible height so a long problem list (e.g. 50+ 重大傷病)
            scrolls internally instead of pushing every card below it far down
            the panel's single outer scroll. Matches the AI-summary problem
            card's max-h + overflow pattern. */}
        <div className="max-h-[32rem] space-y-4 overflow-y-auto scrollbar-thin-persistent pr-1">
          {hasConditions && (
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {hasVisitDiagnoses && (
                  <h3 className="mr-1 font-medium text-foreground">
                    {tt.recordedTitle || 'Recorded conditions'}
                  </h3>
                )}
                <FilterPills
                  label={tt.statusFilterLabel || 'Status filter'}
                  options={filters}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
              {rows.length > 0 ? (
                <DiagnosisList diagnoses={rows} isLoading={false} error={null} />
              ) : (
                <p className="py-2 text-xs text-muted-foreground">{tt.filterNone || 'No items for this filter'}</p>
              )}
            </section>
          )}
          {hasVisitDiagnoses && <VisitDiagnosisList diagnoses={visitDiagnoses.rows} showTitle={hasConditions} />}
        </div>
      </div>
    </FeatureCard>
  )
}
