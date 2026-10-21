"use client"

import { useAudience } from "@/src/application/providers/audience.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { CLINICAL_SOURCE_TONE } from "@/features/clinical-summary/components/clinical-color-roles"
import { clinicalTooltipSurfaceClass } from "@/features/clinical-summary/components/clinical-metadata-styles"
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { cn } from "@/src/shared/utils/cn.utils"
import type { MedicationRow } from '../types'
import { compactMedicationDate } from '../utils/medication-date-display'
import {
  medicationIcdChipClass,
  medicationIcdCodeClass,
  medicationIcdDescriptionClass,
} from './medication-chip-styles'
import { TruncatedRevealLabel } from './TruncatedRevealLabel'
import { sharedVisitIcd, startDayOf, type VisitBand } from '../utils/visit-bands'

/** Overlay marks for a visit-banded row (parent must be `relative`). A top
 *  rule marks each new visit; with the visit header row it separates visits by
 *  shape alone, with no colour, so it holds for colour-blind readers and print.
 *  Both are pointer-events-none so the row's toggle and hover still work. */
export function VisitBandMarks({ band }: { band: VisitBand }) {
  return (
    <>
      {band.visitStart && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-border"
        />
      )}
    </>
  )
}

/** One-line header above the first row of a visit: date, institution,
 *  diagnosis (clinician view; part of the visit key) and how
 *  many drugs were prescribed at that visit. None for a drug whose start day
 *  is unknown: it is its own visit, and a dateless header would only repeat
 *  the institution its row already shows. */
export function VisitHeader({
  rows,
  count,
  total,
}: {
  /** Rows of this visit (at least the first). */
  rows: Array<MedicationRow | undefined>
  /** Total rows in the visit (may exceed rows rendered so far). */
  count: number
  /** The visit's row count before a search or class filter; shown as
   *  "1／3 項" when the filter left fewer. */
  total?: number
}) {
  const { t, locale = 'zh-TW' } = useLanguage()
  const { audience } = useAudience()
  const mt = t.medications as any
  const first = rows[0]
  const startDay = startDayOf(first)
  if (!first || !startDay) return null
  // zh re-orders the date into yy/mm/dd, so it must start from the source day
  // the visit is keyed on: re-parsing the runtime's display string read an
  // en-GB "06/08/2026" as June 8. Other locales only shorten that string.
  const date = locale.startsWith('zh')
    ? compactMedicationDate(startDay, locale)
    : compactMedicationDate(first.startedOn || startDay, locale)
  const institution = (first.pharmacy ?? '').trim()
  const icd = audience === 'medical' ? sharedVisitIcd(rows) : undefined
  const one = count === 1
  // A filter that left only part of the visit says so, so "1 項" never reads
  // as "this visit prescribed one drug".
  const filtered = total !== undefined && total > count
  const countText = (filtered
    ? (mt.visitHeaderCountFiltered ?? '{n}／{total} 項')
    : ((one ? mt.visitHeaderCountOne : mt.visitHeaderCount) ?? '{n} 項'))
    .replace('{n}', String(count))
    .replace('{total}', String(total))
  const label = (filtered
    ? (mt.visitHeaderLabelFiltered ?? '{date} 就診，{total} 項用藥中 {n} 項符合')
    : ((one ? mt.visitHeaderLabelOne : mt.visitHeaderLabel) ?? '{date} 就診，{n} 項用藥'))
    .replace('{date}', date)
    .replace('{n}', String(count))
    .replace('{total}', String(total))
  const icdTitle = icd ? (icd.text ? `${icd.code} ${icd.text}` : icd.code) : ''
  // aria-label is ignored on a plain div, so the date and count are read from
  // an sr-only span (the visible copies are hidden); institution and
  // diagnosis are buttons that name themselves.
  return (
    <div
      data-visit-header
      className="flex min-w-0 items-center gap-1.5 pb-0.5 pl-9 pr-3 pt-1.5 text-[0.6875rem] leading-tight text-muted-foreground"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="shrink-0 font-semibold tabular-nums text-foreground/85">{date}</span>
      {/* The rows below leave institution and diagnosis to this header, so
          both keep the row's tones and its tap-to-reveal (a title tooltip
          never shows on a phone). Both shrink before the count: a full
          hospital name is wider than a phone-width row. */}
      {institution && (
        <TruncatedRevealLabel
          data-testid="visit-header-institution"
          text={institution}
          className={cn('inline-flex min-w-0 shrink items-center', CLINICAL_SOURCE_TONE)}
        />
      )}
      {icd && (
        <TapTooltip
          asChild
          content={icdTitle}
          contentClassName={cn(
            clinicalTooltipSurfaceClass,
            'max-w-[min(90vw,28rem)] whitespace-normal break-words text-xs leading-relaxed',
          )}
        >
          <button
            type="button"
            data-visit-header-icd
            aria-label={icdTitle}
            className={cn(medicationIcdChipClass, 'h-4 w-auto shrink overflow-hidden text-left text-[0.6875rem]')}
          >
            <span className={cn(medicationIcdCodeClass, 'max-w-full truncate')}>{icd.code}</span>
            {icd.text && <span className={medicationIcdDescriptionClass}>{icd.text}</span>}
          </button>
        </TapTooltip>
      )}
      <span aria-hidden className="ml-auto shrink-0 tabular-nums">{countText}</span>
    </div>
  )
}
