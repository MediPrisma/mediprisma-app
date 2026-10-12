"use client"

import { CalendarDays } from 'lucide-react'
import { useAudience } from "@/src/application/providers/audience.provider"
import { useLanguage } from "@/src/application/providers/language.provider"
import { CLINICAL_SOURCE_TONE } from "@/features/clinical-summary/components/clinical-color-roles"
import { cn } from "@/src/shared/utils/cn.utils"
import type { MedicationRow } from '../types'
import { compactMedicationDate } from '../utils/medication-date-display'
import {
  medicationIcdChipClass,
  medicationIcdCodeClass,
  medicationIcdDescriptionClass,
} from './medication-chip-styles'
import { sharedVisitIcd, startDayOf, type VisitBand } from '../utils/visit-bands'

/** Overlay marks for a visit-banded row (parent must be `relative`). The left
 *  bar repeats the band as shape + contrast so visits stay separable for
 *  colour-blind readers and in print; a heavier top rule marks each new visit.
 *  Both are pointer-events-none so the row's toggle and hover still work. */
export function VisitBandMarks({ band }: { band: VisitBand }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px]',
          band.band === 1 ? 'bg-sky-500/70 dark:bg-sky-400/70' : 'bg-border',
        )}
      />
      {band.visitStart && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-foreground/20"
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
}: {
  /** Rows of this visit (at least the first). */
  rows: Array<MedicationRow | undefined>
  /** Total rows in the visit (may exceed rows rendered so far). */
  count: number
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
  const countText = ((one ? mt.visitHeaderCountOne : mt.visitHeaderCount) ?? '{n} 項')
    .replace('{n}', String(count))
  const label = ((one ? mt.visitHeaderLabelOne : mt.visitHeaderLabel) ?? '{date} {institution} 就診，{n} 項用藥')
    .replace('{date}', date)
    .replace('{institution}', institution)
    .replace('{n}', String(count))
  // aria-label is ignored on a plain div, so the summary is read from an
  // sr-only span and the visible pieces are hidden from assistive tech.
  return (
    <div
      data-visit-header
      className="flex min-w-0 items-center gap-1.5 pb-0.5 pl-9 pr-3 pt-1.5 text-[0.6875rem] leading-tight text-muted-foreground"
    >
      <span className="sr-only">
        {icd ? `${label} · ${icd.code}${icd.text ? ` ${icd.text}` : ''}` : label}
      </span>
      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span aria-hidden className="shrink-0 font-semibold tabular-nums text-foreground/85">{date}</span>
      {/* Shrinks before the count: a full hospital name is wider than a
          phone-width row, and the list clips whatever overflows. */}
      {/* Same tones as the row's institution and ICD chip, at header size. */}
      {institution && (
        <span
          aria-hidden
          data-visit-header-institution
          className={cn('min-w-0 truncate', CLINICAL_SOURCE_TONE)}
          title={institution}
        >
          {institution}
        </span>
      )}
      {icd && (
        <span
          aria-hidden
          data-visit-header-icd
          className={cn(medicationIcdChipClass, 'h-4 w-auto shrink text-[0.6875rem] hover:bg-amber-50/50 dark:hover:bg-amber-500/10')}
          title={icd.text ? `${icd.code} ${icd.text}` : icd.code}
        >
          <span className={medicationIcdCodeClass}>{icd.code}</span>
          {icd.text && <span className={medicationIcdDescriptionClass}>{icd.text}</span>}
        </span>
      )}
      <span aria-hidden className="ml-auto shrink-0 tabular-nums">{countText}</span>
    </div>
  )
}
