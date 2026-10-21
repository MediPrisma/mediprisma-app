// 就醫主診斷 rows — claim primary codes, one per ICD-10 code. 全部／慢性／非慢性
// filters on CCIR; undetermined codes (Z, V–Y) show only under 全部.
//
// One line per code so ten or more fit the first screen: code | name | dates |
// count, with the codes, the 最近 dates and the counts each lined up. Below
// 600px of list width the dates and count drop to a second line instead of
// squeezing the name, and may wrap between 起 and 最近 so enlarged text still
// fits a phone.
"use client"

import { Fragment, useId, useState } from 'react'
import { useLanguage } from "@/src/application/providers/language.provider"
import { formatDate } from '../../diagnosis/utils/fhir-helpers'
import type { VisitPrimaryDiagnosis } from '../utils/visit-primary-diagnoses'
import { FilterPills } from './FilterPills'

type ChronicityFilter = 'all' | 'chronic' | 'nonChronic'

interface VisitPrimaryDiagnosisListProps {
  diagnoses: VisitPrimaryDiagnosis[]
}

export function VisitPrimaryDiagnosisList({ diagnoses }: VisitPrimaryDiagnosisListProps) {
  const { t } = useLanguage()
  const tt = (t as any).problemList || {}
  const titleId = useId()
  const [filter, setFilter] = useState<ChronicityFilter>('all')

  const filters: { key: ChronicityFilter; label: string }[] = [
    { key: 'all', label: tt.filterAll || 'All' },
    { key: 'chronic', label: tt.filterChronic || 'Chronic' },
    { key: 'nonChronic', label: tt.filterNonChronic || 'Not chronic' },
  ]
  const shown = filter === 'all' ? diagnoses : diagnoses.filter((d) => d.chronicity === filter)

  const count = (d: VisitPrimaryDiagnosis): string =>
    ((d.visitCount === 1 ? tt.visitCountOne : tt.visitCount) || '{count}')
      .replace('{count}', String(d.visitCount))
  const dates = (d: VisitPrimaryDiagnosis): string[] => {
    const first = formatDate(d.firstDate)
    const last = formatDate(d.lastDate)
    return d.visitCount > 1 && first && last && first !== last
      ? [(tt.visitSince || '{date}').replace('{date}', first), (tt.visitLatest || '{date}').replace('{date}', last)]
      : [last || first]
  }

  return (
    <section data-testid="visit-primary-diagnoses" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={titleId} className="font-medium text-foreground">
          {tt.visitTitle || 'Visit primary diagnoses'}
        </h3>
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
          {tt.visitBadge || 'Unconfirmed'}
        </span>
        <FilterPills
          label={tt.chronicityFilterLabel || 'Chronicity filter'}
          options={filters}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{tt.visitNote}</p>
      {shown.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{tt.filterNone || 'No items for this filter'}</p>
      ) : (
        <ul className="@container/dx mt-1 divide-y divide-border text-sm">
          {shown.map((d) => (
            <li
              key={d.key}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto_4rem] items-baseline gap-x-3 py-1.5 leading-5 @max-[37.5rem]/dx:flex @max-[37.5rem]/dx:flex-wrap @max-[37.5rem]/dx:gap-x-1.5"
            >
              <span className="contents text-foreground @max-[37.5rem]/dx:block @max-[37.5rem]/dx:basis-full">
                <span className="font-medium tabular-nums @max-[37.5rem]/dx:mr-1.5">{d.code}</span>{' '}
                <span className="min-w-0 break-words">
                  {d.description}
                  {d.inpatient && (
                    <span className="ml-1.5 inline-block rounded border border-border px-1 align-[1px] text-xs leading-4 whitespace-nowrap text-muted-foreground">
                      {tt.visitInpatient || 'Inpatient'}
                    </span>
                  )}
                </span>
              </span>
              <span className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @max-[37.5rem]/dx:min-w-0 @max-[37.5rem]/dx:whitespace-normal @max-[37.5rem]/dx:text-left">
                {dates(d).map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' · '}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
              </span>
              <span className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @max-[37.5rem]/dx:text-left @max-[37.5rem]/dx:before:content-['·_']">
                {count(d)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
