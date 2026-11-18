"use client"

import { type ReactNode, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import type { CdssCoverageSummary } from '../types'

/**
 * One-click copy of the 表一 verdict and its basis for pasting into the chart.
 *
 * The text is `documentationNote` from the rules package, which leaves out AI
 * answers no clinician has reviewed and recomputes the tier without them. The
 * button sits in the panel header; once it copies, the copied text opens
 * below the conclusion so the clinician sees exactly what went to the
 * clipboard. Returns the two pieces so the panel can place each one.
 */
export function useNhiChartNoteCopy(summary: CdssCoverageSummary, locale: string): { button: ReactNode; copiedNote: ReactNode } {
  const en = locale === 'en'
  const { copied, copy } = useCopyToClipboard()
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)
  const note = summary.documentationNote
  if (!note) return { button: null, copiedNote: null }
  const pendingAi = new Set(
    [...summary.factors, ...summary.metabolicChecks, ...summary.diseaseChecks]
      .filter((row) => row.origin === 'ai')
      .map((row) => row.id ?? row.label),
  ).size

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      data-testid="nhi-table1-copy-chart-note"
      onClick={async () => setResult((await copy(note)) ? 'copied' : 'failed')}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? (en ? 'Copied' : '已複製') : (en ? 'Copy to chart' : '複製到病歷')}
    </Button>
  )

  const copiedNote = result ? (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2" data-testid="nhi-table1-copied-note">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        {result === 'copied' ? (
          <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {en ? 'Copied the text below. Paste it into the chart.' : '已複製以下內容，可直接貼到病歷'}
          </p>
        ) : (
          <p role="alert" className="text-xs text-destructive">
            {en ? 'Copy failed. Select the text below and copy it manually.' : '複製失敗，請選取下方文字手動複製。'}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={() => setResult(null)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {en ? 'Close' : '收合'}
        </Button>
      </div>
      {pendingAi > 0 ? (
        <p className="mb-1.5 text-xs text-amber-700 dark:text-amber-400">
          {en
            ? `${pendingAi} AI prefill item(s) not yet reviewed by a clinician are left out.`
            : `AI 預填 ${pendingAi} 項尚未經醫師覆核，未放入；覆核後再複製即會納入。`}
        </p>
      ) : null}
      {result === 'copied' ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed" aria-label={en ? 'Copied text' : '已複製的內容'}>{note}</pre>
      ) : (
        <textarea
          readOnly
          aria-label={en ? 'Chart note' : '病歷文字'}
          value={note}
          rows={8}
          className="w-full rounded-md border border-border bg-background p-2 text-xs leading-relaxed"
        />
      )}
    </div>
  ) : null

  return { button, copiedNote }
}
