// Patient-facing medication education — benefit first, then one calm and
// practical reminder. This is intentionally a fixed structured card so each
// explanation stays traceable to the medication record instead of becoming an
// uncited free-form insight.
"use client"

import { useState } from "react"
import { ChevronDown, CircleCheckBig, HeartHandshake, Pill } from "lucide-react"
import { cn } from "@/src/shared/utils/cn.utils"
import type {
  MedicalSummaryResult,
} from "@/src/core/entities/medical-summary.entity"
import type { ResourceNavTarget } from "@/src/application/stores/resource-navigation.store"
import { SourceLink } from "./SourceLink"
import { resolveClaimSources } from "../utils/resolve-claim-sources"

interface MedicationEducationCardProps {
  result: MedicalSummaryResult
  title: string
  benefitLabel: string
  attentionLabel: string
  disclaimer: string
  typeLabel: (resourceType?: string) => string
  unverifiedLabel: string
  showMoreLabel: string
  showLessLabel: string
  onNavigate?: (target: ResourceNavTarget) => void
}

const INITIAL_VISIBLE = 2

export function MedicationEducationCard({
  result,
  title,
  benefitLabel,
  attentionLabel,
  disclaimer,
  typeLabel,
  unverifiedLabel,
  showMoreLabel,
  showLessLabel,
  onNavigate,
}: MedicationEducationCardProps) {
  const [showAll, setShowAll] = useState(false)
  // Tolerate encrypted caches from before this field existed.
  const items = result.medicationEducation ?? []
  if (items.length === 0) return null
  const byKey = new Map(result.sourceIndex.map((source) => [source.key, source]))
  const hiddenCount = Math.max(0, items.length - INITIAL_VISIBLE)
  const visible = showAll ? items : items.slice(0, INITIAL_VISIBLE)

  return (
    <section
      className="reveal-scope border-b border-border px-0.5 py-3"
      aria-labelledby="medication-education-title"
    >
      <h3 id="medication-education-title" className="mb-1.5 text-[length:max(12px,0.75rem)] font-semibold tracking-wide text-muted-foreground">
        {title}
      </h3>

      <div className="space-y-1.5">
        {visible.map((item, index) => {
          const sources = resolveClaimSources(
            item.sourceKeys,
            byKey,
            item.documentEvidence,
          )

          return (
            <article key={`${item.name}-${index}`} className="rounded-md border bg-teal-50/45 px-2.5 py-2 dark:bg-teal-500/[0.06]">
              <div className="flex items-start gap-1.5">
                <Pill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                <p className="min-w-0 text-[length:max(13px,0.875rem)] font-semibold leading-snug text-foreground">
                  <SourceLink
                    sources={sources}
                    typeLabel={typeLabel}
                    unverifiedLabel={unverifiedLabel}
                    onNavigate={onNavigate}
                  >
                    {item.name}
                  </SourceLink>
                </p>
              </div>

              <div className="mt-1.5 space-y-1.5 pl-5">
                <div className="flex items-start gap-1.5 text-[length:max(13px,0.8125rem)] leading-snug">
                  <HeartHandshake className="mt-px h-3 w-3 shrink-0 text-teal-600 dark:text-teal-400" />
                  <p className="min-w-0 text-foreground/90">
                    <span className="font-semibold text-teal-700 dark:text-teal-300">{benefitLabel}：</span>
                    {item.benefit}
                  </p>
                </div>
                <div className="flex items-start gap-1.5 text-[length:max(13px,0.8125rem)] leading-snug">
                  <CircleCheckBig className="mt-px h-3 w-3 shrink-0 text-blue-500 dark:text-blue-300" />
                  <p className="min-w-0 text-muted-foreground">
                    <span className="font-semibold text-foreground/75">{attentionLabel}：</span>
                    {item.attention}
                  </p>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-2 flex min-h-[44px] items-center gap-1 text-[length:max(12px,0.75rem)] font-medium text-primary hover:text-primary/80 lg:min-h-8"
          aria-expanded={showAll}
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
          {showAll ? showLessLabel : showMoreLabel.replace("{count}", String(hiddenCount))}
        </button>
      ) : null}

      <p className="mt-2 border-t border-teal-100 pt-1.5 text-[length:max(12px,0.75rem)] leading-snug text-muted-foreground dark:border-teal-500/20">
        {disclaimer}
      </p>
    </section>
  )
}
