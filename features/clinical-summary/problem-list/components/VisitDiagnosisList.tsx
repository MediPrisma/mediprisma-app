// 就診診斷 rows — one per diagnosis, hospital and 雲端 visits merged. 全部／慢性／
// 非慢性 filters on CCIR; undetermined codes (Z, V–Y) show only under 全部.
//
// One line per diagnosis so ten or more fit the first screen: code | name |
// dates | count, with the codes, the 最近 dates and the counts each lined up.
// Below 600px of list width the dates and count drop to a second line instead
// of squeezing the name. Each row opens to its visits — day, institution and
// clinic, secondary-diagnosis mark, and (on a chart holding both) the source.
"use client"

import { Fragment, useCallback, useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLanguage } from "@/src/application/providers/language.provider"
import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'
import { cn } from '@/src/shared/utils/cn.utils'
import { formatDate } from '../../diagnosis/utils/fhir-helpers'
import type { VisitDiagnosis, VisitDiagnosisVisit } from '../utils/visit-diagnoses'
import { FilterPills } from './FilterPills'

type ChronicityFilter = 'all' | 'chronic' | 'nonChronic'
type Labels = Record<string, string | undefined>

interface VisitDiagnosisListProps {
  diagnoses: VisitDiagnosis[]
  /** Shown only when the recorded Condition list sits above. */
  showTitle: boolean
}

const TAG = "ml-1.5 inline-block rounded border border-border px-1 align-[1px] text-xs leading-4 whitespace-nowrap text-muted-foreground font-normal"

function sourceLabel(visit: VisitDiagnosisVisit, tt: Labels): string | undefined {
  const hospital = visit.sources.includes('hospital')
  const cloud = visit.sources.includes('cloud')
  if (hospital && cloud) return tt.visitSourceBoth || 'Hospital + MediCloud'
  if (hospital) return tt.visitSourceHospital || 'Hospital'
  if (cloud) return tt.visitSourceCloud || 'MediCloud'
  return undefined
}

function VisitDiagnosisRow({ d, tt, mixedSources }: { d: VisitDiagnosis; tt: Labels; mixedSources: boolean }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  // A Condition cited in the Medical Summary tab scroll-flashes and opens this row.
  const openRow = useCallback(() => setOpen(true), [])
  const anchorRef = useResourceAnchor<HTMLLIElement>('Condition', d.conditionIds.length ? d.conditionIds : undefined, openRow)

  const count = ((d.visitCount === 1 ? tt.visitCountOne : tt.visitCount) || '{count}')
    .replace('{count}', String(d.visitCount))
  const first = formatDate(d.firstDate)
  const last = formatDate(d.lastDate)
  const dates = d.visitCount > 1 && first && last && first !== last
    ? [(tt.visitSince || '{date}').replace('{date}', first), (tt.visitLatest || '{date}').replace('{date}', last)]
    : [last || first]
  const meta = [
    // "E11.9 未伴有併發症 ×3" — the category name is already the row's title.
    d.variants?.map((variant) => {
      const detail = variant.description?.startsWith(d.description ?? '\0')
        ? variant.description.slice(d.description!.length).replace(/^[，,:：\s-]+/, '') : variant.description
      return [variant.code, detail, `×${variant.visitCount}`].filter(Boolean).join(' ')
    }).join('、'),
    d.institutions.join('、'),
  ].filter(Boolean).join(' · ')

  return (
    <li ref={anchorRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="grid w-full grid-cols-[1rem_5.5rem_minmax(0,1fr)_auto_4rem] items-baseline gap-x-3 rounded py-1.5 text-left leading-5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @max-[37.5rem]/dx:grid-cols-[1rem_minmax(0,1fr)] @max-[37.5rem]/dx:gap-x-1.5"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 translate-y-0.5 self-start text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
        />
        <span className="font-medium tabular-nums text-foreground">
          {d.code}
          {d.variants && <span className="block text-xs font-normal text-muted-foreground @max-[37.5rem]/dx:ml-1.5 @max-[37.5rem]/dx:inline">
            +{d.variants.filter((variant) => variant.code !== d.code).map((variant) => variant.code).join(' ')}
          </span>}
        </span>
        {' '}
        <span className="min-w-0 break-words text-foreground @max-[37.5rem]/dx:col-start-2">
          {d.description}
          {d.inpatient && <span className={TAG}>{tt.visitInpatient || 'Admitted'}</span>}
          {d.secondaryOnly && <span className={TAG}>{tt.visitSecondaryOnly || 'Secondary only'}</span>}
          {mixedSources && d.hospital && <span className={TAG}>{tt.visitSourceHospital || 'Hospital'}</span>}
          {meta && <span className="block text-xs text-muted-foreground">{meta}</span>}
        </span>
        {' '}
        <span className="contents @max-[37.5rem]/dx:col-start-2 @max-[37.5rem]/dx:flex @max-[37.5rem]/dx:flex-wrap @max-[37.5rem]/dx:gap-x-1.5">
          <span data-testid="visit-dates" className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @max-[37.5rem]/dx:min-w-0 @max-[37.5rem]/dx:whitespace-normal @max-[37.5rem]/dx:text-left">
            {dates.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                <span className="whitespace-nowrap">{part}</span>
              </Fragment>
            ))}
          </span>
          <span className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums @max-[37.5rem]/dx:text-left @max-[37.5rem]/dx:before:content-['·_']">
            {count}
          </span>
        </span>
      </button>
      {open && (
        <ul id={detailsId} className="mb-2 ml-7 divide-y divide-border rounded bg-muted/50 px-3 text-[max(12px,0.75rem)] @max-[37.5rem]/dx:ml-0">
          {d.visits.map((visit) => {
            const day = formatDate(visit.day)
            const end = visit.endDay && visit.endDay !== visit.day ? formatDate(visit.endDay) : undefined
            const source = mixedSources ? sourceLabel(visit, tt) : undefined
            const place = [visit.institution, visit.department].filter(Boolean).join('・')
            return (
              <li key={visit.key} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="w-[6.5rem] shrink-0 tabular-nums text-foreground">{end ? `${day}–${end}` : day}</span>
                <span className="min-w-0 flex-1 break-words text-foreground">
                  {d.variants && <span className="mr-1.5 tabular-nums">{visit.code}</span>}
                  {place}
                  {visit.originalText && <span className="block text-muted-foreground">{visit.originalText}</span>}
                </span>
                {!visit.primary && <span className="text-muted-foreground">{tt.visitSecondary || 'Secondary'}</span>}
                {source && <span className="whitespace-nowrap text-muted-foreground">{source}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export function VisitDiagnosisList({ diagnoses, showTitle }: VisitDiagnosisListProps) {
  const { t } = useLanguage()
  const tt: Labels = (t as any).problemList || {}
  const titleId = useId()
  const [filter, setFilter] = useState<ChronicityFilter>('all')

  const filters: { key: ChronicityFilter; label: string }[] = [
    { key: 'all', label: tt.filterAll || 'All' },
    { key: 'chronic', label: tt.filterChronic || 'Chronic' },
    { key: 'nonChronic', label: tt.filterNonChronic || 'Not chronic' },
  ]
  const shown = filter === 'all' ? diagnoses : diagnoses.filter((d) => d.chronicity === filter)
  // "雲端" only tells visits apart when a hospital import sits beside it.
  const sources = new Set(diagnoses.flatMap((d) => d.visits.flatMap((visit) => visit.sources)))
  const mixedSources = sources.has('hospital') && sources.has('cloud')

  return (
    <section data-testid="visit-diagnoses" aria-labelledby={showTitle ? titleId : undefined} aria-label={showTitle ? undefined : tt.visitTitle || 'Visit diagnoses'}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {showTitle && (
          <h3 id={titleId} className="mr-1 font-medium text-foreground">
            {tt.visitTitle || 'Visit diagnoses'}
          </h3>
        )}
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
          {shown.map((d) => <VisitDiagnosisRow key={d.key} d={d} tt={tt} mixedSources={mixedSources} />)}
        </ul>
      )}
    </section>
  )
}
