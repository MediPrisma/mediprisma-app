'use client'

// The clinician's own name, picked from the open chart's hospital physicians of
// the past year — never typed, so it always matches how the hospital records
// the visit physician. Saved with the other 門診偏好 (and to the signed-in
// account). Set in 設定 › 顯示與關於; 上次門診 marks this clinician's visits
// and lists them first in its physician filter.

import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { cn } from '@/src/shared/utils/cn.utils'
import { isSameClinician, recentHospitalPhysicians } from '../utils/last-outpatient'

const NONE = '__none__'

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))

export function ClinicianNamePicker({
  idPrefix,
  className,
}: {
  idPrefix: string
  className?: string
}) {
  const { t } = useLanguage()
  const strings = t.settings
  const { clinicianName, setClinicianName } = useOutpatientPrefs()
  const { encounters, resourceReady } = useClinicalData()
  const physicians = useMemo(
    () => (resourceReady.encounters ? recentHospitalPhysicians(encounters) : []),
    [encounters, resourceReady.encounters],
  )
  const current = physicians.find((physician) => isSameClinician(physician.name, clinicianName))
  // A name saved on another patient's chart stays listed, so the menu still
  // shows it and it can be cleared.
  const savedElsewhere = clinicianName && !current ? clinicianName : null

  if (physicians.length === 0 && !clinicianName) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <p className="text-sm font-medium">{strings.clinicianNameLabel}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{strings.clinicianNameNoChart}</p>
      </div>
    )
  }

  const menu = (
    <Select
      value={current?.name ?? savedElsewhere ?? NONE}
      onValueChange={(value) => setClinicianName(value === NONE ? '' : value)}
    >
      <SelectTrigger
        id={`${idPrefix}-select`}
        aria-describedby={`${idPrefix}-description`}
        className="h-[44px] w-full max-w-xs"
      >
        <SelectValue placeholder={strings.clinicianNamePlaceholder}>
          {current?.name ?? savedElsewhere ?? strings.clinicianNameNone}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={NONE} className="text-muted-foreground">{strings.clinicianNameNone}</SelectItem>
        {savedElsewhere && <SelectItem value={savedElsewhere}>{savedElsewhere}</SelectItem>}
        {physicians.map((physician) => (
          <SelectItem key={physician.name} value={physician.name} textValue={physician.name}>
            <span className="font-medium">{physician.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {[
                physician.departments.join('、'),
                fill(strings.clinicianNameVisits, {
                  count: physician.visits,
                  date: physician.lastVisit.slice(5).replace('-', '/'),
                }),
              ].filter(Boolean).join(' · ')}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={`${idPrefix}-select`} className="text-sm font-medium">
        {strings.clinicianNameLabel}
      </Label>
      {menu}
      <p id={`${idPrefix}-description`} className="text-xs leading-relaxed text-muted-foreground">
        {strings.clinicianNameDescription}
      </p>
    </div>
  )
}
