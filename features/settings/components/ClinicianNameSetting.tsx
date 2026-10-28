'use client'

// 上次門診 opens on the clinician's own last visit with the patient when the
// visit physician matches this name. Saved with the other 門診偏好 (and to the
// signed-in account), on blur or Enter rather than on every keystroke.

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/src/application/providers/language.provider'
import { useOutpatientPrefs } from '@/src/application/hooks/use-outpatient-prefs.hook'

export function ClinicianNameSetting() {
  const { t } = useLanguage()
  const { clinicianName, setClinicianName } = useOutpatientPrefs()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? clinicianName ?? ''

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
    </div>
  )
}
