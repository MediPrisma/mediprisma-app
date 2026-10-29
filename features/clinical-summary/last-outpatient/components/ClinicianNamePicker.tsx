'use client'

// The clinician's own name, as the visit physician is recorded: typed, or
// picked from the open chart's hospital physicians of the past year. Saved with
// the other 門診偏好 (and to the signed-in account), on blur or Enter rather
// than on every keystroke. Shared by 上次門診 itself and 設定 › 顯示與關於.

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'
import { useClinicalData } from '@/src/application/hooks/clinical-data/use-clinical-data-query.hook'
import { cn } from '@/src/shared/utils/cn.utils'
import { isSameClinician, recentHospitalPhysicians } from '../utils/last-outpatient'

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))

export function ClinicianNamePicker({
  idPrefix,
  onChange,
  className,
}: {
  idPrefix: string
  /** After the saved name changed, by typing or picking. */
  onChange?: () => void
  className?: string
}) {
  const { t } = useLanguage()
  const { clinicianName, setClinicianName } = useOutpatientPrefs()
  const { encounters, resourceReady } = useClinicalData()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? clinicianName ?? ''
  const physicians = useMemo(
    () => (resourceReady.encounters ? recentHospitalPhysicians(encounters) : []),
    [encounters, resourceReady.encounters],
  )

  const save = (name: string) => {
    setClinicianName(name)
    onChange?.()
  }

  const commit = () => {
    if (draft === null) return
    if (draft.trim() !== (clinicianName ?? '')) save(draft)
    setDraft(null)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-input`} className="text-sm font-medium">
          {t.settings.clinicianNameLabel}
        </Label>
        <Input
          id={`${idPrefix}-input`}
          value={value}
          maxLength={40}
          autoComplete="name"
          placeholder={t.settings.clinicianNamePlaceholder}
          aria-describedby={`${idPrefix}-description`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          className="h-[44px] max-w-xs"
        />
        <p id={`${idPrefix}-description`} className="text-xs leading-relaxed text-muted-foreground">
          {t.settings.clinicianNameDescription}
        </p>
      </div>
      {physicians.length > 0 && (
        <div className="space-y-1.5">
          <p id={`${idPrefix}-picks`} className="text-xs font-medium text-muted-foreground">
            {t.settings.clinicianNamePicks}
          </p>
          <div role="group" aria-labelledby={`${idPrefix}-picks`} className="flex flex-wrap gap-2">
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
                    save(selected ? '' : physician.name)
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
