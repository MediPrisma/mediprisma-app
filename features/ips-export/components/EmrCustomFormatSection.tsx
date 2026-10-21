"use client"

// 帶回病歷 → 我的格式: the clinician's own template, filled from this patient.
//
// Daily use is: glance at the preview, copy. The preview IS the clipboard text
// (same string). Anything the template could not fill honestly — a missing
// value, a newest exam with no text — is listed under it in words, and an
// exam line waiting for a decision is left out of the copy until the
// clinician picks, for this patient only.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import type { EmrCustomFormat, EmrExamKind } from '@/src/application/stores/outpatient-prefs.store'
import { cn } from '@/src/shared/utils/cn.utils'
import type { LabPivot } from '@/src/shared/utils/lab-pivot.utils'
import { findPinnableLab, resolvePinnedLab } from '@/src/shared/utils/pinned-labs'
import {
  formatEmrDate,
  newEmrFormat,
  renderEmrCustomFormat,
  starterTokens,
  type EmrExamDecision,
  type EmrFormatInputs,
  type EmrStarterId,
} from '../utils/emr-custom-format'
import { resolveLatestExams } from '../utils/emr-exam-kinds'
import { describeEmrNote } from './emr-format-notes'
import { EmrFormatEditorDialog } from './EmrFormatEditorDialog'

type EditorState = { format: EmrCustomFormat; isNew: boolean } | null

export function EmrCustomFormatSection({
  pivots,
  diagnosticReports,
  copiedKey,
  onCopy,
  toolbarLead,
}: {
  pivots: Record<string, LabPivot>
  diagnosticReports: any[]
  copiedKey: string
  onCopy: (text: string) => void
  /** The owner's format-source switch; shares this section's top row. */
  toolbarLead?: ReactNode
}) {
  const { t } = useLanguage()
  const c = t.ipsExport.emrHandoff.custom
  const prefs = useOutpatientPrefs()
  const [editor, setEditor] = useState<EditorState>(null)
  // Per patient, per visit: the owner remounts this section for each patient.
  const [decisions, setDecisions] = useState<Partial<Record<EmrExamKind, EmrExamDecision>>>({})

  const exams = useMemo(() => resolveLatestExams(diagnosticReports), [diagnosticReports])
  const inputs = useMemo<EmrFormatInputs>(() => ({
    resolveLab: (id) => resolvePinnedLab(pivots, id),
    labLabel: (id) => findPinnableLab(id)?.short ?? null,
    exams,
    examDecisions: decisions,
    unknownUnitLabel: c.unknownUnit,
  }), [pivots, exams, decisions, c.unknownUnit])

  // Every format is drawn and ready to copy — no picking one first.
  const rendered = useMemo(
    () => prefs.formats.map((format) => ({ format, result: renderEmrCustomFormat(format, inputs) })),
    [prefs.formats, inputs],
  )
  // The owner tracks one "custom" copied flag; this says which format it was.
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null)
  const labLabel = useCallback((id: string) => findPinnableLab(id)?.short ?? id, [])
  const pinned = useMemo(() => (prefs.pinnedLabs ?? []).filter((id) => findPinnableLab(id)), [prefs.pinnedLabs])

  // A format just saved — often a new one at the end of the list — is
  // brought into view so it is plain that it was added, not swapped in.
  const listRef = useRef<HTMLUListElement>(null)
  const revealIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = revealIdRef.current
    if (!id) return
    revealIdRef.current = null
    listRef.current?.querySelector(`[data-format-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [rendered])

  const startNew = (starter: EmrStarterId, label: string) => {
    setEditor({ format: newEmrFormat(starter === 'blank' ? '' : label, starterTokens(starter, pinned)), isNew: true })
  }

  const decide = (kind: EmrExamKind, decision: EmrExamDecision | undefined) => {
    setDecisions((prev) => {
      const next = { ...prev }
      if (decision) next[kind] = decision
      else delete next[kind]
      return next
    })
  }

  const editorDialog = editor ? (
    <EmrFormatEditorDialog
      initial={editor.format}
      isNew={editor.isNew}
      pinnedLabIds={pinned}
      previewInputs={inputs}
      onClose={() => setEditor(null)}
      onSave={(format) => {
        prefs.saveFormat(format)
        setEditor(null)
        revealIdRef.current = format.id
      }}
      onDelete={() => {
        prefs.deleteFormat(editor.format.id)
        setEditor(null)
      }}
    />
  ) : null

  if (rendered.length === 0) {
    return (
      <section className="space-y-3">
        {toolbarLead}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{c.emptyTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.emptyBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ['lipid', c.starterLipid],
              ['pinnedPerLine', c.starterPinned],
              ['exams', c.starterExams],
              ['blank', c.starterBlank],
            ] as Array<[EmrStarterId, string]>).map(([starter, label]) => (
              <Button key={starter} type="button" variant="outline" size="sm" onClick={() => startNew(starter, label)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
        {editorDialog}
      </section>
    )
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        {toolbarLead}
        <Button type="button" variant="outline" size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={() => startNew('blank', '')}>
          <Plus className="h-3.5 w-3.5" />{c.newFormat}
        </Button>
      </div>

      <ul ref={listRef} className="mt-1 divide-y divide-border">
        {rendered.map(({ format, result }) => {
          const excluded = result.lines.filter((line) => !line.included)
          const copied = copiedKey === 'custom' && lastCopiedId === format.id
          const copyLabel = copied
            ? t.ipsExport.emrHandoff.copied
            : excluded.length > 0
              ? c.copyPartial.replace('{count}', String(excluded.length))
              : c.copy
          const name = format.name || c.formatLabel
          return (
            <li key={format.id} data-format-id={format.id} className="space-y-1.5 py-3 first:pt-1 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3>
                <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                  {c.chars.replace('{chars}', String(result.text.length))}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    aria-label={`${c.edit} ${name}`}
                    onClick={() => setEditor({ format, isNew: false })}
                  >
                    <Pencil className="h-3.5 w-3.5" />{c.edit}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    aria-label={`${copyLabel} ${name}`}
                    disabled={!result.text.trim()}
                    onClick={() => {
                      setLastCopiedId(format.id)
                      onCopy(result.text)
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copyLabel}
                  </Button>
                </div>
              </div>
              <pre data-testid="emr-custom-preview" className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {result.text || c.empty}
              </pre>
              {result.notes.length > 0 && (
                <ul className="space-y-1.5">
                  {result.notes.map((note, index) => {
                    const pendingExam = note.type === 'examPending' ? note : null
                    const undoable = note.type === 'examSkipped' || note.type === 'examUsedOlder' ? note : null
                    const needsDecision = !!pendingExam
                    return (
                      <li
                        key={index}
                        className={cn(
                          'flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs leading-relaxed',
                          needsDecision
                            ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
                            : 'border-border bg-muted/30 text-foreground',
                        )}
                      >
                        <span className="flex items-start gap-1.5">
                          {needsDecision && <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                          <span>{describeEmrNote(note, c, labLabel, format.dateStyle, format.missingText)}</span>
                        </span>
                        {pendingExam && (
                          <span className="flex flex-wrap gap-2 pl-5">
                            <Button type="button" size="sm" variant="outline" className="h-7 bg-card text-xs" onClick={() => decide(pendingExam.exam, 'useOlder')}>
                              {c.notes.examUseOlder.replace('{olderDate}', formatEmrDate(pendingExam.olderDate, format.dateStyle))}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => decide(pendingExam.exam, 'skip')}>
                              {c.notes.examSkip}
                            </Button>
                          </span>
                        )}
                        {undoable && (
                          <span className="pl-0">
                            <button type="button" className="text-primary hover:underline" onClick={() => decide(undoable.exam, undefined)}>
                              {c.notes.examUndo}
                            </button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {editorDialog}
    </section>
  )
}
