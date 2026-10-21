"use client"

// 編輯我的格式 — build a paste template piece by piece.
//
// The editor holds a flat list of units — one per character, newline or data
// field — and a caret between them. Typing goes through a visually hidden
// textarea that keeps focus, so the browser's own text input path works:
// plain keys, Chinese IME composition, dictation and paste all arrive as text
// and are inserted at the caret. Every character is kept verbatim.

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, Delete, Search, Trash2, Undo2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLanguage } from '@/src/application/providers/language.provider'
import {
  EMR_EXAM_FIELDS,
  EMR_EXAM_KINDS,
  EMR_LAB_FIELDS,
  EMR_LAB_RECENT_COUNTS,
  EMR_LAB_SERIES_FIELDS,
  type EmrCustomFormat,
  type EmrDateStyle,
  type EmrEmptyLines,
  type EmrExamKind,
  type EmrLabRule,
} from '@/src/application/stores/outpatient-prefs.store'
import { cn } from '@/src/shared/utils/cn.utils'
import { findPinnableLab, searchPinnableLabs } from '@/src/shared/utils/pinned-labs'
import {
  renderEmrCustomFormat,
  starterTokens,
  textToUnits,
  tokensToUnits,
  unitsToTokens,
  type EmrEditUnit,
  type EmrFormatInputs,
  type EmrStarterId,
} from '../utils/emr-custom-format'
import { describeEmrNote } from './emr-format-notes'
import { OutpatientPrefsStorageNote } from '@/features/auth/components/OutpatientPrefsStorageNote'

const QUICK_TEXT: Array<{ label: string; text: string; ariaKey?: 'quickSpace' | 'quickNewline' }> = [
  { label: '/', text: '/' },
  { label: '␣', text: ' ', ariaKey: 'quickSpace' },
  { label: '↵', text: '\n', ariaKey: 'quickNewline' },
  { label: ',', text: ',' },
  { label: ':', text: ':' },
  { label: '(', text: '(' },
  { label: ')', text: ')' },
  { label: '-', text: '-' },
  { label: '、', text: '、' },
  { label: '：', text: '：' },
]

type EditState = {
  units: EmrEditUnit[]
  caret: number
  history: Array<{ units: EmrEditUnit[]; caret: number }>
}

const PILL = 'rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
const PILL_ON = 'border-primary bg-primary/10 font-semibold text-primary'
const PILL_OFF = 'border-border bg-background text-foreground hover:bg-muted'
const FIELD_BUTTON = 'rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'

function lineEnd(units: EmrEditUnit[], from: number): number {
  let i = from
  while (i < units.length && units[i].kind !== 'newline') i += 1
  return i
}

function lineStart(units: EmrEditUnit[], from: number): number {
  let i = from
  while (i > 0 && units[i - 1].kind !== 'newline') i -= 1
  return i
}

export function EmrFormatEditorDialog({
  initial,
  isNew,
  pinnedLabIds,
  previewInputs,
  onSave,
  onDelete,
  onClose,
}: {
  initial: EmrCustomFormat
  isNew: boolean
  pinnedLabIds: string[]
  /** Everything the preview needs for the current patient. */
  previewInputs: EmrFormatInputs
  onSave: (format: EmrCustomFormat) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const e = t.ipsExport.emrHandoff.editor
  const c = t.ipsExport.emrHandoff.custom

  const [name, setName] = useState(initial.name)
  // Units, caret and undo history move together, and every change is applied
  // to the latest state — several input events can land before a re-render.
  const [edit, setEdit] = useState<EditState>(() => {
    const start = tokensToUnits(initial.tokens)
    return { units: start, caret: start.length, history: [] }
  })
  const { units, caret, history } = edit
  const [labRule, setLabRule] = useState<EmrLabRule>(initial.labRule)
  const [missingText, setMissingText] = useState(initial.missingText)
  const [dateStyle, setDateStyle] = useState<EmrDateStyle>(initial.dateStyle)
  const [emptyLines, setEmptyLines] = useState<EmrEmptyLines>(initial.emptyLines)
  const supportedPins = useMemo(() => pinnedLabIds.filter((id) => findPinnableLab(id)), [pinnedLabIds])
  const [labSel, setLabSel] = useState<string>(supportedPins[0] ?? 'lipid:LDL')
  const [labQuery, setLabQuery] = useState('')
  // 最近 N 次 for the next value/date field inserted; 1 = latest only.
  const [labCount, setLabCount] = useState(1)
  const [examSel, setExamSel] = useState<EmrExamKind>('echo')
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  const labLabel = (id: string) => findPinnableLab(id)?.short ?? id
  const examName = (kind: EmrExamKind) => c.examNames[kind]

  const apply = (change: (state: EditState) => { units: EmrEditUnit[]; caret: number } | null) => {
    setEdit((state) => {
      const next = change(state)
      if (!next) return state
      return {
        units: next.units,
        caret: Math.max(0, Math.min(next.units.length, next.caret)),
        history: [...state.history.slice(-99), { units: state.units, caret: state.caret }],
      }
    })
  }
  const setCaret = (move: number | ((state: EditState) => number)) => {
    setEdit((state) => {
      const target = typeof move === 'function' ? move(state) : move
      return { ...state, caret: Math.max(0, Math.min(state.units.length, target)) }
    })
  }
  // After a button edits the format, typing carries on in the format: a
  // reflexive space must type a space, not press the same button again and
  // insert the field twice. Touch screens are left alone so the on-screen
  // keyboard does not cover the dialog after every tap. (From the keyboard
  // the hidden textarea already has focus, so this is a no-op there.)
  const returnToEditor = () => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return
    inputRef.current?.focus({ preventScroll: true })
  }
  const insert = (inserted: EmrEditUnit[]) => {
    if (!inserted.length) return
    apply((state) => {
      const next = [...state.units]
      next.splice(state.caret, 0, ...inserted)
      return { units: next, caret: state.caret + inserted.length }
    })
    returnToEditor()
  }
  const replaceAll = (next: EmrEditUnit[]) => {
    apply(() => ({ units: next, caret: next.length }))
    returnToEditor()
  }
  const deleteBack = () => {
    apply((state) => {
      if (state.caret === 0) return null
      const next = [...state.units]
      next.splice(state.caret - 1, 1)
      return { units: next, caret: state.caret - 1 }
    })
    returnToEditor()
  }
  const moveCaret = (delta: number) => {
    setCaret((state) => state.caret + delta)
    returnToEditor()
  }
  const deleteForward = () => apply((state) => {
    if (state.caret >= state.units.length) return null
    const next = [...state.units]
    next.splice(state.caret, 1)
    return { units: next, caret: state.caret }
  })
  const undo = () => {
    setEdit((state) => {
      const last = state.history[state.history.length - 1]
      if (!last) return state
      return { units: last.units, caret: last.caret, history: state.history.slice(0, -1) }
    })
    returnToEditor()
  }

  // Keys that edit structure are handled here; anything that produces text is
  // left to the textarea and picked up from its input event below.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composingRef.current) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      undo()
      return
    }
    if (mod || event.altKey) return
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); setCaret((state) => state.caret - 1); return
      case 'ArrowRight': event.preventDefault(); setCaret((state) => state.caret + 1); return
      case 'Home': event.preventDefault(); setCaret((state) => lineStart(state.units, state.caret)); return
      case 'End': event.preventDefault(); setCaret((state) => lineEnd(state.units, state.caret)); return
      case 'Backspace': event.preventDefault(); deleteBack(); return
      case 'Delete': event.preventDefault(); deleteForward(); return
      case 'Enter': event.preventDefault(); insert([{ kind: 'newline' }]); return
      default:
    }
  }
  const takeInput = (field: HTMLTextAreaElement) => {
    const text = field.value
    field.value = ''
    if (text) insert(textToUnits(text))
  }

  // One click handler for the whole surface: a unit puts the caret after it;
  // the empty end of a line puts it at that line's end. Focus returns to the
  // hidden textarea so typing continues from there.
  const onEditorClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-unit],[data-line-end]')
    if (!target) setCaret((state) => state.units.length)
    else if (target.dataset.unit !== undefined) setCaret(Number(target.dataset.unit) + 1)
    else if (target.dataset.lineEnd !== undefined) setCaret(Number(target.dataset.lineEnd))
    inputRef.current?.focus()
  }

  const lines = useMemo(() => {
    const out: Array<{ start: number; end: number }> = []
    let start = 0
    units.forEach((unit, index) => {
      if (unit.kind === 'newline') {
        out.push({ start, end: index })
        start = index + 1
      }
    })
    out.push({ start, end: units.length })
    return out
  }, [units])

  const draftFormat: EmrCustomFormat = useMemo(() => ({
    id: initial.id,
    name: name.trim(),
    tokens: unitsToTokens(units),
    labRule,
    missingText,
    dateStyle,
    emptyLines,
  }), [initial.id, name, units, labRule, missingText, dateStyle, emptyLines])
  const preview = useMemo(() => renderEmrCustomFormat(draftFormat, previewInputs), [draftFormat, previewInputs])

  // What a screen reader hears for the (visual-only) content above the
  // hidden input: text as typed, fields as "LDL 的數值".
  // A field chip's second half: "數值", or "數值 最近3次" for a series.
  const fieldLabel = (unit: Extract<EmrEditUnit, { kind: 'lab' | 'exam' }>) => {
    if (unit.kind === 'exam') return e.examFields[unit.field]
    const base = e.labFields[unit.field]
    return unit.count ? `${base} ${e.chipCount.replace('{n}', String(unit.count))}` : base
  }

  const srSummary = units.map((unit) => {
    if (unit.kind === 'char') return unit.ch
    if (unit.kind === 'newline') return '\n'
    const what = unit.kind === 'lab' ? labLabel(unit.lab) : examName(unit.exam)
    const field = fieldLabel(unit)
    return `[${e.chipAria.replace('{what}', what).replace('{field}', field)}]`
  }).join('')

  const labResults = labQuery.trim() ? searchPinnableLabs(labQuery).slice(0, 12) : []
  const labChoices = labQuery.trim() ? labResults.map((entry) => entry.id) : supportedPins

  const caretBar = <span aria-hidden="true" className={cn('mx-px inline-block h-4 w-0.5 align-middle', focused ? 'animate-pulse bg-primary' : 'bg-primary/40')} />

  // Examples insert at the caret rather than replacing, so a clinician can
  // stack 「自訂檢驗」 and 「Echo／EKG」 into one format. 清空 replaces.
  // An example is a block of whole lines: it starts on a line of its own and
  // does not glue onto what follows. (Text the clinician types is never
  // touched this way.)
  const insertStarter = (starter: EmrStarterId) => {
    const block = tokensToUnits(starterTokens(starter, supportedPins))
    if (!block.length) return
    apply((state) => {
      const before = state.units[state.caret - 1]
      const after = state.units[state.caret]
      const lead: EmrEditUnit[] = before && before.kind !== 'newline' ? [{ kind: 'newline' }] : []
      const tail: EmrEditUnit[] = after && after.kind !== 'newline' ? [{ kind: 'newline' }] : []
      const inserted = [...lead, ...block, ...tail]
      const next = [...state.units]
      next.splice(state.caret, 0, ...inserted)
      return { units: next, caret: state.caret + lead.length + block.length }
    })
    returnToEditor()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-3 overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="text-base">{e.title}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{e.intro}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
          <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <label className="flex max-w-xs flex-col gap-1">
              <span className="text-[0.6875rem] font-semibold">{e.nameLabel}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={e.namePlaceholder}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-[0.6875rem] font-semibold">{e.editorLabel}</span>
              <div
                onClick={onEditorClick}
                className={cn(
                  'relative min-h-40 cursor-text rounded-md border border-input bg-background py-2 pr-2 font-mono text-sm leading-7',
                  focused && 'ring-2 ring-primary/50',
                )}
              >
                <textarea
                  ref={inputRef}
                  aria-label={e.editorLabel}
                  aria-describedby="emr-format-editor-content"
                  autoComplete="off"
                  spellCheck={false}
                  rows={1}
                  onKeyDown={onKeyDown}
                  onChange={(event) => {
                    if (!composingRef.current) takeInput(event.currentTarget)
                  }}
                  onCompositionStart={() => { composingRef.current = true }}
                  onCompositionEnd={(event) => {
                    composingRef.current = false
                    takeInput(event.currentTarget)
                  }}
                  onPaste={(event) => {
                    event.preventDefault()
                    insert(textToUnits(event.clipboardData.getData('text/plain')))
                  }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  className="absolute left-2 top-2 h-5 w-5 resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
                />
                <span id="emr-format-editor-content" className="sr-only">{srSummary}</span>
                {units.length === 0 && !focused && (
                  <p className="px-3 font-sans text-xs text-muted-foreground">{e.emptyEditor}</p>
                )}
                {lines.map((line, lineIndex) => (
                  <div key={line.start} className="flex items-start">
                    <span aria-hidden="true" className="w-8 shrink-0 select-none pr-2 text-right font-sans text-[0.6875rem] leading-7 text-muted-foreground/70 tabular-nums">
                      {lineIndex + 1}
                    </span>
                    <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center">
                      {caret === line.start && caretBar}
                      {units.slice(line.start, line.end + (line.end < units.length ? 1 : 0)).map((unit, offset) => {
                        const index = line.start + offset
                        const after = caret === index + 1 && unit.kind !== 'newline' ? caretBar : null
                        if (unit.kind === 'newline') {
                          return (
                            <span key={index} data-unit={index} className="px-0.5 text-muted-foreground/70">↵</span>
                          )
                        }
                        if (unit.kind === 'char') {
                          return (
                            <span key={index} className="inline-flex items-center">
                              <span data-unit={index} className={cn('whitespace-pre', unit.ch === ' ' && 'text-muted-foreground/60')}>
                                {unit.ch === ' ' ? '␣' : unit.ch}
                              </span>
                              {after}
                            </span>
                          )
                        }
                        const what = unit.kind === 'lab' ? labLabel(unit.lab) : examName(unit.exam)
                        const field = fieldLabel(unit)
                        const unsupported = unit.kind === 'lab' && !findPinnableLab(unit.lab)
                        return (
                          <span key={index} className="inline-flex items-center">
                            <span
                              data-unit={index}
                              aria-label={e.chipAria.replace('{what}', what).replace('{field}', field)}
                              className={cn(
                                'mx-px inline-flex items-center gap-1 rounded border px-1.5 font-sans text-xs font-semibold leading-5',
                                unsupported
                                  ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
                                  : 'border-primary/40 bg-primary/10 text-primary',
                              )}
                            >
                              {what}<span className="font-normal opacity-80">· {field}</span>
                            </span>
                            {after}
                          </span>
                        )
                      })}
                      <span data-line-end={line.end} className="min-w-4 flex-1 self-stretch" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-7 px-2" aria-label={e.caretLeft} onClick={() => moveCaret(-1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2" aria-label={e.caretRight} onClick={() => moveCaret(1)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={caret === 0} onClick={deleteBack}>
                  <Delete className="h-3.5 w-3.5" />{e.deleteBack}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!history.length} onClick={undo}>
                  <Undo2 className="h-3.5 w-3.5" />{e.undo}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!units.length} onClick={() => replaceAll([])}>
                  {e.clear}
                </Button>
              </div>
            </div>

            <section className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-xs font-semibold">{e.insertLab}</h3>
                <span className="text-[0.6875rem] text-muted-foreground">{e.insertLabHint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-primary/50">
                  <Search aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="search"
                    value={labQuery}
                    onChange={(event) => setLabQuery(event.target.value)}
                    placeholder={e.labSearchPlaceholder}
                    aria-label={e.labSearchPlaceholder}
                    className="w-36 bg-transparent text-xs outline-none"
                  />
                </span>
                {!labQuery.trim() && supportedPins.length === 0 && (
                  <span className="text-[0.6875rem] text-muted-foreground">{e.noPinned}</span>
                )}
                {labChoices.map((id) => (
                  <button key={id} type="button" aria-pressed={labSel === id} onClick={() => setLabSel(id)} className={cn(PILL, labSel === id ? PILL_ON : PILL_OFF)}>
                    {labLabel(id)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-16 text-xs font-semibold">{labLabel(labSel)}</span>
                {EMR_LAB_FIELDS.map((field) => {
                  const count = labCount > 1 && EMR_LAB_SERIES_FIELDS.includes(field) ? labCount : undefined
                  return (
                    <button key={field} type="button" className={FIELD_BUTTON} onClick={() => insert([{ kind: 'lab', lab: labSel, field, ...(count ? { count } : {}) }])}>
                      ＋ {e.labFields[field]}{count ? `（${e.chipCount.replace('{n}', String(count))}）` : ''}
                    </button>
                  )
                })}
              </div>
              <label className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                {e.countLabel}
                <select
                  value={labCount}
                  onChange={(event) => setLabCount(Number(event.target.value))}
                  className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <option value={1}>{e.countLatest}</option>
                  {EMR_LAB_RECENT_COUNTS.map((n) => (
                    <option key={n} value={n}>{e.countRecent.replace('{n}', String(n))}</option>
                  ))}
                </select>
              </label>
            </section>

            <section className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-xs font-semibold">{e.insertExam}</h3>
                <span className="text-[0.6875rem] text-muted-foreground">{e.insertExamHint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {EMR_EXAM_KINDS.map((kind) => (
                  <button key={kind} type="button" aria-pressed={examSel === kind} onClick={() => setExamSel(kind)} className={cn(PILL, examSel === kind ? PILL_ON : PILL_OFF)}>
                    {examName(kind)}
                  </button>
                ))}
                <span className="w-2" />
                {EMR_EXAM_FIELDS.map((field) => (
                  <button key={field} type="button" className={FIELD_BUTTON} onClick={() => insert([{ kind: 'exam', exam: examSel, field }])}>
                    ＋ {e.examFields[field]}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2 rounded-md border border-border p-3">
              <h3 className="text-xs font-semibold">{e.insertText}</h3>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TEXT.map((quick) => (
                  <button
                    key={quick.label}
                    type="button"
                    aria-label={quick.ariaKey ? e[quick.ariaKey] : undefined}
                    onClick={() => insert(textToUnits(quick.text))}
                    className="min-w-8 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    {quick.label}
                  </button>
                ))}
              </div>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!draft) return
                  insert(textToUnits(draft))
                  setDraft('')
                }}
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="shrink-0 text-xs">{e.freeTextLabel}</span>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={e.freeTextPlaceholder}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  />
                </label>
                <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!draft}>{e.insert}</Button>
              </form>
              <p className="text-[0.6875rem] text-muted-foreground">{e.verbatimNote}</p>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-3 border-t border-border pt-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold">{e.previewTitle}</h3>
                <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{c.chars.replace('{chars}', String(preview.text.length))}</span>
              </div>
              <pre className="max-h-64 min-h-16 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">
                {preview.text || ' '}
              </pre>
              {preview.notes.length > 0 && (
                <ul className="space-y-1">
                  {preview.notes.map((note, index) => (
                    <li key={index} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[0.6875rem] leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      {describeEmrNote(note, c, labLabel, dateStyle, missingText)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <section className="space-y-2.5 border-t border-border pt-3">
              <h3 className="text-xs font-semibold">{e.rulesTitle}</h3>
              <div className="space-y-1">
                <span className="text-[0.6875rem] font-semibold">{e.labRuleLabel}</span>
                <div role="group" aria-label={e.labRuleLabel} className="flex gap-1.5">
                  {(['sameDay', 'eachLatest'] as EmrLabRule[]).map((rule) => (
                    <button key={rule} type="button" aria-pressed={labRule === rule} onClick={() => setLabRule(rule)} className={cn(PILL, labRule === rule ? PILL_ON : PILL_OFF)}>
                      {rule === 'sameDay' ? e.ruleSameDay : e.ruleEachLatest}
                    </button>
                  ))}
                </div>
                <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                  {labRule === 'sameDay' ? e.ruleSameDayHint : e.ruleEachLatestHint}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[0.6875rem] font-semibold">{e.emptyLinesLabel}</span>
                <div role="group" aria-label={e.emptyLinesLabel} className="flex flex-wrap gap-1.5">
                  {([['omit', e.emptyLinesOmit], ['show', e.emptyLinesShow]] as Array<[EmrEmptyLines, string]>).map(([mode, label]) => (
                    <button key={mode} type="button" aria-pressed={emptyLines === mode} onClick={() => setEmptyLines(mode)} className={cn(PILL, emptyLines === mode ? PILL_ON : PILL_OFF)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[0.6875rem] font-semibold">{e.missingLabel}</span>
                <input
                  value={missingText}
                  maxLength={40}
                  onChange={(event) => setMissingText(event.target.value)}
                  className="h-8 w-32 rounded-md border border-input bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                />
              </label>
              <div className="space-y-1">
                <span className="text-[0.6875rem] font-semibold">{e.dateStyleLabel}</span>
                <div role="group" aria-label={e.dateStyleLabel} className="flex flex-wrap gap-1.5">
                  {([['md', e.dateMd], ['ymd', e.dateYmd], ['roc', e.dateRoc]] as Array<[EmrDateStyle, string]>).map(([style, label]) => (
                    <button key={style} type="button" aria-pressed={dateStyle === style} onClick={() => setDateStyle(style)} className={cn(PILL, dateStyle === style ? PILL_ON : PILL_OFF)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-1.5 border-t border-border pt-3">
              <h3 className="text-[0.6875rem] font-semibold">{e.startersTitle}</h3>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['lipid', c.starterLipid],
                  ['pinnedPerLine', c.starterPinned],
                  ['exams', c.starterExams],
                ] as Array<[EmrStarterId, string]>).map(([starter, label]) => (
                  <button key={starter} type="button" onClick={() => insertStarter(starter)} className={cn(PILL, PILL_OFF)}>
                    {label}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 border-t border-border pt-3">
          {!isNew && onDelete && (
            <Button type="button" variant="ghost" className="mr-auto gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />{e.deleteFormat}
            </Button>
          )}
          <OutpatientPrefsStorageNote className="min-w-0 basis-full sm:basis-0 sm:flex-1" />
          <Button type="button" variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button type="button" onClick={() => onSave({ ...draftFormat, name: draftFormat.name || initial.name })}>{t.common.save}</Button>
        </DialogFooter>
        {/* A format is the clinician's own work and there is no undo once it
            is gone, so deleting asks first. */}
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{e.deleteConfirmTitle.replace('{name}', name || initial.name || c.formatLabel)}</AlertDialogTitle>
              <AlertDialogDescription>{e.deleteConfirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => onDelete?.()}
              >
                {e.deleteConfirmAction}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
