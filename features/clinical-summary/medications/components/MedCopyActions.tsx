"use client"

// 複製現在用藥's 複製｜編輯, shared by the 總覽 用藥 card and the 用藥 tab's 使用中
// list. 複製 copies with the clinician's format (緊湊 until they save their
// own), 編輯 opens that one format's editor in place. After a copy a toast
// says what went in and what was left out, so a one-click paste is never a
// blind one — and, like every other copy toast in the app, it goes away by
// itself (by decision, 2026-10-05: a notice the clinician must close is one
// more thing to do).

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, ClipboardCopy, Pencil } from 'lucide-react'
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
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import { trackEvent } from '@/src/application/telemetry/usage-analytics'
import type { MedCopyFormat } from '@/src/application/stores/outpatient-prefs.store'
import { useMedicationCopy, type MedicationCopyApi } from '../hooks/useMedicationCopy'
import { useMedCopyFormatEditor } from '../hooks/useMedCopyFormatEditor'
import {
  medCopyFormatCountsDays,
  type MedCopyEntry,
  type MedCopySourceItem,
} from '../utils/medication-copy-text'
import { MedCopyFallbackDialog } from './MedCopyFallbackDialog'

/** Where the copy was made, for usage analytics. */
export type MedCopySurface = 'overview_meds' | 'meds_tab'

/** Long enough to read two lines and reach a button; hovering pauses it. */
const TOAST_MS = 6000

interface CopyReceipt {
  /** The list this copy was made from: a receipt for another list (another
   *  patient, a reload) is never shown. */
  sources: readonly unknown[]
  text: string
  currentCount: number
  listedCount: number
}

export interface MedCopyActionsState {
  api: MedicationCopyApi
  copied: boolean
  receipt: CopyReceipt | null
  fallbackText: string | null
  /** 看複製內容 is open. */
  textOpen: boolean
  copyWith: (format: MedCopyFormat) => Promise<void>
  setTextOpen: (open: boolean) => void
  closeFallback: () => void
}

/** Up to three names, then an ellipsis: a toast is two lines, not a list. */
function joinNames(entries: readonly MedCopyEntry[], locale: string): string {
  const names = entries.slice(0, 3).map((entry) => entry.item.title).join(locale === 'zh-TW' ? '、' : ', ')
  return entries.length > 3 ? `${names}…` : names
}

/** `sources` must be memoised: a new array is a new list, and drops the receipt. */
export function useMedCopyActions(
  sources: readonly MedCopySourceItem[],
  surface: MedCopySurface,
): MedCopyActionsState {
  const { t, locale } = useLanguage()
  const strings = t.medCopy
  const api = useMedicationCopy(sources)
  const { copied, copy } = useCopyToClipboard(1500)
  const [stored, setReceipt] = useState<CopyReceipt | null>(null)
  const [fallback, setFallback] = useState<{ sources: readonly unknown[]; text: string } | null>(null)
  const [textOpen, setTextOpen] = useState(false)
  // Both are tied to the list they were made from: text from another
  // patient's list (or a list since reloaded) is never offered.
  const receipt = stored && stored.sources === sources ? stored : null
  const fallbackText = fallback && fallback.sources === sources ? fallback.text : null
  // The list on screen now, or null once this surface is gone. The clipboard
  // answers asynchronously and a toast outlives its surface: a copy that
  // comes back after the list changed or the surface unmounted reports
  // nothing, and a toast button from then copies nothing.
  const sourcesNow = useRef<readonly MedCopySourceItem[] | null>(sources)
  useEffect(() => {
    sourcesNow.current = sources
    return () => { sourcesNow.current = null }
  }, [sources])
  // One toast per surface: a second copy replaces the first.
  const toastId = `med-copy:${surface}`

  // A toast about another patient's list (or a list since reloaded) must not
  // linger, nor can its buttons act on the list now loaded.
  useEffect(() => () => { toast.dismiss(toastId) }, [sources, toastId])

  const copyWith = useCallback(async function copyWithFormat(format: MedCopyFormat): Promise<void> {
    const result = api.build(format)
    const ok = await copy(result.text)
    if (sourcesNow.current !== sources) return
    if (!ok) {
      setReceipt(null)
      toast.dismiss(toastId)
      setFallback({ sources, text: result.text })
      return
    }
    // Usage analytics: which surface's copy was used. Never the text.
    trackEvent('handoff_copy', { mode: surface })
    setReceipt({
      sources,
      text: result.text,
      currentCount: result.currentCount,
      listedCount: result.listedExcludedCount,
    })

    const { excluded, endedLongTerm } = api.selection
    const listed = result.listedExcludedCount > 0
    const title = result.currentCount === 0 && !listed
      ? strings.receiptNone
      : listed
        ? strings.receiptCopiedWithEnded
          .replace('{count}', String(result.currentCount + result.listedExcludedCount))
          .replace('{current}', String(result.currentCount))
          .replace('{ended}', String(result.listedExcludedCount))
        : strings.receiptCopied.replace('{count}', String(result.currentCount))
    const notes = [
      // Once listed last they are in the paste, so not "left out".
      excluded.length > 0 && !listed
        ? strings.receiptExcluded
          .replace('{count}', String(excluded.length))
          .replace('{names}', joinNames(excluded, locale))
        : null,
      endedLongTerm.length > 0
        ? (medCopyFormatCountsDays(format) ? strings.receiptEndedLongTerm : strings.receiptEndedLongTermUnmarked)
          .replace('{count}', String(endedLongTerm.length))
        : null,
    ].filter((note): note is string => note !== null)

    toast.success(title, {
      id: toastId,
      duration: TOAST_MS,
      description: notes.length > 0
        ? <div className="space-y-0.5">{notes.map((note) => <p key={note}>{note}</p>)}</div>
        : undefined,
      action: { label: strings.receiptShowText, onClick: () => setTextOpen(true) },
      // The short courses left out, one click from going in (listed last) —
      // and back out again.
      cancel: excluded.length > 0
        ? {
          label: listed ? strings.receiptExcludeEnded : strings.receiptIncludeEnded,
          onClick: () => {
            if (sourcesNow.current !== sources) return
            void copyWithFormat({ ...format, endedAcute: listed ? 'omit' : 'list' })
          },
        }
        : undefined,
    })
  }, [api, copy, locale, sources, strings, surface, toastId])

  return {
    api,
    copied,
    receipt,
    fallbackText,
    textOpen: textOpen && receipt !== null,
    copyWith,
    setTextOpen,
    closeFallback: () => setFallback(null),
  }
}

export function MedCopyButtons({ state }: { state: MedCopyActionsState }) {
  const { t } = useLanguage()
  const strings = t.medCopy
  const { api, copied, receipt, copyWith } = state
  const { openEditor, editorDialog } = useMedCopyFormatEditor(api)

  const segment = 'inline-flex items-center gap-1 px-2 text-xs font-medium hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 max-md:text-sm'

  return (
    // Taller on a phone, where it is tapped rather than clicked.
    <div className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-primary/50 text-primary max-md:h-11">
      <button
        type="button"
        onClick={() => void copyWith(api.format)}
        className={`${segment} max-md:px-4`}
      >
        {copied
          ? <Check aria-hidden="true" className="h-3 w-3" />
          : <ClipboardCopy aria-hidden="true" className="h-3 w-3" />}
        {copied && receipt
          ? strings.copiedButton.replace('{count}', String(receipt.currentCount + receipt.listedCount))
          : strings.copyButton}
      </button>
      <button
        type="button"
        aria-label={strings.editButtonLabel}
        onClick={openEditor}
        className={`${segment} border-l border-primary/50 max-md:px-4`}
      >
        <Pencil aria-hidden="true" className="h-3 w-3" />
        {strings.editButton}
      </button>
      {editorDialog}
    </div>
  )
}

/** The dialogs a copy can open: the text it wrote (from the toast's 看複製內容)
 *  and, when the browser refused the clipboard, the text to copy by hand.
 *  Render once per surface, where it stays mounted while the list does. */
export function MedCopyDialogs({ state }: { state: MedCopyActionsState }) {
  const { t } = useLanguage()
  const strings = t.medCopy
  const { fallbackText, closeFallback, receipt, textOpen, setTextOpen } = state
  return (
    <>
      <MedCopyFallbackDialog text={fallbackText} onClose={closeFallback} />
      {/* The whole text at once: a toast or a bounded card could only ever
          hold a small box to scroll. */}
      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{strings.receiptTextTitle}</DialogTitle>
            <DialogDescription className="text-xs">{strings.receiptTextHint}</DialogDescription>
          </DialogHeader>
          <div
            data-testid="med-copy-receipt-text"
            className="whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 text-[0.8125rem] leading-relaxed"
          >
            {receipt?.text}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTextOpen(false)}>{strings.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
