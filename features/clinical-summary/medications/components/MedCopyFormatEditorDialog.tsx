"use client"

// 編輯用藥格式 — every part of a 複製現在用藥 line is the clinician's choice:
// which fields, how each is written, in what order, and how the list is
// grouped. The preview on the right is this patient's copy, rebuilt on every
// change, so there is nothing to imagine.

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import { cn } from '@/src/shared/utils/cn.utils'
import {
  MED_COPY_BUILTIN_IDS,
  MED_COPY_FIELD_STYLES,
  type MedCopyFieldId,
  type MedCopyFormat,
} from '@/src/application/stores/outpatient-prefs.store'
import {
  BUILTIN_MED_COPY_FORMATS,
  type MedCopyText,
} from '@/features/clinical-summary/medications/utils/medication-copy-text'

const GROUP_KEY_FIELD: Partial<Record<MedCopyFormat['group'], MedCopyFieldId>> = {
  institution: 'institution',
  date: 'date',
  category: 'category',
}

/** The shape a format has apart from who it is — what 「已自訂」 compares. */
function layoutOf(format: MedCopyFormat): string {
  const { id: _id, name: _name, ...layout } = format
  return JSON.stringify(layout)
}

function OptionButtons<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1', disabled && 'opacity-40')}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'inline-flex h-7 items-center whitespace-nowrap rounded-md border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 max-md:h-9',
            value === option.id
              ? 'border-primary bg-primary/10 font-semibold text-primary'
              : 'border-border bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function MedCopyFormatEditorDialog({
  open,
  onOpenChange,
  initial,
  build,
  onSave,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: MedCopyFormat
  build: (format: MedCopyFormat) => MedCopyText
  onSave: (format: MedCopyFormat) => void
  /** Offered once the clinician has a format of their own: back to 緊湊. */
  onReset?: () => void
}) {
  const { t } = useLanguage()
  const strings = t.medCopy
  const e = strings.editor
  const [draft, setDraft] = useState<MedCopyFormat>(initial)
  const [confirmReset, setConfirmReset] = useState(false)

  const preview = useMemo(() => build(draft), [build, draft])
  const matchedBuiltin = MED_COPY_BUILTIN_IDS.find((id) => layoutOf(BUILTIN_MED_COPY_FORMATS[id]) === layoutOf(draft))
  const keyField = GROUP_KEY_FIELD[draft.group]

  const update = (patch: Partial<MedCopyFormat>) => setDraft((current) => ({ ...current, ...patch }))

  const setField = (id: MedCopyFieldId, patch: { on?: boolean; style?: string }) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => (
        field.id === id ? { ...field, ...patch, on: id === 'name' ? true : patch.on ?? field.on } : field
      )),
    }))
  }

  const move = (index: number, delta: -1 | 1) => {
    setDraft((current) => {
      const next = [...current.fields]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, fields: next }
    })
  }

  const styleLabels = e.styles as Record<MedCopyFieldId, Record<string, string>>
  const fieldNotes = e.fieldNotes as Partial<Record<MedCopyFieldId, string>>
  const styleHints = e.styleHints as Partial<Record<MedCopyFieldId, Record<string, string>>>

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-3 overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="text-base">{e.heading}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{e.intro}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
          <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold">{e.startFrom}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <OptionButtons
                    label={e.startFrom}
                    value={matchedBuiltin ?? ('' as string)}
                    options={MED_COPY_BUILTIN_IDS.map((id) => ({
                      id: id as string,
                      label: strings.builtin[id.slice('builtin:'.length) as 'compact' | 'standard' | 'full'],
                    }))}
                    onChange={(id) => {
                      const from = BUILTIN_MED_COPY_FORMATS[id as typeof MED_COPY_BUILTIN_IDS[number]]
                      setDraft((current) => ({ ...from, id: current.id, name: current.name, fields: from.fields.map((f) => ({ ...f })) }))
                    }}
                  />
                  {!matchedBuiltin && <span className="text-xs text-muted-foreground">{e.customised}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-baseline justify-between border-b pb-1.5">
              <span className="text-sm font-semibold">{e.fieldsTitle}</span>
              <span className="text-xs text-muted-foreground">{e.fieldsHint}</span>
            </div>
            <div className="flex flex-col">
              <div className="flex min-h-10 items-center gap-2 border-b border-border/60 py-1">
                <span className="w-[3.25rem] shrink-0" aria-hidden="true" />
                <span className="w-24 shrink-0 text-xs font-semibold">{e.numberingLabel}</span>
                <OptionButtons
                  label={e.numberingLabel}
                  value={draft.numbering}
                  options={(['dot', 'paren', 'dash', 'none'] as const).map((id) => ({ id, label: e.numbering[id] }))}
                  onChange={(numbering) => update({ numbering })}
                />
              </div>
              {draft.fields.map((field, index) => {
                const label = e.fields[field.id]
                const styles = MED_COPY_FIELD_STYLES[field.id]
                const inHeader = field.id === keyField
                const note = inHeader ? e.inGroupHeader : fieldNotes[field.id]
                return (
                  <div key={field.id} className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border/60 py-1">
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        aria-label={e.moveUp.replace('{field}', label)}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 max-md:h-9 max-md:w-9"
                      >
                        <ArrowUp aria-hidden="true" className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={e.moveDown.replace('{field}', label)}
                        disabled={index === draft.fields.length - 1}
                        onClick={() => move(index, 1)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 max-md:h-9 max-md:w-9"
                      >
                        <ArrowDown aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </div>
                    <label className="flex w-24 shrink-0 items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={field.on}
                        disabled={field.id === 'name'}
                        onChange={(event) => setField(field.id, { on: event.target.checked })}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="text-xs font-semibold">{label}</span>
                    </label>
                    {styles.length > 1 && (
                      <OptionButtons
                        label={label}
                        value={field.style}
                        disabled={!field.on}
                        options={styles.map((style) => ({ id: style, label: styleLabels[field.id][style] ?? style }))}
                        // Choosing how a field is written means wanting it.
                        onChange={(style) => setField(field.id, { style, on: true })}
                      />
                    )}
                    {note && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{note}</span>}
                    {field.on && styleHints[field.id]?.[field.style] && (
                      // Under the options, lined up with them: what this style
                      // writes in both cases, whatever this patient's list shows.
                      <p className="basis-full pb-0.5 pl-[calc(3rem+6rem+1rem)] text-xs text-muted-foreground max-md:pl-0">
                        {styleHints[field.id]?.[field.style]}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{e.endedNote}</p>
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <span className="text-sm font-semibold">{e.groupTitle}</span>
              <OptionButtons
                label={e.groupTitle}
                value={draft.group}
                options={(['none', 'institution', 'date', 'category'] as const).map((id) => ({ id, label: e.group[id] }))}
                onChange={(group) => update({ group })}
              />
              {draft.group !== 'none' && (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{e.headerLabel}</span>
                    <OptionButtons
                      label={e.headerLabel}
                      value={draft.groupHeader}
                      options={(['bracket', 'colon', 'hash'] as const).map((id) => ({ id, label: e.header[id] }))}
                      onChange={(groupHeader) => update({ groupHeader })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.hoistShared}
                      onChange={(event) => update({ hoistShared: event.target.checked })}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    {e.hoistLabel}
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-xs">
              <span className="text-muted-foreground">{e.titleLabel}</span>
              <div className="flex flex-wrap items-center gap-2">
                <OptionButtons
                  label={e.titleLabel}
                  value={draft.title}
                  options={(['full', 'short', 'none'] as const).map((id) => ({ id, label: e.title[id] }))}
                  onChange={(title) => update({ title })}
                />
                {draft.title !== 'none' && (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={draft.titleMeta}
                      onChange={(event) => update({ titleMeta: event.target.checked })}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    {e.titleMetaLabel}
                  </label>
                )}
              </div>
              <span className="text-muted-foreground">{e.separatorLabel}</span>
              <OptionButtons
                label={e.separatorLabel}
                value={draft.separator}
                options={(['space', 'dot', 'comma', 'bar'] as const).map((id) => ({ id, label: e.separator[id] }))}
                onChange={(separator) => update({ separator })}
              />
              <span className="text-muted-foreground">{e.endedLabel}</span>
              <OptionButtons
                label={e.endedLabel}
                value={draft.endedAcute}
                options={(['omit', 'list'] as const).map((id) => ({ id, label: e.ended[id] }))}
                onChange={(endedAcute) => update({ endedAcute })}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{e.previewTitle}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {e.chars
                    .replace('{chars}', String(preview.text.replace(/\n/g, '').length))
                    .replace('{lines}', String(preview.lineCount))}
                </span>
              </div>
              <div
                aria-live="polite"
                data-testid="med-copy-editor-preview"
                className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 text-[0.8125rem] leading-relaxed"
              >
                {preview.text}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between">
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => (confirmReset ? onReset() : setConfirmReset(true))}
            >
              {confirmReset ? e.resetConfirm : e.reset}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{e.cancel}</Button>
            <Button
              type="button"
              onClick={() => onSave(draft)}
            >
              {e.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
