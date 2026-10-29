'use client'

// 上次門診 opens on the clinician's own last visit with the patient when the
// visit physician matches this name. Saved with the other 門診偏好 (and to the
// signed-in account), on blur or Enter rather than on every keystroke. The
// open chart's hospital physicians of the past year are offered to pick from.

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { cn } from '@/src/shared/utils/cn.utils'
import { isSameClinician, recentHospitalPhysicians } from '@/features/clinical-summary/last-outpatient'

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))

export function ClinicianNameSetting() {
  const { t } = useLanguage()
  const { clinicianName, setClinicianName } = useOutpatientPrefs()
  const { encounters, resourceReady } = useClinicalData()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? clinicianName ?? ''
  const physicians = useMemo(
    () => (resourceReady.encounters ? recentHospitalPhysicians(encounters) : []),
    [encounters, resourceReady.encounters],
  )

  const commit = () => {
    if (draft === null) return
    if (draft.trim() !== (clinicianName ?? '')) setClinicianName(draft)
    setDraft(null)
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs uppercase text-muted-foreground">
        {t.settings.clinicianNameSection}
      </Label>
      <div className="space-y-1.5">
        <Label htmlFor="clinician-name" className="text-sm font-medium">
          {t.settings.clinicianNameLabel}
        </Label>
        <Input
          id="clinician-name"
          value={value}
          maxLength={40}
          autoComplete="name"
          placeholder={t.settings.clinicianNamePlaceholder}
          aria-describedby="clinician-name-description"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          className="h-[44px] max-w-xs"
        />
        <p id="clinician-name-description" className="text-xs leading-relaxed text-muted-foreground">
          {t.settings.clinicianNameDescription}
        </p>
      </div>
      {physicians.length > 0 && (
        <div className="space-y-1.5">
          <p id="clinician-name-picks" className="text-xs font-medium text-muted-foreground">
            {t.settings.clinicianNamePicks}
          </p>
          <div role="group" aria-labelledby="clinician-name-picks" className="flex flex-wrap gap-2">
            {physicians.map((physician) => {
              const selected = isSameClinician(physician.name, clinicianName)
              return (
                <Button
                  key={physician.name}
                  type="button"
                  variant="outline"
                  aria-pressed={selected}
                  onClick={() => {
                    setDraft(null)
                    // Picking again clears the choice; another name replaces it.
                    setClinicianName(selected ? '' : physician.name)
                  }}
                  className={cn(
                    'h-auto min-h-[44px] flex-col items-start gap-0 px-3 py-1.5 text-left',
                    selected && 'border-primary bg-accent text-accent-foreground hover:bg-accent',
                  )}
                >
                  <span className="text-sm font-medium">{physician.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {[
                      physician.departments.join('、'),
                      fill(t.settings.clinicianNameVisits, {
                        count: physician.visits,
                        date: physician.lastVisit.slice(5).replace('-', '/'),
                      }),
                    ].filter(Boolean).join(' · ')}
                  </span>
                </Button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
