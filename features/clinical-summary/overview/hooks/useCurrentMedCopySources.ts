"use client"

// What the 用藥 tab's 複製 reads: the 總覽 card's own items, from the same
// hook, so the two buttons paste the same text. Which drugs are 現在用藥 —
// running, or ran out in the last 14 days — does not depend on the window's
// length; only 原劑量 (a dose adjusted inside the window) does, and 總覽's
// default window keeps that the same as an untouched 總覽.
import { useMemo } from 'react'
import { useNow } from '@/src/shared/hooks/use-now.hook'
import type { MedCopySourceItem } from '@/features/clinical-summary/medications/utils/medication-copy-text'
import { buildOverviewWindow, DEFAULT_OVERVIEW_RANGE_MONTHS } from '../utils/overview-selectors'
import { toMedCopySourceItems } from '../utils/overview-med-copy'
import { useOverviewMeds } from './useOverviewMeds'

const NONE: readonly unknown[] = []

export function useCurrentMedCopySources(
  medications: readonly unknown[],
  audience: 'medical' | 'patient',
  locale: string,
  /** False skips the work: hooks cannot be called conditionally. */
  enabled: boolean,
): MedCopySourceItem[] {
  const nowMs = useNow()
  const window = useMemo(() => buildOverviewWindow(DEFAULT_OVERVIEW_RANGE_MONTHS, nowMs), [nowMs])
  const { meds } = useOverviewMeds(enabled ? medications : NONE, window, audience, locale)
  return useMemo(() => toMedCopySourceItems(meds.items), [meds.items])
}
