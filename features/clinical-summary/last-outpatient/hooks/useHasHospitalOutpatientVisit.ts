"use client"

import { useMemo } from "react"
import { useClinicalData } from "@/src/application/hooks/clinical-data/use-clinical-data-query.hook"
import { hasHospitalOutpatientVisit } from "../utils/last-outpatient"

/** Whether the loaded chart holds a hospital (院內) outpatient visit — the
 *  condition for showing the 上次門診 tab. False while encounters load. */
export function useHasHospitalOutpatientVisit(): boolean {
  const { encounters, resourceReady } = useClinicalData()
  return useMemo(
    () => !!resourceReady.encounters && hasHospitalOutpatientVisit(encounters),
    [encounters, resourceReady.encounters],
  )
}
