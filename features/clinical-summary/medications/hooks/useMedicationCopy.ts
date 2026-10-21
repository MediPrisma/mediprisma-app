"use client"

// One place that ties 複製現在用藥 together: which items count, the
// clinician's format, and the words the paste prints in the UI's language.

import { useCallback, useMemo } from 'react'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import { useNow } from '@/src/shared/hooks/use-now.hook'
import type { MedCopyFormat } from '@/src/application/stores/outpatient-prefs.store'
import {
  buildMedicationCopyText,
  resolveMedCopyFormat,
  selectMedicationsForCopy,
  type MedCopySelection,
  type MedCopySourceItem,
  type MedCopyText,
} from '../utils/medication-copy-text'

function localDayKey(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface MedicationCopyApi {
  selection: MedCopySelection
  /** The format 「複製」 uses — the clinician's one, else 緊湊. */
  format: MedCopyFormat
  /** The clinician has saved a format of their own. */
  hasCustomFormat: boolean
  build: (format: MedCopyFormat) => MedCopyText
}

export function useMedicationCopy(items: readonly MedCopySourceItem[]): MedicationCopyApi {
  const { t } = useLanguage()
  const strings = t.medCopy
  const prefs = useOutpatientPrefs()
  const nowMs = useNow()
  const today = localDayKey(nowMs)

  const selection = useMemo(() => selectMedicationsForCopy(items), [items])
  const format = useMemo(() => resolveMedCopyFormat(prefs.medFormat), [prefs.medFormat])

  const build = useCallback(
    (chosen: MedCopyFormat) => buildMedicationCopyText(selection, chosen, { today, labels: strings.text }),
    [selection, today, strings.text],
  )

  return {
    selection,
    format,
    hasCustomFormat: prefs.medFormat !== null,
    build,
  }
}
