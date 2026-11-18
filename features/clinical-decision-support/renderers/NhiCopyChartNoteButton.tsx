"use client"

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/src/shared/hooks/use-copy-to-clipboard'
import type { CdssCoverageSummary } from '../types'

/**
 * One-click copy of the 表一 verdict and its basis for pasting into the chart.
 *
 * The text is `documentationNote` from the rules package, which leaves out AI
 * answers no clinician has reviewed and recomputes the tier without them. When
 * such answers exist the panel's tier can differ from the copied one, so the
 * button says how many were left out.
 */
export function NhiCopyChartNoteButton({ summary, locale }: { summary: CdssCoverageSummary; locale: string }) {
  const en = locale === 'en'
  const { copied, copy } = useCopyToClipboard()
  const [failed, setFailed] = useState(false)
  const note = summary.documentationNote
  if (!note) return null
  const pendingAi = new Set(
    [...summary.factors, ...summary.metabolicChecks, ...summary.diseaseChecks]
      .filter((row) => row.origin === 'ai')
      .map((row) => row.id ?? row.label),
  ).size
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        data-testid="nhi-table1-copy-chart-note"
        onClick={async () => setFailed(!(await copy(note)))}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? (en ? 'Copied' : '已複製') : (en ? 'Copy to chart' : '複製到病歷')}
      </Button>
      {pendingAi > 0 ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {en
            ? `${pendingAi} unreviewed AI prefill item(s) are left out of the copy`
            : `AI 預填 ${pendingAi} 項未經醫師覆核，不放入複製內容`}
        </p>
      ) : null}
      {failed ? (
        <div className="w-full max-w-md space-y-1">
          <p role="alert" className="text-[11px] text-destructive">
            {en ? 'Copy failed. Select the text below and copy it manually.' : '複製失敗，請選取下方文字手動複製。'}
          </p>
          <textarea
            readOnly
            aria-label={en ? 'Chart note' : '病歷文字'}
            value={note}
            rows={8}
            className="w-full rounded-md border border-border bg-background p-2 text-xs leading-relaxed"
          />
        </div>
      ) : null}
    </div>
  )
}
