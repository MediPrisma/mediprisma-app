"use client"

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react"
import { ChevronsLeft, ChevronsRight, LoaderCircle } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/src/shared/utils/cn.utils"
import { useVisualViewport } from "@/src/shared/hooks/layout/use-visual-viewport.hook"

export const ClinicalWorkspaceRoot = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function ClinicalWorkspaceRoot({ className, style, ...props }, ref) {
  // Keeps the shell inside the keyboard-free area on iOS (see the hook).
  useVisualViewport()
  return (
    <div
      ref={ref}
      data-slot="clinical-workspace"
      className={cn(
        "relative flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      style={{
        // Falls back to the old behaviour wherever visualViewport is absent.
        height: "var(--app-viewport-height, 100svh)",
        // iOS may pan the visual viewport instead of keeping it at y=0 when
        // the keyboard opens. Move the shell with that visible area so its
        // header and composer do not end up outside the screen.
        top: "var(--app-viewport-offset-top, 0px)",
        ...style,
      }}
      {...props}
    />
  )
})

export const ClinicalTabContentFrame = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function ClinicalTabContentFrame({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="clinical-tab-content-frame"
      className={cn("min-w-0 w-full px-3 sm:px-4", className)}
      {...props}
    />
  )
})

export const ClinicalWorkspaceMain = forwardRef<
  HTMLElement,
  ComponentPropsWithoutRef<"main">
>(function ClinicalWorkspaceMain({ className, ...props }, ref) {
  return (
    <main
      ref={ref}
      data-slot="clinical-workspace-main"
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row",
        className,
      )}
      {...props}
    />
  )
})

type DesktopPanelState = "split" | "fill" | "collapsed"

interface ClinicalWorkspacePanelProps
  extends ComponentPropsWithoutRef<"section"> {
  mobileActive: boolean
  /** Keep an inactive phone panel laid out while a temporary detail overlays
   *  it. Virtualized lists lose their measured window when an ancestor becomes
   *  display:none; an invisible absolute panel preserves the exact row and
   *  scroll position for the close/back action. */
  preserveMobileLayoutWhenInactive?: boolean
  desktopState: DesktopPanelState
  desktopWidth?: CSSProperties["width"]
}

export const ClinicalWorkspacePanel = forwardRef<
  HTMLElement,
  ClinicalWorkspacePanelProps
>(function ClinicalWorkspacePanel({
  mobileActive,
  preserveMobileLayoutWhenInactive = false,
  desktopState,
  desktopWidth,
  className,
  style,
  ...props
}, ref) {
  return (
    <section
      ref={ref}
      data-slot="clinical-workspace-panel"
      className={cn(
        "min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-panel md:w-auto",
        !mobileActive && !preserveMobileLayoutWhenInactive && "max-md:hidden",
        !mobileActive && preserveMobileLayoutWhenInactive
          && "max-md:pointer-events-none max-md:invisible max-md:absolute max-md:inset-0 max-md:h-full",
        desktopState === "collapsed" && "md:hidden",
        desktopState === "fill" && "md:flex-1",
        desktopState === "split" && "md:flex-initial",
        className,
      )}
      style={{
        ...style,
        ...(desktopState === "split" && desktopWidth
          ? { width: desktopWidth }
          : {}),
      }}
      {...props}
    />
  )
})

interface ClinicalMobilePanelSwitcherProps {
  activePanel: "left" | "right"
  leftLabel: string
  rightLabel: string
  onChange: (panel: "left" | "right") => void
}

export function ClinicalMobilePanelSwitcher({
  activePanel,
  leftLabel,
  rightLabel,
  onChange,
}: ClinicalMobilePanelSwitcherProps) {
  const buttonClasses =
    "h-[40px] min-h-[40px] flex-1 border-b-2 px-4 py-0 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"

  return (
    <nav
      data-slot="clinical-mobile-panel-switcher"
      aria-label={`${leftLabel} / ${rightLabel}`}
      className="flex shrink-0 border-b border-border bg-panel md:hidden"
    >
      <button
        type="button"
        onClick={() => onChange("left")}
        aria-pressed={activePanel === "left"}
        className={cn(
          buttonClasses,
          activePanel === "left"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        {leftLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("right")}
        aria-pressed={activePanel === "right"}
        className={cn(
          buttonClasses,
          activePanel === "right"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        {rightLabel}
      </button>
    </nav>
  )
}

interface ClinicalWorkspaceDividerProps {
  label: string
  onDragStart: MouseEventHandler<HTMLDivElement>
  onCollapseLeft: () => void
  onCollapseRight: () => void
  leftCollapseLabel: string
  rightCollapseLabel: string
  showCollapseActions?: boolean
}

export function ClinicalWorkspaceDivider({
  label,
  onDragStart,
  onCollapseLeft,
  onCollapseRight,
  leftCollapseLabel,
  rightCollapseLabel,
  showCollapseActions = true,
}: ClinicalWorkspaceDividerProps) {
  const actionClasses =
    "inline-flex h-7 w-7 items-center justify-center rounded-full bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"

  return (
    <div
      data-slot="clinical-workspace-divider"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      className="reveal-scope group relative flex w-px shrink-0 items-center justify-center bg-border max-md:hidden"
    >
      <div
        className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize"
        onMouseDown={onDragStart}
      />
      <div
        data-slot="clinical-workspace-divider-line"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/40 group-active:bg-primary"
      />

      {showCollapseActions && (
        <div className="reveal-on-hover absolute z-10 flex flex-col gap-0.5 rounded-full border border-border bg-popover p-0.5 shadow-sm">
          {/* Two chevrons cannot say what they will do, and what they DO is
              stateful: the first press re-centres a lopsided split, the next
              collapses that side (the labels come from the shell and change
              with it). A permanent caption is not an option — the divider is
              8px wide between two dense panels — so the wording rides a real
              tooltip rather than `title`, which appears only after a delay and
              is invisible to keyboard users. `delayDuration={150}`: this is
              read while reaching for the control, not hovered by accident. */}
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onCollapseLeft}
                aria-label={leftCollapseLabel}
                className={actionClasses}
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6} className="text-xs">
              {leftCollapseLabel}
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onCollapseRight}
                aria-label={rightCollapseLabel}
                className={actionClasses}
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6} className="text-xs">
              {rightCollapseLabel}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

interface ClinicalWorkspaceRailProps {
  label: string
  iconDirection: "left" | "right"
  onClick: () => void
  /** Draw attention to something waiting inside the collapsed panel. */
  badge?: boolean
  /** Work is running inside the collapsed panel right now. */
  busy?: boolean
  /** Short status shown horizontally under the label — an elapsed time reads
   *  as nonsense rotated 90° with the rest of the vertical text. */
  note?: ReactNode
  children?: ReactNode
}

export function ClinicalWorkspaceRail({
  label,
  iconDirection,
  onClick,
  badge = false,
  busy = false,
  note,
  children,
}: ClinicalWorkspaceRailProps) {
  const Icon = iconDirection === "left" ? ChevronsLeft : ChevronsRight
  const active = badge || busy

  return (
    <button
      type="button"
      data-slot="clinical-workspace-rail"
      data-badge={badge ? "true" : undefined}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "group flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-3 border-x border-border bg-panel text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary max-md:hidden",
        // Two different things, so two different colours. Work in flight uses
        // the shell's own interaction blue; a FINISHED run uses teal — the
        // colour 醫療摘要 already carries in the right panel — so the rail is
        // tinted like the thing it is pointing at. Neither is an alarm tone:
        // this is information, not a warning.
        busy && "border-primary/45 bg-primary/5 text-primary",
        badge && !busy && "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
      )}
    >
      {busy ? (
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : badge && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400"
        />
      )}
      <Icon className="h-4 w-4" />
      <span className={cn(
        "select-none text-xs [writing-mode:vertical-rl]",
        active ? "font-semibold" : "font-medium",
      )}>
        {children ?? label}
      </span>
      {note && (
        <span className="select-none text-[0.625rem] font-medium tabular-nums">
          {note}
        </span>
      )}
    </button>
  )
}
