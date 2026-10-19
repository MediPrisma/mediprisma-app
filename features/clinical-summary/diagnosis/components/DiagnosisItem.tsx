// Diagnosis Item Component
"use client"

import { useResourceAnchor } from '@/src/application/hooks/use-resource-anchor.hook'
import type { DiagnosisRow } from '../types'
import { StatusBadge } from './StatusBadge'
import { useRef } from 'react'

interface DiagnosisItemProps {
  diagnosis: DiagnosisRow
}

export function DiagnosisItem({ diagnosis }: DiagnosisItemProps) {
  // Resource-navigation anchor: a cited Condition in the Medical Summary tab
  // scroll-flashes this row.
  const historyRef = useRef<HTMLDetailsElement>(null)
  const anchorRef = useResourceAnchor<HTMLLIElement>('Condition', diagnosis.records?.map((record) => record.id) ?? diagnosis.id, () => {
    if (historyRef.current) historyRef.current.open = true
  })

  // One line — ICD codes, name, stage, status badges, then the date at the right edge —
  // matching the 就醫主診斷 rows below it; wraps only when the row is too narrow.
  return (
    <li ref={anchorRef} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 leading-5">
      <span className="min-w-0 break-words font-medium text-foreground">
        {diagnosis.icdCodes?.length ? (
          <span className="mr-2 tabular-nums">{diagnosis.icdCodes.join(' / ')}{' '}</span>
        ) : null}
        {!diagnosis.icdCodes?.includes(diagnosis.title) && diagnosis.title}
      </span>

      {/* Cancer staging — a diagnosis attribute (mCODE Condition.stage), shown
          as its own emphasised chip, not a generic category badge. */}
      {diagnosis.stage && (
        <span className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20">
          {diagnosis.stage}
        </span>
      )}
      {diagnosis.clinical && (
        <StatusBadge status={diagnosis.clinical} type="clinical" />
      )}
      {diagnosis.verification && (
        <StatusBadge status={diagnosis.verification} type="verification" />
      )}
      {diagnosis.categories?.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border"
        >
          {c}
        </span>
      ))}
      {diagnosis.when && (
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular-nums">{diagnosis.when}</span>
      )}
      {diagnosis.records && (diagnosis.records.length > 1 || diagnosis.records.some((record) => record.originalText && record.originalText !== diagnosis.title)) && (
        <details ref={historyRef} className="basis-full text-[max(12px,0.75rem)] text-muted-foreground">
          <summary className="min-h-[44px] cursor-pointer py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 sm:py-1">
            {diagnosis.historyLabel}
          </summary>
          <ul className="space-y-1 py-1">
            {diagnosis.records.map((record) => (
              <li key={record.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums">{record.when}</span>
                {record.institution && <span className="break-words">{record.institution}</span>}
                {record.originalText && <span className="basis-full break-words text-foreground/85">{record.originalText}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}
