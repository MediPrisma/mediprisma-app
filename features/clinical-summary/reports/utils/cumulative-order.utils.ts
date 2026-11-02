// Category order for the cumulative report, shared by the tab strip and the
// stacked sections so the two never disagree.
//
// The shipped default follows LAB_CATEGORIES with ONE deliberate move: 微生物
// sits directly above 尿液. Both are specimen-driven panels a clinician reads
// together when working up an infection (urinalysis → urine culture), and the
// LAB_CATEGORIES order puts blood gas and viral antigens between them purely
// because of when those categories were added.
//
// A clinician can then reorder freely; the result is persisted per device by
// cumulative-report-prefs.store. Persisted arrays are treated as a HINT, never
// as the source of truth: categories are added and removed across releases, so
// the resolver drops ids that no longer exist and appends ids the saved order
// never knew about, in their default position order.

import { LAB_CATEGORIES } from '@/src/shared/utils/lab-categories'

/** `other` is the catch-all, not a reorderable panel: CumulativeLabReport
 *  appends it last, and only when it holds data. */
export const CUMULATIVE_REPORT_CATEGORY_IDS: string[] = LAB_CATEGORIES
  .filter((category) => category.id !== 'other')
  .map((category) => category.id)

function withMicrobiologyAboveUrine(ids: string[]): string[] {
  const urineIndex = ids.indexOf('urine')
  const microIndex = ids.indexOf('microbio')
  if (urineIndex < 0 || microIndex < 0) return ids
  const rest = ids.filter((id) => id !== 'microbio')
  const insertAt = rest.indexOf('urine')
  return [...rest.slice(0, insertAt), 'microbio', ...rest.slice(insertAt)]
}

export const DEFAULT_CUMULATIVE_CATEGORY_ORDER: string[] =
  withMicrobiologyAboveUrine(CUMULATIVE_REPORT_CATEGORY_IDS)

/**
 * Merge a persisted order with the categories that actually exist.
 *
 * - ids not in `available` are dropped (a category was removed or renamed)
 * - ids in `available` but missing from the saved order are appended in
 *   `defaultOrder` position, so a newly shipped panel is never invisible
 * - duplicates in the saved order are collapsed
 */
export function resolveCumulativeCategoryOrder(
  persisted: readonly string[] | null | undefined,
  available: readonly string[] = DEFAULT_CUMULATIVE_CATEGORY_ORDER,
  defaultOrder: readonly string[] = DEFAULT_CUMULATIVE_CATEGORY_ORDER,
): string[] {
  const availableSet = new Set(available)
  const resolved: string[] = []
  const seen = new Set<string>()
  for (const id of persisted ?? []) {
    if (!availableSet.has(id) || seen.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }
  // Anything the saved order did not mention keeps its default relative place.
  // Categories outside `defaultOrder` altogether tail in `available` order so
  // nothing is ever silently dropped.
  const tail = [
    ...defaultOrder.filter((id) => availableSet.has(id)),
    ...available.filter((id) => !defaultOrder.includes(id)),
  ]
  for (const id of tail) {
    if (seen.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }
  return resolved
}

/**
 * Move one category up (`-1`) or down (`1`). Out-of-range moves and unknown
 * ids return the SAME array reference, so a no-op cannot trigger a store write
 * or a re-render.
 */
export function moveCumulativeCategory(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const index = order.indexOf(id)
  if (index < 0) return order as string[]
  const target = index + direction
  if (target < 0 || target >= order.length) return order as string[]
  const next = [...order]
  next[index] = next[target]
  next[target] = id
  return next
}
