"use client"

// Opening the 用藥 format editor from the overview card's 編輯. There is one
// format to edit (by decision, 2026-10-05): the clinician's own, or — until
// they save one — a copy of the default 緊湊 to start from.

import { useCallback, useState, type ReactNode } from 'react'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import type { MedCopyFormat } from '@/src/application/stores/outpatient-prefs.store'
import { createMedCopyFormat, MED_COPY_CUSTOM_FORMAT_ID } from '../utils/medication-copy-text'
import { MedCopyFormatEditorDialog } from '../components/MedCopyFormatEditorDialog'
import type { MedicationCopyApi } from './useMedicationCopy'

export interface MedCopyFormatEditor {
  openEditor: () => void
  /** Render this wherever the editor should mount. */
  editorDialog: ReactNode
}

export function useMedCopyFormatEditor(api: MedicationCopyApi): MedCopyFormatEditor {
  const prefs = useOutpatientPrefs()
  const [draft, setDraft] = useState<MedCopyFormat | null>(null)

  const openEditor = useCallback(() => {
    setDraft(api.hasCustomFormat ? api.format : createMedCopyFormat(api.format, '', MED_COPY_CUSTOM_FORMAT_ID))
  }, [api.format, api.hasCustomFormat])

  const editorDialog = draft ? (
    <MedCopyFormatEditorDialog
      open
      onOpenChange={(open) => { if (!open) setDraft(null) }}
      initial={draft}
      build={api.build}
      onSave={(format) => {
        prefs.saveMedFormat({ ...format, id: MED_COPY_CUSTOM_FORMAT_ID })
        setDraft(null)
      }}
      onReset={api.hasCustomFormat
        ? () => {
          prefs.resetMedFormat()
          setDraft(null)
        }
        : undefined}
    />
  ) : null

  return { openEditor, editorDialog }
}
