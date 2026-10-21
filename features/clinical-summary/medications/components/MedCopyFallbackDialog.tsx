"use client"

// When the browser refuses the clipboard, a bare 「複製失敗」 leaves the
// clinician to retype the list. Instead the text opens already selected, one
// keystroke from the clipboard.

import { useEffect, useRef } from 'react'
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

export function MedCopyFallbackDialog({
  text,
  onClose,
}: {
  /** The text that could not be copied; `null` keeps the dialog closed. */
  text: string | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  const strings = t.medCopy
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (text === null) return
    // After the dialog's own focus handling has run.
    const frame = window.requestAnimationFrame(() => {
      areaRef.current?.focus()
      areaRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [text])

  return (
    <Dialog open={text !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{strings.failTitle}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{strings.failBody}</DialogDescription>
        </DialogHeader>
        <textarea
          ref={areaRef}
          readOnly
          aria-label={strings.failTextLabel}
          value={text ?? ''}
          onFocus={(event) => event.currentTarget.select()}
          className="h-60 w-full resize-none rounded-md border border-input bg-background p-2.5 text-[0.8125rem] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{strings.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
