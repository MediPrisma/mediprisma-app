"use client"

import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { MoreHorizontal } from 'lucide-react'
import {
  getInterpretationTag,
  getReferenceRangeComparison,
  isInterpretationAbnormal,
} from '@voho0000/clinical-lab-normalization/interpretation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TapTooltip } from '@/src/shared/components/TapTooltip'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { cn } from '@/src/shared/utils/cn.utils'
import type { Observation } from '../../types'
import { getCodeableConceptText } from '../../utils/fhir-helpers'
import { formatNumberSmart } from '../../utils/number-format.utils'

export interface LabResultParts {
  /** Number with its comparator ("<0.40"), or the text/coded result. */
  value: string
  unit: string
  /** True for a text or coded result — it may take the unit column too. */
  isText: boolean
}

/** Value and unit in separate columns, so numbers align on their right edge and
 *  every unit starts on the same line. */
export function getLabResultParts(observation: Observation): LabResultParts {
  const quantity = observation.valueQuantity
  if (quantity && quantity.value != null) {
    return {
      value: `${quantity.comparator ?? ''}${formatNumberSmart(quantity.value)}`,
      unit: quantity.unit ?? '',
      isText: false,
    }
  }
  return {
    value: observation.valueString || getCodeableConceptText(observation.valueCodeableConcept) || '—',
    unit: '',
    isText: true,
  }
}

export interface LabFlag {
  /** What the flag column shows: "↑H", "↓L", "↑↑", "A", "POS", or a bare arrow. */
  text: string
  /** Spoken / tooltip wording. */
  label: string
  /** `interpretation` = the source's own flag; `range` = the app compared the
   *  value with a single, parseable reference range because the source sent no
   *  flag at all. The two must not read alike. */
  basis: 'interpretation' | 'range'
}

const INTERPRETATION_FLAGS: Record<string, { text: string; zh: string; en: string }> = {
  High: { text: '↑H', zh: '偏高', en: 'High' },
  'Critical High': { text: '↑↑', zh: '危急偏高', en: 'Critical high' },
  Low: { text: '↓L', zh: '偏低', en: 'Low' },
  'Critical Low': { text: '↓↓', zh: '危急偏低', en: 'Critical low' },
  Abnormal: { text: 'A', zh: '異常', en: 'Abnormal' },
  Positive: { text: 'POS', zh: '陽性', en: 'Positive' },
}

/**
 * The flag column. The source interpretation is authoritative: an abnormal tag
 * becomes its letter; a normal / negative tag shows nothing. Only when the
 * source sent no interpretation at all does the structured-range comparison
 * speak — as a bare arrow, never as the source's "H"/"L".
 */
export function getLabFlag(
  observation: Observation,
  locale: string,
  rangeLabels: { above: string; below: string },
): LabFlag | null {
  const isZh = locale.startsWith('zh')
  const tag = getInterpretationTag(observation.interpretation)
  if (tag) {
    if (!isInterpretationAbnormal(tag)) return null
    const known = INTERPRETATION_FLAGS[tag.label]
    if (known) return { text: known.text, label: isZh ? known.zh : known.en, basis: 'interpretation' }
    return { text: tag.label.slice(0, 3), label: tag.label, basis: 'interpretation' }
  }
  const comparison = getReferenceRangeComparison(observation)
  if (comparison === 'high') return { text: '↑', label: rangeLabels.above, basis: 'range' }
  if (comparison === 'low') return { text: '↓', label: rangeLabels.below, basis: 'range' }
  return null
}

export function LabFlagMark({ flag, rangeTooltip }: { flag: LabFlag | null; rangeTooltip: string }) {
  if (!flag) return null
  if (flag.basis === 'interpretation') {
    return (
      <span
        data-testid="lab-flag"
        data-flag-basis="interpretation"
        className="font-bold text-clinical-abnormal"
        title={flag.label}
      >
        <span aria-hidden="true">{flag.text}</span>
        <span className="sr-only">{flag.label}</span>
      </span>
    )
  }
  return (
    <TapTooltip
      content={`${flag.label}：${rangeTooltip}`}
      aria-label={flag.label}
      contentClassName="max-w-[min(90vw,22rem)] whitespace-normal text-xs leading-relaxed"
      className="inline-flex"
    >
      <span
        data-testid="lab-flag"
        data-flag-basis="range"
        className="font-semibold text-clinical-abnormal underline decoration-dotted underline-offset-2"
      >
        {flag.text}
      </span>
    </TapTooltip>
  )
}

/** Flag-column state for a value the app could not compare with its range. */
export function RangeUnassessedMark({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <TapTooltip
      content={tooltip}
      aria-label={`${label}：${tooltip}`}
      contentClassName="max-w-[min(90vw,22rem)] whitespace-normal text-xs leading-relaxed"
      className="inline-flex"
    >
      <span
        data-testid="lab-range-unassessed"
        className="whitespace-nowrap text-[0.6875rem] text-muted-foreground underline decoration-dotted underline-offset-2"
      >
        {label}
      </span>
    </TapTooltip>
  )
}

export interface LabRowMenuItem {
  key: string
  label: string
  onSelect: () => void
  separatorBefore?: boolean
}

/** The one action control every lab row carries, in the same column. On a
 *  phone the button keeps a 44px box (literal px: the root font is 12px there)
 *  and negative margins let it overlap the row's padding instead of widening
 *  the column or the row. */
export function LabRowMenu({ items, label, className }: { items: LabRowMenuItem[]; label: string; className?: string }) {
  if (items.length === 0) return <span className={className} />
  return (
    <div className={cn('flex justify-center', className)}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            data-testid="lab-row-menu"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted data-[state=open]:text-foreground max-md:-mx-[10px] max-md:-my-[12px] max-md:size-[44px]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44" onClick={(event) => event.stopPropagation()}>
          {items.map((item) => (
            <MenuEntry key={item.key} item={item} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MenuEntry({ item }: { item: LabRowMenuItem }) {
  return (
    <>
      {item.separatorBefore && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={item.onSelect} className="max-md:min-h-11">
        {item.label}
      </DropdownMenuItem>
    </>
  )
}

/** Copy helper for menu items: copies, then confirms with a toast. */
export function useLabCopy() {
  const { t } = useLanguage()
  const { copy } = useCopyToClipboard(1500)
  return async (text: string) => {
    if (await copy(text)) toast.success(t.reports.labTable.copied)
    else toast.error(t.common.copyFailed)
  }
}

export function MutedCell({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('min-w-0 text-xs text-muted-foreground', className)}>{children}</div>
}
