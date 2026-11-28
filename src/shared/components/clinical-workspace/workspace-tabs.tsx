"use client"

import type { ComponentProps, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/src/shared/utils/cn.utils"

type IconVisibility = "always" | "desktop" | "panel" | "responsive"
type LabelVisibility = "always" | "sm" | "never"

export function ClinicalTabList({
  className,
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      data-variant="clinical-workspace"
      className={cn(
        "h-auto min-h-[40px] w-full shrink-0 rounded-none border-x-0 border-t-0 border-b border-border bg-card p-0 shadow-none max-md:pointer-fine:min-h-[32px] md:min-h-[44px] xl:h-10 xl:min-h-10",
        className,
      )}
      {...props}
    />
  )
}

interface ClinicalTabTriggerProps
  extends Omit<ComponentProps<typeof TabsTrigger>, "children"> {
  icon?: LucideIcon
  iconVisibility?: IconVisibility
  label: string
  labelVisibility?: LabelVisibility
  suffix?: ReactNode
}

export function ClinicalTabTrigger({
  icon: Icon,
  iconVisibility = "always",
  label,
  labelVisibility = "always",
  suffix,
  className,
  ...props
}: ClinicalTabTriggerProps) {
  return (
    <TabsTrigger
      title={label}
      aria-label={label}
      className={cn(
        "relative min-h-[40px] min-w-0 gap-1.5 max-md:pointer-fine:min-h-[32px] rounded-none border-0 bg-transparent px-2 py-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-[''] hover:bg-muted/45 hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:after:bg-primary dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent md:min-h-[44px] xl:min-h-10",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            iconVisibility === "desktop" && "max-lg:hidden",
            iconVisibility === "panel" && "@max-[28rem]:hidden",
            iconVisibility === "responsive" &&
              "max-xl:hidden @max-[28rem]:hidden",
          )}
        />
      )}
      {labelVisibility !== "never" && (
        <span
          className={cn(
            "min-w-0 truncate",
            labelVisibility === "sm" && "max-sm:hidden",
          )}
        >
          {label}
        </span>
      )}
      {suffix}
    </TabsTrigger>
  )
}
