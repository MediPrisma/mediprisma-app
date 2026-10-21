"use client"

// The one entry to 回報檢驗資料問題, in the cumulative report's toolbar. A
// plain, clinician-clicked action: it never prompts or announces itself — the
// only toast is the result of a report the clinician sent — so it is safe on
// the question-free MediCloud launch route (isMedcloudLaunchRoute) too.
import { useState } from "react"
import dynamic from "next/dynamic"
import { Flag } from "lucide-react"
import { useLanguage } from "@/src/application/providers/language.provider"
import { cn } from "@/src/shared/utils/cn.utils"
import type { AnalyteNameMode } from "@voho0000/clinical-lab-normalization/display"
import type { LabDataReportPanel } from "./LabDataReportDialog"

// The dialog (builder, scanner, preview table) loads on first use only.
const LabDataReportDialog = dynamic(
  () => import("./LabDataReportDialog").then((module) => module.LabDataReportDialog),
  { ssr: false },
)

export interface LabDataReportButtonProps {
  /** Panels that have data, in the clinician's order (the chips' order). */
  panels: readonly LabDataReportPanel[]
  observations: readonly any[]
  nameMode: AnalyteNameMode
  className?: string
}

export function LabDataReportButton({
  panels,
  observations,
  nameMode,
  className,
}: LabDataReportButtonProps) {
  const { t } = useLanguage()
  const strings = ((t as any).labDataReport ?? {}) as Record<string, string>
  const [open, setOpen] = useState(false)
  const label = strings.entryLabel ?? strings.entry

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        className={cn(
          // Literal px, not rem: the root font-size is 12px, so h-9 would be
          // 27px beside 36–40px neighbours. In a narrow report (phone) the
          // toolbar has no room for the word: the flag stays, and the
          // accessible name still says 回報檢驗資料問題.
          "inline-flex h-[24px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:h-[36px] @max-[430px]:w-[36px] @max-[430px]:px-0",
          className,
        )}
      >
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="@max-[430px]:sr-only">{strings.entry}</span>
      </button>
      {open && (
        <LabDataReportDialog
          open={open}
          onOpenChange={setOpen}
          panels={panels}
          observations={observations}
          nameMode={nameMode}
        />
      )}
    </>
  )
}
