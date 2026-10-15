"use client"

import { Database } from "lucide-react"
import { startTransition, useEffect, useState } from "react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DataSelectionFeature } from "../Feature"
import type { ContextOverflowIssue } from "@/src/shared/utils/context-budget"
import type { DataConsumer } from "@/src/application/providers/data-selection.provider"
import type { DataSelectionFeatureProps } from "../Feature"

function DeferredDataSelectionFeature(props: DataSelectionFeatureProps) {
  const [ready, setReady] = useState(false)
  const { t } = useLanguage()
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Give the dialog chrome a paint before starting the chart calculation.
    // This is scheduling on the main thread, not a claim of background work.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (!cancelled) startTransition(() => setReady(true))
      }, 0)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return ready ? <DataSelectionFeature {...props} /> : (
    <div role="status" aria-busy="true" className="py-4 text-sm text-muted-foreground">
      {t.dataSelection.loadingData}
    </div>
  )
}

export interface DataSelectionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  applyHint?: string
  /** Deterministic 初診快覽 floors that apply regardless of the saved window. */
  floorNote?: string
  modelId?: string
  fallbackModelId?: string
  /** Last exact full-request overflow, used to turn the selected-only meter
   * into a concrete reduction target instead of a dead-end green bar. */
  overflowIssue?: ContextOverflowIssue | null
  consumer?: DataConsumer
  showTemplates?: boolean
}

/**
 * Reusable host for the main AI clinical-data scope editor.
 *
 * The drawer owns presentation only. Selection state and clinical-data mapping
 * remain inside DataSelectionFeature/DataSelectionProvider, so any summary-like
 * surface can plug this in without duplicating scope logic or persistence.
 */
export function DataSelectionDrawer({
  open,
  onOpenChange,
  title,
  description,
  applyHint,
  floorNote,
  modelId,
  fallbackModelId,
  overflowIssue,
  consumer = 'insights',
  showTemplates = true,
}: DataSelectionDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b bg-muted/20 px-4 py-3 pr-10 sm:px-5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Database aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            {title}
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">{description}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
          <div className="p-3 sm:p-4">
            {open && <DeferredDataSelectionFeature
              modelId={modelId}
              fallbackModelId={fallbackModelId}
              overflowIssue={overflowIssue}
              showScopeDescription={false}
              consumer={consumer}
              showTemplates={showTemplates}
            />}
          </div>
        </ScrollArea>

        {applyHint || floorNote ? (
          <div className="space-y-1 border-t bg-background px-4 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-5">
            {floorNote ? <p>{floorNote}</p> : null}
            {applyHint ? <p>{applyHint}</p> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
