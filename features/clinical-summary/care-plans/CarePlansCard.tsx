// CarePlansCard — IPS "Plan of Care" section (FHIR R4 CarePlan).
//
// Surfaces 照護計畫 from 健保存摺 (糖尿病共同照護, 居家醫療整合照護 …).
// List layout: each plan is one block with a title, a status badge
// (進行中 / 已完成 / 已取消 …) and an indented list of its activities.
//
// SCAFFOLD: field access follows standard FHIR R4. Status → badge mapping uses
// the fixed FHIR CarePlan.status value set (not a fabricated NHI mapping).
// Display strings (title, category, activity descriptions) come from the
// source verbatim; nothing fabricated.
"use client"

import { useMemo } from 'react'
import { useLanguage } from "@/src/application/providers/language.provider"
import { FeatureCard } from "@/src/shared/components"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { useResourceAnchor } from "@/src/application/hooks/use-resource-anchor.hook"
import { getCodeableConceptText, formatDate } from "@/src/shared/utils/fhir-helpers"
import type { CarePlanEntity } from "@/src/core/entities/clinical-data.entity"
import { formatOrganizationDisplay } from '@/src/shared/utils/organization-display'
import { localizeDemoDisplayText } from '@/src/shared/utils/demo-display'

interface CarePlanItem {
  id: string
  title: string
  description: string
  institution: string
  status?: string
  statusText: string
  range: string
  activities: string[]
}

function getCarePlanTitle(cp: CarePlanEntity, locale: string): string {
  if (cp.title && cp.title.trim()) return localizeDemoDisplayText(cp.title.trim(), locale)
  const cat = Array.isArray(cp.category) ? cp.category[0] : undefined
  const catText = getCodeableConceptText(cat)
  if (catText && catText !== '—') return localizeDemoDisplayText(catText, locale)
  return localizeDemoDisplayText(cp.description?.trim() || '', locale) || '—'
}

function getActivities(cp: CarePlanEntity, locale: string): string[] {
  if (!Array.isArray(cp.activity)) return []
  return cp.activity
    .map((a) => {
      const detail = a?.detail
      if (!detail) return ''
      if (detail.description?.trim()) return localizeDemoDisplayText(detail.description.trim(), locale)
      const codeText = getCodeableConceptText(detail.code)
      return codeText && codeText !== '—' ? localizeDemoDisplayText(codeText, locale) : ''
    })
    .filter(Boolean)
}

const STATUS_CHIP: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  revoked: "bg-muted text-muted-foreground line-through",
  'on-hold': "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  draft: "bg-muted text-muted-foreground",
}

function getStatusLabel(status: string | undefined, tt: Record<string, string>): string {
  switch (status) {
    case 'active': return tt.statusActive
    case 'completed': return tt.statusCompleted
    case 'revoked': return tt.statusRevoked
    case 'on-hold': return tt.statusOnHold
    case 'draft': return tt.statusDraft
    default: return tt.statusUnknown
  }
}

export function CarePlansCard() {
  const { t, locale } = useLanguage()
  // Single-type card: gate on CarePlan alone (per-type queries).
  const { carePlans, resourceReady, error } = useClinicalData()
  const isLoading = !resourceReady.carePlans

  const tt = useMemo(() => (t as any).carePlans || ({
    title: 'Care Plans',
    noData: 'No care plans recorded (not provided by source).',
    activities: 'Activities',
    statusActive: 'Active',
    statusCompleted: 'Completed',
    statusRevoked: 'Cancelled',
    statusOnHold: 'On hold',
    statusDraft: 'Draft',
    statusUnknown: 'Unknown',
  }), [t])

  const items = useMemo(() => {
    const list = Array.isArray(carePlans) ? carePlans : []
    return list.map((cp, i) => {
      const start = cp.period?.start ? formatDate(cp.period.start) : ''
      const end = cp.period?.end ? formatDate(cp.period.end) : ''
      const range = start || end ? `${start}${start || end ? ' – ' : ''}${end}` : ''
      const title = getCarePlanTitle(cp, locale)
      const description = localizeDemoDisplayText(cp.description?.trim() || '', locale)
      return {
        // Stable fallback (created date, else list index) — never Math.random,
        // which would remount the row every render.
        id: cp.id || `careplan-${cp.created ?? `idx-${i}`}`,
        title,
        // Free-text programme description (verbatim). Suppressed when it's
        // already serving as the title — getCarePlanTitle falls back to the
        // description when there's no title/category, so showing both would
        // print the same sentence twice.
        description: description && description !== title ? description : '',
        // 收案醫療機構 — CarePlan.author.display (e.g. "中國北港醫").
        institution: cp.author?.display
          ? formatOrganizationDisplay(cp.author.display, locale)
          : '',
        status: cp.status,
        statusText: getStatusLabel(cp.status, tt),
        range,
        activities: getActivities(cp, locale),
      }
    })
  }, [carePlans, locale, tt])

  return (
    <FeatureCard
      title={tt.title}
      featureId="care-plans"
      isLoading={isLoading}
      error={error}
      isEmpty={items.length === 0}
      emptyMessage={tt.noData}
    >
      <ul className="max-h-[32rem] space-y-3 overflow-y-auto scrollbar-thin-persistent pr-1">
        {items.map((it) => (
          <CarePlanListItem key={it.id} it={it} />
        ))}
      </ul>
    </FeatureCard>
  )
}

// One care plan — extracted so it can hold a resource-navigation anchor: a
// cited "依據:照護計畫" in the Medical Summary scroll-flashes this row.
function CarePlanListItem({ it }: { it: CarePlanItem }) {
  const anchorRef = useResourceAnchor<HTMLLIElement>('CarePlan', it.id)
  return (
    <li ref={anchorRef} className="rounded-md border border-border/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{it.title}</span>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-xs " +
            (STATUS_CHIP[it.status || ''] || "bg-muted text-muted-foreground")
          }
        >
          {it.statusText}
        </span>
      </div>
      {it.range && <div className="mt-0.5 text-xs text-muted-foreground">{it.range}</div>}
      {it.institution && (
        <div className="mt-1 flex items-center gap-1 text-xs text-blue-600/80 dark:text-blue-400/80">
          <span>{it.institution}</span>
        </div>
      )}
      {it.description && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{it.description}</p>
      )}
      {it.activities.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-l-2 border-border/50 pl-3">
          {it.activities.map((a, i) => (
            <li key={i} className="text-xs text-muted-foreground">{a}</li>
          ))}
        </ul>
      )}
    </li>
  )
}
