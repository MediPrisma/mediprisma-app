// Cited text that opens its own records — the claim itself is the link. The
// numbered citation pills after every phrase read as noise across a whole
// summary (owner, 2026-10-05), so the value, name or medicine a record backs
// is what the clinician clicks: one clean source opens straight into the left
// panel; several, or one that needs checking, open the trace list first. A
// faint dotted underline marks what can be opened without hover; a source that
// needs checking keeps an amber icon beside the text (不遮蔽 principle — never
// colour alone).
"use client"

import { useState, type ReactNode } from "react"
import { ArrowUpRight, CircleAlert } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/src/shared/utils/cn.utils"
import { localizeDemoDisplayText } from "@/src/shared/utils/demo-display"
import { formatOrganizationDisplay } from "@/src/shared/utils/organization-display"
import { useOptionalLanguage } from "@/src/application/providers/language.provider"
import type { ResolvedSourceRef } from "@/src/core/entities/medical-summary.entity"
import type { ResourceNavTarget } from "@/src/application/stores/resource-navigation.store"

interface SourceLinkProps {
  sources: ResolvedSourceRef[]
  /** The cited text: a value, a name, a medicine, a sentence. */
  children: ReactNode
  typeLabel: (resourceType?: string) => string
  unverifiedLabel: string
  /** When provided, resolved sources open in the left panel. */
  onNavigate?: (target: ResourceNavTarget) => void
  /** Keys cited by THIS claim whose report type contradicts the claim's stated
   *  evidence (e.g. 依據:心電圖 citing a chest X-ray). The resource exists, so
   *  it stays navigable, but the link warns with `suspectLabel`. */
  suspectKeys?: ReadonlySet<string>
  suspectLabel?: string
  /** 'text' (default): a dotted underline under running text. 'token': the
   *  host already draws the element as a token (a medicine pill), so no
   *  underline — hover and focus still show it opens. */
  variant?: "text" | "token"
  className?: string
}

function navTarget(s: ResolvedSourceRef): ResourceNavTarget {
  return {
    resourceType: s.resourceType ?? "",
    resourceId: s.resourceId!,
    display: s.display,
    date: s.date,
    ...(s.evidenceQuote ? { evidenceQuote: s.evidenceQuote } : {}),
  }
}

export function SourceLink({
  sources,
  children,
  typeLabel,
  unverifiedLabel,
  onNavigate,
  suspectKeys,
  suspectLabel,
  variant = "text",
  className,
}: SourceLinkProps) {
  const locale = useOptionalLanguage()?.locale ?? "zh-TW"
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return <>{children}</>

  const isSuspect = (s: ResolvedSourceRef) => Boolean(suspectKeys?.has(s.key) || s.evidenceWarning)
  const hasWarning = sources.some((s) => !s.verified || isSuspect(s))
  const only = sources.length === 1 ? sources[0] : undefined
  // One clean, resolved source: the click IS the navigation. Anything else
  // shows the trace first, so a warning is read before the record opens.
  const direct = only && !hasWarning && only.resourceId && onNavigate ? only : undefined

  const describe = (s: ResolvedSourceRef) => [
    typeLabel(s.resourceType),
    s.organization ? formatOrganizationDisplay(s.organization, locale) : "",
    s.date ?? "",
  ].filter(Boolean).join(" · ")
  // Read after the visible text, so the accessible name starts with what is
  // on screen (label-in-name) and still says where the click goes.
  const hint = direct
    ? (locale === "zh-TW" ? `（開啟來源：${describe(direct)}）` : ` (open source: ${describe(direct)})`)
    : [
        locale === "zh-TW" ? `（${sources.length} 筆來源` : ` (${sources.length} source${sources.length === 1 ? "" : "s"}`,
        hasWarning ? (locale === "zh-TW" ? `，${unverifiedLabel}` : `, ${unverifiedLabel}`) : "",
        locale === "zh-TW" ? "）" : ")",
      ].join("")

  const linkClass = cn(
    "cursor-pointer rounded-[2px] outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
    variant === "text" && [
      "underline decoration-dotted decoration-1 underline-offset-[3px]",
      hasWarning
        ? "decoration-amber-500/70 hover:decoration-solid hover:decoration-amber-600"
        : "decoration-muted-foreground/45 hover:decoration-solid hover:decoration-primary",
    ],
    variant === "token" && "hover:border-primary/50 hover:bg-primary/5",
    className,
  )
  const content = (
    <>
      {children}
      {hasWarning ? (
        <CircleAlert
          className="ml-0.5 inline h-3 w-3 shrink-0 align-[-0.125em] text-amber-600 dark:text-amber-300"
          aria-hidden="true"
        />
      ) : null}
      <span className="sr-only">{hint}</span>
    </>
  )

  if (direct) {
    const go = () => onNavigate!(navTarget(direct))
    return (
      <span
        role="button"
        tabIndex={0}
        title={describe(direct)}
        data-source-link="direct"
        onClick={(e) => {
          e.stopPropagation()
          go()
        }}
        // <span role="button"> gets no click from Enter/Space by itself.
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            go()
          }
        }}
        className={linkClass}
      >
        {content}
      </span>
    )
  }

  const evidenceWarningLabel = (s: ResolvedSourceRef) => {
    if (!s.evidenceWarning) return ""
    if (locale === "zh-TW") return s.evidenceWarning === "missing"
      ? "此敘述未附原文引句，請點開來源核對。"
      : s.evidenceWarning === "mismatch"
        ? "引文與來源原文不符，請點開來源核對。"
        : "此引文尚未核對，請點開來源確認。"
    return s.evidenceWarning === "missing" ? "No excerpt for this claim. Open the source to check."
      : s.evidenceWarning === "mismatch" ? "The quote does not match the source. Open it to check."
        : "This excerpt has not been checked. Open the source to review."
  }
  const checkedExcerptLabel = (s: ResolvedSourceRef) => s.evidenceQuote && !s.evidenceWarning
    ? locale === "zh-TW" ? "引句與原文相符，請核對是否支持此敘述。" : "Excerpt matches the source; check that it supports this claim."
    : ""
  const notes = (s: ResolvedSourceRef) => (
    <>
      {suspectKeys?.has(s.key) && suspectLabel ? <span className="block font-medium">{suspectLabel}</span> : null}
      {s.evidenceWarning ? <span className="block font-medium">{evidenceWarningLabel(s)}</span> : null}
      {checkedExcerptLabel(s) ? <span className="block">{checkedExcerptLabel(s)}</span> : null}
    </>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          data-source-link="trace"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setOpen((v) => !v)
            }
          }}
          className={linkClass}
        >
          {content}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        // Long traces stay inside the viewport so every source remains
        // reachable by mouse, touch and keyboard; Radix supplies the height
        // available on the side it chose.
        className="w-auto max-w-[min(300px,calc(100vw-1rem))] space-y-1 overflow-y-auto overscroll-contain px-3 py-2"
        style={{
          maxHeight: "min(20rem, calc(var(--radix-popover-content-available-height) - 0.5rem))",
        }}
      >
        {sources.map((s) =>
          // Any resolved row opens the raw resource. Claim-level unsupported
          // citations stay amber but remain clickable so the user can see why
          // they were flagged; invented keys have no resource and stay inert.
          s.resourceId && onNavigate ? (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setOpen(false)
                onNavigate(navTarget(s))
              }}
              className={cn(
                "group -mx-1 flex w-full items-baseline gap-1.5 rounded-sm px-1 py-0.5 text-left text-[length:max(13px,0.8125rem)] leading-snug tabular-nums transition-colors",
                s.verified && !isSuspect(s)
                  ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10",
              )}
            >
              <span className="min-w-0 flex-1">
                {describe(s)}
                {s.display ? (
                  <span className="block text-foreground/80">{localizeDemoDisplayText(s.display, locale)}</span>
                ) : null}
                {!s.verified ? <span className="block font-medium">{unverifiedLabel}</span> : null}
                {notes(s)}
              </span>
              <ArrowUpRight className="h-3 w-3 shrink-0 self-center opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </button>
          ) : (
            <p
              key={s.key}
              className={cn(
                "text-[length:max(13px,0.8125rem)] leading-snug tabular-nums",
                s.verified && !isSuspect(s) ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300",
              )}
            >
              {s.verified ? (
                <>
                  {describe(s)}
                  {s.display ? (
                    <span className="block text-foreground/80">{localizeDemoDisplayText(s.display, locale)}</span>
                  ) : null}
                  {notes(s)}
                </>
              ) : (
                <>{s.key} · {unverifiedLabel}</>
              )}
            </p>
          ),
        )}
      </PopoverContent>
    </Popover>
  )
}
