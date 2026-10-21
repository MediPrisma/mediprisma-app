"use client"

// Sticky category chips for the stacked cumulative report.
//
// The stacked layout trades "one panel at a time" for "everything in one
// scroll"; without a jump bar, reaching 尿液 on a patient with 60 chemistry
// rows is a long drag. The chips restore direct access AND double as a
// position indicator (scrollspy in CumulativeStackedView marks the section the
// clinician is currently reading).
import { SlidersHorizontal } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useLanguage } from "@/src/application/providers/language.provider"
import { cn } from "@/src/shared/utils/cn.utils"
import { CumulativeOrderPanel, type CumulativeOrderEntry } from "./CumulativeOrderPanel"

export function CumulativeCategoryJumpBar({
  entries,
  activeId,
  onJump,
  onMove,
  onReset,
  canReset,
}: {
  entries: CumulativeOrderEntry[]
  activeId?: string
  onJump: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onReset: () => void
  canReset: boolean
}) {
  const { t } = useLanguage()
  const strings = (t.reports as any).cumulativeStacked ?? {}
  const reorderLabel: string = strings.reorder ?? '調整順序'
  const reorderTitle: string = strings.reorderTitle ?? '調整分類順序'

  return (
    // bg-card (not transparent): the sections scroll UNDER this bar, so it has
    // to be opaque on the card surface at every theme.
    <div className="reveal-scope sticky top-0 z-20 flex items-center gap-1.5 border-b border-border bg-panel py-1">
      <nav
        aria-label={strings.jumpBarLabel ?? '累積報告分類'}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry) => {
          const active = entry.id === activeId
          return (
            <button
              key={entry.id}
              type="button"
              data-cumulative-jump-chip={entry.id}
              aria-current={active ? 'true' : undefined}
              onClick={() => onJump(entry.id)}
              className={cn(
                "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[0.6875rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:h-[26px] max-md:px-2.5",
                active
                  ? "border-transparent bg-foreground/[0.07] font-semibold text-foreground"
                  : "border-transparent bg-transparent font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="font-normal tabular-nums opacity-80">{entry.dateCount}</span>
            </button>
          )
        })}
      </nav>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={reorderTitle}
            title={reorderTitle}
            className="reveal-on-hover inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-transparent bg-transparent px-1.5 text-[0.6875rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-md:h-[26px] max-md:min-w-[36px] max-md:justify-center"
          >
            <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="hidden md:inline">{reorderLabel}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <CumulativeOrderPanel
            entries={entries}
            onMove={onMove}
            onReset={onReset}
            canReset={canReset}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
