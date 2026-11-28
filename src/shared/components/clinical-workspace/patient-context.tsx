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
  variant?: "header"
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
        "min-w-0 items-center gap-2 text-xs text-muted-foreground",
        variant === "header" &&
          "flex flex-1 border-l-2 border-primary/35 px-3 max-md:gap-1.5 max-md:border-l-0 max-md:px-0",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
        {name}
      </span>
      {ageText && (
        <>
          <span aria-hidden="true" className="text-muted-foreground/45">
            ·
          </span>
          <span className="shrink-0 tabular-nums">{ageText}</span>
        </>
      )}
      <span aria-hidden="true" className="text-muted-foreground/45">
        ·
      </span>
      <span className="shrink-0">{genderText}</span>
    </div>
  )
}
