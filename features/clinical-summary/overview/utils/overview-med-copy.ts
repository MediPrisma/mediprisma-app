// The overview's medication item → what 複製現在用藥 reads. Kept beside the
// overview because the item is the overview's shape; the copy rules themselves
// live in medications/utils/medication-copy-text.ts.

import type { MedCopySourceItem } from '@/features/clinical-summary/medications/utils/medication-copy-text'
import type { OverviewMedItem } from '../hooks/useOverviewMeds'

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed !== '—' ? trimmed : undefined
}

export function toMedCopySourceItem(item: OverviewMedItem): MedCopySourceItem {
  const { row } = item
  return {
    id: item.id,
    title: item.title,
    secondaryTitle: clean(item.secondaryTitle),
    dose: clean(row.dose),
    frequency: clean(row.frequency),
    route: clean(row.route),
    institution: clean(item.institution),
    day: item.day,
    durationDays: row.durationDays,
    endDay: item.supplyEndDay,
    daysRemaining: item.daysRemaining,
    isChronic: item.isChronic,
    isInactive: item.isInactive,
    isCurrent: item.isCurrent,
    status: (row.status ?? '').toLowerCase(),
    category: clean(item.category),
    previousDose: item.change?.kind === 'adjusted' ? clean(item.change.previousDose) : undefined,
  }
}

export function toMedCopySourceItems(items: readonly OverviewMedItem[]): MedCopySourceItem[] {
  return items.map(toMedCopySourceItem)
}
