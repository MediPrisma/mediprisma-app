"use client"

import { type ComponentPropsWithoutRef } from "react"

import { useLanguage } from "@/src/application/providers/language.provider"
import {
  calculateAge,
  getPatientDisplayName,
  type PatientEntity,
} from "@/src/core/entities/patient.entity"
import { cn } from "@/src/shared/utils/cn.utils"

interface ClinicalPatientContextProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  patient: PatientEntity | null
  variant?: "header" | "mobile"
}

export function ClinicalPatientContext({
  patient,
  variant = "header",
  className,
  ...props
}: ClinicalPatientContextProps) {
  const { locale, t } = useLanguage()

  if (!patient) return null

  const name = getPatientDisplayName(patient, locale)
  const age = patient.age ?? calculateAge(patient.birthDate)
  const ageText =
    age === null
      ? null
      : locale === "zh-TW"
        ? `${age}歲`
        : `${age} years`
  const genderText = patient.gender
    ? t.patient[patient.gender]
    : t.patient.unknown
  const accessibleLabel = [
    t.patient.info,
    name,
    ageText,
    genderText,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      data-slot="clinical-patient-context"
      aria-label={accessibleLabel}
      className={cn(
        "min-w-0 items-baseline gap-1.5 text-sm text-muted-foreground",
        variant === "header" && "flex flex-1",
        variant === "mobile" &&
          "flex min-h-[40px] shrink-0 border-b border-border bg-card px-3 md:hidden",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
        {name}
      </span>
      {ageText && (
        <>
          <span aria-hidden="true" className="text-muted-foreground/40">
            ·
          </span>
          <span className="shrink-0 tabular-nums">{ageText}</span>
        </>
      )}
      <span aria-hidden="true" className="text-muted-foreground/40">
        ·
      </span>
      <span className="shrink-0">{genderText}</span>
    </div>
  )
}
