"use client"

import { cn } from "@/src/shared/utils/cn.utils"

interface FilterPillsProps<K extends string> {
  /** Names the group for screen readers — both groups in the card offer 全部. */
  label: string
  options: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
}

export function FilterPills<K extends string>({ label, options, value, onChange }: FilterPillsProps<K>) {
  return (
    // Wraps rather than overflowing the card when text is enlarged.
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
            value === option.key
              ? "border-primary bg-primary/10 text-primary font-medium"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
